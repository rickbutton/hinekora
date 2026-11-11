/**
 * The checker: thread the abstract item state (`AItem`) through a parsed
 * `Craft`, verifying every operation's precondition on every path. Errors are
 * collected as diagnostics, not thrown, a craft can have several independent
 * problems.
 */
import type {
    AffixDecl,
    Arg,
    Craft,
    Def,
    EldritchDecl,
    ItemBlock,
    OperationArg,
    ParamRef,
    Pred,
    ProcDef,
    Stmt,
} from "../ast/ast.js";
import type { SourceSpan } from "../ast/span.js";
import { type Gen, type GroupId, type ModId, TagId, type TypeId } from "../model/ids.js";
import type { Base } from "../model/base.js";
import type { Mod } from "../model/mod.js";
import {
    AMULET_ELDRITCH_TOP_TIER,
    canHaveEldritch,
    ELDRITCH_ITEM_LEVEL,
    type EldritchSide,
    eldritchTierLabel,
    eldritchTierOf,
    isEldritchAmulet,
    INFLUENCE_STEMS,
    INFLUENCES,
} from "../model/marks.js";
import { MAX_STRANDS } from "../model/strands.js";
import type { ClusterSize, ModTypeContext, Registry } from "../resolve/registry.js";
import {
    type AItem,
    type RPred,
    canBeRare,
    cardinalityGuarantees,
    guaranteedTypes,
    isExcluded,
    isGuaranteed,
    suffixRange,
    initialState,
    join,
    refine,
    maxTotal,
    sideCap,
    stateEqual,
    widenPresence,
    widenRanges,
} from "./astate.js";
import { BddManager } from "./bdd.js";
import {
    type CheckDiagnostic,
    describePred,
    preconditionMessage,
    resolveMessage,
} from "./diagnostics.js";
import {
    rollableGen,
    tierCount,
    type TierLadders,
    tierLadders,
    tierRows,
} from "../resolve/tiers.js";
import { findMethod, type Literal, type Method, slotAt } from "./methods.js";
import { anonymousRows, influenceTagsAny, influenceTagsOf, runMethod } from "./ops.js";
import { rollRange } from "./values.js";
import { lookupWeight } from "../pool/pool.js";
import type { Range } from "./domain.js";
import { plural } from "../words.js";

export interface CheckContext {
    readonly registry: Registry;
}

/** How the analysis is run, apart from what it is run on. */
export interface CheckTuning {
    /** The loop round from which the numeric ranges are widened; a test sets
     *  it low to drive the widening. */
    readonly widenRangesAfter?: number;
}

const cmpAtLeast = (projection: "prefixCount" | "suffixCount", value: number): RPred => ({
    kind: "compare",
    projection,
    op: ">=",
    value,
});

/** The abstract item state before and after a statement (or the item block). */
export interface TraceEntry {
    readonly span: SourceSpan;
    /** What produced this entry, the statement kind, or "item" for the block. */
    readonly kind: Stmt["kind"] | "item";
    readonly before: AItem;
    /** State after it completes; absent if that path diverges (via restart). */
    readonly after?: AItem;
    /** The statement, inside a call's body, where one written statement may
     *  run as several (a step parameter used twice). */
    readonly stmt?: Stmt;
    /** A call's body with its arguments bound, and its own trace. */
    readonly inlined?: { readonly body: readonly Stmt[]; readonly trace: readonly TraceEntry[] };
}

export interface CheckResult {
    readonly ok: boolean;
    readonly diagnostics: readonly CheckDiagnostic[];
    /** The abstract item state after the last fall-through statement, if any. */
    readonly finalState?: AItem;
    /**
     * State entering each statement (and the item block), for editor hover
     * ("what is my item here"). Populated on the real pass only, so each source
     * statement appears once.
     */
    readonly trace: readonly TraceEntry[];
}

/**
 * The innermost (smallest-span) trace entry containing `offset`. Hovering a
 * loop (whose span runs through its closing `}`) yields the loop entry, whose
 * `after` is the proven post-loop state.
 */
export function traceAt(trace: readonly TraceEntry[], offset: number): TraceEntry | undefined {
    let best: TraceEntry | undefined;
    for (const e of trace) {
        if (e.span.start.offset <= offset && offset < e.span.end.offset) {
            const width = e.span.end.offset - e.span.start.offset;
            if (best === undefined || width < best.span.end.offset - best.span.start.offset)
                best = e;
        }
    }
    return best;
}

/** Item-block affix names that mean "some unspecified affix". */
const PLACEHOLDERS = /^random\b|^\?$/;

/** How many passive skills a cluster jewel of each size adds (Cluster jewel). */
const CLUSTER_PASSIVES: Readonly<Record<ClusterSize, readonly [number, number]>> = {
    small: [2, 3],
    medium: [4, 6],
    large: [8, 12],
};

/** The size of a cluster jewel base, from the tag that marks it; undefined for any other base. */
function clusterSize(base: Base): ClusterSize | undefined {
    for (const size of ["small", "medium", "large"] as const) {
        if (base.tags.has(TagId(`expansion_jewel_${size}`))) return size;
    }
    return undefined;
}

/** Exact join iterations before widening kicks in (`widenPresence`): a small loop
 *  reaches a precise fixpoint first, a tall disjunction then gets over-approximated. */
const WIDEN_AFTER = 3;
/** Exact iterations of the numeric ranges before they are widened too
 *  (`widenRanges`). Widening the counts costs the after-state its totals, so
 *  it comes late: it is what makes the fixpoint terminate rather than stop
 *  short, not what a loop is meant to converge by. */
const WIDEN_RANGES_AFTER = 32;

/** How a statement leaves: with an item, or ending the path, by re-entering the
 *  enclosing loop (`restart`) or by ending the craft on this path (`stop`). */
type Flow =
    | { readonly kind: "fall"; readonly state: AItem }
    | { readonly kind: "restart" }
    | { readonly kind: "stop" };

/** A statement whose words name no method: a currency's name is the common
 *  case, so that is what the message calls it. */
function unknownOperation(words: readonly string[]): string {
    return words.length === 1
        ? `Unknown currency "${words[0]}".`
        : `Unknown operation "${words.join(" ")}".`;
}

function foldJoin(states: readonly AItem[]): AItem | null {
    return states.length === 0 ? null : states.reduce(join);
}

const isLive = (s: AItem | null): s is AItem => s !== null;

export function check(craft: Craft, ctx: CheckContext, tuning: CheckTuning = {}): CheckResult {
    return new Checker(ctx.registry, tuning.widenRangesAfter).run(craft);
}

class Checker {
    private readonly diagnostics: CheckDiagnostic[] = [];
    /** When > 0, suppress diagnostics, loop-invariant passes re-check the body
     *  and must not emit duplicates; only the final, real pass does. */
    private quiet = 0;
    private readonly trace: TraceEntry[] = [];
    /** One BDD manager per check, shared by all states so `presence` ids compare. */
    private readonly bdd = new BddManager();
    /** Local predicate defs. `valid: false` marks an ill-formed def whose calls
     *  are dropped without cascading errors. */
    private readonly defs = new Map<
        string,
        { def: Def; paramTypes: Map<string, ParamType>; valid: boolean }
    >();
    /** Local operation functions (`def name(p) { … }`); `valid: false` marks an
     *  ill-formed proc whose calls are dropped without cascading errors. */
    private readonly procs = new Map<
        string,
        { proc: ProcDef; paramTypes: Map<string, ParamType>; valid: boolean }
    >();
    /** Predicate defs currently being expanded, guards against (mutual)
     *  recursion; procs are checked statically instead (`recursiveProcs`). */
    private readonly expanding = new Set<string>();
    /** Where statements are recorded: the trace, or a call's own while its
     *  body runs, so hover sees a call as one step. */
    private sink: TraceEntry[] = this.trace;
    private readonly inlined = new WeakMap<Stmt, NonNullable<TraceEntry["inlined"]>>();
    /** Stack of `restart` back-edge collectors, innermost loop last. A `restart`
     *  re-enters the innermost enclosing loop, so its state is a loop-head state
     *  that must join into that loop's invariant. */
    private readonly restartHeads: AItem[][] = [];

    constructor(
        private readonly registry: Registry,
        private readonly widenRangesAfter = WIDEN_RANGES_AFTER,
    ) {}

    run(craft: Craft): CheckResult {
        this.collectDefs(craft.defs);
        this.collectProcs(craft.procs);
        const initial = this.elaborateItem(craft.item);
        if (initial === null) {
            return { ok: false, diagnostics: this.diagnostics, trace: this.trace };
        }
        this.trace.push({ span: craft.item.span, kind: "item", before: initial, after: initial });
        const flow = this.checkSeq(initial, craft.body);
        const result: CheckResult = {
            ok: this.diagnostics.length === 0,
            diagnostics: this.diagnostics,
            trace: this.trace,
            ...(flow.kind === "fall" && { finalState: flow.state }),
        };
        return result;
    }

    /** The defs collected and every condition resolved quietly (`predicateResolver`). */
    resolver(craft: Craft): (pred: Pred, a: AItem) => RPred | null {
        this.quietly(() => {
            this.collectDefs(craft.defs);
            this.collectProcs(craft.procs);
        });
        return (pred, a) => this.quietly(() => this.resolvePred(pred, a)?.pred ?? null);
    }

    private diag(message: string, span: CheckDiagnostic["span"]): void {
        if (this.quiet > 0) return;
        this.diagnostics.push({ message, span });
    }

    /** Run `fn` with diagnostics AND trace suppressed, a probe/fixpoint pass that
     *  must not emit duplicates or pollute the real trace. */
    private quietly<T>(fn: () => T): T {
        this.quiet++;
        try {
            return fn();
        } finally {
            this.quiet--;
        }
    }

    // --- item block → initial state ---------------------------------------

    private elaborateItem(item: ItemBlock): AItem | null {
        const baseRes = this.registry.resolveBase(item.base);
        if (!baseRes.ok) {
            this.diag(resolveMessage(baseRes.error), item.span);
            return null; // without a base no pool can be computed
        }
        let base = baseRes.value;
        // A cluster jewel's notables roll under its enchantment's tag (Cluster
        // jewel: the enchantment that determines what bonuses the passives
        // give decides which modifiers it can roll), so the enchant is read as
        // a tag of the base.
        const size = clusterSize(base);
        if (item.enchant !== undefined) {
            if (size === undefined) {
                this.diag("Only a cluster jewel has an enchant.", item.span);
            } else {
                const [lo, hi] = CLUSTER_PASSIVES[size];
                if (item.enchant.passives < lo || item.enchant.passives > hi) {
                    this.diag(
                        `A ${size} cluster jewel adds ${lo} to ${hi} passive skills, not ${item.enchant.passives}.`,
                        item.span,
                    );
                }
                const tag = this.registry.resolveClusterEnchant(item.enchant.text);
                if (!tag.ok) this.diag(resolveMessage(tag.error), item.span);
                else {
                    // An enchantment belongs to the jewels of one size, and so do
                    // its notables: read off the game's list of each size's
                    // small passives, not stated by the wiki (QUESTIONS.md Q98).
                    const sizes = this.registry.clusterSizesOf(tag.value);
                    if (sizes !== undefined && !sizes.has(size)) {
                        this.diag(
                            `A ${size} cluster jewel cannot have the "${item.enchant.text}" enchant — it is a ${[...sizes].join(" or ")} cluster jewel's.`,
                            item.span,
                        );
                    }
                    base = this.registry.enchantedBase(base, tag.value);
                }
            }
        } else if (size !== undefined) {
            this.diag(
                'A cluster jewel\'s modifiers depend on its enchant: add `enchant: <passives> "<stat>"`.',
                item.span,
            );
        }
        const present = new Set<TypeId>();
        // Named mods pin an exact tier so the starting item is fully concrete;
        // placeholders (`"random"`) stay anonymous.
        const pinned = new Map<TypeId, ModId>();
        // A named tier that two rows share, one under each of two influences.
        const oneOf = new Map<TypeId, Set<ModId>>();
        const fracturedTypes: TypeId[] = [];
        let fracturedAnonymous = 0;
        let crafted = 0;
        // An Astrolabe Amulet counts as having every influence (Influenced item §
        // Mechanics), so none is declared and all six are read.
        if (base.allInfluences && item.influences.length > 0) {
            this.diag(
                "This base has every influence by its implicit; leave `influences:` out.",
                item.span,
            );
        }
        const influences = base.allInfluences ? [...INFLUENCES] : item.influences;
        // The class must be one an influence can mark (a jewel or a flask is not).
        if (item.influences.length > 0 && INFLUENCE_STEMS[base.itemClass] === undefined) {
            this.diag(
                `${base.name ?? "This base"} is of a class that cannot be influenced — leave \`influences:\` out.`,
                item.span,
            );
        }
        // A declared influence's rows roll on the item, so they resolve and tier here.
        const tags = new Set(influences.flatMap((i) => [...this.registry.influenceTags(base, i)]));
        const ctx = { base, ilvl: item.ilvl, tags };

        const checkGen = (name: string, modGen: Gen | undefined, gen: Gen): void => {
            if (modGen !== undefined && modGen !== gen) {
                this.diag(`"${name}" is a ${modGen}, but it is listed under ${gen}es.`, item.span);
            }
        };

        // Two declared modifiers cannot share an item when they are the same
        // modifier or claim the same group (Modifier § Group/family).
        const claimed = new Map<GroupId, string>();
        const declaredAs = new Map<TypeId, string>();
        const claim = (name: string, type: TypeId): void => {
            const earlier = declaredAs.get(type);
            if (earlier !== undefined) {
                this.diag(
                    earlier === name
                        ? `"${name}" is declared twice; an item holds it once.`
                        : `"${name}" and "${earlier}" are tiers of one modifier; an item holds one of them.`,
                    item.span,
                );
                return;
            }
            declaredAs.set(type, name);
            for (const family of this.registry.familiesOfType(type)) {
                const other = claimed.get(family);
                if (other !== undefined) {
                    this.diag(
                        `"${name}" and "${other}" cannot both be on an item; they are modifiers of the same group.`,
                        item.span,
                    );
                    break;
                }
                claimed.set(family, name);
            }
            present.add(type);
        };

        // A named mod pins a tier via an exact id/alias, or a stat description
        // plus `t<n>`; a bare description is accepted only where a single tier of
        // the modifier rolls. Returns the resolved type (for the fractured
        // marker), or undefined when resolution failed.
        const craftedTypes = new Set<TypeId>();
        const pinAffix = (affix: AffixDecl, gen: Gen): TypeId | undefined => {
            const byId = this.registry.resolveMod(affix.mod);
            if (byId.ok) {
                const mod = byId.value;
                checkGen(affix.mod, mod.gen, gen);
                // A naturally rolled row must fit the base's domain; a row
                // another mechanic placed (bench, essence, unveiled, fossil) is
                // exempt (item-model.md §3). Its level may be above the item's:
                // an essence or a Harvest change leaves such a row.
                if ((mod.source ?? "natural") === "natural" && mod.domain !== base.domain) {
                    this.diag(`"${affix.mod}" cannot roll on a ${base.name ?? "item"}.`, item.span);
                }
                claim(affix.mod, mod.type);
                pinned.set(mod.type, mod.id);
                if (mod.source === "bench") {
                    crafted++;
                    craftedTypes.add(mod.type);
                }
                return mod.type;
            }
            const typeRes = this.registry.resolveModType(affix.mod, ctx);
            if (!typeRes.ok) {
                this.diag(resolveMessage(typeRes.error), item.span);
                return undefined;
            }
            const type = typeRes.value;
            checkGen(
                affix.mod,
                rollableGen(this.registry.catalog, base, item.ilvl, type, tags),
                gen,
            );
            // The number is the game's, counted over the whole ladder. A tier
            // above the item's level is taken as declared: an essence places
            // its row whatever the level, and a Harvest change keeps the tier.
            const ladders = tierLadders(this.registry.catalog, base, type, tags);
            const count = tierCount(ladders);
            const rolls = (m: Mod): boolean => m.minLevel <= item.ilvl;
            const reachable: number[] = [];
            for (let n = 1; n <= count; n++) {
                if (tierRows(ladders, n).some(rolls)) reachable.push(n);
            }
            // Unnamed, it is the one tier the item's level rolls, or the
            // modifier's only tier.
            const single = reachable.length === 1 ? reachable[0] : count === 1 ? 1 : undefined;
            if (affix.tier === undefined && single === undefined && count > 0) {
                const why =
                    reachable.length > 1
                        ? `${reachable.length} roll at this item level`
                        : `none of its ${count} rolls at this item level`;
                this.diag(
                    `declare the tier of "${affix.mod}" (e.g. \`"${affix.mod}" t${reachable[0] ?? count}\`), a starting item's mods must name a specific tier and ${why}.`,
                    item.span,
                );
                claim(affix.mod, type); // still present, just untiered
                return type;
            }
            const tier = affix.tier ?? single ?? 1;
            const atTier = this.rowsAt(ladders, tier, affix.mod);
            if (atTier.length === 0) {
                this.diag(
                    `tier ${tier} is out of range for "${affix.mod}" (it has ${count} ${plural(count, "tier")} on this base).`,
                    item.span,
                );
                claim(affix.mod, type);
                return type;
            }
            // Two influences may each have a row at the tier, and which the
            // item holds is not said. A tier read off the item's level is a
            // row that level rolls.
            const rolled = affix.tier === undefined ? atTier.filter(rolls) : [];
            const rows = rolled.length > 0 ? rolled : atTier;
            claim(affix.mod, type);
            if (rows.length === 1) pinned.set(type, rows[0]!.id);
            else oneOf.set(type, new Set(rows.map((m) => m.id)));
            return type;
        };

        // A bench affix is the bench's row for the item's class, named by the
        // modifier the bench adds; anonymous, it is one of the bench's rows of its
        // side, counted toward the crafted limit all the same.
        const pinCrafted = (affix: AffixDecl, gen: Gen): TypeId | undefined => {
            const res = this.registry.resolveBench(affix.mod, base.itemClass, affix.tier);
            if (!res.ok) {
                this.diag(resolveMessage(res.error), item.span);
                return undefined;
            }
            const mod = this.registry.resolveMod(res.value.mod);
            if (!mod.ok) return undefined;
            checkGen(affix.mod, mod.value.gen, gen);
            craftedTypes.add(mod.value.type);
            claim(affix.mod, mod.value.type);
            pinned.set(mod.value.type, mod.value.id);
            crafted++;
            return mod.value.type;
        };

        const anonymousBy = { prefix: 0, suffix: 0 };
        const craftedAnonymousBy = { prefix: 0, suffix: 0 };
        const countAffixes = (affixes: readonly AffixDecl[], gen: Gen): number => {
            for (const affix of affixes) {
                const anonymous = PLACEHOLDERS.test(affix.mod.trim().toLowerCase());
                if (anonymous && affix.bench) {
                    craftedAnonymousBy[gen]++;
                    crafted++;
                } else if (anonymous) anonymousBy[gen]++;
                const type = anonymous
                    ? undefined
                    : affix.bench
                      ? pinCrafted(affix, gen)
                      : pinAffix(affix, gen);
                if (!affix.fractured) continue;
                if (type !== undefined) fracturedTypes.push(type);
                else if (anonymous) fracturedAnonymous++; // a lock on a mod no type is known to carry
            }
            return affixes.length;
        };

        let prefixCount = countAffixes(item.prefixes, "prefix");
        let suffixCount = countAffixes(item.suffixes, "suffix");

        if (item.rarity === "rare" && !canBeRare(base)) {
            this.diag(
                `a ${base.name ?? "flask"} cannot be Rare; its kind of item is Magic at most`,
                item.span,
            );
        }

        const pCap = sideCap("prefix", item.rarity, base);
        const sCap = sideCap("suffix", item.rarity, base);
        if (prefixCount > pCap) {
            this.diag(
                `too many prefixes for a ${item.rarity} ${base.name ?? "item"}: ${prefixCount} (max ${pCap})`,
                item.span,
            );
            prefixCount = pCap;
        }
        if (suffixCount > sCap) {
            this.diag(
                `too many suffixes for a ${item.rarity} ${base.name ?? "item"}: ${suffixCount} (max ${sCap})`,
                item.span,
            );
            suffixCount = sCap;
        }
        // The two sides together are held to the rarity's total, which a
        // +delta side cap can exceed (a magic Ratcheting Ring holds two suffixes).
        const tCap = maxTotal(item.rarity, base);
        if (prefixCount + suffixCount > tCap) {
            this.diag(
                `too many modifiers for a ${item.rarity} ${base.name ?? "item"}: ${prefixCount + suffixCount} (max ${tCap})`,
                item.span,
            );
            suffixCount = Math.max(0, Math.min(suffixCount, tCap - prefixCount));
            prefixCount = Math.min(prefixCount, tCap - suffixCount);
        }

        // A declared implicit's wording names which implicit it is.
        const implicitTypes = (
            side: EldritchSide,
            decl: EldritchDecl | undefined,
        ): ReadonlySet<TypeId> | undefined => {
            if (decl?.text === undefined) return undefined;
            const types = this.registry.resolveEldritch(decl.text, side, base);
            if (!types.ok) {
                this.diag(resolveMessage(types.error), item.span);
                return undefined;
            }
            return new Set(types.value);
        };
        const exarchTypes = implicitTypes("exarch", item.exarch);
        const eaterTypes = implicitTypes("eater", item.eater);
        if (item.strands !== undefined && (item.strands < 0 || item.strands > MAX_STRANDS)) {
            this.diag(
                `An item holds 0 to ${MAX_STRANDS} memory strands, not ${item.strands}.`,
                item.span,
            );
        }

        // An influenced item cannot be fractured (Influenced item § Mechanics)
        // nor carry an eldritch implicit (Eldritch implicit modifier).
        if (influences.length > 0 && (item.exarch !== undefined || item.eater !== undefined)) {
            this.diag("An influenced item cannot have an eldritch implicit.", item.span);
        }
        if ((item.exarch !== undefined || item.eater !== undefined) && !canHaveEldritch(base)) {
            this.diag(
                "Only a body armour, boots, gloves, a helmet or an amulet can have an eldritch implicit.",
                item.span,
            );
        }
        if (isEldritchAmulet(base)) {
            if (item.exarch !== undefined && item.eater !== undefined) {
                this.diag(
                    "An amulet has one eldritch implicit, the Searing Exarch's or the Eater of Worlds', not both.",
                    item.span,
                );
            }
            for (const decl of [item.exarch, item.eater]) {
                if (decl !== undefined && eldritchTierOf(decl.tier) > AMULET_ELDRITCH_TOP_TIER) {
                    this.diag(
                        `An amulet's eldritch implicit is Lesser to ${eldritchTierLabel(AMULET_ELDRITCH_TOP_TIER)}, not ${eldritchTierLabel(eldritchTierOf(decl.tier))}.`,
                        item.span,
                    );
                }
            }
        }
        if (
            (item.exarch !== undefined || item.eater !== undefined) &&
            item.ilvl < ELDRITCH_ITEM_LEVEL
        ) {
            this.diag(
                `An eldritch implicit needs item level ${ELDRITCH_ITEM_LEVEL} or more — this item is item level ${item.ilvl}.`,
                item.span,
            );
        }
        if (influences.length > 0 && fracturedTypes.length + fracturedAnonymous > 0) {
            this.diag("An influenced item cannot have a fractured modifier.", item.span);
        }
        // An anonymous bench affix is some bench row of its side.
        for (const gen of ["prefix", "suffix"] as const) {
            if (craftedAnonymousBy[gen] === 0) continue;
            for (const t of this.registry.benchTypesFor(base.itemClass)) {
                if (this.registry.genOfType(t) === gen) craftedTypes.add(t);
            }
        }
        const start = initialState(
            this.bdd,
            base,
            item.ilvl,
            item.rarity,
            {
                prefixCount,
                suffixCount,
                present,
                pinned,
                crafted,
                craftedTypes,
                ...(fracturedTypes.length > 0 && { fractured: fracturedTypes }),
                ...(fracturedAnonymous > 0 && { fracturedAnonymous }),
            },
            {
                influences,
                corrupted: item.corrupted,
                ...(item.exarch !== undefined && { exarch: eldritchTierOf(item.exarch.tier) }),
                ...(item.eater !== undefined && { eater: eldritchTierOf(item.eater.tier) }),
                ...(exarchTypes !== undefined && { exarchTypes }),
                ...(eaterTypes !== undefined && { eaterTypes }),
                ...(item.strands !== undefined && {
                    strands: Math.max(0, Math.min(MAX_STRANDS, item.strands)),
                }),
            },
        );
        // An anonymous affix is some modifier of its side the item could roll, so
        // a `has` may name it and a bench craft of its group may clash with it.
        const possible = new Set([...start.possible, ...start.craftedTypes]);
        // It is a natural roll, so its type is held to the natural rows: an
        // unveiled or bench row sharing the type is on the item only when the
        // block says so. A type an anonymous bench affix may be stays any row.
        const natural = new Map<TypeId, Set<ModId>>();
        for (const gen of ["prefix", "suffix"] as const) {
            if (anonymousBy[gen] === 0) continue;
            for (const m of anonymousRows(start, this.registry, gen)) {
                possible.add(m.type);
                const rows = natural.get(m.type);
                if (rows) rows.add(m.id);
                else natural.set(m.type, new Set([m.id]));
            }
        }
        const tiers = new Map<TypeId, ReadonlySet<ModId>>([...start.tiers, ...oneOf]);
        for (const [type, rows] of natural) {
            if (!start.possible.has(type) && !start.craftedTypes.has(type)) tiers.set(type, rows);
        }
        return { ...start, possible, tiers };
    }

    // --- statement sequencing ---------------------------------------------

    private checkSeq(entry: AItem, stmts: readonly Stmt[]): Flow {
        let state = entry;
        for (const stmt of stmts) {
            const before = state;
            const flow = this.checkStmt(before, stmt);
            // Only the real (non-quiet) pass records, so each statement appears once.
            if (this.quiet === 0) {
                const inlined = this.inlined.get(stmt);
                this.sink.push({
                    span: stmt.span,
                    kind: stmt.kind,
                    ...(this.sink !== this.trace && { stmt }),
                    before,
                    ...(flow.kind === "fall" && { after: flow.state }),
                    ...(inlined !== undefined && { inlined }),
                });
            }
            if (flow.kind !== "fall") return flow;
            state = flow.state;
        }
        return { kind: "fall", state };
    }

    private checkStmt(a: AItem, stmt: Stmt): Flow {
        switch (stmt.kind) {
            case "operation":
                return this.checkOperation(a, stmt);
            case "restart": {
                // The loop invariant must fold in this back-edge: a `restart`
                // after an additive op can fill the item the same way falling off
                // the body end can.
                const frame = this.restartHeads[this.restartHeads.length - 1];
                if (frame !== undefined) frame.push(a);
                return { kind: "restart" };
            }
            case "stop":
                return { kind: "stop" };
            case "until":
                return this.checkUntil(a, stmt);
            case "if":
                return this.checkIf(a, stmt);
            case "call":
                return this.checkCall(a, stmt);
            case "paramStep":
                // Inlining splices the bound steps in; one left standing was
                // never bound (the proc's own error was reported).
                this.diag(`parameter "${stmt.param}" was never given a value`, stmt.span);
                return { kind: "fall", state: a };
        }
    }

    // --- operations --------------------------------------------------------

    /** Look the method up, bind its arguments, build its operations and run them.
     *  An unknown method, or one the catalog cannot build, leaves the state as it
     *  was; one whose check fails continues from the state it would have left. */
    private checkOperation(a: AItem, stmt: Extract<Stmt, { kind: "operation" }>): Flow {
        const method = findMethod(stmt.words);
        if (method === undefined) {
            this.diag(unknownOperation(stmt.words), stmt.span);
            return { kind: "fall", state: a };
        }
        const literals: Literal[] = [];
        for (const arg of stmt.args) {
            if (arg.kind === "param") {
                this.diag(`parameter "${arg.param}" was never given a value`, stmt.span);
                return { kind: "fall", state: a };
            }
            literals.push(arg);
        }
        const built = method.build(literals, a, this.registry);
        if ("refused" in built) {
            this.diag(built.refused, stmt.span);
            return { kind: "fall", state: a };
        }
        const result = runMethod(a, built, this.registry);
        if (!result.ok) {
            const carriers = (result.under ?? []).map((t) => `"${this.registry.typeLabel(t)}"`);
            const where =
                carriers.length > 0
                    ? `\nThis is so where the item has ${carriers.join(" and ")}, which it may have here — settle it with an 'if has' first.`
                    : "";
            this.diag(preconditionMessage(a, result.failure) + where, stmt.span);
        }
        // A method that leaves no item on any outcome ends the path, as `stop` does.
        return result.ended ? { kind: "stop" } : { kind: "fall", state: result.state };
    }

    // --- narrowing (if / else) --------------------------------------------

    private checkIf(a: AItem, stmt: Extract<Stmt, { kind: "if" }>): Flow {
        const resolved = this.resolvePred(stmt.pred, a);
        const rpred = resolved?.pred ?? null;

        // A narrowed count may leave a proven "≥k of these suffixes" below the
        // suffix count's new floor, so the presence facts are pushed back in.
        const narrow = (positive: boolean): AItem | null => {
            if (rpred === null) return a;
            const s = refine(a, rpred, positive);
            return s === null ? null : this.tightenCounts(s);
        };
        const thenState = narrow(true);
        const elseState = narrow(false);

        if (thenState === null) {
            this.diag(
                `the 'if' branch can never run: ${describePred(stmt.pred)} is impossible here${levelReasons(resolved, a)}`,
                stmt.pred.span,
            );
        }
        if (elseState === null && stmt.elseBody !== undefined) {
            this.diag(
                `the 'else' branch can never run: ${describePred(stmt.pred)} always holds here`,
                stmt.pred.span,
            );
        }

        const falls: AItem[] = [];
        // An arm that ends the path contributes nothing to the join; when no arm
        // falls through, the statement ends the path as its arms did (a restart
        // over a stop, since the loop is re-entered on that arm).
        let ended: Flow | null = null;
        const arm = (state: AItem, body: readonly Stmt[]): void => {
            const f = this.checkSeq(state, body);
            if (f.kind === "fall") falls.push(f.state);
            else if (ended === null || f.kind === "restart") ended = f;
        };
        if (thenState !== null) arm(thenState, stmt.body);
        if (elseState !== null) arm(elseState, stmt.elseBody ?? []);

        if (falls.length === 0) return ended ?? { kind: "fall", state: a };
        return { kind: "fall", state: this.tightenCounts(falls.reduce(join)) };
    }

    // --- loops (until) -----------------------------------------------------

    private checkUntil(a: AItem, stmt: Extract<Stmt, { kind: "until" }>): Flow {
        const resolved = this.resolvePred(stmt.pred, a);
        const rpred = resolved?.pred ?? null;

        // Compute the loop invariant (a quiet join-fixpoint) and probe the exit
        // from it, quietly: a loop that needs several iterations to reach its
        // goal (two annuls from a full item to two open slots) is only
        // unsatisfiable when no head state of the whole invariant satisfies the
        // predicate. Report that root cause instead of a downstream symptom.
        const invariant = this.loopInvariant(a, stmt.body, rpred);
        // The body runs only where the exit predicate is false; a head state that
        // already satisfies it leaves at once. An inner loop entered from an outer
        // loop's joined invariant would otherwise run its body on states no path
        // continues from.
        const entering = this.continuing(invariant, rpred);
        if (entering === null) {
            this.diag(
                `this loop's body never runs: ${describePred(stmt.pred)} already holds here`,
                stmt.pred.span,
            );
            return { kind: "fall", state: a };
        }
        // The states at the head are the entry and the body's results, so the
        // exits are the entry where it already satisfies the predicate and those
        // results where they do; the joined invariant would blur the two.
        const leaving = rpred === null ? null : refine(a, rpred, true);
        const exits = (heads: readonly AItem[]): AItem | null =>
            foldJoin([...(leaving ? [leaving] : []), ...this.refineHeads(heads, rpred, true)]);
        const probe = this.quietly(() => this.headStates(entering, stmt.body));
        const exitReachable = exits(probe);
        if (rpred !== null && exitReachable === null) {
            this.diag(
                `this loop can never exit: ${describePred(stmt.pred)} can never become true here${levelReasons(resolved, invariant)}`,
                stmt.pred.span,
            );
            return { kind: "fall", state: foldJoin(probe) ?? invariant };
        }

        // Then run the body once more FROM the invariant, the real pass that
        // emits the loop's diagnostics and trace, and catches a precondition that
        // only fails on a later iteration (`until has X { exalt }` eventually fills
        // the item). On exit the exit predicate is known to hold: the after-state
        // is the join of every loop-head state refined by it.
        const exit = exits(this.headStates(entering, stmt.body));
        return { kind: "fall", state: this.tightenCounts(exit ?? invariant) };
    }

    /** Run a loop body while collecting the states of any `restart` inside it
     *  (back-edges to this loop's head). */
    private runBody(entry: AItem, body: readonly Stmt[]): { flow: Flow; restarts: AItem[] } {
        const frame: AItem[] = [];
        this.restartHeads.push(frame);
        try {
            return { flow: this.checkSeq(entry, body), restarts: frame };
        } finally {
            this.restartHeads.pop();
        }
    }

    /** Run the body once from `entry` and return every state that re-enters the
     *  loop head: the fall-off-end state (when the body falls through) plus every
     *  `restart` back-edge collected inside it. */
    private headStates(entry: AItem, body: readonly Stmt[]): AItem[] {
        const { flow, restarts } = this.runBody(entry, body);
        return flow.kind === "fall" ? [flow.state, ...restarts] : restarts;
    }

    /** The part of a loop-head state that runs the body: where the exit predicate
     *  is false, or all of it while the predicate did not resolve. */
    private continuing(head: AItem, rpred: RPred | null): AItem | null {
        return rpred === null ? head : refine(head, rpred, false);
    }

    private refineHeads(states: readonly AItem[], rpred: RPred | null, positive: boolean): AItem[] {
        return states.map((h) => (rpred === null ? h : refine(h, rpred, positive))).filter(isLive);
    }

    /**
     * Push presence knowledge into the count ranges: a proven "≥k of {types}"
     * where all those types sit in one generation forces that generation's count
     * ≥ k (and guaranteed types each count for one). A disjunction of resistance
     * suffixes therefore pins the suffix count, and, via the total coupling, the
     * prefix count, where the presence BDD alone left it a range. A sound
     * tightening: it only ever removes a spurious slot, never adds one.
     */
    private tightenCounts(a: AItem): AItem {
        const genOf = (t: TypeId): Gen =>
            rollableGen(this.registry.catalog, a.base, a.ilvl, t, this.tagsOf(a)) ?? "prefix";
        const guaranteed = guaranteedTypes(a);
        const cards = cardinalityGuarantees(a);
        const minFor = (gen: Gen): number => {
            let n = 0;
            for (const t of guaranteed) if (genOf(t) === gen) n++;
            for (const c of cards) if (c.types.every((t) => genOf(t) === gen)) n += c.atLeast;
            return n;
        };
        let s: AItem | null = a;
        const minS = minFor("suffix");
        if (minS > 0) s = refine(s, cmpAtLeast("suffixCount", minS));
        if (s !== null) {
            const minP = minFor("prefix");
            if (minP > 0) s = refine(s, cmpAtLeast("prefixCount", minP));
        }
        return s === null ? a : this.dropUnnamed(s);
    }

    /**
     * The reduction the other way: a side whose count the guaranteed types fill
     * carries no other modifier, so every other type that sits only on that
     * side leaves `possible`. After `until prefixCount == 1` on an item whose
     * one named prefix is sure, the prefixes a reforge might have rolled are
     * gone for good, and a later bench craft of their group is not refused for
     * them.
     */
    private dropUnnamed(a: AItem): AItem {
        const guaranteed = guaranteedTypes(a);
        const onlyOn = (t: TypeId, gen: Gen): boolean => {
            const sides = this.registry.sidesOfType(t);
            return sides.size === 1 && sides.has(gen);
        };
        const full = (["prefix", "suffix"] as const).filter((gen) => {
            let named = 0;
            for (const t of guaranteed) if (onlyOn(t, gen)) named++;
            const max = gen === "prefix" ? a.counts.prefix[1] : suffixRange(a)[1];
            return max <= named;
        });
        if (full.length === 0) return a;
        const possible = new Set(a.possible);
        for (const t of a.possible) {
            if (guaranteed.has(t)) continue;
            if (full.some((gen) => onlyOn(t, gen))) possible.delete(t);
        }
        if (possible.size === a.possible.size) return a;
        const tiers = new Map([...a.tiers].filter(([t]) => possible.has(t)));
        const values = new Map([...a.values].filter(([t]) => possible.has(t)));
        return { ...a, possible, tiers, values };
    }

    /**
     * The loop invariant: the least state (by join) covering the entry and every
     * "continue" state (a back-edge whose exit predicate is still false). The
     * lattice is finite and the iteration monotone, so this converges quickly;
     * widening past a few exact iterations bounds the tall disjunctive part.
     * The loop ends only at a fixpoint, never at a round count: an invariant
     * short of it would leave later rounds of the body unchecked. Each join
     * only grows the state, the sets it grows are finite, and past
     * `WIDEN_RANGES_AFTER` a range that still moves jumps to its bound, so a
     * fixpoint is always reached.
     */
    private loopInvariant(entry: AItem, body: readonly Stmt[], rpred: RPred | null): AItem {
        return this.quietly(() => {
            let invariant = entry;
            for (let i = 0; ; i++) {
                const entering = this.continuing(invariant, rpred);
                if (entering === null) break; // every head state leaves at once
                const continues = this.refineHeads(this.headStates(entering, body), rpred, false);
                if (continues.length === 0) break;
                const joined = [invariant, ...continues].reduce(join);
                const widened = i >= WIDEN_AFTER ? widenPresence(joined) : joined;
                const next = i >= this.widenRangesAfter ? widenRanges(invariant, widened) : widened;
                if (stateEqual(next, invariant)) break;
                invariant = next;
            }
            return invariant;
        });
    }

    // --- predicate defs ----------------------------------------------------

    private collectDefs(defs: readonly Def[]): void {
        for (const def of defs) {
            if (this.defs.has(def.name)) {
                this.diag(`duplicate def "${def.name}"`, def.span);
                continue;
            }
            const { types, conflicts, used } = inferParamTypes(def);
            for (const c of conflicts) {
                const ways = c.sorts.map((s) => SORT_LABEL[s]).join(" and as ");
                this.diag(
                    `parameter "${c.param}" of "${def.name}" is used in conflicting ways (as ${ways})`,
                    def.span,
                );
            }
            for (const p of def.params) {
                if (!used.has(p)) {
                    this.diag(`parameter "${p}" of "${def.name}" is never used`, def.span);
                }
            }
            this.defs.set(def.name, { def, paramTypes: types, valid: conflicts.length === 0 });
        }
    }

    /** Procs share the name space with predicate defs, a name can't be both. */
    private collectProcs(procs: readonly ProcDef[]): void {
        for (const proc of procs) {
            if (this.defs.has(proc.name) || this.procs.has(proc.name)) {
                this.diag(`duplicate def "${proc.name}"`, proc.span);
                continue;
            }
            const { types, conflicts, used } = inferProcParamTypes(proc);
            for (const c of conflicts) {
                const ways = c.sorts.map((s) => SORT_LABEL[s]).join(" and as ");
                this.diag(
                    `parameter "${c.param}" of "${proc.name}" is used in conflicting ways (as ${ways})`,
                    proc.span,
                );
            }
            for (const p of proc.params) {
                if (!used.has(p)) {
                    this.diag(`parameter "${p}" of "${proc.name}" is never used`, proc.span);
                }
            }
            this.procs.set(proc.name, { proc, paramTypes: types, valid: conflicts.length === 0 });
        }
        // Recursion is decided on the definitions, not while inlining: a step
        // argument may legitimately call the very proc it is passed to
        // (`twice(twice({ chaos }))`), which an expansion-time guard would refuse.
        for (const name of recursiveProcs(this.procs)) {
            const entry = this.procs.get(name)!;
            this.diag(`recursive def "${name}" is not allowed`, entry.proc.span);
            this.procs.set(name, { ...entry, valid: false });
        }
    }

    /** Inlining lets a `restart` inside the body re-enter the caller's enclosing
     *  loop, so the body composes exactly as if written in place. The call site
     *  is traced as one step; the body's own trace hangs off it. */
    private checkCall(a: AItem, stmt: Extract<Stmt, { kind: "call" }>): Flow {
        const entry = this.procs.get(stmt.name);
        if (!entry) {
            if (this.defs.has(stmt.name)) {
                this.diag(
                    `"${stmt.name}" is a condition, use it inside 'if' or 'until', not as a step`,
                    stmt.span,
                );
            } else {
                this.diag(`unknown def "${stmt.name}"`, stmt.span);
            }
            return { kind: "fall", state: a };
        }
        const { proc, paramTypes, valid } = entry;
        if (!valid) return { kind: "fall", state: a }; // the proc's own error was reported
        const env = this.bindArgs(stmt.name, proc.params, paramTypes, stmt.args, stmt.span);
        if (env === null) return { kind: "fall", state: a };

        const body = substituteStmts(proc.body, env);
        const trace: TraceEntry[] = [];
        const outer = this.sink;
        this.sink = trace;
        try {
            return this.checkSeq(a, body);
        } finally {
            this.sink = outer;
            this.inlined.set(stmt, { body, trace });
        }
    }

    /** Bind call arguments to parameters, checking arity and each arg's sort.
     *  Returns the environment, or `null` if any check failed (already reported). */
    private bindArgs(
        callName: string,
        params: readonly string[],
        paramTypes: Map<string, ParamType>,
        args: readonly Arg[],
        span: SourceSpan,
    ): Map<string, Arg> | null {
        if (args.length !== params.length) {
            const n = params.length;
            this.diag(
                `"${callName}" expects ${n} ${plural(n, "argument")}, got ${args.length}`,
                span,
            );
            return null;
        }
        const env = new Map<string, Arg>();
        let bad = false;
        params.forEach((p, i) => {
            const arg = args[i]!;
            const want = paramTypes.get(p);
            // A param with no inferred sort is a pass-through: any arg kind is
            // accepted here and re-checked at the callee.
            if (want !== undefined && arg.kind !== WANT_KIND[want]) {
                this.diag(
                    `argument ${i + 1} of "${callName}" should be ${WANT_LABEL[want]}`,
                    arg.span,
                );
                bad = true;
            }
            env.set(p, arg);
        });
        return bad ? null : env;
    }

    // --- predicate resolution ---------------------------------------------

    /** A named tier the item's level stops short of. It is no error: an
     *  essence or a Harvest change places such a row, a currency never rolls it. */
    private aboveLevel(
        type: TypeId,
        tier: number,
        name: string,
        rows: readonly Mod[],
        a: AItem,
    ): readonly AboveLevel[] {
        const above = (m: Mod): boolean =>
            (m.source ?? "natural") === "natural" && m.minLevel > a.ilvl;
        if (rows.length === 0 || !rows.every(above)) return [];
        const needs = Math.min(...rows.map((m) => m.minLevel));
        return [
            {
                type,
                reason: `Tier ${tier} "${name}" needs item level ${needs}; this item is level ${a.ilvl}`,
            },
        ];
    }

    private resolvePred(pred: Pred, a: AItem): Resolved | null {
        switch (pred.kind) {
            case "isRarity":
                return plain({ kind: "isRarity", rarity: pred.rarity });
            case "influenced":
                return plain(
                    pred.influence === undefined
                        ? { kind: "influenced" }
                        : { kind: "influenced", influence: pred.influence },
                );
            case "corrupted":
                return plain({ kind: "corrupted" });
            case "eldritch": {
                let types: ReadonlySet<TypeId> | undefined;
                if (pred.text !== undefined) {
                    const found = this.registry.resolveEldritch(pred.text, pred.side, a.base);
                    if (!found.ok) {
                        this.diag(resolveMessage(found.error), pred.span);
                        return null;
                    }
                    types = new Set(found.value);
                }
                return plain({
                    kind: "eldritch",
                    side: pred.side,
                    ...(pred.tier !== undefined && { tier: eldritchTierOf(pred.tier) }),
                    ...(types !== undefined && { types }),
                });
            }
            case "dominant":
                return plain({ kind: "dominant", side: pred.side });
            case "compare": {
                const value = this.literalInt(pred.value, pred.span);
                return value === null
                    ? null
                    : plain({ kind: "compare", projection: pred.projection, op: pred.op, value });
            }
            case "not": {
                // A tier the condition wants absent is no reason it cannot be met.
                const inner = this.resolvePred(pred.inner, a);
                return inner === null ? null : plain({ kind: "not", inner: inner.pred });
            }
            case "and":
            case "or": {
                // An unresolvable sub-predicate (already reported) skips narrowing
                // entirely rather than narrow by a half-understood condition.
                const left = this.resolvePred(pred.left, a);
                const right = this.resolvePred(pred.right, a);
                if (left === null || right === null) return null;
                return {
                    pred: { kind: pred.kind, left: left.pred, right: right.pred },
                    aboveLevel: [...left.aboveLevel, ...right.aboveLevel],
                };
            }
            case "has":
                return this.resolveHas(pred, a);
            case "fractured": {
                const fractured = this.resolveFractured(pred, a);
                return fractured === null ? null : plain(fractured);
            }
            case "call":
                return this.resolveCall(pred, a);
        }
    }

    private resolveFractured(pred: Extract<Pred, { kind: "fractured" }>, a: AItem): RPred | null {
        const modName = this.literalString(pred.mod, pred.span);
        if (modName === null) return null;
        const typeRes = this.registry.resolveModType(modName, this.modContext(a));
        if (!typeRes.ok) {
            this.diag(resolveMessage(typeRes.error), pred.span);
            return null;
        }
        return { kind: "fractured", type: typeRes.value };
    }

    /** The influence tags the item carries on any path: a predicate names what
     *  the item may have, so its influence rows resolve and tier here. */
    private tagsOf(a: AItem): ReadonlySet<TagId> {
        return influenceTagsAny(a, this.registry);
    }

    /** The rows at a tier that a name means: where modifiers that share the
     *  type share the tier, the one the name words. */
    private rowsAt(ladders: TierLadders, tier: number, name: string): readonly Mod[] {
        return tierRows(ladders, tier, (rows) => this.registry.rowsNamed(name, rows));
    }

    /**
     * The rows a name without a tier means, where it words one of the
     * modifiers that share the type and a tier on this item: every row of the
     * type that reads so, a bench craft's or a fossil's among them. Undefined
     * for a name that means the type whole.
     */
    private rowsOnly(name: string, type: TypeId, a: AItem): readonly Mod[] | undefined {
        const ladders = tierLadders(this.registry.catalog, a.base, type, this.tagsOf(a));
        let apart = false;
        for (let n = 1; n <= tierCount(ladders) && !apart; n++) {
            apart = this.rowsAt(ladders, n, name).length < tierRows(ladders, n).length;
        }
        if (!apart) return undefined;
        return this.registry.rowsNamed(
            name,
            this.registry.catalog.filter((m) => m.type === type),
        );
    }

    private modContext(a: AItem): ModTypeContext {
        return { base: a.base, ilvl: a.ilvl, tags: this.tagsOf(a) };
    }

    private resolveCall(pred: Extract<Pred, { kind: "call" }>, a: AItem): Resolved | null {
        const entry = this.defs.get(pred.name);
        if (!entry) {
            if (this.procs.has(pred.name)) {
                this.diag(
                    `"${pred.name}" runs operations, use it as a step, not inside a condition`,
                    pred.span,
                );
            } else {
                this.diag(`unknown def "${pred.name}"`, pred.span);
            }
            return null;
        }
        const { def, paramTypes, valid } = entry;
        if (!valid) return null; // the def's own error was already reported
        if (this.expanding.has(pred.name)) {
            this.diag(`recursive def "${pred.name}" is not allowed`, pred.span);
            return null;
        }
        const env = this.bindArgs(pred.name, def.params, paramTypes, pred.args, pred.span);
        if (env === null) return null;

        const body = substitute(def.body, env);
        this.expanding.add(pred.name);
        const resolved = this.resolvePred(body, a);
        this.expanding.delete(pred.name);
        return resolved;
    }

    private resolveHas(pred: Extract<Pred, { kind: "has" }>, a: AItem): Resolved | null {
        const modName = this.literalString(pred.mod, pred.span);
        if (modName === null) return null;
        const tags = this.tagsOf(a);
        const typeRes = this.registry.resolveModType(modName, { base: a.base, ilvl: a.ilvl, tags });
        if (!typeRes.ok) {
            this.diag(resolveMessage(typeRes.error), pred.span);
            return null;
        }
        const type = typeRes.value;
        if (pred.group)
            return plain({ kind: "hasGroup", type, types: this.registry.groupOf(type) });
        const gen = rollableGen(this.registry.catalog, a.base, a.ilvl, type, tags) ?? "prefix";

        if (pred.value !== undefined) {
            // Any row of the type the item may carry may be the one on it: a row an
            // operation has pinned, a row an essence grants its class (whatever its
            // spawn weight on the base), a natural row that rolls on the base at some
            // level, under a tag a present modifier may add too, a bench row its
            // class takes, an unveiled or otherwise placed row.
            const pinned = a.tiers.get(type);
            const influence = influenceTagsOf(a, this.registry);
            const itemTags = new Set([...a.base.tags, ...influence.sure]);
            const maybeTags = new Set<TagId>(influence.maybe);
            for (const t of a.possible) {
                if (isExcluded(a, t)) continue;
                for (const tag of this.registry.addsTagsOfType(t)) maybeTags.add(tag);
            }
            const benchTypes = this.registry.benchTypesFor(a.base.itemClass);
            const granted = new Set<ModId>();
            for (const e of this.registry.essences) {
                const id = e.grants.get(a.base.itemClass);
                if (id !== undefined) granted.add(id);
            }
            const mayCarry = (m: Mod): boolean => {
                if (pinned?.has(m.id) || granted.has(m.id)) return true;
                switch (m.source ?? "natural") {
                    case "natural": {
                        const weight = lookupWeight(m, itemTags, maybeTags);
                        return m.domain === a.base.domain && weight !== null && weight > 0;
                    }
                    case "bench":
                        return benchTypes.has(m.type);
                    case "essence":
                        return false;
                    default:
                        return true;
                }
            };
            const rows = new Map<ModId, Range>();
            const unnumbered = new Set<ModId>();
            let aboveLevel: readonly AboveLevel[] = [];
            for (const m of this.registry.catalog) {
                if (m.type !== type || !mayCarry(m)) continue;
                const span = m.text === undefined ? undefined : rollRange(m.text);
                if (span !== undefined) rows.set(m.id, span);
                else unnumbered.add(m.id);
            }
            if (pred.tier !== undefined) {
                const tier = this.literalInt(pred.tier, pred.span);
                if (tier === null) return null;
                const ladders = tierLadders(this.registry.catalog, a.base, type, tags);
                const atTier = this.rowsAt(ladders, tier, modName).filter((m) => rows.has(m.id));
                if (atTier.length === 0) {
                    this.diag(
                        `tier ${tier} of "${modName}" has no value to compare here`,
                        pred.span,
                    );
                    return null;
                }
                aboveLevel = this.aboveLevel(type, tier, modName, atTier, a);
                const named = new Set(atTier.map((m) => m.id));
                for (const id of [...rows.keys()]) if (!named.has(id)) rows.delete(id);
                unnumbered.clear();
            }
            const only = pred.tier === undefined ? this.rowsOnly(modName, type, a) : undefined;
            if (only !== undefined) {
                const ids = new Set(only.map((m) => m.id));
                for (const id of [...rows.keys()]) if (!ids.has(id)) rows.delete(id);
                for (const id of [...unnumbered]) if (!ids.has(id)) unnumbered.delete(id);
            }
            if (rows.size === 0) {
                this.diag(`"${modName}" has no number to compare`, pred.span);
                return null;
            }
            return {
                pred: {
                    kind: "hasValue",
                    type,
                    gen,
                    op: pred.value.op,
                    value: pred.value.value,
                    rows,
                    unnumbered,
                    ...((pred.tier !== undefined || only !== undefined) && {
                        oneTier: true as const,
                    }),
                },
                aboveLevel,
            };
        }

        // Two influences may each have a row at a tier, and a name may mean
        // several rows of the type: the condition holds when the item has any.
        const at = (mod: Mod): RPred => {
            const tierSpan = mod.text === undefined ? undefined : rollRange(mod.text);
            return {
                kind: "has",
                type,
                gen,
                tierMod: mod.id,
                ...(tierSpan !== undefined && { tierSpan }),
            };
        };
        const any = (rows: readonly Mod[]): RPred =>
            rows.map(at).reduce((left, right) => ({ kind: "or", left, right }));
        if (pred.tier === undefined) {
            const named = this.rowsOnly(modName, type, a);
            return plain(named === undefined ? { kind: "has", type, gen } : any(named));
        }
        const tier = this.literalInt(pred.tier, pred.span);
        if (tier === null) return null;
        // The tier is the game's number, counted over the whole ladder: a row
        // above the item's level is one the item may hold, though no currency
        // rolls it, and the state says whether it does.
        const ladders = tierLadders(this.registry.catalog, a.base, type, tags);
        const atTier = this.rowsAt(ladders, tier, modName);
        if (atTier.length === 0) {
            const count = tierCount(ladders);
            this.diag(
                `tier ${tier} is out of range for "${modName}" (it has ${count} ${plural(count, "tier")} on this base)`,
                pred.span,
            );
            return null;
        }
        return {
            pred: any(atTier),
            aboveLevel: this.aboveLevel(type, tier, modName, atTier, a),
        };
    }

    /** Narrow a value slot to a literal; a leftover ParamRef never got a value. */
    private literalInt(v: number | ParamRef, span: SourceSpan): number | null {
        if (typeof v === "number") return v;
        this.diag(`parameter "${v.param}" was never given a value`, span);
        return null;
    }

    private literalString(v: string | ParamRef, span: SourceSpan): string | null {
        if (typeof v === "string") return v;
        this.diag(`parameter "${v.param}" was never given a value`, span);
        return null;
    }
}

/** A tier a condition names that no currency rolls at the item's level. */
interface AboveLevel {
    readonly type: TypeId;
    readonly reason: string;
}

/** A condition resolved, with the tiers it waits for that the item's level
 *  stops short of; one it wants absent is not among them. */
interface Resolved {
    readonly pred: RPred;
    readonly aboveLevel: readonly AboveLevel[];
}

const plain = (pred: RPred): Resolved => ({ pred, aboveLevel: [] });

/**
 * Why a condition that can never be met cannot, where the item's level is the
 * reason, worded to follow a "can never" message. The level is not why for a
 * modifier the item is known to hold: it is at another tier, whatever its level.
 */
function levelReasons(resolved: Resolved | null, a: AItem): string {
    const reasons = (resolved?.aboveLevel ?? [])
        .filter((note) => !isGuaranteed(a, note.type))
        .map((note) => note.reason);
    return reasons.length === 0 ? "" : ` — ${[...new Set(reasons)].join("; ")}`;
}

// --- def parameter types + substitution (module-level, pure) --------------

/**
 * The sort of a def parameter, four distinct kinds even though a tier and a
 * count are both written with digits: a `tier` (t1) indexes a mod's tier
 * ladder, a `count` is a number of affixes, a `mod` is a stat description, a
 * `block` is one or more steps run where the parameter stands.
 */
export type ParamType = "tier" | "count" | "mod" | "block";

const SORT_LABEL: Record<ParamType, string> = {
    tier: "a tier",
    count: "a count",
    mod: "a mod name",
    block: "a step",
};

/** The one argument kind each sort accepts (a pass-through param has no sort and
 *  accepts any kind, re-checked at the callee). */
const WANT_KIND: Record<ParamType, Arg["kind"]> = {
    tier: "tier",
    count: "int",
    mod: "string",
    block: "block",
};
const WANT_LABEL: Record<ParamType, string> = {
    tier: "a tier (t1)",
    count: "a number",
    mod: "a quoted mod name",
    block: "a step or a { … } block of steps",
};

/** The procs a statement list calls, directly or inside a step argument. */
function calledProcs(stmts: readonly Stmt[], out = new Set<string>()): Set<string> {
    for (const s of stmts) {
        switch (s.kind) {
            case "call":
                out.add(s.name);
                for (const arg of s.args) if (arg.kind === "block") calledProcs(arg.body, out);
                break;
            case "until":
                calledProcs(s.body, out);
                break;
            case "if":
                calledProcs(s.body, out);
                if (s.elseBody !== undefined) calledProcs(s.elseBody, out);
                break;
            case "operation":
            case "restart":
            case "stop":
            case "paramStep":
                break;
        }
    }
    return out;
}

/** The procs that can reach themselves through the call graph of their bodies.
 *  Decided on the bodies as written, not while inlining, so steps passed as an
 *  argument may call the proc they are passed to. */
function recursiveProcs(procs: ReadonlyMap<string, { proc: ProcDef }>): string[] {
    const calls = new Map<string, Set<string>>();
    for (const [name, { proc }] of procs) calls.set(name, calledProcs(proc.body));
    const reaches = (from: string, target: string, seen: Set<string>): boolean => {
        for (const next of calls.get(from) ?? []) {
            if (next === target) return true;
            if (seen.has(next)) continue;
            seen.add(next);
            if (reaches(next, target, seen)) return true;
        }
        return false;
    };
    return [...calls.keys()].filter((name) => reaches(name, name, new Set([name])));
}

/** Accumulates where each parameter is used, so its sort can be inferred (uses at
 *  two different sorts conflict) and an unused one flagged. */
interface ParamUses {
    readonly params: Set<string>;
    readonly sorts: Map<string, Set<ParamType>>;
    readonly used: Set<string>;
}

function noteSort(u: ParamUses, ref: ParamRef, ty: ParamType): void {
    if (!u.params.has(ref.param)) return;
    u.used.add(ref.param);
    const seen = u.sorts.get(ref.param) ?? new Set<ParamType>();
    seen.add(ty);
    u.sorts.set(ref.param, seen);
}

/** A pass-through arg counts as a use but adds no local sort constraint (its sort
 *  is enforced at the callee). */
function markUsed(u: ParamUses, param: string): void {
    if (u.params.has(param)) u.used.add(param);
}

function notePredUses(u: ParamUses, p: Pred): void {
    switch (p.kind) {
        case "has":
            if (typeof p.mod === "object") noteSort(u, p.mod, "mod");
            if (p.tier !== undefined && typeof p.tier === "object") noteSort(u, p.tier, "tier");
            return;
        case "fractured":
            if (typeof p.mod === "object") noteSort(u, p.mod, "mod");
            return;
        case "compare":
            if (typeof p.value === "object") noteSort(u, p.value, "count");
            return;
        case "not":
            notePredUses(u, p.inner);
            return;
        case "and":
        case "or":
            notePredUses(u, p.left);
            notePredUses(u, p.right);
            return;
        case "call":
            noteArgUses(u, p.args);
            return;
        case "isRarity":
        case "influenced":
        case "corrupted":
        case "eldritch":
        case "dominant":
            return;
    }
}

/** The sort a parameter takes from the slot it fills: every quoted name is a
 *  mod-name sort, a tier a tier, an integer a count. */
function slotSort(method: Method | undefined, i: number): ParamType | undefined {
    const slot = method === undefined ? undefined : slotAt(method, i);
    switch (slot?.kind) {
        case "name":
        case "names":
            return "mod";
        case "tier":
            return "tier";
        case "int":
            return "count";
        default:
            return undefined;
    }
}

/** A pass-through arg counts as a use; the steps of a block arg are walked like
 *  any other statements, since they may use the enclosing def's params. */
function noteArgUses(u: ParamUses, args: readonly Arg[]): void {
    for (const arg of args) {
        if (arg.kind === "param") markUsed(u, arg.param);
        else if (arg.kind === "block") for (const s of arg.body) noteStmtUses(u, s);
    }
}

function noteStmtUses(u: ParamUses, s: Stmt): void {
    switch (s.kind) {
        case "restart":
        case "stop":
            return;
        case "paramStep":
            noteSort(u, { param: s.param, span: s.span }, "block");
            return;
        case "operation": {
            const method = findMethod(s.words);
            s.args.forEach((arg, i) => {
                if (arg.kind !== "param") return;
                const sort = slotSort(method, i);
                if (sort !== undefined) noteSort(u, arg, sort);
            });
            return;
        }
        case "until":
            notePredUses(u, s.pred);
            for (const b of s.body) noteStmtUses(u, b);
            return;
        case "if":
            notePredUses(u, s.pred);
            for (const b of s.body) noteStmtUses(u, b);
            if (s.elseBody !== undefined) for (const b of s.elseBody) noteStmtUses(u, b);
            return;
        case "call":
            noteArgUses(u, s.args);
            return;
    }
}

/** Resolve accumulated uses into inferred sorts: exactly one sort is well-typed,
 *  more than one is a conflict. */
function finishUses(u: ParamUses): {
    types: Map<string, ParamType>;
    conflicts: { param: string; sorts: ParamType[] }[];
    used: Set<string>;
} {
    const types = new Map<string, ParamType>();
    const conflicts: { param: string; sorts: ParamType[] }[] = [];
    for (const [param, seen] of u.sorts) {
        if (seen.size === 1) types.set(param, [...seen][0]!);
        else conflicts.push({ param, sorts: [...seen] });
    }
    return { types, conflicts, used: u.used };
}

function inferParamTypes(def: Def): ReturnType<typeof finishUses> {
    const u: ParamUses = { params: new Set(def.params), sorts: new Map(), used: new Set() };
    notePredUses(u, def.body);
    return finishUses(u);
}

function inferProcParamTypes(proc: ProcDef): ReturnType<typeof finishUses> {
    const u: ParamUses = { params: new Set(proc.params), sorts: new Map(), used: new Set() };
    for (const s of proc.body) noteStmtUses(u, s);
    return finishUses(u);
}

/** What a def's parameter stands for, in the guide's words, for the editor. */
export const PARAM_SORT_WORD: Record<ParamType, string> = {
    tier: "tier",
    count: "count",
    mod: "mod",
    block: "steps",
};

/**
 * The sort of each parameter of a def as its uses determine it; a parameter
 * used in conflicting ways, or only forwarded to another def, has none.
 */
export function paramSorts(d: Def | ProcDef): ReadonlyMap<string, ParamType> {
    return (d.kind === "def" ? inferParamTypes(d) : inferProcParamTypes(d)).types;
}

/** Substitute a bound value into a `mod`/`tier`/`count` slot. Bound to a literal
 *  ⇒ its value; unbound (or a not-yet-resolved pass-through param) ⇒ the ref,
 *  caught downstream. */
function subValue<T extends string | number>(v: T | ParamRef, env: Map<string, Arg>): T | ParamRef {
    if (typeof v !== "object") return v;
    const arg = env.get(v.param);
    if (arg && (arg.kind === "tier" || arg.kind === "int" || arg.kind === "string")) {
        return arg.value as T;
    }
    return v;
}

/** A pass-through param arg (`… b(t) …` called with `t` bound) is replaced by the
 *  value bound here; a block arg has the enclosing def's params substituted into
 *  its steps; other args pass unchanged. */
function subArgs(args: readonly Arg[], env: Map<string, Arg>): Arg[] {
    return args.map((arg) =>
        arg.kind === "param"
            ? (env.get(arg.param) ?? arg)
            : arg.kind === "block"
              ? { ...arg, body: substituteStmts(arg.body, env) }
              : arg,
    );
}

function substitute(pred: Pred, env: Map<string, Arg>): Pred {
    switch (pred.kind) {
        case "isRarity":
        case "influenced":
        case "corrupted":
        case "eldritch":
        case "dominant":
            return pred;
        case "call":
            return { ...pred, args: subArgs(pred.args, env) };
        case "has": {
            const mod = subValue(pred.mod, env);
            return pred.tier === undefined
                ? { ...pred, mod }
                : { ...pred, mod, tier: subValue(pred.tier, env) };
        }
        case "fractured":
            return { ...pred, mod: subValue(pred.mod, env) };
        case "compare":
            return { ...pred, value: subValue(pred.value, env) };
        case "not":
            return { ...pred, inner: substitute(pred.inner, env) };
        case "and":
        case "or":
            return {
                ...pred,
                left: substitute(pred.left, env),
                right: substitute(pred.right, env),
            };
    }
}

/** Replace parameter references throughout a proc body's statements. A step
 *  parameter bound to a block is spliced in as the block's statements, already
 *  substituted in the caller's scope, so a callee param of the same name cannot
 *  capture a name inside them. */
function substituteStmts(stmts: readonly Stmt[], env: Map<string, Arg>): Stmt[] {
    return stmts.flatMap((s) => {
        if (s.kind !== "paramStep") return [substituteStmt(s, env)];
        const bound = env.get(s.param);
        // Each use is a statement of its own, so a consumer telling statements
        // apart by identity sees two uses as two.
        return bound?.kind === "block" ? bound.body.map(copyStmt) : [s];
    });
}

/** A bound parameter in an operation's argument becomes the bound literal; an
 *  unbound one stays a reference, caught downstream. A block cannot fill a
 *  value slot; `bindArgs` refuses it before substitution runs. */
function subOperationArg(arg: OperationArg, env: Map<string, Arg>): OperationArg {
    if (arg.kind !== "param") return arg;
    const bound = env.get(arg.param);
    return bound === undefined || bound.kind === "block" ? arg : bound;
}

function copyStmt(stmt: Stmt): Stmt {
    switch (stmt.kind) {
        case "until":
            return { ...stmt, body: stmt.body.map(copyStmt) };
        case "if":
            return {
                ...stmt,
                body: stmt.body.map(copyStmt),
                ...(stmt.elseBody !== undefined && { elseBody: stmt.elseBody.map(copyStmt) }),
            };
        default:
            return { ...stmt };
    }
}

function substituteStmt(stmt: Stmt, env: Map<string, Arg>): Stmt {
    switch (stmt.kind) {
        case "restart":
        case "stop":
        case "paramStep":
            return { ...stmt };
        case "operation":
            return { ...stmt, args: stmt.args.map((arg) => subOperationArg(arg, env)) };
        case "until":
            return {
                ...stmt,
                pred: substitute(stmt.pred, env),
                body: substituteStmts(stmt.body, env),
            };
        case "if":
            return {
                ...stmt,
                pred: substitute(stmt.pred, env),
                body: substituteStmts(stmt.body, env),
                ...(stmt.elseBody !== undefined && {
                    elseBody: substituteStmts(stmt.elseBody, env),
                }),
            };
        case "call":
            return { ...stmt, args: subArgs(stmt.args, env) };
    }
}

/**
 * The checker's reading of a guide's conditions, for a consumer that evaluates
 * them against another model (the cost layer): the predicate defs collected,
 * each condition resolved against the item it is read on, quietly, so nothing
 * is reported twice. `null` where the checker could not resolve it.
 */
export function predicateResolver(
    craft: Craft,
    registry: Registry,
): (pred: Pred, a: AItem) => RPred | null {
    return new Checker(registry).resolver(craft);
}
