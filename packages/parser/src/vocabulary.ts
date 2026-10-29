/**
 * The surface vocabulary outside the method table: every word the parser gives
 * meaning to by position (the lexer emits only idents) that is not a crafting
 * method's word. The methods' words live in the core's method table, which the
 * parser, completion, hover and the docs check read, so a word cannot be
 * accepted, offered or documented without the others knowing.
 */
import type { Rarity } from "@hinekora/core";

/** Words that open a statement or a header: `craft in`, `item`, control flow, defs. */
export const KEYWORDS = ["craft", "in", "item", "def", "until", "if", "else", "restart"] as const;

/** Predicate connectives and the predicate symbols. */
export const PREDICATE_WORDS = ["has", "fractured", "not", "and", "or"] as const;
export const RARITY_PREDICATES: Readonly<Record<string, Rarity>> = {
    isNormal: "normal",
    isMagic: "magic",
    isRare: "rare",
};
export const PROJECTIONS = ["prefixCount", "suffixCount"] as const;

/** The item block's fields. */
export const ITEM_FIELDS = ["base", "ilvl", "rarity", "prefixes", "suffixes"] as const;
export const RARITY_WORDS = ["normal", "magic", "rare"] as const;
/** The one word the header accepts after `craft in`. */
export const GAME = "poe1";

/** Every word above, for the docs check and the grammar. */
export const VOCABULARY: readonly string[] = [
    ...KEYWORDS,
    ...PREDICATE_WORDS,
    ...Object.keys(RARITY_PREDICATES),
    ...PROJECTIONS,
    ...ITEM_FIELDS,
    ...RARITY_WORDS,
    GAME,
];
