/**
 * The item, and its type index.
 *
 * Two views of the same thing (typing rules §2):
 *
 *   - `Item` is the RUNTIME RECORD — the concrete value the checker holds and
 *     that `pool` reads. It has the actual prefix/suffix mod lists.
 *   - `ItemIndex` is the TYPE INDEX — the projection the type system branches
 *     on: `Item[game, rarity, |prefixes|, |suffixes|, ilvl, present]`. Counts +
 *     rarity drive slot rules; `present` drives loop-exit guarantees; `game`
 *     isolates the two rulesets.
 *
 * We keep the runtime record and compute the index from it. In M1 nothing yet
 * consumes the index for checking, but it is the object errors and the state
 * renderer (a later milestone) will speak in, so we build the projection now.
 *
 * NOTE on effects: the item deliberately has NO `effects` field. Active effects
 * are a pure projection over the mods (and, later, augments) actually present
 * — see `effects.ts`. Storing them would risk desync; deriving them makes
 * desync impossible by construction (typing rules §2).
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

/**
 * The type index — the meaningful projection the indexed monad threads.
 * `present` is the set of ModType facts we track for guarantees ("has mod X").
 * (The design's fuller (TypeId, GroupId) fact form is a later refinement; M1
 * keys guarantees on ModType, which is what the collision and has-X rules use.)
 */
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
