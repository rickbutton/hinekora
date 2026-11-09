/**
 * Memory strands (Memory strand § Mechanics): an item found in the Atlas may
 * hold up to a hundred. While it holds some, a currency that adds or rerolls
 * modifiers lays down only the top tiers of each modifier, so many of the tiers
 * the item level admits, and uses up a random share of the strands, at most a
 * number that depends on the currency (§ Crafting methods consuming memory
 * strands, the `strands` op of each method in `check/library.ts`).
 */

export const MAX_STRANDS = 100;

/** How many of a modifier's `tiers` can roll on an item holding `strands`. */
export function tiersWithStrands(strands: number, tiers: number): number {
    if (tiers <= 0) return 0;
    if (strands <= 0) return tiers;
    return Math.floor((100 / (2.5 * strands + 147.5)) * (tiers - 1)) + 1;
}
