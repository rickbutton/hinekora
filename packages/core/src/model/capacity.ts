/**
 * Affix capacity (item-model.md §7): how many prefixes, suffixes and affixes in
 * all a base can hold at a rarity. One formula for the pool and the checker's
 * count domain, so the two can never disagree.
 *
 * The count is bounded three ways: each side by its natural per-rarity limit
 * shifted by the base's `capDelta` (floored at 0), and the two sides together by
 * a hard per-rarity total. The total is INDEPENDENT of the per-side sum — that is
 * what makes a magic Ratcheting Ring "0 prefix / 2 suffix" (raw suffix 1+3=4, but
 * the magic total is 2), not 0/4.
 */
import type { Base } from "./base.js";
import type { Gen, Rarity } from "./ids.js";

/** The three numeric bounds counts live under: a per-side cap each and a hard
 *  cap on the two sides together. */
export interface Caps {
    readonly prefix: number;
    readonly suffix: number;
    readonly total: number;
}

/** The classes that top out at Magic: flasks, tinctures, relics and charms
 *  (Rarity § Rare). */
const NO_RARE_CLASSES: ReadonlySet<string> = new Set([
    "LifeFlask",
    "ManaFlask",
    "HybridFlask",
    "UtilityFlask",
    "UtilityFlaskCritical",
    "Tincture",
    "Relic",
    "SanctumSpecialRelic",
    "AtlasRelic",
    "AnimalCharm",
]);

/** Can this base be made Rare at all? */
export function canBeRare(base: Base): boolean {
    return !NO_RARE_CLASSES.has(base.itemClass);
}

/** The classes whose Rare holds four affixes (2 per side): jewels, abyss jewels
 *  and Rogue's equipment (Rarity § Rare). */
const FOUR_AFFIX_CLASSES: ReadonlySet<string> = new Set([
    "Jewel",
    "AbyssJewel",
    "HeistEquipmentWeapon",
    "HeistEquipmentTool",
    "HeistEquipmentUtility",
    "HeistEquipmentReward",
]);

/** The per-side affix limit inherent to a rarity + base class, before implicit
 *  deltas: normal 0, magic 1, rare 3 (2 for the four-affix classes). */
function naturalPerSide(rarity: Rarity, base: Base): number {
    switch (rarity) {
        case "normal":
            return 0;
        case "magic":
            return 1;
        case "rare":
            return FOUR_AFFIX_CLASSES.has(base.itemClass) ? 2 : 3;
    }
}

/** The hard cap on TOTAL affixes for this rarity — `2 × naturalPerSide`, an
 *  independent bound the per-side deltas cannot exceed (magic = 2, rare = 6). */
export function hardTotalCap(rarity: Rarity, base: Base): number {
    return 2 * naturalPerSide(rarity, base);
}

/** The per-side affix cap: natural limit plus the base's implicit delta for that
 *  generation, floored at 0. */
export function sideCap(gen: Gen, rarity: Rarity, base: Base): number {
    const delta = base.capDelta ? base.capDelta[gen] : 0;
    return Math.max(0, naturalPerSide(rarity, base) + delta);
}

/** The most affixes this item can hold: the hard total, but never more than the
 *  two per-side caps allow together (Simplex: `min(6, 1+2) = 3`). */
export function maxTotal(rarity: Rarity, base: Base): number {
    return Math.min(
        hardTotalCap(rarity, base),
        sideCap("prefix", rarity, base) + sideCap("suffix", rarity, base),
    );
}

/** Bundle the three caps for a rarity + base. */
export function caps(rarity: Rarity, base: Base): Caps {
    return {
        prefix: sideCap("prefix", rarity, base),
        suffix: sideCap("suffix", rarity, base),
        total: maxTotal(rarity, base),
    };
}
