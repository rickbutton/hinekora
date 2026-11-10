/**
 * The surface vocabulary outside the method table: every word the parser gives
 * meaning to by position (the lexer emits only idents) that is not a crafting
 * method's word. The methods' words live in the core's method table, which the
 * parser, completion, hover and the docs check read, so a word cannot be
 * accepted, offered or documented without the others knowing.
 */
import { ELDRITCH_TIERS, INFLUENCES, type Rarity } from "@hinekora/core";

/** Words that open the item block, a statement or a def. */
export const KEYWORDS = ["item", "def", "until", "if", "else", "restart", "stop"] as const;

/** Predicate connectives and the predicate symbols. */
export const PREDICATE_WORDS = [
    "has",
    "group",
    "fractured",
    "influenced",
    "dominant",
    "not",
    "and",
    "or",
] as const;
export const RARITY_PREDICATES: Readonly<Record<string, Rarity>> = {
    isNormal: "normal",
    isMagic: "magic",
    isRare: "rare",
};
export const PROJECTIONS = ["prefixCount", "suffixCount"] as const;
/** The marks an item-block affix may carry before its name. */
export const AFFIX_MARKS = ["fractured", "bench"] as const;

/** The item block's fields; `corrupted` is also the predicate of that name. */
export const ITEM_FIELDS = [
    "base",
    "ilvl",
    "strands",
    "rarity",
    "prefixes",
    "suffixes",
    "influences",
    "corrupted",
    "exarch",
    "eater",
    "enchant",
] as const;
export const RARITY_WORDS = ["normal", "magic", "rare"] as const;
/** The six influences, as `influences:` lists them and `influenced` names one. */
export const INFLUENCE_WORDS = INFLUENCES;
/** The six eldritch tiers, as `exarch:` and `eater:` name them. */
export const ELDRITCH_TIER_WORDS = ELDRITCH_TIERS;

/** Every word above, for the docs check and the grammar. */
export const VOCABULARY: readonly string[] = [
    ...KEYWORDS,
    ...PREDICATE_WORDS,
    ...Object.keys(RARITY_PREDICATES),
    ...PROJECTIONS,
    ...ITEM_FIELDS,
    ...RARITY_WORDS,
    ...INFLUENCE_WORDS,
    ...ELDRITCH_TIER_WORDS,
];
