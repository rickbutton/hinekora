/**
 * Mod acquisition sources (stamped at ingest) and the catalogs for
 * source-specific crafting. Only `natural` mods roll via chaos/exalt;
 * essence/bench/veiled/fossil mods come from their own mechanic.
 */
import type { ClassId, ModId, TagId, TypeId } from "./ids.js";
import type { EldritchSide } from "./marks.js";

export type ModSource =
    | "natural" // rolls via chaos/exalt (nonzero spawn weight on an item base)
    | "essence" // guaranteed by an Essence
    | "bench" // crafting-bench option
    | "veiled" // a veiled placeholder or an unveiled result
    | "fossil" // delve / fossils
    | "elevated" // an elevated influenced modifier, made by an Orb of Dominance alone
    | "other"; // a row nothing places (no partition of its own, no weight anywhere)

/** The ladder tier above Deafening: the corrupted essences and the retired
 *  Essence of Desolation. */
export const CORRUPTED_ESSENCE_TIER = 8;

/** The four corrupted essences (Essence § Corrupted essences), the ones a
 *  Glyphic Fossil draws from; the Essence of Desolation shares their tier but
 *  is a mirage essence. */
export const CORRUPTED_ESSENCES: ReadonlySet<string> = new Set([
    "Essence of Delirium",
    "Essence of Horror",
    "Essence of Hysteria",
    "Essence of Insanity",
]);

export function isCorruptedEssence(e: EssenceSpec): boolean {
    return e.tier === CORRUPTED_ESSENCE_TIER && CORRUPTED_ESSENCES.has(e.name);
}

/**
 * An Essence: rerolls the item but guarantees one specific mod, chosen by the
 * item's class.
 */
export interface EssenceSpec {
    readonly id: string;
    readonly name: string;
    /** Ladder tier: 1 = Whispering … 7 = Deafening, `CORRUPTED_ESSENCE_TIER`.
     *  Tier >= 5 may reforge a Rare item; lower tiers only upgrade a Normal item. */
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

/**
 * A fossil: what it does to which modifiers a resonator's reforge can roll
 * (Fossil § Mechanics). Weight multipliers are not modelled.
 */
export interface FossilSpec {
    readonly id: string;
    readonly name: string;
    /** Category tags whose modifiers cannot roll ("No X modifiers"). */
    readonly blockedTags: ReadonlySet<TagId>;
    /** Fossil-only rows that join the pool. */
    readonly addedMods: readonly ModId[];
    /** Rows one of which is guaranteed (the Hollow Fossil's abyssal socket). */
    readonly forcedMods: readonly ModId[];
    /** Base tags one of which the item must carry, when the fossil limits its targets. */
    readonly allowedTags?: ReadonlySet<TagId>;
    /** Percent chance that one rolled modifier is a corrupted essence's: the
     *  Glyphic Fossil's certainty, the Tangled Fossil's one in ten. */
    readonly corruptedEssenceChance: number;
    /** Fractures one of the modifiers it rolls (the Fractured Fossil). */
    readonly fractures: boolean;
    /** Corrupts the item (the Bloodstained Fossil). */
    readonly corrupts: boolean;
}

/**
 * One eldritch implicit row (Eldritch implicit modifier): which implicit, at
 * which tier, on which classes, with the text a guide names it by. Rows of one
 * type are the tiers of one implicit; the "presence" variants (stronger while
 * a Unique or Pinnacle enemy is near) are types of their own with the same
 * wording, so a name resolves to every type that wording covers.
 */
export interface EldritchImplicitSpec {
    readonly id: ModId;
    readonly side: EldritchSide;
    /** 1 (Lesser) to 6 (Perfect). */
    readonly tier: number;
    readonly type: TypeId;
    /** The class tags the row rolls on (`gloves`, `body_armour`, …). */
    readonly classes: ReadonlySet<TagId>;
    readonly implicitTags: ReadonlySet<TagId>;
    readonly text: string;
}

/** A crafting-bench option that adds one specific mod to matching item classes. */
export interface BenchCraft {
    readonly mod: ModId;
    /** Bench tier (higher = stronger craft). */
    readonly tier: number;
    readonly itemClasses: ReadonlySet<ClassId>;
    readonly master?: string;
}
