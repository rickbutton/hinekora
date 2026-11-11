/**
 * The influence sets an item of a base can have, and the tags each adds: what
 * the influence slot ranges over, and the tag sets a name or a pool is read
 * under.
 */
import type { Base } from "../model/base.js";
import type { TagId } from "../model/ids.js";
import {
    INFLUENCE_STEMS,
    type InfluenceKey,
    influenceKey,
    influenceSetsOfSize,
    influencesOf,
    INFLUENCES,
    NO_INFLUENCE,
} from "../model/marks.js";
import type { Registry } from "../resolve/registry.js";

/** Every one on the Astrolabe, none on a class no influence marks, else none,
 *  one or two (reference/wellformed.ts; item-model.md §8 "Influence limit"). */
export function influenceKeysFor(base: Base): InfluenceKey[] {
    if (base.allInfluences) return [influenceKey(INFLUENCES)];
    if (INFLUENCE_STEMS[base.itemClass] === undefined) return [NO_INFLUENCE];
    return [0, 1, 2].flatMap(influenceSetsOfSize);
}

/** The tags an influence set adds to the base. */
export function influenceTagsOfKey(
    registry: Registry,
    base: Base,
    key: InfluenceKey,
): ReadonlySet<TagId> {
    const out = new Set<TagId>();
    for (const i of influencesOf(key)) for (const t of registry.influenceTags(base, i)) out.add(t);
    return out;
}
