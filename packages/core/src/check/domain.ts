/**
 * The abstract-domain contract every piece of `AItem` lines up behind.
 *
 * The checker's state is a REDUCED PRODUCT of several small domains — counts,
 * mod presence, the tier overlay, the crafted count. Each is a lattice element,
 * and the two operations the checker's machinery needs from every one of them
 * are the same: `join` (the least upper bound, used to merge two control-flow
 * branches) and `equal` (used to detect a loop-invariant fixpoint). That pair is
 * the `Domain<T>` contract. Anything domain-specific — a `normalize`, a
 * refinement, cap arithmetic — lives on the individual domain, not here.
 *
 * A cross-domain fact (e.g. "crafted mods ⊆ all affixes") is a REDUCTION: it is
 * applied explicitly at the product level (see `normalize` in astate), never
 * smuggled inside one domain.
 */
import type { Cmp } from "../ast/ast.js";

export interface Domain<T> {
    /** Least upper bound — merge two branch values into one that covers both. */
    join(a: T, b: T): T;
    /** Structural equality — used to detect a fixpoint. */
    equal(a: T, b: T): boolean;
}

// --- integer ranges (the shared numeric primitive) ------------------------

/** An inclusive integer range `[min, max]`. */
export type Range = readonly [min: number, max: number];

export const rIntersect = (a: Range, b: Range): Range | null => {
    const lo = Math.max(a[0], b[0]);
    const hi = Math.min(a[1], b[1]);
    return lo <= hi ? [lo, hi] : null;
};
const rJoin = (a: Range, b: Range): Range => [Math.min(a[0], b[0]), Math.max(a[1], b[1])];
const rEqual = (a: Range, b: Range): boolean => a[0] === b[0] && a[1] === b[1];

/** Intersect a range with the constraint `x <cmp> value`. */
export function refineRange(range: Range, op: Cmp, value: number): Range | null {
    switch (op) {
        case "==":
            return rIntersect(range, [value, value]);
        case "!=":
            // A range can only be tightened by `!=` when it is exactly {value}.
            return range[0] === value && range[1] === value ? null : range;
        case "<":
            return rIntersect(range, [-Infinity, value - 1]);
        case "<=":
            return rIntersect(range, [-Infinity, value]);
        case ">":
            return rIntersect(range, [value + 1, Infinity]);
        case ">=":
            return rIntersect(range, [value, Infinity]);
    }
}

/** A range as a bare lattice element — join widens, equal is exact. The crafted
 *  count is one (its transfer arithmetic and the `≤ total` reduction live where
 *  they belong: transfer functions and `normalize`). */
export const RangeDomain = {
    join: rJoin,
    equal: rEqual,
} satisfies Domain<Range>;

// --- sets (the pool whitelist `possible`) ---------------------------------

/** Sets as a lattice element — join unions, equal is membership-wise. A
 *  `Domain<ReadonlySet<T>>` for any element type `T`. */
export const SetDomain = {
    join<T>(a: ReadonlySet<T>, b: ReadonlySet<T>): ReadonlySet<T> {
        return new Set([...a, ...b]);
    },
    equal<T>(a: ReadonlySet<T>, b: ReadonlySet<T>): boolean {
        if (a.size !== b.size) return false;
        for (const v of a) if (!b.has(v)) return false;
        return true;
    },
};
