import { describe, expect, it } from "vitest";
import { craft, iff, implicitP, item, op, stop } from "../__fixtures__/ast.js";
import type { ItemBlock, Stmt } from "../ast/ast.js";
import { CATALOG, CORRUPTION_ROWS, RING_BASE } from "../__fixtures__/mods.js";
import { GroupId, ModId, TypeId } from "../model/ids.js";
import type { Corruption, EldritchTierName } from "../model/marks.js";
import type { CorruptionImplicitSpec } from "../model/sources.js";
import { buildRegistry } from "../resolve/registry.js";
import { check } from "./check.js";
import { startOf } from "./initial.js";
import { type Catalog, type CatalogOptions, generateCatalog } from "./reference/catalog.js";
import { compareCraft } from "./reference/craft.js";
import { atCells } from "./reference/harness.js";
import { initialItems } from "./reference/initial.js";
import { listItems } from "./reference/listing.js";
import { diffSets } from "./reference/sets.js";

const catalog = (seed: number, options: CatalogOptions = {}): Catalog =>
    generateCatalog(seed, { types: 2, corruption: true, ilvl: 84, ...options });

interface Decl {
    implicits?: readonly string[];
    corrupted?: Corruption;
    exarch?: EldritchTierName;
    eater?: EldritchTierName;
}

const block = (cat: Catalog, d: Decl): ItemBlock => ({
    ...item({
        base: cat.base.id,
        ilvl: cat.ilvl,
        rarity: "rare",
        corrupted: d.corrupted ?? true,
        ...(d.exarch !== undefined && { exarch: d.exarch }),
        ...(d.eater !== undefined && { eater: d.eater }),
    }),
    ...(d.implicits !== undefined && { implicits: d.implicits }),
});

const said = (cat: Catalog, d: Decl, body: readonly Stmt[] = []): string[] =>
    check(craft(block(cat, d), body), { registry: cat.registry }).diagnostics.map((x) => x.message);

/** The declared start, read symbolically and listed by the reference. */
const expectStart = (cat: Catalog, d: Decl): number => {
    const b = block(cat, d);
    const faults: string[] = [];
    const start = startOf(cat.registry, craft(b, [op("locus")]), (m) => faults.push(m))!;
    expect(faults).toEqual([]);
    const expected = atCells(start.u, initialItems(cat.ctx, b));
    const listed = listItems(start.u, start.state!.dd, { lowest: true });
    expect(diffSets(expected, listed), JSON.stringify(d)).toBe("");
    return expected.size;
};

describe("the item block's corruption implicits", () => {
    it("fill the slots, and the base's implicit is gone", () => {
        const cat = catalog(5200, { implicit: "own" });
        expect(expectStart(cat, { implicits: ["VaalA"] })).toBeGreaterThan(0);
        expectStart(cat, { implicits: ["VaalB", "VaalA"], corrupted: "twice" });
        expectStart(cat, { implicits: ["VaalHigh"], corrupted: "twice" });
        const start = startOf(
            cat.registry,
            craft(block(cat, { implicits: ["VaalB"] }), []),
            () => {},
        )!;
        const s = start.state!;
        const base = s.u.scalar("baseImplicit");
        expect(s.u.dd.valuesOf(s.dd, base)).toEqual([0]);
        // Without the field a corrupted item holds its base's implicit and none.
        expect(said(cat, {}, [iff(implicitP("VaalA"), [stop()])])).toEqual([
            `the 'if' branch can never run: implicit "VaalA" is impossible here`,
        ]);
    });

    it("stand beside one eldritch implicit on boots", () => {
        const cat = catalog(5201, { base: "boots", eldritch: true });
        expectStart(cat, { implicits: ["VaalB"], exarch: "grand" });
        expectStart(cat, { implicits: ["VaalA", "VaalB"], corrupted: "twice" });
    });

    it("are as the reference's after the Corruption Altar", () => {
        for (const [options, d] of [
            [{ implicit: "own" }, { implicits: ["VaalA"] }],
            [
                { base: "boots", eldritch: true },
                { implicits: ["VaalB"], eater: "lesser" },
            ],
        ] as const) {
            const cat = catalog(5202, options);
            for (const text of ["VaalA", "VaalB", "VaalHigh"]) {
                const c = craft(block(cat, d), [op("locus"), iff(implicitP(text), [stop()])]);
                expect(compareCraft(c, cat.registry, cat.ctx).diff).toBe("");
            }
        }
    });

    it("read a wording of rows at two levels as either", () => {
        const cat = catalog(5203, {});
        expect(expectStart(cat, { implicits: ["VaalA"] })).toBe(2);
        expect(expectStart({ ...catalog(5203, { ilvl: 20 }) }, { implicits: ["VaalA"] })).toBe(1);
    });
});

describe("the item block's corruption implicits, refused", () => {
    const cat = catalog(5210, { implicit: "own" });

    it("on an item not declared corrupted", () => {
        expect(said(cat, { implicits: ["VaalA"], corrupted: false })).toEqual([
            "Only a corrupted item has a corruption implicit — add `corrupted` or `twice corrupted`.",
        ]);
    });

    it("two on an item corrupted once, beside an eldritch implicit or not", () => {
        const once =
            "Two corruption implicits need a twice-corrupted item — this one is corrupted once.";
        expect(said(cat, { implicits: ["VaalA", "VaalB"] })).toEqual([once]);
        const boots = catalog(5216, { base: "boots", eldritch: true });
        expect(said(boots, { implicits: ["VaalA", "VaalB"], exarch: "grand" })).toEqual([once]);
    });

    it("two of one group", () => {
        // Two wordings of one group, as a ring's Wrath and Anger reservations.
        const row = (id: string, text: string): CorruptionImplicitSpec => ({
            ...CORRUPTION_ROWS[0]!,
            id: ModId(id),
            type: TypeId(id),
            groups: new Set([GroupId("Reservation")]),
            level: 1,
            text,
        });
        const registry = buildRegistry({
            bases: [RING_BASE],
            mods: CATALOG,
            corruption: [row("Wrath", "Wrath reserves less"), row("Anger", "Anger reserves less")],
        });
        const c = craft(
            {
                ...item({ base: "IronRing", ilvl: 84, rarity: "rare", corrupted: "twice" }),
                implicits: ["wrath", "anger"],
            },
            [],
        );
        expect(check(c, { registry }).diagnostics.map((d) => d.message)).toEqual([
            '"Wrath reserves less" and "Anger reserves less" cannot be on one item.',
        ]);
    });

    it("a wording the base cannot roll, or not at its level", () => {
        expect(said(cat, { implicits: ["nothing like it"] })).toEqual([
            'No corruption implicit of a Test ring reads "nothing like it".',
        ]);
        expect(said(catalog(5212, { ilvl: 40 }), { implicits: ["VaalHigh"] })).toEqual([
            'An IronRing needs item level 80 for "Vaal VaalHigh" — this item is item level 40.',
        ]);
    });

    it("more than two, or the same one twice", () => {
        expect(
            said(cat, { implicits: ["VaalA", "VaalB", "VaalHigh"], corrupted: "twice" }),
        ).toEqual(["An item holds at most 2 corruption implicits, not 3."]);
        expect(said(cat, { implicits: ["VaalA", "vaala"], corrupted: "twice" })).toEqual([
            '"Vaal VaalA" is listed twice; an item holds it once.',
        ]);
    });

    it("on a base whose implicit cannot be changed", () => {
        const locked = catalog(5213, { base: "simplex", implicit: "locked" });
        expect(said(locked, { implicits: ["VaalA"] })).toEqual([
            "A Test simplex's implicit cannot be changed, and hinekora takes it that no corruption adds an implicit beside it.",
        ]);
    });

    it("too many implicits with the eldritch ones, as hinekora does not track them", () => {
        const untracked =
            "an item holds them only where a corruption took another implicit, such as a Gilded Fossil's, which hinekora does not track yet.";
        const boots = catalog(5214, { base: "boots", eldritch: true });
        expect(said(boots, { implicits: ["VaalA"], exarch: "grand", eater: "grand" })).toEqual([
            `These eldritch and corruption implicits together: ${untracked}`,
        ]);
        expect(
            said(boots, { implicits: ["VaalA", "VaalB"], exarch: "grand", corrupted: "twice" }),
        ).toEqual([`These eldritch and corruption implicits together: ${untracked}`]);
        const amulet = catalog(5215, { base: "amulet", eldritch: true });
        expect(said(amulet, { implicits: ["VaalA"], exarch: "lesser" })).toEqual([
            `An amulet's eldritch implicit and a corruption implicit together: ${untracked}`,
        ]);
    });

    it("and the craft goes on from the item holding none", () => {
        const r = check(craft(block(cat, { implicits: ["VaalA"], corrupted: false }), []), {
            registry: cat.registry,
        });
        const s = r.finalState!;
        expect(s.u.dd.valuesOf(s.dd, s.u.scalar("corruption1"))).toEqual([0]);
    });
});
