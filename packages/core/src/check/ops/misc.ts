/**
 * The rest: `reroll`, `relax`, `strands`, `imprint`, `restore`, a removal of
 * one type, the Harvest change (that removal and the rows replacing it) and
 * their checks. The rules are reference/ops/misc.ts's, each cited there.
 */
import type { PoolSpec } from "./types.js";
import type { Base } from "../../model/base.js";
import { type ModId, TagId, type TypeId } from "../../model/ids.js";
import type { InfluenceKey } from "../../model/marks.js";
import type { Mod } from "../../model/mod.js";
import type { Registry } from "../../resolve/registry.js";
import { tierLadders } from "../../resolve/tiers.js";
import type { Dd, DdRelation } from "../dd.js";
import { influenceTagsOfKey } from "../influence.js";
import type { ModValue, Universe } from "../universe.js";
import {
    type CheckTable,
    type CompoundTable,
    InternalError,
    type MethodCtx,
    type Outcome,
    outcome,
    type TransformTable,
} from "./handler.js";
import type { RemoveOf } from "./steps.js";

// --- rules shared with the reference ------------------------------------------

/** The base tag of a talisman, the one Rare the Bestiary imprints. */
export const TALISMAN = TagId("talisman");

const movesCache = new WeakMap<Registry, WeakMap<Base, Map<string, readonly Mod[] | undefined>>>();

/**
 * The rows a Tainted Divine Teardrop may move a row to: those of the tier
 * above and of the tier below on its own ladder (resolve/tiers.ts
 * `tierLadders`, under the base's tags and those of the item's influences),
 * rows of one mod level being one tier. Undefined for a row on no ladder: one
 * that cannot normally roll on the item stays.
 */
export function teardropMoves(
    registry: Registry,
    base: Base,
    row: Mod,
    influences: InfluenceKey,
): readonly Mod[] | undefined {
    let byBase = movesCache.get(registry);
    if (byBase === undefined) movesCache.set(registry, (byBase = new WeakMap()));
    let byKey = byBase.get(base);
    if (byKey === undefined)
        byBase.set(base, (byKey = new Map<string, readonly Mod[] | undefined>()));
    const key = `${influences}|${row.id}`;
    if (byKey.has(key)) return byKey.get(key);
    const tags = influenceTagsOfKey(registry, base, influences);
    let out: readonly Mod[] | undefined;
    for (const ladder of tierLadders(registry.catalog, base, row.type, tags).values()) {
        if (!ladder.some((m) => m.id === row.id)) continue;
        const levels = [...new Set(ladder.map((m) => m.minLevel))];
        const at = levels.indexOf(row.minLevel);
        const near = new Set([levels[at - 1], levels[at + 1]]);
        out = ladder.filter((m) => near.has(m.minLevel));
        break;
    }
    byKey.set(key, out);
    return out;
}

/** The most strands a use takes, by the modifier count of the item the method
 *  started on: a list's last entry stands for every count beyond it. */
export function strandsTaken(consume: number | readonly number[], count: number): number {
    if (typeof consume === "number") return consume;
    return consume[Math.min(consume.length - 1, count)] ?? 0;
}

/** The rows a Harvest change makes of a modifier at `row`: the pool's rows for
 *  that row, or all of them where the pool does not say per row; none where
 *  it gives none for the row (the item is then stuck). */
export function changeRows(pool: Extract<PoolSpec, { kind: "rows" }>, row: ModId): readonly Mod[] {
    return pool.bySource === undefined ? pool.mods : (pool.bySource.get(row) ?? []);
}

// --- the symbolic images ----------------------------------------------------------

/** The values of the type's slot a removal of it can take: present, not
 *  fractured, on a side no metamod protects. */
function removableValues(u: Universe, slot: number, ctx: MethodCtx): number[] {
    const prot = ctx.rules.protected;
    return u.valuesWhere(slot, (v) => !v.fractured && !prot.has(v.row.gen));
}

/** The type's modifier gone; an item where it cannot be taken is stuck. */
function removeType(op: RemoveOf<"type">, state: Dd, ctx: MethodCtx): Outcome {
    const { u } = ctx;
    const slot = u.slotOfType(op.selector.type);
    if (slot === undefined) return outcome(u.dd.EMPTY, state);
    const part = u.dd.and(state, u.dd.slotIn(slot, removableValues(u, slot, ctx)));
    return outcome(u.dd.set(part, slot, 0), u.dd.diff(state, part));
}

function harvestChange(
    type: TypeId,
    pool: Extract<PoolSpec, { kind: "rows" }>,
    state: Dd,
    ctx: MethodCtx,
): Outcome {
    const { u } = ctx;
    const m = u.dd;
    const slot = u.slotOfType(type);
    if (slot === undefined) return outcome(m.EMPTY, state);
    // The source values by row and crafted mark: what the replacement reads.
    const groups = new Map<string, { v: ModValue; values: number[] }>();
    for (const value of removableValues(u, slot, ctx)) {
        const v = u.modValue(slot, value)!;
        const key = `${v.row.id}|${v.crafted}`;
        const g = groups.get(key);
        if (g === undefined) groups.set(key, { v, values: [value] });
        else g.values.push(value);
    }
    let out = m.EMPTY;
    // The items some replacement fits: what each image came from, its two
    // slots read back from the item before.
    let acted = m.EMPTY;
    for (const { v, values } of groups.values()) {
        const part = m.and(state, m.slotIn(slot, values));
        if (part === m.EMPTY) continue;
        // A row the pool gives no row for leaves its items stuck.
        const targets = changeRows(pool, v.row.id);
        const gone = m.set(part, slot, 0);
        for (const t of targets) {
            const at = u.asRow(slot, values[0]!, t.id, { fractured: false, crafted: v.crafted });
            if (at === undefined) {
                if (u.rowValues([t.id]).size === 0) {
                    throw new InternalError(`the Harvest change's row ${t.id} is no candidate`);
                }
                continue;
            }
            const room = m.and(gone, m.slotIn(at.slot, [0]));
            const laid = m.and(
                m.and(m.forget(room, [at.slot]), m.slotIn(at.slot, at.values)),
                u.wf,
            );
            if (laid === m.EMPTY) continue;
            out = m.or(out, laid);
            const free = at.slot === slot ? part : m.and(part, m.slotIn(at.slot, [0]));
            acted = m.or(acted, m.and(free, m.forget(laid, [slot, at.slot])));
        }
    }
    return outcome(out, m.diff(state, acted));
}

const relaxRelations = new WeakMap<Universe, Map<string, DdRelation>>();

/** The teardrop's relation on the item's modifier slots for items of one
 *  influence set. */
function relaxRelation(u: Universe, influence: number, crafted: boolean): DdRelation {
    let byKey = relaxRelations.get(u);
    if (byKey === undefined) relaxRelations.set(u, (byKey = new Map<string, DdRelation>()));
    const key = `${influence}|${crafted}`;
    const hit = byKey.get(key);
    if (hit !== undefined) return hit;
    const influences = u.influenceKeys[influence]!;
    const rel = u.modRelation((s, from, at) => {
        const v = s.values[from];
        if (v === undefined || (v.crafted && !crafted)) return undefined;
        const moves = teardropMoves(u.registry, u.base, v.row, influences);
        if (moves === undefined) return undefined;
        const out = [from];
        for (const t of moves) {
            const r = u.asRow(at, from, t.id);
            if (r === undefined) {
                throw new InternalError(`the teardrop's row ${t.id} is no candidate`);
            }
            out.push(...r.values);
        }
        return out;
    });
    byKey.set(key, rel);
    return rel;
}

const pairsCache = new WeakMap<Universe, Dd>();

/** The items whose copy slots equal their own. */
function copied(u: Universe): Dd {
    let r = pairsCache.get(u);
    if (r === undefined) {
        const copy = u.itemSlots(true);
        // Last pair first: each conjunction then builds only above the last.
        const pairs = u.itemSlots().map((s, i) => [s, copy[i]!] as const);
        r = u.dd.equate(pairs.reverse());
        pairsCache.set(u, r);
    }
    return r;
}

const bareCache = new WeakMap<Universe, Dd>();

/** No imprint held: every copy slot and the held slot at 0. */
function noImprint(u: Universe): Dd {
    let r = bareCache.get(u);
    if (r === undefined) {
        r = u.dd.automaton<number>({
            init: 0,
            slots: [...u.itemSlots(true), u.held!],
            step: (_slot, value) => (value === 0 ? 0 : undefined),
            accept: () => true,
            key: () => 0,
        });
        bareCache.set(u, r);
    }
    return r;
}

function needsImprint(u: Universe, what: string): number {
    if (!u.imprint || u.held === undefined) {
        throw new InternalError(`${what} in a universe that holds no imprint`);
    }
    return u.held;
}

export const transforms: TransformTable = {
    "remove:type": {
        reads: ["protected"],
        apply: (op, state, ctx) => removeType(op, state, ctx),
    },
    reroll: {
        reads: ["protected"],
        apply: (_op, state, { u, rules }) =>
            u.dd.mapEach(
                state,
                u.modRelation((s, from, at) => {
                    const v = s.values[from];
                    if (v === undefined || v.fractured || rules.protected.has(v.row.gen)) {
                        return undefined;
                    }
                    return u.rerolled(at, from);
                }),
            ),
    },
    // `crafted: true` moves crafted modifiers too; no method asks for it.
    relax: {
        reads: [],
        apply: (op, state, { u }) => {
            const m = u.dd;
            const slot = u.scalar("influences");
            let out = m.EMPTY;
            for (const i of m.valuesOf(state, slot)) {
                const part = m.and(state, m.slotIn(slot, [i]));
                out = m.or(out, m.mapEach(part, relaxRelation(u, i, op.crafted)));
            }
            // A type with rows on both sides may move a modifier to the other.
            return m.and(out, u.wf);
        },
    },
    strands: {
        reads: [],
        split: (op, u) => {
            if (typeof op.consume === "number") return undefined;
            const last = op.consume.length - 1;
            const most = u.modSlots().length;
            return Array.from({ length: last + 1 }, (_, k) =>
                k < last ? u.countIn("affix", k, k) : u.countIn("affix", last, most),
            );
        },
        apply: (op, state, { u, start }) => {
            const m = u.dd;
            const [lo, hi] = m.extent(start, u.weight("affix")) ?? [0, 0];
            if (typeof op.consume !== "number" && lo !== hi && lo < op.consume.length - 1) {
                throw new InternalError("the strands' start holds items of several counts");
            }
            const most = strandsTaken(op.consume, hi);
            const slot = u.scalar("strands");
            const images = Array.from({ length: m.domains[slot]! }, (_, s) =>
                Array.from({ length: Math.min(s, most) + 1 }, (_, k) => s - k),
            );
            return m.mapEach(state, (at, from) => (at === slot ? images[from] : undefined));
        },
    },
    imprint: {
        reads: [],
        apply: (_op, state, { u }) => {
            const held = needsImprint(u, "an imprint");
            const m = u.dd;
            const r = m.and(m.forget(state, [...u.itemSlots(true), held]), copied(u));
            return m.and(r, m.slotIn(held, [1]));
        },
    },
    restore: {
        reads: [],
        apply: (_op, state, { u }) => {
            const held = needsImprint(u, "a restore");
            const m = u.dd;
            const holding = m.and(state, m.slotIn(held, [1]));
            const moved = m.rename(m.forget(holding, u.itemSlots()), (s) =>
                s === held ? s : s - 1,
            );
            return outcome(m.and(m.forget(moved, [held]), noImprint(u)), m.diff(state, holding));
        },
    },
};

export const compounds: CompoundTable = {
    change: {
        reads: ["protected"],
        apply: (run, state, ctx) =>
            harvestChange(run.remove.selector.type, run.fill.pool, state, ctx),
    },
};

export const checks: CheckTable = {
    typeRemovable: {
        reads: ["protected"],
        verdict: (check, _state, ctx) => {
            const { u } = ctx;
            const m = u.dd;
            const slot = u.slotOfType(check.type);
            const pass =
                slot === undefined ? m.EMPTY : m.slotIn(slot, removableValues(u, slot, ctx));
            return {
                pass,
                word: (_failing, all) => {
                    const mod = check.label;
                    const present =
                        slot === undefined ? m.EMPTY : m.slotIn(slot, u.valuesWhere(slot));
                    if (!m.implies(all.dd, present)) {
                        return { kind: "typeNotRemovable", mod, why: "absent" };
                    }
                    const fractured = m.slotIn(
                        slot!,
                        u.valuesWhere(slot!, (v) => v.fractured),
                    );
                    if (m.implies(all.dd, fractured)) {
                        return { kind: "typeNotRemovable", mod, why: "fractured", sure: true };
                    }
                    if (m.and(all.dd, fractured) !== m.EMPTY) {
                        return { kind: "typeNotRemovable", mod, why: "fractured" };
                    }
                    return { kind: "typeNotRemovable", mod, why: "protected" };
                },
            };
        },
    },
    hasImprint: {
        reads: [],
        verdict: (_check, _state, { u }) => ({
            pass: u.held === undefined ? u.dd.EMPTY : u.dd.slotIn(u.held, [1]),
            word: () => ({ kind: "noImprint" }),
        }),
    },
    imprintable: {
        reads: [],
        verdict: (_check, _state, { u }) => ({
            pass: u.dd.slotIn(u.scalar("rarity"), [
                u.rarityValue("magic"),
                ...(u.base.tags.has(TALISMAN) ? [u.rarityValue("rare")] : []),
            ]),
            word: () => ({ kind: "notImprintable" }),
        }),
    },
};
