/**
 * The words players use for a modifier where the game's wording differs enough
 * that word matching cannot bridge them: an abbreviation shorter than the
 * three letters a prefix match needs, a different word, or a noun the game
 * writes as a verb. Each entry is rewritten inside a name before matching, so
 * "max es" reads as "max energy shield" and "+1 gems" as "+1 level of all skill
 * gems". Words a prefix already reaches ("max", "res", "crit multi", "phys",
 * "ele") need no entry. An entry may name the words that hold it back:
 * "gems" is the skill gem level unless the query says "socketed".
 */
import type { WordingAliasEntry } from "@hinekora/core";

export const COMMUNITY_ALIASES: Readonly<Record<string, WordingAliasEntry>> = {
    "spell suppression": "chance to suppress spell damage",
    suppression: "chance to suppress spell damage",
    es: "energy shield",
    ms: "movement speed",
    ias: "attack speed",
    dot: "damage over time",
    dmg: "damage",
    armor: "armour",
    flat: "adds",
    gems: { to: "level of all skill gems", unless: ["socketed"] },
    // The bench's full protections read "Prefix Modifiers cannot be changed"
    // since 3.30; players and guides keep the older "Prefixes Cannot Be Changed".
    prefixes: "prefix modifiers",
    suffixes: "suffix modifiers",
};
