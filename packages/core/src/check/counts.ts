/**
 * The COUNT sub-domain: how many prefixes, suffixes, and affixes total an item
 * carries. It is one abstract domain in the checker's reduced product — a lattice
 * element (`Counts`) with its own join, equality, refinement, and the `normalize`
 * that keeps the pieces mutually consistent. Nothing here knows about mods,
 * presence, or tiers; it speaks only in integer ranges bounded by per-rarity caps.
 *
 * The coupling this domain exists to preserve: `prefix + suffix = total`. All
 * three are kept as ranges, because a fact about one side alone ("at most two
 * suffixes", the exit of every make-room loop) has no home in the other two
 * ranges unless that other side is pinned; `normalize` closes the three under
 * the coupling, both directions, to a fixpoint.
 */
import type { Cmp } from "../ast/ast.js";
import type { Caps } from "../model/capacity.js";
import type { Gen } from "../model/ids.js";
import { type Domain, type Range, RangeDomain, rIntersect, refineRange } from "./domain.js";

export { type Caps, caps, hardTotalCap, maxTotal, sideCap } from "../model/capacity.js";

/** A count-domain element: the total, prefix and suffix affix ranges. */
export interface Counts {
    readonly total: Range;
    readonly prefix: Range;
    readonly suffix: Range;
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
            suffix: [suffixCount, suffixCount],
        };
    },

    /** The zero-affix element. */
    empty(): Counts {
        return { total: [0, 0], prefix: [0, 0], suffix: [0, 0] };
    },

    /** The suffix range, no looser than `total − prefix` and clamped to its cap. */
    suffix(c: Counts, caps: Caps): Range {
        const lo = Math.max(0, c.suffix[0], c.total[0] - c.prefix[1]);
        const hi = Math.min(caps.suffix, c.suffix[1], c.total[1] - c.prefix[0]);
        return [lo, hi];
    },

    /** Least upper bound: widen each range to cover both branches. */
    join(a: Counts, b: Counts): Counts {
        return {
            total: RangeDomain.join(a.total, b.total),
            prefix: RangeDomain.join(a.prefix, b.prefix),
            suffix: RangeDomain.join(a.suffix, b.suffix),
        };
    },

    /** Structural equality — the count part of a loop-fixpoint check. */
    equal(a: Counts, b: Counts): boolean {
        return (
            RangeDomain.equal(a.total, b.total) &&
            RangeDomain.equal(a.prefix, b.prefix) &&
            RangeDomain.equal(a.suffix, b.suffix)
        );
    },

    /**
     * Re-establish `prefix + suffix = total` to a fixpoint, every range against
     * the other two and its cap:
     *   prefix ∈ [total − suffix]   suffix ∈ [total − prefix]   total ∈ [prefix + suffix]
     * Propagating every way matters: refining `prefixCount < 3` must pull the
     * total down or an exalt guarded by that very check looks "possibly full",
     * and refining `suffixCount <= 2` must survive a later change to the prefix
     * side. The `tCap` bound is what holds a +delta side to the hard rarity total
     * (magic Ratcheting: ≤ 2, not 4). Returns `null` when no consistent
     * assignment remains (an uninhabited state).
     */
    normalize(c: Counts, caps: Caps): Counts | null {
        let prefix = c.prefix;
        let suffix = c.suffix;
        let total = c.total;
        for (let i = 0; i < 6; i++) {
            const p = rIntersect(prefix, [
                Math.max(0, total[0] - suffix[1]),
                Math.min(caps.prefix, total[1] - suffix[0]),
            ]);
            if (p === null) return null;
            const s = rIntersect(suffix, [
                Math.max(0, total[0] - p[1]),
                Math.min(caps.suffix, total[1] - p[0]),
            ]);
            if (s === null) return null;
            const t = rIntersect(total, [
                Math.max(0, p[0] + s[0]),
                Math.min(caps.total, p[1] + s[1]),
            ]);
            if (t === null) return null;
            const stable =
                RangeDomain.equal(p, prefix) &&
                RangeDomain.equal(s, suffix) &&
                RangeDomain.equal(t, total);
            prefix = p;
            suffix = s;
            total = t;
            if (stable) break;
        }
        return { total, prefix, suffix };
    },

    /**
     * Narrow by a count comparison (`prefixCount`/`suffixCount <op> value`): the
     * named side's range is refined and the others left as they are. The result
     * may not be self-consistent yet — the caller re-runs `normalize`.
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
            return prefix === null ? null : { ...c, prefix };
        }
        const suffix = refineRange(this.suffix(c, caps), op, value);
        return suffix === null ? null : { ...c, suffix };
    },

    /**
     * Learn that at least one affix is present, at least one of it in generation
     * `gen`: bumps the relevant lower bounds. Used when a mod becomes guaranteed
     * (`has`, essence/bench). The `total ≥ 1` part stops a "remove until X gone"
     * loop from concluding the item could be empty while X is still present.
     */
    learnPresent(c: Counts, gen: Gen): Counts {
        const atLeastOne = (r: Range): Range => [Math.max(r[0], 1), r[1]];
        return {
            total: atLeastOne(c.total),
            prefix: gen === "prefix" ? atLeastOne(c.prefix) : c.prefix,
            suffix: gen === "suffix" ? atLeastOne(c.suffix) : c.suffix,
        };
    },
};
