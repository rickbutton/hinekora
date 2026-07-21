/**
 * The effects layer (typing rules §9). Carrier mods contribute effects —
 * modifications to the operation rules, active while the carrier is present.
 * Effects are DERIVED, never stored: `effects(it)` recomputes from the present
 * mods, so removing a carrier drops its effects for free and desync is
 * impossible. No current data carries an effect, so every fold reduces to base
 * behavior — but through the real code path `pool` and `wf` consume.
 */
import type { Gen, ModId } from "./ids.js";
import type { Item } from "./item.js";
import { affixes } from "./item.js";
import type { Mod } from "./mod.js";

/** What an effect does to the rules. `OpUnlock` is not folded anywhere yet. */
export type Effect =
    | { readonly kind: "poolRestrict"; readonly allows: (m: Mod) => boolean } // shrink add-side pool
    | { readonly kind: "poolWiden"; readonly mods: ReadonlySet<Mod> } // grow add-side pool
    | { readonly kind: "protect"; readonly target: ProtectTarget } // shrink remove-side sum
    | { readonly kind: "slotDelta"; readonly gen: Gen; readonly delta: number } // shift wf slot cap
    | { readonly kind: "craftedCap"; readonly cap: number } // raise the crafted-mod limit ("multimod")
    | { readonly kind: "opUnlock"; readonly capability: string }; // make an op legal

/** What a `Protect` effect shields from removal: a whole generation, or specific mods. */
export type ProtectTarget =
    | { readonly by: "gen"; readonly gen: Gen }
    | { readonly by: "mods"; readonly mods: ReadonlySet<ModId> };

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

/** The extra candidate mods pool-widen effects add (unioned). */
export function poolWidenMods(it: Item): readonly Mod[] {
    return ofKind(effects(it), "poolWiden").flatMap((e) => [...e.mods]);
}

/** Net slot-cap shift for a generation from `SlotDelta` effects (summed). */
export function slotDelta(it: Item, gen: Gen): number {
    return ofKind(effects(it), "slotDelta")
        .filter((e) => e.gen === gen)
        .reduce((sum, e) => sum + e.delta, 0);
}

/** The crafted-mod limit under a set of effects: the max `craftedCap` if any
 *  ("Can have up to 3 Crafted Modifiers"), else the base limit of one. */
export function craftedCapOf(es: readonly Effect[]): number {
    return ofKind(es, "craftedCap").reduce((cap, e) => Math.max(cap, e.cap), 1);
}

/** Does some active `Protect` effect shield mod `m` from removal? */
function protectMatches(target: ProtectTarget, m: Mod): boolean {
    return target.by === "gen" ? m.gen === target.gen : target.mods.has(m.id);
}

export function isProtected(it: Item, m: Mod): boolean {
    return ofKind(effects(it), "protect").some((e) => protectMatches(e.target, m));
}

/**
 * The affixes a random removal may actually take: present affixes minus those
 * shielded by an active protection effect. Protection targets active MODS, not
 * slots — it removes the protected mods' arms from the outcome sum.
 */
export function removable(it: Item): readonly Mod[] {
    return affixes(it).filter((m) => !isProtected(it, m));
}
