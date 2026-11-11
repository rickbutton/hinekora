import { describe, expect, it } from "vitest";
import {
    rollableGen,
    rollableTiers,
    tierCount,
    tierLadder,
    tierLadders,
    tierNumber,
    tierRows,
} from "./tiers.js";
import { ModId, TagId, TypeId } from "../model/ids.js";
import type { Mod } from "../model/mod.js";
import {
    BENCH_LIFE_ROW,
    BOOTS_BASE,
    CATALOG,
    CLUSTER_BASE,
    LIFE_T1,
    LIFE_T2,
    NOTABLE_SADIST,
    RING_BASE,
    TAG_ENCHANT_LIGHTNING,
} from "../__fixtures__/mods.js";

describe("the rows of a type that roll on a base", () => {
    const catalog = [...CATALOG, NOTABLE_SADIST, BENCH_LIFE_ROW];

    it("are its tiers, best first, and none for a type that does not roll there", () => {
        expect(rollableTiers(catalog, RING_BASE, 100, LIFE_T1.type)).toEqual([LIFE_T1, LIFE_T2]);
        expect(rollableTiers(catalog, RING_BASE, 40, LIFE_T1.type)).toEqual([LIFE_T2]);
        expect(rollableTiers(catalog, RING_BASE, 100, TypeId("NoSuchType"))).toEqual([]);
    });

    it("are numbered over the whole ladder, whatever the item's level", () => {
        expect(tierLadder(catalog, RING_BASE, LIFE_T1.type)).toEqual([LIFE_T1, LIFE_T2]);
        const ladders = tierLadders(catalog, RING_BASE, LIFE_T1.type);
        expect([...ladders]).toEqual([["base", [LIFE_T1, LIFE_T2]]]);
        // The row an item of level 40 can roll is still the second tier.
        expect(tierNumber(ladders, LIFE_T2.id)).toBe(2);
        expect(tierRows(ladders, 2)).toEqual([LIFE_T2]);
        expect(tierRows(ladders, 3)).toEqual([]);
        expect(tierRows(ladders, 0)).toEqual([]);
        expect(tierCount(ladders)).toBe(2);
        expect(tierNumber(ladders, BENCH_LIFE_ROW.id)).toBeUndefined();
        expect(tierCount(tierLadders(catalog, RING_BASE, TypeId("NoSuchType")))).toBe(0);
    });

    it("are kept apart for two cluster jewels of one base with different enchantments", () => {
        // The enchantment is a tag of the base, which keeps its id.
        const enchanted = (tag: TagId) => ({
            ...CLUSTER_BASE,
            tags: new Set([...CLUSTER_BASE.tags, tag]),
        });
        const lightning = enchanted(TAG_ENCHANT_LIGHTNING);
        const other = enchanted(TagId("affliction_fire_damage"));
        expect(rollableTiers(catalog, lightning, 84, NOTABLE_SADIST.type)).toEqual([
            NOTABLE_SADIST,
        ]);
        expect(rollableTiers(catalog, other, 84, NOTABLE_SADIST.type)).toEqual([]);
    });

    describe("on an item with two influences", () => {
        const SHAPER = TagId("boots_shaper");
        const REDEEMER = TagId("boots_eyrie");
        const both = new Set([SHAPER, REDEEMER]);
        const LIFE = LIFE_T1.type;
        /** A life row boots roll under one influence's tag, or their own. */
        const row = (id: string, minLevel: number, tag?: TagId): Mod => ({
            ...LIFE_T1,
            id: ModId(id),
            minLevel,
            spawn:
                tag === undefined
                    ? [{ tag: TagId("default"), weight: 1000 }]
                    : [
                          { tag, weight: 500 },
                          { tag: TagId("default"), weight: 0 },
                      ],
        });
        const shaper = [row("Shaper85", 85, SHAPER), row("Shaper68", 68, SHAPER)];
        const redeemer = [
            row("Redeemer85", 85, REDEEMER),
            row("Redeemer75", 75, REDEEMER),
            row("Redeemer68", 68, REDEEMER),
        ];
        const own = [row("Own60", 60), row("Own30", 30)];
        const rows = [...own, ...redeemer, ...shaper];
        const ids = (mods: readonly Mod[]) => mods.map((m) => m.id);

        it("number each influence's rows apart, and the base's own apart from both", () => {
            const ladders = tierLadders(rows, BOOTS_BASE, LIFE, both);
            expect([...ladders].map(([owner, ladder]) => [owner, ids(ladder)])).toEqual([
                ["base", ["Own60", "Own30"]],
                ["shaper", ["Shaper85", "Shaper68"]],
                ["redeemer", ["Redeemer85", "Redeemer75", "Redeemer68"]],
            ]);
            // The Shaper's level-68 row is its second tier, the Redeemer's its third.
            expect(tierNumber(ladders, ModId("Shaper68"))).toBe(2);
            expect(tierNumber(ladders, ModId("Redeemer68"))).toBe(3);
            expect(tierNumber(ladders, ModId("Own60"))).toBe(1);
            expect(ids(tierRows(ladders, 1))).toEqual(["Own60", "Shaper85", "Redeemer85"]);
            expect(ids(tierRows(ladders, 3))).toEqual(["Redeemer68"]);
            expect(tierCount(ladders)).toBe(3);
        });

        it("leave out the ladder of an influence the item does not have", () => {
            const ladders = tierLadders(rows, BOOTS_BASE, LIFE, new Set([SHAPER]));
            expect([...ladders.keys()]).toEqual(["base", "shaper"]);
            expect([...tierLadders(rows, BOOTS_BASE, LIFE).keys()]).toEqual(["base"]);
        });

        it("order rows of one level by id, whatever order the catalog lists them in", () => {
            for (const catalog of [rows, [...rows].reverse()]) {
                expect(ids(tierLadder(catalog, BOOTS_BASE, LIFE, both))).toEqual([
                    "Redeemer85",
                    "Shaper85",
                    "Redeemer75",
                    "Redeemer68",
                    "Shaper68",
                    "Own60",
                    "Own30",
                ]);
            }
            const tied = [row("B", 50), row("A", 50), row("C", 60)];
            for (const catalog of [tied, [...tied].reverse()]) {
                const ladders = tierLadders(catalog, BOOTS_BASE, LIFE);
                expect(ids(ladders.get("base")!)).toEqual(["C", "A", "B"]);
            }
        });
    });

    it("give rows of one level in a ladder the same tier number", () => {
        // Two modifiers that share the type, each of one tier, below a third row.
        const row = (id: string, minLevel: number): Mod => ({
            ...LIFE_T1,
            id: ModId(id),
            minLevel,
        });
        const [a, b, c, d] = [row("A", 50), row("B", 50), row("C", 60), row("D", 40)];
        const ladders = tierLadders([b, d, a, c], BOOTS_BASE, LIFE_T1.type);
        expect(tierCount(ladders)).toBe(3);
        expect(tierNumber(ladders, c.id)).toBe(1);
        expect(tierNumber(ladders, a.id)).toBe(2);
        expect(tierNumber(ladders, b.id)).toBe(2);
        expect(tierNumber(ladders, d.id)).toBe(3);
        expect(tierRows(ladders, 2)).toEqual([a, b]);
        expect(tierRows(ladders, 3)).toEqual([d]);
        expect(tierRows(ladders, 4)).toEqual([]);
        // A caller that knows which of them is meant picks among the tier's rows.
        expect(tierRows(ladders, 2, (rows) => rows.filter((m) => m.id === b.id))).toEqual([b]);
    });

    it("give the type its side, or the catalog's first row's where none rolls", () => {
        expect(rollableGen(catalog, RING_BASE, 100, LIFE_T1.type)).toBe("prefix");
        expect(rollableGen(catalog, RING_BASE, 100, NOTABLE_SADIST.type)).toBe(NOTABLE_SADIST.gen);
        expect(rollableGen(catalog, RING_BASE, 100, TypeId("NoSuchType"))).toBeUndefined();
    });
});
