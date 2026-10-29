/**
 * `pool(catalog, it)`, the candidate pool (ARCHITECTURE.md §3): given the facts
 * of an item, which mods can be added, at what weight. It returns candidate
 * descriptors, (mod, weight) pairs, a cheap bounded scan, not item states;
 * the outcome union stays a symbolic delta over this list (the
 * intensional-union rule, CLAUDE.md). The catalog is passed in because the
 * core is pure and takes loaded data as input.
 */
import { maxTotal, sideCap } from "../model/capacity.js";
import { poolRestrictPredicate } from "../model/effects.js";
import type { ClassId, Gen, TagId } from "../model/ids.js";
import type { ItemFacts } from "../model/item.js";
import type { Mod } from "../model/mod.js";

/** The universe of mods `pool` draws from, the loaded catalog for this context. */
export type ModCatalog = readonly Mod[];

/** One candidate: a mod that can be added, with the weight it rolls at here. */
export interface PoolCandidate {
    readonly mod: Mod;
    readonly weight: number;
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
    pessimistic = false,
): number | null {
    for (const entry of m.spawn) {
        if (tags.has(entry.tag)) return entry.weight;
        // A tag the item may carry: read optimistically it only ever helps (a
        // positive entry counts, a zero is skipped), read pessimistically it
        // only ever hurts (a zero stops the row, a positive is skipped).
        if (maybeTags?.has(entry.tag) && (pessimistic ? entry.weight === 0 : entry.weight > 0)) {
            return entry.weight;
        }
    }
    return null;
}

/** Is there room for another affix of generation `gen`? Its side must be under
 *  its cap and the item under the combined cap. */
export function slotOpen(it: ItemFacts, gen: Gen): boolean {
    const count = gen === "prefix" ? it.prefixCount : it.suffixCount;
    return (
        count < sideCap(gen, it.rarity, it.base) &&
        it.prefixCount + it.suffixCount < maxTotal(it.rarity, it.base)
    );
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
    it: ItemFacts,
    maybeTags?: ReadonlySet<TagId>,
    pessimistic = false,
): readonly PoolCandidate[] {
    const restrict = poolRestrictPredicate(it.effects); // pool-restrict effects shrink the set

    const candidates: PoolCandidate[] = [];
    for (const m of catalog) {
        // domain partition
        if (m.domain !== it.base.domain) continue;
        // tier gate
        if (m.minLevel > it.ilvl) continue;
        // item-class restriction
        if (!classPermitted(m, it.base.itemClass)) continue;
        // (1) no duplicate ModType
        if (it.types.has(m.type)) continue;
        // (2) family mutual-exclusion
        if (!disjoint(m.families, it.families)) continue;
        // (3) slot cardinality (effect-adjusted caps)
        if (!slotOpen(it, m.gen)) continue;
        // pool-restrict effects
        if (!restrict(m)) continue;
        // eligibility: a matching, nonzero spawn weight
        const weight = lookupWeight(m, it.tags, maybeTags, pessimistic);
        if (weight === null || weight <= 0) continue;

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
