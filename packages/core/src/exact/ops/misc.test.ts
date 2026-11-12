import { describe, expect, it, vi } from "vitest";
import type { AItem, RPred } from "../../check/astate.js";
import * as L from "../../check/library.js";
import { findMethod } from "../../check/methods.js";
import type { Check, Op, PreconditionFailure, Transform } from "../../check/ops.js";
import { rollRange } from "../../check/values.js";
import { type ModId, type Rarity, TypeId } from "../../model/ids.js";
import { type InfluenceKey, influenceKey, NO_INFLUENCE } from "../../model/marks.js";
import type { Mod } from "../../model/mod.js";
import { TALISMAN_BASE } from "../../__fixtures__/mods.js";
import { buildRegistry } from "../../resolve/registry.js";
import { type Comparisons, NO_COMPARISONS } from "../craft.js";
import { runMethod } from "../method.js";
import {
    type CatalogOptions,
    type Catalog,
    generateCatalog,
    modRow,
} from "../reference/catalog.js";
import { holds } from "../reference/conditions.js";
import {
    atCells,
    cellCuts,
    compareMethodOn,
    harnessStates,
    harnessUniverse,
    pickRows,
    someInfluences,
} from "../reference/harness.js";
import { type CItem, type CMod, cItem, cMod, refCtx } from "../reference/item.js";
import { listItems } from "../reference/listing.js";
import { refRunMethod } from "../reference/method.js";
import { ItemSet } from "../reference/sets.js";
import { violations } from "../reference/wellformed.js";
import { fromItems, narrow, type XItem } from "../state.js";
import { candidateRows } from "../rows.js";
import { rulesOf } from "../rules.js";
import { Universe } from "../universe.js";
import { InternalError } from "./handler.js";
import { transforms } from "./misc.js";

// Each comparison lists every item a reroll or a tier shift leaves, over value
// cells and held imprints; beside the rest of the suite they run slower.
vi.setConfig({ testTimeout: 60_000 });

const req = (check: Check): Op => ({ kind: "require", check });
const reroll: Transform = { kind: "reroll" };
const relax = (crafted: boolean): Transform => ({ kind: "relax", crafted });
const strands = (consume: number | readonly number[]): Transform => ({ kind: "strands", consume });
const imprint: Transform = { kind: "imprint" };
const restore: Transform = { kind: "restore" };
const removeType = (type: TypeId): Op => ({ kind: "remove", selector: { kind: "type", type } });
const removable = (type: TypeId, label = "it"): Op => req({ kind: "typeRemovable", type, label });
const EXALT = [16, 22, 26, 32, 34, 38];

interface Plan {
    readonly seed: number;
    readonly opts: CatalogOptions;
    readonly rows?: number;
    readonly include?: (cat: Catalog, u: Universe) => readonly ModId[];
    readonly values?: boolean;
    readonly fractured?: boolean;
    readonly crafted?: boolean;
    readonly imprint?: boolean;
    readonly influences?: boolean;
    readonly corrupted?: boolean;
    readonly strands?: readonly number[];
    readonly rarities?: readonly Rarity[];
}

interface Setup {
    readonly cat: Catalog;
    readonly u: Universe;
    readonly states: ItemSet[];
}

function setup(plan: Plan): Setup {
    const cat = generateCatalog(plan.seed, plan.opts);
    const comparisons: Comparisons | undefined = plan.values
        ? cellCuts(harnessUniverse(cat))
        : undefined;
    const u = harnessUniverse(cat, {
        ...(comparisons && { comparisons }),
        ...(plan.imprint && { imprint: true }),
    });
    const rows = pickRows(u, plan.seed, plan.rows ?? 3, plan.include?.(cat, u) ?? []);
    const influences: InfluenceKey[] | undefined = plan.influences ? someInfluences(u) : undefined;
    const states = harnessStates(u, cat.ctx, plan.seed, {
        bounds: {
            rows,
            ...(plan.rarities && { rarities: plan.rarities }),
            ...(influences && { influences }),
            ...(plan.strands && { strands: plan.strands }),
            ...(plan.fractured && { fractured: true }),
            ...(plan.crafted && { crafted: true }),
            ...(plan.values && { values: true }),
            ...(plan.corrupted && { corrupted: [false, true] }),
        },
        random: 6,
        maxSize: 12,
        ...(plan.imprint && { imprints: true }),
    });
    return { cat, u, states };
}

/** The symbolic method lists to exactly the reference's items and refuses
 *  exactly its items, on states of the plan's catalogue. */
function exactOn(plan: Plan, ops: (cat: Catalog, u: Universe) => readonly Op[]): void {
    const s = setup(plan);
    const d = compareMethodOn(s.u, s.cat.ctx, s.states, ops(s.cat, s.u));
    expect(d, `catalogue ${plan.seed} ${JSON.stringify(plan.opts)}\n${d}`).toBe("");
}

/** Every candidate row of the natural type with the longest ladder. */
function longestLadder(cat: Catalog, u: Universe): ModId[] {
    const byType = new Map<TypeId, Mod[]>();
    for (const m of cat.natural) {
        if (u.rows.has(m)) byType.set(m.type, [...(byType.get(m.type) ?? []), m]);
    }
    const best = [...byType.values()].sort((a, b) => b.length - a.length)[0]!;
    return best.map((m) => m.id);
}

const rowsOf = (cat: Catalog, ...ids: string[]): ModId[] =>
    ids.map((id) => cat.mods.find((m) => m.id === id)!.id);

/** The grove's change as check/methods.ts builds it, for an unknown item of
 *  the catalogue's base: every row the source may be has its targets. */
function harvestOps(cat: Catalog, from: string, to: string): readonly Op[] {
    const a = {
        base: cat.base,
        ilvl: cat.ilvl,
        influences: new Set([NO_INFLUENCE]),
        tiers: new Map(),
    } as unknown as AItem;
    const built = findMethod(["harvest", "change"])!.build(
        [
            { kind: "string", value: from },
            { kind: "string", value: to },
        ],
        a,
        cat.registry,
    );
    if ("refused" in built) throw new Error(built.refused);
    return built;
}

// --- exactness over tiny catalogues ------------------------------------------------

describe("the Divine Orb's reroll", () => {
    const catalogues: readonly Plan[] = [
        { seed: 9000, opts: { types: 4 }, values: true, fractured: true },
        {
            seed: 9010,
            opts: { types: 4, metamods: ["prefixesCannotChange", "suffixesCannotChange"] },
            values: true,
            include: (cat) => cat.metamods.map((m) => m.id),
            rows: 4,
        },
        {
            seed: 9020,
            opts: { types: 3, bench: true },
            values: true,
            crafted: true,
            include: (cat) => [cat.bench!.id],
        },
        { seed: 9030, opts: { types: 3, twoSided: true }, values: true, imprint: true },
    ];
    for (const plan of catalogues) {
        it(`is exact on catalogue ${plan.seed}`, () => {
            exactOn(plan, () => [reroll]);
            exactOn({ ...plan, corrupted: true }, () => L.currencyOps("divine"));
        });
    }
});

describe("the Tainted Divine Teardrop's tier shift", () => {
    const catalogues: readonly Plan[] = [
        { seed: 9100, opts: { types: 4 }, values: true, fractured: true, include: longestLadder },
        {
            seed: 9110,
            opts: { types: 3, influence: true },
            influences: true,
            include: (cat, u) => [...longestLadder(cat, u), cat.influence!.id],
            rows: 4,
        },
        {
            seed: 9120,
            opts: { types: 3, essenceOnly: "ladder", zeroWeight: true },
            include: (cat, u) => [cat.essence!.id, ...longestLadder(cat, u)],
            rows: 4,
        },
        {
            seed: 9130,
            opts: { types: 3, twoSided: true },
            include: (cat) => rowsOf(cat, "Both1", "Both2", "Both3"),
            rows: 4,
            values: true,
        },
        {
            seed: 9140,
            opts: { types: 3, bench: true },
            crafted: true,
            include: (cat, u) => [cat.bench!.id, ...longestLadder(cat, u)],
            rows: 4,
            imprint: true,
        },
    ];
    for (const plan of catalogues) {
        it(`is exact on catalogue ${plan.seed}`, () => {
            exactOn(plan, () => [relax(false)]);
            exactOn(plan, () => [relax(true)]);
            exactOn({ ...plan, corrupted: true }, () => L.TAINTED_DIVINE);
        });
    }
});

describe("the memory strands a method uses up", () => {
    const plan: Plan = { seed: 9200, opts: { types: 7 }, strands: [0, 3, 20, 37, 100], rows: 4 };
    it("is exact for a figure and for a list by the modifiers it starts with", () => {
        exactOn(plan, () => [strands(8)]);
        exactOn(plan, () => [strands(0)]);
        exactOn(plan, () => [strands(EXALT)]);
        exactOn(plan, () => [strands([5])]);
    });
    it("is exact through the currencies that use them", () => {
        exactOn({ ...plan, rarities: ["rare"] }, () => L.currencyOps("exalt"));
        exactOn({ ...plan, rarities: ["magic"] }, () => L.currencyOps("augment"));
        exactOn({ ...plan, imprint: true, rarities: ["magic"] }, () => L.currencyOps("augment"));
    });
});

describe("the imprint", () => {
    const plan: Plan = {
        seed: 9300,
        opts: { types: 3 },
        imprint: true,
        values: true,
        strands: [0, 9],
        fractured: true,
    };
    it("is exact for an imprint, a restore and their checks", () => {
        exactOn(plan, () => [req({ kind: "imprintable" }), imprint]);
        exactOn(plan, () => [imprint]);
        exactOn(plan, () => [req({ kind: "hasImprint" }), restore]);
        exactOn(plan, () => [req({ kind: "hasImprint" }), reroll, restore]);
        exactOn({ ...plan, opts: { types: 3, base: "jewel" } }, () => [
            req({ kind: "imprintable" }),
        ]);
    });
    it("is exact through the Bestiary's imprint and the restore", () => {
        exactOn({ ...plan, corrupted: true }, () => L.BEAST_IMPRINT);
        exactOn({ ...plan, corrupted: true }, () => L.RESTORE);
    });
});

describe("the removal of one type and the Harvest change", () => {
    const harvest: Plan = {
        seed: 9400,
        opts: { types: 2, harvest: true },
        include: (cat) => rowsOf(cat, "FireRes2", "BenchColdRes"),
        rows: 3,
        values: true,
        fractured: true,
    };
    const protectedPlan: Plan = {
        seed: 9410,
        opts: {
            types: 2,
            harvest: true,
            metamods: ["prefixesCannotChange", "suffixesCannotChange"],
        },
        include: (cat) => [
            ...rowsOf(cat, "FireRes3", "ColdRes1"),
            ...cat.metamods.map((m) => m.id),
        ],
        rows: 4,
    };
    const crafted: Plan = {
        seed: 9420,
        opts: { types: 2, harvest: true },
        include: (cat) => rowsOf(cat, "BenchFireRes", "LightningRes1"),
        crafted: true,
        imprint: true,
        rows: 3,
    };
    const fire = TypeId("TypeFireRes");
    for (const plan of [harvest, protectedPlan, crafted]) {
        it(`is exact for the removal on catalogue ${plan.seed}`, () => {
            exactOn(plan, () => [removable(fire), removeType(fire)]);
            exactOn(plan, () => [removable(TypeId("TypeColdRes"))]);
        });
        it(`is exact for the change on catalogue ${plan.seed}`, () => {
            for (const to of ["cold resistance", "lightning resistance"]) {
                exactOn(plan, (cat) => harvestOps(cat, "fire resistance", to));
            }
            exactOn(plan, (cat) => harvestOps(cat, "cold resistance", "fire resistance"));
            // A pool that names its rows for no source row: every row for each.
            exactOn(plan, (cat) =>
                L.harvestChangeOps(
                    fire,
                    "fire",
                    cat.mods.filter((m) => m.type === TypeId("TypeColdRes")),
                ),
            );
            exactOn({ ...plan, corrupted: true }, (cat) =>
                harvestOps(cat, "fire resistance", "cold resistance"),
            );
        });
    }
});

// --- the documented decisions, item by item ----------------------------------------

/** The items the method leaves on one item, symbolic and reference agreeing. */
function outcomes(s: Setup, item: CItem, ops: readonly Op[]): CItem[] {
    expect(violations(item, s.cat.ctx)).toEqual([]);
    const state = fromItems(s.u, [item])!;
    const r = runMethod(state, ops);
    const exact = listItems(s.u, r.state.dd, { lowest: true });
    const ref = atCells(s.u, refRunMethod(ItemSet.of([item]), ops, s.cat.ctx).state);
    expect(exact.keys()).toEqual(ref.keys());
    return exact.items();
}

function failureOf(s: Setup, items: readonly CItem[], ops: readonly Op[]): PreconditionFailure {
    const r = runMethod(fromItems(s.u, items)!, ops);
    if (r.ok) throw new Error("the method was not refused");
    return r.failure;
}

function rowNamed(cat: Catalog, id: string): Mod {
    return cat.mods.find((m) => m.id === id)!;
}

/** A row whose span holds more than one value. */
const wide = (row: Mod): boolean => {
    const span = row.text === undefined ? undefined : rollRange(row.text);
    return span !== undefined && span[1] > span[0];
};

const lowest = (row: Mod): number | undefined =>
    row.text === undefined ? undefined : rollRange(row.text)?.[0];

const on = (cat: Catalog, id: string, marks: Partial<CMod> = {}): CMod =>
    cMod(rowNamed(cat, id).id, lowest(rowNamed(cat, id)), marks);

/** The rows the modifiers of the items are at, sorted and deduplicated. */
const rowsAt = (xs: readonly CItem[]): string[] =>
    [...new Set(xs.flatMap((x) => x.mods.map((m) => `${m.row}${m.crafted ? "C" : ""}`)))].sort();

describe("the reroll's rules", () => {
    const s = setup({
        seed: 9500,
        opts: { types: 2, harvest: true, metamods: ["prefixesCannotChange"] },
        values: true,
    });
    const span = (id: string): number[] => {
        const [lo, hi] = rollRange(rowNamed(s.cat, id).text!)!;
        return Array.from({ length: hi - lo + 1 }, (_, k) => lo + k);
    };
    const values = (xs: readonly CItem[], id: string): number[] =>
        [...new Set(xs.map((x) => x.mods.find((m) => m.row === id)!.value!))].sort();

    it("rolls every value of the row, and keeps the row", () => {
        const out = outcomes(s, cItem({ rarity: "magic", mods: [on(s.cat, "FireRes2")] }), [
            reroll,
        ]);
        expect(rowsAt(out)).toEqual(["FireRes2"]);
        expect(values(out, "FireRes2")).toEqual(span("FireRes2"));
    });

    it("leaves a fractured modifier's value (Fractured item § Mechanics)", () => {
        const item = cItem({ rarity: "magic", mods: [on(s.cat, "FireRes2", { fractured: true })] });
        expect(outcomes(s, item, [reroll])).toEqual([item]);
    });

    it("leaves the side a metamod protects (Metamod § Rules and Exceptions)", () => {
        // "Prefixes Cannot Be Changed" is a suffix: the prefix keeps its value,
        // the suffixes still roll.
        const meta = s.cat.metamods[0]!;
        const prefix = s.cat.natural.find((m) => m.gen === "prefix" && wide(m))!;
        const item = cItem({
            rarity: "rare",
            mods: [
                cMod(prefix.id, lowest(prefix)),
                on(s.cat, "FireRes2"),
                cMod(meta.id, undefined, { crafted: true }),
            ],
        });
        const out = outcomes(s, item, [reroll]);
        expect(values(out, prefix.id)).toEqual([lowest(prefix)]);
        expect(values(out, "FireRes2")).toEqual(span("FireRes2"));
    });

    it("rolls a crafted modifier as well", () => {
        const item = cItem({
            rarity: "magic",
            mods: [on(s.cat, "BenchFireRes", { crafted: true })],
        });
        expect(values(outcomes(s, item, [reroll]), "BenchFireRes")).toEqual(span("BenchFireRes"));
    });
});

describe("the teardrop's rules", () => {
    const s = setup({
        seed: 9600,
        opts: { types: 2, harvest: true, essenceOnly: true },
        values: true,
    });
    const one = (id: string, marks: Partial<CMod> = {}): CItem =>
        cItem({ rarity: "rare", corrupted: true, mods: [on(s.cat, id, marks)] });

    it("moves a tier up, down or not at all, never past an end", () => {
        expect(rowsAt(outcomes(s, one("FireRes2"), L.TAINTED_DIVINE))).toEqual([
            "FireRes1",
            "FireRes2",
            "FireRes3",
        ]);
        expect(rowsAt(outcomes(s, one("FireRes1"), L.TAINTED_DIVINE))).toEqual([
            "FireRes1",
            "FireRes2",
        ]);
        expect(rowsAt(outcomes(s, one("FireRes3"), L.TAINTED_DIVINE))).toEqual([
            "FireRes2",
            "FireRes3",
        ]);
    });

    it("keeps the value of a modifier it does not move", () => {
        const item = one("FireRes2", { value: lowest(rowNamed(s.cat, "FireRes2"))! + 1 });
        const out = outcomes(s, item, L.TAINTED_DIVINE);
        expect(out.filter((x) => x.mods[0]!.row === "FireRes2")).toEqual([item]);
    });

    it("leaves a crafted modifier, unless told to move them", () => {
        expect(outcomes(s, one("BenchFireRes", { crafted: true }), L.TAINTED_DIVINE)).toEqual([
            one("BenchFireRes", { crafted: true }),
        ]);
        const natural = one("FireRes2", { crafted: true });
        expect(outcomes(s, natural, [relax(false)])).toEqual([natural]);
        expect(rowsAt(outcomes(s, natural, [relax(true)]))).toEqual([
            "FireRes1C",
            "FireRes2C",
            "FireRes3C",
        ]);
    });

    it("leaves a modifier that cannot normally roll on the item", () => {
        const essence = s.cat.essence!;
        const item = cItem({
            rarity: "rare",
            corrupted: true,
            mods: [cMod(essence.id, lowest(essence))],
        });
        expect(outcomes(s, item, L.TAINTED_DIVINE)).toEqual([item]);
    });

    it("moves each modifier on its own", () => {
        const item = cItem({
            rarity: "rare",
            corrupted: true,
            mods: [on(s.cat, "FireRes2"), on(s.cat, "ColdRes2")],
        });
        const pairs = outcomes(s, item, L.TAINTED_DIVINE).map((x) =>
            x.mods
                .map((m) => m.row)
                .sort()
                .join(),
        );
        expect(new Set(pairs).size).toBe(9);
    });
});

describe("the strands' rules", () => {
    const s = setup({ seed: 9700, opts: { types: 2, harvest: true } });
    const strandsOf = (xs: readonly CItem[]): number[] =>
        [...new Set(xs.map((x) => x.strands))].sort((a, b) => a - b);

    it("takes from none up to the figure, never below none", () => {
        const at = (n: number) => cItem({ rarity: "magic", strands: n });
        expect(strandsOf(outcomes(s, at(10), [strands(8)]))).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10]);
        expect(strandsOf(outcomes(s, at(3), [strands(8)]))).toEqual([0, 1, 2, 3]);
        expect(strandsOf(outcomes(s, at(0), [strands(8)]))).toEqual([0]);
    });

    it("reads a list at the modifiers the item started with", () => {
        // Two modifiers before the Exalted Orb: its third entry, not its fourth.
        const item = cItem({
            rarity: "rare",
            strands: 100,
            mods: [on(s.cat, "FireRes1"), on(s.cat, "Alpha1")],
        });
        const out = outcomes(s, item, [
            { kind: "fill", pool: { kind: "natural" }, count: { kind: "add", n: [1, 1] } },
            strands(EXALT),
        ]);
        expect(strandsOf(out)[0]).toBe(100 - EXALT[2]!);
        // Past the list's end, its last entry.
        expect(strandsOf(outcomes(s, item, [strands([1, 2])]))[0]).toBe(98);
        const bare = cItem({ ...item, mods: [] });
        expect(strandsOf(outcomes(s, bare, [strands([1, 2])]))[0]).toBe(99);
    });
});

describe("the imprint's rules", () => {
    const s = setup({ seed: 9800, opts: { types: 2, harvest: true }, imprint: true });
    const magic = cItem({ rarity: "magic", strands: 40, mods: [on(s.cat, "FireRes1")] });

    it("holds the item as it stands, replacing the imprint it held", () => {
        const old = cItem({ rarity: "magic", mods: [on(s.cat, "ColdRes1")] });
        const out = outcomes(s, { ...magic, imprint: old }, [imprint]);
        expect(out).toEqual([{ ...magic, imprint: { ...magic, imprint: undefined } }]);
    });

    it("restores the held item, strands and rarity too, and holds none", () => {
        const held = cItem({ rarity: "rare", strands: 90, mods: [on(s.cat, "ColdRes2")] });
        expect(outcomes(s, { ...magic, imprint: held }, [restore])).toEqual([held]);
    });

    it("is made of a Magic item, or a Rare talisman (Beastcrafting)", () => {
        const rare = cItem({ rarity: "rare", mods: [on(s.cat, "FireRes1")] });
        expect(failureOf(s, [rare], [req({ kind: "imprintable" }), imprint])).toEqual({
            kind: "notImprintable",
        });
        expect(failureOf(s, [magic], [req({ kind: "hasImprint" }), restore])).toEqual({
            kind: "noImprint",
        });
    });

    it("keeps each item paired with its own imprint", () => {
        // After an imprint, a step with several outcomes and a narrowing, the
        // restore gives back exactly the items whose outcomes met the condition.
        const plan: Plan = {
            seed: 9810,
            opts: { types: 3, harvest: true },
            include: (cat) => rowsOf(cat, "FireRes2", "ColdRes1"),
            values: true,
            imprint: true,
            rows: 3,
            rarities: ["rare"],
        };
        const p = setup(plan);
        const fire3 = rowNamed(p.cat, "FireRes3");
        const pred: RPred = {
            kind: "has",
            type: fire3.type,
            gen: fire3.gen,
            tierMod: fire3.id,
        };
        let fewer = false;
        for (const start of p.states) {
            const plain = ItemSet.of(start.items().map((x) => ({ ...x, imprint: undefined })));
            const state = fromItems(p.u, plain)!;
            const held = runMethod(state, [imprint, relax(false)]);
            const narrowed: XItem | null = narrow(held.state, pred);
            const ref = refRunMethod(plain, [imprint, relax(false)], p.cat.ctx).state.filter((x) =>
                holds(pred, x, p.cat.ctx),
            );
            if (narrowed === null) {
                expect(ref.size).toBe(0);
                continue;
            }
            const back = listItems(p.u, runMethod(narrowed, [restore]).state.dd, { lowest: true });
            const expected = atCells(
                p.u,
                ref.map((x) => x.imprint!),
            );
            expect(back.keys()).toEqual(expected.keys());
            expect(expected.size).toBeLessThanOrEqual(plain.size);
            fewer ||= expected.size < plain.size;
        }
        expect(fewer).toBe(true);
    });
});

describe("the Harvest change's rules", () => {
    const s = setup({
        seed: 9900,
        opts: { types: 2, harvest: true, metamods: ["suffixesCannotChange"] },
        values: true,
    });
    const fire = TypeId("TypeFireRes");
    const toCold = harvestOps(s.cat, "fire resistance", "cold resistance");
    const toLightning = harvestOps(s.cat, "fire resistance", "lightning resistance");
    const rare = (...mods: CMod[]): CItem => cItem({ rarity: "rare", mods });

    it("keeps the tier and rolls the value anew (Modifier § Harvest Crafting)", () => {
        const out = outcomes(s, rare(on(s.cat, "FireRes2")), toCold);
        expect(rowsAt(out)).toEqual(["ColdRes2"]);
        const [lo, hi] = rollRange(rowNamed(s.cat, "ColdRes2").text!)!;
        expect(out.map((x) => x.mods[0]!.value).sort()).toEqual(
            Array.from({ length: hi - lo + 1 }, (_, k) => lo + k),
        );
    });

    it("takes any row of a ladder of another length", () => {
        const out = outcomes(s, rare(on(s.cat, "FireRes2")), toLightning);
        expect(rowsAt(out)).toEqual(["LightningRes1", "LightningRes2"]);
    });

    it("makes a bench craft the bench's own, crafted still", () => {
        const out = outcomes(s, rare(on(s.cat, "BenchFireRes", { crafted: true })), toCold);
        expect(rowsAt(out)).toEqual(["BenchColdResC"]);
    });

    it("refuses an absent, a fractured or a protected modifier as typeNotRemovable, saying which", () => {
        const fr = rare(on(s.cat, "FireRes1", { fractured: true }));
        const plain = rare(on(s.cat, "FireRes1"));
        const ops = [removable(fire, "fire"), removeType(fire)];
        expect(failureOf(s, [rare(), plain], ops)).toEqual({
            kind: "typeNotRemovable",
            mod: "fire",
            why: "absent",
        });
        expect(failureOf(s, [fr], ops)).toEqual({
            kind: "typeNotRemovable",
            mod: "fire",
            why: "fractured",
            sure: true,
        });
        expect(failureOf(s, [fr, plain], ops)).toEqual({
            kind: "typeNotRemovable",
            mod: "fire",
            why: "fractured",
        });
        const meta = cMod(s.cat.metamods[0]!.id, undefined, { crafted: true });
        expect(failureOf(s, [rare(on(s.cat, "FireRes1"), meta)], ops)).toEqual({
            kind: "typeNotRemovable",
            mod: "fire",
            why: "protected",
        });
    });

    it("leaves the rest of the item", () => {
        const item = rare(on(s.cat, "FireRes3"), on(s.cat, "Alpha1"));
        const out = outcomes(s, item, [removable(fire), removeType(fire)]);
        expect(out).toEqual([rare(on(s.cat, "Alpha1"))]);
    });

    it("fills a pool's rows by the row each was made from", () => {
        const fill = toCold.find((op) => op.kind === "fill" && op.pool.kind === "rows");
        if (fill?.kind !== "fill" || fill.pool.kind !== "rows") throw new Error("no rows fill");
        const by = new Map([...fill.pool.bySource!].map(([k, v]) => [k, v.map((m) => m.id)]));
        expect(by.get(rowNamed(s.cat, "FireRes1").id)).toEqual(["ColdRes1"]);
        expect(by.get(rowNamed(s.cat, "FireRes3").id)).toEqual(["ColdRes3"]);
        expect(by.get(rowNamed(s.cat, "BenchFireRes").id)).toEqual(["BenchColdRes"]);
    });
});

// --- the shared rules, each branch -------------------------------------------------

/** The catalogue on another base, or with more rows. */
function rebuilt(cat: Catalog, base = cat.base, more: readonly Mod[] = []): Catalog {
    const registry = buildRegistry({ bases: [base], mods: [...cat.mods, ...more] });
    return {
        ...cat,
        registry,
        base,
        mods: registry.catalog,
        ctx: refCtx(registry, base, cat.ilvl),
    };
}

const corruptRare = (mods: readonly CMod[], influences: InfluenceKey = NO_INFLUENCE): CItem =>
    cItem({ rarity: "rare", corrupted: true, mods, influences });

describe("the teardrop's ladders", () => {
    it("is exact where a ladder depends on the item's influences", () => {
        exactOn(
            {
                seed: 9150,
                opts: { types: 2, influence: true, elevated: true },
                influences: true,
                include: (cat) => rowsOf(cat, "HunterA1", "HunterA2", "ShaperA1", "HunterB1"),
                rows: 4,
                corrupted: true,
            },
            () => L.TAINTED_DIVINE,
        );
    });

    it("moves an influence's row only on an item of that influence", () => {
        const s = setup({ seed: 9160, opts: { types: 2, influence: true, elevated: true } });
        const a1 = [on(s.cat, "HunterA1")];
        expect(rowsAt(outcomes(s, corruptRare(a1), L.TAINTED_DIVINE))).toEqual(["HunterA1"]);
        const hunter = influenceKey(["hunter"]);
        expect(rowsAt(outcomes(s, corruptRare(a1, hunter), L.TAINTED_DIVINE))).toEqual([
            "HunterA1",
            "HunterA2",
        ]);
        // The Shaper's row of the type is a ladder of its own.
        const both = influenceKey(["hunter", "shaper"]);
        const shaper = [on(s.cat, "ShaperA1")];
        expect(rowsAt(outcomes(s, corruptRare(shaper, both), L.TAINTED_DIVINE))).toEqual([
            "ShaperA1",
        ]);
    });

    it("takes either row of a tier of two rows at one mod level", () => {
        const twin = (id: string, minLevel: number, k: number): Mod =>
            modRow({
                id,
                type: "TypeTwin",
                gen: "suffix",
                minLevel,
                families: ["FamTwin"],
                text: `+(${2 + 3 * k}-${3 + 3 * k}) to Twin`,
            });
        const cat = rebuilt(generateCatalog(9170, { types: 2, ilvl: 84 }), undefined, [
            twin("Twin1", 1, 0),
            twin("Twin2a", 40, 1),
            twin("Twin2b", 40, 2),
            twin("Twin3", 70, 3),
        ]);
        const u = harnessUniverse(cat);
        const s: Setup = { cat, u, states: [] };
        const one = (id: string) => corruptRare([on(cat, id)]);
        expect(rowsAt(outcomes(s, one("Twin1"), L.TAINTED_DIVINE))).toEqual([
            "Twin1",
            "Twin2a",
            "Twin2b",
        ]);
        expect(rowsAt(outcomes(s, one("Twin2a"), L.TAINTED_DIVINE))).toEqual([
            "Twin1",
            "Twin2a",
            "Twin3",
        ]);
        const states = harnessStates(u, cat.ctx, 9171, {
            bounds: { rows: rowsOf(cat, "Twin1", "Twin2a", "Twin2b", "Twin3") },
        });
        const d = compareMethodOn(u, cat.ctx, states, [relax(false)]);
        expect(d, d).toBe("");
    });

    it("moves a modifier above the item's level", () => {
        const s = setup({ seed: 9180, opts: { types: 2, harvest: true, ilvl: 40 } });
        expect(s.cat.ilvl).toBeLessThan(rowNamed(s.cat, "FireRes2").minLevel);
        const out = outcomes(s, corruptRare([on(s.cat, "FireRes1")]), L.TAINTED_DIVINE);
        expect(rowsAt(out)).toEqual(["FireRes1", "FireRes2"]);
    });

    it("moves a fractured modifier, fractured still", () => {
        const s = setup({ seed: 9190, opts: { types: 2, harvest: true } });
        const out = outcomes(
            s,
            corruptRare([on(s.cat, "FireRes2", { fractured: true })]),
            L.TAINTED_DIVINE,
        );
        expect(rowsAt(out)).toEqual(["FireRes1", "FireRes2", "FireRes3"]);
        expect(out.every((x) => x.mods.every((m) => m.fractured))).toBe(true);
    });
});

describe("an imprint of a talisman", () => {
    it("is made of a Rare talisman", () => {
        const cat = rebuilt(generateCatalog(9820, { types: 2, base: "amulet" }), TALISMAN_BASE);
        const u = harnessUniverse(cat, { imprint: true });
        const states = harnessStates(u, cat.ctx, 9821, { bounds: { rows: pickRows(u, 9821, 2) } });
        const d = compareMethodOn(u, cat.ctx, states, [req({ kind: "imprintable" }), imprint]);
        expect(d, d).toBe("");
        const r = runMethod(fromItems(u, [cItem({ rarity: "rare" })])!, L.BEAST_IMPRINT);
        expect(r.ok).toBe(true);
    });
});

describe("a Harvest change with no row for the removed one", () => {
    const s = setup({ seed: 9950, opts: { types: 2, harvest: true }, values: true });
    const fire = TypeId("TypeFireRes");
    const cold = s.cat.mods.filter((m) => m.type === TypeId("TypeColdRes"));
    const id = (row: string): ModId => rowNamed(s.cat, row).id;
    // The first row has a target, the second an empty entry, the third none.
    const ops: Op[] = [
        removable(fire),
        removeType(fire),
        {
            kind: "fill",
            pool: {
                kind: "rows",
                mods: cold,
                replacing: fire,
                bySource: new Map([
                    [id("FireRes1"), [rowNamed(s.cat, "ColdRes1")]],
                    [id("FireRes2"), []],
                ]),
            },
            count: { kind: "add", n: [1, 1] },
        },
    ];
    const items = ["FireRes1", "FireRes2", "FireRes3"].map((r) =>
        cItem({ rarity: "rare", mods: [on(s.cat, r)] }),
    );

    it("leaves the item stuck, refused in both frames", () => {
        const d = compareMethodOn(s.u, s.cat.ctx, [ItemSet.of(items)], ops);
        expect(d, d).toBe("");
        const r = runMethod(fromItems(s.u, items)!, ops);
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.failure).toMatchObject({ kind: "noOutcome", sure: false });
        expect(rowsAt(listItems(s.u, r.state.dd).items())).toEqual(["ColdRes1"]);
        const ref = refRunMethod(ItemSet.of(items), ops, s.cat.ctx);
        expect(ref.ok).toBe(false);
        expect([...ref.failing.values()][0]!.size).toBe(2);
    });
});

describe("the internal errors", () => {
    const cat = generateCatalog(9960, { types: 2, harvest: true });
    /** The catalogue's universe without one of its rows. */
    const lacking = (row: string): Universe => {
        const rows = new Map(
            [...candidateRows(cat.registry, cat.base, cat.ilvl, undefined)].filter(
                ([m]) => m.id !== row,
            ),
        );
        return new Universe(cat.registry, cat.base, cat.ilvl, rows, NO_COMPARISONS, false);
    };
    const fire2 = cItem({ rarity: "rare", corrupted: true, mods: [on(cat, "FireRes2")] });

    it("a teardrop's row the universe has no value for", () => {
        const u = lacking("FireRes3");
        expect(() => runMethod(fromItems(u, [fire2])!, [relax(false)])).toThrow(InternalError);
    });

    it("a Harvest change's row the universe has no value for", () => {
        const u = lacking("ColdRes2");
        const ops = harvestOps(cat, "fire resistance", "cold resistance").filter(
            (op) => op.kind !== "require" || op.check.kind === "typeRemovable",
        );
        const item = { ...fire2, corrupted: false };
        expect(() => runMethod(fromItems(u, [item])!, ops)).toThrow(/no candidate/);
    });

    it("an imprint or a restore where the universe holds no imprint", () => {
        const u = harnessUniverse(cat);
        const s = fromItems(u, [cItem({ rarity: "magic" })])!;
        expect(() => runMethod(s, [imprint])).toThrow(InternalError);
        expect(() => runMethod(s, [restore])).toThrow(InternalError);
    });

    it("strands read at a start of several modifier counts", () => {
        const u = harnessUniverse(cat);
        const start = fromItems(u, [
            cItem({ rarity: "rare" }),
            cItem({ rarity: "rare", mods: [on(cat, "FireRes1")] }),
        ])!.dd;
        const ctx = { u, rules: rulesOf([], []), start };
        const op = { kind: "strands", consume: EXALT } as const;
        expect(() => transforms.strands!.apply(op, start, ctx)).toThrow(InternalError);
    });
});
