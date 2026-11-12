import { describe, expect, it } from "vitest";
import type { Base } from "./base.js";
import { holdsFour, isCraftedOn, maxTotal, sideCap } from "./capacity.js";
import { BaseId, ClassId, Domain, type Rarity } from "./ids.js";

const baseOfClass = (itemClass: string): Base => ({
    id: BaseId(itemClass),
    itemClass: ClassId(itemClass),
    domain: Domain("item"),
    tags: new Set(),
});

const caps = (rarity: Rarity, base: Base) => ({
    prefix: sideCap("prefix", rarity, base),
    suffix: sideCap("suffix", rarity, base),
    total: maxTotal(rarity, base),
});

describe("the affixes a Rare holds", () => {
    it("are four on jewels, abyss jewels, Rogue's equipment and a trinket", () => {
        // Rarity § Rare; Thief's Trinket: "a maximum of 4 affixes".
        for (const cls of [
            "Jewel",
            "AbyssJewel",
            "Trinket",
            "HeistEquipmentWeapon",
            "HeistEquipmentTool",
            "HeistEquipmentUtility",
            "HeistEquipmentReward",
        ]) {
            const base = baseOfClass(cls);
            expect(isCraftedOn(base), cls).toBe(true);
            expect(holdsFour(base), cls).toBe(true);
            expect(caps("rare", base), cls).toEqual({ prefix: 2, suffix: 2, total: 4 });
            expect(caps("magic", base), cls).toEqual({ prefix: 1, suffix: 1, total: 2 });
        }
    });

    it("are six on equipment", () => {
        const ring = baseOfClass("Ring");
        expect(holdsFour(ring)).toBe(false);
        expect(caps("rare", ring)).toEqual({ prefix: 3, suffix: 3, total: 6 });
    });
});
