/**
 * The COUNT sub-domain: how many prefixes, suffixes, and affixes total an item
 * carries. It is one abstract domain in the checker's reduced product — a lattice
 * element (`Counts`) with its own join, equality, refinement, and the `normalize`
 * that keeps the pieces mutually consistent. Nothing here knows about mods,
 * presence, or tiers; it speaks only in integer ranges bounded by per-rarity caps.
 *
 * The coupling this domain exists to preserve: `prefix + suffix = total`. Two
 * independent side-ranges would lose it — refining "≤3 prefixes" has to also cap
 * the total, and vice versa. So the state is `total` and `prefix` (both ranges),
 * with the suffix DERIVED, and `normalize` propagates every bound both ways to a
 * fixpoint.
 */
import type { Base } from "../model/base.js";
import type { Cmp } from "../ast/ast.js";
import type { Gen, Rarity } from "../model/ids.js";
import { type Domain, type Range, RangeDomain, rIntersect, refineRange } from "./domain.js";

/** A count-domain element: the total affix range and the prefix range; the
 *  suffix range is derived (`total − prefix`, clamped to its cap). */
export interface Counts {
    readonly total: Range;
    readonly prefix: Range;
}

/** The three numeric bounds counts live under — a per-side cap each and a hard
 *  cap on the two sides together (see `caps`). */
export interface Caps {
    readonly prefix: number;
    readonly suffix: number;
    readonly total: number;
}

// --- affix caps (a function of rarity + base only) ------------------------
//
// The count an item can hold is bounded three ways: each side by its natural
// per-rarity limit shifted by the base's implicit `capDelta` (floored at 0), and
// the two sides together by a hard per-rarity total. The total is INDEPENDENT of
// the per-side sum — that is what makes a magic Ratcheting Ring "0 prefix / 2
// suffix" (raw suffix 1+3=4, but the magic total is 2), not 0/4.

/** Jewel classes cap at 2 affixes per side (4 total) instead of 3/6. */
const JEWEL_CLASSES: ReadonlySet<string> = new Set(["Jewel", "AbyssJewel"]);

/** The per-side affix limit inherent to a rarity + base class, before implicit
 *  deltas: normal 0, magic 1, rare 3 (2 for jewels). */
function naturalPerSide(rarity: Rarity, base: Base): number {
    switch (rarity) {
        case "normal":
            return 0;
        case "magic":
            return 1;
        case "rare":
            return JEWEL_CLASSES.has(base.itemClass) ? 2 : 3;
    }
}

/** The hard cap on TOTAL affixes for this rarity — `2 × naturalPerSide`, an
 *  independent bound the per-side deltas cannot exceed (magic = 2, rare = 6). */
export function hardTotalCap(rarity: Rarity, base: Base): number {
    return 2 * naturalPerSide(rarity, base);
}

/** The per-side affix cap: natural limit plus the base's implicit delta for that
 *  generation, floored at 0. */
export function sideCap(gen: Gen, rarity: Rarity, base: Base): number {
    const delta = base.capDelta ? base.capDelta[gen] : 0;
    return Math.max(0, naturalPerSide(rarity, base) + delta);
}

/** The most affixes this item can hold: the hard total, but never more than the
 *  two per-side caps allow together (Simplex: `min(6, 1+2) = 3`). */
export function maxTotal(rarity: Rarity, base: Base): number {
    return Math.min(
        hardTotalCap(rarity, base),
        sideCap("prefix", rarity, base) + sideCap("suffix", rarity, base),
    );
}

/** Bundle the three caps for a rarity + base — the environment every cap-aware
 *  count operation takes. */
export function caps(rarity: Rarity, base: Base): Caps {
    return {
        prefix: sideCap("prefix", rarity, base),
        suffix: sideCap("suffix", rarity, base),
        total: maxTotal(rarity, base),
    };
}

// --- the count domain -----------------------------------------------------

/** The count domain: the `Domain<Counts>` lattice contract (join + equal) plus
 *  the count-specific operations (cap-aware suffix/normalize/refine, and the
 *  `learnPresent` reduction shared by `has` and essence/bench). */
interface CountOps extends Domain<Counts> {
    point(prefixCount: number, suffixCount: number): Counts;
    empty(): Counts;
    suffix(c: Counts, caps: Caps): Range;
    normalize(c: Counts, caps: Caps): Counts | null;
    refine(
        c: Counts,
        caps: Caps,
        projection: "prefixCount" | "suffixCount",
        op: Cmp,
        value: number,
    ): Counts | null;
    learnPresent(c: Counts, gen: Gen): Counts;
}

export const CountDomain: CountOps = {
    /** A count-domain element from exact prefix and suffix counts. */
    point(prefixCount: number, suffixCount: number): Counts {
        return {
            total: [prefixCount + suffixCount, prefixCount + suffixCount],
            prefix: [prefixCount, prefixCount],
        };
    },

    /** The zero-affix element. */
    empty(): Counts {
        return { total: [0, 0], prefix: [0, 0] };
    },

    /** The derived suffix range: `total − prefix`, clamped to the suffix cap. */
    suffix(c: Counts, caps: Caps): Range {
        const lo = Math.max(0, c.total[0] - c.prefix[1]);
        const hi = Math.min(caps.suffix, c.total[1] - c.prefix[0]);
        return [lo, hi];
    },

    /** Least upper bound: widen each range to cover both branches. */
    join(a: Counts, b: Counts): Counts {
        return {
            total: RangeDomain.join(a.total, b.total),
            prefix: RangeDomain.join(a.prefix, b.prefix),
        };
    },

    /** Structural equality — the count part of a loop-fixpoint check. */
    equal(a: Counts, b: Counts): boolean {
        return RangeDomain.equal(a.total, b.total) && RangeDomain.equal(a.prefix, b.prefix);
    },

    /**
     * Re-establish the `prefix + suffix = total` coupling to a fixpoint, both
     * directions:
     *   prefix ∈ [total − sCap, min(pCap, total)]   total ∈ [prefix, min(tCap, prefix + sCap)]
     * Propagating BOTH ways matters: without the second, refining `prefixCount < 3`
     * leaves `total` at its old max, and an exalt guarded by that very check
     * spuriously looks "possibly full". The `tCap` bound is what holds a +delta side
     * to the hard rarity total (magic Ratcheting: ≤ 2, not 4). Returns `null` when
     * no consistent assignment remains (an uninhabited state).
     */
    normalize(c: Counts, caps: Caps): Counts | null {
        let prefix = c.prefix;
        let total = c.total;
        for (let i = 0; i < 4; i++) {
            const p = rIntersect(prefix, [
                Math.max(0, total[0] - caps.suffix),
                Math.min(caps.prefix, total[1]),
            ]);
            if (p === null) return null;
            const t = rIntersect(total, [
                Math.max(0, p[0]),
                Math.min(caps.total, p[1] + caps.suffix),
            ]);
            if (t === null) return null;
            const stable = RangeDomain.equal(p, prefix) && RangeDomain.equal(t, total);
            prefix = p;
            total = t;
            if (stable) break;
        }
        return { total, prefix };
    },

    /**
     * Narrow by a count comparison (`prefixCount`/`suffixCount <op> value`). A
     * prefix constraint tightens `prefix` directly; a suffix constraint refines the
     * derived suffix and maps it back onto `prefix` via `prefix = total − suffix`.
     * The result may not be self-consistent yet — the caller re-runs `normalize`.
     */
    refine(
        c: Counts,
        caps: Caps,
        projection: "prefixCount" | "suffixCount",
        op: Cmp,
        value: number,
    ): Counts | null {
        if (projection === "prefixCount") {
            const prefix = refineRange(c.prefix, op, value);
            return prefix === null ? null : { total: c.total, prefix };
        }
        const suffix = refineRange(this.suffix(c, caps), op, value);
        if (suffix === null) return null;
        const prefix = rIntersect(c.prefix, [c.total[0] - suffix[1], c.total[1] - suffix[0]]);
        return prefix === null ? null : { total: c.total, prefix };
    },

    /**
     * Learn that at least one affix is present, at least one of it in generation
     * `gen`: bumps the relevant lower bounds. Used when a mod becomes guaranteed
     * (`has`, essence/bench). The `total ≥ 1` part stops a "remove until X gone"
     * loop from concluding the item could be empty while X is still present.
     */
    learnPresent(c: Counts, gen: Gen): Counts {
        const total: Range = [Math.max(c.total[0], 1), c.total[1]];
        const prefix: Range =
            gen === "prefix"
                ? [Math.max(c.prefix[0], 1), c.prefix[1]]
                : // suffix ≥ 1 ⇒ prefix ≤ total − 1
                  [c.prefix[0], Math.min(c.prefix[1], total[1] - 1)];
        return { total, prefix };
    },
};
