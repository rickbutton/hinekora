import { describe, expect, it } from "vitest";
import { canBeRare, caps } from "../model/capacity.js";
import type { ModId, TypeId } from "../model/ids.js";
import { eldritchKey, influencesOf } from "../model/marks.js";
import { generateCatalog, type CatalogOptions, rng } from "./reference/catalog.js";
import {
    atCells,
    cellCuts,
    harnessUniverse,
    pickRows,
    someInfluences,
} from "./reference/harness.js";
import { type CEldritch, type CItem, countsOf, rowOf } from "./reference/item.js";
import { listItems } from "./reference/listing.js";
import { allItems, ItemSet } from "./reference/sets.js";
import { fromItems, type XItem } from "./state.js";
import { buildUniverse, RARITIES } from "./universe.js";
import { HAND_REGISTRY, HELMET_BASE } from "./reference/hand.js";
import { cItem } from "./reference/item.js";
import * as V from "./views.js";

const PLANS: (CatalogOptions & { cuts?: true })[] = [
    { types: 3, cuts: true },
    { types: 3, base: "boots", eldritch: true, cuts: true },
    { types: 4 },
    { types: 3, bench: true, metamods: ["multimod"] },
    { types: 3, influence: true },
    { types: 3, base: "boots", eldritch: true },
    { types: 4, sharedFamily: true },
];

const range = (xs: readonly number[]): readonly [number, number] => [
    Math.min(...xs),
    Math.max(...xs),
];
const sortedTypes = (xs: Iterable<TypeId>): TypeId[] => [...xs].sort();

/** Every minimal set of non-guaranteed types each item carries one of, by brute force. */
function clauses(
    items: readonly CItem[],
    types: readonly TypeId[],
    has: (x: CItem, t: TypeId) => boolean,
): string[] {
    const sure = types.filter((t) => items.every((x) => has(x, t)));
    const cand = types.filter((t) => !sure.includes(t));
    const found: TypeId[][] = [];
    for (let mask = 1; mask < 1 << cand.length; mask++) {
        const set = cand.filter((_, i) => (mask >> i) & 1);
        if (set.length > V.MAX_CLAUSE) continue;
        if (items.every((x) => set.some((t) => has(x, t)))) found.push(set);
    }
    return found
        .filter((c) => !found.some((f) => f.length < c.length && f.every((t) => c.includes(t))))
        .map((c) => [...c].sort().join(","))
        .sort();
}

describe("the views", () => {
    PLANS.forEach((opts, i) => {
        const seed = 5200 + i;
        it(`are the facts of the items on catalogue ${seed} ${JSON.stringify(opts)}`, () => {
            const cat = generateCatalog(seed, opts);
            // With cuts, each numbered row holds two cells or more.
            const u = opts.cuts
                ? harnessUniverse(cat, { comparisons: cellCuts(harnessUniverse(cat)) })
                : harnessUniverse(cat);
            const ctx = cat.ctx;
            const rows = pickRows(
                u,
                seed,
                4,
                cat.metamods.map((m) => m.id),
            );
            const eldritch = opts.eldritch === true;
            const implicits = (side: "exarch" | "eater"): CEldritch[] =>
                eldritch
                    ? [0, 2, 4].flatMap((tier) =>
                          u.eldritchTypes(side).map((type) => ({ tier, type })),
                      )
                    : [{ tier: 0, type: undefined }];
            const pool = atCells(
                u,
                allItems(ctx, {
                    rows,
                    rarities: RARITIES.filter((x) => x !== "rare" || canBeRare(cat.base)),
                    influences: eldritch ? [u.influenceKeys[0]!] : someInfluences(u).slice(0, 3),
                    corrupted: [false, true],
                    exarch: implicits("exarch"),
                    eater: implicits("eater"),
                    strands: [0, 40],
                    fractured: true,
                    crafted: true,
                    values: opts.cuts === true,
                }),
            ).items();
            const r = rng(seed);
            const types = [...new Set([...u.rows.keys()].map((m) => m.type))];
            for (let k = 0; k < 12; k++) {
                const s = fromItems(u, r.sample(pool, r.int(1, Math.min(30, pool.length))))!;
                expectViews(s, listItems(u, s.dd).items(), types);
            }
            expect(clausesSeen).toBeGreaterThan(0);
        });
    });
});

let clausesSeen = 0;

function expectViews(s: XItem, items: readonly CItem[], types: readonly TypeId[]): void {
    const { u } = s;
    const ctx = {
        registry: u.registry,
        base: u.base,
        ilvl: u.ilvl,
        rows: new Map([...u.rows.keys()].map((m) => [m.id, m])),
    };
    const counts = items.map((x) => countsOf(ctx, x));
    expect(V.counts(s)).toEqual({
        total: range(counts.map((c) => c.total)),
        prefix: range(counts.map((c) => c.prefix)),
        suffix: range(counts.map((c) => c.suffix)),
    });
    expect(V.suffixRange(s)).toEqual(range(counts.map((c) => c.suffix)));
    expect(V.craftedCount(s)).toEqual(range(counts.map((c) => c.crafted)));
    expect(V.fracturedCount(s)).toEqual(range(counts.map((c) => c.fractured)));
    const rarities = new Set(items.map((x) => x.rarity));
    expect(V.rarities(s)).toEqual(rarities);
    expect(V.rarityOf(s)).toBe(rarities.size === 1 ? [...rarities][0] : undefined);
    const all = [...rarities].map((x) => caps(x, u.base));
    expect(V.capsOver(s, Math.min).total).toBe(Math.min(...all.map((c) => c.total)));

    const modOf = (x: CItem, t: TypeId) => x.mods.find((m) => rowOf(ctx, m).type === t);
    const has = (x: CItem, t: TypeId): boolean => modOf(x, t) !== undefined;
    const sure = types.filter((t) => items.every((x) => has(x, t)));
    const maybe = types.filter((t) => items.some((x) => has(x, t)));
    expect(sortedTypes(V.guaranteedTypes(s))).toEqual(sure.sort());
    expect(sortedTypes(V.possibleTypes(s))).toEqual(maybe.sort());
    expect(sortedTypes(V.excludedTypes(s))).toEqual(types.filter((t) => !maybe.includes(t)).sort());
    for (const t of types) {
        expect(V.isGuaranteed(s, t)).toBe(sure.includes(t));
        expect(V.isExcluded(s, t)).toBe(!maybe.includes(t));
        const present = items.flatMap((x) => modOf(x, t) ?? []);
        const rowIds = new Set<ModId>(present.map((m) => m.row));
        expect(new Set(V.rowsOf(s, t).map((m) => m.id))).toEqual(rowIds);
        const values = present.flatMap((m) => (m.value === undefined ? [] : [m.value]));
        expect(V.valueSpan(s, t)).toEqual(values.length === 0 ? undefined : range(values));
        for (const id of rowIds) {
            const at = present.flatMap((m) =>
                m.row === id && m.value !== undefined ? [m.value] : [],
            );
            expect(V.valueSpan(s, t, id)).toEqual(at.length === 0 ? undefined : range(at));
        }
        expect(V.isFractured(s, t)).toBe(items.every((x) => modOf(x, t)?.fractured === true));
        expect(V.mayBeFractured(s, t)).toBe(present.some((m) => m.fractured));
        expect(V.craftedTypes(s).has(t)).toBe(present.some((m) => m.crafted));
        expect(V.isCrafted(s, t)).toBe(present.length > 0 && present.every((m) => m.crafted));
    }
    // The modifiers outside a named few, on each side and on both.
    const named = new Set(types.filter((_, i) => i % 2 === 0));
    const outside = (x: CItem, gen?: "prefix" | "suffix"): number =>
        x.mods.filter((m) => {
            const row = rowOf(ctx, m);
            return !named.has(row.type) && (gen === undefined || row.gen === gen);
        }).length;
    expect(V.countOutside(s, named)).toEqual(range(items.map((x) => outside(x))));
    for (const gen of ["prefix", "suffix"] as const) {
        expect(V.countOutside(s, named, gen)).toEqual(range(items.map((x) => outside(x, gen))));
    }
    const pinned = V.fracturedTypes(s).size;
    expect(V.unprovenFractures(s)).toEqual(range(counts.map((c) => c.fractured - pinned)));

    expect(V.influenceSets(s)).toEqual(new Set(items.map((x) => x.influences)));
    expect(V.corruptions(s)).toEqual(new Set(items.map((x) => x.corrupted)));
    expect(V.eldritchPairs(s)).toEqual(
        new Set(items.map((x) => eldritchKey(x.exarch.tier, x.eater.tier))),
    );
    for (const side of ["exarch", "eater"] as const) {
        expect(V.eldritchTypes(s, side)).toEqual(
            new Set(
                items.flatMap((x) =>
                    x[side].tier > 0 && x[side].type !== undefined ? [x[side].type] : [],
                ),
            ),
        );
    }
    expect(V.strandsRange(s)).toEqual(range(items.map((x) => x.strands)));
    const sets = items.map((x) => influencesOf(x.influences));
    const everywhere = new Set(sets.reduce((a, b) => a.filter((i) => b.includes(i))));
    const { sure: sureTags, maybe: maybeTags } = V.influenceTagsOf(s);
    for (const i of new Set(sets.flat())) {
        for (const tag of u.registry.influenceTags(u.base, i)) {
            expect((everywhere.has(i) ? sureTags : maybeTags).has(tag)).toBe(true);
        }
    }

    clausesSeen += V.disjunctiveGuarantees(s).length;
    for (const c of V.disjunctiveGuarantees(s)) expect(V.atLeastOneOf(s, c)).toBe(true);
    for (const side of ["exarch", "eater"] as const) {
        expect(V.unnamedImplicit(s, side)).toBe(
            items.some((x) => x[side].tier > 0 && x[side].type === undefined),
        );
    }
    const found = V.disjunctiveGuarantees(s)
        .map((c) => [...c].sort().join(","))
        .sort();
    expect(found).toEqual(clauses(items, types, has));
    for (const g of V.cardinalityGuarantees(s)) {
        const present = items.map((x) => g.types.filter((t) => has(x, t)).length);
        expect(Math.min(...present)).toBeGreaterThanOrEqual(g.atLeast);
    }
    for (const c of V.disjunctiveGuarantees(s)) {
        const tiers = V.disjunctiveTier(s, c);
        if (tiers.size === 0) continue;
        expect(items.every((x) => c.some((t) => modOf(x, t)?.row === tiers.get(t)))).toBe(true);
    }
    // The rows a guarantee rests on hold it, and each is needed on some item
    // that carries no more of its types than it asks.
    for (const g of V.cardinalityGuarantees(s)) {
        const rows = V.clauseRows(s, g.types, g.atLeast);
        if (rows.size === 0) continue;
        const at = (x: CItem, t: TypeId) => rows.get(t)!.some((r) => r.id === modOf(x, t)?.row);
        expect(items.every((x) => g.types.filter((t) => at(x, t)).length >= g.atLeast)).toBe(true);
        const tight = items.filter((x) => g.types.filter((t) => has(x, t)).length === g.atLeast);
        for (const t of g.types) {
            const needed = new Set(tight.flatMap((x) => modOf(x, t)?.row ?? []));
            if (needed.size === 0) continue;
            expect(new Set(rows.get(t)!.map((r) => r.id))).toEqual(needed);
        }
    }
}

describe("the imprint view", () => {
    it("is the set of imprints the items hold, as items", () => {
        const cat = generateCatalog(5300, { types: 3 });
        const u = harnessUniverse(cat, { imprint: true });
        const rows = pickRows(u, 5300, 3);
        const plain = atCells(
            u,
            allItems(cat.ctx, { rows, rarities: ["normal", "magic"] }),
        ).items();
        const r = rng(5300);
        for (let k = 0; k < 8; k++) {
            const items = r
                .sample(plain, r.int(1, 8))
                .map((x, j) => (j % 3 === 0 ? x : { ...x, imprint: r.pick(plain) }));
            const s = fromItems(u, items)!;
            const held = items.flatMap((x) => x.imprint ?? []);
            expect(V.imprintHeld(s)).toEqual(new Set(items.map((x) => x.imprint !== undefined)));
            const imprint = V.imprintOf(s);
            if (held.length === 0) expect(imprint).toBeUndefined();
            else
                expect(listItems(u, imprint!.dd, { lowest: true }).items()).toEqual(
                    ItemSet.of(held).items(),
                );
        }
    });
});

describe("the guarantees of one of these", () => {
    it("gather every set of n - k + 1 types into at least k of n", () => {
        const cat = generateCatalog(5400, { types: 4, sharedFamily: false });
        const u = harnessUniverse(cat);
        const rows = pickRows(u, 5400, 4);
        const items = atCells(u, allItems(cat.ctx, { rows, rarities: ["rare"] })).filter(
            (x) => x.mods.length >= 3,
        );
        const s = fromItems(u, items)!;
        const typesOf = (id: ModId) => [...u.rows.keys()].find((m) => m.id === id)!.type;
        const four = rows.map(typesOf).sort();
        expect(V.cardinalityGuarantees(s)).toEqual([{ atLeast: 3, types: four }]);
    });
});

describe("an unnamed implicit", () => {
    it("is seen where the catalogue names none for the base", () => {
        const u = buildUniverse(HAND_REGISTRY, HELMET_BASE, 84, undefined);
        const s = fromItems(u, [cItem({ exarch: { tier: 2, type: undefined } }), cItem()])!;
        expect(V.unnamedImplicit(s, "exarch")).toBe(true);
        expect(V.unnamedImplicit(s, "eater")).toBe(false);
        expect(V.eldritchTypes(s, "exarch").size).toBe(0);
    });
});
