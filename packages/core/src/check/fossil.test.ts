import { describe, expect, it } from "vitest";
import { check, type CheckContext } from "./check.js";
import { guaranteedTypes, hasFracture, isExcluded } from "./astate.js";
import { buildRegistry } from "../resolve/registry.js";
import { bench, craft, fossil, item } from "../__fixtures__/ast.js";
import {
    AMULET_BASE,
    CATALOG,
    CLASS_RING,
    CORRUPTED_ESSENCE_ROW,
    DELVE_RING_ROW,
    DELVE_SOCKET_ROW,
    FOSSILS,
    INCREASED_MANA,
    PROTECT_PREFIXES_CARRIER,
    RING_BASE,
} from "../__fixtures__/mods.js";
import { CORRUPTED_ESSENCE_TIER, type EssenceSpec } from "../model/sources.js";
import { TypeId } from "../model/ids.js";

const ESS_CORRUPTED: EssenceSpec = {
    id: "TestCorrupted",
    name: "Essence of Testing",
    tier: CORRUPTED_ESSENCE_TIER,
    grants: new Map([[CLASS_RING, CORRUPTED_ESSENCE_ROW.id]]),
};

const registry = buildRegistry({
    bases: [RING_BASE, AMULET_BASE],
    mods: [
        ...CATALOG,
        DELVE_RING_ROW,
        DELVE_SOCKET_ROW,
        CORRUPTED_ESSENCE_ROW,
        PROTECT_PREFIXES_CARRIER,
    ],
    modAliases: { "T1 Life": "IncreasedLife1" },
    baseAliases: { "Iron Ring": "IronRing", "Coral Amulet": "CoralAmulet" },
    essences: [ESS_CORRUPTED],
    benchCrafts: [
        { mod: PROTECT_PREFIXES_CARRIER.id, tier: 1, itemClasses: new Set([CLASS_RING]) },
    ],
    fossils: FOSSILS,
});
const ctx: CheckContext = { registry };

type Affix = string | { mod: string; fractured?: true };
const rareRing = (prefixes: Affix[] = [], suffixes: Affix[] = []) =>
    item({ base: "Iron Ring", ilvl: 100, rarity: "rare", prefixes, suffixes });

const LIFE = TypeId("IncreasedLife");

describe("a resonator", () => {
    it("reforges without the modifiers of a blocked tag", () => {
        const r = check(craft(rareRing(["T1 Life"]), [fossil("dense")]), ctx);
        expect(r.diagnostics).toEqual([]);
        expect(r.finalState!.counts.total).toEqual([4, 6]);
        expect(r.finalState!.possible.has(LIFE)).toBe(false);
        expect(r.finalState!.possible.has(INCREASED_MANA.type)).toBe(true);
    });

    it("adds a fossil's own rows and guarantees a forced one within the count", () => {
        const r = check(craft(rareRing(), [fossil("faceted", "hollow")]), ctx);
        expect(r.diagnostics).toEqual([]);
        expect(r.finalState!.possible.has(DELVE_RING_ROW.type)).toBe(true);
        expect(guaranteedTypes(r.finalState!).has(DELVE_SOCKET_ROW.type)).toBe(true);
        expect(r.finalState!.counts.total).toEqual([4, 6]);
    });

    it("guarantees a corrupted essence's modifier for the Glyphic, allows it for the Tangled", () => {
        const glyphic = check(craft(rareRing(), [fossil("glyphic")]), ctx);
        expect(glyphic.diagnostics).toEqual([]);
        expect(guaranteedTypes(glyphic.finalState!).has(CORRUPTED_ESSENCE_ROW.type)).toBe(true);
        const tangled = check(craft(rareRing(), [fossil("tangled")]), ctx);
        expect(tangled.finalState!.possible.has(CORRUPTED_ESSENCE_ROW.type)).toBe(true);
        expect(guaranteedTypes(tangled.finalState!).has(CORRUPTED_ESSENCE_ROW.type)).toBe(false);
        const plain = check(craft(rareRing(), [fossil("dense")]), ctx);
        expect(plain.finalState!.possible.has(CORRUPTED_ESSENCE_ROW.type)).toBe(false);
    });

    it("a blocked tag also keeps the Glyphic's essence modifier out, without a contradiction", () => {
        const r = check(craft(rareRing(), [fossil("glyphic", "aberrant")]), ctx);
        expect(r.diagnostics).toEqual([]);
        expect(r.finalState!.possible.has(CORRUPTED_ESSENCE_ROW.type)).toBe(false);
        expect(r.finalState!.presence).not.toBe(r.finalState!.bdd.FALSE);
    });

    it("the Fractured Fossil fractures a rolled modifier and needs an item without one", () => {
        const r = check(craft(rareRing(), [fossil("fractured")]), ctx);
        expect(r.diagnostics).toEqual([]);
        expect(hasFracture(r.finalState!)).toBe(true);
        const locked = check(
            craft(rareRing([{ mod: "IncreasedLife1", fractured: true }]), [fossil("fractured")]),
            ctx,
        );
        expect(locked.diagnostics[0]!.message).toContain("already has a fractured modifier");
    });

    it("needs a Rare item without a blocking metamod, on a base its fossils allow", () => {
        const magic = item({ base: "Iron Ring", ilvl: 100, rarity: "magic" });
        expect(check(craft(magic, [fossil("dense")]), ctx).diagnostics[0]!.message).toContain(
            "Requires a Rare item",
        );
        const locked = check(
            craft(rareRing(), [bench("prefixes cannot be changed"), fossil("dense")]),
            ctx,
        );
        expect(locked.diagnostics[0]!.message).toContain("metacraft modifier");
        const wrongBase = check(craft(rareRing(), [fossil("pendant")]), ctx);
        expect(wrongBase.diagnostics[0]!.message).toContain("cannot be used on a");
        const amulet = item({ base: "Coral Amulet", ilvl: 100, rarity: "rare" });
        expect(check(craft(amulet, [fossil("pendant")]), ctx).diagnostics).toEqual([]);
    });

    it("refuses a fossil that corrupts the item", () => {
        const r = check(craft(rareRing(), [fossil("bloodstained")]), ctx);
        expect(r.diagnostics[0]!.message).toContain("corrupts the item");
    });

    it("holds distinct fossils, at most four", () => {
        const twice = check(craft(rareRing(), [fossil("dense", "dense")]), ctx);
        expect(twice.diagnostics[0]!.message).toContain("same fossil twice");
        const five = check(
            craft(rareRing(), [fossil("dense", "aberrant", "faceted", "hollow", "glyphic")]),
            ctx,
        );
        expect(five.diagnostics[0]!.message).toContain("at most four");
        const unknown = check(craft(rareRing(), [fossil("amber")]), ctx);
        expect(unknown.diagnostics[0]!.message).toContain("Unknown fossil");
    });

    it("keeps a declared rolled modifier's exclusion where the pool offers nothing", () => {
        // A life excluded before the reforge stays out when Dense blocks life.
        const r = check(craft(rareRing([INCREASED_MANA.id]), [fossil("dense")]), ctx);
        expect(isExcluded(r.finalState!, LIFE) || !r.finalState!.possible.has(LIFE)).toBe(true);
    });
});
