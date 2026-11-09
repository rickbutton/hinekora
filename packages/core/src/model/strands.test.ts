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
});
