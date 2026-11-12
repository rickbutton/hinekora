/**
 * The exactness harness (docs/ARCHITECTURE.md §4.5): states over a tiny catalogue, and
 * the comparison of the symbolic frame with the reference on a method. Test
 * support.
 *
 * Both sides are compared at the value cells: an item stands for every item
 * that differs from it only within its cells, which no condition of the craft
 * tells apart. So the reference's items are read at their cells (`atCells`)
 * and the diagrams are listed at the lowest value of each cell. That assumes
 * no operation reads a value finer than its cell: one that does (a reroll
 * to a part of a cell, say) must be given the cuts it reads (`cellCuts`).
 *
 * Keeping a test fast: the listing is exponential in the rows, so give a
 * state three to five rows (`pickRows`), one value per cell (no comparisons,
 * or few), and only the marks the operation reads in its bounds; twenty to
 * forty random states of a few dozen items each run in well under a second.
 */
import type { Cmp } from "../../ast/ast.js";
import type { RPred } from "../pred.js";
import type { Op } from "../ops/types.js";
import { rollRange } from "../values.js";
import { canBeRare } from "../../model/capacity.js";
import { type Gen, type ModId, type Rarity, TypeId } from "../../model/ids.js";
import { type EldritchSide, INFLUENCES, type InfluenceKey } from "../../model/marks.js";
import type { Mod } from "../../model/mod.js";
import type { Comparisons } from "../craft.js";
import { NO_COMPARISONS } from "../craft.js";
import { runMethodTrace } from "../method.js";
import type { Handlers } from "../ops/handler.js";
import { candidateRows } from "../rows.js";
import { fromItems } from "../state.js";
import { RARITIES, Universe, type UniverseOptions } from "../universe.js";
import type { Catalog } from "./catalog.js";
import type { CItem, RefCtx } from "./item.js";
import { listItems } from "./listing.js";
import { refRunMethod } from "./method.js";
import type { RefHandlers } from "./ops/handler.js";
import { type Rng, rng } from "./rng.js";
import { allItems, type Bounds, diffSets, ItemSet } from "./sets.js";

// --- the universe and its rows -------------------------------------------------------

export interface HarnessOptions extends UniverseOptions {
    /** The value comparisons the universe's cells are cut for. */
    readonly comparisons?: Comparisons;
}

/** The universe of a catalogue with no craft, cut for these comparisons. */
export function harnessUniverse(cat: Catalog, options: HarnessOptions = {}): Universe {
    const rows = candidateRows(cat.registry, cat.base, cat.ilvl, undefined);
    return new Universe(
        cat.registry,
        cat.base,
        cat.ilvl,
        rows,
        options.comparisons ?? NO_COMPARISONS,
        options.imprint ?? false,
        options,
    );
}

/**
 * `count` candidate rows of distinct types, chosen by the seed: `include`
 * first, then rows of both sides where the universe has them. Few rows keep
 * the listings small; a type's other rows are left out unless named.
 */
export function pickRows(
    u: Universe,
    seed: number,
    count: number,
    include: readonly ModId[] = [],
): ModId[] {
    const r = rng(seed);
    const all = [...u.rows.keys()];
    const out: Mod[] = include.map((id) => {
        const m = all.find((x) => x.id === id);
        if (m === undefined) throw new Error(`${id} is not a candidate row`);
        return m;
    });
    const free = (m: Mod): boolean => !out.some((x) => x.type === m.type);
    for (const gen of ["prefix", "suffix"] as const) {
        const side = all.filter((m) => m.gen === gen && free(m));
        if (out.length < count && side.length > 0 && !out.some((m) => m.gen === gen)) {
            out.push(r.pick(side));
        }
    }
    for (const m of r.sample(all, all.length)) if (out.length < count && free(m)) out.push(m);
    return out.map((m) => m.id);
}

// --- states ---------------------------------------------------------------------------

/** The items read at their cells: each value moved to the lowest of its cell. */
export function atCells(u: Universe, items: Iterable<CItem>): ItemSet {
    return ItemSet.of([...items].map((x) => u.decodeOne(u.encode(x))));
}

export interface StateOptions {
    /** What the items vary; `rows` is required. Rarities default to those the
     *  base can have. */
    readonly bounds: Bounds;
    /** How many random subsets; 20 by default. */
    readonly random?: number;
    /** The most items a random subset holds; 40 by default. */
    readonly maxSize?: number;
    /** Some items hold an imprint of another item of the bounds (the
     *  universe must have the imprint's slots). */
    readonly imprints?: boolean;
}

/**
 * States over the items of the bounds, read at their cells: one item, every
 * item, the items of each rarity, and random subsets of random sizes.
 */
export function harnessStates(
    u: Universe,
    ctx: RefCtx,
    seed: number,
    options: StateOptions,
): ItemSet[] {
    const rarities =
        options.bounds.rarities ?? RARITIES.filter((x) => x !== "rare" || canBeRare(ctx.base));
    const r = rng(seed);
    let pool = atCells(u, allItems(ctx, { ...options.bounds, rarities }));
    if (options.imprints) {
        const plain = pool.items();
        pool = pool.union(
            ItemSet.of(
                r
                    .sample(plain, Math.min(60, plain.length))
                    .map((x) => ({ ...x, imprint: r.pick(plain) })),
            ),
        );
    }
    const items = pool.items();
    if (items.length === 0) throw new Error("the bounds hold no item");
    const out: ItemSet[] = [ItemSet.of([r.pick(items)]), pool];
    for (const rarity of rarities) {
        const some = pool.filter((x) => x.rarity === rarity);
        if (some.size > 0) out.push(some);
    }
    const most = Math.min(options.maxSize ?? 40, items.length);
    for (let i = 0; i < (options.random ?? 20); i++) {
        out.push(ItemSet.of(r.sample(items, r.int(1, most))));
    }
    return out;
}

// --- the comparison --------------------------------------------------------------------

export interface FrameHandlers {
    readonly exact?: Handlers;
    readonly reference?: RefHandlers;
}

/**
 * Run the method on the items both ways and say how the two differ: whether
 * it is refused, which items each `require` refuses, whether it ends, and the
 * items it leaves. The empty string when they agree.
 */
export function compareMethod(
    u: Universe,
    ctx: RefCtx,
    start: ItemSet,
    ops: readonly Op[],
    handlers: FrameHandlers = {},
): string {
    const items = atCells(u, start);
    const state = fromItems(u, items);
    if (state === null) throw new Error("compareMethod needs at least one item");
    const exact = runMethodTrace(state, ops, handlers.exact);
    const ref = refRunMethod(items, ops, ctx, handlers.reference);
    const out: string[] = [];
    if (exact.result.ok !== ref.ok)
        out.push(`refused: exact ${!exact.result.ok}, reference ${!ref.ok}`);
    const under = (xs: readonly TypeId[] | undefined): string => [...(xs ?? [])].sort().join(",");
    const exactUnder = exact.result.ok ? undefined : exact.result.under;
    if (under(exactUnder) !== under(ref.under)) {
        out.push(`under: exact [${under(exactUnder)}], reference [${under(ref.under)}]`);
    }
    if ((exact.result.ended === true) !== ref.ended) {
        out.push(`ended: exact ${exact.result.ended === true}, reference ${ref.ended}`);
    }
    const indices = new Set([...exact.failing.keys(), ...ref.failing.keys()]);
    for (const i of [...indices].sort((a, b) => a - b)) {
        const d = diffSets(
            atCells(u, ref.failing.get(i) ?? ItemSet.empty),
            listItems(u, exact.failing.get(i) ?? u.dd.EMPTY, { lowest: true }),
        );
        if (d !== "") out.push(`items refused by op ${i} (${opLabel(ops[i]!)}):\n${d}`);
    }
    if (!u.dd.implies(exact.result.state.dd, u.wfWithImprint))
        out.push("the result holds an ill-formed item");
    const d = diffSets(
        atCells(u, ref.state),
        listItems(u, exact.result.state.dd, { lowest: true }),
    );
    if (d !== "") out.push(`items left:\n${d}`);
    if (out.length === 0) return "";
    return [`${ops.map(opLabel).join("; ")} on ${items.size} items:`, ...out].join("\n");
}

/** The first difference over the states, or the empty string. */
export function compareMethodOn(
    u: Universe,
    ctx: RefCtx,
    states: readonly ItemSet[],
    ops: readonly Op[],
    handlers: FrameHandlers = {},
): string {
    for (const s of states) {
        const d = compareMethod(u, ctx, s, ops, handlers);
        if (d !== "") return d;
    }
    return "";
}

function opLabel(op: Op): string {
    if (op.kind === "require") return `require ${op.check.kind}`;
    if (op.kind === "either") {
        return `either(${op.branches.map((b) => `[${b.map(opLabel).join(", ")}]`).join(" | ")})`;
    }
    return op.kind;
}

// --- random conditions -------------------------------------------------------------------

/** What random conditions are drawn over: the universe's rows by type. */
export interface PredSpace {
    readonly rows: ReadonlyMap<TypeId, readonly Mod[]>;
    readonly eldritch: Readonly<Record<EldritchSide, readonly TypeId[]>>;
}

export function predSpace(cat: Catalog, rows: Iterable<Mod>): PredSpace {
    const byType = new Map<TypeId, Mod[]>();
    for (const m of rows) byType.set(m.type, [...(byType.get(m.type) ?? []), m]);
    const side = (s: EldritchSide): TypeId[] => [
        ...new Set(cat.eldritch.filter((e) => e.side === s).map((e) => e.type)),
    ];
    return { rows: byType, eldritch: { exarch: side("exarch"), eater: side("eater") } };
}

const CMPS: readonly Cmp[] = ["==", "!=", "<", "<=", ">", ">="];

/**
 * A random condition of depth at most `depth`, of every kind. A value
 * comparison names thresholds in and around its rows' spans; `comparisonsOf`
 * reads them back, to cut the universe the condition is judged over.
 */
export function randomPred(space: PredSpace, r: Rng, depth = 2): RPred {
    const types = [...space.rows.keys()];
    const kinds = [
        "isRarity",
        "has",
        "hasGroup",
        "hasValue",
        "compare",
        "fractured",
        "influenced",
        "corrupted",
        "eldritch",
        "dominant",
        ...(depth > 0 ? ["not", "and", "or"] : []),
    ] as const;
    const kind = r.pick(kinds);
    const type = r.pick(types);
    const gen: Gen = space.rows.get(type)![0]!.gen;
    switch (kind) {
        case "isRarity":
            return { kind, rarity: r.pick<Rarity>(RARITIES) };
        case "has": {
            const rows = space.rows.get(type)!;
            return r.chance(0.4)
                ? { kind, type, gen, tierMod: r.pick(rows).id }
                : { kind, type, gen };
        }
        case "hasGroup":
            return { kind, type, types: new Set([type, ...r.sample(types, r.int(0, 2))]) };
        case "hasValue": {
            const rows = space.rows.get(type)!;
            const spans = new Map<ModId, readonly [number, number]>();
            const unnumbered = new Set<ModId>();
            for (const m of rows) {
                const span = m.text === undefined ? undefined : rollRange(m.text);
                if (span === undefined) unnumbered.add(m.id);
                else spans.set(m.id, span);
            }
            const all = [...spans.values()];
            const lo = Math.min(0, ...all.map((s) => s[0]));
            const hi = Math.max(1, ...all.map((s) => s[1]));
            const oneTier = r.chance(0.3) && spans.size > 0;
            const tier = oneTier ? r.pick([...spans.keys()]) : undefined;
            return {
                kind,
                type,
                gen,
                op: r.pick(CMPS),
                value: r.int(lo - 1, hi + 1),
                rows: tier === undefined ? spans : new Map([[tier, spans.get(tier)!]]),
                unnumbered,
                ...(oneTier && { oneTier: true as const }),
            };
        }
        case "compare":
            return {
                kind,
                projection: r.pick(["prefixCount", "suffixCount"] as const),
                op: r.pick(CMPS),
                value: r.int(0, 3),
            };
        case "fractured":
            return { kind, type };
        case "influenced":
            return r.chance(0.4) ? { kind } : { kind, influence: r.pick(INFLUENCES) };
        case "corrupted":
            return { kind };
        case "eldritch": {
            const side = r.pick(["exarch", "eater"] as const);
            const named = space.eldritch[side];
            return {
                kind,
                side,
                ...(r.chance(0.5) && { tier: r.int(1, 6) }),
                ...(r.chance(0.4) && {
                    types: new Set([
                        ...r.sample(named, r.int(0, named.length)),
                        TypeId("Elsewhere"),
                    ]),
                }),
            };
        }
        case "dominant":
            return { kind, side: r.pick(["exarch", "eater"] as const) };
        case "not":
            return { kind, inner: randomPred(space, r, depth - 1) };
        case "and":
        case "or":
            return {
                kind,
                left: randomPred(space, r, depth - 1),
                right: randomPred(space, r, depth - 1),
            };
        default:
            throw new Error(`no condition of kind ${String(kind)}`);
    }
}

/** The thresholds the conditions compare each type's value against. */
export function comparisonsOf(preds: readonly RPred[]): Comparisons {
    const byType = new Map<TypeId, Set<number>>();
    const visit = (p: RPred): void => {
        if (p.kind === "hasValue")
            byType.set(p.type, new Set([...(byType.get(p.type) ?? []), p.value]));
        else if (p.kind === "not") visit(p.inner);
        else if (p.kind === "and" || p.kind === "or") {
            visit(p.left);
            visit(p.right);
        }
    };
    preds.forEach(visit);
    return { byType, everyType: new Set() };
}

/** A threshold inside each numbered row's span of more than one value, so
 *  each such row holds two cells or more: the multi-cell plan. */
export function cellCuts(u: Universe): Comparisons {
    const byType = new Map<TypeId, Set<number>>();
    for (const m of u.rows.keys()) {
        const span = m.text === undefined ? undefined : rollRange(m.text);
        if (span === undefined || span[1] <= span[0]) continue;
        const t = Math.floor((span[0] + span[1]) / 2);
        byType.set(m.type, new Set([...(byType.get(m.type) ?? []), t]));
    }
    return { byType, everyType: new Set() };
}

/** A few of the influence sets the base can have: none, one, and a pair. */
export function someInfluences(u: Universe): InfluenceKey[] {
    const wanted = ["", "hunter", "elder+hunter", "shaper"];
    const keys = u.influenceKeys.filter((k) => wanted.includes(k));
    return keys.length > 0 ? keys : [...u.influenceKeys];
}
