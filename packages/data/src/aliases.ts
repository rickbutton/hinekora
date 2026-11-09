/**
 * The words guides use for a modifier where the game's wording differs enough
 * that word matching cannot bridge them: an abbreviation shorter than the
 * three letters a prefix match needs, a different word, or a noun the game
 * writes as a verb. Each entry is rewritten inside a name before matching, so
 * "max es" reads as "max energy shield" and "+1 gems" as "+1 level of all skill
 * gems". Words a prefix already reaches ("max", "res", "crit multi", "phys",
 * "ele") need no entry.
 */
export const COMMUNITY_ALIASES: Readonly<Record<string, string>> = {
    "spell suppression": "chance to suppress spell damage",
    suppression: "chance to suppress spell damage",
    es: "energy shield",
    ms: "movement speed",
    ias: "attack speed",
    dot: "damage over time",
    dmg: "damage",
    armor: "armour",
    flat: "adds",
    gems: "level of all skill gems",
};
