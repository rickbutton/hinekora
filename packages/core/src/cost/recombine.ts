/**
 * The Recombinator's draw (Recombinator § Unpredictable Recombination): each
 * side pools the modifiers of both items; how many the result keeps follows
 * the page's count table; which ones is a weighted pick without replacement,
 * one side filled first at even odds, an exclusive modifier once picked
 * removing every other exclusive from both pools. The page says the pick is
 * weighted "although the exact formula is unknown": here a pick is
 * proportional to the modifier's spawn weight on the result's base, an unnamed
 * modifier counting at the average weight of its side's pool (QUESTIONS.md Q67).
 * A side's pick is a small dynamic program over which of the few named
 * modifiers were taken, never over the item's outcomes.
 */
import type { TypeId } from "../model/ids.js";
import type { Row } from "./roll.js";

/** One modifier type in a side's pool. */
export interface Pooled {
    readonly type: TypeId;
    /** The rows it may be on the result, the ones it had on either input. */
    readonly rows: readonly Row[];
    /** Its weight in the pick, doubled when both inputs carry it. */
    readonly weight: number;
    readonly exclusive: boolean;
}

export interface PooledSide {
    readonly named: readonly Pooled[];
    /** The modifiers the inputs hold that no condition names, and their weight each. */
    readonly unnamed: number;
    readonly unnamedWeight: number;
    /** How many the result keeps of this side, with its probability. */
    readonly keeps: ReadonlyMap<number, number>;
}

/**
 * The page's count table: pooled modifiers of a side → the chance of keeping
 * none to three. Six or more pooled read the last row.
 */
const COUNT_TABLE: readonly (readonly number[])[] = [
    [1, 0, 0, 0],
    [0.41, 0.59, 0, 0],
    [0, 0.667, 0.333, 0],
    [0, 0.4, 0.5, 0.1],
    [0, 0.1, 0.6, 0.3],
    [0, 0, 0.43, 0.57],
    [0, 0, 0.3, 0.7],
];

/** How many modifiers a side keeps of `pooled`, each count with its chance. */
export function keptDistribution(pooled: number, cap: number): Map<number, number> {
    const row = COUNT_TABLE[Math.max(0, Math.min(COUNT_TABLE.length - 1, Math.round(pooled)))]!;
    const out = new Map<number, number>();
    row.forEach((prob, k) => {
        if (prob <= 0) return;
        const n = Math.min(k, cap, pooled);
        out.set(n, (out.get(n) ?? 0) + prob);
    });
    return out;
}

/** One way a side's pick ends: which named modifiers it took, how many in
 *  all, and whether an exclusive one is among them. */
export interface Picked {
    readonly mask: number;
    readonly count: number;
    readonly exclusive: boolean;
    readonly prob: number;
}

/**
 * The pick for one side: `k` modifiers drawn by weight without replacement
 * from the named and the unnamed, an exclusive modifier eligible only while
 * none has been taken (on this side or the one filled before it), the pick
 * ending early when nothing eligible is left.
 */
export function pickSide(side: PooledSide, exclusiveTaken: boolean): Picked[] {
    const out = new Map<string, Picked>();
    const put = (p: Picked): void => {
        const key = `${p.mask}/${p.count}/${p.exclusive ? 1 : 0}`;
        const hit = out.get(key);
        if (hit) out.set(key, { ...hit, prob: hit.prob + p.prob });
        else out.set(key, p);
    };
    for (const [k, kProb] of side.keeps) {
        let states = new Map<string, Picked>([
            ["start", { mask: 0, count: 0, exclusive: exclusiveTaken, prob: kProb }],
        ]);
        for (let pick = 0; pick < k; pick++) {
            const next = new Map<string, Picked>();
            const step = (p: Picked): void => {
                const key = `${p.mask}/${p.count}/${p.exclusive ? 1 : 0}`;
                const hit = next.get(key);
                if (hit) next.set(key, { ...hit, prob: hit.prob + p.prob });
                else next.set(key, p);
            };
            for (const s of states.values()) {
                const unnamedLeft = side.unnamed - (s.count - bits(s.mask));
                let total = unnamedLeft > 0 ? unnamedLeft * side.unnamedWeight : 0;
                side.named.forEach((m, i) => {
                    if (!(s.mask & (1 << i)) && !(m.exclusive && s.exclusive)) total += m.weight;
                });
                if (total <= 0) {
                    put(s);
                    continue;
                }
                side.named.forEach((m, i) => {
                    if (s.mask & (1 << i) || (m.exclusive && s.exclusive)) return;
                    step({
                        mask: s.mask | (1 << i),
                        count: s.count + 1,
                        exclusive: s.exclusive || m.exclusive,
                        prob: (s.prob * m.weight) / total,
                    });
                });
                if (unnamedLeft > 0) {
                    step({
                        ...s,
                        count: s.count + 1,
                        prob: (s.prob * unnamedLeft * side.unnamedWeight) / total,
                    });
                }
            }
            states = next;
        }
        for (const s of states.values()) put(s);
    }
    // The flag out is whether this side took an exclusive, for the side after.
    return [...out.values()].map((p) => ({ ...p, exclusive: p.exclusive && !exclusiveTaken }));
}

function bits(mask: number): number {
    let n = 0;
    for (let m = mask; m > 0; m >>= 1) n += m & 1;
    return n;
}
