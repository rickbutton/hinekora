/**
 * The small pieces of English every message, tooltip and card is built from,
 * in one place so the checker, the cost report, the renderers and the editors
 * write them the same way.
 */
import type { Range } from "./check/domain.js";
import type { Rarity } from "./model/ids.js";

/** "grand" → "Grand". */
export function capitalise(s: string): string {
    return s.charAt(0).toUpperCase() + s.slice(1);
}

/** "tier" → "tiers", "prefix" → "prefixes". */
function pluralOf(word: string): string {
    return /(?:s|x|z|ch|sh)$/.test(word) ? `${word}es` : `${word}s`;
}

/** "1 tier", "3 tiers": the word, plural for any count but one. */
export function plural(n: number, word: string): string {
    return n === 1 ? word : pluralOf(word);
}

/** "1 modifier", "0-1 modifiers": a range takes the singular only when it is exactly one. */
export function pluralRange(r: Range, word: string): string {
    return r[0] === 1 && r[1] === 1 ? word : pluralOf(word);
}

/** Each rarity as the game writes it. */
export const RARITY_WORD: Readonly<Record<Rarity, string>> = {
    normal: "Normal",
    magic: "Magic",
    rare: "Rare",
};

/** "Rare", or "Magic or Rare": the rarities an item may have, in the game's order. */
export function rarityText(rarities: Iterable<Rarity>): string {
    const has = new Set(rarities);
    return (["normal", "magic", "rare"] as const)
        .filter((r) => has.has(r))
        .map((r) => RARITY_WORD[r])
        .join(" or ");
}

/** "82", or "40-82": a range as one number when its ends meet. */
export function rangeText(r: Range, dash = "-"): string {
    return r[0] === r[1] ? String(r[0]) : `${r[0]}${dash}${r[1]}`;
}
