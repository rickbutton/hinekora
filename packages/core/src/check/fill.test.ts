import { describe, expect, it, vi } from "vitest";
import type { Check, FillCount, Op, PoolSpec, Transform } from "./ops/types.js";
import { type Gen, type Rarity, TagId } from "../model/ids.js";
import type { InfluenceKey } from "../model/marks.js";
import type { Mod } from "../model/mod.js";
import type { Comparisons } from "./craft.js";
import type { Handlers } from "./ops/handler.js";
import { HANDLERS } from "./ops/registry.js";
import { RING_BASE } from "../__fixtures__/mods.js";
import { effectsOf } from "../model/effects.js";
import { ModId } from "../model/ids.js";
import type { ItemFacts } from "../model/item.js";
import { pool } from "../pool/pool.js";
import { buildRegistry } from "../resolve/registry.js";
import { influenceTagsOfKey } from "./influence.js";
import { benchCraft, metamod, modRow } from "./reference/catalog.js";
import { itemKey, refCtx, rowOf } from "./reference/item.js";
import { eligible } from "./reference/ops/pools.js";
import { allItems } from "./reference/sets.js";
import { buildUniverse } from "./universe.js";
import { type CatalogOptions, generateCatalog } from "./reference/catalog.js";
import {
    cellCuts,
    compareMethodOn,
    harnessStates,
    harnessUniverse,
    pickRows,
    someInfluences,
} from "./reference/harness.js";
import type { RefHandlers } from "./reference/ops/handler.js";
import { REF_HANDLERS } from "./reference/ops/registry.js";

// Each comparison lists every item a reforge leaves, beside the reference
// playing each draw out; beside the rest of the suite they run several times
// slower than alone.
vi.setConfig({ testTimeout: 60_000 });

const req = (check: Check): Op => ({ kind: "require", check });
const fill = (pool: PoolSpec, count: FillCount): Transform => ({ kind: "fill", pool, count });
const add = (lo = 1, hi = lo): FillCount => ({ kind: "add", n: [lo, hi] });
const reforge = (n: readonly [number, number] | "byRarity"): FillCount => ({ kind: "reforge", n });
const within: FillCount = { kind: "within" };
const natural: PoolSpec = { kind: "natural" };
const rarity = (r: Rarity): Transform => ({ kind: "rarity", rarity: r });
const keep = (gen: Gen): Op => ({ kind: "keep", gen });
const strands: Op = { kind: "strands", consume: 0 };
/** An add from the pool, on the items one of its rows fits: elsewhere an add
 *  has no outcome, which only an `either` may leave. */
const adds = (pool: PoolSpec, count: FillCount = add()): Op[] => [
    req({ kind: "poolNonEmpty", pool, tag: TagId("any") }),
    fill(pool, count),
];

/** The frames with a `strands` that uses none: a method holding one has its
 *  draws cut by the strands the item holds, which these tests read. */
const STUBS: { exact: Handlers; reference: RefHandlers } = {
    exact: {
        ...HANDLERS,
        transforms: { ...HANDLERS.transforms, strands: { reads: [], apply: (_op, s) => s } },
    },
    reference: {
        ...REF_HANDLERS,
        transforms: { ...REF_HANDLERS.transforms, strands: { reads: [], apply: (_op, x) => [x] } },
    },
};

interface Plan {
    readonly seed: number;
    readonly opts: CatalogOptions;
    readonly rarities?: readonly Rarity[];
    readonly rows?: number;
    readonly influences?: boolean;
    readonly strands?: readonly number[];
    readonly fractured?: boolean;
    readonly values?: boolean;
    readonly imprint?: boolean;
    readonly include?: (cat: ReturnType<typeof generateCatalog>) => readonly Mod[];
}

/** The symbolic method lists to exactly the reference's items, and refuses
 *  exactly its items, on states of the plan's catalogue. */
function exactOn(
    plan: Plan,
    ops: (cat: ReturnType<typeof generateCatalog>, candidates: readonly Mod[]) => readonly Op[],
): void {
    const cat = generateCatalog(plan.seed, plan.opts);
    const plain = harnessUniverse(cat);
    const comparisons: Comparisons | undefined = plan.values ? cellCuts(plain) : undefined;
    const u = harnessUniverse(cat, {
        ...(comparisons && { comparisons }),
        ...(plan.imprint && { imprint: true }),
    });
    const include = (plan.include?.(cat) ?? []).map((m) => m.id);
    const rows = pickRows(u, plan.seed, plan.rows ?? 4, include);
    const influences: InfluenceKey[] | undefined = plan.influences ? someInfluences(u) : undefined;
    const states = harnessStates(u, cat.ctx, plan.seed, {
        bounds: {
            rows,
            ...(plan.rarities && { rarities: plan.rarities }),
            ...(influences && { influences }),
            ...(plan.strands && { strands: plan.strands }),
            ...(plan.fractured && { fractured: true }),
            ...(plan.values && { values: true }),
        },
        random: 5,
        maxSize: 10,
        ...(plan.imprint && { imprints: true }),
    });
    const candidates = cat.natural.filter((m) => u.rows.has(m));
    const d = compareMethodOn(u, cat.ctx, states, ops(cat, candidates), STUBS);
    expect(d, `catalogue ${plan.seed} ${JSON.stringify(plan.opts)}\n${d}`).toBe("");
}

const CATALOGUES: readonly CatalogOptions[] = [
    { types: 4 },
    { types: 4, influence: true },
    { types: 4, essenceOnly: "ladder", zeroWeight: true },
    { types: 4, metamods: ["cannotRollAttack", "cannotRollCaster"] },
    { types: 3, base: "jewel" },
    { types: 3, base: "flask" },
    { types: 3, base: "ratcheting", influence: true },
    { types: 3, base: "simplex" },
    { types: 4, base: "boots", ilvl: 84 },
    { types: 5, sharedFamily: true },
    { types: 3, addsTag: true },
    { types: 3, twoSided: true, fossil: true },
];

/** The rows a catalogue's flags add that the states should hold. */
const flagged = (cat: ReturnType<typeof generateCatalog>, opts: CatalogOptions): Mod[] => [
    ...(opts.metamods ? cat.metamods : []),
    ...cat.mods.filter(
        (m) =>
            (opts.addsTag === true && m.id === "Adder1") ||
            (opts.twoSided === true && m.id === "Both1"),
    ),
];

/** A plan per catalogue, those whose base cannot be Rare left out where the
 *  items are to be. */
const plans = (seed: number, extra: Partial<Plan> = {}): Plan[] =>
    CATALOGUES.filter((o) => !extra.rarities?.includes("rare") || o.base !== "flask").map(
        (opts, i) => ({
            seed: seed + i,
            opts,
            influences: opts.influence === true,
            include: (cat: ReturnType<typeof generateCatalog>) => flagged(cat, opts),
            ...extra,
        }),
    );

describe("an add", () => {
    it("of one natural modifier is exact on every kind of catalogue", () => {
        for (const p of plans(7100)) exactOn(p, () => adds(natural));
    });

    it("of one or two is exact, as a transmute lays them", () => {
        for (const p of plans(7200, { rarities: ["normal"] })) {
            exactOn(p, () => [rarity("magic"), fill(natural, add(1, 2))]);
        }
    });

    it("from one side, a capped level or a beast's level is exact", () => {
        for (const p of plans(7300, { rows: 3 }).slice(0, 6)) {
            exactOn(p, () => adds({ kind: "natural", gen: "prefix" }));
            exactOn(p, () => adds({ kind: "natural", maxLevel: 45 }));
            exactOn(p, () => adds({ kind: "natural", level: 100 }));
        }
    });

    it("cut by memory strands, or a Foulborn orb's tiers, is exact", () => {
        for (const p of plans(7400, { strands: [0, 10, 100], rows: 3 }).slice(0, 6)) {
            exactOn(p, () => [...adds(natural), strands]);
            exactOn(p, () => [...adds({ kind: "natural", topTiers: true }), strands]);
            exactOn(p, () => adds({ kind: "natural", topTiers: true }));
        }
    });

    it("of tagged, influence, essence and named rows is exact", () => {
        for (const p of plans(7500, { rows: 3 })) {
            for (const tag of ["attack", "caster"].map(TagId)) {
                exactOn(p, () => adds({ kind: "tagged", tag }));
            }
            exactOn(p, () => adds({ kind: "influence" }));
            exactOn(p, (_cat, rows) => adds({ kind: "rows", mods: rows.slice(0, 2) }));
        }
    });

    it("is exact over value cells, fractured modifiers and held imprints", () => {
        for (const p of plans(7600, { rows: 3 }).slice(0, 5)) {
            exactOn({ ...p, values: true }, () => adds(natural));
            exactOn({ ...p, fractured: true }, () => adds(natural));
            exactOn({ ...p, imprint: true, rarities: ["magic"] }, () => adds(natural));
        }
    });
});

describe("a reforge", () => {
    it("to a Rare's count is exact, what the item holds counting toward it", () => {
        for (const p of plans(7700, { rarities: ["rare"], rows: 3, fractured: true })) {
            exactOn(p, () => [fill(natural, reforge([4, 6]))]);
        }
    });

    it("is exact over value cells and held imprints", () => {
        for (const p of plans(7750, { rows: 2 }).slice(0, 5)) {
            exactOn({ ...p, values: true }, () => [fill(natural, reforge("byRarity"))]);
            exactOn({ ...p, imprint: true, rarities: ["magic"] }, () => [
                fill(natural, reforge("byRarity")),
            ]);
        }
    });

    it("by rarity, or to six, is exact", () => {
        for (const p of plans(7800, { rows: 3 })) {
            exactOn(p, () => [fill(natural, reforge("byRarity"))]);
            exactOn(p, () => [fill(natural, reforge([6, 6]))]);
        }
    });

    it("under a protected side is exact", () => {
        const kinds = [
            ["prefixesCannotChange"],
            ["suffixesCannotChange", "cannotRollAttack"],
        ] as const;
        for (let i = 0; i < 6; i++) {
            exactOn(
                {
                    seed: 7900 + i,
                    opts: { types: 4, metamods: kinds[i % 2]! },
                    rarities: ["rare"],
                    rows: 4,
                    include: (cat) => cat.metamods.slice(0, 1),
                },
                () => [fill(natural, reforge([4, 6]))],
            );
        }
    });

    it("of one side, the other kept, is exact", () => {
        for (const p of plans(8000, { rarities: ["rare"], rows: 3 }).slice(0, 6)) {
            exactOn(p, () => [
                keep("suffix"),
                fill({ kind: "natural", gen: "prefix" }, reforge([4, 6])),
            ]);
        }
    });

    it("cut by memory strands is exact", () => {
        for (const p of plans(8100, { rarities: ["rare"], rows: 2, strands: [0, 50] }).slice(
            0,
            6,
        )) {
            exactOn(p, () => [fill(natural, reforge([4, 6])), strands]);
        }
    });

    it("with an essence's row is exact", () => {
        for (let i = 0; i < 6; i++) {
            const opts: CatalogOptions = { types: 4, essenceOnly: i % 2 === 0 ? true : "ladder" };
            exactOn({ seed: 8200 + i, opts, rows: 3, rarities: ["normal", "rare"] }, (cat) => {
                const spec = cat.registry.essences[0]!;
                return [
                    req({ kind: "essenceRarity", tier: spec.tier }),
                    req({ kind: "essenceGrant", spec }),
                    rarity("rare"),
                    fill({ kind: "natural", maxLevel: 70 }, reforge([4, 6])),
                    fill({ kind: "essenceGrant", spec }, within),
                    strands,
                ];
            });
        }
    });

    it("with a tagged or an influence modifier is exact", () => {
        for (const p of plans(8300, { rarities: ["rare"], rows: 2 })) {
            const tag = TagId(p.seed % 2 === 0 ? "attack" : "caster");
            const tagged: PoolSpec = { kind: "tagged", tag };
            exactOn(p, () => [
                req({ kind: "poolNonEmpty", pool: tagged, tag }),
                fill(natural, reforge([4, 6])),
                fill(tagged, within),
            ]);
            const influence: PoolSpec = { kind: "influence" };
            exactOn(p, () => [
                req({ kind: "poolNonEmpty", pool: influence, tag: TagId("influence") }),
                fill(natural, reforge([4, 6])),
                fill(influence, within),
            ]);
        }
    });

    it("by a resonator's pool, with forced rows, is exact", () => {
        for (const p of plans(8400, { rarities: ["rare"], rows: 2 }).slice(0, 6)) {
            exactOn(p, (cat, rows) => {
                const pool: PoolSpec = {
                    kind: "fossil",
                    blocked: new Set([TagId("attack")]),
                    noTagless: p.seed % 2 === 0,
                    added: [],
                    essence: cat.essence ? [cat.essence] : [],
                    fossils: [],
                };
                return [
                    fill(pool, reforge([4, 6])),
                    fill({ kind: "rows", mods: rows.slice(-1) }, within),
                ];
            });
        }
    });
});

describe("the pool checks", () => {
    it("refuse exactly the reference's items", () => {
        for (const p of plans(8500, { rows: 3 })) {
            exactOn(p, (cat) => {
                const spec = cat.registry.essences[0];
                return [
                    req({ kind: "openSlot", gen: "suffix" }),
                    req({ kind: "noBlockingMetamod" }),
                    req({ kind: "essenceRarity", tier: 4 }),
                    ...(spec ? [req({ kind: "essenceGrant", spec })] : []),
                    req({
                        kind: "fossilAllowed",
                        fossil: {
                            name: "Test Fossil",
                            allowedTags: new Set([TagId("ring")]),
                        } as never,
                    }),
                ];
            });
        }
    });
});

describe("the rows a draw offers", () => {
    it("are those pool/pool.ts offers the item, the strands' cut included", () => {
        for (const p of plans(8600, { rows: 4, strands: [0, 40, 100] })) {
            const cat = generateCatalog(p.seed, p.opts);
            const u = harnessUniverse(cat);
            const rows = pickRows(
                u,
                p.seed,
                4,
                (p.include?.(cat) ?? []).map((m) => m.id),
            );
            const items = allItems(cat.ctx, {
                rows,
                strands: [0, 40, 100],
                ...(p.influences && { influences: someInfluences(u) }),
            });
            for (const x of items) {
                const mods = x.mods.map((m) => rowOf(cat.ctx, m));
                const fromInfluence = influenceTagsOfKey(cat.registry, cat.base, x.influences);
                for (const cut of [false, true]) {
                    const facts: ItemFacts = {
                        base: cat.base,
                        ilvl: cat.ilvl,
                        rarity: x.rarity,
                        prefixCount: mods.filter((m) => m.gen === "prefix").length,
                        suffixCount: mods.filter((m) => m.gen === "suffix").length,
                        types: new Set(mods.map((m) => m.type)),
                        families: new Set(mods.flatMap((m) => [...m.families])),
                        tags: new Set([
                            ...cat.base.tags,
                            ...fromInfluence,
                            ...mods.flatMap((m) => [...m.addsTags]),
                        ]),
                        effects: mods.flatMap((m) => [...effectsOf(m)]),
                        ...(cut && { strands: x.strands }),
                    };
                    const expected = pool(cat.registry.catalog, facts).map((c) => c.mod.id);
                    const got = eligible(natural, x, cat.ctx, cut).map((m) => m.id);
                    expect(got.sort(), itemKey(x)).toEqual(expected.sort());
                }
            }
        }
    });
});

describe("on a catalogue of tags added, sides shared and metamods", () => {
    const both = [
        modRow({ id: "Both1", type: "TypeBoth", gen: "suffix", text: "+(1-2) to Both" }),
        modRow({ id: "Both2", type: "TypeBoth", gen: "prefix", minLevel: 50, text: "+3 to Both" }),
        modRow({ id: "Both3", type: "TypeBoth", gen: "suffix", minLevel: 70, text: "+4 to Both" }),
    ];
    const rows = [
        ...both,
        modRow({
            id: "Adder1",
            type: "TypeAdder",
            gen: "prefix",
            text: "+1 to Adder",
            addsTags: ["staffy"],
        }),
        modRow({
            id: "Gated1",
            type: "TypeGated",
            gen: "suffix",
            text: "+(1-2) to Gated",
            spawn: [{ tag: TagId("staffy"), weight: 100 }],
            implicitTags: ["attack"],
        }),
        modRow({
            id: "Atk1",
            type: "TypeAtk",
            gen: "prefix",
            text: "+1 to Atk",
            implicitTags: ["attack"],
        }),
        modRow({ id: "Pre1", type: "TypePre", gen: "prefix", minLevel: 30, text: "+1 to Pre" }),
        modRow({ id: "Pre2", type: "TypePre", gen: "prefix", minLevel: 60, text: "+2 to Pre" }),
        modRow({ id: "Suf1", type: "TypeSuf", gen: "suffix", text: "+1 to Suf" }),
    ];
    const guard = metamod("cannotRollAttack");
    const registry = buildRegistry({
        bases: [RING_BASE],
        mods: [...rows, guard],
        benchCrafts: [benchCraft(guard, RING_BASE.itemClass)],
    });
    const ctx = refCtx(registry, RING_BASE, 84);
    const u = buildUniverse(registry, RING_BASE, 84, undefined);
    const states = harnessStates(u, ctx, 8700, {
        bounds: {
            rows: ["Both1", "Both2", "Adder1", "Atk1", "Pre2", guard.id].map(ModId),
            rarities: ["magic", "rare"],
            strands: [0, 100],
        },
        random: 8,
        maxSize: 12,
    });

    it("every fill is exact", () => {
        const methods: Op[][] = [
            [...adds(natural), strands],
            adds({ kind: "natural", topTiers: true }),
            [...adds({ kind: "natural", topTiers: true }), strands],
            adds(natural, add(1, 2)),
            [fill(natural, reforge("byRarity")), strands],
            [
                fill(natural, reforge([4, 6])),
                fill({ kind: "tagged", tag: TagId("attack") }, within),
            ],
        ];
        for (const ops of methods) {
            const d = compareMethodOn(u, ctx, states, ops, STUBS);
            expect(d, d).toBe("");
        }
    });
});

describe("the reforges a guide reaches for", () => {
    it("with forced rows under a kept side is exact", () => {
        for (let i = 0; i < 4; i++) {
            exactOn(
                {
                    seed: 8800 + i,
                    opts: { types: 4, metamods: ["prefixesCannotChange"] },
                    rarities: ["rare"],
                    rows: 3,
                    include: (cat) => cat.metamods,
                },
                (_cat, rows) => [
                    fill(natural, reforge([4, 6])),
                    fill({ kind: "rows", mods: rows.slice(-1) }, within),
                ],
            );
        }
    });

    it("of one side kept, cut by memory strands, is exact", () => {
        for (const p of plans(8900, { rarities: ["rare"], rows: 3, strands: [0, 50] }).slice(
            0,
            6,
        )) {
            exactOn(p, () => [
                keep("suffix"),
                fill({ kind: "natural", gen: "prefix" }, reforge([4, 6])),
                strands,
            ]);
        }
    });

    it("of a Foulborn orb's tiers is exact", () => {
        for (const p of plans(9000, { rarities: ["rare"], rows: 2 }).slice(0, 6)) {
            exactOn(p, () => [fill({ kind: "natural", topTiers: true }, reforge([4, 6]))]);
        }
    });

    it("by a resonator whose fossil adds a row of its own is exact", () => {
        for (let i = 0; i < 4; i++) {
            exactOn(
                { seed: 9100 + i, opts: { types: 3, fossil: true }, rarities: ["rare"], rows: 2 },
                (cat) => [
                    fill(
                        {
                            kind: "fossil",
                            blocked: new Set([TagId("attack")]),
                            noTagless: false,
                            added: cat.fossilRows,
                            essence: [],
                            fossils: cat.fossil ? [cat.fossil] : [],
                        },
                        reforge([4, 6]),
                    ),
                ],
            );
        }
    });

    it("with an influence modifier draws one where the item's influence admits it", () => {
        let offered = 0;
        for (const p of plans(9200, { rarities: ["rare"], rows: 2 }).filter((x) => x.influences)) {
            const cat = generateCatalog(p.seed, p.opts);
            const u = harnessUniverse(cat);
            const items = allItems(cat.ctx, {
                rows: pickRows(u, p.seed, 2),
                rarities: ["rare"],
                influences: someInfluences(u),
            });
            offered += items.filter(
                (x) => eligible({ kind: "influence" }, x, cat.ctx, false).length > 0,
            ).size;
            exactOn(p, () => [
                req({ kind: "poolNonEmpty", pool: { kind: "influence" }, tag: TagId("influence") }),
                fill(natural, reforge([4, 6])),
                fill({ kind: "influence" }, within),
            ]);
        }
        expect(offered).toBeGreaterThan(0);
    });
});
