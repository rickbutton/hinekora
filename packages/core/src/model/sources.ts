/**
 * Mod acquisition sources (stamped at ingest) and the catalogs for
 * source-specific crafting. Only `natural` mods roll via chaos/exalt;
 * essence/bench/veiled/… mods come from their own currency items.
 * Implicit-slot sources are defined for completeness but not yet modelled.
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
 * An Essence: rerolls the item but guarantees one specific mod, chosen by the
 * item's class.
 */
export interface EssenceSpec {
    readonly id: string;
    readonly name: string;
    /** Ladder tier: 1 = Whispering … 7 = Deafening, 8 = corrupted. Tier >= 5 may
     *  reforge a Rare item; lower tiers only upgrade a Normal item. */
    readonly tier: number;
    /**
     * Cap on the level of the RANDOM fill mods (absent = no cap). NOT an
     * item-level requirement — the guaranteed mod lands at its fixed tier on
     * any ilvl; only the fill respects `min(item.ilvl, maxRandomModLevel)`.
     */
    readonly maxRandomModLevel?: number;
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
