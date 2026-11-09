import { describe, expect, it } from "vitest";
import { capitalise, plural, pluralRange, rangeText, rarityText } from "./words.js";

describe("the shared words", () => {
    it("capitalises the first letter only", () => {
        expect(capitalise("grand")).toBe("Grand");
        expect(capitalise("")).toBe("");
    });

    it("makes a word plural for any count but one, with -es where English wants it", () => {
        expect(plural(1, "tier")).toBe("tier");
        expect(plural(0, "tier")).toBe("tiers");
        expect(plural(2, "prefix")).toBe("prefixes");
        expect(pluralRange([1, 1], "modifier")).toBe("modifier");
        expect(pluralRange([0, 1], "modifier")).toBe("modifiers");
        expect(pluralRange([2, 3], "suffix")).toBe("suffixes");
    });

    it("writes a range as one number when its ends meet", () => {
        expect(rangeText([82, 82])).toBe("82");
        expect(rangeText([40, 82])).toBe("40-82");
        expect(rangeText([1, 3], "–")).toBe("1–3");
    });

    it("spells the rarities in the game's order", () => {
        expect(rarityText(["rare", "magic"])).toBe("Magic or Rare");
        expect(rarityText(new Set(["normal" as const]))).toBe("Normal");
    });
});
