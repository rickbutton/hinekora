/**
 * The effects layer (typing rules §9), M1 slice.
 *
 * Certain carriers (affix mods, later socket augments) contribute *effects* —
 * typed modifications to the operation rules, active only while the carrier is
 * present. Effects are DERIVED, never stored: `effects(it)` recomputes from
 * whatever mods are present, so removing a carrier drops its effects for free
 * and desync is impossible (§2).
 *
 * The full `Effect` union and the §9 lifecycle (placeMeta/removeMeta,
 * slot-cardinality reversion) belong to a later milestone. What M1 needs is the
 * SEAM: `pool` (§3) reads pool-restrict / pool-widen effects, and `wf` (§2.1)
 * reads slot-cardinality deltas. We implement those folds now so the pool and
 * wf formulas are faithful. Since no M1 fixture carries an effect, every fold
 * currently reduces to base behavior — but through the real code path.
 */
import type { Gen, ModId } from "./ids.js";
import type { Item } from "./item.js";
import { affixes } from "./item.js";
import type { Mod } from "./mod.js";

/**
 * WHAT an effect does to the rules. The full §9 vocabulary; M1 folds the first
 * four and leaves `OpUnlock` (an operation-precondition effect) for the
 * currency-op milestone.
 */
export type Effect =
    | { readonly kind: "poolRestrict"; readonly allows: (m: Mod) => boolean } // shrink add-side pool
    | { readonly kind: "poolWiden"; readonly mods: ReadonlySet<Mod> } // grow add-side pool
    | { readonly kind: "protect"; readonly target: ProtectTarget } // shrink remove-side sum
    | { readonly kind: "slotDelta"; readonly gen: Gen; readonly delta: number } // shift wf slot cap
    | { readonly kind: "opUnlock"; readonly capability: string }; // make an op legal

/** What a `Protect` effect shields from removal: a whole generation, or specific mods. */
export type ProtectTarget =
    | { readonly by: "gen"; readonly gen: Gen }
    | { readonly by: "mods"; readonly mods: ReadonlySet<ModId> };

/**
 * The effects a single mod carries (often none). A static per-mod lookup from
 * the data; here, an optional field on the mod (see `Mod.effects`).
 */
export function effectsOf(m: Mod): readonly Effect[] {
    return m.effects ?? [];
}

/**
 * All effects active on the item right now: the union over present carriers.
 * (M1 models affix carriers only; augment carriers arrive with the augment
 * layer and would union in here identically.)
 */
export function effects(it: Item): readonly Effect[] {
    return affixes(it).flatMap(effectsOf);
}

// --- Folds the pool and wf formulas consume -------------------------------

/**
 * Filter an effect list to one discriminant arm, narrowing the element type.
 * `filter` alone would leave the elements typed as the whole `Effect` union
 * (TS can't infer the narrowing), so we use a type-predicate and `Extract` to
 * recover the specific arm — that is what lets `e.allows` / `e.mods` / `e.delta`
 * type-check below.
 */
function ofKind<K extends Effect["kind"]>(
    es: readonly Effect[],
    kind: K,
): readonly Extract<Effect, { kind: K }>[] {
    return es.filter((e): e is Extract<Effect, { kind: K }> => e.kind === kind);
}

/**
 * Combined pool-restrict predicate: a candidate must satisfy ALL active
 * restricts (they AND together). With no restricts active, accepts everything.
 */
export function poolRestrictPredicate(it: Item): (m: Mod) => boolean {
    const restricts = ofKind(effects(it), "poolRestrict");
    return (m: Mod) => restricts.every((e) => e.allows(m));
}

/**
 * The extra candidate mods pool-widen effects add. Multiple widens union
 * together. With none active, empty.
 */
export function poolWidenMods(it: Item): readonly Mod[] {
    return ofKind(effects(it), "poolWiden").flatMap((e) => [...e.mods]);
}

/**
 * Net slot-cap shift for a generation from `SlotDelta` effects (typing rules
 * §9.4 "+1 suffix"). Summed; with none active, 0.
 */
export function slotDelta(it: Item, gen: Gen): number {
    return ofKind(effects(it), "slotDelta")
        .filter((e) => e.gen === gen)
        .reduce((sum, e) => sum + e.delta, 0);
}

/** Does some active `Protect` effect shield mod `m` from removal? */
function protectMatches(target: ProtectTarget, m: Mod): boolean {
    return target.by === "gen" ? m.gen === target.gen : target.mods.has(m.id);
}

export function isProtected(it: Item, m: Mod): boolean {
    return ofKind(effects(it), "protect").some((e) => protectMatches(e.target, m));
}

/**
 * The affixes an Annul (or any random removal) may actually take: present
 * affixes MINUS those shielded by an active protection effect (typing rules
 * §4.4 `removable it = affixes it \ protected(...)`). Protection targets active
 * MODS, not slots — so it turns a risky Annul into a safe one by removing the
 * protected mods' arms from the outcome sum. With no protection active,
 * `removable(it) == affixes(it)`.
 */
export function removable(it: Item): readonly Mod[] {
    return affixes(it).filter((m) => !isProtected(it, m));
}
