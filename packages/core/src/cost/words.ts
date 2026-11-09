/**
 * The cost report's figures in the guide's words, shared by the CLI, the
 * hover and the playground so a round count or a price reads the same
 * everywhere.
 */
import { inChaos, type Price, type Prices } from "./prices.js";

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

/** "8.8 Deafening Essence of Greed, 2 Chaos Orb", with "(about 24 chaos)" under a snapshot. */
export function priceText(prices: readonly Price[], snapshot?: Prices): string {
    const list = prices.map((p) => `${figure(p.amount)} ${p.item}`).join(", ");
    const chaos = snapshot === undefined ? undefined : inChaos(prices, snapshot);
    return chaos === undefined ? list : `${list} (about ${figure(chaos)} chaos)`;
}
