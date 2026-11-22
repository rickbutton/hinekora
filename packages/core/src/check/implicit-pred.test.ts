import { describe, expect, it } from "vitest";
import {
    andp,
    craft,
    eldritchP,
    iff,
    implicitP,
    item,
    notp,
    op,
    orp,
    fail,
    until,
} from "../__fixtures__/ast.js";
import type { Craft, Stmt } from "../ast/ast.js";
import type { EldritchTierName } from "../model/marks.js";
import { check } from "./check.js";
import { type Catalog, type CatalogOptions, generateCatalog } from "./reference/catalog.js";
import { compareCraft } from "./reference/craft.js";

const catalog = (seed: number, options: CatalogOptions): Catalog =>
    generateCatalog(seed, { types: 2, corruption: true, ...options });

const start = (
    cat: Catalog,
    over: {
        corrupted?: boolean;
        exarch?: EldritchTierName;
        eater?: EldritchTierName;
    } = {},
) =>
    item({
        base: cat.base.id,
        ilvl: cat.ilvl,
        rarity: "rare",
        ...(over.corrupted === true && { corrupted: true }),
        ...(over.exarch !== undefined && { exarch: over.exarch }),
        ...(over.eater !== undefined && { eater: over.eater }),
    });

const agrees = (cat: Catalog, c: Craft): void => {
    expect(compareCraft(c, cat.registry, cat.ctx).diff).toBe("");
};

const said = (cat: Catalog, body: readonly Stmt[]): string[] =>
    check(craft(start(cat), body), { registry: cat.registry }).diagnostics.map((d) => d.message);

describe("implicit, run exactly", () => {
    it("after a Vaal Orb on a ring, its own implicit possibly gone, a corruption implicit possibly held", () => {
        const cat = catalog(5100, { implicit: "own", ilvl: 84 });
        for (const pred of [
            implicitP("VaalA"),
            implicitP("implicitness"),
            notp(implicitP("VaalB")),
            orp(implicitP("VaalHigh"), implicitP("implicitness")),
        ]) {
            agrees(cat, craft(start(cat), [op("vaal"), iff(pred, [fail()])]));
        }
    });

    it("on boots with eldritch implicits, which it does not match", () => {
        const cat = catalog(5101, { base: "boots", eldritch: true, ilvl: 84 });
        const c = craft(start(cat, { exarch: "grand", eater: "lesser" }), [
            op("vaal"),
            iff(andp(implicitP("VaalB"), eldritchP("exarch")), [fail()]),
            iff(notp(implicitP("VaalA")), [fail()]),
        ]);
        agrees(cat, c);
    });

    it("after a Vaal Orb and the Corruption Altar, in either of two corruption implicits", () => {
        const cat = catalog(5102, { implicit: "own", ilvl: 84 });
        for (const text of ["VaalA", "VaalB", "VaalHigh", "implicitness"]) {
            agrees(
                cat,
                craft(start(cat), [op("vaal"), op("locus"), iff(implicitP(text), [fail()])]),
            );
        }
    });

    it("names the rows of a wording the item's level reaches, of two levels", () => {
        for (const ilvl of [20, 84]) {
            const cat = catalog(5103, { ilvl });
            const c = craft(start(cat), [
                op("vaal"),
                iff(implicitP("VaalA"), [fail()]),
                iff(implicitP("VaalB"), [fail()]),
            ]);
            agrees(cat, c);
            const rows = cat.registry.resolveImplicit("VaalA", cat.base, ilvl);
            expect(rows.ok && rows.value.corruption.map((r) => r.id)).toEqual(
                ilvl === 20 ? ["VaalA1"] : ["VaalA1", "VaalA2"],
            );
        }
    });

    it("never holds on an item no corruption touches", () => {
        const cat = catalog(5104, { ilvl: 84 });
        expect(said(cat, [op("chaos"), iff(implicitP("VaalA"), [fail()])])).toEqual([
            `the 'if' branch can never run: implicit "VaalA" is impossible here`,
        ]);
    });
});

describe("implicit, refused", () => {
    it("names no implicit the base can hold", () => {
        const cat = catalog(5110, { ilvl: 84 });
        expect(said(cat, [op("vaal"), iff(implicitP("nothing like it"), [fail()])])).toEqual([
            'No implicit an IronRing can hold reads "nothing like it".',
        ]);
    });

    it("is ambiguous between two implicits a query covers alike", () => {
        const cat = catalog(5111, { ilvl: 84 });
        expect(said(cat, [op("vaal"), iff(implicitP("vaal"), [fail()])])).toEqual([
            'Ambiguous name "vaal" — candidates: Vaal VaalA, Vaal VaalB, Vaal VaalHigh.',
        ]);
    });

    it("says the item level a corruption implicit needs", () => {
        const cat = catalog(5112, { ilvl: 40 });
        expect(said(cat, [op("vaal"), iff(implicitP("VaalHigh"), [fail()])])).toEqual([
            'An IronRing needs item level 80 for "Vaal VaalHigh" — this item is item level 40.',
        ]);
    });

    it("asks for the base by its id where only some of a name's bases are made with it", () => {
        const cat = catalog(5113, { implicit: "variants", ilvl: 84 });
        const c = craft(item({ base: "Test ring", ilvl: 84, rarity: "rare" }), [
            iff(implicitP("implicitness"), [fail()]),
        ]);
        expect(check(c, { registry: cat.registry }).diagnostics.map((d) => d.message)).toEqual([
            'Only some of the bases named "Test ring" are made with "+(1-2) to Implicitness" — name the base by its id to pick one: IronRing.',
        ]);
        // A corruption implicit any of them can hold is no question of which.
        const vaal = craft(item({ base: "Test ring", ilvl: 84, rarity: "rare" }), [
            op("vaal"),
            iff(implicitP("VaalA"), [fail()]),
        ]);
        expect(check(vaal, { registry: cat.registry }).diagnostics).toEqual([]);
    });

    it("refuses a corruption implicit on a base whose implicit cannot be changed", () => {
        const cat = catalog(5114, { base: "simplex", implicit: "locked", ilvl: 84 });
        expect(said(cat, [op("vaal"), iff(implicitP("VaalA"), [fail()])])).toEqual([
            'A Test simplex\'s implicit cannot be changed, and hinekora takes it that no corruption adds "Vaal VaalA" beside it.',
        ]);
    });

    it("refuses a loop that corrupts again for it, as any Vaal Orb on a corrupted item", () => {
        const cat = catalog(5115, { ilvl: 84 });
        const messages = said(cat, [until(implicitP("VaalA"), [op("vaal")])]);
        expect(messages).toHaveLength(1);
        expect(messages[0]).toContain(
            "The item may be corrupted — of the steps a craft can use, a corrupted item takes only an unveil and the Corruption Altar.",
        );
    });
});
