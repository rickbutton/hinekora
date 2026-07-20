import { describe, expect, it } from "vitest";
import { CountDomain, type Caps } from "./counts.js";
import { RangeDomain, SetDomain } from "./domain.js";

// The count domain is testable in isolation — no AItem, no registry, just the
// caps it operates under. Rare (3/3/6) and a reduced-cap base (Simplex: 1/2/3).
const RARE: Caps = { prefix: 3, suffix: 3, total: 6 };
const SIMPLEX: Caps = { prefix: 1, suffix: 2, total: 3 };

describe("CountDomain", () => {
    it("derives the suffix range as total − prefix (capped)", () => {
        expect(CountDomain.suffix(CountDomain.point(1, 2), RARE)).toEqual([2, 2]);
        expect(CountDomain.suffix({ total: [0, 6], prefix: [0, 3] }, RARE)).toEqual([0, 3]);
    });

    it("normalize couples total and prefix BOTH ways to a fixpoint", () => {
        // Refining prefix ≤ 1 must also pull the total down: with ≤1 prefix and a
        // 3-suffix cap, at most 4 affixes fit — not the old max of 6.
        const refined = CountDomain.refine(
            { total: [0, 6], prefix: [0, 3] },
            RARE,
            "prefixCount",
            "<=",
            1,
        );
        expect(refined).not.toBeNull();
        expect(CountDomain.normalize(refined!, RARE)).toEqual({ total: [0, 4], prefix: [0, 1] });
    });

    it("normalize clamps to a reduced-cap base's hard total and side cap", () => {
        // Simplex holds 3 mods total (cap) and ≤1 prefix (side), so an open state
        // collapses to those bounds.
        expect(CountDomain.normalize({ total: [0, 6], prefix: [0, 3] }, SIMPLEX)).toEqual({
            total: [0, 3],
            prefix: [0, 1],
        });
    });

    it("normalize returns null on an uninhabited count state", () => {
        expect(CountDomain.normalize({ total: [5, 5], prefix: [0, 0] }, SIMPLEX)).toBeNull();
    });

    it("learnPresent bumps the lower bounds for the mod's generation", () => {
        expect(CountDomain.learnPresent(CountDomain.empty(), "prefix")).toEqual({
            total: [1, 0],
            prefix: [1, 0],
        }); // pre-normalize; the caller re-runs normalize
        expect(CountDomain.learnPresent({ total: [0, 2], prefix: [0, 2] }, "suffix")).toEqual({
            total: [1, 2],
            prefix: [0, 1],
        });
    });

    it("join widens and equal is exact — the lattice contract", () => {
        const a = CountDomain.point(1, 0);
        const b = CountDomain.point(0, 2);
        expect(CountDomain.join(a, b)).toEqual({ total: [1, 2], prefix: [0, 1] });
        expect(CountDomain.equal(a, a)).toBe(true);
        expect(CountDomain.equal(a, b)).toBe(false);
    });
});

describe("RangeDomain / SetDomain", () => {
    it("RangeDomain join widens, equal is exact", () => {
        expect(RangeDomain.join([1, 2], [0, 5])).toEqual([0, 5]);
        expect(RangeDomain.equal([1, 2], [1, 2])).toBe(true);
        expect(RangeDomain.equal([1, 2], [1, 3])).toBe(false);
    });

    it("SetDomain join unions, equal is membership-wise", () => {
        expect([...SetDomain.join(new Set([1, 2]), new Set([2, 3]))].sort()).toEqual([1, 2, 3]);
        expect(SetDomain.equal(new Set([1, 2]), new Set([2, 1]))).toBe(true);
        expect(SetDomain.equal(new Set([1]), new Set([1, 2]))).toBe(false);
    });
});
