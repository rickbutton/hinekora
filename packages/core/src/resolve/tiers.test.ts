import { describe, expect, it } from "vitest";
import { rollableGen, rollableTiers } from "./tiers.js";
import { TagId, TypeId } from "../model/ids.js";
import {
    BENCH_LIFE_ROW,
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

    it("give the type its side, or the catalog's first row's where none rolls", () => {
        expect(rollableGen(catalog, RING_BASE, 100, LIFE_T1.type)).toBe("prefix");
        expect(rollableGen(catalog, RING_BASE, 100, NOTABLE_SADIST.type)).toBe(NOTABLE_SADIST.gen);
        expect(rollableGen(catalog, RING_BASE, 100, TypeId("NoSuchType"))).toBeUndefined();
    });
});
