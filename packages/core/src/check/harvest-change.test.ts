import { describe, expect, it } from "vitest";
import { check, type CheckContext } from "./check.js";
import { guaranteedTypes, isExcluded } from "./astate.js";
import { buildRegistry } from "../resolve/registry.js";
import { bench, craft, harvestChange, item, op } from "../__fixtures__/ast.js";
import {
    AMULET_BASE,
    BENCH_FIRE_RES_ROW,
    BENCH_LIFE_ROW,
    CATALOG,
    CLASS_RING,
    COLD_DAMAGE,
    COLD_RESIST,
    FIRE_CHAOS_RESIST,
    FIRE_CRIT_MULTI,
    FIRE_DAMAGE,
    FIRE_DOT_MULTI,
    FIRE_RESIST,
    COLD_RES_TIERS,
    FIRE_RES_TIERS,
    PROTECT_SUFFIXES_CARRIER,
    RING_BASE,
    LIGHTNING_RESIST,
} from "../__fixtures__/mods.js";
import { TypeId } from "../model/ids.js";

const registry = buildRegistry({
    bases: [RING_BASE, AMULET_BASE],
    mods: [
        ...CATALOG,
        ...FIRE_RES_TIERS,
        ...COLD_RES_TIERS,
        FIRE_DAMAGE,
        COLD_DAMAGE,
        FIRE_CRIT_MULTI,
        FIRE_DOT_MULTI,
        PROTECT_SUFFIXES_CARRIER,
        BENCH_FIRE_RES_ROW,
        BENCH_LIFE_ROW,
    ],
    modAliases: { "T1 Life": "IncreasedLife1" },
    baseAliases: { "Iron Ring": "IronRing", "Coral Amulet": "CoralAmulet" },
    benchCrafts: [BENCH_FIRE_RES_ROW, BENCH_LIFE_ROW].map((m) => ({
        mod: m.id,
        tier: 1,
        itemClasses: new Set([CLASS_RING]),
    })),
});
const ctx: CheckContext = { registry };

type Affix = string | { mod: string; fractured?: true };
const rareRing = (prefixes: Affix[] = [], suffixes: Affix[] = []) =>
    item({ base: "Iron Ring", ilvl: 100, rarity: "rare", prefixes, suffixes });

describe("harvest change", () => {
    it("refuses a critical or damage over time multiplier, and a resistance shared with chaos", () => {
        for (const from of [FIRE_CRIT_MULTI, FIRE_DOT_MULTI]) {
            const c = craft(rareRing([], [from.id]), [harvestChange(from.id, COLD_DAMAGE.id)]);
            expect(check(c, ctx).diagnostics[0]!.message).toContain("The grove changes");
        }
        const hybrid = craft(rareRing([], [FIRE_CHAOS_RESIST.id]), [
            harvestChange(FIRE_CHAOS_RESIST.id, COLD_RESIST.id),
        ]);
        expect(check(hybrid, ctx).diagnostics[0]!.message).toContain("The grove changes");
    });

    it("turns the named modifier into the other, keeping the count", () => {
        const c = craft(rareRing([], [FIRE_RESIST.id, LIGHTNING_RESIST.id]), [
            harvestChange(FIRE_RESIST.id, COLD_RESIST.id),
        ]);
        const r = check(c, ctx);
        expect(r.diagnostics).toEqual([]);
        const s = r.finalState!;
        expect(guaranteedTypes(s).has(COLD_RESIST.type)).toBe(true);
        expect(isExcluded(s, FIRE_RESIST.type)).toBe(true);
        expect(s.counts.total).toEqual([2, 2]);
    });

    it("keeps a benched modifier among the crafted ones, so the next bench replaces it", () => {
        const changed = check(
            craft(rareRing(), [
                bench("fire resistance"),
                harvestChange(FIRE_RESIST.id, COLD_RESIST.id),
            ]),
            ctx,
        );
        expect(changed.diagnostics).toEqual([]);
        expect(changed.finalState!.crafted).toEqual([1, 1]);
        expect(changed.finalState!.craftedTypes.has(COLD_RESIST.type)).toBe(true);
        const again = check(
            craft(rareRing(), [
                bench("fire resistance"),
                harvestChange(FIRE_RESIST.id, COLD_RESIST.id),
                bench("maximum life"),
            ]),
            ctx,
        );
        expect(again.diagnostics).toEqual([]);
        // The bench replaces the one crafted modifier, the changed resistance,
        // rather than adding a second beside it.
        expect(again.finalState!.counts.suffix).toEqual([0, 0]);
        expect(guaranteedTypes(again.finalState!).has(COLD_RESIST.type)).toBe(false);
    });

    it("lands at the source's tier when that tier is known", () => {
        const pinned = check(
            craft(rareRing([], ["FireTiersMid"]), [harvestChange("FireTiersMid", "ColdTiersLow")]),
            ctx,
        );
        expect(pinned.diagnostics).toEqual([]);
        expect(pinned.finalState!.tiers.get(TypeId("ColdTiers"))).toEqual(
            new Set(["ColdTiersMid"]),
        );
        // After a reforge the life's tier is unknown, so the mana may be any tier.
        const loose = check(
            craft(rareRing(), [op("chaos"), harvestChange("FireTiersMid", "ColdTiersLow")]),
            ctx,
        );
        expect(loose.diagnostics[0]!.message).toContain("isn't guaranteed");
    });

    it("lands at any tier when the two elements' tiers sit at different levels", () => {
        const offset = COLD_RES_TIERS.map((m, i) => (i === 1 ? { ...m, minLevel: 35 } : m));
        const skewed = buildRegistry({
            bases: [RING_BASE],
            mods: [...CATALOG, ...FIRE_RES_TIERS, ...offset],
            baseAliases: { "Iron Ring": "IronRing" },
        });
        const r = check(
            craft(rareRing([], ["FireTiersMid"]), [harvestChange("FireTiersMid", "ColdTiersLow")]),
            { registry: skewed },
        );
        expect(r.diagnostics).toEqual([]);
        expect(r.finalState!.tiers.get(TypeId("ColdTiers"))).toEqual(
            new Set(["ColdTiersLow", "ColdTiersMid", "ColdTiersHigh"]),
        );
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

    it("offers only the elemental resistances among themselves and the elemental damages likewise", () => {
        const life = check(
            craft(rareRing(["T1 Life"]), [harvestChange("T1 Life", COLD_RESIST.id)]),
            ctx,
        );
        expect(life.diagnostics[0]!.message).toContain("fire, cold or lightning resistance");
        const same = check(
            craft(rareRing([], [FIRE_RESIST.id]), [harvestChange(FIRE_RESIST.id, "FireTiersLow")]),
            ctx,
        );
        expect(same.diagnostics[0]!.message).toContain("fire, cold or lightning resistance");
        const damage = check(
            craft(rareRing([FIRE_DAMAGE.id]), [harvestChange(FIRE_DAMAGE.id, COLD_DAMAGE.id)]),
            ctx,
        );
        expect(damage.diagnostics).toEqual([]);
        expect(guaranteedTypes(damage.finalState!).has(COLD_DAMAGE.type)).toBe(true);
        const crossKind = check(
            craft(rareRing([], [FIRE_RESIST.id]), [harvestChange(FIRE_RESIST.id, COLD_DAMAGE.id)]),
            ctx,
        );
        expect(crossKind.diagnostics[0]!.message).toContain("fire, cold or lightning resistance");
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
            craft(
                item({
                    base: "Coral Amulet",
                    ilvl: 100,
                    rarity: "rare",
                    suffixes: [FIRE_RESIST.id],
                }),
                [harvestChange(FIRE_RESIST.id, "ColdTiersLow")],
            ),
            ctx,
        );
        expect(nowhere.diagnostics[0]!.message).toContain("cannot roll on this item");
    });
});
