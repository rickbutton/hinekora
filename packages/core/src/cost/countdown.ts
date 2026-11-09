/**
 * A make-room loop: random removals (an Orb of Annulment, an Eldritch Orb of
 * Annulment) repeated until the counts allow, each one risking a modifier the
 * guide keeps, which a branch catches and restarts over. The counts fall by one
 * each round, so the loop is a short chain over (prefix, suffix) counts that is
 * solved exactly: the chance an attempt ends in the exit, a restart or a stop,
 * and how often each step of the body runs.
 */
import type { Gen } from "../model/ids.js";

export type CountdownStep =
    /** A random removal from one side, or from either in proportion to its count. */
    | { readonly kind: "remove"; readonly gen?: Gen }
    /** A branch that ends the attempt when a removal since the last guard took a
     *  kept modifier. */
    | { readonly kind: "guard"; readonly action: "restart" | "stop" }
    /** A step the counts do not depend on. */
    | { readonly kind: "other" };

export interface CountdownInput {
    readonly body: readonly CountdownStep[];
    /** The (prefix, suffix) counts the loop may start from, each with its weight. */
    readonly starts: readonly {
        readonly prefix: number;
        readonly suffix: number;
        readonly weight: number;
    }[];
    /** How many kept modifiers sit on each side. */
    readonly keepers: Readonly<Record<Gen, number>>;
    readonly exit: (prefix: number, suffix: number) => boolean;
}

export interface Countdown {
    /** How one attempt ends: in the exit, a restart or a stop. */
    readonly exit: number;
    readonly restart: number;
    readonly stop: number;
    /** Expected passes through the body in one attempt. */
    readonly passes: number;
    /** Per body step, how often it is reached in one attempt, and for a guard
     *  how often it fires. */
    readonly reached: readonly number[];
    readonly fired: readonly number[];
}

interface Totals {
    exit: number;
    restart: number;
    stop: number;
    passes: number;
    reached: number[];
    fired: number[];
}

/** Solve the chain. Undefined when a pass removes nothing, since the counts
 *  would never fall. */
export function countdown(input: CountdownInput): Countdown | undefined {
    if (!input.body.some((s) => s.kind === "remove")) return undefined;
    const t: Totals = {
        exit: 0,
        restart: 0,
        stop: 0,
        passes: 0,
        reached: input.body.map(() => 0),
        fired: input.body.map(() => 0),
    };
    let total = 0;
    for (const s of input.starts) total += s.weight;
    if (!(total > 0)) return undefined;
    for (const { prefix: p, suffix: s, weight } of input.starts) {
        const share = weight / total;
        if (input.exit(p, s)) {
            t.exit += share;
            continue;
        }
        pass(input, t, share, p, s, { prefix: input.keepers.prefix, suffix: input.keepers.suffix });
    }
    return t;
}

/** One pass of the body from the head with counts (p, s) and these kept
 *  modifiers still on the item, carrying `prob` of the attempt. */
function pass(
    input: CountdownInput,
    t: Totals,
    prob: number,
    p: number,
    s: number,
    keepers: Record<Gen, number>,
): void {
    if (prob < 1e-12) return;
    t.passes += prob;
    // The outcomes alive at each step: counts, kept modifiers, whether a kept
    // one was lost since the last guard, with their probability.
    let alive: { prob: number; p: number; s: number; k: Record<Gen, number>; lost: boolean }[] = [
        { prob, p, s, k: keepers, lost: false },
    ];
    input.body.forEach((step, i) => {
        let mass = 0;
        for (const o of alive) mass += o.prob;
        t.reached[i] = (t.reached[i] ?? 0) + mass;
        if (step.kind === "other") return;
        if (step.kind === "guard") {
            const kept: typeof alive = [];
            for (const o of alive) {
                if (o.lost) {
                    t.fired[i] = (t.fired[i] ?? 0) + o.prob;
                    if (step.action === "restart") t.restart += o.prob;
                    else t.stop += o.prob;
                } else kept.push(o);
            }
            alive = kept;
            return;
        }
        const next: typeof alive = [];
        for (const o of alive) {
            const total = o.p + o.s;
            if (total <= 0) {
                next.push(o);
                continue;
            }
            const sides: { gen: Gen; prob: number }[] =
                step.gen !== undefined
                    ? [{ gen: step.gen, prob: 1 }]
                    : [
                          { gen: "prefix", prob: o.p / total },
                          { gen: "suffix", prob: o.s / total },
                      ];
            for (const side of sides) {
                const count = side.gen === "prefix" ? o.p : o.s;
                if (count <= 0 || side.prob <= 0) {
                    if (side.prob > 0) next.push({ ...o, prob: o.prob * side.prob });
                    continue;
                }
                const hit = Math.min(1, o.k[side.gen] / count);
                const after = {
                    p: side.gen === "prefix" ? o.p - 1 : o.p,
                    s: side.gen === "suffix" ? o.s - 1 : o.s,
                };
                if (hit > 0) {
                    const k = { ...o.k, [side.gen]: o.k[side.gen] - 1 } as Record<Gen, number>;
                    next.push({ prob: o.prob * side.prob * hit, ...after, k, lost: true });
                }
                if (hit < 1) {
                    next.push({
                        prob: o.prob * side.prob * (1 - hit),
                        ...after,
                        k: o.k,
                        lost: o.lost,
                    });
                }
            }
        }
        alive = next;
    });
    // The head again: those at the exit leave; the rest go round, a kept
    // modifier lost without a guard to catch it simply gone.
    for (const o of alive) {
        if (input.exit(o.p, o.s)) t.exit += o.prob;
        else if (o.p + o.s < p + s) pass(input, t, o.prob, o.p, o.s, o.k);
        else t.restart += o.prob;
    }
}
