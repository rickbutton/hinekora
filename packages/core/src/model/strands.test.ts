import { describe, expect, it } from "vitest";
import { tiersWithStrands } from "./strands.js";

describe("the tiers that roll under memory strands", () => {
    it("follows the wiki's breakpoints", () => {
        // Memory strand § Memory strand/rollable tier breakpoints.
        expect(tiersWithStrands(0, 8)).toBe(8);
        expect(tiersWithStrands(1, 8)).toBe(5);
        expect(tiersWithStrands(12, 8)).toBe(4);
        expect(tiersWithStrands(22, 13)).toBe(6);
        expect(tiersWithStrands(30, 12)).toBe(5);
        expect(tiersWithStrands(82, 8)).toBe(2);
        expect(tiersWithStrands(100, 2)).toBe(1);
    });

    it("gives the Foulborn orbs' own table at their rating, eleven strands' worth", () => {
        // Foulborn currency § Mechanics, "Amount of tiers kept" for 1 to 13
        // eligible tiers: the orb's +75 rating alone is 2.5 × 11 + 47.5.
        const kept = [1, 1, 2, 2, 3, 3, 4, 5, 5, 6, 6, 7, 7];
        expect(kept.map((_k, i) => tiersWithStrands(11, i + 1))).toEqual(kept);
    });
});
