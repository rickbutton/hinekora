import { describe, expect, it } from "vitest";
import { allAmongFirst, amongFirstDistribution, splitDistribution } from "./race.js";

interface Group {
    readonly weight: number;
    readonly side: "prefix" | "suffix";
}

/**
 * The draw by brute force: every order the groups can be drawn in, weighted as
 * sequential sampling without replacement (Plackett–Luce), each order read
 * through the side caps to the set of groups taken.
 */
function enumerate(
    groups: readonly Group[],
    m: number,
    caps: { prefix: number; suffix: number },
    visit: (taken: ReadonlySet<number>, prob: number) => void,
): void {
    const total = groups.reduce((s, g) => s + g.weight, 0);
    const walk = (remaining: number[], weightLeft: number, prob: number, order: number[]) => {
        if (remaining.length === 0) {
            visit(takenOf(order), prob);
            return;
        }
        for (const i of remaining) {
            const g = groups[i]!;
            walk(
                remaining.filter((j) => j !== i),
                weightLeft - g.weight,
                (prob * g.weight) / weightLeft,
                [...order, i],
            );
        }
    };
    const takenOf = (order: readonly number[]): Set<number> => {
        const taken = new Set<number>();
        const count = { prefix: 0, suffix: 0 };
        for (const i of order) {
            if (taken.size >= m) break;
            const side = groups[i]!.side;
            if (count[side] >= caps[side]) continue;
            count[side]++;
            taken.add(i);
        }
        return taken;
    };
    walk(
        groups.map((_, i) => i),
        total,
        1,
        [],
    );
}

const POOL: readonly Group[] = [
    { weight: 1000, side: "prefix" },
    { weight: 400, side: "prefix" },
    { weight: 50, side: "prefix" },
    { weight: 800, side: "suffix" },
    { weight: 300, side: "suffix" },
    { weight: 120, side: "suffix" },
    { weight: 25, side: "suffix" },
];

describe("the race against brute force", () => {
    it("one side: a group among the first k to fire", () => {
        const side = POOL.filter((g) => g.side === "suffix");
        const rates = side.map((g) => g.weight);
        for (const k of [1, 2, 3]) {
            for (let g = 0; g < side.length; g++) {
                let truth = 0;
                enumerate(side, k, { prefix: 0, suffix: 4 }, (taken, p) => {
                    if (taken.has(g)) truth += p;
                });
                expect(allAmongFirst(rates, [g], k)).toBeCloseTo(truth, 7);
            }
        }
    });

    it("the first draw is the weight share", () => {
        expect(allAmongFirst([1000, 400, 50], [1], 1)).toBeCloseTo(400 / 1450, 12);
    });

    it("one side: the exact distribution over which special groups are taken", () => {
        const side = POOL.filter((g) => g.side === "suffix");
        const rates = side.map((g) => g.weight);
        const special = [0, 2, 3];
        for (const k of [1, 2, 3]) {
            const truth = new Float64Array(8);
            enumerate(side, k, { prefix: 0, suffix: 4 }, (taken, p) => {
                let mask = 0;
                special.forEach((g, b) => {
                    if (taken.has(g)) mask |= 1 << b;
                });
                truth[mask] = truth[mask]! + p;
            });
            const got = amongFirstDistribution(rates, special, k);
            for (let mask = 0; mask < 8; mask++) expect(got[mask]).toBeCloseTo(truth[mask]!, 7);
        }
    });

    it("both sides: how the draws split", () => {
        const prefix = POOL.filter((g) => g.side === "prefix").map((g) => g.weight);
        const suffix = POOL.filter((g) => g.side === "suffix").map((g) => g.weight);
        for (const [m, caps] of [
            [4, { prefix: 3, suffix: 3 }],
            [5, { prefix: 3, suffix: 3 }],
            [6, { prefix: 3, suffix: 3 }],
            [3, { prefix: 2, suffix: 2 }],
            [1, { prefix: 3, suffix: 3 }],
            [2, { prefix: 1, suffix: 1 }],
        ] as const) {
            const truth = new Array<number>(caps.prefix + 1).fill(0);
            enumerate(POOL, m, caps, (taken, p) => {
                let count = 0;
                for (const i of taken) if (POOL[i]!.side === "prefix") count++;
                truth[count]! += p;
            });
            const got = splitDistribution(prefix, suffix, m, caps.prefix, caps.suffix);
            for (let c = 0; c <= caps.prefix; c++) expect(got[c]).toBeCloseTo(truth[c]!, 6);
        }
    });

    it("given the split, which groups land on a side is that side's own race", () => {
        // The identity of the taken prefix groups, given that two were taken, is
        // close to the prefix race's own top-two distribution: the dependence
        // through depletion is second order.
        const prefix = POOL.filter((g) => g.side === "prefix");
        const rates = prefix.map((g) => g.weight);
        let both = 0;
        let twoPrefixes = 0;
        enumerate(POOL, 4, { prefix: 3, suffix: 3 }, (taken, p) => {
            const got = [0, 1, 2].filter((i) => taken.has(i));
            if (got.length === 2) {
                twoPrefixes += p;
                if (taken.has(1) && taken.has(2)) both += p;
            }
        });
        const conditional = both / twoPrefixes;
        const raceOnly = allAmongFirst(rates, [1, 2], 2);
        expect(Math.abs(conditional - raceOnly)).toBeLessThan(0.02);
    });

    it("a side with nothing to draw from and a special beyond the draw", () => {
        expect(allAmongFirst([10, 20], [0, 1], 1)).toBe(0);
        expect(allAmongFirst([0, 20], [0], 2)).toBe(0);
        expect(splitDistribution([], [10, 20], 2, 3, 3)).toEqual([1, 0, 0, 0]);
        expect(splitDistribution([10, 20], [], 2, 3, 3)).toEqual([0, 0, 1, 0]);
    });
});
