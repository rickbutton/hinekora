/**
 * Mod acquisition sources, and the catalogs for source-specific crafting.
 *
 * A mod's SOURCE is how it can get onto an item. It is derivable from the raw
 * data (domain + generation type + the essence flag) and stamped onto each mod
 * at ingest. The point is to make explicit what `pool` already enforces
 * implicitly: only `natural` mods roll via chaos/exalt (they have real spawn
 * weights on an item-domain base), while `essence`/`bench`/`veiled`/… mods come
 * from their own currency items and live in their own domains.
 *
 * The full taxonomy is listed; our current (affix-only) data populates the
 * affix sources. Implicit-slot sources (`corrupted`, `enchant`, `eldritch`) are
 * defined for completeness — they arrive when the model grows an implicit slot.
 */
import type { ClassId, ModId } from "./ids.js";

export type ModSource =
    | "natural" // rolls via chaos/exalt (nonzero spawn weight on an item base)
    | "essence" // guaranteed by an Essence
    | "bench" // crafting-bench option
    | "veiled" // unveiled (Jun / betrayal)
    | "fossil" // delve / fossils
    | "synthesis" // synthesis implicits
    | "corrupted" // Vaal-orb corruption implicit
    | "enchant" // lab / etc enchantment
    | "eldritch" // eater-of-worlds / searing-exarch implicit
    | "unique" // unique-item mod (not craftable)
    | "other"; // anything else (monster/area mods, non-spawnable specials)

/**
 * An Essence: it rerolls the item (chaos-style) but GUARANTEES one specific mod,
 * chosen by the item's class (the same essence grants different mods on a Ring
 * vs a Body Armour). The guaranteed mod may itself be `natural` or `essence`.
 */
export interface EssenceSpec {
    readonly id: string;
    readonly name: string;
    /** Essence tier (1 = weakest). */
    readonly tier: number;
    /** Minimum item level the essence can be applied to. */
    readonly itemLevel: number;
    /** Item class → the mod this essence guarantees on that class. */
    readonly grants: ReadonlyMap<ClassId, ModId>;
}

/** A crafting-bench option that adds one specific mod to matching item classes. */
export interface BenchCraft {
    readonly mod: ModId;
    /** Bench tier (higher = stronger craft). */
    readonly tier: number;
    readonly itemClasses: ReadonlySet<ClassId>;
    readonly master?: string;
}
