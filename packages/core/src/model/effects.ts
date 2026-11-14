/**
 * The effects layer (item-model.md §6). Carrier mods contribute effects —
 * modifications to the operation rules, active while the carrier is present.
 * Effects are DERIVED, never stored: they are recomputed from the present
 * mods, so removing a carrier drops its effects for free and desync is
 * impossible. The ingested data carries no effects; the metamod effects are
 * curated in `metamods.ts` and attached to the catalog when the registry is built.
 */
import type { Gen } from "./ids.js";
import type { Mod } from "./mod.js";

/** What an effect does to the rules. */
export type Effect =
    | { readonly kind: "poolRestrict"; readonly allows: (m: Mod) => boolean } // shrink add-side pool
    | { readonly kind: "protect"; readonly gen: Gen } // shield a generation from removal and reroll
    /** Shield `count` of the side's modifiers, chosen at random each time a
     *  currency is used ("1 Prefix Modifier cannot be changed"). */
    | { readonly kind: "protectSome"; readonly gen: Gen; readonly count: number }
    | { readonly kind: "craftedCap"; readonly cap: number }; // raise the crafted-mod limit ("multimod")

/** The effects a single mod carries (usually none). */
export function effectsOf(m: Mod): readonly Effect[] {
    return m.effects ?? [];
}

// --- Folds the pool and the checker consume --------------------------------

/** Filter to one discriminant arm; the type-predicate + `Extract` recovers the
 *  specific arm type that plain `filter` would lose. */
function ofKind<K extends Effect["kind"]>(
    es: readonly Effect[],
    kind: K,
): readonly Extract<Effect, { kind: K }>[] {
    return es.filter((e): e is Extract<Effect, { kind: K }> => e.kind === kind);
}

/** Combined pool-restrict predicate: active restricts AND together. */
export function poolRestrictPredicate(es: readonly Effect[]): (m: Mod) => boolean {
    const restricts = ofKind(es, "poolRestrict");
    return (m: Mod) => restricts.every((e) => e.allows(m));
}

/** The crafted-mod limit under a set of effects: the max `craftedCap` if any
 *  ("Can have up to 3 Crafted Modifiers"), else the base limit of one. */
export function craftedCapOf(es: readonly Effect[]): number {
    return ofKind(es, "craftedCap").reduce((cap, e) => Math.max(cap, e.cap), 1);
}

const restricts = new WeakMap<(m: Mod) => boolean, number>();
let restrictCount = 0;

/** A name for an effect by what it does: two rows carrying equal effects share it. */
export function effectKey(e: Effect): string {
    switch (e.kind) {
        case "protect":
            return `protect:${e.gen}`;
        case "protectSome":
            return `protect:${e.gen}:${e.count}`;
        case "craftedCap":
            return `cap:${e.cap}`;
        case "poolRestrict": {
            let id = restricts.get(e.allows);
            if (id === undefined) restricts.set(e.allows, (id = ++restrictCount));
            return `restrict:${id}`;
        }
    }
}

export function effectsKey(effects: readonly Effect[]): string {
    return [...new Set(effects.map(effectKey))].sort().join("|");
}

/** Which metamod a bench row is, undefined for a row that carries no effect.
 *  The bench crafts one metamod by a row per group of item classes, rows that
 *  differ only in id, classes and cost, so nothing on an item tells them
 *  apart; the key holds all else the model reads of a row. */
export function metamodKey(m: Mod): string | undefined {
    if (m.source !== "bench" || effectsOf(m).length === 0) return undefined;
    return [m.type, m.gen, [...m.families].sort().join(","), effectsKey(effectsOf(m))].join("|");
}
