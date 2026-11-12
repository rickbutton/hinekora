/**
 * The modifiers a craft names: in its conditions, in the item block, in the
 * arguments its calls pass. What a view of an item lists by name is bounded by
 * these where the items alone would list too much: the modifiers ruled out are
 * every type no item carries, most of them never in question, and a group the
 * craft waits for ("life or fire resistance") is asked of the items directly,
 * however many members it has.
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
import { resolvePred } from "../check/resolve-pred.js";
import type { TypeId } from "../model/ids.js";
import { influenceKey } from "../model/marks.js";
import { influenceTagsOfKey } from "./influence.js";
import type { Universe } from "./universe.js";

export interface CraftNames {
    /** The types the conditions and the item block name. */
    readonly types: ReadonlySet<TypeId>;
    /** The sets a condition is met by any one of: an `or` of modifiers, a
     *  `has group`. Each of two or more types, sorted. */
    readonly groups: readonly (readonly TypeId[])[];
}

const SILENT: Diag = () => {};

const cache = new WeakMap<Craft, WeakMap<Universe, CraftNames>>();

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

function collect(craft: Craft, u: Universe): CraftNames {
    const defs = collectDefs(craft.defs, SILENT);
    const procs = collectProcs(craft.procs, defs, SILENT);
    const predDefs: PredDefs = { defs, procs };
    const types = new Set<TypeId>();
    const groups = new Map<string, readonly TypeId[]>();
    const tagSets = u.influenceKeys.map((k) => influenceTagsOfKey(u.registry, u.base, k));

    const fromPred = (pred: Pred): void => {
        for (const tags of tagSets) {
            const r = resolvePred(
                pred,
                { base: u.base, ilvl: u.ilvl, tags, mayCarry: (row) => u.rows.has(row) },
                { ...predDefs, registry: u.registry, diag: SILENT, atomsNever: true },
            );
            if (r === null) continue;
            walk(r.pred, true, types, groups);
        }
    };
    const fromName = (name: string): void => {
        const byId = u.registry.resolveMod(name);
        if (byId.ok) {
            types.add(byId.value.type);
            return;
        }
        for (const tags of tagSets) {
            const t = u.registry.resolveModType(name, { base: u.base, ilvl: u.ilvl, tags });
            if (t.ok) types.add(t.value);
        }
    };

    const item = craft.item;
    const declared = influenceTagsOfKey(u.registry, u.base, influenceKey(item.influences));
    for (const affix of [...item.prefixes, ...item.suffixes]) {
        if (PLACEHOLDERS.test(affix.mod.trim().toLowerCase())) continue;
        const byId = u.registry.resolveMod(affix.mod);
        const t = byId.ok
            ? byId.value.type
            : u.registry.resolveModType(affix.mod, { base: u.base, ilvl: u.ilvl, tags: declared });
        if (typeof t === "string") types.add(t);
        else if (t.ok) types.add(t.value);
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
                case "operation":
                case "restart":
                case "stop":
                case "paramStep":
                    break;
            }
        }
    };
    stmts(craft.body);
    return { types, groups: [...groups.values()] };
}

/** The types an atom names, the groups an `or` of atoms forms, read with
 *  their polarity: `not (a and b)` is no group, `not (not a and not b)` is. */
function walk(
    p: RPred,
    positive: boolean,
    types: Set<TypeId>,
    groups: Map<string, readonly TypeId[]>,
): void {
    switch (p.kind) {
        case "has":
        case "hasValue":
        case "fractured":
            types.add(p.type);
            return;
        case "hasGroup":
            for (const t of p.types) types.add(t);
            if (positive) addGroup(groups, [...p.types]);
            return;
        case "not":
            walk(p.inner, !positive, types, groups);
            return;
        case "and":
        case "or": {
            walk(p.left, positive, types, groups);
            walk(p.right, positive, types, groups);
            const disjunction = (p.kind === "or") === positive;
            if (!disjunction) return;
            const members = presenceLeaves(p, positive);
            if (members !== undefined) addGroup(groups, members);
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
