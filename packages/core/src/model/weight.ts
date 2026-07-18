/**
 * Spawn weight, provenance-tagged: Known (PoE1 ground truth), Approx (PoE2
 * trade-inferred), Unknown (PoE2 "can roll, odds unknown"). The checker only
 * reads `isNonzero`; the provenance is carried for the future cost/probability
 * layer so it never has to be retrofitted.
 */

export type Weight =
    | { readonly kind: "known"; readonly value: number }
    | { readonly kind: "approx"; readonly value: number }
    | { readonly kind: "unknown" };

export const known = (value: number): Weight => ({ kind: "known", value });
export const approx = (value: number): Weight => ({ kind: "approx", value });
export const unknown: Weight = { kind: "unknown" };

/**
 * Eligibility test used by `pool`. `Unknown` counts as nonzero — it means "can
 * roll"; only a provably zero weight makes a mod ineligible.
 */
export function isNonzero(w: Weight): boolean {
    switch (w.kind) {
        case "known":
        case "approx":
            return w.value > 0;
        case "unknown":
            return true;
    }
}
