import { describe, expect, it } from "vitest";
import {
    affixes,
    prefixCount,
    presentFamilies,
    presentTypes,
    suffixCount,
    toIndex,
} from "./item.js";
import { FIRE_RESIST, INCREASED_MANA, LIFE_T1, mkItem } from "../__fixtures__/mods.js";

describe("item projections", () => {
    const item = mkItem({
        game: "poe2",
        rarity: "rare",
        ilvl: 82,
        prefixes: [LIFE_T1, INCREASED_MANA],
        suffixes: [FIRE_RESIST],
    });

    it("counts prefixes and suffixes", () => {
        expect(prefixCount(item)).toBe(2);
        expect(suffixCount(item)).toBe(1);
        expect(affixes(item)).toHaveLength(3);
    });

    it("collects present ModTypes", () => {
        expect(presentTypes(item)).toEqual(
            new Set([LIFE_T1.type, INCREASED_MANA.type, FIRE_RESIST.type]),
        );
    });

    it("unions present families", () => {
        const fams = presentFamilies(item);
        // LIFE_T1 -> Life, INCREASED_MANA -> Mana, FIRE_RESIST -> ResistFire.
        expect(fams.size).toBe(3);
    });

    it("projects the type index", () => {
        const idx = toIndex(item);
        expect(idx).toEqual({
            game: "poe2",
            rarity: "rare",
            prefixCount: 2,
            suffixCount: 1,
            ilvl: 82,
            present: new Set([LIFE_T1.type, INCREASED_MANA.type, FIRE_RESIST.type]),
        });
    });
});
