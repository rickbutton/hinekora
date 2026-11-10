import { describe, expect, it } from "vitest";
import { check, type CheckContext } from "./check.js";
import { guaranteedTypes, isExcluded } from "./astate.js";
import { buildRegistry } from "../resolve/registry.js";
import { unitCost } from "../cost/prices.js";
import { findMethod } from "./methods.js";
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
import { GroupId, ModId, TagId, TypeId } from "../model/ids.js";
import type { Mod } from "../model/mod.js";
import type { HarvestChangeLists } from "../model/sources.js";

const COLD_DOT_MULTI: Mod = {
    ...FIRE_DOT_MULTI,
    id: ModId("ColdDotMulti1"),
    type: TypeId("ColdDotMulti"),
    families: new Set([GroupId("ColdDotMulti")]),
    implicitTags: new Set(["dot_multi", "damage", "cold"].map(TagId)),
};
const COLD_CRIT_MULTI: Mod = {
    ...FIRE_CRIT_MULTI,
    id: ModId("ColdCritMulti1"),
    type: TypeId("ColdCritMulti"),
    families: new Set([GroupId("ColdCritMulti")]),
    implicitTags: new Set(["damage", "cold", "critical"].map(TagId)),
};
/** The grove's lists in miniature: the critical strike multipliers are named,
 *  as in the game's, and the resistance shared with chaos is not. */
const HARVEST_CHANGE: HarvestChangeLists = {
    resistance: {
        fire: ["FireResist", "FireTiers"].map(TypeId),
        cold: ["ColdResist", "ColdTiers"].map(TypeId),
        lightning: ["LightningResist"].map(TypeId),
    },
    damage: {
        fire: ["FireDamage", "FireCritMulti", "FireDotMulti"].map(TypeId),
        cold: ["ColdDamage", "ColdCritMulti", "ColdDotMulti"].map(TypeId),
        lightning: [],
    },
};

const registry = buildRegistry({
    bases: [RING_BASE, AMULET_BASE],
    harvestChange: HARVEST_CHANGE,
    mods: [
        ...CATALOG,
        ...FIRE_RES_TIERS,
        ...COLD_RES_TIERS,
        FIRE_DAMAGE,
        COLD_DAMAGE,
        FIRE_CRIT_MULTI,
        COLD_CRIT_MULTI,
        FIRE_DOT_MULTI,
        COLD_DOT_MULTI,
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
    it("refuses a critical strike multiplier though the list names it, and a type it does not name", () => {
        const crit = craft(rareRing([], [FIRE_CRIT_MULTI.id]), [
            harvestChange(FIRE_CRIT_MULTI.id, COLD_CRIT_MULTI.id),
        ]);
        expect(check(crit, ctx).diagnostics[0]!.message).toContain("no critical strike multiplier");
        const hybrid = craft(rareRing([], [FIRE_CHAOS_RESIST.id]), [
            harvestChange(FIRE_CHAOS_RESIST.id, COLD_RESIST.id),
        ]);
        expect(check(hybrid, ctx).diagnostics[0]!.message).toContain("The grove changes");
    });

    it("refuses a damage over time multiplier, listed but reported both ways in play", () => {
        const dot = check(
            craft(rareRing([], [FIRE_DOT_MULTI.id]), [
                harvestChange(FIRE_DOT_MULTI.id, COLD_DOT_MULTI.id),
            ]),
            ctx,
        );
        expect(dot.diagnostics[0]!.message).toContain("damage over time multiplier");
        expect(guaranteedTypes(dot.finalState!).has(FIRE_DOT_MULTI.type)).toBe(true);
    });

    it("costs 500 lifeforce of the new element's colour, a damage change a Crystallised Rancour besides", () => {
        const unit = (from: string, to: string) => {
            const before = check(craft(rareRing([FIRE_DAMAGE.id], [FIRE_RESIST.id]), []), ctx);
            const args = [from, to].map((value) => ({ kind: "string" as const, value }));
            return unitCost(findMethod(["harvest", "change"])!, args, before.finalState!, registry);
        };
        expect(unit(FIRE_RESIST.id, "cold resistance")).toEqual([
            { item: "Vivid Crystallised Lifeforce", amount: 500 },
        ]);
        expect(unit(FIRE_DAMAGE.id, "adds cold damage")).toEqual([
            { item: "Vivid Crystallised Lifeforce", amount: 500 },
            { item: "Crystallised Rancour", amount: 1 },
        ]);
    });

    it("changes a modifier into its counterpart only, and refuses one with none", () => {
        // Both are fire and cold damage modifiers; they are not the same modifier.
        const other = check(
            craft(rareRing([FIRE_DAMAGE.id]), [harvestChange(FIRE_DAMAGE.id, COLD_DOT_MULTI.id)]),
            ctx,
        );
        expect(other.diagnostics[0]!.message).toContain(
            'The grove changes "FireDamage1" into "adds cold damage"',
        );
        const none = buildRegistry({
            bases: [RING_BASE],
            harvestChange: {
                resistance: HARVEST_CHANGE.resistance,
                damage: { ...HARVEST_CHANGE.damage, cold: [COLD_DOT_MULTI.type] },
            },
            mods: [...CATALOG, FIRE_DAMAGE, COLD_DOT_MULTI],
            baseAliases: { "Iron Ring": "IronRing" },
        });
        const lone = check(
            craft(rareRing([FIRE_DAMAGE.id]), [harvestChange(FIRE_DAMAGE.id, COLD_DOT_MULTI.id)]),
            { registry: none },
        );
        expect(lone.diagnostics[0]!.message).toContain("has no cold counterpart");
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

    it("keeps the tier where the two elements' tiers sit at different levels, while as many of each roll", () => {
        // The game's ladders are offset by a level or two (fire resistance at
        // 12, cold at 14), which leaves the rank the same tier.
        const offset = COLD_RES_TIERS.map((m, i) => (i === 1 ? { ...m, minLevel: 35 } : m));
        const skewed = buildRegistry({
            bases: [RING_BASE],
            harvestChange: HARVEST_CHANGE,
            mods: [...CATALOG, ...FIRE_RES_TIERS, ...offset],
            baseAliases: { "Iron Ring": "IronRing" },
        });
        const change = (ilvl: number) =>
            check(
                craft(
                    item({ base: "Iron Ring", ilvl, rarity: "rare", suffixes: ["FireTiersMid"] }),
                    [harvestChange("FireTiersMid", "ColdTiersLow")],
                ),
                { registry: skewed },
            );
        const level = change(100);
        expect(level.diagnostics).toEqual([]);
        expect(level.finalState!.tiers.get(TypeId("ColdTiers"))).toEqual(new Set(["ColdTiersMid"]));
        // At item level 32 two fire tiers roll and one cold: which cold row the
        // fire's second tier becomes is not known, so any that rolls, or the
        // cold's second tier, the same tier though above the item's level.
        const between = change(32);
        expect(between.diagnostics).toEqual([]);
        expect(between.finalState!.tiers.get(TypeId("ColdTiers"))).toEqual(
            new Set(["ColdTiersLow", "ColdTiersMid"]),
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
        expect(dup.diagnostics[0]!.message).toContain("the grove can't change a modifier into it");
        const nowhere = check(
            craft(
                item({
                    base: "Coral Amulet",
                    ilvl: 100,
                    rarity: "rare",
                    suffixes: ["FireTiersLow"],
                }),
                [harvestChange("FireTiersLow", "ColdTiersLow")],
            ),
            ctx,
        );
        expect(nowhere.diagnostics[0]!.message).toContain("cannot roll on this item");
    });
});
