/**
 * The concrete item (typing rules §2): the runtime record `pool` and the
 * currency library read, plus `ItemIndex`, the projection the type rules
 * branch on. The item deliberately has NO `effects` field — active effects are
 * derived from the present mods (`effects.ts`), so desync is impossible by
 * construction.
 */
import type { Base } from "./base.js";
import type { Game, GroupId, Rarity, TypeId } from "./ids.js";
import type { Mod } from "./mod.js";

export interface Item {
    /** Which game's ruleset this item lives under — the seam that isolates PoE1/PoE2. */
    readonly game: Game;
    readonly base: Base;
    readonly ilvl: number;
    readonly rarity: Rarity;
    readonly prefixes: readonly Mod[];
    readonly suffixes: readonly Mod[];
}

/** The type index: `present` is the set of ModType facts tracked for
 *  guarantees ("has mod X"). */
export interface ItemIndex {
    readonly game: Game;
    readonly rarity: Rarity;
    readonly prefixCount: number;
    readonly suffixCount: number;
    readonly ilvl: number;
    readonly present: ReadonlySet<TypeId>;
}

/** All affixes, prefixes then suffixes. The order is not semantically meaningful. */
export function affixes(it: Item): readonly Mod[] {
    return [...it.prefixes, ...it.suffixes];
}

export function prefixCount(it: Item): number {
    return it.prefixes.length;
}

export function suffixCount(it: Item): number {
    return it.suffixes.length;
}

/** The ModTypes currently present — the `present` component of the index. */
export function presentTypes(it: Item): ReadonlySet<TypeId> {
    return new Set(affixes(it).map((m) => m.type));
}

/** The union of all family memberships across present affixes (used by exclusion checks). */
export function presentFamilies(it: Item): ReadonlySet<GroupId> {
    const acc = new Set<GroupId>();
    for (const m of affixes(it)) {
        for (const f of m.families) acc.add(f);
    }
    return acc;
}

/** Project the runtime item onto its type index. */
export function toIndex(it: Item): ItemIndex {
    return {
        game: it.game,
        rarity: it.rarity,
        prefixCount: prefixCount(it),
        suffixCount: suffixCount(it),
        ilvl: it.ilvl,
        present: presentTypes(it),
    };
}
