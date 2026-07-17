import { describe, expect, it } from "vitest";
import { approx, isNonzero, known, unknown } from "./weight.js";

describe("isNonzero — pool eligibility", () => {
    it("Known n>0 is nonzero, Known 0 is not", () => {
        expect(isNonzero(known(1000))).toBe(true);
        expect(isNonzero(known(1))).toBe(true);
        expect(isNonzero(known(0))).toBe(false);
    });

    it("Approx n>0 is nonzero, Approx 0 is not", () => {
        expect(isNonzero(approx(50))).toBe(true);
        expect(isNonzero(approx(0))).toBe(false);
    });

    it("Unknown is always nonzero (PoE2 'can roll' sentinel)", () => {
        expect(isNonzero(unknown)).toBe(true);
    });
});
