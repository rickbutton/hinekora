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
 * (Fossil § Mechanics), and how it weights them.
 */
export interface FossilSpec {
    readonly id: string;
    readonly name: string;
    /** Category tags whose modifiers cannot roll ("No X modifiers"). */
    readonly blockedTags: ReadonlySet<TagId>;
    /** Category tag → weight multiplier in percent ("More Life modifiers" is
     *  1000, ten times); the cost layer reads it, the checker does not. */
    readonly weights: ReadonlyMap<TagId, number>;
    /** Modifiers with no category tag cannot roll ("No Tagless modifiers", the
     *  Opulent Fossil). */
    readonly blocksTagless?: true;
    /** Fossil-only rows that join the pool. */
    readonly addedMods: readonly ModId[];
    /** Rows one of which is guaranteed (the Hollow Fossil's abyssal socket). */
    readonly forcedMods: readonly ModId[];
    /** Base tags one of which the item must carry, when the fossil limits its targets. */
    readonly allowedTags?: ReadonlySet<TagId>;
    /** Percent chance that one rolled modifier is a corrupted essence's: the
     *  Glyphic Fossil's certainty. */
    readonly corruptedEssenceChance: number;
    /** Makes one random category much more likely and blocks another, shown
     *  only once the resonator is full (the Tangled Fossil): which rows can
     *  roll is not known beforehand, so the pool is read whole. */
    readonly randomTags?: true;
    /** Fractures one of the modifiers it rolls (the Fractured Fossil). */
    readonly fractures: boolean;
    /** Corrupts the item (the Bloodstained Fossil). */
    readonly corrupts: boolean;
}

export const ELEMENTS = ["fire", "cold", "lightning"] as const;
export type Element = (typeof ELEMENTS)[number];
export type HarvestChangeKind = "resistance" | "damage";

/**
 * The modifier types the grove's "Change a modifier that grants …" crafts
 * take, by what they grant and the element changed from: the game's own lists
 * (`HarvestCraftOptions`, the `convert_mod` rows).
 */
export type HarvestChangeLists = Readonly<
    Record<HarvestChangeKind, Readonly<Partial<Record<Element, readonly TypeId[]>>>>
>;

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
    /** The row's spawn weight per class tag: its share of an ember's or ichor's draw. */
    readonly weights: ReadonlyMap<TagId, number>;
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
    /** What the craft costs, currency name → amount ("Divine Orb" → 2); the cost
     *  layer reads it, the checker does not. */
    readonly cost?: ReadonlyMap<string, number>;
}
