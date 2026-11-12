/**
 * The rows the crafted family reads off the catalogue: which are veiled, which
 * metamods the Bestiary crafts, the veiled orbs' placeholders and the results
 * an unveil may offer. Facts of the data, read alike by the symbolic image
 * (ops/crafted.ts) and the reference (reference/ops/crafted.ts).
 */
import type { Base } from "../../model/base.js";
import { craftedCapOf, effectsOf } from "../../model/effects.js";
import { type Gen, TagId } from "../../model/ids.js";
import type { Mod } from "../../model/mod.js";
import { isVeiledPlaceholder } from "../../model/veiled.js";
import { veiledPool } from "../../pool/veiled.js";
import type { Registry } from "../../resolve/registry.js";
import type { Where } from "./pools.js";

/** The category tag of a bench row that is the craftable version of a veiled
 *  modifier (the data's; every such row is one of Jun's crafts). */
const UNVEILED_CRAFT = TagId("unveiled_mod");

/** A veiled placeholder or an unveiled result; with `craftable`, a bench row
 *  crafting a veiled modifier too ("an item with a veiled modifier or its
 *  craftable versions", Veiled Exalted Orb § Mechanics). */
export function isVeiledRow(row: Mod, craftable: boolean): boolean {
    return (
        isVeiledPlaceholder(row.type) ||
        row.source === "veiled" ||
        (craftable && row.source === "bench" && row.implicitTags.has(UNVEILED_CRAFT))
    );
}

/** The crafted-modifier limit a row sets while on the item, 1 for most. */
export const capOf = (row: Mod): number => craftedCapOf(effectsOf(row));

/** The metamods the Bestiary crafts: the bench's effect carriers, on any class
 *  (Beastcrafting, "Add a crafted Meta-modifier"). */
export function metamodRows(w: Where): Mod[] {
    return w.registry.catalog.filter((m) => m.source === "bench" && effectsOf(m).length > 0);
}

/** The plain placeholder of each side, never a Syndicate member's (Veiled
 *  Chaos Orb: "does not include signature veiled modifiers"). */
export function placeholderRows(w: Where): Mod[] {
    return w.registry.catalog.filter(
        (m) => isVeiledPlaceholder(m.type) && (m.id as string) === m.type,
    );
}

const unveilCache = new WeakMap<Registry, Map<Base, Map<string, readonly Mod[]>>>();

/** The results a placeholder of the side may become before any is blocked:
 *  `pool/veiled.ts` `veiledPool` with nothing present, of the placeholder's
 *  side (model/veiled.ts: a result of the same generation). */
export function unveilRows(w: Where, gen: Gen): readonly Mod[] {
    let byBase = unveilCache.get(w.registry);
    if (byBase === undefined)
        unveilCache.set(w.registry, (byBase = new Map<Base, Map<string, readonly Mod[]>>()));
    let c = byBase.get(w.base);
    if (c === undefined) byBase.set(w.base, (c = new Map<string, readonly Mod[]>()));
    const key = `${w.ilvl}|${gen}`;
    const hit = c.get(key);
    if (hit !== undefined) return hit;
    const rows = veiledPool(w.registry.catalog, w.base, w.ilvl, new Set()).filter(
        (m) => m.gen === gen,
    );
    c.set(key, rows);
    return rows;
}
