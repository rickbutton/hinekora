/**
 * The surface vocabulary in one place: every word the parser gives meaning to
 * by position (the lexer emits only idents). The parser, completion and the
 * docs check read these tables, so a word cannot be accepted, offered or
 * documented without the others knowing.
 */
import type { Game, Rarity } from "@hinekora/core";

/** Words that open a statement or a header: `craft in`, `item`, control flow, defs. */
export const KEYWORDS = [
    "craft",
    "in",
    "item",
    "def",
    "until",
    "if",
    "else",
    "with",
    "omen",
    "restart",
    "essence",
    "bench",
    "harvest",
    "veiled",
    "unveil",
] as const;

/** Predicate connectives and the predicate symbols. */
export const PREDICATE_WORDS = ["has", "fractured", "not", "and", "or"] as const;
export const RARITY_PREDICATES: Readonly<Record<string, Rarity>> = {
    isNormal: "normal",
    isMagic: "magic",
    isRare: "rare",
};
export const PROJECTIONS = ["prefixCount", "suffixCount"] as const;

/** The item block's fields; `augments` and `quality` are accepted and ignored. */
export const ITEM_FIELDS = [
    "base",
    "ilvl",
    "rarity",
    "prefixes",
    "suffixes",
    "augments",
    "quality",
] as const;
export const RARITY_WORDS = ["normal", "magic", "rare"] as const;
export const GAMES: readonly Game[] = ["poe1", "poe2"];

/** The second word of `harvest <verb>` and `veiled <verb>`. */
export const HARVEST_VERBS: readonly HarvestVerb[] = ["reforge", "augment"];
export const VEILED_VERBS: readonly VeiledVerb[] = ["chaos", "exalt"];
export type HarvestVerb = "reforge" | "augment";
export type VeiledVerb = "chaos" | "exalt";

/** Every word above, for the docs check and the grammar. */
export const VOCABULARY: readonly string[] = [
    ...KEYWORDS,
    ...PREDICATE_WORDS,
    ...Object.keys(RARITY_PREDICATES),
    ...PROJECTIONS,
    ...ITEM_FIELDS,
    ...RARITY_WORDS,
    ...GAMES,
    ...HARVEST_VERBS,
    ...VEILED_VERBS,
];
