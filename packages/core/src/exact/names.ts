/**
 * The modifiers a craft names: in its conditions, in the item block, in the
 * arguments its calls pass. What a view of an item lists by name is bounded by
 * these where the items alone would list too much: the modifiers ruled out are
 * every type no item carries, most of them never in question, and a group the
 * craft waits for ("life or fire resistance") is asked of the items directly,
 * however many members it has. A step that guarantees one modifier of a pool
 * (an influence orb, a Harvest reforge of a category, a fossil's forced rows)
 * names that pool as such a group.
 */
import type { Craft, Pred, Stmt } from "../ast/ast.js";
import type { RPred } from "../check/astate.js";
import {
    bindArgs,
    collectDefs,
    collectProcs,
    type Diag,
    type PredDefs,
    substituteStmts,
} from "../check/defs.js";
import { PLACEHOLDERS } from "../check/item-block.js";
import { findMethod, type Literal } from "../check/methods.js";
import type { PoolSpec } from "../check/ops.js";
import { resolvePred } from "../check/resolve-pred.js";
import type { TypeId } from "../model/ids.js";
import { influenceKey, influenceOfTag } from "../model/marks.js";
import { lookupWeight } from "../pool/pool.js";
import { buildMethod } from "./build.js";
import { conditionKey } from "./conditions.js";
import { influenceTagsOfKey } from "./influence.js";
import { everyItem } from "./state.js";
import type { Universe } from "./universe.js";

/** A `has group "…"` condition: the modifier it names, and its group's types. */
export interface NamedGroup {
    readonly type: TypeId;
    readonly types: readonly TypeId[];
}

export interface CraftNames {
    /** The types the conditions and the item block name one by one. */
    readonly types: ReadonlySet<TypeId>;
    /** The item block's modifiers, in the order it declares them. */
    readonly declared: readonly TypeId[];
    /** The sets a condition is met by any one of (an `or` of modifiers, a
     *  `has group`) and the pools a step guarantees one modifier of. Each
     *  of two or more types, sorted. */
    readonly groups: readonly (readonly TypeId[])[];
    /** The `has group` conditions, either way round. */
    readonly named: readonly NamedGroup[];
}

interface PredNames {
    readonly types: ReadonlySet<TypeId>;
    readonly groups: ReadonlyMap<string, readonly TypeId[]>;
    readonly named: ReadonlyMap<TypeId, NamedGroup>;
}

const SILENT: Diag = () => {};

const cache = new WeakMap<Craft, WeakMap<Universe, CraftNames>>();
/** A condition's names by what it says, per universe: a craft parsed again
 *  on every edit reads the same conditions, and the universe outlives it. */
const byCondition = new WeakMap<Universe, Map<string, PredNames>>();
const tagSetsOf = new WeakMap<Universe, readonly ReturnType<typeof influenceTagsOfKey>[]>();
/** A step's guaranteed pools by what it says, per universe. */
const byStep = new WeakMap<Universe, Map<string, readonly (readonly TypeId[])[]>>();

/** The craft's names read on the universe's base, under each influence set
 *  the base can have. Cached per craft and universe. */
export function craftNames(craft: Craft, u: Universe): CraftNames {
    let byU = cache.get(craft);
    if (byU === undefined) cache.set(craft, (byU = new WeakMap()));
    const hit = byU.get(u);
    if (hit !== undefined) return hit;
    const r = collect(craft, u);
    byU.set(u, r);
    return r;
}

/** The influence sets' tag sets, each once: a name reads the same under two
 *  sets that add the same tags. */
function tagSets(u: Universe): readonly ReturnType<typeof influenceTagsOfKey>[] {
    let r = tagSetsOf.get(u);
    if (r === undefined) {
        const seen = new Map<string, ReturnType<typeof influenceTagsOfKey>>();
        for (const k of u.influenceKeys) {
            const tags = influenceTagsOfKey(u.registry, u.base, k);
            seen.set([...tags].sort().join(","), tags);
        }
        tagSetsOf.set(u, (r = [...seen.values()]));
    }
    return r;
}

function predNames(u: Universe, pred: Pred, defs: PredDefs): PredNames {
    let known = byCondition.get(u);
    if (known === undefined) byCondition.set(u, (known = new Map<string, PredNames>()));
    const key = conditionKey(pred, defs);
    const hit = known.get(key);
    if (hit !== undefined) return hit;
    const types = new Set<TypeId>();
    const groups = new Map<string, readonly TypeId[]>();
    const named = new Map<TypeId, NamedGroup>();
    for (const tags of tagSets(u)) {
        const r = resolvePred(
            pred,
            { base: u.base, ilvl: u.ilvl, tags, mayCarry: (row) => u.rows.has(row) },
            { ...defs, registry: u.registry, diag: SILENT, atomsNever: true },
        );
        if (r !== null) walk(r.pred, true, { types, groups, named });
    }
    const out = { types, groups, named };
    known.set(key, out);
    return out;
}

function collect(craft: Craft, u: Universe): CraftNames {
    const defs = collectDefs(craft.defs, SILENT);
    const procs = collectProcs(craft.procs, defs, SILENT);
    const predDefs: PredDefs = { defs, procs };
    const types = new Set<TypeId>();
    const groups = new Map<string, readonly TypeId[]>();
    const named = new Map<TypeId, NamedGroup>();

    const fromPred = (pred: Pred): void => {
        const n = predNames(u, pred, predDefs);
        for (const t of n.types) types.add(t);
        for (const [k, g] of n.groups) groups.set(k, g);
        for (const [k, g] of n.named) named.set(k, g);
    };
    const fromName = (name: string): void => {
        const byId = u.registry.resolveMod(name);
        if (byId.ok) {
            types.add(byId.value.type);
            return;
        }
        for (const tags of tagSets(u)) {
            const t = u.registry.resolveModType(name, { base: u.base, ilvl: u.ilvl, tags });
            if (t.ok) types.add(t.value);
        }
    };

    const fromStep = (words: readonly string[], literals: readonly Literal[]): void => {
        for (const g of stepPools(u, words, literals)) groups.set(g.join(","), g);
    };

    const order: TypeId[] = [];
    const item = craft.item;
    const declared = influenceTagsOfKey(u.registry, u.base, influenceKey(item.influences));
    for (const affix of [...item.prefixes, ...item.suffixes]) {
        if (PLACEHOLDERS.test(affix.mod.trim().toLowerCase())) continue;
        const byId = u.registry.resolveMod(affix.mod);
        const t = byId.ok
            ? byId.value.type
            : u.registry.resolveModType(affix.mod, { base: u.base, ilvl: u.ilvl, tags: declared });
        const type = typeof t === "string" ? t : t.ok ? t.value : undefined;
        if (type !== undefined) {
            types.add(type);
            order.push(type);
        }
    }

    const entered = new Set<string>();
    const stmts = (body: readonly Stmt[]): void => {
        for (const s of body) {
            switch (s.kind) {
                case "until":
                    fromPred(s.pred);
                    stmts(s.body);
                    break;
                case "if":
                    fromPred(s.pred);
                    stmts(s.body);
                    stmts(s.elseBody ?? []);
                    break;
                case "call": {
                    for (const a of s.args) if (a.kind === "string") fromName(a.value);
                    const entry = procs.get(s.name);
                    if (entry === undefined || !entry.valid || entered.has(s.name)) break;
                    const env = bindArgs(
                        s.name,
                        entry.proc.params,
                        entry.paramTypes,
                        s.args,
                        s.span,
                        SILENT,
                    );
                    if (env === null) break;
                    entered.add(s.name);
                    stmts(substituteStmts(entry.proc.body, env));
                    entered.delete(s.name);
                    break;
                }
                case "operation": {
                    const literals: Literal[] = [];
                    for (const a of s.args) if (a.kind !== "param") literals.push(a);
                    if (literals.length === s.args.length) fromStep(s.words, literals);
                    break;
                }
                case "restart":
                case "stop":
                case "paramStep":
                    break;
            }
        }
    };
    stmts(craft.body);
    return {
        types,
        declared: order,
        groups: [...groups.values()],
        named: [...named.values()],
    };
}

/** The pools the step adds a modifier of, or counts one of: the types its
 *  builder names for any item of the universe. */
function stepPools(
    u: Universe,
    words: readonly string[],
    literals: readonly Literal[],
): readonly (readonly TypeId[])[] {
    let known = byStep.get(u);
    if (known === undefined) {
        byStep.set(u, (known = new Map<string, readonly (readonly TypeId[])[]>()));
    }
    const key = JSON.stringify([words, literals]);
    const hit = known.get(key);
    if (hit !== undefined) return hit;
    const method = findMethod(words);
    const out = new Map<string, readonly TypeId[]>();
    if (method !== undefined) {
        for (const part of buildMethod(everyItem(u), method, literals)) {
            if ("refused" in part.built) continue;
            for (const op of part.built) {
                if (op.kind !== "fill") continue;
                const one =
                    op.count.kind === "within" || (op.count.kind === "add" && op.count.n[0] >= 1);
                if (!one) continue;
                const types = [...new Set(poolTypes(u, op.pool))].sort();
                if (types.length >= 2) out.set(types.join(","), types);
            }
        }
    }
    const r = [...out.values()];
    known.set(key, r);
    return r;
}

/** The types a guaranteed pool may give, over the universe's rows: no fewer
 *  than any item's pool, which is all a group asked of the items needs. */
function poolTypes(u: Universe, pool: PoolSpec): TypeId[] {
    const natural = [...u.rows.keys()].filter((m) => (m.source ?? "natural") === "natural");
    switch (pool.kind) {
        case "rows":
            return pool.mods.map((m) => m.type);
        case "tagged":
            return natural.filter((m) => m.implicitTags.has(pool.tag)).map((m) => m.type);
        case "influence":
            return natural
                .filter(
                    (m) =>
                        (lookupWeight(m, u.base.tags) ?? 0) <= 0 &&
                        m.spawn.some((e) => e.weight > 0 && influenceOfTag(e.tag) !== undefined),
                )
                .map((m) => m.type);
        default:
            return [];
    }
}

interface Into {
    readonly types: Set<TypeId>;
    readonly groups: Map<string, readonly TypeId[]>;
    readonly named: Map<TypeId, NamedGroup>;
}

/** The types an atom names, the groups an `or` of atoms forms, read with
 *  their polarity: `not (a and b)` is no group, `not (not a and not b)` is. */
function walk(p: RPred, positive: boolean, into: Into): void {
    switch (p.kind) {
        case "has":
        case "hasValue":
        case "fractured":
            into.types.add(p.type);
            return;
        case "hasGroup":
            into.named.set(p.type, { type: p.type, types: [...p.types].sort() });
            if (positive) addGroup(into.groups, [...p.types]);
            return;
        case "not":
            walk(p.inner, !positive, into);
            return;
        case "and":
        case "or": {
            walk(p.left, positive, into);
            walk(p.right, positive, into);
            const disjunction = (p.kind === "or") === positive;
            if (!disjunction) return;
            const members = presenceLeaves(p, positive);
            if (members !== undefined) addGroup(into.groups, members);
            return;
        }
        default:
            return;
    }
}

/** The types of a disjunction whose every leaf is a modifier's presence (at
 *  `positive`): undefined where some leaf is anything else. */
function presenceLeaves(p: RPred, positive: boolean): TypeId[] | undefined {
    switch (p.kind) {
        case "has":
        case "hasValue":
            return positive ? [p.type] : undefined;
        case "hasGroup":
            return positive ? [...p.types] : undefined;
        case "not":
            return presenceLeaves(p.inner, !positive);
        case "and":
        case "or": {
            if ((p.kind === "or") !== positive) return undefined;
            const l = presenceLeaves(p.left, positive);
            const r = presenceLeaves(p.right, positive);
            return l === undefined || r === undefined ? undefined : [...l, ...r];
        }
        default:
            return undefined;
    }
}

function addGroup(groups: Map<string, readonly TypeId[]>, types: readonly TypeId[]): void {
    const sorted = [...new Set(types)].sort();
    if (sorted.length < 2) return;
    groups.set(sorted.join(","), sorted);
}
