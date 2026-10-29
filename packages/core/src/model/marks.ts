/**
 * The item-level marks (item-model.md §7): the influences and corruption. An
 * influence is a tag family in the data, `<class>_<influence>` on every row the
 * influence adds to a class's pool, so an influenced item is the base's tags
 * plus those; the checker tracks the set of influence sets the item may have.
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

export function isInfluence(word: string): word is Influence {
    return (INFLUENCES as readonly string[]).includes(word);
}

/**
 * One set of influences as a canonical key: the names in the game's order
 * joined with `+`, the empty string for none. The abstract item holds a set of
 * these, the influence sets it may have.
 */
export type InfluenceKey = string;

export function influenceKey(influences: Iterable<Influence>): InfluenceKey {
    const set = new Set(influences);
    return INFLUENCES.filter((i) => set.has(i)).join("+");
}

export function influencesOf(key: InfluenceKey): Influence[] {
    return key === "" ? [] : (key.split("+") as Influence[]);
}

/** The influence tags an influence adds to a base: the base's class tags with
 *  the influence's suffix, kept to those some row's spawn table names. */
export function influenceTags(
    base: Base,
    influence: Influence,
    spawnTags: ReadonlySet<TagId>,
): Set<TagId> {
    const out = new Set<TagId>();
    for (const t of base.tags) {
        const tag = TagId(`${t}_${TAG_SUFFIX[influence]}`);
        if (spawnTags.has(tag)) out.add(tag);
    }
    return out;
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
    const named = [...keys].filter((k) => k !== "").sort();
    return [...named, ...(keys.has("") ? [""] : [])].map(influenceSetLabel).join(" or ");
}
