/**
 * Tier resolution — which specific mods (tiers) of a ModType can roll on a
 * given base at a given ilvl, ranked so that "T1" is the best available.
 *
 * Tiers are inherently BASE- and ILVL-dependent: the same "maximum life" family
 * has different tiers available on a ring vs a jewel, and a higher tier only
 * appears once the item level allows it. Rather than invent a tier table, we
 * derive it from `pool` (which already answers "what can roll here") and rank by
 * `minLevel` descending — the highest-requirement tier that can appear is T1.
 */
import type { Base } from "../model/base.js";
import type { Game, TypeId } from "../model/ids.js";
import type { Item } from "../model/item.js";
import type { Mod } from "../model/mod.js";
import { type ModCatalog, pool } from "../pool/pool.js";

/**
 * The rollable tiers of `type` on `base` at `ilvl`, best (T1) first. Empty if
 * the type cannot roll here at all.
 */
export function rollableTiers(
    catalog: ModCatalog,
    game: Game,
    base: Base,
    ilvl: number,
    type: TypeId,
): readonly Mod[] {
    // An empty Rare item exposes the full add-pool for this base/ilvl.
    const empty: Item = { game, base, ilvl, rarity: "rare", prefixes: [], suffixes: [] };
    return pool(catalog, empty)
        .map((c) => c.mod)
        .filter((m) => m.type === type)
        .sort((a, b) => b.minLevel - a.minLevel);
}

/**
 * Every ModType that can roll on `base` at `ilvl` — the type-level pool. Editor
 * completion uses this to hide mods that cannot appear on the item being crafted
 * (e.g. jewel or weapon mods on a ring).
 */
export function rollableTypes(
    catalog: ModCatalog,
    game: Game,
    base: Base,
    ilvl: number,
): Set<TypeId> {
    const empty: Item = { game, base, ilvl, rarity: "rare", prefixes: [], suffixes: [] };
    const out = new Set<TypeId>();
    for (const c of pool(catalog, empty)) out.add(c.mod.type);
    return out;
}

/** The mod at tier `n` (1-based, T1 = best), or `undefined` if out of range. */
export function tierMod(tiers: readonly Mod[], n: number): Mod | undefined {
    return n >= 1 ? tiers[n - 1] : undefined;
}
