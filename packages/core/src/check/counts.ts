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
import type { Cmp } from "../ast/ast.js";
import type { Caps } from "../model/capacity.js";
import type { Gen } from "../model/ids.js";
import { type Domain, type Range, RangeDomain, rIntersect, refineRange } from "./domain.js";

export { type Caps, canBeRare, caps, hardTotalCap, maxTotal, sideCap } from "../model/capacity.js";

/** A count-domain element: the total affix range and the prefix range; the
 *  suffix range is derived (`total − prefix`, clamped to its cap). */
export interface Counts {
    readonly total: Range;
    readonly prefix: Range;
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
