/**
 * The item-level marks (item-model.md §7): the influences and corruption. An
 * influence is a tag family in the data, `<class>_<influence>` on every row the
 * influence adds to a class's pool, so an influenced item is the base's tags
 * plus that one; the checker tracks the set of influence sets the item may have.
 */
import type { Base } from "./base.js";
import { TagId } from "./ids.js";

/** The six influences, in the game's order (Influenced item § Mechanics). */
export const INFLUENCES = ["shaper", "elder", "crusader", "hunter", "redeemer", "warlord"] as const;
export type Influence = (typeof INFLUENCES)[number];

/** The data's name for each influence in its spawn-weight tags. */
const TAG_SUFFIX: Readonly<Record<Influence, string>> = {
    shaper: "shaper",
    elder: "elder",
    crusader: "crusader",
    hunter: "basilisk",
    redeemer: "eyrie",
    warlord: "adjudicator",
};

/**
 * The stem of each item class's influence tags, which the data keys by class,
 * not by the base's own tags: a two-handed sword carries `sword` but its
 * influence rows spawn on `2h_sword_shaper`. One stem per class, as the game's
 * influence tag table has it; a class absent here cannot be influenced.
 * Curated from the stems the spawn tables name (`QUESTIONS.md` Q26).
 */
export const INFLUENCE_STEMS: Readonly<Record<string, string>> = {
    Amulet: "amulet",
    Ring: "ring",
    Belt: "belt",
    "Body Armour": "body_armour",
    Boots: "boots",
    Gloves: "gloves",
    Helmet: "helmet",
    Shield: "shield",
    Quiver: "quiver",
    Bow: "bow",
    Claw: "claw",
    Dagger: "dagger",
    "Rune Dagger": "rune_dagger",
    Wand: "wand",
    "One Hand Sword": "sword",
    "Thrusting One Hand Sword": "sword",
    "One Hand Axe": "axe",
    "One Hand Mace": "mace",
    Sceptre: "sceptre",
    Staff: "staff",
    Warstaff: "warstaff",
    "Two Hand Sword": "2h_sword",
    "Two Hand Axe": "2h_axe",
    "Two Hand Mace": "2h_mace",
};

export function isInfluence(word: string): word is Influence {
    return (INFLUENCES as readonly string[]).includes(word);
}

/** The orb that adds each influence (List of influence adding items). */
export const INFLUENCE_ORB: Readonly<Record<Influence, string>> = {
    shaper: "Shaper's Exalted Orb",
    elder: "Elder's Exalted Orb",
    crusader: "Crusader's Exalted Orb",
    hunter: "Hunter's Exalted Orb",
    redeemer: "Redeemer's Exalted Orb",
    warlord: "Warlord's Exalted Orb",
};

declare const keyBrand: unique symbol;
/**
 * One set of influences as a canonical key: the names in the game's order
 * joined with `+`, the empty string for none. The abstract item holds a set of
 * these, the influence sets it may have. Branded so a bare influence name is
 * not mistaken for the key of its singleton set.
 */
export type InfluenceKey = string & { readonly [keyBrand]: true };

export function influenceKey(influences: Iterable<Influence>): InfluenceKey {
    const set = new Set(influences);
    return INFLUENCES.filter((i) => set.has(i)).join("+") as InfluenceKey;
}

/** The key of the empty influence set. */
export const NO_INFLUENCE: InfluenceKey = influenceKey([]);

export function influencesOf(key: InfluenceKey): Influence[] {
    return key === NO_INFLUENCE ? [] : (key.split("+") as Influence[]);
}

/** Every influence set of `n` influences: what a randomise can leave an item
 *  that had `n` (six singletons, fifteen pairs). */
export function influenceSetsOfSize(n: number): InfluenceKey[] {
    if (n === 0) return [NO_INFLUENCE];
    if (n === 1) return INFLUENCES.map((i) => influenceKey([i]));
    const out: InfluenceKey[] = [];
    for (let i = 0; i < INFLUENCES.length; i++) {
        for (let j = i + 1; j < INFLUENCES.length; j++) {
            out.push(influenceKey([INFLUENCES[i]!, INFLUENCES[j]!]));
        }
    }
    return out;
}

/** The influence tag an influence adds to a base: its class's stem with the
 *  influence's suffix, when some row's spawn table names it. */
export function influenceTags(
    base: Base,
    influence: Influence,
    spawnTags: ReadonlySet<TagId>,
): Set<TagId> {
    const stem = INFLUENCE_STEMS[base.itemClass];
    if (stem === undefined) return new Set();
    const tag = TagId(`${stem}_${TAG_SUFFIX[influence]}`);
    return spawnTags.has(tag) ? new Set([tag]) : new Set();
}

/** The influence a spawn tag belongs to, with its stem, when it is one. */
export function influenceOfTag(tag: TagId): { stem: string; influence: Influence } | undefined {
    for (const influence of INFLUENCES) {
        const suffix = `_${TAG_SUFFIX[influence]}`;
        if (tag.endsWith(suffix)) return { stem: tag.slice(0, -suffix.length), influence };
    }
    return undefined;
}

const LABEL: Readonly<Record<Influence, string>> = {
    shaper: "Shaper",
    elder: "Elder",
    crusader: "Crusader",
    hunter: "Hunter",
    redeemer: "Redeemer",
    warlord: "Warlord",
};

/** "Hunter", "Shaper and Elder", "no influence". */
export function influenceSetLabel(key: InfluenceKey): string {
    const names = influencesOf(key).map((i) => LABEL[i]);
    return names.length === 0 ? "no influence" : names.join(" and ");
}

/** The influence sets an item may have, as "Hunter or Shaper and Elder", with
 *  "no influence" last. */
export function influenceLabel(keys: ReadonlySet<InfluenceKey>): string {
    const named = [...keys].filter((k) => k !== NO_INFLUENCE).sort();
    return [...named, ...(keys.has(NO_INFLUENCE) ? [NO_INFLUENCE] : [])]
        .map(influenceSetLabel)
        .join(" or ");
}
