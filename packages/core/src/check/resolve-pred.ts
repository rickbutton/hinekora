/**
 * A surface condition (`Pred`) resolved against the item it is read for: a
 * modifier name to its type under the item's tags, a tier number to the rows
 * of its ladders, a value comparison to the rows the item may be at, a def
 * call to its body. What it reads of the item is a `ResolveView`: the checker
 * reads one case of its items (check/conditions.ts), the cost layer the items
 * at a step.
 */
import type { ParamRef, Pred } from "../ast/ast.js";
import type { SourceSpan } from "../ast/span.js";
import type { Base } from "../model/base.js";
import type { ModId, TagId, TypeId } from "../model/ids.js";
import { eldritchTierOf } from "../model/marks.js";
import type { Mod } from "../model/mod.js";
import { lookupWeight } from "../pool/pool.js";
import { resolveMessage } from "../resolve/messages.js";
import type { ModTypeContext, Registry } from "../resolve/registry.js";
import {
    rollableGen,
    tierCount,
    type TierLadders,
    tierLadders,
    tierRows,
} from "../resolve/tiers.js";
import { plural } from "../words.js";
import type { RPred } from "./pred.js";
import { bindArgs, type Diag, type PredDefs, substitute } from "./defs.js";
import type { Range } from "./domain.js";
import { rollRange } from "./values.js";

/** What resolving a condition reads of the item it is read for. */
export interface ResolveView {
    readonly base: Base;
    readonly ilvl: number;
    /** The tags beside the base's that names, tiers and sides are read under:
     *  its influences' (resolve/tiers.ts `tierLadders`). */
    readonly tags: ReadonlySet<TagId>;
    /** May the item be at this row of a type whose value a condition
     *  compares: the rows a comparison lists. */
    mayCarry(row: Mod): boolean;
}

export interface PredEnv extends PredDefs {
    readonly registry: Registry;
    readonly diag: Diag;
    /** Read an atom that does not resolve (a name, a tier, a value) as never
     *  holding, without a word: a condition read for one item, where a name
     *  or a tier the craft's other items have means nothing. The structure's
     *  faults (a def misused) still leave the condition unresolved. */
    readonly atomsNever?: boolean;
}

/** A tier a condition names that no currency rolls at the item's level. */
export interface AboveLevel {
    readonly type: TypeId;
    readonly reason: string;
}

/** A condition resolved, with the tiers it waits for that the item's level
 *  stops short of; one it wants absent is not among them. */
export interface Resolved {
    readonly pred: RPred;
    readonly aboveLevel: readonly AboveLevel[];
}

const plain = (pred: RPred): Resolved => ({ pred, aboveLevel: [] });

/** A condition no item meets. */
export const NEVER: RPred = {
    kind: "and",
    left: { kind: "corrupted" },
    right: { kind: "not", inner: { kind: "corrupted" } },
};

/**
 * The rows of a compared type the items may be at: a row they hold, a row an
 * essence grants its class (whatever its spawn weight on the base), a natural
 * row that rolls on the base at some level
 * under a tag the item has or may have (a tag a present modifier may add
 * among them), a bench row its class takes, an unveiled or otherwise placed
 * row.
 */
export function carriedRows(
    registry: Registry,
    base: Base,
    itemTags: ReadonlySet<TagId>,
    maybeTags: ReadonlySet<TagId>,
    pinned: (type: TypeId) => ReadonlySet<ModId> | undefined,
): (m: Mod) => boolean {
    const benchTypes = registry.benchTypesFor(base.itemClass);
    const granted = new Set<ModId>();
    for (const e of registry.essences) {
        const id = e.grants.get(base.itemClass);
        if (id !== undefined) granted.add(id);
    }
    return (m) => {
        if (pinned(m.type)?.has(m.id) || granted.has(m.id)) return true;
        switch (m.source ?? "natural") {
            case "natural": {
                const weight = lookupWeight(m, itemTags, maybeTags);
                return m.domain === base.domain && weight !== null && weight > 0;
            }
            case "bench":
                return benchTypes.has(m.type);
            case "essence":
                return false;
            default:
                return true;
        }
    };
}

/** The condition resolved for the item `view` describes, or null where it
 *  cannot be (each reason reported through `env.diag`). */
export function resolvePred(pred: Pred, view: ResolveView, env: PredEnv): Resolved | null {
    return new Resolver(view, env).resolve(pred);
}

class Resolver {
    /** Predicate defs being expanded: a guard against (mutual) recursion. */
    private readonly expanding = new Set<string>();

    constructor(
        private readonly view: ResolveView,
        private readonly env: PredEnv,
    ) {}

    private get registry(): Registry {
        return this.env.registry;
    }

    private diag(message: string, span: SourceSpan): void {
        if (!this.env.atomsNever) this.env.diag(message, span);
    }

    /** An atom's reading; one that does not resolve never holds where atoms
     *  are read so. */
    private atom(r: Resolved | null): Resolved | null {
        return r === null && this.env.atomsNever ? plain(NEVER) : r;
    }

    resolve(pred: Pred): Resolved | null {
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
                    const found = this.registry.resolveEldritch(
                        pred.text,
                        pred.side,
                        this.view.base,
                    );
                    if (!found.ok) {
                        this.diag(resolveMessage(found.error), pred.span);
                        return this.atom(null);
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
                const inner = this.resolve(pred.inner);
                return inner === null ? null : plain({ kind: "not", inner: inner.pred });
            }
            case "and":
            case "or": {
                // An unresolvable sub-predicate (already reported) skips narrowing
                // entirely rather than narrow by a half-understood condition.
                const left = this.resolve(pred.left);
                const right = this.resolve(pred.right);
                if (left === null || right === null) return null;
                return {
                    pred: { kind: pred.kind, left: left.pred, right: right.pred },
                    aboveLevel: [...left.aboveLevel, ...right.aboveLevel],
                };
            }
            case "has": {
                if (typeof pred.mod !== "string" || typeof pred.tier === "object") {
                    // A parameter never given a value is the structure's fault.
                    return this.resolveHas(pred);
                }
                return this.atom(this.resolveHas(pred));
            }
            case "fractured": {
                if (typeof pred.mod !== "string") return this.resolveFractured(pred);
                return this.atom(this.resolveFractured(pred));
            }
            case "call":
                return this.resolveCall(pred);
        }
    }

    /** A named tier the item's level stops short of. It is no error: an
     *  essence or a Harvest change places such a row, a currency never rolls it. */
    private aboveLevel(
        type: TypeId,
        tier: number,
        name: string,
        rows: readonly Mod[],
    ): readonly AboveLevel[] {
        const ilvl = this.view.ilvl;
        const above = (m: Mod): boolean =>
            (m.source ?? "natural") === "natural" && m.minLevel > ilvl;
        if (rows.length === 0 || !rows.every(above)) return [];
        const needs = Math.min(...rows.map((m) => m.minLevel));
        return [
            {
                type,
                reason: `Tier ${tier} "${name}" needs item level ${needs}; this item is level ${ilvl}`,
            },
        ];
    }

    private resolveFractured(pred: Extract<Pred, { kind: "fractured" }>): Resolved | null {
        const modName = this.literalString(pred.mod, pred.span);
        if (modName === null) return null;
        const typeRes = this.registry.resolveModType(modName, this.modContext());
        if (!typeRes.ok) {
            this.diag(resolveMessage(typeRes.error), pred.span);
            return null;
        }
        return plain({ kind: "fractured", type: typeRes.value });
    }

    private modContext(): ModTypeContext {
        return { base: this.view.base, ilvl: this.view.ilvl, tags: this.view.tags };
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
    private rowsOnly(name: string, type: TypeId): readonly Mod[] | undefined {
        const ladders = tierLadders(this.registry.catalog, this.view.base, type, this.view.tags);
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

    private resolveCall(pred: Extract<Pred, { kind: "call" }>): Resolved | null {
        const entry = this.env.defs.get(pred.name);
        if (!entry) {
            if (this.env.procs.has(pred.name)) {
                this.env.diag(
                    `"${pred.name}" runs operations, use it as a step, not inside a condition`,
                    pred.span,
                );
            } else {
                this.env.diag(`unknown def "${pred.name}"`, pred.span);
            }
            return null;
        }
        const { def, paramTypes, valid } = entry;
        if (!valid) return null; // the def's own error was already reported
        if (this.expanding.has(pred.name)) {
            this.env.diag(`recursive def "${pred.name}" is not allowed`, pred.span);
            return null;
        }
        const env = bindArgs(pred.name, def.params, paramTypes, pred.args, pred.span, (m, s) =>
            this.env.diag(m, s),
        );
        if (env === null) return null;

        const body = substitute(def.body, env);
        this.expanding.add(pred.name);
        const resolved = this.resolve(body);
        this.expanding.delete(pred.name);
        return resolved;
    }

    private resolveHas(pred: Extract<Pred, { kind: "has" }>): Resolved | null {
        const modName = this.literalString(pred.mod, pred.span);
        if (modName === null) return null;
        const { base, ilvl, tags } = this.view;
        const typeRes = this.registry.resolveModType(modName, { base, ilvl, tags });
        if (!typeRes.ok) {
            this.diag(resolveMessage(typeRes.error), pred.span);
            return null;
        }
        const type = typeRes.value;
        if (pred.group)
            return plain({ kind: "hasGroup", type, types: this.registry.groupOf(type) });
        const gen = rollableGen(this.registry.catalog, base, ilvl, type, tags) ?? "prefix";

        if (pred.value !== undefined) {
            // Any row of the type the item may carry may be the one on it.
            const rows = new Map<ModId, Range>();
            const unnumbered = new Set<ModId>();
            let aboveLevel: readonly AboveLevel[] = [];
            for (const m of this.registry.catalog) {
                if (m.type !== type || !this.view.mayCarry(m)) continue;
                const span = m.text === undefined ? undefined : rollRange(m.text);
                if (span !== undefined) rows.set(m.id, span);
                else unnumbered.add(m.id);
            }
            if (pred.tier !== undefined) {
                const tier = this.literalInt(pred.tier, pred.span);
                if (tier === null) return null;
                const ladders = tierLadders(this.registry.catalog, base, type, tags);
                const atTier = this.rowsAt(ladders, tier, modName).filter((m) => rows.has(m.id));
                if (atTier.length === 0) {
                    this.diag(
                        `tier ${tier} of "${modName}" has no value to compare here`,
                        pred.span,
                    );
                    return null;
                }
                aboveLevel = this.aboveLevel(type, tier, modName, atTier);
                const named = new Set(atTier.map((m) => m.id));
                for (const id of [...rows.keys()]) if (!named.has(id)) rows.delete(id);
                unnumbered.clear();
            }
            const only = pred.tier === undefined ? this.rowsOnly(modName, type) : undefined;
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
            const named = this.rowsOnly(modName, type);
            return plain(named === undefined ? { kind: "has", type, gen } : any(named));
        }
        const tier = this.literalInt(pred.tier, pred.span);
        if (tier === null) return null;
        // The tier is the game's number, counted over the whole ladder: a row
        // above the item's level is one the item may hold, though no currency
        // rolls it, and the state says whether it does.
        const ladders = tierLadders(this.registry.catalog, base, type, tags);
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
            aboveLevel: this.aboveLevel(type, tier, modName, atTier),
        };
    }

    /** Narrow a value slot to a literal; a leftover ParamRef never got a value. */
    private literalInt(v: number | ParamRef, span: SourceSpan): number | null {
        if (typeof v === "number") return v;
        this.env.diag(`parameter "${v.param}" was never given a value`, span);
        return null;
    }

    private literalString(v: string | ParamRef, span: SourceSpan): string | null {
        if (typeof v === "string") return v;
        this.env.diag(`parameter "${v.param}" was never given a value`, span);
        return null;
    }
}

/**
 * Why a condition that can never be met cannot, where the item's level is the
 * reason, worded to follow a "can never" message. The level is not why for a
 * modifier the item is known to hold (`isGuaranteed`): it is at another tier,
 * whatever its level.
 */
export function levelReasons(
    resolved: Resolved | null,
    isGuaranteed: (type: TypeId) => boolean,
): string {
    const reasons = (resolved?.aboveLevel ?? [])
        .filter((note) => !isGuaranteed(note.type))
        .map((note) => note.reason);
    return reasons.length === 0 ? "" : ` — ${[...new Set(reasons)].join("; ")}`;
}
