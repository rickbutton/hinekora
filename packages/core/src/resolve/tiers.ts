/**
 * Tier resolution: which mods (tiers) of a ModType can roll on a base at an
 * ilvl. Tiers are base- and ilvl-dependent, so rather than invent a tier
 * table we derive it from `pool` and rank by `minLevel` descending — the
 * highest-requirement tier that can appear is T1.
 */
import type { Base } from "../model/base.js";
import type { Game, TypeId } from "../model/ids.js";
import type { Item } from "../model/item.js";
import type { Mod } from "../model/mod.js";
import { type ModCatalog, pool } from "../pool/pool.js";

/**
 * The "empty Rare item" pool per (base, ilvl), memoized — this catalog scan is
 * repeated per predicate, per fixpoint pass, per hover, so caching it is the
 * single biggest checker/LSP speedup. Keyed by catalog identity (a WeakMap) so
 * different registries never share a cache.
 */
const emptyPoolCache = new WeakMap<ModCatalog, Map<string, ReturnType<typeof pool>>>();

function emptyPool(
    catalog: ModCatalog,
    game: Game,
    base: Base,
    ilvl: number,
): ReturnType<typeof pool> {
    let byKey = emptyPoolCache.get(catalog);
    if (byKey === undefined) {
        byKey = new Map();
        emptyPoolCache.set(catalog, byKey);
    }
    const key = `${game}:${base.id}:${ilvl}`;
    let cached = byKey.get(key);
    if (cached === undefined) {
        const empty: Item = { game, base, ilvl, rarity: "rare", prefixes: [], suffixes: [] };
        cached = pool(catalog, empty);
        byKey.set(key, cached);
    }
    return cached;
}

/** The rollable tiers of `type` on `base` at `ilvl`, best (T1) first. */
export function rollableTiers(
    catalog: ModCatalog,
    game: Game,
    base: Base,
    ilvl: number,
    type: TypeId,
): readonly Mod[] {
    return emptyPool(catalog, game, base, ilvl)
        .map((c) => c.mod)
        .filter((m) => m.type === type)
        .sort((a, b) => b.minLevel - a.minLevel);
}

/** Every ModType that can roll on `base` at `ilvl` — the type-level pool. */
export function rollableTypes(
    catalog: ModCatalog,
    game: Game,
    base: Base,
    ilvl: number,
): Set<TypeId> {
    const out = new Set<TypeId>();
    for (const c of emptyPool(catalog, game, base, ilvl)) out.add(c.mod.type);
    return out;
}

/** The mod at tier `n` (1-based, T1 = best), or `undefined` if out of range. */
export function tierMod(tiers: readonly Mod[], n: number): Mod | undefined {
    return n >= 1 ? tiers[n - 1] : undefined;
}
