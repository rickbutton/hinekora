import { describe, expect, it } from "vitest";
import { check, type CheckContext } from "../exact/check.js";
import * as v from "../exact/views.js";
import { guaranteedTypes, isExcluded } from "../exact/views.js";
import { buildRegistry } from "../resolve/registry.js";
import { bench, callStmt, craft, fossil, item, op, param, procDef } from "../__fixtures__/ast.js";
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
import { CORRUPTED_ESSENCE_TIER, type EssenceSpec, type FossilSpec } from "../model/sources.js";
import { GroupId, ModId, TypeId } from "../model/ids.js";
import type { Mod } from "../model/mod.js";

const ESS_CORRUPTED: EssenceSpec = {
    id: "TestCorrupted",
    name: "Essence of Horror",
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
    it("rolls no modifier without a tag under the Opulent Fossil", () => {
        // "More Drop modifiers, No Tagless modifiers": a loop for a tagless
        // modifier under it never ends in game.
        const tagless: Mod = {
            ...INCREASED_MANA,
            id: ModId("Tagless1"),
            type: TypeId("Tagless"),
            families: new Set([GroupId("Tagless")]),
            implicitTags: new Set(),
        };
        const opulent: FossilSpec = {
            ...FOSSILS[0]!,
            id: "FossilOpulent",
            name: "Opulent Fossil",
            blockedTags: new Set(),
            blocksTagless: true,
        };
        const withTagless = buildRegistry({
            bases: [RING_BASE],
            mods: [...CATALOG, tagless],
            baseAliases: { "Iron Ring": "IronRing" },
            fossils: [...FOSSILS, opulent],
        });
        const under = (name: string) =>
            check(craft(rareRing(), [fossil(name)]), { registry: withTagless }).finalState!;
        expect(v.possibleTypes(under("opulent")).has(tagless.type)).toBe(false);
        expect(v.possibleTypes(under("opulent")).has(INCREASED_MANA.type)).toBe(true);
        expect(v.possibleTypes(under("dense")).has(tagless.type)).toBe(true);
    });

    it("reforges without the modifiers of a blocked tag", () => {
        const r = check(craft(rareRing(["T1 Life"]), [fossil("dense")]), ctx);
        expect(r.diagnostics).toEqual([]);
        // Without life the ring rolls two prefixes and three suffixes (fire and
        // fire-and-chaos share a group), so it holds five at most.
        expect(v.counts(r.finalState!).total).toEqual([4, 5]);
        expect(v.possibleTypes(r.finalState!).has(LIFE)).toBe(false);
        expect(v.possibleTypes(r.finalState!).has(INCREASED_MANA.type)).toBe(true);
    });

    it("adds a fossil's own rows and guarantees a forced one within the count", () => {
        const r = check(craft(rareRing(), [fossil("faceted", "hollow")]), ctx);
        expect(r.diagnostics).toEqual([]);
        expect(v.possibleTypes(r.finalState!).has(DELVE_RING_ROW.type)).toBe(true);
        expect(guaranteedTypes(r.finalState!).has(DELVE_SOCKET_ROW.type)).toBe(true);
        expect(v.counts(r.finalState!).total).toEqual([4, 6]);
    });

    it("guarantees a corrupted essence's modifier for the Glyphic; the Tangled rolls none", () => {
        const glyphic = check(craft(rareRing(), [fossil("glyphic")]), ctx);
        expect(glyphic.diagnostics).toEqual([]);
        expect(guaranteedTypes(glyphic.finalState!).has(CORRUPTED_ESSENCE_ROW.type)).toBe(true);
        // Since 3.16.0 the Tangled Fossil gives no fossil's own modifiers and no
        // corrupted essence's: a reforge the checker reads whole.
        const tangled = check(craft(rareRing(), [fossil("tangled")]), ctx);
        expect(tangled.diagnostics).toEqual([]);
        expect(v.possibleTypes(tangled.finalState!).has(CORRUPTED_ESSENCE_ROW.type)).toBe(false);
        expect(v.possibleTypes(tangled.finalState!).has(DELVE_RING_ROW.type)).toBe(false);
        const plain = check(craft(rareRing(), [fossil("dense")]), ctx);
        expect(v.possibleTypes(plain.finalState!).has(CORRUPTED_ESSENCE_ROW.type)).toBe(false);
    });

    it("a blocked tag also keeps the Glyphic's essence modifier out, without a contradiction", () => {
        const r = check(craft(rareRing(), [fossil("glyphic", "aberrant")]), ctx);
        expect(r.diagnostics).toEqual([]);
        expect(v.possibleTypes(r.finalState!).has(CORRUPTED_ESSENCE_ROW.type)).toBe(false);
        expect(r.finalState).toBeDefined();
    });

    it("the Fractured Fossil fractures a rolled modifier and needs an item without one", () => {
        const r = check(craft(rareRing(), [fossil("fractured")]), ctx);
        expect(r.diagnostics).toEqual([]);
        expect(v.fracturedCount(r.finalState!)[0]).toBeGreaterThanOrEqual(1);
        const locked = check(
            craft(rareRing([{ mod: "IncreasedLife1", fractured: true }]), [fossil("fractured")]),
            ctx,
        );
        expect(locked.diagnostics[0]!.message).toContain("already has a fractured modifier");
    });

    it("refuses the Fractured Fossil on an influenced item", () => {
        const hunter = item({
            base: "Iron Ring",
            ilvl: 100,
            rarity: "rare",
            influences: ["hunter"],
        });
        const r = check(craft(hunter, [fossil("fractured")]), ctx);
        expect(r.diagnostics[0]!.message).toContain(
            "A Fractured Fossil cannot be used on an influenced item",
        );
    });

    it("takes a Normal or Rare item without a blocking metamod, on a base its fossils allow", () => {
        const magic = item({ base: "Iron Ring", ilvl: 100, rarity: "magic" });
        expect(check(craft(magic, [fossil("dense")]), ctx).diagnostics[0]!.message).toContain(
            "Requires a Normal or Rare item",
        );
        const normal = check(
            craft(item({ base: "Iron Ring", ilvl: 100, rarity: "normal" }), [fossil("dense")]),
            ctx,
        );
        expect(normal.diagnostics).toEqual([]);
        expect(v.rarities(normal.finalState!)).toEqual(new Set(["rare"]));
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

    it("admits a fossil's own row only where it rolls", () => {
        // The fossil-only ring row has no weight on an amulet.
        const amulet = item({ base: "Coral Amulet", ilvl: 100, rarity: "rare" });
        const r = check(craft(amulet, [fossil("faceted")]), ctx);
        expect(r.diagnostics).toEqual([]);
        expect(v.possibleTypes(r.finalState!).has(DELVE_RING_ROW.type)).toBe(false);
    });

    it("takes a fossil name from a proc parameter", () => {
        const p = procDef("reso", ["f"], [fossil(param("f"))]);
        const r = check(craft(rareRing(["T1 Life"]), [callStmt("reso", ["dense"])], [], [p]), ctx);
        expect(r.diagnostics).toEqual([]);
        expect(v.possibleTypes(r.finalState!).has(LIFE)).toBe(false);
    });

    it("reports a fossil row the catalog lacks instead of dropping it", () => {
        const r = check(craft(rareRing(), [fossil("stale")]), ctx);
        expect(r.diagnostics[0]!.message).toContain('no modifier "NoSuchRow1"');
    });

    it("corrupts the item with a Bloodstained Fossil, so nothing crafts it afterwards", () => {
        const r = check(craft(rareRing(), [fossil("bloodstained"), op("exalt")]), ctx);
        expect(v.corruptions(r.finalState!)).toEqual(new Set([true]));
        expect(r.diagnostics.map((d) => d.message).join("\n")).toContain("The item is corrupted");
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
        expect(isExcluded(r.finalState!, LIFE) || !v.possibleTypes(r.finalState!).has(LIFE)).toBe(
            true,
        );
    });
});
