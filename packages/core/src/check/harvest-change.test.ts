import { describe, expect, it } from "vitest";
import { check, type CheckContext } from "./check.js";
import { guaranteedTypes, isExcluded } from "./astate.js";
import { buildRegistry } from "../resolve/registry.js";
import { craft, harvestChange, item, op } from "../__fixtures__/ast.js";
import {
    AMULET_BASE,
    CATALOG,
    COLD_RESIST,
    FIRE_RESIST,
    MAXMANA_TIERS,
    PROTECT_SUFFIXES_CARRIER,
    RING_BASE,
    TIERED_CATALOG,
} from "../__fixtures__/mods.js";
import { TypeId } from "../model/ids.js";

const registry = buildRegistry({
    bases: [RING_BASE, AMULET_BASE],
    mods: [...CATALOG, ...TIERED_CATALOG, ...MAXMANA_TIERS, PROTECT_SUFFIXES_CARRIER],
    baseAliases: { "Iron Ring": "IronRing" },
});
const ctx: CheckContext = { registry };

type Affix = string | { mod: string; fractured?: true };
const rareRing = (prefixes: Affix[] = [], suffixes: Affix[] = []) =>
    item({ base: "Iron Ring", ilvl: 100, rarity: "rare", prefixes, suffixes });

describe("harvest change", () => {
    it("turns the named modifier into the other, keeping the count", () => {
        const c = craft(rareRing([], [FIRE_RESIST.id, "random"]), [
            harvestChange(FIRE_RESIST.id, COLD_RESIST.id),
        ]);
        const r = check(c, ctx);
        expect(r.diagnostics).toEqual([]);
        const s = r.finalState!;
        expect(guaranteedTypes(s).has(COLD_RESIST.type)).toBe(true);
        expect(isExcluded(s, FIRE_RESIST.type)).toBe(true);
        expect(s.counts.total).toEqual([2, 2]);
    });

    it("lands at the source's tier when that tier is known", () => {
        const pinned = check(
            craft(rareRing(["MaxLifeMid"]), [harvestChange("MaxLifeMid", "MaxManaLow")]),
            ctx,
        );
        expect(pinned.diagnostics).toEqual([]);
        expect(pinned.finalState!.tiers.get(TypeId("MaxMana"))).toEqual(new Set(["MaxManaMid"]));
        // After a reforge the life's tier is unknown, so the mana may be any tier.
        const loose = check(
            craft(rareRing(), [op("chaos"), harvestChange("MaxLifeMid", "MaxManaLow")]),
            ctx,
        );
        expect(loose.diagnostics[0]!.message).toContain("isn't guaranteed");
    });

    it("needs the modifier guaranteed, unfractured, on an unprotected side", () => {
        const absent = check(
            craft(rareRing(), [harvestChange(FIRE_RESIST.id, COLD_RESIST.id)]),
            ctx,
        );
        expect(absent.diagnostics[0]!.message).toContain("isn't guaranteed");
        const fractured = check(
            craft(rareRing([], [{ mod: FIRE_RESIST.id, fractured: true }]), [
                harvestChange(FIRE_RESIST.id, COLD_RESIST.id),
            ]),
            ctx,
        );
        expect(fractured.diagnostics[0]!.message).toContain("may be fractured");
        const shielded = check(
            craft(rareRing([PROTECT_SUFFIXES_CARRIER.id], [FIRE_RESIST.id]), [
                harvestChange(FIRE_RESIST.id, COLD_RESIST.id),
            ]),
            ctx,
        );
        expect(shielded.diagnostics[0]!.message).toContain("metamod protects");
    });

    it("refuses a target already on the item or one that cannot roll here", () => {
        const dup = check(
            craft(rareRing([], [FIRE_RESIST.id, COLD_RESIST.id]), [
                harvestChange(FIRE_RESIST.id, COLD_RESIST.id),
            ]),
            ctx,
        );
        expect(dup.diagnostics[0]!.message).toContain("at most one per group");
        const nowhere = check(
            craft(rareRing([], [FIRE_RESIST.id]), [harvestChange(FIRE_RESIST.id, "AmuletOnly1")]),
            ctx,
        );
        expect(nowhere.diagnostics[0]!.message).toContain("cannot roll on this item");
    });
});
