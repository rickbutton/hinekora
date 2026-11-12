/**
 * Adding modifiers: a fill from the natural, tagged, fossil, essence,
 * influence and plain rows pools, a reforge with what it guarantees, and the
 * pool checks. The rules are reference/ops/fill.ts's, each cited there; a fill
 * of several modifiers is the single draw (pools.ts `drawOne`) repeated, or,
 * for a reforge whose pool holds still while it is laid (`poolHoldsStill`),
 * every number of its rows laid at once, which reaches the same items.
 */
import type { FillCount, PoolSpec } from "./types.js";
import { holdsFour, maxTotal } from "../../model/capacity.js";
import type { Rarity } from "../../model/ids.js";
import type { Mod } from "../../model/mod.js";
import type { Dd } from "../dd.js";
import type { XItem } from "../state.js";
import { RARITIES, type Universe } from "../universe.js";
import { rarities } from "../views.js";
import {
    type CheckTable,
    type CompoundTable,
    InternalError,
    type MethodCtx,
    NotImplementedError,
    type RuleField,
    type TransformHandler,
    type TransformTable,
} from "./handler.js";
import {
    addAnyOf,
    addOneOf,
    canDraw,
    canTake,
    type DrawCase,
    drawAtoms,
    drawCases,
    type DrawCtx,
    drawCtxOf,
    drawOne,
    essenceRow,
    poolHoldsStill,
    unionOf,
    whereOf,
} from "./pools.js";
import type { CompoundOf, FillOp } from "./steps.js";

type ReforgeOp = FillOp & { readonly count: Extract<FillCount, { kind: "reforge" }> };

/**
 * The least and most modifiers a reforge leaves on an item of the rarity, the
 * rarity's cap holding both (item-model.md §7): a Rare four to six (Chaos Orb
 * § Mechanics), three or four on a base whose Rare holds four (Orb of Alchemy:
 * "three to four if used on jewels"); by rarity, a Magic item one or two (Orb
 * of Transmutation § Spending) and a Normal one none.
 */
export function reforgeTotals(
    n: Extract<FillCount, { kind: "reforge" }>["n"],
    rarity: Rarity,
    base: Universe["base"],
): readonly [number, number] {
    const four = (r: readonly [number, number]): readonly [number, number] =>
        holdsFour(base) && r[0] >= 4 ? [3, 4] : r;
    const range: readonly [number, number] =
        n !== "byRarity"
            ? four(n)
            : rarity === "normal"
              ? [0, 0]
              : rarity === "magic"
                ? [1, 2]
                : four([4, 6]);
    const cap = maxTotal(rarity, base);
    return [Math.min(range[0], cap), Math.min(range[1], cap)];
}

/** An add's draws on an item of the rarity, held to what it can hold. */
export function addDraws(
    n: readonly [number, number],
    rarity: Rarity,
    base: Universe["base"],
): readonly [number, number] {
    const cap = maxTotal(rarity, base);
    return [Math.min(n[0], cap), Math.min(n[1], cap)];
}

const atLeast = (u: Universe, n: number): Dd => u.countIn("affix", n, u.modSlots().length);
const fewerThan = (u: Universe, n: number): Dd =>
    n <= 0 ? u.dd.EMPTY : u.countIn("affix", 0, n - 1);
const atMost = (u: Universe, n: number): Dd => u.countIn("affix", 0, n);

/** The state by rarity: the counts read it. */
function byRarity(u: Universe, state: Dd): [Rarity, Dd][] {
    const slot = u.scalar("rarity");
    return u.dd
        .valuesOf(state, slot)
        .map((r) => [RARITIES[r]!, u.dd.and(state, u.dd.slotIn(slot, [r]))]);
}

/** `add`: from `lo` to `hi` draws, each from the item as it stands; an item
 *  on which the draws run dry before `lo` has no outcome, reported stuck. */
export function add(
    op: FillOp,
    n: readonly [number, number],
    state: Dd,
    ctx: MethodCtx,
): { image: Dd; stuck: Dd } {
    const { u } = ctx;
    const m = u.dd;
    const dc = drawCtxOf(ctx);
    const out: Dd[] = [];
    let stuck = m.EMPTY;
    for (const [rarity, part] of byRarity(u, state)) {
        const [lo, hi] = addDraws(n, rarity, u.base);
        let cur = part;
        for (let j = 0; j < hi && cur !== m.EMPTY; j++) {
            if (j >= lo) out.push(cur);
            const d = drawOne(cur, op.pool, dc);
            if (j < lo && d.dry !== m.EMPTY) {
                // A path dry after a draw is an item the add made, not one it
                // was given: which input it came from is not kept.
                if (j > 0)
                    throw new NotImplementedError("an add whose floor is more than one draw");
                stuck = m.or(stuck, d.dry);
            }
            cur = d.drawn;
        }
        out.push(cur);
    }
    return { image: unionOf(u, out), stuck };
}

export type ReforgeMode = "auto" | "loop" | "closure";

/**
 * A reforge, the guaranteed rows laid first, each from its own pool. With no
 * side kept an item is an outcome once its total reaches the least and draws
 * go on to the most; with a side kept it is one too once a modifier was laid.
 * `mode` is for the tests: "closure" lays the pool's rows at once whether or
 * not the pool holds still, "loop" draws one at a time.
 */
export function reforgeImage(
    op: ReforgeOp,
    forced: readonly FillOp[],
    state: Dd,
    ctx: MethodCtx,
    mode: ReforgeMode = "auto",
): Dd {
    const { u } = ctx;
    const m = u.dd;
    const dc = drawCtxOf(ctx);
    const kept = ctx.rules.protected.size > 0;
    const out: Dd[] = [];
    for (const [rarity, part] of byRarity(u, state)) {
        const [least, most] = reforgeTotals(op.count.n, rarity, u.base);
        // `fresh`: no modifier laid yet; `laid`: one at least.
        let fresh = part;
        let laid = m.EMPTY;
        for (const f of forced) {
            const a = drawOne(fresh, f.pool, dc);
            const b = drawOne(laid, f.pool, dc);
            laid = unionOf(u, [a.drawn, b.drawn, b.dry]);
            fresh = a.dry;
        }
        const start = kept ? fresh : m.or(fresh, laid);
        // Already at the most, or drawn dry: the reforge lays nothing more.
        out.push(m.and(start, atLeast(u, least)));
        if (kept) out.push(m.and(laid, atLeast(u, most)));
        // The items on whose part of the state the pool holds still are laid at
        // once; a row laid there keeps the item in its part.
        let still = m.EMPTY;
        if (mode === "closure") still = m.ALL;
        else if (mode === "auto") {
            const parts = drawAtoms(m.or(fresh, laid), op.pool, dc).map((a) => a.dd);
            still = unionOf(
                u,
                parts.filter((d) => poolHoldsStill(d, op.pool, dc)),
            );
        }
        const room = m.and(start, fewerThan(u, most));
        const [roomStill, roomMoves] = [m.and(room, still), m.diff(room, still)];
        const [laidStill, laidMoves] = [m.and(laid, still), m.diff(laid, still)];
        if (kept) {
            out.push(...keptClosure(roomStill, laidStill, most, op, dc));
            out.push(...keptLoop(roomMoves, laidMoves, most, op, dc));
        } else {
            out.push(...freeClosure(roomStill, least, most, op, dc));
            out.push(...freeLoop(roomMoves, least, most, op, dc));
        }
    }
    return unionOf(u, out);
}

function freeLoop(cur: Dd, least: number, most: number, op: FillOp, dc: DrawCtx): Dd[] {
    const { u } = dc;
    const m = u.dd;
    const out: Dd[] = [];
    while (cur !== m.EMPTY) {
        const d = drawOne(cur, op.pool, dc);
        out.push(d.dry);
        out.push(m.and(d.drawn, atLeast(u, least)));
        cur = m.and(d.drawn, fewerThan(u, most));
    }
    return out;
}

function keptLoop(fresh: Dd, laid: Dd, most: number, op: FillOp, dc: DrawCtx): Dd[] {
    const { u } = dc;
    const m = u.dd;
    const first = drawOne(fresh, op.pool, dc);
    const out: Dd[] = [first.dry];
    let cur = m.or(m.and(laid, fewerThan(u, most)), first.drawn);
    while (cur !== m.EMPTY) {
        out.push(cur);
        cur = drawOne(m.and(cur, fewerThan(u, most)), op.pool, dc).drawn;
    }
    return out;
}

/** Every number of the atom's rows at once: the items between the least and
 *  the most, and those below the least on which no row fits. */
function freeClosure(state: Dd, least: number, most: number, op: FillOp, dc: DrawCtx): Dd[] {
    const { u } = dc;
    const m = u.dd;
    return drawAtoms(state, op.pool, dc).map((a) => {
        const all = m.and(addAnyOf(u, a.dd, a.rows), atMost(u, most));
        const done = m.and(all, atLeast(u, least));
        const dry = m.diff(m.and(all, fewerThan(u, least)), canTake(u, a.rows));
        return m.or(done, dry);
    });
}

/** With a side kept: the items one draw or more leaves, up to the most, and
 *  those on which no row fits from the start. */
function keptClosure(fresh: Dd, laid: Dd, most: number, op: FillOp, dc: DrawCtx): Dd[] {
    const { u } = dc;
    const m = u.dd;
    const out: Dd[] = [];
    for (const a of drawAtoms(m.or(fresh, laid), op.pool, dc)) {
        const fits = canTake(u, a.rows);
        const f = m.and(a.dd, fresh);
        out.push(m.diff(f, fits));
        const once = m.or(
            addOneOf(u, m.and(f, fits), a.rows),
            m.and(m.and(a.dd, laid), fewerThan(u, most)),
        );
        out.push(m.and(addAnyOf(u, once, a.rows), atMost(u, most)));
    }
    return out;
}

function fill<K extends `fill:${OwnKind}`>(): TransformHandler<K> {
    return {
        reads: readsOfFill,
        apply: (op, state, ctx) =>
            ctx.u.dd.batch(() => {
                switch (op.count.kind) {
                    case "add":
                        return add(op, op.count.n, state, ctx);
                    case "reforge":
                        return reforgeImage(op as ReforgeOp, [], state, ctx);
                    case "within":
                        throw new InternalError(
                            "a fill of what is already counted outside a reforge",
                        );
                }
            }),
    };
}

type OwnKind = "natural" | "tagged" | "fossil" | "essenceGrant" | "influence" | "rows";
/** A reforge reads the sides kept and an add does not; both read whether the
 *  method uses memory strands up. */
export function readsOfFill(op: FillOp): readonly RuleField[] {
    return op.count.kind === "add" ? ["strands"] : READS;
}

const READS: readonly RuleField[] = ["protected", "strands"];

export const transforms: TransformTable = {
    "fill:natural": fill(),
    "fill:tagged": fill(),
    "fill:fossil": fill(),
    "fill:essenceGrant": fill(),
    "fill:influence": fill(),
    "fill:rows": fill(),
};

export const compounds: CompoundTable = {
    reforgeWith: {
        reads: READS,
        apply: (run: CompoundOf<"reforgeWith">, state, ctx) =>
            ctx.u.dd.batch(() => reforgeImage(run.reforge, run.within, state, ctx)),
    },
};

// --- the checks -----------------------------------------------------------------

/** The items on which a present modifier's type or group takes the row. */
function takenBy(u: Universe, row: Mod): Dd {
    const m = u.dd;
    let r = m.EMPTY;
    for (const slot of u.modSlots()) {
        const s = u.modSlot(slot)!;
        if (s.type === row.type || [...s.families].some((f) => row.families.has(f))) {
            r = m.or(r, m.slotIn(slot, u.valuesWhere(slot)));
        }
    }
    return r;
}

type HarvestFailure = "harvestEmptyPool" | "harvestCannotRoll" | "harvestBlocked" | "harvestNoRoom";

/**
 * Why no row of a tagged or influence pool lands on the items, the most basic
 * reason first, as the grove words it: no row of the base's pool carries the
 * tag; a cannot-roll metamod on the item bars every one; a present
 * modifier's type or group takes every one; no room on their sides.
 */
function whyEmpty(failing: Dd, pool: PoolSpec, dc: DrawCtx): HarvestFailure {
    const { u } = dc;
    const m = u.dd;
    if (pool.kind !== "tagged" && pool.kind !== "influence") return "harvestEmptyPool";
    const offered = (cases: readonly DrawCase[]): Dd =>
        unionOf(
            u,
            cases.map((c) => c.dd),
        );
    const cases = drawCases(failing, pool, dc);
    if (offered(drawCases(failing, pool, { ...dc, unrestricted: true })) !== failing) {
        return "harvestEmptyPool";
    }
    if (offered(cases) !== failing) return "harvestCannotRoll";
    let taken = failing;
    for (const c of cases) {
        let all = m.ALL;
        for (const r of c.rows) all = m.and(all, takenBy(u, r));
        taken = m.diff(taken, m.diff(c.dd, all));
    }
    return taken !== m.EMPTY ? "harvestBlocked" : "harvestNoRoom";
}

export const checks: CheckTable = {
    openSlot: {
        reads: [],
        verdict: (check, _state, { u }) => ({
            pass: u.openSlot(check.gen),
            word: (_failing, all) => {
                const r = rarities(all);
                return {
                    kind: "noOpenSlot",
                    ...(check.gen !== undefined && { gen: check.gen }),
                    ...(r.size === 1 && r.has("normal") && { normal: true as const }),
                };
            },
        }),
    },
    poolNonEmpty: {
        reads: ["strands"],
        verdict: (check, state, ctx) => {
            const dc = drawCtxOf(ctx);
            return {
                pass: ctx.u.dd.batch(() => canDraw(state, check.pool, dc)),
                word: (failing: XItem) => ({
                    kind: whyEmpty(failing.dd, check.pool, dc),
                    tag: check.tag,
                }),
            };
        },
    },
    noBlockingMetamod: {
        reads: ["blocksSourced"],
        verdict: (_check, _state, { u, rules }) => ({
            pass: rules.blocksSourced ? u.dd.EMPTY : u.dd.ALL,
            word: () => ({ kind: "metamodBlocks" }),
        }),
    },
    fossilAllowed: {
        reads: [],
        verdict: (check, _state, { u }) => {
            const allowed = check.fossil.allowedTags;
            const ok = allowed === undefined || [...u.base.tags].some((t) => allowed.has(t));
            return {
                pass: ok ? u.dd.ALL : u.dd.EMPTY,
                word: () => ({ kind: "fossilBaseRestricted", fossil: check.fossil.name }),
            };
        },
    },
    essenceRarity: {
        reads: [],
        verdict: (check, _state, { u }) => ({
            // A Normal item, or a Rare one from the fifth tier up (Essence §
            // Crafting).
            pass: u.dd.slotIn(u.scalar("rarity"), [
                u.rarityValue("normal"),
                ...(check.tier >= 5 ? [u.rarityValue("rare")] : []),
            ]),
            word: (_failing, all) => ({
                kind: "essenceRarity",
                tier: check.tier,
                actual: rarities(all),
            }),
        }),
    },
    essenceGrant: {
        reads: [],
        verdict: (check, _state, { u }) => ({
            pass: essenceRow(whereOf(u), check.spec) === undefined ? u.dd.EMPTY : u.dd.ALL,
            word: () => ({
                kind: "essenceClass",
                essence: check.spec.name,
                itemClass: u.base.itemClass,
            }),
        }),
    },
};
