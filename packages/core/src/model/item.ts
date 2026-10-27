/**
 * The facts about an item a roll depends on (item-model.md §7): the base and
 * level a row must fit, the rarity that sets the caps, what is already on the
 * item (its counts, mod types and claimed families, which decide what may still
 * coexist), the tags a spawn table is matched against, and the active effects.
 * The pool reads nothing else. The checker projects its abstract state onto
 * this record; there is no concrete item type behind it.
 */
import type { Base } from "./base.js";
import type { Effect } from "./effects.js";
import type { GroupId, Rarity, TagId, TypeId } from "./ids.js";

export interface ItemFacts {
    readonly base: Base;
    readonly ilvl: number;
    readonly rarity: Rarity;
    readonly prefixCount: number;
    readonly suffixCount: number;
    /** The ModTypes present. */
    readonly types: ReadonlySet<TypeId>;
    /** The exclusion groups the present mods claim. */
    readonly families: ReadonlySet<GroupId>;
    /** The base's tags plus those every present mod adds (Modifier § Tags),
     *  which is how a weapon-specific jewel modifier zeroes every other one's
     *  weight once it is on the item. */
    readonly tags: ReadonlySet<TagId>;
    /** The effects the present carriers contribute. */
    readonly effects: readonly Effect[];
}

/** The facts of a bare base at a rarity: nothing present. */
export function emptyItem(base: Base, ilvl: number, rarity: Rarity): ItemFacts {
    return {
        base,
        ilvl,
        rarity,
        prefixCount: 0,
        suffixCount: 0,
        types: new Set(),
        families: new Set(),
        tags: base.tags,
        effects: [],
    };
}
