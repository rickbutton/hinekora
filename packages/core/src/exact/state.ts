/**
 * The exact checker's state: a set of concrete items held as one diagram over
 * a universe (docs/EXACT.md §3), and narrowing by a resolved condition (§5).
 * A live state is never empty; the empty set is `null`, the dead-branch
 * signal.
 */
import type { Cmp } from "../ast/ast.js";
import type { RPred } from "../check/pred.js";
import {
    dominantOf,
    eldritchKey,
    type EldritchSide,
    influencesOf,
    NO_INFLUENCE,
} from "../model/marks.js";
import type { Dd } from "./dd.js";
import type { CItem } from "./item.js";
import type { CountKind, Universe } from "./universe.js";

/** A set of concrete items over a universe; `dd` is never empty. */
export interface XItem {
    readonly u: Universe;
    readonly dd: Dd;
}

/** The state holding the items of `dd`, or null when there are none. */
export function stateOf(u: Universe, dd: Dd): XItem | null {
    return dd === u.dd.EMPTY ? null : { u, dd };
}

/** Every item the game allows over the universe, with any imprint it may hold. */
export function everyItem(u: Universe): XItem {
    return { u, dd: u.wfWithImprint };
}

/** The items of `a` and of `b`; `a`'s universe is `b`'s. */
export function unite(a: XItem, b: XItem): XItem {
    return { u: a.u, dd: a.u.dd.or(a.dd, b.dd) };
}

export function sameItems(a: XItem, b: XItem): boolean {
    return a.dd === b.dd;
}

/**
 * The state whose items are these, each read at the cell its values lie in:
 * an item stands for every item that differs from it only within its cells,
 * which no condition of the craft tells apart. Throws for an item the
 * universe cannot hold.
 */
export function fromItems(u: Universe, items: Iterable<CItem>): XItem | null {
    let dd = u.dd.EMPTY;
    for (const item of items) dd = u.dd.or(dd, cube(u, u.encode(item)));
    return stateOf(u, dd);
}

/** The one assignment as a diagram. */
export function cube(u: Universe, assignment: readonly number[]): Dd {
    return u.dd.automaton<number>({
        init: 0,
        step: (slot, value) => (value === assignment[slot] ? 0 : undefined),
        accept: () => true,
        key: () => 0,
    });
}

// --- conditions ---------------------------------------------------------------

/**
 * The exact counterpart of `refine`: the items of the state on which `pred`
 * holds (or fails, when not `positive`); null when there are none.
 */
export function narrow(state: XItem, pred: RPred, positive = true): XItem | null {
    const m = state.u.dd;
    const c = conditionOf(state.u, pred);
    return stateOf(state.u, positive ? m.and(state.dd, c) : m.diff(state.dd, c));
}

const conditions = new WeakMap<Universe, Map<string, Dd>>();

/**
 * The items of the universe's slots on which the condition holds, as
 * reference/conditions.ts `holds` reads it. Over every assignment, not only
 * the well-formed ones: a state is intersected with it. Cached per universe.
 */
export function conditionOf(u: Universe, pred: RPred): Dd {
    let cache = conditions.get(u);
    if (cache === undefined) conditions.set(u, (cache = new Map<string, Dd>()));
    const key = predKey(pred);
    const hit = cache.get(key);
    if (hit !== undefined) return hit;
    const r = buildCondition(u, pred);
    cache.set(key, r);
    return r;
}

function buildCondition(u: Universe, pred: RPred): Dd {
    const m = u.dd;
    switch (pred.kind) {
        case "isRarity":
            return m.slotIn(u.scalar("rarity"), [u.rarityValue(pred.rarity)]);
        case "has": {
            const slot = u.slotOfType(pred.type);
            if (slot === undefined) return m.EMPTY;
            const tier = pred.tierMod;
            return m.slotIn(
                slot,
                u.valuesWhere(slot, (v) => tier === undefined || v.row.id === tier),
            );
        }
        case "hasGroup": {
            let r = m.EMPTY;
            for (const type of pred.types) {
                const slot = u.slotOfType(type);
                if (slot !== undefined) r = m.or(r, m.slotIn(slot, u.valuesWhere(slot)));
            }
            return r;
        }
        case "hasValue": {
            // A row with no number has no value and fails every comparison; a
            // condition naming a tier holds only at that tier's rows.
            const slot = u.slotOfType(pred.type);
            if (slot === undefined) return m.EMPTY;
            const rows = pred.oneTier ? pred.rows.keys() : undefined;
            return m.slotIn(slot, u.valuesComparing(slot, pred.op, pred.value, rows));
        }
        case "compare":
            return countWhere(
                u,
                pred.projection === "prefixCount" ? "prefix" : "suffix",
                pred.op,
                pred.value,
            );
        case "fractured": {
            const slot = u.slotOfType(pred.type);
            if (slot === undefined) return m.EMPTY;
            return m.slotIn(
                slot,
                u.valuesWhere(slot, (v) => v.fractured),
            );
        }
        case "influenced": {
            const wanted = pred.influence;
            const values: number[] = [];
            u.influenceKeys.forEach((key, i) => {
                const holds =
                    wanted === undefined
                        ? key !== NO_INFLUENCE
                        : influencesOf(key).includes(wanted);
                if (holds) values.push(i);
            });
            return m.slotIn(u.scalar("influences"), values);
        }
        case "corrupted":
            return m.slotIn(u.scalar("corrupted"), [1]);
        case "eldritch": {
            const tierSlot = u.scalar(`${pred.side}Tier`);
            const tiers: number[] = [];
            for (let t = 1; t < m.domains[tierSlot]!; t++) {
                if (pred.tier === undefined || t === pred.tier) tiers.push(t);
            }
            let r = m.slotIn(tierSlot, tiers);
            const wanted = pred.types;
            if (wanted !== undefined) {
                const types: number[] = [];
                u.eldritchTypes(pred.side).forEach((t, i) => {
                    if (t !== undefined && wanted.has(t)) types.push(i);
                });
                r = m.and(r, m.slotIn(u.scalar(`${pred.side}Type`), types));
            }
            return r;
        }
        case "dominant":
            return dominance(u, pred.side);
        case "not":
            return m.not(conditionOf(u, pred.inner));
        case "and":
            return m.and(conditionOf(u, pred.left), conditionOf(u, pred.right));
        case "or":
            return m.or(conditionOf(u, pred.left), conditionOf(u, pred.right));
    }
}

/** The items whose implicit of `side` is dominant: the higher tier, none when
 *  equal (model/marks.ts `dominantOf`). */
export function dominance(u: Universe, side: EldritchSide): Dd {
    const m = u.dd;
    const exarch = u.scalar("exarchTier");
    const eater = u.scalar("eaterTier");
    let r = m.EMPTY;
    for (let a = 0; a < m.domains[exarch]!; a++) {
        const b: number[] = [];
        for (let e = 0; e < m.domains[eater]!; e++) {
            if (dominantOf(eldritchKey(a, e)) === side) b.push(e);
        }
        if (b.length > 0) r = m.or(r, m.and(m.slotIn(exarch, [a]), m.slotIn(eater, b)));
    }
    return r;
}

/** The items whose count of `kind` compares so with `value`. */
export function countWhere(u: Universe, kind: CountKind, op: Cmp, value: number, copy = false): Dd {
    const most = u.modSlots(copy).length;
    let r = u.dd.EMPTY;
    let from: number | undefined;
    for (let n = 0; n <= most + 1; n++) {
        const holds = n <= most && compare(n, op, value);
        if (holds && from === undefined) from = n;
        if (!holds && from !== undefined) {
            r = u.dd.or(r, u.countIn(kind, from, n - 1, copy));
            from = undefined;
        }
    }
    return r;
}

function compare(left: number, op: Cmp, right: number): boolean {
    switch (op) {
        case "==":
            return left === right;
        case "!=":
            return left !== right;
        case "<":
            return left < right;
        case "<=":
            return left <= right;
        case ">":
            return left > right;
        case ">=":
            return left >= right;
    }
}

const sorted = (xs: Iterable<string>): string => [...xs].sort().join(",");

/** A key naming the condition's meaning, for the cache. */
export function predKey(p: RPred): string {
    switch (p.kind) {
        case "isRarity":
            return `rarity(${p.rarity})`;
        case "has":
            return `has(${p.type}${p.tierMod === undefined ? "" : `@${p.tierMod}`})`;
        case "hasGroup":
            return `group(${sorted(p.types)})`;
        case "hasValue":
            return `value(${p.type} ${p.op} ${p.value}${p.oneTier ? ` @${sorted(p.rows.keys())}` : ""})`;
        case "compare":
            return `count(${p.projection} ${p.op} ${p.value})`;
        case "fractured":
            return `fractured(${p.type})`;
        case "influenced":
            return `influenced(${p.influence ?? ""})`;
        case "corrupted":
            return "corrupted";
        case "eldritch":
            return `eldritch(${p.side} ${p.tier ?? ""} ${p.types === undefined ? "*" : sorted(p.types)})`;
        case "dominant":
            return `dominant(${p.side})`;
        case "not":
            return `!${predKey(p.inner)}`;
        case "and":
        case "or":
            return `(${predKey(p.left)} ${p.kind} ${predKey(p.right)})`;
    }
}
