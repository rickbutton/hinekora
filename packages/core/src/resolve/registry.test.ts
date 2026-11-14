import { describe, expect, it } from "vitest";
import { buildRegistry } from "./registry.js";
import { BaseId, ClassId, TypeId } from "../model/ids.js";
import type { Base } from "../model/base.js";
import type { Mod } from "../model/mod.js";
import { CATALOG, RING_BASE } from "../__fixtures__/mods.js";
import { benchCraft, metamod } from "../check/reference/catalog.js";

describe("a base name two bases share", () => {
    const ring: Base = { ...RING_BASE, name: "Twin" };
    // A divination card: an item class no craft is modelled on.
    const card: Base = {
        ...RING_BASE,
        id: BaseId("TwinCard"),
        name: "Twin",
        itemClass: ClassId("DivinationCard"),
    };

    it("names the one a craft is modelled on, whichever the catalog lists first", () => {
        for (const bases of [
            [card, ring],
            [ring, card],
        ]) {
            const r = buildRegistry({ bases, mods: CATALOG }).resolveBase("Twin");
            expect(r.ok && r.value.id).toBe(ring.id);
        }
    });

    it("is refused where neither is", () => {
        const other: Base = { ...card, id: BaseId("TwinCard2") };
        const r = buildRegistry({ bases: [card, other], mods: CATALOG }).resolveBase("Twin");
        expect(!r.ok && r.error.kind).toBe("uncraftedBase");
    });
});

describe("a bench craft named by its whole wording", () => {
    const one = metamod("onePrefixCannotChange");
    const two = metamod("twoPrefixesCannotChange");
    const registry = buildRegistry({
        bases: [RING_BASE],
        mods: [...CATALOG, one, two],
        benchCrafts: [one, two].map((m) => benchCraft(m, RING_BASE.itemClass)),
    });

    it("is its own craft, though the numbers are not words", () => {
        for (const m of [one, two]) {
            const r = registry.resolveBench(m.text!, RING_BASE.itemClass);
            expect(r.ok && r.value.mod).toBe(m.id);
            const shouted = registry.resolveBench(` ${m.text!.toUpperCase()} `);
            expect(shouted.ok && shouted.value.mod).toBe(m.id);
        }
    });

    it("leaves words short of a whole wording ambiguous", () => {
        const r = registry.resolveBench("prefix modifier cannot", RING_BASE.itemClass);
        expect(!r.ok && r.error.kind).toBe("ambiguous");
    });

    it("is its own craft where the counts share a modifier type", () => {
        // The game's partial protections of a side are one type, two bench tiers.
        const shared = TypeId("CannotChangePrefixesCount");
        const rows = [one, two].map((m) => ({ ...m, type: shared }));
        const counted = buildRegistry({
            bases: [RING_BASE],
            mods: [...CATALOG, ...rows],
            benchCrafts: rows.map((m, i) => ({
                ...benchCraft(m, RING_BASE.itemClass),
                tier: i + 1,
            })),
        });
        for (const m of rows) {
            const r = counted.resolveBench(m.text!, RING_BASE.itemClass);
            expect(r.ok && r.value.mod).toBe(m.id);
        }
        const loose = counted.resolveBench("prefix modifier cannot", RING_BASE.itemClass);
        expect(loose.ok && loose.value.mod).toBe(two.id);
    });
});

describe("a modifier named by a row's whole wording", () => {
    // The game's partial protections of a side share a type, worded by one
    // count; each count's wording has every word of the full protection.
    const shared = TypeId("CannotChangePrefixesCount");
    const full: Mod = {
        ...metamod("prefixesCannotChange"),
        text: "Prefix Modifiers cannot be changed",
    };
    const [one, two] = [metamod("onePrefixCannotChange"), metamod("twoPrefixesCannotChange")].map(
        (m) => ({ ...m, type: shared }),
    ) as [Mod, Mod];
    const registry = buildRegistry({
        bases: [RING_BASE],
        mods: [...CATALOG, full, one, two],
        benchCrafts: [full, one, two].map((m) => benchCraft(m, RING_BASE.itemClass)),
        wordingAliases: { prefixes: "prefix modifiers" },
    });
    const ctx = { base: RING_BASE, ilvl: 84 };

    it("names its type, and the rows of that wording", () => {
        for (const [name, type, row] of [
            ["1 prefix modifier cannot be changed", shared, one.id],
            ["2 Prefix Modifiers cannot be changed", shared, two.id],
            ["prefixes cannot be changed", full.type, full.id],
        ] as const) {
            const r = registry.resolveModType(name, ctx);
            expect(r, name).toEqual({ ok: true, value: type });
            const rows = registry.catalog.filter((m) => m.type === type);
            expect(
                registry.rowsNamed(name, rows).map((m) => m.id),
                name,
            ).toEqual([row]);
        }
    });

    it("leaves words short of a whole wording to the type's", () => {
        const rows = registry.catalog.filter((m) => m.type === shared);
        expect(registry.rowsNamed("prefix modifier cannot", rows)).toHaveLength(2);
    });
});

describe("a bench craft named in a community wording", () => {
    const lock = metamod("prefixesCannotChange");
    const reworded: Mod = { ...lock, text: "Prefix Modifiers cannot be changed" };
    const registry = buildRegistry({
        bases: [RING_BASE],
        mods: [...CATALOG, reworded],
        benchCrafts: [benchCraft(reworded, RING_BASE.itemClass)],
        wordingAliases: { prefixes: "prefix modifiers" },
    });

    it("reads the wording as the game's, as a modifier's name is", () => {
        const r = registry.resolveBench("prefixes cannot be changed", RING_BASE.itemClass);
        expect(r.ok && r.value.mod).toBe(reworded.id);
        expect(registry.resolveModType("prefixes cannot be changed")).toEqual({
            ok: true,
            value: reworded.type,
        });
    });

    it("names the full protection beside a count of the same words", () => {
        // "2 Prefix Modifiers cannot be changed" has every word of the full one.
        const two = metamod("twoPrefixesCannotChange");
        const both = buildRegistry({
            bases: [RING_BASE],
            mods: [...CATALOG, reworded, two],
            benchCrafts: [reworded, two].map((m) => benchCraft(m, RING_BASE.itemClass)),
            wordingAliases: { prefixes: "prefix modifiers" },
        });
        for (const [name, id] of [
            ["prefixes cannot be changed", reworded.id],
            ["Prefix Modifiers cannot be changed", reworded.id],
            ["2 prefix modifiers cannot be changed", two.id],
        ] as const) {
            const r = both.resolveBench(name, RING_BASE.itemClass);
            expect(r.ok && r.value.mod, name).toBe(id);
        }
    });
});
