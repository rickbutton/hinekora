/** A seeded generator of random numbers, so every property test is the seed's. */

export interface Rng {
    /** A number in [0, 1). */
    next(): number;
    /** A whole number in [lo, hi], both included. */
    int(lo: number, hi: number): number;
    chance(p: number): boolean;
    pick<T>(xs: readonly T[]): T;
    /** `k` distinct elements of `xs`, in the order of `xs`. */
    sample<T>(xs: readonly T[], k: number): T[];
}

/** Mulberry32: small, fast and the same on every platform. */
export function rng(seed: number): Rng {
    let s = seed >>> 0;
    const next = (): number => {
        s = (s + 0x6d2b79f5) >>> 0;
        let t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const int = (lo: number, hi: number): number => lo + Math.floor(next() * (hi - lo + 1));
    return {
        next,
        int,
        chance: (p) => next() < p,
        pick<T>(xs: readonly T[]): T {
            if (xs.length === 0) throw new Error("pick from an empty list");
            return xs[int(0, xs.length - 1)]!;
        },
        sample<T>(xs: readonly T[], k: number): T[] {
            const keys = xs.map((x, i) => ({ x, i, r: next() }));
            const chosen = [...keys].sort((a, b) => a.r - b.r).slice(0, k);
            return chosen.sort((a, b) => a.i - b.i).map((c) => c.x);
        },
    };
}
