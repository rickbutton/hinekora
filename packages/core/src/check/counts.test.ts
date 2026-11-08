import { describe, expect, it } from "vitest";
import { caps, CountDomain, type Caps, type Counts } from "./counts.js";
import { RangeDomain, SetDomain } from "./domain.js";
import { BaseId, ClassId, Domain } from "../model/ids.js";
import type { Base } from "../model/base.js";

const baseOfClass = (itemClass: string): Base => ({
    id: BaseId(itemClass),
    itemClass: ClassId(itemClass),
    domain: Domain("item"),
    tags: new Set(),
});

// The count domain is testable in isolation — no AItem, no registry, just the
// caps it operates under. Rare (3/3/6) and a reduced-cap base (Simplex: 1/2/3).
const RARE: Caps = { prefix: 3, suffix: 3, total: 6 };
const SIMPLEX: Caps = { prefix: 1, suffix: 2, total: 3 };
const open: Counts = { total: [0, 6], prefix: [0, 3], suffix: [0, 3] };

describe("caps", () => {
    it("a Rare holds four affixes on jewels, abyss jewels and Rogue's equipment", () => {
        for (const cls of ["Jewel", "AbyssJewel", "HeistEquipmentWeapon", "HeistEquipmentReward"]) {
            expect(caps("rare", baseOfClass(cls))).toEqual({ prefix: 2, suffix: 2, total: 4 });
        }
        expect(caps("rare", baseOfClass("Ring"))).toEqual({ prefix: 3, suffix: 3, total: 6 });
    });
});

describe("CountDomain", () => {
    it("reads the suffix range no looser than total − prefix (capped)", () => {
        expect(CountDomain.suffix(CountDomain.point(1, 2), RARE)).toEqual([2, 2]);
        expect(CountDomain.suffix(open, RARE)).toEqual([0, 3]);
        // A stale wide suffix range is tightened by the other two on the way out.
        expect(CountDomain.suffix({ total: [2, 3], prefix: [2, 2], suffix: [0, 3] }, RARE)).toEqual(
            [0, 1],
        );
    });

    it("normalize couples the three ranges every way to a fixpoint", () => {
        // Refining prefix ≤ 1 must also pull the total down: with ≤1 prefix and a
        // 3-suffix cap, at most 4 affixes fit — not the old max of 6.
        const refined = CountDomain.refine(open, RARE, "prefixCount", "<=", 1);
        expect(refined).not.toBeNull();
        expect(CountDomain.normalize(refined!, RARE)).toEqual({
            total: [0, 4],
            prefix: [0, 1],
            suffix: [0, 3],
        });
    });

    it("keeps a suffix bound while the prefix count is a range", () => {
        // The exit of "annul until two open prefixes and one open suffix": neither
        // side is pinned, and the suffix bound must still be there for the bench
        // craft that follows.
        const refined = CountDomain.refine(
            { total: [1, 6], prefix: [0, 3], suffix: [0, 3] },
            RARE,
            "suffixCount",
            "<=",
            2,
        );
        const n = CountDomain.normalize(refined!, RARE);
        expect(n).toEqual({ total: [1, 5], prefix: [0, 3], suffix: [0, 2] });
        expect(CountDomain.suffix(n!, RARE)).toEqual([0, 2]);
        // And it survives a change on the prefix side.
        const later = CountDomain.normalize({ ...n!, prefix: [1, 2], total: [1, 4] }, RARE);
        expect(later).toEqual({ total: [1, 4], prefix: [1, 2], suffix: [0, 2] });
    });

    it("refining the suffix count tightens the total, not only the prefix", () => {
        // 0 prefixes and 1–2 affixes: learning "suffixCount < 2" must land in the
        // total too, or a following add looks unsafe.
        const refined = CountDomain.refine(
            { total: [1, 2], prefix: [0, 0], suffix: [1, 2] },
            RARE,
            "suffixCount",
            "<",
            2,
        );
        expect(CountDomain.normalize(refined!, RARE)).toEqual({
            total: [1, 1],
            prefix: [0, 0],
            suffix: [1, 1],
        });
    });

    it("a not-equal at an end of the range cuts that end off", () => {
        // "prefixCount != 0" on 0–1 prefixes is 1 prefix: the else arm of
        // `if prefixCount == 0` knows a prefix is there.
        const c: Counts = { total: [2, 3], prefix: [0, 1], suffix: [1, 3] };
        expect(CountDomain.refine(c, RARE, "prefixCount", "!=", 0)).toEqual({
            ...c,
            prefix: [1, 1],
        });
        // A value inside the range leaves a hole a range cannot express.
        const wide: Counts = { total: [2, 3], prefix: [0, 2], suffix: [0, 3] };
        expect(CountDomain.refine(wide, RARE, "prefixCount", "!=", 1)).toEqual(wide);
    });

    it("normalize clamps to a reduced-cap base's hard total and side cap", () => {
        // Simplex holds 3 mods total (cap) and ≤1 prefix (side), so an open state
        // collapses to those bounds.
        expect(CountDomain.normalize(open, SIMPLEX)).toEqual({
            total: [0, 3],
            prefix: [0, 1],
            suffix: [0, 2],
        });
    });

    it("normalize returns null on an uninhabited count state", () => {
        expect(
            CountDomain.normalize({ total: [5, 5], prefix: [0, 0], suffix: [0, 3] }, SIMPLEX),
        ).toBeNull();
        expect(
            CountDomain.normalize({ total: [4, 6], prefix: [0, 1], suffix: [0, 2] }, RARE),
        ).toBeNull();
    });

    it("learnPresent bumps the lower bounds for the mod's generation", () => {
        expect(CountDomain.learnPresent(CountDomain.empty(), "prefix")).toEqual({
            total: [1, 0],
            prefix: [1, 0],
            suffix: [0, 0],
        }); // pre-normalize; the caller re-runs normalize
        expect(
            CountDomain.learnPresent({ total: [0, 2], prefix: [0, 2], suffix: [0, 2] }, "suffix"),
        ).toEqual({ total: [1, 2], prefix: [0, 2], suffix: [1, 2] });
    });

    it("join widens and equal is exact — the lattice contract", () => {
        const a = CountDomain.point(1, 0);
        const b = CountDomain.point(0, 2);
        expect(CountDomain.join(a, b)).toEqual({ total: [1, 2], prefix: [0, 1], suffix: [0, 2] });
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
