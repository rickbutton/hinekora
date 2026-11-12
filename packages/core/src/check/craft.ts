/**
 * What the universe reads of a craft: the value comparisons its conditions
 * make, whether it can hold an imprint, and the rows its item block declares.
 * Every reading errs wide: a threshold too many costs a cell, one too few
 * would leave a comparison the state cannot answer.
 */
import type { Arg, Craft, Pred, Stmt } from "../ast/ast.js";
import { PLACEHOLDERS } from "./item-block.js";
import type { Base } from "../model/base.js";
import type { TagId, TypeId } from "../model/ids.js";
import type { Mod } from "../model/mod.js";
import type { Registry } from "../resolve/registry.js";
import { tierLadder } from "../resolve/tiers.js";
import { influenceKeysFor, influenceTagsOfKey } from "./influence.js";

/** A piece of a craft by what it says, its places in the source left out: two
 *  parses of one text, or of texts that differ elsewhere, give one key. */
export function shapeKey(node: unknown): string {
    return JSON.stringify(node, (_k, v: unknown) => (isSpan(v) ? undefined : v));
}

function isSpan(v: unknown): boolean {
    if (typeof v !== "object" || v === null || !("start" in v) || !("end" in v)) return false;
    const start: unknown = v.start;
    return typeof start === "object" && start !== null && "offset" in start;
}

/** The thresholds each type's value is compared against. */
export interface Comparisons {
    readonly byType: ReadonlyMap<TypeId, ReadonlySet<number>>;
    /** Compared against every type's value: a comparison whose modifier is a
     *  def parameter, which may be any modifier. */
    readonly everyType: ReadonlySet<number>;
}

export const NO_COMPARISONS: Comparisons = { byType: new Map(), everyType: new Set() };

/** The thresholds a type's value is compared against, ascending. */
export function thresholdsOf(c: Comparisons, type: TypeId): number[] {
    return [...new Set([...(c.byType.get(type) ?? []), ...c.everyType])].sort((x, y) => x - y);
}

/**
 * The tag sets a name is resolved under: those of each influence set an item
 * of the base can have (the influence slot's values). A driver that resolves
 * a name per influence case reads one of these. The union of the influences
 * the items may have, which can be three or more on a non-Astrolabe base, is
 * no item's, so it is not read here.
 */
export function nameTagSets(registry: Registry, base: Base): ReadonlySet<TagId>[] {
    return influenceKeysFor(base).map((k) => influenceTagsOfKey(registry, base, k));
}

/** The types a modifier name may resolve to on this item, under any of its
 *  influence sets: each case check/conditions.ts reads a condition in. */
export function typesNamed(registry: Registry, base: Base, ilvl: number, name: string): TypeId[] {
    const byId = registry.resolveMod(name);
    if (byId.ok) return [byId.value.type];
    const out = new Set<TypeId>();
    for (const tags of nameTagSets(registry, base)) {
        const r = registry.resolveModType(name, { base, ilvl, tags });
        if (r.ok) out.add(r.value);
    }
    return [...out];
}

function predsOf(stmts: readonly Stmt[], out: Pred[]): void {
    for (const s of stmts) {
        switch (s.kind) {
            case "if":
                out.push(s.pred);
                predsOf(s.body, out);
                predsOf(s.elseBody ?? [], out);
                break;
            case "until":
                out.push(s.pred);
                predsOf(s.body, out);
                break;
            case "call":
                argsOf(s.args, out);
                break;
            default:
                break;
        }
    }
}

function argsOf(args: readonly Arg[], out: Pred[]): void {
    for (const a of args) if (a.kind === "block") predsOf(a.body, out);
}

/** Every value comparison of the craft, in its body, its defs and its procs.
 *  The compared number is always a literal (`HasPred.value`); a modifier named
 *  by a def parameter may be any, so its threshold goes on every type. */
export function comparisonsOf(
    craft: Craft,
    registry: Registry,
    base: Base,
    ilvl: number,
): Comparisons {
    const preds: Pred[] = craft.defs.map((d) => d.body);
    predsOf(craft.body, preds);
    for (const p of craft.procs) predsOf(p.body, preds);
    const byType = new Map<TypeId, Set<number>>();
    const everyType = new Set<number>();
    const visit = (p: Pred): void => {
        switch (p.kind) {
            case "has":
                if (p.value === undefined) return;
                if (typeof p.mod !== "string") {
                    everyType.add(p.value.value);
                    return;
                }
                for (const t of typesNamed(registry, base, ilvl, p.mod)) {
                    let set = byType.get(t);
                    if (!set) byType.set(t, (set = new Set()));
                    set.add(p.value.value);
                }
                return;
            case "not":
                visit(p.inner);
                return;
            case "and":
            case "or":
                visit(p.left);
                visit(p.right);
                return;
            case "call":
                argsOf(p.args, preds);
                return;
            default:
                return;
        }
    };
    // `visit` may append the predicates of block arguments as it goes.
    for (let i = 0; i < preds.length; i++) visit(preds[i]!);
    return { byType, everyType };
}

/** The methods that take or apply an imprint (`check/library.ts` BEAST_IMPRINT
 *  and RESTORE), by their words, read before any method is built. A test pins
 *  the list against the method table. */
export const IMPRINT_WORDS: readonly (readonly string[])[] = [["beast", "imprint"], ["restore"]];

function imprintsIn(stmts: readonly Stmt[]): boolean {
    return stmts.some((s) => {
        switch (s.kind) {
            case "operation":
                return IMPRINT_WORDS.some(
                    (w) => w.length === s.words.length && w.every((x, i) => s.words[i] === x),
                );
            case "if":
                return imprintsIn(s.body) || imprintsIn(s.elseBody ?? []);
            case "until":
                return imprintsIn(s.body);
            case "call":
                return s.args.some((a) => a.kind === "block" && imprintsIn(a.body));
            default:
                return false;
        }
    });
}

/** Can the craft hold an imprint: some step, in its body or any proc, takes or applies one. */
export function craftImprints(craft: Craft): boolean {
    return imprintsIn(craft.body) || craft.procs.some((p) => imprintsIn(p.body));
}

/** What a craft's steps can put on an item beyond the natural pool's rows. */
export interface CraftReach {
    /** The row sources besides the natural pool and the item block. */
    readonly sources: ReadonlySet<ReachSource>;
    /** A modifier may come to be fractured. */
    readonly fractures: boolean;
    /** A Harvest change may turn a row into another, a crafted one into a
     *  crafted natural row among them. */
    readonly changes: boolean;
}

export type ReachSource =
    "bench" | "metamod" | "essence" | "veiled" | "fossil" | "elevated" | "aspect";

/** By a method's words, what it can put on an item beyond the natural pool:
 *  every other method draws from that pool alone or adds nothing. A test
 *  pins it against the operations each method builds. */
export const REACH: Readonly<Record<string, Partial<CraftReach>>> = {
    bench: { sources: new Set(["bench"]) },
    "beast metamod": { sources: new Set(["metamod"]) },
    "beast aspect": { sources: new Set(["aspect"]) },
    essence: { sources: new Set(["essence"]) },
    fossil: { sources: new Set(["fossil", "essence"]), fractures: true },
    "veiled chaos": { sources: new Set(["veiled"]) },
    "veiled exalt": { sources: new Set(["veiled"]) },
    unveil: { sources: new Set(["veiled"]) },
    dominance: { sources: new Set(["elevated"]) },
    fracture: { fractures: true },
    "beast fracture": { fractures: true },
    "harvest change": { changes: true },
};

/** Everything a craft can reach: what no craft-aware reading leaves out. */
export const ALL_REACH: CraftReach = {
    sources: new Set(["bench", "metamod", "essence", "veiled", "fossil", "elevated", "aspect"]),
    fractures: true,
    changes: true,
};

/** What the craft's steps, in its body, its procs and its step arguments, and
 *  its item block can put on the item. */
export function craftReach(craft: Craft): CraftReach {
    const sources = new Set<ReachSource>();
    let fractures = false;
    let changes = false;
    const visit = (stmts: readonly Stmt[]): void => {
        for (const s of stmts) {
            switch (s.kind) {
                case "operation": {
                    const r = REACH[s.words.join(" ")];
                    for (const x of r?.sources ?? []) sources.add(x);
                    fractures ||= r?.fractures === true;
                    changes ||= r?.changes === true;
                    break;
                }
                case "if":
                    visit(s.body);
                    visit(s.elseBody ?? []);
                    break;
                case "until":
                    visit(s.body);
                    break;
                case "call":
                    for (const a of s.args) if (a.kind === "block") visit(a.body);
                    break;
                default:
                    break;
            }
        }
    };
    visit(craft.body);
    for (const p of craft.procs) visit(p.body);
    for (const a of [...craft.item.prefixes, ...craft.item.suffixes]) {
        if (a.bench === true) sources.add("bench");
        fractures ||= a.fractured === true;
    }
    return { sources, fractures, changes };
}

/** The rows the item block may declare: a row named by id, a bench row named
 *  by its modifier, or any row of a named modifier's ladders on the base. */
export function declaredRows(craft: Craft, registry: Registry, base: Base, ilvl: number): Mod[] {
    const out = new Set<Mod>();
    const { prefixes, suffixes } = craft.item;
    for (const affix of [...prefixes, ...suffixes]) {
        if (PLACEHOLDERS.test(affix.mod.trim().toLowerCase())) continue;
        if (affix.bench) {
            const craftRes = registry.resolveBench(affix.mod, base.itemClass, affix.tier);
            const mod = craftRes.ok ? registry.resolveMod(craftRes.value.mod) : undefined;
            if (mod?.ok) out.add(mod.value);
            continue;
        }
        const byId = registry.resolveMod(affix.mod);
        if (byId.ok) {
            out.add(byId.value);
            continue;
        }
        for (const tags of nameTagSets(registry, base)) {
            const r = registry.resolveModType(affix.mod, { base, ilvl, tags });
            if (!r.ok) continue;
            for (const m of tierLadder(registry.catalog, base, r.value, tags)) out.add(m);
        }
    }
    return [...out];
}
