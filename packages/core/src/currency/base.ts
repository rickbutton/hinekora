/**
 * The base currency library (typing rules §4.1–4.4) — the four operations that
 * are identical in both games (`g` free), so they live in a shared module both
 * PoE1 and PoE2 re-export. Game-specific currencies (chaos, essence, …) come
 * later, in per-game modules.
 *
 *   transmute  Normal → Magic, add one           (§4.1)
 *   regal      Magic  → Rare,  add one           (§4.2)
 *   exalt      Rare,          add one into a slot (§4.3)
 *   annul      Rare,          remove one at random (§4.4)
 *
 * A NOTE ON `pool` AND RARITY PROMOTION (a deliberate reading of §4.1/§4.2).
 * The rules write the after-union as a sum over `pool it`, but for transmute
 * `it` is Normal (0 slot caps) and for regal `it` is Magic (1/1 caps) — while
 * the mod actually lands on the *promoted* item (Magic 1/1, Rare 3/3). Drawing
 * the pool against the un-promoted rarity would wrongly yield an empty set (a
 * Normal item has no open slots at all). So each add-op PROMOTES rarity first,
 * then draws `pool` against the promoted item. The present-set and collisions
 * are unchanged by promotion; only the slot caps open up, which is exactly the
 * intent. `AddOne.base` therefore already carries the result rarity.
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
    // p + s < 6: the refinement that makes "exalt a full item" a precondition
    // error. `pool` still enforces the per-generation slot caps.
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
