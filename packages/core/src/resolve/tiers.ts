/**
 * Tier resolution: which mods (tiers) of a ModType can roll on a base at an
 * ilvl. Tiers are base- and ilvl-dependent, so rather than invent a tier
 * table we derive it from `pool` and rank by `minLevel` descending — the
 * highest-requirement tier that can appear is T1. An influenced item's rows
 * roll on its influence tags, passed as `tags` beside the base's own.
 */
import type { Base } from "../model/base.js";
import type { Gen, TagId, TypeId } from "../model/ids.js";
import { emptyItem } from "../model/item.js";
import type { Mod } from "../model/mod.js";
import { type ModCatalog, pool } from "../pool/pool.js";

const NO_TAGS: ReadonlySet<TagId> = new Set();

/**
 * The "empty Rare item" pool per (base, ilvl, extra tags), memoized — this
 * catalog scan is repeated per predicate, per fixpoint pass, per hover, so
 * caching it is the single biggest checker/LSP speedup. Keyed by catalog
 * identity (a WeakMap) so different registries never share a cache.
 */
const emptyPoolCache = new WeakMap<ModCatalog, Map<string, ReturnType<typeof pool>>>();

function emptyPool(
    catalog: ModCatalog,
    base: Base,
    ilvl: number,
    tags: ReadonlySet<TagId>,
): ReturnType<typeof pool> {
    let byKey = emptyPoolCache.get(catalog);
    if (byKey === undefined) {
        byKey = new Map();
        emptyPoolCache.set(catalog, byKey);
    }
    const key = `${base.id}:${ilvl}:${[...tags].sort().join(",")}`;
    let cached = byKey.get(key);
    if (cached === undefined) {
        const empty = emptyItem(base, ilvl, "rare");
        cached = pool(
            catalog,
            tags.size === 0 ? empty : { ...empty, tags: new Set([...empty.tags, ...tags]) },
        );
        byKey.set(key, cached);
    }
    return cached;
}

/** The rollable tiers of `type` on `base` at `ilvl`, best (T1) first. */
export function rollableTiers(
    catalog: ModCatalog,
    base: Base,
    ilvl: number,
    type: TypeId,
    tags: ReadonlySet<TagId> = NO_TAGS,
): readonly Mod[] {
    return emptyPool(catalog, base, ilvl, tags)
        .map((c) => c.mod)
        .filter((m) => m.type === type)
        .sort((a, b) => b.minLevel - a.minLevel);
}

/** Every ModType that can roll on `base` at `ilvl` — the type-level pool. */
export function rollableTypes(
    catalog: ModCatalog,
    base: Base,
    ilvl: number,
    tags: ReadonlySet<TagId> = NO_TAGS,
): Set<TypeId> {
    const out = new Set<TypeId>();
    for (const c of emptyPool(catalog, base, ilvl, tags)) out.add(c.mod.type);
    return out;
}

/**
 * The side a ModType occupies on `base`: a ModType is a tier bucket, not a ladder,
 * and 130 of them have prefix rows on some bases and suffix rows on others, so the
 * side is only defined against the rows that roll here. Falls back to the catalog's
 * first row for a type that rolls nowhere on this base (a bench or essence row).
 */
export function rollableGen(
    catalog: ModCatalog,
    base: Base,
    ilvl: number,
    type: TypeId,
    tags: ReadonlySet<TagId> = NO_TAGS,
): Gen | undefined {
    const here = rollableTiers(catalog, base, ilvl, type, tags)[0];
    if (here) return here.gen;
    return catalog.find((m) => m.type === type)?.gen;
}

/** The mod at tier `n` (1-based, T1 = best), or `undefined` if out of range. */
export function tierMod(tiers: readonly Mod[], n: number): Mod | undefined {
    return n >= 1 ? tiers[n - 1] : undefined;
}
