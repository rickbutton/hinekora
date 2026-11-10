import { describe, expect, it } from "vitest";
import { check, type CheckContext } from "./check.js";
import { guaranteedTypes, isExcluded } from "./astate.js";
import { buildRegistry } from "../resolve/registry.js";
import { unitCost } from "../cost/prices.js";
import { findMethod } from "./methods.js";
import {
    andp,
    bench,
    benchRemove,
    craft,
    essence,
    harvestChange,
    has,
    hasValue,
    iff,
    item,
    notp,
    op,
    stop,
    until,
} from "../__fixtures__/ast.js";
import {
    AMULET_BASE,
    BENCH_FIRE_RES_ROW,
    BENCH_LIFE_ROW,
    BOOTS_BASE,
    CATALOG,
    CLASS_AMULET,
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
    harvestTable,
    PROTECT_SUFFIXES_CARRIER,
    RING_BASE,
    LIGHTNING_RESIST,
} from "../__fixtures__/mods.js";
import { BaseId, ClassId, GroupId, ModId, TagId, TypeId } from "../model/ids.js";
import type { Stmt } from "../ast/ast.js";
import type { Mod } from "../model/mod.js";

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
/** The grove's table in miniature: the critical strike multipliers are listed
 *  and refused, as in the game's, and the resistance shared with chaos is not
 *  listed. */
const RESISTANCES = [
    ["FireResist", "ColdResist", "LightningResist"],
    ["FireTiers", "ColdTiers"],
];
const DAMAGES = [
    ["FireDamage", "ColdDamage"],
    ["FireCritMulti"],
    ["", "ColdCritMulti"],
    ["FireDotMulti", "ColdDotMulti"],
];
const HARVEST_CHANGE = harvestTable({ resistance: RESISTANCES, damage: DAMAGES });
const AILMENTS = harvestTable({ resistance: [["FireAilments", "ColdAilments"]], damage: [] });

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

    it("takes a damage over time multiplier, and refuses it for lightning, which has none", () => {
        const dot = check(
            craft(rareRing([], [FIRE_DOT_MULTI.id]), [
                harvestChange(FIRE_DOT_MULTI.id, COLD_DOT_MULTI.id),
            ]),
            ctx,
        );
        expect(dot.diagnostics).toEqual([]);
        expect(guaranteedTypes(dot.finalState!).has(COLD_DOT_MULTI.type)).toBe(true);
        expect(isExcluded(dot.finalState!, FIRE_DOT_MULTI.type)).toBe(true);
        const lightning: Mod = {
            ...FIRE_DAMAGE,
            id: ModId("LightningDamage1"),
            type: TypeId("LightningDamage"),
            families: new Set([GroupId("LightningDamage")]),
        };
        const withLightning = buildRegistry({
            bases: [RING_BASE],
            harvestChange: harvestTable({
                resistance: RESISTANCES,
                damage: [...DAMAGES, ["", "", lightning.type]],
            }),
            mods: [...CATALOG, FIRE_DOT_MULTI, COLD_DOT_MULTI, lightning],
            baseAliases: { "Iron Ring": "IronRing" },
        });
        const none = check(
            craft(rareRing([], [FIRE_DOT_MULTI.id]), [
                harvestChange(FIRE_DOT_MULTI.id, lightning.id),
            ]),
            { registry: withLightning },
        );
        expect(none.diagnostics[0]!.message).toContain("has no lightning modifier to change");
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
            harvestChange: harvestTable({
                resistance: RESISTANCES,
                damage: [["FireDamage"], ["", COLD_DOT_MULTI.type]],
            }),
            mods: [...CATALOG, FIRE_DAMAGE, COLD_DOT_MULTI],
            baseAliases: { "Iron Ring": "IronRing" },
        });
        const lone = check(
            craft(rareRing([FIRE_DAMAGE.id]), [harvestChange(FIRE_DAMAGE.id, COLD_DOT_MULTI.id)]),
            { registry: none },
        );
        expect(lone.diagnostics[0]!.message).toContain("has no cold modifier to change");
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
        // The bench has no cold row here, so the cold is a natural row.
        expect(changed.finalState!.tiers.get(COLD_RESIST.type)).toEqual(new Set([COLD_RESIST.id]));
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
        // A fire resistance found after a reforge may be any tier, so the cold
        // may be any.
        const loose = check(
            craft(rareRing(), [
                op("chaos"),
                iff(
                    andp(has("FireTiersLow"), notp(has("ColdTiersLow"))),
                    [harvestChange("FireTiersLow", "ColdTiersLow")],
                    [stop()],
                ),
            ]),
            ctx,
        );
        expect(loose.diagnostics).toEqual([]);
        expect(loose.finalState!.tiers.get(TypeId("ColdTiers"))).toEqual(
            new Set(["ColdTiersLow", "ColdTiersMid", "ColdTiersHigh"]),
        );
    });

    it("changes a modifier that rolls nowhere into its counterpart of the same level", () => {
        // The target has no row that rolls here, and a counterpart at another
        // level is not it.
        const placed = (name: string, minLevel: number): Mod => ({
            ...FIRE_RESIST,
            id: ModId(`${name}Level${minLevel}`),
            type: TypeId(`${name}Ailments`),
            families: new Set([GroupId(name)]),
            minLevel,
            spawn: [{ tag: TagId("default"), weight: 0 }],
            source: "other",
            text: `+(46-48)% to ${name} Resistance against Ailing Enemies`,
        });
        const rows = [placed("Fire", 50), placed("Cold", 50), placed("Cold", 30)];
        const incursion = buildRegistry({
            bases: [RING_BASE],
            harvestChange: AILMENTS,
            mods: [...CATALOG, ...rows],
            baseAliases: { "Iron Ring": "IronRing" },
        });
        const r = check(
            craft(rareRing([], ["FireLevel50"]), [harvestChange("FireLevel50", "ColdLevel50")]),
            { registry: incursion },
        );
        expect(r.diagnostics).toEqual([]);
        expect(r.finalState!.tiers.get(TypeId("ColdAilments"))).toEqual(new Set(["ColdLevel50"]));
    });

    it("changes a benched modifier into the bench's counterpart, crafted still", () => {
        // Seen in game: the result is the bench's own modifier, which its
        // "Remove Crafted Modifiers" takes off.
        const benchCold: Mod = {
            ...BENCH_FIRE_RES_ROW,
            id: ModId("BenchColdResist1"),
            type: COLD_RESIST.type,
            families: COLD_RESIST.families,
            text: "+(13-18)% to Cold Resistance",
        };
        // The bench's cold row for another class is not this ring's.
        const amuletCold: Mod = { ...benchCold, id: ModId("BenchColdResistAmulet1") };
        const withTwin = buildRegistry({
            bases: [RING_BASE],
            harvestChange: HARVEST_CHANGE,
            mods: [...CATALOG, BENCH_FIRE_RES_ROW, benchCold, amuletCold],
            baseAliases: { "Iron Ring": "IronRing" },
            benchCrafts: [
                ...[BENCH_FIRE_RES_ROW, benchCold].map((m) => ({
                    mod: m.id,
                    tier: 1,
                    itemClasses: new Set([CLASS_RING]),
                })),
                { mod: amuletCold.id, tier: 1, itemClasses: new Set([CLASS_AMULET]) },
            ],
        });
        const r = check(
            craft(rareRing(), [
                bench("fire resistance"),
                harvestChange(FIRE_RESIST.id, COLD_RESIST.id),
            ]),
            { registry: withTwin },
        );
        expect(r.diagnostics).toEqual([]);
        expect(r.finalState!.tiers.get(COLD_RESIST.type)).toEqual(new Set([benchCold.id]));
        expect(r.finalState!.crafted).toEqual([1, 1]);
        const removed = check(
            craft(rareRing(), [
                bench("fire resistance"),
                harvestChange(FIRE_RESIST.id, COLD_RESIST.id),
                benchRemove(),
            ]),
            { registry: withTwin },
        );
        expect(removed.diagnostics).toEqual([]);
        expect(isExcluded(removed.finalState!, COLD_RESIST.type)).toBe(true);
    });

    it("reads a modifier with no tier recorded as any row it may be, a crafted one among them", () => {
        // An unnamed bench suffix may be the bench's fire resistance or not; a
        // fire resistance found on the item is then that or the natural row.
        const benchCold: Mod = {
            ...BENCH_FIRE_RES_ROW,
            id: ModId("BenchColdResist1"),
            type: COLD_RESIST.type,
            families: COLD_RESIST.families,
            text: "+(13-18)% to Cold Resistance",
        };
        const reg = buildRegistry({
            bases: [RING_BASE],
            harvestChange: HARVEST_CHANGE,
            mods: [...CATALOG, BENCH_FIRE_RES_ROW, benchCold],
            baseAliases: { "Iron Ring": "IronRing" },
            benchCrafts: [BENCH_FIRE_RES_ROW, benchCold].map((m) => ({
                mod: m.id,
                tier: 1,
                itemClasses: new Set([CLASS_RING]),
            })),
        });
        const start = item({
            base: "Iron Ring",
            ilvl: 100,
            rarity: "rare",
            suffixes: [{ mod: "random", bench: true }],
        });
        const r = check(
            craft(start, [
                iff(
                    andp(has("fire resistance"), notp(has("cold resistance"))),
                    [harvestChange("fire resistance", "cold resistance")],
                    [stop()],
                ),
            ]),
            { registry: reg },
        );
        expect(r.diagnostics).toEqual([]);
        expect(r.finalState!.tiers.get(COLD_RESIST.type)).toEqual(
            new Set([benchCold.id, COLD_RESIST.id]),
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

describe("a Harvest change where the elements' tiers unlock at different levels", () => {
    // The game's resistance ladders: fire's tiers unlock at levels 1, 12, 24
    // and 36, cold's at 1, 14, 26 and 38, with the same values at each rank.
    const SPANS = ["(6-11)", "(12-17)", "(18-23)", "(24-29)"];
    const ladder = (element: "Fire" | "Cold", levels: number[]): Mod[] =>
        levels.map((minLevel, i) => ({
            ...FIRE_RES_TIERS[0]!,
            id: ModId(`${element}Tiers${minLevel}`),
            type: TypeId(`${element}Tiers`),
            families: new Set([GroupId(`Resist${element}T`)]),
            minLevel,
            text: `+${SPANS[i]!}% to ${element} Resistance`,
        }));
    const offset = buildRegistry({
        bases: [RING_BASE],
        harvestChange: HARVEST_CHANGE,
        mods: [...CATALOG, ...ladder("Fire", [1, 12, 24, 36]), ...ladder("Cold", [1, 14, 26, 38])],
        baseAliases: { "Iron Ring": "IronRing" },
    });
    const COLD = TypeId("ColdTiers");
    const FIRE = TypeId("FireTiers");
    /** The change of a modifier the item starts with at a known tier. */
    const known = (ilvl: number, from: string, to: string, after: Stmt[] = []) =>
        check(
            craft(item({ base: "Iron Ring", ilvl, rarity: "rare", suffixes: [from] }), [
                harvestChange(from, to),
                ...after,
            ]),
            { registry: offset },
        );

    it("keeps the tier, though the item's level does not roll that tier of the other element", () => {
        // Seen in game: an item of level 25 with the level-24 fire resistance
        // has the level-26 cold resistance after the change.
        const r = known(25, "FireTiers24", "ColdTiers1");
        expect(r.diagnostics).toEqual([]);
        expect(r.finalState!.tiers.get(COLD)).toEqual(new Set(["ColdTiers26"]));
        expect(isExcluded(r.finalState!, FIRE)).toBe(true);
    });

    it("leaves a modifier whose value a guide can test, its tier having no number", () => {
        // The cold resistance is +(18-23)%: at least 18 on every path.
        const r = known(25, "FireTiers24", "ColdTiers1", [
            iff(hasValue("ColdTiers1", ">=", 18), [], [stop()]),
        ]);
        expect(r.diagnostics).toHaveLength(1);
        expect(r.diagnostics[0]!.message).toContain("always holds here");
    });

    it("takes a tier above the item's level back to the one it came from", () => {
        const r = known(25, "FireTiers24", "ColdTiers1", [
            harvestChange("ColdTiers1", "FireTiers1"),
        ]);
        expect(r.diagnostics).toEqual([]);
        expect(r.finalState!.tiers.get(FIRE)).toEqual(new Set(["FireTiers24"]));
        const down = known(27, "ColdTiers26", "FireTiers1");
        expect(down.diagnostics).toEqual([]);
        expect(down.finalState!.tiers.get(FIRE)).toEqual(new Set(["FireTiers24"]));
    });

    it("gives each tier's own where the modifier may be any of several", () => {
        // Three fire tiers roll at level 25; the cold of the third does not.
        const r = check(
            craft(item({ base: "Iron Ring", ilvl: 25, rarity: "rare" }), [
                op("chaos"),
                iff(
                    andp(has("FireTiers1"), notp(has("ColdTiers1"))),
                    [harvestChange("FireTiers1", "ColdTiers1")],
                    [stop()],
                ),
            ]),
            { registry: offset },
        );
        expect(r.diagnostics).toEqual([]);
        expect(r.finalState!.tiers.get(COLD)).toEqual(
            new Set(["ColdTiers1", "ColdTiers14", "ColdTiers26"]),
        );
    });

    it("gives every tier of the ladder for a modifier with no tier recorded", () => {
        // An unnamed bench suffix leaves the fire resistance any row: a tier
        // above the item's level among them, which an earlier change may leave.
        const start = item({
            base: "Iron Ring",
            ilvl: 25,
            rarity: "rare",
            suffixes: [{ mod: "random", bench: true }],
        });
        const benched = buildRegistry({
            bases: [RING_BASE],
            harvestChange: harvestTable({
                resistance: [["FireResist", "ColdTiers"]],
                damage: [],
            }),
            mods: [
                ...CATALOG,
                // The bench's fire resistance is of the natural ladder's type.
                ...ladder("Fire", [1, 12, 24, 36]).map((m) => ({
                    ...m,
                    type: FIRE_RESIST.type,
                    families: FIRE_RESIST.families,
                })),
                ...ladder("Cold", [1, 14, 26, 38]),
                BENCH_FIRE_RES_ROW,
            ].filter((m) => m.id !== FIRE_RESIST.id),
            baseAliases: { "Iron Ring": "IronRing" },
            benchCrafts: [
                { mod: BENCH_FIRE_RES_ROW.id, tier: 1, itemClasses: new Set([CLASS_RING]) },
            ],
        });
        const r = check(
            craft(start, [
                iff(
                    andp(has("fire resistance"), notp(has("ColdTiers1"))),
                    [harvestChange("fire resistance", "ColdTiers1")],
                    [stop()],
                ),
            ]),
            { registry: benched },
        );
        expect(r.diagnostics).toEqual([]);
        expect(r.finalState!.tiers.get(COLD)).toEqual(
            new Set(["ColdTiers1", "ColdTiers14", "ColdTiers26", "ColdTiers38"]),
        );
    });

    it("gives a bench craft the tiers that roll and a recorded tier its own", () => {
        const benchFire: Mod = {
            ...BENCH_FIRE_RES_ROW,
            id: ModId("BenchFireTiers"),
            type: FIRE,
            families: new Set([GroupId("ResistFireT")]),
        };
        const benched = buildRegistry({
            bases: [RING_BASE],
            harvestChange: HARVEST_CHANGE,
            mods: [
                ...CATALOG,
                ...ladder("Fire", [1, 12, 24, 36]),
                ...ladder("Cold", [1, 14, 26, 38]),
                benchFire,
            ],
            baseAliases: { "Iron Ring": "IronRing" },
            benchCrafts: [{ mod: benchFire.id, tier: 1, itemClasses: new Set([CLASS_RING]) }],
        });
        // The fire is the bench's on one path and the best tier that rolls on
        // the other. The bench has no cold craft here, so its fire becomes a
        // cold that rolls; the tier becomes the cold of its rank.
        const r = check(
            craft(item({ base: "Iron Ring", ilvl: 25, rarity: "rare", prefixes: ["random"] }), [
                iff(
                    has("IncreasedMana1"),
                    [bench("fire resistance")],
                    [until(has("FireTiers1", 1), [op("chaos")])],
                ),
                iff(notp(has("ColdTiers1")), [harvestChange("FireTiers1", "ColdTiers1")], [stop()]),
            ]),
            { registry: benched },
        );
        expect(r.diagnostics).toEqual([]);
        expect(r.finalState!.tiers.get(COLD)).toEqual(
            new Set(["ColdTiers1", "ColdTiers14", "ColdTiers26"]),
        );
    });
});

describe("a Harvest change into a modifier of the changed one's group", () => {
    // The shipped shape: a wand's added damage to spells is one group for the
    // three elements, a shield's increased elemental damage another.
    const base = (id: string, cls: string, tag: string) => ({
        id: BaseId(id),
        name: id,
        itemClass: ClassId(cls),
        domain: RING_BASE.domain,
        tags: new Set(["default", tag].map(TagId)),
    });
    const row = (id: string, tag: string, group: string, text: string): Mod => ({
        ...FIRE_DAMAGE,
        id: ModId(`${id}1`),
        type: TypeId(id),
        families: new Set([GroupId(group)]),
        spawn: [
            { tag: TagId(tag), weight: 1000 },
            { tag: TagId("default"), weight: 0 },
        ],
        text,
    });
    const spells = (element: string) =>
        row(
            `${element}Spells`,
            "wand",
            "SpellAddedElementalDamage",
            `Adds # to # ${element} Damage to Spells`,
        );
    const increased = (element: string) =>
        row(
            `${element}Increased`,
            "shield",
            "WeaponCasterDamagePrefix",
            `#% increased ${element} Damage`,
        );
    const grouped = buildRegistry({
        bases: [base("Pagan Wand", "Wand", "wand"), base("Spirit Shield", "Shield", "shield")],
        harvestChange: harvestTable({
            resistance: RESISTANCES,
            damage: [
                ["FireSpells", "ColdSpells", "LightningSpells"],
                ["FireIncreased", "ColdIncreased"],
            ],
        }),
        mods: [
            ...CATALOG,
            ...["Fire", "Cold", "Lightning"].map(spells),
            ...["Fire", "Cold"].map(increased),
        ],
    });
    const changed = (on: string, prefixes: string[], from: string, to: string) =>
        check(
            craft(item({ base: on, ilvl: 100, rarity: "rare", prefixes }), [
                harvestChange(from, to),
            ]),
            { registry: grouped },
        );

    it("is taken, the changed modifier making room for its replacement", () => {
        const wand = changed("Pagan Wand", ["LightningSpells1"], "LightningSpells1", "FireSpells1");
        expect(wand.diagnostics).toEqual([]);
        expect(guaranteedTypes(wand.finalState!).has(TypeId("FireSpells"))).toBe(true);
        expect(isExcluded(wand.finalState!, TypeId("LightningSpells"))).toBe(true);
        const shield = changed(
            "Spirit Shield",
            ["FireIncreased1"],
            "FireIncreased1",
            "ColdIncreased1",
        );
        expect(shield.diagnostics).toEqual([]);
        expect(guaranteedTypes(shield.finalState!).has(TypeId("ColdIncreased"))).toBe(true);
    });

    it("is refused where another modifier on the item is of the target's group", () => {
        // A fire resistance beside the fire and chaos resistance, one group.
        const r = check(
            craft(rareRing([], [COLD_RESIST.id, FIRE_CHAOS_RESIST.id]), [
                harvestChange(COLD_RESIST.id, FIRE_RESIST.id),
            ]),
            ctx,
        );
        expect(r.diagnostics[0]!.message).toContain("at most one per group");
    });
});

describe("a Harvest change on an item with two influences", () => {
    const lists = AILMENTS;
    /** A row that rolls on boots of one influence alone. */
    const row = (element: "Fire" | "Cold", tag: "shaper" | "eyrie", minLevel: number): Mod => ({
        ...FIRE_RESIST,
        id: ModId(`${element}_${tag}_${minLevel}`),
        type: TypeId(`${element}Ailments`),
        families: new Set([GroupId(`${element}Ailments`)]),
        minLevel,
        spawn: [
            { tag: TagId(`boots_${tag}`), weight: 500 },
            { tag: TagId("default"), weight: 0 },
        ],
        text: `+(46-48)% to ${element} Resistance against Ailing Enemies`,
    });
    const changed = (mods: readonly Mod[], from: string, ilvl = 100) =>
        check(
            craft(
                item({
                    base: "Iron Greaves",
                    ilvl,
                    rarity: "rare",
                    influences: ["shaper", "redeemer"],
                    suffixes: [from],
                }),
                [harvestChange(from, mods.find((m) => m.type === "ColdAilments")!.id)],
            ),
            {
                registry: buildRegistry({
                    bases: [BOOTS_BASE],
                    harvestChange: lists,
                    mods: [...CATALOG, ...mods],
                }),
            },
        );
    const cold = (r: ReturnType<typeof check>) => r.finalState!.tiers.get(TypeId("ColdAilments"));

    it("is refused where the other element has rows of the other influence only", () => {
        // The Shaper's fire rows and the Redeemer's cold rows are ladders of
        // equal length: the rank alone would pair them.
        const mods = [
            row("Fire", "shaper", 80),
            row("Fire", "shaper", 68),
            row("Cold", "eyrie", 78),
            row("Cold", "eyrie", 68),
        ];
        const r = changed(mods, "Fire_shaper_80");
        expect(r.diagnostics[0]!.message).toContain("cannot roll on this item");
    });

    it("keeps the rank within the modifier's own influence where the ladders differ in length", () => {
        const mods = [
            row("Fire", "shaper", 80),
            row("Fire", "shaper", 68),
            row("Fire", "eyrie", 78),
            row("Fire", "eyrie", 68),
            row("Cold", "eyrie", 78),
            row("Cold", "eyrie", 68),
        ];
        const redeemer = changed(mods, "Fire_eyrie_78");
        expect(redeemer.diagnostics).toEqual([]);
        expect(cold(redeemer)).toEqual(new Set(["Cold_eyrie_78"]));
        const shaper = changed(mods, "Fire_shaper_80");
        expect(shaper.diagnostics[0]!.message).toContain("cannot roll on this item");
    });

    it("gives any row of a longer or shorter ladder, whose rank names no one row", () => {
        const mods = [row("Fire", "eyrie", 68), row("Cold", "eyrie", 78), row("Cold", "eyrie", 68)];
        for (const ilvl of [100, 70]) {
            const all = changed(mods, "Fire_eyrie_68", ilvl);
            expect(all.diagnostics).toEqual([]);
            expect(cold(all)).toEqual(new Set(["Cold_eyrie_78", "Cold_eyrie_68"]));
        }
    });
});

describe("a Harvest change of a natural row an essence placed", () => {
    // The shipped shape: the essences of Hatred and Anger place rows of the
    // resistances' own ladders on boots, at levels a low item does not roll;
    // the essences of Torment and Anguish place spell damage rows on an axe,
    // which rolls none.
    const AXE_BASE = {
        id: BaseId("VaalHatchet"),
        name: "Vaal Hatchet",
        itemClass: ClassId("One Hand Axe"),
        domain: BOOTS_BASE.domain,
        tags: new Set(["default", "axe", "one_hand_weapon"].map(TagId)),
    };
    const ladder = (name: string, on: string, gen: "prefix" | "suffix", levels: number[]): Mod[] =>
        levels.map((minLevel, i) => ({
            ...FIRE_RESIST,
            id: ModId(`${name}${i + 1}`),
            type: TypeId(name),
            gen,
            families: new Set([GroupId(name)]),
            minLevel,
            spawn: [
                { tag: TagId(on), weight: 1000 },
                { tag: TagId("default"), weight: 0 },
            ],
            text: `+# to ${name}`,
        }));
    const mods = [
        ...ladder("ColdBoots", "armour", "suffix", [1, 14, 26, 38, 50, 60, 72, 84]),
        ...ladder("FireBoots", "armour", "suffix", [1, 12, 24, 36, 48, 60, 72, 84]),
        ...ladder("LightningSpells", "wand", "prefix", [1, 30, 74]),
        ...ladder("FireSpells", "wand", "prefix", [1, 30, 74]),
        ...ladder("ColdSpells", "wand", "prefix", [1, 30, 74]),
    ];
    const BOOTS = ClassId("Boots");
    const grant = (name: string, tier: number, cls: ClassId, mod: string) => ({
        id: name,
        name,
        tier,
        grants: new Map([[cls, ModId(mod)]]),
    });
    const essenced = buildRegistry({
        bases: [BOOTS_BASE, AXE_BASE],
        harvestChange: harvestTable({
            resistance: [["FireBoots", "ColdBoots"]],
            damage: [["FireSpells", "ColdSpells", "LightningSpells"]],
        }),
        mods: [...CATALOG, ...mods],
        essences: [
            grant("Weeping Essence of Hatred", 3, BOOTS, "ColdBoots3"),
            grant("Screaming Essence of Hatred", 5, BOOTS, "ColdBoots6"),
            grant("Deafening Essence of Hatred", 7, BOOTS, "ColdBoots8"),
            grant("Screaming Essence of Anger", 5, BOOTS, "FireBoots6"),
            grant("Deafening Essence of Anger", 7, BOOTS, "FireBoots8"),
            grant("Deafening Essence of Torment", 7, AXE_BASE.itemClass, "LightningSpells3"),
            grant("Deafening Essence of Anguish", 7, AXE_BASE.itemClass, "FireSpells3"),
        ],
    });
    /** The rows `to` may be after the essence and the change of its modifier. */
    const after = (base: string, ilvl: number, name: string, from: string, to: string) => {
        // The essence's reforge may roll the target on boots, never on the axe.
        const change = harvestChange(from, to);
        const r = check(
            craft(item({ base, ilvl, rarity: "normal" }), [
                essence(name),
                base === "Vaal Hatchet" ? change : iff(notp(has(to)), [change], [stop()]),
            ]),
            { registry: essenced },
        );
        return r.diagnostics.length > 0
            ? r.diagnostics[0]!.message
            : r.finalState!.tiers.get(TypeId(to.slice(0, -1)));
    };

    it("becomes the row of its rank, above the item's level too", () => {
        const change = (ilvl: number) =>
            after("Iron Greaves", ilvl, "Deafening Essence of Hatred", "ColdBoots1", "FireBoots1");
        expect(change(83)).toEqual(new Set(["FireBoots8"]));
        expect(change(20)).toEqual(new Set(["FireBoots8"]));
        expect(change(84)).toEqual(new Set(["FireBoots8"]));
        expect(
            after("Iron Greaves", 59, "Screaming Essence of Hatred", "ColdBoots1", "FireBoots1"),
        ).toEqual(new Set(["FireBoots6"]));
        // No essence places the third fire tier: the rank alone decides.
        expect(
            after("Iron Greaves", 20, "Weeping Essence of Hatred", "ColdBoots1", "FireBoots1"),
        ).toEqual(new Set(["FireBoots3"]));
    });

    it("is ranked on the ladder it has elsewhere when the base rolls no such modifier", () => {
        const change = (to: string) =>
            after("Vaal Hatchet", 84, "Deafening Essence of Torment", "LightningSpells1", to);
        expect(change("FireSpells1")).toEqual(new Set(["FireSpells3"]));
        // No essence places a cold row on an axe.
        expect(change("ColdSpells1")).toContain("cannot roll on this item");
    });
});

describe("a Harvest change of a modifier another source placed", () => {
    const lists = AILMENTS;
    const unweighted = (...tags: string[]) =>
        [...tags, "default"].map((tag) => ({ tag: TagId(tag), weight: 0 }));
    /** A row of the fire or the cold type that rolls nowhere, at level 50. */
    const row = (element: "Fire" | "Cold", id: string, over: Partial<Mod> = {}): Mod => ({
        ...FIRE_RESIST,
        id: ModId(id),
        type: TypeId(`${element}Ailments`),
        families: new Set([GroupId(`${element}Ailments`)]),
        minLevel: 50,
        spawn: unweighted(),
        source: "other",
        text: `+(46-48)% to ${element} Resistance against Ailing Enemies`,
        ...over,
    });
    /** The cold type's one row that rolls. */
    const natural = row("Cold", "ColdNatural", {
        minLevel: 1,
        spawn: [{ tag: TagId("default"), weight: 500 }],
        source: "natural",
    });
    /** The rows the cold may be after the change of the item's "FireSource". */
    const changed = (
        mods: readonly Mod[],
        extra: Partial<Parameters<typeof buildRegistry>[0]> = {},
        on: Partial<Parameters<typeof item>[0]> = {},
    ) => {
        const reg = buildRegistry({
            bases: [RING_BASE, BOOTS_BASE],
            harvestChange: lists,
            mods: [...CATALOG, natural, ...mods],
            baseAliases: { "Iron Ring": "IronRing" },
            ...extra,
        });
        const start = item({
            base: "Iron Ring",
            ilvl: 100,
            rarity: "rare",
            suffixes: ["FireSource"],
            ...on,
        });
        const r = check(craft(start, [harvestChange("FireSource", "ColdNatural")]), {
            registry: reg,
        });
        expect(r.diagnostics).toEqual([]);
        return r.finalState!.tiers.get(TypeId("ColdAilments"));
    };

    it("is the counterpart alone for an Incursion modifier, named after its architect", () => {
        const name = "of Puhuarte";
        const rows = [row("Fire", "FireSource", { name }), row("Cold", "ColdTwin", { name })];
        expect(changed(rows)).toEqual(new Set(["ColdTwin"]));
    });

    it("is the counterpart or a natural row for any other modifier that rolls nowhere", () => {
        const name = "of the Retired";
        const rows = [row("Fire", "FireSource", { name }), row("Cold", "ColdTwin", { name })];
        expect(changed(rows)).toEqual(new Set(["ColdTwin", "ColdNatural"]));
    });

    it("keeps a counterpart above the item's level, which its source places at any level", () => {
        const name = "of the Retired";
        const rows = [row("Fire", "FireSource", { name }), row("Cold", "ColdTwin", { name })];
        expect(changed(rows, {}, { ilvl: 40 })).toEqual(new Set(["ColdTwin", "ColdNatural"]));
    });

    it("takes a counterpart whose spawn table names a tag of the base, not another base's", () => {
        const fossil = { source: "fossil" } as const;
        const rows = [
            row("Fire", "FireSource", fossil),
            row("Cold", "ColdTwin", { ...fossil, spawn: unweighted("ring") }),
            row("Cold", "ColdAmulet", { ...fossil, spawn: unweighted("amulet") }),
        ];
        expect(changed(rows)).toEqual(new Set(["ColdTwin", "ColdNatural"]));
    });

    it("takes a counterpart whose spawn table names an influence the item has", () => {
        const elevated = { source: "elevated" } as const;
        const rows = [
            row("Fire", "FireSource", { ...elevated, spawn: unweighted("boots_basilisk") }),
            row("Cold", "ColdTwin", { ...elevated, spawn: unweighted("boots_basilisk") }),
            row("Cold", "ColdElder", { ...elevated, spawn: unweighted("boots_elder") }),
            // A row that rolls under the influence, so the influence's tag exists.
            row("Cold", "ColdHunter", {
                minLevel: 1,
                source: "natural",
                spawn: [{ tag: TagId("boots_basilisk"), weight: 500 }, ...unweighted()],
            }),
        ];
        const cold = changed(rows, {}, { base: "Iron Greaves", influences: ["hunter"] });
        expect(cold?.has(ModId("ColdTwin"))).toBe(true);
        expect(cold?.has(ModId("ColdElder"))).toBe(false);
    });

    it("takes the essence's counterpart that an essence grants the item's class", () => {
        const essence = { source: "essence" } as const;
        const rows = [
            row("Fire", "FireSource", essence),
            row("Cold", "ColdTwin", essence),
            row("Cold", "ColdAmulet", essence),
        ];
        const grant = (id: string, cls: typeof CLASS_RING, mod: string) => ({
            id,
            name: `Essence of ${id}`,
            tier: 7,
            grants: new Map([[cls, ModId(mod)]]),
        });
        const essences = [
            grant("Rings", CLASS_RING, "ColdTwin"),
            grant("Amulets", CLASS_AMULET, "ColdAmulet"),
        ];
        expect(changed(rows, { essences })).toEqual(new Set(["ColdTwin", "ColdNatural"]));
    });

    it("gives each counterpart where the modifier may be either of two crafted rows", () => {
        // The fire is the bench's lower craft, or after the branch its higher:
        // the cold is the bench's row of either rank.
        const bench2: Mod = { ...BENCH_FIRE_RES_ROW, id: ModId("BenchFireResist2"), minLevel: 30 };
        const cold = (m: Mod, id: string): Mod => ({
            ...m,
            id: ModId(id),
            type: COLD_RESIST.type,
            families: COLD_RESIST.families,
            text: "+(13-18)% to Cold Resistance",
        });
        const crafts = [
            BENCH_FIRE_RES_ROW,
            bench2,
            cold(BENCH_FIRE_RES_ROW, "BenchCold1"),
            cold(bench2, "BenchCold2"),
        ];
        const reg = buildRegistry({
            bases: [RING_BASE],
            harvestChange: HARVEST_CHANGE,
            mods: [...CATALOG, ...crafts],
            baseAliases: { "Iron Ring": "IronRing" },
            benchCrafts: crafts.map((m) => ({
                mod: m.id,
                tier: m.minLevel === 30 ? 2 : 1,
                itemClasses: new Set([CLASS_RING]),
            })),
        });
        const r = check(
            craft(rareRing(["random"]), [
                bench("fire resistance", 2),
                iff(has("IncreasedMana1"), [bench("fire resistance", 1)]),
                harvestChange(FIRE_RESIST.id, COLD_RESIST.id),
            ]),
            { registry: reg },
        );
        expect(r.diagnostics).toEqual([]);
        expect(r.finalState!.tiers.get(COLD_RESIST.type)).toEqual(
            new Set(["BenchCold1", "BenchCold2"]),
        );
    });
});
