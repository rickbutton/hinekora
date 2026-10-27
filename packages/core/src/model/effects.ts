/**
 * The effects layer (item-model.md §6). Carrier mods contribute effects —
 * modifications to the operation rules, active while the carrier is present.
 * Effects are DERIVED, never stored: `effects(it)` recomputes from the present
 * mods, so removing a carrier drops its effects for free and desync is
 * impossible. The ingested data carries no effects; the metamod effects are
 * curated in `metamods.ts` and attached to the catalog when the registry is built.
 */
import type { Gen } from "./ids.js";
import type { Item } from "./item.js";
import { affixes } from "./item.js";
import type { Mod } from "./mod.js";

/** What an effect does to the rules: the three kinds the five metamods need. */
export type Effect =
    | { readonly kind: "poolRestrict"; readonly allows: (m: Mod) => boolean } // shrink add-side pool
    | { readonly kind: "protect"; readonly gen: Gen } // shield a generation from removal and reroll
    | { readonly kind: "craftedCap"; readonly cap: number }; // raise the crafted-mod limit ("multimod")

/** The effects a single mod carries (usually none). */
export function effectsOf(m: Mod): readonly Effect[] {
    return m.effects ?? [];
}

/** All effects active right now: the union over present carriers. */
export function effects(it: Item): readonly Effect[] {
    return affixes(it).flatMap(effectsOf);
}

// --- Folds the pool and wf formulas consume -------------------------------

/** Filter to one discriminant arm; the type-predicate + `Extract` recovers the
 *  specific arm type that plain `filter` would lose. */
function ofKind<K extends Effect["kind"]>(
    es: readonly Effect[],
    kind: K,
): readonly Extract<Effect, { kind: K }>[] {
    return es.filter((e): e is Extract<Effect, { kind: K }> => e.kind === kind);
}

/** Combined pool-restrict predicate: active restricts AND together. */
export function poolRestrictPredicate(it: Item): (m: Mod) => boolean {
    const restricts = ofKind(effects(it), "poolRestrict");
    return (m: Mod) => restricts.every((e) => e.allows(m));
}

/** The crafted-mod limit under a set of effects: the max `craftedCap` if any
 *  ("Can have up to 3 Crafted Modifiers"), else the base limit of one. */
export function craftedCapOf(es: readonly Effect[]): number {
    return ofKind(es, "craftedCap").reduce((cap, e) => Math.max(cap, e.cap), 1);
}

/** Does some active `protect` effect shield mod `m` from removal? */
export function isProtected(it: Item, m: Mod): boolean {
    return ofKind(effects(it), "protect").some((e) => e.gen === m.gen);
}

/**
 * The affixes a random removal may actually take: present affixes minus those
 * shielded by an active protection effect. Protection targets whatever occupies
 * the generation at the time, so it removes those affixes' arms from the sum.
 */
export function removable(it: Item): readonly Mod[] {
    return affixes(it).filter((m) => !isProtected(it, m));
}
