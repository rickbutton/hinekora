/**
 * The cost report's figures in the player's words, shared by the CLI, the
 * hover and the playground so a round count or a price reads the same
 * everywhere.
 */
import { inChaos, type Price, type Prices } from "./prices.js";
import type { PerFinished, StepCost } from "./report.js";

/** A figure as players quote it: "0.25", "8.8", "37", "473". */
export function figure(n: number): string {
    if (!Number.isFinite(n)) return "∞";
    if (n >= 100) return String(Math.round(n));
    if (n >= 10) return n.toFixed(1).replace(/\.0$/, "");
    return n.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

/** A chance as players quote it: "56%", "4.5%", "0.25%". */
export function percentage(p: number): string {
    const v = p * 100;
    // Short of certain is never written as certain: 0.9996 is "99.96%". A
    // shortfall of the sums' rounding error is none.
    if (v < 100 - 1e-9 && Math.round(v) === 100)
        return `${Math.min(v, 99.99).toFixed(v < 99.95 ? 1 : 2)}%`;
    if (v >= 10) return `${Math.round(v)}%`;
    if (v >= 1) return `${v.toFixed(1)}%`;
    // Nor is a chance above none written as none: 0.00004 is "0.01%".
    if (v > 1e-9 && v.toFixed(2) === "0.00") return "0.01%";
    return `${v.toFixed(2)}%`;
}

/** "~24": an estimate, marked as one. */
export function approx(n: number): string {
    return `~${figure(n)}`;
}

/**
 * A repeat's odds as players quote them: "1/37 chance", the chance one round
 * ends it; a percentage once it is better than even ("60% chance"). The
 * rounds a craft expects show in its steps' runs, fewer than the odds'
 * denominator where the loop is often entered at its exit.
 */
export function oddsText(chance: number): string {
    if (!(chance > 0)) return "never ends";
    if (chance >= 0.5) return `${percentage(chance)} chance`;
    return `1/${Math.round(1 / chance)} chance`;
}

/** A spread's two ends, "36.5 to 37.3"; nothing when they print alike. */
export function spreadText(
    b: { readonly low: number; readonly high: number } | undefined,
    show: (n: number) => string,
): string | undefined {
    if (b === undefined) return undefined;
    const low = show(b.low);
    const high = show(b.high);
    return low === high ? undefined : `${low} to ${high}`;
}

/** A chance as the end of a spread: "1/36.5", "62%". */
export function oddsFigure(chance: number): string {
    if (!(chance > 0)) return "never";
    if (chance >= 0.5) return percentage(chance);
    return `1/${figure(1 / chance)}`;
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

/** What one finished item takes: "~2512 attempts: 2512 Vaal Orb, ~1557 Chaos
 *  Orbs (~17.2 Divine Orbs)", the Chaos Orbs where the snapshot prices it all. */
export function perFinishedText(p: PerFinished): string {
    const priced =
        p.chaos !== undefined && p.divine !== undefined
            ? `, ${approx(p.chaos)} Chaos Orbs (${approx(p.divine)} Divine Orbs)`
            : "";
    const spend = p.total.length === 0 ? "" : `: ${priceText(p.total)}${priced}`;
    return `${approx(p.attempts)} attempts${spend}`;
}

/** What `perFinishedText` leaves out. */
export const PER_FINISHED_UNPRICED = "not counting the items the failed attempts use up";
