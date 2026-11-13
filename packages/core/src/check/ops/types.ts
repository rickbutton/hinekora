/**
 * The primitive operations (operations.md §2) a method is a sequence of, and
 * the words of a refused one. The exact checker's handlers (check/ops/) give
 * each its meaning; the reference interpreter (check/reference/) states it on
 * one item.
 */
import type { ClassId, Gen, ModId, Rarity, TagId, TypeId } from "../../model/ids.js";
import type { EldritchSide, Influence, InfluenceKey } from "../../model/marks.js";
import type { Mod } from "../../model/mod.js";
import type { EssenceSpec, FossilSpec } from "../../model/sources.js";
import type { Range } from "../range.js";

// --- the operations --------------------------------------------------------

/** A pool: which rows a `fill` draws from, resolved against the state it runs on. */
export type PoolSpec =
    /** The natural pool of the base at the item's level, or at `level` (a beast's);
     *  optionally capped lower, limited to one side, or culled to the top tiers
     *  of each type, a little over half of those eligible (`topTiers`,
     *  Foulborn). */
    | {
          readonly kind: "natural";
          readonly maxLevel?: number;
          readonly topTiers?: true;
          readonly gen?: Gen;
          readonly level?: number;
      }
    /** The natural pool's rows carrying a category tag (harvest). */
    | { readonly kind: "tagged"; readonly tag: TagId }
    /** The row a bench craft places; it counts as a crafted modifier. */
    | { readonly kind: "bench"; readonly mod: Mod }
    | { readonly kind: "essenceGrant"; readonly spec: EssenceSpec }
    | { readonly kind: "veiledPlaceholder" }
    /** The unveil results the item's placeholder may become; the fill replaces
     *  the placeholder. A target names the one the player picks. */
    | { readonly kind: "unveil"; readonly target?: TypeId }
    /** The natural pool under a resonator: rows carrying a blocked category tag
     *  are out, the fossils' own rows join, and a corrupted essence's modifier
     *  may land when a fossil gives it a chance. */
    | {
          readonly kind: "fossil";
          readonly blocked: ReadonlySet<TagId>;
          /** Rows with no category tag are out too (the Opulent Fossil). */
          readonly noTagless: boolean;
          readonly added: readonly Mod[];
          readonly essence: readonly Mod[];
          /** The fossils socketed, for the weights they give the rows (the
           *  cost layer reads them; the checker reads only the tags above). */
          readonly fossils: readonly FossilSpec[];
      }
    /** One of these rows, guaranteed: a fossil's forced row, the Glyphic Fossil's
     *  corrupted-essence modifier. */
    | {
          readonly kind: "rows";
          readonly mods: readonly Mod[];
          /** The type these rows replace (a Harvest change); if it may be a
           *  crafted modifier, so may they: a changed bench craft is crafted
           *  still (seen in game). */
          readonly replacing?: TypeId;
          /** With `replacing`: by the id of each row the replaced modifier may
           *  be at, the rows it becomes, so its tier and crafted mark carry to
           *  the replacement per source row; a row with no entry, or an
           *  empty one, becomes nothing. Filled by check/methods.ts
           *  `harvestChange`; read by the exact checker only. */
          readonly bySource?: ReadonlyMap<ModId, readonly Mod[]>;
      }
    /** One of the metamods not yet on the item whose side may have a slot (the
     *  Bestiary's random metamod); crafted. */
    | { readonly kind: "metamods" }
    /** The rows the item's influences admit and nothing else would: what an
     *  influence orb or the grove's influence reforge guarantees one of. */
    | { readonly kind: "influence" };

/** How many modifiers a `fill` lays down. */
export type FillCount =
    /** `n` more modifiers, on top of what is present, clamped to the caps. */
    | { readonly kind: "add"; readonly n: Range }
    /** A reforge: the total lands in `n` when no side was kept; with a kept side
     *  the rerolled side takes any number up to its cap and open kept-side slots
     *  may fill (Metamod § Rules and Exceptions: "0 to 3 suffixes"). `n` may be
     *  left to the item's rarity: none on Normal, one or two on Magic, four to
     *  six on Rare, the loosest over the rarities the item may have. A rare
     *  count on a base whose Rare holds four is three or four (`rareCountOn`). */
    | { readonly kind: "reforge"; readonly n: Range | "byRarity" }
    /** One of the modifiers already counted: an essence's grant, a harvest
     *  reforge's tagged modifier, a veiled chaos's placeholder, an unveil. */
    | { readonly kind: "within" };

/** Which present modifiers a removal may reach. */
export type Selector =
    /** One random modifier, of one side when `gen` is given. No removal spares
     *  what a cannot-roll metamod bars from rolling (Version 3.30.0, Item Changes: it no
     *  longer keeps an Orb of Annulment off a caster or attack modifier). A
     *  side-limited removal whose side is protected is skipped rather than
     *  refused (Metamod § Rules and Exceptions: "will add without removing"). */
    | {
          readonly kind: "random";
          readonly gen?: Gen;
          /** The pool the method filled from just before: the modifier that fill
           *  laid down is out of the removal's reach ("remove another"). */
          readonly sparing?: PoolSpec;
      }
    /** The crafted modifiers the bench can clear; a fractured one stays. When
     *  `replacing`, only under a limit of one: a craft replaces the single crafted
     *  modifier, while under the multimod it adds beside them (Crafting Bench §
     *  Using the crafting bench). */
    | { readonly kind: "crafted"; readonly replacing: boolean }
    /** Exactly this modifier (a harvest change). */
    | { readonly kind: "type"; readonly type: TypeId }
    /** One of the item's influenced modifiers on an unprotected side (the Orb
     *  of Dominance); the other modifiers' guarantees survive. */
    | { readonly kind: "influenced" };

/** A check a `require` must find true of every item at its step. */
export type Check =
    | { readonly kind: "rarity"; readonly rarity: Rarity }
    | { readonly kind: "notMagic" }
    | { readonly kind: "notNormal" }
    | { readonly kind: "canBeRare" }
    | { readonly kind: "openSlot"; readonly gen?: Gen }
    | { readonly kind: "removable"; readonly selector: Selector }
    /** Something to strip: not Normal, and not every side protected. */
    | { readonly kind: "strippable" }
    /** `what` names the craft when it is not the Fracturing Orb. */
    | { readonly kind: "atLeast"; readonly count: number; readonly what?: string }
    /** No item has a fractured modifier; `what` says, for a craft that is not
     *  itself a fracture, why it refuses one. */
    | { readonly kind: "noFracture"; readonly what?: string }
    /** No item is corrupted; every method but an unveil and the Corruption
     *  Altar requires it (Corrupted § Modifying corrupted items). */
    | { readonly kind: "notCorrupted" }
    /** Every item is corrupted (the Corruption Altar). */
    | { readonly kind: "corruptedItem"; readonly what: string }
    /** No item is twice corrupted (the Corruption Altar). */
    | { readonly kind: "notTwiceCorrupted"; readonly what: string }
    /** No item has an influence (a fracture, an influence orb). */
    | { readonly kind: "noInfluence"; readonly what: string }
    /** No item has an eldritch implicit (an influence orb). */
    | { readonly kind: "noEldritch"; readonly what: string }
    /** That eldritch implicit is dominant on every item (the Eldritch orbs). */
    | { readonly kind: "dominant"; readonly side: EldritchSide; readonly what: string }
    /** Every item has both eldritch implicits (an Orb of Conflict). */
    | { readonly kind: "bothEldritch" }
    /** That side is not protected by a metamod (an Eldritch Orb of Annulment
     *  would otherwise remove nothing). */
    | { readonly kind: "unprotectedSide"; readonly gen: Gen; readonly what: string }
    /** At least that many influenced modifiers are guaranteed on unprotected
     *  sides (the Orb of Dominance). */
    | { readonly kind: "influencedAtLeast"; readonly count: number }
    /** Every item is influenced, with that influence when one is named. */
    | { readonly kind: "influenced"; readonly what: string; readonly influence?: Influence }
    /** The item's class can carry that influence (a jewel or a flask cannot). */
    | { readonly kind: "influenceable"; readonly influence: Influence; readonly what: string }
    /** No modifier that may sit on a protected side is an influence modifier
     *  (the grove's randomise under "cannot be changed", Metamod § Rules and
     *  Exceptions). */
    | { readonly kind: "noInfluencedOnProtected"; readonly what: string }
    | { readonly kind: "veiledPresent" }
    /** No veiled or unveiled modifier at all (the Veiled Exalted Orb). */
    | { readonly kind: "noVeiled" }
    /** No veiled or unveiled modifier the strip would keep (the Veiled Chaos Orb
     *  reforges the rest away). */
    | { readonly kind: "noVeiledKept" }
    | { readonly kind: "noBlockingMetamod" }
    /** The modifier is guaranteed present, not fractured, and on an unprotected side. */
    | { readonly kind: "typeRemovable"; readonly type: TypeId; readonly label: string }
    | { readonly kind: "hasImprint" }
    /** The Bestiary imprints a Magic item or a Rare talisman. */
    | { readonly kind: "imprintable" }
    /** Some metamod fits the item (the Bestiary's random metamod). */
    | { readonly kind: "metamodFits" }
    /** The base carries the tag (a talisman for the Bestiary fractures). */
    | { readonly kind: "baseHasTag"; readonly tag: TagId; readonly what: string }
    /** The base carries one of the tags (the Corruption Altar's item types). */
    | { readonly kind: "baseHasAnyTag"; readonly tags: readonly TagId[]; readonly what: string }
    | { readonly kind: "minItemLevel"; readonly level: number; readonly what: string }
    | { readonly kind: "fossilAllowed"; readonly fossil: FossilSpec }
    | { readonly kind: "essenceRarity"; readonly tier: number }
    | { readonly kind: "essenceGrant"; readonly spec: EssenceSpec }
    /** `refusal` words what cannot be done at the limit, for a craft off the bench. */
    | { readonly kind: "craftedBelowCap"; readonly refusal?: string }
    /** Every item has a crafted modifier the bench can remove. */
    | { readonly kind: "craftedRemovable" }
    /** A craft that would replace the crafted modifier can: it is not fractured. */
    | { readonly kind: "craftedReplaceable" }
    /** No modifier of the row's group may be present; `refusal` words what
     *  cannot be done then, for a craft that is not a bench craft. */
    | {
          readonly kind: "noGroupConflict";
          readonly mod: Mod;
          readonly refusal?: string;
          /** The modifier the step takes away to put `mod` in its place. */
          readonly replacing?: TypeId;
      }
    | { readonly kind: "poolNonEmpty"; readonly pool: PoolSpec; readonly tag: TagId }
    | { readonly kind: "unveilTarget"; readonly type: TypeId; readonly name: string };

export type Op =
    | { readonly kind: "require"; readonly check: Check }
    /** Every modifier goes but the protected sides' and the fractured one. */
    | { readonly kind: "strip" }
    /** The metamods no longer govern the rest of the method (a Tainted Chaos
     *  Orb ignores them). */
    | { readonly kind: "unprotect" }
    /** That side alone is kept through the rest of the method, in place of
     *  the item's own protections (an Eldritch Chaos Orb rerolls the other). */
    | { readonly kind: "keep"; readonly gen: Gen }
    /** Change the eldritch mark: one implicit set to a tier, or an Orb of
     *  Conflict's raise-one-lower-the-other. */
    | { readonly kind: "eldritch"; readonly change: EldritchChange }
    /** One of several outcomes: the items each branch leaves, together. It
     *  holds effects only (a check or an `unprotect` belongs before it, at
     *  method level). A branch with an `end` is an outcome on which the item
     *  is gone and the craft stops, so it leaves no item; where every branch
     *  ends, so does the method. */
    | { readonly kind: "either"; readonly branches: readonly (readonly Transform[])[] }
    | { readonly kind: "end" }
    /** The item is corrupted once more: an uncorrupted one corrupted, a
     *  corrupted one twice corrupted. */
    | { readonly kind: "corrupt" }
    /** Forget which tier each present modifier is; a crafted one keeps its tier
     *  when `crafted` is false. */
    | { readonly kind: "relax"; readonly crafted: boolean }
    /** Every present modifier's value is rolled again within its tier, the
     *  fractured ones excepted (the Divine Orb). */
    | { readonly kind: "reroll" }
    /** One influenced modifier went up a tier, or to its elevated row at the
     *  top (the Orb of Dominance). */
    | { readonly kind: "elevate" }
    /** Change the influence mark: to one set, by adding an influence to every
     *  possible set, or to every set of the same size (the grove's randomise). */
    | { readonly kind: "influence"; readonly change: InfluenceChange }
    | { readonly kind: "fill"; readonly pool: PoolSpec; readonly count: FillCount }
    | { readonly kind: "remove"; readonly selector: Selector }
    /** `survivors`: the rarity a scour leaves, by how many modifiers remain.
     *  `lowest`: that, or the lowest rarity that holds them (a Tainted Chaos
     *  Orb's strip). */
    | { readonly kind: "rarity"; readonly rarity: Rarity | "survivors" | "lowest" }
    /** `n` random present modifiers become fractured. */
    | { readonly kind: "lock"; readonly n: number }
    /** A list `consume` is indexed by the modifier count before the method, its
     *  last entry standing for every count beyond it. */
    | { readonly kind: "strands"; readonly consume: number | readonly number[] }
    | { readonly kind: "imprint" }
    /** Replace the item with the held imprint, consuming it. */
    | { readonly kind: "restore" };

/** An operation that changes the state: everything but a check or a rule change. */
export type Transform = Exclude<Op, { kind: "require" | "unprotect" | "keep" }>;

export type EldritchChange =
    /** That implicit set to a tier, one of `types` (the ember's pool). */
    | {
          readonly kind: "set";
          readonly side: EldritchSide;
          readonly tier: number;
          readonly types: readonly TypeId[];
      }
    /** One implicit up a tier, the other down; a Lesser lowered is removed
     *  (Orb of Conflict). */
    | { readonly kind: "conflict" }
    /** A corruption implicit replaces one of the item's implicits (a Vaal
     *  Orb, the Corruption Altar): an eldritch implicit may go. */
    | { readonly kind: "replaced" };

export type InfluenceChange =
    | { readonly kind: "set"; readonly key: InfluenceKey }
    | { readonly kind: "add"; readonly influence: Influence }
    /** Every set of the size the item has (the grove's randomise). */
    | { readonly kind: "randomise" };

/** Why an operation's precondition fails on the current state. */
export type PreconditionFailure =
    | {
          readonly kind: "wrongRarity";
          readonly needed: Rarity;
          readonly actual: ReadonlySet<Rarity>;
      }
    | { readonly kind: "noOpenSlot"; readonly gen?: Gen; readonly normal?: true }
    | { readonly kind: "magicRefused"; readonly actual: ReadonlySet<Rarity> }
    | { readonly kind: "normalRefused"; readonly actual: ReadonlySet<Rarity> }
    | {
          readonly kind: "modConflict";
          readonly group: string;
          /** The other modifiers of the group the item may carry, named so a craft
           *  can rule them out one by one. */
          readonly among: readonly string[];
          /** What cannot be done then, when it is not a bench craft. */
          readonly refusal?: string;
      }
    | { readonly kind: "nothingToRemove" }
    | {
          readonly kind: "essenceRarity";
          readonly tier: number;
          readonly actual: ReadonlySet<Rarity>;
      }
    | { readonly kind: "essenceClass"; readonly essence: string; readonly itemClass: ClassId }
    | { readonly kind: "rarityUnsupported"; readonly rarity: Rarity }
    | { readonly kind: "craftedLimit"; readonly cap: number; readonly refusal?: string }
    | { readonly kind: "noCraftedToRemove" }
    | { readonly kind: "craftedFractured" }
    /** `every`: every item breaking the check has more than one. */
    | { readonly kind: "craftedMultiple"; readonly every?: true }
    | { readonly kind: "harvestEmptyPool"; readonly tag: TagId }
    | { readonly kind: "harvestNoRoom"; readonly tag: TagId }
    /** `every`: every item breaking the check is blocked. */
    | { readonly kind: "harvestBlocked"; readonly tag: TagId; readonly every?: true }
    /** Every tagged row is one a cannot-roll metamod on the item bars. */
    | { readonly kind: "harvestCannotRoll"; readonly tag: TagId }
    | { readonly kind: "metamodBlocks" }
    | { readonly kind: "fossilBaseRestricted"; readonly fossil: string }
    | { readonly kind: "wrongBase"; readonly needed: string }
    | { readonly kind: "itemLevelTooLow"; readonly level: number; readonly what: string }
    | { readonly kind: "noMetamodFits" }
    | { readonly kind: "noImprint" }
    | { readonly kind: "notImprintable" }
    | {
          readonly kind: "typeNotRemovable";
          readonly mod: string;
          readonly why: "absent" | "fractured" | "protected" | "kept";
          /** The reason holds on every item reaching the check. */
          readonly every?: true;
      }
    | { readonly kind: "tooFewMods"; readonly needed: number; readonly what?: string }
    | { readonly kind: "alreadyFractured"; readonly what?: string }
    | { readonly kind: "corrupted" }
    | { readonly kind: "notCorruptedItem"; readonly what: string }
    | { readonly kind: "twiceCorrupted"; readonly what: string }
    | { readonly kind: "influenced"; readonly what: string }
    | {
          readonly kind: "notInfluenced";
          readonly what: string;
          readonly influence?: Influence;
      }
    | { readonly kind: "notInfluenceable"; readonly influence: Influence; readonly what: string }
    | { readonly kind: "eldritchPresent"; readonly what: string }
    | { readonly kind: "notDominant"; readonly side: EldritchSide; readonly what: string }
    | { readonly kind: "notBothEldritch" }
    | { readonly kind: "sideProtected"; readonly gen: Gen; readonly what: string }
    | { readonly kind: "tooFewInfluenced"; readonly needed: number; readonly have: number }
    | { readonly kind: "influencedOnProtected"; readonly what: string; readonly gen: Gen }
    | { readonly kind: "noVeiledMod" }
    | { readonly kind: "alreadyVeiled" }
    | { readonly kind: "veiledWouldSurvive" }
    | { readonly kind: "unveilNotAvailable"; readonly mod: string }
    | { readonly kind: "unveilNotGuaranteed"; readonly mod: string; readonly options: number }
    /** The operation can do nothing on some item it reaches (`op` its kind:
     *  a fill with no modifier left that fits, a removal with none in reach).
     *  Reported by the exact checker. */
    | { readonly kind: "noOutcome"; readonly op: string };
