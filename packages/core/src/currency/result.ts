/**
 * The shared shape of a currency operation: a state-transformer over the item
 * model that either fails a precondition or succeeds with a symbolic `Outcome`.
 * Preconditions are structured errors (not exceptions) so the renderer can show
 * "what the item was + what the op needed".
 */
import type { Rarity } from "../model/ids.js";
import type { Item } from "../model/item.js";
import type { WfViolation } from "../model/wf.js";
import type { Outcome } from "../outcome/outcome.js";
import type { ModCatalog } from "../pool/pool.js";

/** What an operation needs to run. A context object (not a bare catalog
 *  parameter) so future additions don't ripple through every signature. */
export interface OpContext {
    readonly catalog: ModCatalog;
}

/** A precondition failure — why the op does not fit the current item. */
export type OpError =
    | { readonly kind: "notWellFormed"; readonly violations: readonly WfViolation[] }
    | { readonly kind: "wrongRarity"; readonly needed: Rarity; readonly actual: Rarity }
    | { readonly kind: "noOpenSlot"; readonly prefixCount: number; readonly suffixCount: number }
    | { readonly kind: "nothingToRemove" };

export type OpResult =
    | { readonly ok: true; readonly outcome: Outcome }
    | { readonly ok: false; readonly error: OpError };

/** Every currency has this shape — a state-transformer over the item model. */
export type Operation = (ctx: OpContext, it: Item) => OpResult;

export const ok = (outcome: Outcome): OpResult => ({ ok: true, outcome });
export const err = (error: OpError): OpResult => ({ ok: false, error });
