/**
 * Fracturing (`lock`) and the bench's and veiled modifiers: the bench, veiled
 * and metamod pools, the unveil, the crafted removal, and their checks. The rules
 * are reference/ops/crafted.ts's, each cited there.
 *
 * - A bench craft, a veiled orb's placeholder and the Bestiary's metamod are
 *   draws from a pool (ops/pools.ts), laid by the fill family's add; a bench
 *   row is laid crafted, as every fresh bench value is (universe.ts
 *   `isFresh`).
 * - The crafted limit is read from the item at the point it is judged, by the
 *   carriers of `craftedCap` on it, not from the rules the method started
 *   under: an item may hold more crafted modifiers than its limit.
 * - An unveil replaces the placeholder in its own image: one of its side's
 *   results whose groups are free takes its place, with its marks.
 */
import type { PoolSpec } from "../../check/ops.js";
import type { Gen, GroupId, TypeId } from "../../model/ids.js";
import { isVeiledPlaceholder } from "../../model/veiled.js";
import type { Dd } from "../dd.js";
import type { ModSlot, Universe } from "../universe.js";
import { capOf, isVeiledRow, metamodRows, placeholderRows, unveilRows } from "./crafted-rows.js";
import { add, readsOfFill } from "./fill.js";
import {
    type CheckTable,
    type CompoundTable,
    InternalError,
    outcome,
    type TransformHandler,
    type TransformTable,
} from "./handler.js";
import { canDraw, type PoolTable, unionOf, whereOf } from "./pools.js";
import type { FillOf } from "./steps.js";

const shares = (a: ReadonlySet<GroupId>, b: ReadonlySet<GroupId>): boolean =>
    [...a].some((f) => b.has(f));

/** The pools this family states. */
export const pools: PoolTable = {
    bench: { rows: (_w, spec) => (spec.kind === "bench" ? [spec.mod] : []) },
    veiledPlaceholder: { rows: (w) => placeholderRows(w) },
    metamods: { rows: (w) => metamodRows(w) },
};

// --- the crafted limit ------------------------------------------------------------

interface Limit {
    readonly cap: number;
    readonly dd: Dd;
}

const limitCache = new WeakMap<Universe, readonly Limit[]>();

/** Every item by its crafted limit: the greatest `craftedCap` its modifiers
 *  carry, one where none does (model/effects.ts `craftedCapOf`). */
export function limits(u: Universe): readonly Limit[] {
    const hit = limitCache.get(u);
    if (hit !== undefined) return hit;
    const m = u.dd;
    const caps = new Set<number>();
    for (const slot of u.modSlots()) for (const r of u.modSlot(slot)!.rows) caps.add(capOf(r));
    caps.add(1);
    const sorted = [...caps].sort((a, b) => b - a);
    const out: Limit[] = [];
    let above = m.EMPTY;
    for (const cap of sorted) {
        const atLeast = cap === 1 ? m.ALL : u.anyMod((v) => capOf(v.row) >= cap);
        out.push({ cap, dd: m.diff(atLeast, above) });
        above = m.or(above, atLeast);
    }
    limitCache.set(u, out);
    return out;
}

const limitOne = (u: Universe): Dd => limits(u).find((l) => l.cap === 1)!.dd;
const crafted = (u: Universe, lo: number, hi: number): Dd => u.countIn("crafted", lo, hi);

/** The items holding fewer crafted modifiers than their limit. */
function belowCap(u: Universe): Dd {
    return unionOf(
        u,
        limits(u).map((l) => u.dd.and(l.dd, crafted(u, 0, l.cap - 1))),
    );
}

// --- the transforms ------------------------------------------------------------------

/** An add from one of this family's pools: the fill family's add. */
function viaFill<
    K extends "fill:bench" | "fill:veiledPlaceholder" | "fill:metamods",
>(): TransformHandler<K> {
    return {
        reads: (op) => readsOfFill(op),
        apply: (op, state, ctx) => {
            if (op.count.kind !== "add") {
                throw new InternalError(`a ${op.count.kind} from the ${op.pool.kind} pool alone`);
            }
            const n = op.count.n;
            return ctx.u.dd.batch(() => add(op, n, state, ctx));
        },
    };
}

/** The unfractured crafted modifiers go. */
function clearCrafted(u: Universe, state: Dd): Dd {
    return u.dd.mapEach(
        state,
        u.modRelation((s, from) => {
            const v = s.values[from];
            return v !== undefined && v.crafted && !v.fractured ? [0] : undefined;
        }),
    );
}

/** One unfractured modifier becomes fractured, any of them. */
function fractureOne(u: Universe, state: Dd): Dd {
    return u.dd.mapOne(
        state,
        u.modRelation((s, from, at) => {
            const v = s.values[from];
            if (v === undefined || v.fractured) return undefined;
            const to = u.withFractured(at, from, true);
            if (to === undefined) throw new InternalError(`${v.row.id} has no fractured value`);
            return [to];
        }),
    );
}

/** The items holding at least `n` modifiers not fractured. */
function unfracturedAtLeast(u: Universe, n: number): Dd {
    return u.dd.automaton<number>({
        init: 0,
        slots: u.modSlots(),
        classes: (slot) => u.classesBy("fractured", slot, (v) => v.fractured),
        step: (slot, value, c) => {
            const v = u.modValue(slot, value);
            return Math.min(n, c + (v !== undefined && !v.fractured ? 1 : 0));
        },
        accept: (c) => c >= n,
        key: (c) => c,
    });
}

/** The slots of the placeholders. */
const placeholderSlots = (u: Universe): number[] =>
    u.modSlots().filter((slot) => isVeiledPlaceholder(u.modSlot(slot)!.type));

/** The placeholder replaced by each result of its side that fits, at any
 *  value, with the placeholder's marks; one of type `target` where named. An
 *  item on which none fits keeps its placeholder. */
function unveil(u: Universe, state: Dd, target: TypeId | undefined): Dd {
    const m = u.dd;
    const w = whereOf(u);
    const out: Dd[] = [];
    for (const p of placeholderSlots(u)) {
        for (const v of u.valuesWhere(p)) {
            const part = m.and(state, m.slotIn(p, [v]));
            if (part === m.EMPTY) continue;
            const cleared = m.set(part, p, 0);
            const gen = u.modValue(p, v)!.row.gen;
            let blocked = m.ALL;
            for (const [type, o] of offers(u, gen)) {
                if (target === undefined || type === target) blocked = m.and(blocked, o.blocked);
            }
            out.push(m.and(part, blocked));
            for (const r of unveilRows(w, gen)) {
                if (target !== undefined && r.type !== target) continue;
                const to = u.asRow(p, v, r.id);
                if (to === undefined) {
                    throw new InternalError(`the unveiled row ${r.id} is no candidate row`);
                }
                const free = m.and(cleared, m.slotIn(to.slot, [0]));
                if (free === m.EMPTY) continue;
                const laid = m.and(m.forget(free, [to.slot]), m.slotIn(to.slot, to.values));
                out.push(m.and(laid, u.wf));
            }
        }
    }
    return unionOf(u, out);
}

export const transforms: TransformTable = {
    "fill:bench": viaFill(),
    "fill:veiledPlaceholder": viaFill(),
    "fill:metamods": viaFill(),
    "fill:unveil": {
        reads: [],
        apply: (op: FillOf<"unveil">, state, { u }) =>
            u.dd.batch(() => unveil(u, state, op.pool.target)),
    },
    "remove:crafted": {
        reads: [],
        apply: (op, state, { u }) => {
            if (!op.selector.replacing) return clearCrafted(u, state);
            // Under a limit of one, the single crafted modifier is replaced; any
            // other item keeps its crafts and the craft adds beside them.
            const m = u.dd;
            const one = m.and(state, m.and(limitOne(u), crafted(u, 1, 1)));
            return m.or(m.diff(state, one), clearCrafted(u, one));
        },
    },
    lock: {
        reads: [],
        apply: (op, state, { u }) =>
            u.dd.batch(() => {
                let cur = state;
                for (let i = 0; i < op.n; i++) cur = fractureOne(u, cur);
                // An influenced item takes no fracture (Fractured item §
                // Mechanics): the library's checks exclude it.
                if (!u.dd.implies(cur, u.wf)) throw new InternalError("a fracture is ill-formed");
                return outcome(cur, u.dd.diff(state, unfracturedAtLeast(u, op.n)));
            }),
    },
};

export const compounds: CompoundTable = {};

// --- the checks ---------------------------------------------------------------------

interface Offer {
    readonly families: ReadonlySet<GroupId>;
    /** The items on which a present modifier other than a placeholder claims
     *  one of its groups. */
    readonly blocked: Dd;
}

const offerCache = new WeakMap<Universe, Map<Gen, ReadonlyMap<TypeId, Offer>>>();

/** The results of a side by type. */
function offers(u: Universe, gen: Gen): ReadonlyMap<TypeId, Offer> {
    let byGen = offerCache.get(u);
    if (byGen === undefined)
        offerCache.set(u, (byGen = new Map<Gen, ReadonlyMap<TypeId, Offer>>()));
    const hit = byGen.get(gen);
    if (hit !== undefined) return hit;
    const out = new Map<TypeId, Offer>();
    byGen.set(gen, out);
    for (const r of unveilRows(whereOf(u), gen)) {
        if (out.has(r.type)) continue;
        out.set(r.type, {
            families: r.families,
            blocked: u.anyMod(
                (_v, s) => !isVeiledPlaceholder(s.type) && shares(s.families, r.families),
            ),
        });
    }
    return out;
}

/** By how many of the side's results are offered, the items, the last entry
 *  standing for `cap` or more. */
function offerCounts(u: Universe, gen: Gen, cap: number): Dd[] {
    const m = u.dd;
    let exact: Dd[] = [m.ALL, ...new Array<Dd>(cap).fill(m.EMPTY)];
    for (const { blocked } of offers(u, gen).values()) {
        const next = exact.map((d) => m.and(d, blocked));
        exact.forEach((d, j) => {
            const k = Math.min(j + 1, cap);
            next[k] = m.or(next[k]!, m.diff(d, blocked));
        });
        exact = next;
    }
    return exact;
}

const placeholderOn = (u: Universe, gen: Gen): Dd =>
    u.anyMod((v, s) => isVeiledPlaceholder(s.type) && v.row.gen === gen);

/** The items whose placeholder offers the type among its results. */
function offering(u: Universe, type: TypeId): Dd {
    const m = u.dd;
    const sides: Dd[] = [];
    for (const gen of ["prefix", "suffix"] as const) {
        const offer = offers(u, gen).get(type);
        if (offer !== undefined) sides.push(m.diff(placeholderOn(u, gen), offer.blocked));
    }
    return unionOf(u, sides);
}

/** The items on which the type, offered, is sure to be shown: three options
 *  are shown (Veiled modifier), so three or fewer must be offered, and an
 *  option closes every result sharing its group, so no other offered one may
 *  share the type's (as cost/roll.ts `offerSetsOf` draws them). */
function guaranteed(u: Universe, type: TypeId): Dd {
    const m = u.dd;
    return unionOf(
        u,
        (["prefix", "suffix"] as const).map((gen) => {
            const all = offers(u, gen);
            const own = all.get(type);
            if (own === undefined) return m.EMPTY;
            let out = m.and(placeholderOn(u, gen), unionOf(u, offerCounts(u, gen, 4).slice(0, 4)));
            for (const [t, o] of all) {
                if (t !== type && shares(o.families, own.families)) out = m.and(out, o.blocked);
            }
            return out;
        }),
    );
}

/** The most results offered on any of the items. */
function mostOffered(u: Universe, items: Dd): number {
    const m = u.dd;
    let most = 0;
    for (const gen of ["prefix", "suffix"] as const) {
        const on = m.and(items, placeholderOn(u, gen));
        if (on === m.EMPTY) continue;
        const counts = offerCounts(u, gen, offers(u, gen).size);
        counts.forEach((d, j) => {
            if (m.and(on, d) !== m.EMPTY) most = Math.max(most, j);
        });
    }
    return most;
}

const isFractured = (u: Universe): Dd => u.countIn("fractured", 1, u.modSlots().length);

export const checks: CheckTable = {
    atLeast: {
        reads: [],
        verdict: (check, _state, { u }) => ({
            pass: u.countIn("affix", check.count, Math.max(check.count, u.modSlots().length)),
            word: () => ({
                kind: "tooFewMods",
                needed: check.count,
                ...(check.what !== undefined && { what: check.what }),
            }),
        }),
    },
    noFracture: {
        reads: [],
        verdict: (check, _state, { u }) => ({
            pass: u.dd.not(isFractured(u)),
            word: (failing, all) => ({
                kind: "alreadyFractured",
                sure: failing.dd === all.dd,
                ...(check.what !== undefined && { what: check.what }),
            }),
        }),
    },
    craftedBelowCap: {
        reads: [],
        verdict: (check, _state, { u }) => ({
            pass: belowCap(u),
            word: (failing) => ({
                kind: "craftedLimit",
                cap: Math.min(
                    ...limits(u)
                        .filter((l) => u.dd.and(failing.dd, l.dd) !== u.dd.EMPTY)
                        .map((l) => l.cap),
                ),
                ...(check.refusal !== undefined && { refusal: check.refusal }),
            }),
        }),
    },
    craftedRemovable: {
        reads: [],
        verdict: (_check, _state, { u }) => ({
            pass: u.anyMod((v) => v.crafted && !v.fractured),
            word: () => ({ kind: "noCraftedToRemove" }),
        }),
    },
    craftedReplaceable: {
        reads: [],
        verdict: (_check, _state, { u }) => {
            const m = u.dd;
            const fracturedCraft = u.anyMod((v) => v.crafted && v.fractured);
            const many = crafted(u, 2, u.modSlots().length);
            return {
                pass: m.or(
                    m.not(limitOne(u)),
                    m.or(crafted(u, 0, 0), m.diff(crafted(u, 1, 1), fracturedCraft)),
                ),
                word: (failing) =>
                    m.and(failing.dd, many) !== m.EMPTY
                        ? { kind: "craftedMultiple" }
                        : { kind: "craftedFractured" },
            };
        },
    },
    noGroupConflict: {
        reads: [],
        verdict: (check, _state, { u }) => {
            const m = u.dd;
            const clashing = u
                .modSlots()
                .filter((slot) => {
                    const s: ModSlot = u.modSlot(slot)!;
                    return s.type !== check.replacing && shares(s.families, check.mod.families);
                })
                .map((slot) => ({
                    type: u.modSlot(slot)!.type,
                    on: m.slotIn(slot, u.valuesWhere(slot)),
                }));
            return {
                pass: m.not(
                    unionOf(
                        u,
                        clashing.map((c) => c.on),
                    ),
                ),
                word: (failing, all) => {
                    const sure = clashing.find((c) => m.implies(all.dd, c.on));
                    const among = sure
                        ? [sure]
                        : clashing.filter((c) => m.and(failing.dd, c.on) !== m.EMPTY);
                    return {
                        kind: "modConflict",
                        group: u.registry.typeLabel(check.mod.type),
                        sure: sure !== undefined,
                        among: among
                            .filter((c) => c.type !== check.mod.type)
                            .map((c) => u.registry.typeLabel(c.type)),
                        ...(check.refusal !== undefined && { refusal: check.refusal }),
                    };
                },
            };
        },
    },
    metamodFits: {
        reads: [],
        verdict: (_check, state, ctx) => {
            const spec: PoolSpec = { kind: "metamods" };
            const dc = { u: ctx.u, cut: false, pools: ctx.pools ?? {} };
            return {
                pass: ctx.u.dd.batch(() => canDraw(state, spec, dc)),
                word: () => ({ kind: "noMetamodFits" }),
            };
        },
    },
    veiledPresent: {
        reads: [],
        verdict: (_check, _state, { u }) => ({
            pass: u.anyMod((_v, s) => isVeiledPlaceholder(s.type)),
            word: () => ({ kind: "noVeiledMod" }),
        }),
    },
    noVeiled: {
        reads: [],
        verdict: (_check, _state, { u }) => ({
            pass: u.dd.not(u.anyMod((v) => isVeiledRow(v.row, true))),
            word: () => ({ kind: "alreadyVeiled" }),
        }),
    },
    noVeiledKept: {
        reads: ["protected"],
        verdict: (_check, _state, { u, rules }) => ({
            pass: u.dd.not(
                u.anyMod(
                    (v) =>
                        isVeiledRow(v.row, false) &&
                        (v.fractured || rules.protected.has(v.row.gen)),
                ),
            ),
            word: () => ({ kind: "veiledWouldSurvive" }),
        }),
    },
    unveilTarget: {
        reads: [],
        verdict: (check, _state, { u }) => {
            const m = u.dd;
            const offered = offering(u, check.type);
            return {
                pass: m.and(offered, guaranteed(u, check.type)),
                word: (failing) =>
                    m.diff(failing.dd, offered) !== m.EMPTY
                        ? { kind: "unveilNotAvailable", mod: check.name }
                        : {
                              kind: "unveilNotGuaranteed",
                              mod: check.name,
                              options: mostOffered(u, failing.dd),
                          },
            };
        },
    },
};
