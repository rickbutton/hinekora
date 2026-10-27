/**
 * `pool(catalog, it)`, the candidate pool (ARCHITECTURE.md §3): given a known
 * item, which mods can be added, at what weight. It returns candidate
 * descriptors, (mod, weight) pairs, a cheap bounded scan, not item states;
 * the outcome union stays a symbolic delta over this list (the
 * intensional-union rule, CLAUDE.md). The catalog is passed in because the
 * core is pure and takes loaded data as input.
 */
import type { ClassId, TagId } from "../model/ids.js";
import { poolRestrictPredicate } from "../model/effects.js";
import type { Item } from "../model/item.js";
import { affixes, presentFamilies, presentTypes } from "../model/item.js";
import type { Mod } from "../model/mod.js";
import { slotOpen } from "../model/wf.js";
import { isNonzero, type Weight } from "../model/weight.js";

/** The universe of mods `pool` draws from, the loaded catalog for this context. */
export type ModCatalog = readonly Mod[];

/** One candidate: a mod that can be added, with the weight it rolls at here. */
export interface PoolCandidate {
    readonly mod: Mod;
    readonly weight: Weight;
}

/**
 * Resolve a mod's spawn weight against a base's tags. Spawn entries are
 * ordered and FIRST MATCH WINS, an early zero-weight entry disables the mod
 * for bases carrying that tag even if a later entry would allow it. `null`
 * when no spawn tag matches at all (the mod cannot roll here).
 */
export function lookupWeight(
    m: Mod,
    tags: ReadonlySet<TagId>,
    maybeTags?: ReadonlySet<TagId>,
): Weight | null {
    for (const entry of m.spawn) {
        if (tags.has(entry.tag)) return entry.weight;
        // A tag the item may carry can only ever help: a positive entry on it
        // counts, a zero entry on it is skipped, so the answer covers both cases.
        if (maybeTags?.has(entry.tag) && isNonzero(entry.weight)) return entry.weight;
    }
    return null;
}

/** The tags a roll matches against: the base's own plus those every present
 *  modifier adds to the item (Modifier § Tags), which is how a weapon-specific
 *  jewel modifier zeroes every other one's weight once it is on the item. */
export function itemTags(it: Item): ReadonlySet<TagId> {
    const tags = new Set(it.base.tags);
    for (const m of affixes(it)) for (const t of m.addsTags) tags.add(t);
    return tags;
}

/** Class restriction: unrestricted, or the base's class is allowed. */
function classPermitted(m: Mod, itemClass: ClassId): boolean {
    return m.classRestriction === undefined || m.classRestriction.has(itemClass);
}

/**
 * The candidate pool for `it`: a mod is a candidate iff it passes every clause.
 */
export function pool(
    catalog: ModCatalog,
    it: Item,
    maybeTags?: ReadonlySet<TagId>,
): readonly PoolCandidate[] {
    const restrict = poolRestrictPredicate(it); // pool-restrict effects shrink the set

    const presentT = presentTypes(it);
    const presentF = presentFamilies(it);
    const tags = itemTags(it);

    const candidates: PoolCandidate[] = [];
    for (const m of catalog) {
        // domain partition
        if (m.domain !== it.base.domain) continue;
        // tier gate
        if (m.minLevel > it.ilvl) continue;
        // item-class restriction
        if (!classPermitted(m, it.base.itemClass)) continue;
        // (1) no duplicate ModType
        if (presentT.has(m.type)) continue;
        // (2) family mutual-exclusion
        if (!disjoint(m.families, presentF)) continue;
        // (3) slot cardinality (effect-adjusted caps)
        if (!slotOpen(it, m.gen)) continue;
        // pool-restrict effects
        if (!restrict(m)) continue;
        // eligibility: a matching, nonzero spawn weight
        const weight = lookupWeight(m, tags, maybeTags);
        if (weight === null || !isNonzero(weight)) continue;

        candidates.push({ mod: m, weight });
    }
    return candidates;
}

// --- small set helpers ----------------------------------------------------

function disjoint<T>(a: ReadonlySet<T>, b: ReadonlySet<T>): boolean {
    for (const x of a) {
        if (b.has(x)) return false;
    }
    return true;
}
