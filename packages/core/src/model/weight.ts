/**
 * Spawn weight, provenance-tagged.
 *
 * Weight is probability-only data — the type checker never reads the magnitude,
 * only whether a weight is *nonzero* (eligibility). But we tag every weight
 * with where it came from, because the deferred cost/probability layer (brief
 * §6) needs to know how much to trust a number:
 *
 *   - Known n   — PoE1 shipped ground truth (the dat files give exact weights).
 *   - Approx n  — PoE2 trade-inferred estimate.
 *   - Unknown   — PoE2 sentinel: "this can roll, but the odds are unknown".
 *
 * The provenance is carried now, unused by M1's logic beyond `isNonzero`, so we
 * never have to retrofit it into the model later.
 */

export type Weight =
    | { readonly kind: "known"; readonly value: number }
    | { readonly kind: "approx"; readonly value: number }
    | { readonly kind: "unknown" };

export const known = (value: number): Weight => ({ kind: "known", value });
export const approx = (value: number): Weight => ({ kind: "approx", value });
export const unknown: Weight = { kind: "unknown" };

/**
 * Eligibility test used by `pool` (§3): "nonzero w".
 *
 * `Unknown` counts as nonzero — it is the PoE2 sentinel meaning "can roll",
 * so an unknown-weight mod IS a candidate. Only a *provably* zero weight
 * (`Known 0` / `Approx 0`, i.e. the PoE1 closed-world "cannot roll here")
 * makes a mod ineligible.
 */
export function isNonzero(w: Weight): boolean {
    switch (w.kind) {
        case "known":
        case "approx":
            return w.value > 0;
        case "unknown":
            return true;
        // No default: the exhaustive switch + noFallthroughCasesInSwitch means
        // adding a new Weight kind is a compile error here until handled.
    }
}
