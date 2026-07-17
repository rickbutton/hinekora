/**
 * The shared shape of a currency operation and its result.
 *
 * Currencies are LIBRARY VALUES, not language features (typing rules §4): each
 * is a function of a uniform `Operation` type. The core supplies the machinery
 * (pool, outcomes, wf); a currency composes it into a typed state-transformer.
 *
 * An operation applied to a known item either fails a PRECONDITION — the "seam"
 * the indexed monad enforces, e.g. "can't Exalt a Magic item" — or succeeds
 * with a symbolic `Outcome`. We surface preconditions as structured errors (not
 * exceptions) so the state renderer can later show "what the item was + what the
 * op needed" (surface doc §6).
 */
import type { Rarity } from "../model/ids.js";
import type { Item } from "../model/item.js";
import type { WfViolation } from "../model/wf.js";
import type { Outcome } from "../outcome/outcome.js";
import type { ModCatalog } from "../pool/pool.js";

/**
 * What an operation needs to run: the mod catalog `pool` draws from. Later
 * milestones extend this (the omen context Ω, the active game module), which is
 * why it is a context object rather than a bare catalog parameter.
 */
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
