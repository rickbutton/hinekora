/**
 * The base currency library (typing rules §4.1–4.4): transmute, regal, exalt,
 * annul — the four ops shared by both games.
 *
 * Rarity promotion note: each add-op promotes rarity FIRST, then draws `pool`
 * against the promoted item. Drawing against the un-promoted rarity would
 * wrongly yield an empty pool (a Normal item has no open slots); promotion only
 * opens the slot caps, leaving the present-set and collisions unchanged. So
 * `AddOne.base` already carries the result rarity.
 */
import type { Item } from "../model/item.js";
import { removable } from "../model/effects.js";
import { wfViolations } from "../model/wf.js";
import { addOne, removeOne } from "../outcome/outcome.js";
import { pool } from "../pool/pool.js";
import { err, ok, type Operation, type OpError } from "./result.js";

/** Every operation requires a well-formed input (the implicit obligation on all rules). */
function wfError(it: Item): OpError | null {
    const violations = wfViolations(it);
    return violations.length > 0 ? { kind: "notWellFormed", violations } : null;
}

/** Transmute — Normal → Magic, add one random mod. */
export const transmute: Operation = (ctx, it) => {
    const bad = wfError(it);
    if (bad) return err(bad);
    if (it.rarity !== "normal") {
        return err({ kind: "wrongRarity", needed: "normal", actual: it.rarity });
    }
    const promoted: Item = { ...it, rarity: "magic" };
    return ok(addOne(promoted, pool(ctx.catalog, promoted)));
};

/** Regal — Magic → Rare, add one random mod. */
export const regal: Operation = (ctx, it) => {
    const bad = wfError(it);
    if (bad) return err(bad);
    if (it.rarity !== "magic") {
        return err({ kind: "wrongRarity", needed: "magic", actual: it.rarity });
    }
    const promoted: Item = { ...it, rarity: "rare" };
    return ok(addOne(promoted, pool(ctx.catalog, promoted)));
};

/** Exalt — Rare, add one random mod into an open slot. */
export const exalt: Operation = (ctx, it) => {
    const bad = wfError(it);
    if (bad) return err(bad);
    if (it.rarity !== "rare") {
        return err({ kind: "wrongRarity", needed: "rare", actual: it.rarity });
    }
    // `pool` still enforces the per-generation slot caps; this makes "exalt a
    // full item" its own precondition error.
    if (it.prefixes.length + it.suffixes.length >= 6) {
        return err({
            kind: "noOpenSlot",
            prefixCount: it.prefixes.length,
            suffixCount: it.suffixes.length,
        });
    }
    return ok(addOne(it, pool(ctx.catalog, it)));
};

/** Annul — Rare, remove one random (removable) affix. */
export const annul: Operation = (_ctx, it) => {
    const bad = wfError(it);
    if (bad) return err(bad);
    if (it.rarity !== "rare") {
        return err({ kind: "wrongRarity", needed: "rare", actual: it.rarity });
    }
    const rem = removable(it);
    if (rem.length === 0) return err({ kind: "nothingToRemove" });
    return ok(removeOne(it, rem));
};
