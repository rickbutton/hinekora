/**
 * The cost report's figures in the guide's words, shared by the CLI, the
 * hover and the playground so a round count or a price reads the same
 * everywhere.
 */
import { inChaos, type Price, type Prices } from "./prices.js";
import type { StepCost } from "./report.js";

/** A figure as a guide quotes it: "0.25", "8.8", "37", "473". */
export function figure(n: number): string {
    if (!Number.isFinite(n)) return "∞";
    if (n >= 100) return String(Math.round(n));
    if (n >= 10) return n.toFixed(1).replace(/\.0$/, "");
    return n.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

/** A chance as a guide quotes it: "56%", "4.5%", "0.25%". */
export function percentage(p: number): string {
    const v = p * 100;
    if (v >= 10) return `${Math.round(v)}%`;
    if (v >= 1) return `${v.toFixed(1)}%`;
    return `${v.toFixed(2)}%`;
}

/** "~24": an estimate, marked as one. */
export function approx(n: number): string {
    return `~${figure(n)}`;
}

/**
 * A repeat's odds as guides quote them: "1/37 per round", the chance one round
 * ends it; a percentage once it is better than even ("60% per round"). The
 * expected rounds are the odds' denominator, so they are not said again.
 */
export function oddsText(chance: number): string {
    if (!(chance > 0)) return "never ends";
    if (chance >= 0.5) return `${percentage(chance)} per round`;
    return `1/${Math.round(1 / chance)} per round`;
}

/**
 * A step whose cost says nothing its own name does not: it runs once and
 * spends exactly one of one currency ("transmute" is one Orb of
 * Transmutation). The surfaces leave its cost line out.
 */
export function costIsObvious(step: StepCost): boolean {
    return (
        step.runs === 1 &&
        step.runsRange === undefined &&
        step.note === undefined &&
        step.expected !== undefined &&
        step.expected.length === 1 &&
        step.expected[0]!.amount === 1
    );
}

/** "8.8 Deafening Essence of Greed, 2 Chaos Orb", with "(~24 chaos)" under a snapshot. */
export function priceText(prices: readonly Price[], snapshot?: Prices): string {
    const list = prices.map((p) => `${figure(p.amount)} ${p.item}`).join(", ");
    const chaos = snapshot === undefined ? undefined : inChaos(prices, snapshot);
    return chaos === undefined ? list : `${list} (${approx(chaos)} chaos)`;
}
