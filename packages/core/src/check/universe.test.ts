import { describe, expect, it, vi } from "vitest";
import { beast, craft, hasValue, iff, item, op, until } from "../__fixtures__/ast.js";
import { BOOTS_BASE, RING_BASE } from "../__fixtures__/mods.js";
import { maxTotal, sideCap } from "../model/capacity.js";
import { Domain, type Gen, ModId, TagId, TypeId } from "../model/ids.js";
import type { InfluenceKey } from "../model/marks.js";
import type { Mod } from "../model/mod.js";
import { buildRegistry, type Registry } from "../resolve/registry.js";
import { benchCraft } from "./reference/catalog.js";
import { declaredRows, IMPRINT_WORDS, REACH, type ReachSource } from "./craft.js";
import type { Dd } from "./dd.js";
import {
    type CatalogOptions,
    eldritchLadders,
    generateCatalog,
    modRow,
} from "./reference/catalog.js";
import {
    BENCH_COLD,
    BENCH_LIFE,
    COLD,
    FIRE,
    HAND_REGISTRY,
    LIFE1,
    LIFE2,
} from "./reference/hand.js";
import { type CEldritch, type CItem, countsOf, type RefCtx, refCtx } from "./reference/item.js";
import { assignmentsOf, decode, listItems } from "./reference/listing.js";
import { allItems, type Bounds, diffSets, CItemSet } from "./reference/sets.js";
import { buildUniverse, isFresh, RARITIES, type Universe, UniverseError } from "./universe.js";
import { METHODS } from "./methods.js";
import type { Op } from "./ops/types.js";

// These compare against sets listed in full; beside the rest of the suite
// they run several times slower than alone.
vi.setConfig({ testTimeout: 60_000 });

/** A few influence sets of those the base can have: none, one, and a pair. */
function someInfluences(u: Universe): InfluenceKey[] {
    const wanted = ["", "hunter", "elder+hunter", "shaper"];
    const keys = u.influenceKeys.filter((k) => wanted.includes(k));
    return keys.length > 0 ? keys : [...u.influenceKeys];
}

interface Plan {
    readonly opts: CatalogOptions;
    /** Every value, both marks on every row; otherwise each row's lowest value,
     *  not fractured, crafted only on a bench row. */
    readonly full: boolean;
}

/** The listing's restriction and the reference bounds it matches. */
function restrict(
    u: Universe,
    full: boolean,
    tiers: readonly number[] = [0, 1, 4, 5],
): { dd: Dd; bounds: Bounds } {
    const m = u.dd;
    const influences = someInfluences(u);
    const corrupted = full ? [false] : [false, true];
    const strands = full ? [0] : [0, 100];
    let r = m.and(
        m.slotIn(
            u.scalar("influences"),
            influences.map((k) => u.influenceValue(k)!),
        ),
        m.slotIn(
            u.scalar("corrupted"),
            corrupted.map((c) => (c ? 1 : 0)),
        ),
    );
    r = m.and(r, m.slotIn(u.scalar("strands"), strands));
    const implicits: Record<"exarch" | "eater", CEldritch[]> = { exarch: [], eater: [] };
    for (const side of ["exarch", "eater"] as const) {
        r = m.and(r, m.slotIn(u.scalar(`${side}Tier`), tiers));
        for (const tier of tiers) {
            for (const type of u.eldritchTypes(side)) implicits[side].push({ tier, type });
        }
    }
    if (!full) {
        for (const slot of u.modSlots()) r = m.and(r, m.slotIn(slot, [0, ...u.freshValues(slot)]));
    }
    return {
        dd: r,
        bounds: {
            rows: [...u.rows.keys()].map((row) => row.id),
            rarities: RARITIES,
            influences,
            corrupted,
            exarch: implicits.exarch,
            eater: implicits.eater,
            strands,
            values: full,
            fractured: full,
            crafted: full,
        },
    };
}

/** The listing of `wf` under the restriction equals the reference's items, and
 *  each item is one assignment, which it encodes back to. */
function expectExact(u: Universe, ctx: RefCtx, full: boolean, tiers?: readonly number[]): CItemSet {
    const { dd, bounds } = restrict(u, full, tiers);
    const within = u.dd.and(u.wf, dd);
    const listed = listItems(u, within, { lowest: !full });
    const diff = diffSets(allItems(ctx, bounds), listed);
    expect(diff, diff).toBe("");
    let decoded = 0;
    for (const a of assignmentsOf(u, within)) {
        const items = decode(u, a, { lowest: !full });
        decoded += items.length;
        for (const x of items) expect(u.encode(x)).toEqual(a);
    }
    expect(decoded).toBe(listed.size);
    return listed;
}

const PLANS: Plan[] = [];
// Everything open over two or three types.
for (let i = 0; i < 16; i++) {
    const extra: CatalogOptions[] = [
        {},
        { bench: true },
        { essenceOnly: true },
        { influence: true },
    ];
    PLANS.push({ opts: { types: i % 4 === 3 ? 2 : 2 + (i % 2), ...extra[i % 4] }, full: true });
}
// More types and every kind of row, at their lowest values.
const LIGHT: CatalogOptions[] = [
    { bench: true, metamods: ["multimod"] },
    { essenceOnly: "ladder", zeroWeight: true },
    { types: 3, influence: true, veiled: true },
    { types: 3, veiled: true, metamods: ["prefixesCannotChange", "cannotRollCaster"] },
    { base: "amulet", eldritch: true },
    { base: "boots", eldritch: true, bench: true },
    { base: "boots", ilvl: 84 },
    { base: "boots", ilvl: 40 },
    { base: "jewel", essenceOnly: true },
    { base: "flask" },
    { base: "ratcheting", influence: true },
    { base: "simplex", eldritch: true },
    { base: "amulet", influence: true, metamods: ["multimod", "suffixesCannotChange"] },
    { types: 3, bench: true, metamods: ["twoPrefixesCannotChange", "oneSuffixCannotChange"] },
];
for (let i = 0; i < 26; i++) {
    PLANS.push({ opts: { types: 3 + (i % 2), ...LIGHT[i % LIGHT.length] }, full: false });
}

describe("the universe's well-formed items", () => {
    PLANS.forEach((plan, i) => {
        const seed = 1000 + i;
        it(`are exactly the reference's on catalogue ${seed} ${JSON.stringify(plan.opts)}`, () => {
            const cat = generateCatalog(seed, plan.opts);
            const u = buildUniverse(cat.registry, cat.base, cat.ilvl, undefined);
            expect(expectExact(u, cat.ctx, plan.full).size).toBeGreaterThan(0);
        });
    });

    it("are exactly the reference's where the craft compares values", () => {
        // Every value of every cell is listed, so the cells' reading is checked.
        const registry = buildRegistry({
            bases: [RING_BASE],
            mods: [LIFE1, LIFE2, FIRE, COLD, BENCH_COLD],
            benchCrafts: [benchCraft(BENCH_COLD, RING_BASE.itemClass)],
        });
        const c = craft(item({ base: "IronRing", ilvl: 84, rarity: "rare" }), [
            until(hasValue("maximum life", ">=", 11), [op("chaos")]),
            iff(hasValue("Fire1", "<", 9), [op("exalt")]),
            iff(hasValue("cold resistance", "!=", 9.5), [op("exalt")]),
        ]);
        const u = buildUniverse(registry, RING_BASE, 84, c);
        const life = u.modSlot(u.slotOfType(LIFE1.type)!)!;
        expect(life.compared).toBe(true);
        expect(new Set(life.values.flatMap((v) => (v?.cell ? [v.cell.lo] : [])))).toEqual(
            new Set([10, 11, 12, 20]),
        );
        expectExact(u, refCtx(registry, RING_BASE, 84), true);
    });

    it("are exactly the reference's where an eldritch ladder has a gap", () => {
        const rows = [
            modRow({ id: "Pre1", type: "TypePre", gen: "prefix", text: "+(1-2) to Pre" }),
            modRow({ id: "Suf1", type: "TypeSuf", gen: "suffix", text: "+(1-2) to Suf" }),
        ];
        const ladder = eldritchLadders("exarch", ["Blaze"], "boots").filter((e) => e.tier !== 3);
        const registry = buildRegistry({ bases: [BOOTS_BASE], mods: rows, eldritch: ladder });
        const u = buildUniverse(registry, BOOTS_BASE, 84, undefined);
        expectExact(u, refCtx(registry, BOOTS_BASE, 84), false, [0, 2, 3, 4]);
        // Tier 3 names no implicit, so an unnamed one is well-formed there only.
        const tier = u.scalar("exarchTier");
        const type = u.scalar("exarchType");
        const unnamed = u.dd.and(u.wf, u.dd.slotIn(type, [0]));
        expect(u.dd.valuesOf(unnamed, tier)).toEqual([0, 3]);
    });

    it("hold an imprint only when one is held, itself well-formed", () => {
        for (let seed = 1; seed <= 4; seed++) {
            const cat = generateCatalog(seed, { types: 2, metamods: ["multimod"] });
            const u = buildUniverse(cat.registry, cat.base, cat.ilvl, undefined, { imprint: true });
            expect(u.dd.numSlots).toBe(2 * u.logical.length + 1);
            // `wf` reads the item's own slots alone.
            expect(u.dd.support(u.wf).every((s) => s % 2 === 0 && s !== u.held)).toBe(true);
            const restricted = restrict(u, false);
            // One value of each mark, so the items squared stay few.
            let dd = restricted.dd;
            for (const kind of ["influences", "corrupted", "strands"] as const) {
                dd = u.dd.and(dd, u.dd.slotIn(u.scalar(kind), [0]));
            }
            const bounds: Bounds = {
                ...restricted.bounds,
                influences: [u.influenceKeys[0]!],
                corrupted: [false],
                strands: [0],
            };
            let r = dd;
            for (const kind of [
                "influences",
                "corrupted",
                "strands",
                "exarchTier",
                "eaterTier",
            ] as const) {
                const own = u.scalar(kind);
                r = u.dd.and(r, u.dd.slotIn(u.scalar(kind, true), u.dd.valuesOf(dd, own)));
            }
            for (const slot of u.modSlots()) {
                r = u.dd.and(r, u.dd.slotIn(slot + 1, u.dd.valuesOf(dd, slot)));
            }
            const listed = listItems(u, u.dd.and(u.wfWithImprint, r), { lowest: true });
            const plain = allItems(cat.ctx, bounds);
            const expected = plain.union(
                CItemSet.of(
                    plain.items().flatMap((a) => plain.items().map((b) => ({ ...a, imprint: b }))),
                ),
            );
            const diff = diffSets(expected, listed);
            expect(diff, `seed ${seed}\n${diff}`).toBe("");
            for (const it of expected.items().slice(0, 200)) {
                expect(u.dd.contains(u.wfWithImprint, u.encode(it))).toBe(true);
            }
        }
    });
});

describe("the universe's lookups", () => {
    const cat = generateCatalog(77, { types: 5, bench: true, metamods: ["multimod"] });
    const u = buildUniverse(cat.registry, cat.base, cat.ilvl, undefined);
    const { dd } = restrict(u, true);
    const assignments = assignmentsOf(u, u.dd.and(u.wf, u.dd.and(dd, u.countIn("affix", 0, 3))));
    const one = (a: readonly number[]): CItem => u.decodeOne(a);

    it("count prefixes, suffixes, crafted and fractured modifiers", () => {
        expect(assignments.length).toBeGreaterThan(100);
        expectCounts(u, cat.ctx, assignments);
        expect(u.countIn("prefix", 1, 2)).toBe(u.countIn("prefix", 1, 2));
    });

    it("say which items have an open slot", () => {
        expectOpenSlots(u, cat.ctx, assignments);
    });

    it("find slots, values and rows", () => {
        for (const row of u.rows.keys()) {
            const slot = u.slotOfType(row.type)!;
            expect(u.modSlot(slot)!.rows).toContain(row);
            const at = u.rowValues([row.id]);
            expect([...at.keys()]).toEqual([slot]);
            for (const v of at.get(slot)!) expect(u.modValue(slot, v)!.row).toBe(row);
            expect(u.dd.valuesOf(u.rowsDiagram([row.id]), slot)).toEqual(at.get(slot));
            expect(u.rowValues([row.id], false, isFresh).get(slot)).toEqual(
                at.get(slot)!.filter((v) => isFresh(u.modValue(slot, v)!)),
            );
        }
        const bench = cat.bench!;
        const slot = u.slotOfType(bench.type)!;
        expect(u.valuesWhere(slot, (v) => v.row === bench && !v.crafted)).toEqual([]);
        expect(
            u
                .freshValues(slot)
                .every(
                    (v) => u.modValue(slot, v)!.crafted === (u.modValue(slot, v)!.row === bench),
                ),
        ).toBe(true);
        expect(u.ref(slot)).toEqual({
            kind: "logical",
            logical: u.logical.indexOf(u.modSlot(slot)!),
            copy: false,
        });
        expect(u.describe(u.scalar("rarity"), 2)).toBe("rare");
        expect(() => u.slot(0, true)).toThrow(UniverseError);
    });

    it("walk from a value to its relatives", () => {
        for (const slot of u.modSlots()) {
            const s = u.modSlot(slot)!;
            for (const value of u.valuesWhere(slot)) {
                const v = s.values[value]!;
                const flipped = u.withFractured(slot, value, !v.fractured)!;
                const f = s.values[flipped]!;
                expect([f.row, f.cell, f.crafted, f.fractured]).toEqual([
                    v.row,
                    v.cell,
                    v.crafted,
                    !v.fractured,
                ]);
                expect(u.withFractured(slot, value, v.fractured)).toBe(value);
                const reroll = u.rerolled(slot, value);
                expect(reroll).toContain(value);
                expect(reroll).toEqual(
                    u.valuesWhere(
                        slot,
                        (w) =>
                            w.row === v.row &&
                            w.fractured === v.fractured &&
                            w.crafted === v.crafted,
                    ),
                );
                for (const other of s.rows) {
                    const at = u.asRow(slot, value, other.id);
                    const expected = u.valuesWhere(
                        slot,
                        (w) =>
                            w.row === other &&
                            w.fractured === v.fractured &&
                            w.crafted === v.crafted,
                    );
                    if (expected.length === 0) expect(at).toBeUndefined();
                    else expect(at).toEqual({ slot, values: expected });
                }
            }
            expect(u.withFractured(slot, 0, true)).toBeUndefined();
            expect(u.rerolled(slot, 0)).toEqual([]);
        }
    });

    it("refuse an item outside the universe", () => {
        expect(() =>
            u.encode({ ...one(assignments[0]!), influences: "nope" as InfluenceKey }),
        ).toThrow(/influences/);
        const row = [...u.rows.keys()].find((m) => m.text !== undefined && /\(/.test(m.text))!;
        const base = { ...one(assignments[0]!), mods: [] };
        expect(() =>
            u.encode({
                ...base,
                mods: [{ row: row.id, value: 999, fractured: false, crafted: false }],
            }),
        ).toThrow(/not a value of its slot/);
        expect(() =>
            u.encode({
                ...base,
                mods: [{ row: ModId("Nowhere"), value: 1, fractured: false, crafted: false }],
            }),
        ).toThrow(/not a candidate row/);
        expect(() => u.encode({ ...base, imprint: { ...base } })).toThrow(/no imprint/);
    });
});

function expectCounts(u: Universe, ctx: RefCtx, assignments: readonly number[][]): void {
    for (const a of assignments) {
        const c = countsOf(ctx, u.decodeOne(a));
        const of = {
            prefix: c.prefix,
            suffix: c.suffix,
            affix: c.total,
            crafted: c.crafted,
            fractured: c.fractured,
        };
        for (const kind of ["prefix", "suffix", "affix", "crafted", "fractured"] as const) {
            for (const [lo, hi] of [
                [0, 0],
                [1, 2],
                [2, 6],
            ] as const) {
                expect(u.dd.contains(u.countIn(kind, lo, hi), a)).toBe(
                    of[kind] >= lo && of[kind] <= hi,
                );
            }
            const w = u.weight(kind);
            expect(a.reduce((n, v, s) => n + w(s, v), 0)).toBe(of[kind]);
        }
    }
}

function expectOpenSlots(u: Universe, ctx: RefCtx, assignments: readonly number[][]): void {
    for (const a of assignments) {
        const it = u.decodeOne(a);
        const c = countsOf(ctx, it);
        const total = c.total < maxTotal(it.rarity, ctx.base);
        const open = (g: Gen): boolean =>
            (g === "prefix" ? c.prefix : c.suffix) < sideCap(g, it.rarity, ctx.base);
        expect(u.dd.contains(u.openSlot(), a)).toBe(total);
        expect(u.dd.contains(u.openSlot("prefix"), a)).toBe(total && open("prefix"));
        expect(u.dd.contains(u.openSlot("suffix"), a)).toBe(total && open("suffix"));
    }
}

describe("value comparisons", () => {
    const registry = buildRegistry({ bases: [RING_BASE], mods: [LIFE1, LIFE2, FIRE] });
    const c = craft(item({ base: "IronRing", ilvl: 84, rarity: "rare" }), [
        iff(hasValue("maximum life", ">", 11), []),
    ]);
    const u = buildUniverse(registry, RING_BASE, 84, c);
    const life = u.slotOfType(LIFE1.type)!;

    it("give the values whose cell makes the comparison true", () => {
        const values = (vs: readonly number[]): number[] =>
            vs.map((v) => u.modValue(life, v)!.cell!.lo);
        expect(new Set(values(u.valuesComparing(life, ">", 11)))).toEqual(new Set([12, 20]));
        expect(new Set(values(u.valuesComparing(life, "<=", 11, [LIFE1.id])))).toEqual(
            new Set([10, 11]),
        );
        expect(u.valuesComparing(life, "==", 11).length).toBe(4);
    });

    it("refuse a threshold the cells were not cut at", () => {
        expect(() => u.valuesComparing(life, ">", 20)).toThrow(UniverseError);
        expect(() => u.valuesComparing(u.slotOfType(FIRE.type)!, "<", 8)).toThrow(/not cut at 8/);
    });
});

describe("tags an item may carry", () => {
    const adder = modRow({
        id: "Adder1",
        type: "TypeAdder",
        gen: "prefix",
        text: "+1 to Adding",
        addsTags: ["staffy"],
    });
    const gated = modRow({
        id: "Gated1",
        type: "TypeGated",
        gen: "suffix",
        text: "+(1-2) to Gated",
        spawn: [{ tag: TagId("staffy"), weight: 100 }],
    });
    const hunter = modRow({
        id: "Hunter1",
        type: "TypeHunter",
        gen: "suffix",
        text: "+(1-2) to Hunting",
        spawn: [{ tag: TagId("ring_basilisk"), weight: 500 }],
    });
    const registry = buildRegistry({ bases: [RING_BASE], mods: [adder, gated, hunter] });
    const u = buildUniverse(registry, RING_BASE, 84, undefined);

    it("admit a row only a tag another row adds lets roll", () => {
        expect(u.rows.get(gated)).toBe("natural");
        expect(u.extraTags(gated)).toEqual(new Set(["staffy"]));
        expect(u.extraTags(adder)).toEqual(new Set());
    });

    it("say which values supply a tag", () => {
        const staffy = u.tagSuppliers(TagId("staffy"));
        expect(staffy.influences).toEqual([]);
        const slot = u.slotOfType(adder.type)!;
        expect([...staffy.mods]).toEqual([[slot, u.valuesWhere(slot)]]);
        const basilisk = u.tagSuppliers(TagId("ring_basilisk"));
        expect(basilisk.influences.map((v) => u.influenceKeys[v])).toEqual(
            u.influenceKeys.filter((k) => k.split("+").includes("hunter")),
        );
        expect(u.carrying(TagId("ring"))).toBe(u.dd.ALL);
        const carrying = u.carrying(TagId("staffy"));
        expect(u.dd.support(carrying)).toEqual([slot]);
    });
});

describe("the candidate rows", () => {
    it("take every source a craft can use, and no row the base cannot hold", () => {
        const cat = generateCatalog(31, {
            types: 4,
            bench: true,
            essenceOnly: true,
            influence: true,
            veiled: true,
            metamods: ["multimod", "cannotRollAttack"],
            zeroWeight: true,
        });
        const u = buildUniverse(cat.registry, cat.base, cat.ilvl, undefined);
        const has = (m: Mod | undefined): boolean => m !== undefined && u.rows.has(m);
        expect(has(cat.bench)).toBe(true);
        expect(has(cat.essence)).toBe(true);
        expect(has(cat.influence)).toBe(true);
        for (const m of [...cat.veiled, ...cat.metamods]) expect(has(m)).toBe(true);
        const zeroed = cat.natural.filter((m) => m.spawn.length > 1 && m.spawn[0]!.weight === 0);
        expect(zeroed.length).toBe(1);
        expect(has(zeroed[0])).toBe(false);
        for (const m of cat.natural) if (m !== zeroed[0]) expect(has(m)).toBe(true);

        // Declared by id, the zero-weight row is in.
        const declared = craft(
            item({
                base: cat.base.id,
                ilvl: cat.ilvl,
                rarity: "rare",
                prefixes: [zeroed[0]!.id],
                suffixes: [],
            }),
            [],
        );
        const v = buildUniverse(cat.registry, cat.base, cat.ilvl, declared);
        expect(v.rows.get(zeroed[0]!)).toBe("declared");
    });

    it("leave out a natural row of another domain, even declared", () => {
        // No item holds it (item-model.md §8 "Natural affix domain matches base").
        const flasky = HAND_REGISTRY.catalog.find((m) => m.id === "Flasky1")!;
        const c = craft(
            item({ base: "IronRing", ilvl: 84, rarity: "rare", prefixes: ["Flasky1"] }),
            [],
        );
        expect(declaredRows(c, HAND_REGISTRY, RING_BASE, 84)).toContain(flasky);
        expect(buildUniverse(HAND_REGISTRY, RING_BASE, 84, c).rows.has(flasky)).toBe(false);
    });

    it("take the rows the item block declares", () => {
        const c = craft(
            item({
                base: "IronRing",
                ilvl: 84,
                rarity: "rare",
                influences: ["hunter"],
                prefixes: ["Life2", { mod: "maximum life", bench: true }, { mod: "random" }],
                suffixes: [{ mod: "hunting", tier: 1 }, { mod: "?" }],
            }),
            [],
        );
        const ids = declaredRows(c, HAND_REGISTRY, RING_BASE, 84).map((m) => m.id);
        expect(new Set(ids)).toEqual(new Set([LIFE2.id, BENCH_LIFE.id, ModId("Hunter1")]));
    });

    it("take the two plain veiled placeholders, not a master's own", () => {
        const plain = modRow({
            id: "VeiledPrefix",
            type: "VeiledPrefix",
            gen: "prefix",
            spawn: [],
        });
        const member = { ...plain, id: ModId("LeoVeiledPrefix") };
        const registry = buildRegistry({ bases: [RING_BASE], mods: [plain, member] });
        const rows = buildUniverse(registry, RING_BASE, 84, undefined).rows;
        expect([...rows.keys()].map((m) => m.id)).toEqual(["VeiledPrefix"]);
    });

    it("close under what a Harvest change can make of a row", () => {
        // An unveiled fire row changed to cold becomes the cold row of its
        // source and level; one of them has no weight on the base, which the
        // change does not read (check/methods.ts `twinRows`).
        const veiledFire = modRow({
            id: "VeiledFire1",
            type: "TypeFireDamage",
            gen: "prefix",
            minLevel: 60,
            text: "+(5-6) fire",
            domain: Domain("unveiled"),
            source: "veiled",
            spawn: [{ tag: TagId("ring"), weight: 100 }],
        });
        const veiledCold = modRow({
            id: "VeiledCold1",
            type: "TypeColdDamage",
            gen: "prefix",
            minLevel: 60,
            text: "+(5-6) cold",
            domain: Domain("unveiled"),
            source: "veiled",
            spawn: [{ tag: TagId("ring"), weight: 0 }],
        });
        const naturalCold = modRow({
            id: "NaturalCold1",
            type: "TypeColdDamage",
            gen: "prefix",
            minLevel: 90,
            text: "+(7-8) cold",
        });
        const registry: Registry = buildRegistry({
            bases: [RING_BASE],
            mods: [veiledFire, veiledCold, naturalCold],
            harvestChange: {
                resistance: {},
                damage: {
                    fire: [
                        {
                            from: TypeId("TypeFireDamage"),
                            to: { cold: { type: TypeId("TypeColdDamage"), basis: "test" } },
                        },
                    ],
                },
            },
        });
        const rows = buildUniverse(registry, RING_BASE, 84, undefined).rows;
        expect(rows.get(veiledFire)).toBe("veiled");
        expect(rows.get(veiledCold)).toBe("harvest");
        expect(rows.get(naturalCold)).toBe("natural");
    });

    it("leave out a counterpart the item's own tag zeroes, though a later entry weighs it", () => {
        // An unveiled two-handed row on a wand.
        const fire = modRow({
            id: "VeiledFire1",
            type: "TypeFireDamage",
            gen: "prefix",
            minLevel: 60,
            text: "+(5-6) fire",
            domain: Domain("unveiled"),
            source: "veiled",
            spawn: [{ tag: TagId("ring"), weight: 100 }],
        });
        const cold = (id: string, spawn: { tag: TagId; weight: number }[]) =>
            modRow({
                id,
                type: "TypeColdDamage",
                gen: "prefix",
                minLevel: 60,
                text: "+(5-6) cold",
                domain: Domain("unveiled"),
                source: "veiled",
                spawn,
            });
        const twin = cold("VeiledCold1", [{ tag: TagId("ring"), weight: 100 }]);
        const other = cold("VeiledCold2", [
            { tag: TagId("ring"), weight: 0 },
            { tag: TagId("default"), weight: 100 },
        ]);
        const registry: Registry = buildRegistry({
            bases: [RING_BASE],
            mods: [fire, twin, other],
            harvestChange: {
                resistance: {},
                damage: {
                    fire: [
                        {
                            from: TypeId("TypeFireDamage"),
                            to: { cold: { type: TypeId("TypeColdDamage"), basis: "test" } },
                        },
                    ],
                },
            },
        });
        const rows = buildUniverse(registry, RING_BASE, 84, undefined).rows;
        expect(rows.has(twin)).toBe(true);
        expect(rows.has(other)).toBe(false);
    });
});

describe("building a universe", () => {
    it("gives the imprint its slots when the craft can imprint", () => {
        const cat = generateCatalog(5, { types: 3 });
        const ring = item({ base: "IronRing", ilvl: 84, rarity: "magic" });
        const plain = buildUniverse(cat.registry, cat.base, cat.ilvl, craft(ring, [op("chaos")]));
        const held = buildUniverse(
            cat.registry,
            cat.base,
            cat.ilvl,
            craft(ring, [beast({ kind: "imprint" })]),
        );
        expect(plain.imprint).toBe(false);
        expect(plain.held).toBeUndefined();
        expect(plain.wfWithImprint).toBe(plain.wf);
        expect(held.imprint).toBe(true);
        expect(held.dd.numSlots).toBe(2 * plain.dd.numSlots + 1);
        expect(held.slot(3, true)).toBe(7);
        expect(held.ref(7)).toEqual({ kind: "logical", logical: 3, copy: true });
    });

    it("knows every method that imprints or restores by its words", () => {
        // Each method built with stand-in arguments; one that cannot be built
        // so takes arguments no imprint needs.
        const imprinting: string[][] = [];
        for (const m of METHODS) {
            const args = m.args.map((s) =>
                s.kind === "int" || s.kind === "tier"
                    ? { kind: s.kind, value: 1 }
                    : s.kind === "word"
                      ? { kind: "word" as const, value: s.oneOf[0]! }
                      : { kind: "string" as const, value: "life" },
            );
            let ops: readonly Op[] = [];
            try {
                const built = m.build(args, undefined as never, HAND_REGISTRY);
                if (!("refused" in built)) ops = built;
            } catch {
                continue;
            }
            if (ops.some((o) => o.kind === "imprint" || o.kind === "restore")) {
                imprinting.push([...m.words]);
            }
        }
        expect(imprinting).toEqual(IMPRINT_WORDS);
    });

    it("knows what each method of the table can lay down beyond the natural pool", () => {
        // Each method built with stand-in arguments, as above; what its
        // operations lay down must be within what the table gives its words.
        const sourceOf: Readonly<Record<string, ReachSource>> = {
            bench: "bench",
            essenceGrant: "essence",
            veiledPlaceholder: "veiled",
            unveil: "veiled",
            fossil: "fossil",
            metamods: "metamod",
            elevate: "elevated",
        };
        for (const m of METHODS) {
            const args = m.args.map((s) =>
                s.kind === "int" || s.kind === "tier"
                    ? { kind: s.kind, value: 1 }
                    : s.kind === "word"
                      ? { kind: "word" as const, value: s.oneOf[0]! }
                      : { kind: "string" as const, value: "life" },
            );
            let ops: readonly Op[] = [];
            try {
                const built = m.build(args, undefined as never, HAND_REGISTRY);
                if (!("refused" in built)) ops = built;
            } catch {
                continue;
            }
            const sources = new Set<ReachSource>();
            let fractures = false;
            let changes = false;
            const visit = (x: unknown): void => {
                if (typeof x !== "object" || x === null) return;
                if (Array.isArray(x)) return x.forEach(visit);
                const o = x as { kind?: unknown; replacing?: unknown };
                if (typeof o.kind === "string") {
                    const source = sourceOf[o.kind];
                    if (source !== undefined) sources.add(source);
                    if (o.kind === "lock") fractures = true;
                    if (o.kind === "rows" && o.replacing !== undefined) changes = true;
                }
                for (const v of Object.values(o)) visit(v);
            };
            visit(ops);
            const reach = REACH[m.words.join(" ")];
            const words = m.words.join(" ");
            for (const x of sources) expect(reach?.sources?.has(x), `${words}: ${x}`).toBe(true);
            if (fractures) expect(reach?.fractures, `${words} fractures`).toBe(true);
            if (changes) expect(reach?.changes, `${words} changes`).toBe(true);
        }
    });

    it("refuses a type whose rows differ in families", () => {
        const a = modRow({ id: "Odd1", type: "TypeOdd", gen: "prefix", text: "+1 to Odd" });
        const b = modRow({
            id: "Odd2",
            type: "TypeOdd",
            gen: "prefix",
            families: ["Other"],
            text: "+2 to Odd",
        });
        const registry = buildRegistry({ bases: [RING_BASE], mods: [a, b] });
        expect(() => buildUniverse(registry, RING_BASE, 84, undefined)).toThrow(
            /internal: rows Odd1 and Odd2/,
        );
    });

    it("counts a modifier on its row's side where a type has rows of both", () => {
        // As LifeGainPerTarget on a ring: the base's suffix, an influence's prefix.
        const rows = [
            modRow({ id: "Both1", type: "TypeBoth", gen: "suffix", text: "+(1-2) to Both" }),
            modRow({
                id: "Both2",
                type: "TypeBoth",
                gen: "prefix",
                minLevel: 50,
                text: "+(3-4) to Both",
            }),
            modRow({ id: "Pre1", type: "TypePre", gen: "prefix", text: "+(1-2) to Pre" }),
            modRow({ id: "Pre2", type: "TypePre2", gen: "prefix", text: "+(1-2) to Pre2" }),
            modRow({ id: "Suf1", type: "TypeSuf", gen: "suffix", text: "+(1-2) to Suf" }),
        ];
        const registry = buildRegistry({ bases: [RING_BASE], mods: rows });
        const ctx = refCtx(registry, RING_BASE, 84);
        const u = buildUniverse(registry, RING_BASE, 84, undefined);
        expect(u.modSlot(u.slotOfType(TypeId("TypeBoth"))!)!.sides).toEqual(
            new Set(["suffix", "prefix"]),
        );
        expectExact(u, ctx, true);
        const { dd } = restrict(u, true);
        const assignments = assignmentsOf(u, u.dd.and(u.wf, dd));
        expectCounts(u, ctx, assignments);
        expectOpenSlots(u, ctx, assignments);
    });
});
