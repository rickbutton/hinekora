/**
 * `pool(catalog, it)` — the candidate pool (typing rules §3), the dependent
 * `Value -> Set` computation refinements can't express: given a *known* item,
 * which mods can be added to it, and at what weight.
 *
 * INTENSIONALITY (the load-bearing rule, brief §2/§4). This function returns a
 * bounded list of candidate *descriptors* — (mod, weight) pairs — NOT a list of
 * item states. That distinction is the whole performance story:
 *
 *   - Enumerating the ~100–200 candidate MODS once, per step, is fine: it is
 *     the cheap bounded computation the brief's §4 budgets in microseconds.
 *   - What must NEVER happen is materializing the OUTCOME UNION — the ~200
 *     resulting item states — and then taking the product across chained ops
 *     (200 -> 200² -> 200³ …). That blows up in any language.
 *
 * So `pool` produces the *ingredients* an outcome union is described by; the
 * union itself (a later milestone) stays a symbolic delta — "prior item + one
 * mod drawn from `pool it`" — and narrowing filters that description by
 * membership against this candidate list. `pool` is the bounded per-step
 * computation; it is deliberately not where enumeration is forbidden.
 *
 * The mod universe (`catalog`) is passed in, not carried by the item: the core
 * is pure and takes loaded data as input (brief §3). The data package will feed
 * a real per-domain catalog later; tests feed a hardcoded mini set now.
 */
import type { ClassId, TagId } from "../model/ids.js";
import { poolRestrictPredicate, poolWidenMods } from "../model/effects.js";
import type { Item } from "../model/item.js";
import { presentFamilies, presentTypes } from "../model/item.js";
import type { Mod } from "../model/mod.js";
import { slotOpen } from "../model/wf.js";
import { isNonzero, type Weight } from "../model/weight.js";

/** The universe of mods `pool` draws from — the loaded catalog for this context. */
export type ModCatalog = readonly Mod[];

/**
 * One candidate: a mod that CAN be added, paired with the weight at which it
 * rolls on this base. The intensional building block of the add-side outcome
 * union.
 */
export interface PoolCandidate {
    readonly mod: Mod;
    readonly weight: Weight;
}

/**
 * Resolve a mod's spawn weight against a base's tags (typing rules §3
 * "lookupWeight m it.base.tags"). Spawn entries are ordered and FIRST MATCH
 * WINS: the first entry whose tag the base carries decides the weight. This
 * ordering is meaningful — an early zero-weight entry DISABLES the mod for
 * bases carrying that tag, even if a later entry would have allowed it.
 *
 * Returns `null` when no spawn tag matches the base at all: the mod simply
 * cannot roll here (treated as ineligible by `pool`).
 */
export function lookupWeight(m: Mod, baseTags: ReadonlySet<TagId>): Weight | null {
    for (const entry of m.spawn) {
        if (baseTags.has(entry.tag)) return entry.weight;
    }
    return null;
}

/** Class restriction (typing rules §3 "classPermitted"): unrestricted, or base's class allowed. */
function classPermitted(m: Mod, itemClass: ClassId): boolean {
    return m.classRestriction === undefined || m.classRestriction.has(itemClass);
}

/**
 * The candidate pool for `it`, drawn from `catalog`.
 *
 * Each clause below is one line of the §3 set-comprehension. A mod is a
 * candidate iff it passes ALL of them.
 */
export function pool(catalog: ModCatalog, it: Item): readonly PoolCandidate[] {
    const restrict = poolRestrictPredicate(it); // pool-restrict effects shrink the set
    const widen = poolWidenMods(it); // pool-widen effects grow it

    // Range over (Mod ∪ widen), de-duplicated by id so a widen mod already in
    // the catalog isn't offered twice.
    const universe = dedupeById([...catalog, ...widen]);

    const presentT = presentTypes(it);
    const presentF = presentFamilies(it);

    const candidates: PoolCandidate[] = [];
    for (const m of universe) {
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
        const weight = lookupWeight(m, it.base.tags);
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

function dedupeById(mods: readonly Mod[]): readonly Mod[] {
    const seen = new Set<string>();
    const out: Mod[] = [];
    for (const m of mods) {
        if (seen.has(m.id)) continue;
        seen.add(m.id);
        out.push(m);
    }
    return out;
}
