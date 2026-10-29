/**
 * The surface vocabulary in one place: every word the parser gives meaning to
 * by position (the lexer emits only idents). The parser, completion and the
 * docs check read these tables, so a word cannot be accepted, offered or
 * documented without the others knowing.
 */
import type { Rarity } from "@hinekora/core";

/** Words that open a statement or a header: `craft in`, `item`, control flow, defs. */
export const KEYWORDS = [
    "craft",
    "in",
    "item",
    "def",
    "until",
    "if",
    "else",
    "restart",
    "essence",
    "bench",
    "harvest",
    "veiled",
    "unveil",
    "foulborn",
    "fossil",
    "beast",
] as const;

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

/** The second word of `harvest <verb>` and `veiled <verb>`. */
export const HARVEST_VERBS: readonly HarvestVerb[] = ["reforge", "augment", "change"];
export const VEILED_VERBS: readonly VeiledVerb[] = ["chaos", "exalt"];
/** The second word of `beast <verb>`. */
export const BEAST_VERBS = ["add", "fracture", "metamod"] as const;
/** The side `beast add` names. */
export const SIDE_WORDS = ["prefix", "suffix"] as const;
/** The second word of `bench remove`. */
export const BENCH_VERBS = ["remove"] as const;
/** The second word of `foulborn <verb>`: the plain orb it mirrors. */
export const FOULBORN_VERBS: readonly FoulbornVerb[] = ["augment", "regal", "exalt"];
export type HarvestVerb = "reforge" | "augment" | "change";
export type VeiledVerb = "chaos" | "exalt";
export type FoulbornVerb = "augment" | "regal" | "exalt";

/** Every word above, for the docs check and the grammar. */
export const VOCABULARY: readonly string[] = [
    ...KEYWORDS,
    ...PREDICATE_WORDS,
    ...Object.keys(RARITY_PREDICATES),
    ...PROJECTIONS,
    ...ITEM_FIELDS,
    ...RARITY_WORDS,
    GAME,
    ...HARVEST_VERBS,
    ...VEILED_VERBS,
    ...FOULBORN_VERBS,
    ...BENCH_VERBS,
    ...BEAST_VERBS,
    ...SIDE_WORDS,
];
