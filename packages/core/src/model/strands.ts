/**
 * Memory strands (Memory strand § Mechanics): an item found in the Atlas may
 * hold up to a hundred. While it holds some, a currency that adds or rerolls
 * modifiers lays down only the top tiers of each modifier, so many of its
 * whole ladder on the base, and uses up a random share of the strands, at most
 * a number that depends on the currency (§ Crafting methods consuming memory
 * strands, the `strands` op of each method in `check/library.ts`).
 */

export const MAX_STRANDS = 100;

/** On an item holding strands a Foulborn orb "counts as the equivalent of +30
 *  Memory Strands" (§ Mechanics), past the hundred an item can hold. */
export const FOULBORN_AS_STRANDS = 30;

/** How many of a modifier's `tiers` can roll on an item holding `strands`. */
export function tiersWithStrands(strands: number, tiers: number): number {
    if (tiers <= 0) return 0;
    if (strands <= 0) return tiers;
    return Math.floor((100 / (2.5 * strands + 147.5)) * (tiers - 1)) + 1;
}

/** How many of a type's `n` eligible tiers a Foulborn orb lets roll, the top
 *  ones, on an item holding no strands (Foulborn currency § Mechanics). */
export function foulbornKept(n: number): number {
    return n <= 6 ? Math.ceil(n / 2) : Math.floor(n / 2) + 1;
}
