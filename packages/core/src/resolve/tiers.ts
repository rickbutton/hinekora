/**
 * Tier resolution. A tier number is the game's: a row's place, best first,
 * among the rows of its ModType that roll on the base, whatever the item's
 * level (`tierLadder`, `tierNumber`); the advanced tooltip shows the same
 * number on an item whose level stops short of Tier 1. The item's level
 * decides only which of those rows a currency can roll (`rollableTiers`). Both
 * are derived from `pool`, ranked by `minLevel` descending. An influenced
 * item's rows roll on its influence tags, passed as `tags` beside the base's
 * own.
 */
import type { Base } from "../model/base.js";
import type { Gen, ModId, TagId, TypeId } from "../model/ids.js";
import { emptyItem } from "../model/item.js";
import type { Mod } from "../model/mod.js";
import { type ModCatalog, pool } from "../pool/pool.js";

/** The item level at which every row of a ladder rolls. */
const TOP_ITEM_LEVEL = 100;

const NO_TAGS: ReadonlySet<TagId> = new Set();
const NO_ROWS: readonly Mod[] = [];

/** What is derived from one "empty Rare item" pool: the pool, and each type's
 *  rows in it, best first, filled on the first question about a type. */
interface Ladders {
    readonly pool: ReturnType<typeof pool>;
    tiers?: ReadonlyMap<TypeId, readonly Mod[]>;
}

/**
 * The "empty Rare item" pool per (base, ilvl, extra tags), memoized — this
 * catalog scan is repeated per predicate, per fixpoint pass, per hover, so
 * caching it is the single biggest checker/LSP speedup. Keyed by the catalog
 * and the base themselves (WeakMaps), so different registries never share a
 * cache, nor do two cluster jewels of one base with different enchantments,
 * whose bases differ only in their tags.
 */
const laddersCache = new WeakMap<ModCatalog, WeakMap<Base, Map<string, Ladders>>>();

function laddersOf(
    catalog: ModCatalog,
    base: Base,
    ilvl: number,
    tags: ReadonlySet<TagId>,
): Ladders {
    let byBase = laddersCache.get(catalog);
    if (byBase === undefined) {
        byBase = new WeakMap<Base, Map<string, Ladders>>();
        laddersCache.set(catalog, byBase);
    }
    let byKey = byBase.get(base);
    if (byKey === undefined) {
        byKey = new Map<string, Ladders>();
        byBase.set(base, byKey);
    }
    const key = tags.size === 0 ? `${ilvl}` : `${ilvl}:${[...tags].sort().join(",")}`;
    let cached = byKey.get(key);
    if (cached === undefined) {
        const empty = emptyItem(base, ilvl, "rare");
        cached = {
            pool: pool(
                catalog,
                tags.size === 0 ? empty : { ...empty, tags: new Set([...empty.tags, ...tags]) },
            ),
        };
        byKey.set(key, cached);
    }
    return cached;
}

/** The rows of `type` a currency can roll on `base` at `ilvl`, best first. A
 *  row's place here is not its tier number, which counts the rows above the
 *  item's level too (`tierLadder`). */
export function rollableTiers(
    catalog: ModCatalog,
    base: Base,
    ilvl: number,
    type: TypeId,
    tags: ReadonlySet<TagId> = NO_TAGS,
): readonly Mod[] {
    const ladders = laddersOf(catalog, base, ilvl, tags);
    // Every type's rows are sorted at once: a strip asks the side of each
    // modifier the item may carry, hundreds of types a call.
    if (ladders.tiers === undefined) {
        const rows = new Map<TypeId, Mod[]>();
        for (const c of ladders.pool) {
            const list = rows.get(c.mod.type);
            if (list) list.push(c.mod);
            else rows.set(c.mod.type, [c.mod]);
        }
        for (const list of rows.values()) list.sort((a, b) => b.minLevel - a.minLevel);
        ladders.tiers = rows;
    }
    return ladders.tiers.get(type) ?? NO_ROWS;
}

/** The whole ladder of `type` on `base`: every row that rolls on it at some
 *  item level, best (T1) first. A row's id does not give its tier: ids count up
 *  with mod level, T-numbers down from the best, so `IncreasedLife11` can be T1. */
export function tierLadder(
    catalog: ModCatalog,
    base: Base,
    type: TypeId,
    tags: ReadonlySet<TagId> = NO_TAGS,
): readonly Mod[] {
    return rollableTiers(catalog, base, TOP_ITEM_LEVEL, type, tags);
}

/** The place of a row on a ladder, 1 the best; `undefined` for a row not on it. */
export function tierNumber(ladder: readonly Mod[], row: ModId): number | undefined {
    const i = ladder.findIndex((m) => m.id === row);
    return i < 0 ? undefined : i + 1;
}

/** Every ModType that can roll on `base` at `ilvl` — the type-level pool. */
export function rollableTypes(
    catalog: ModCatalog,
    base: Base,
    ilvl: number,
    tags: ReadonlySet<TagId> = NO_TAGS,
): Set<TypeId> {
    const out = new Set<TypeId>();
    for (const c of laddersOf(catalog, base, ilvl, tags).pool) out.add(c.mod.type);
    return out;
}

/** The side of each type's first row in the catalog. */
const firstGenCache = new WeakMap<ModCatalog, Map<TypeId, Gen>>();

function firstGen(catalog: ModCatalog, type: TypeId): Gen | undefined {
    let gens = firstGenCache.get(catalog);
    if (gens === undefined) {
        gens = new Map<TypeId, Gen>();
        for (const m of catalog) if (!gens.has(m.type)) gens.set(m.type, m.gen);
        firstGenCache.set(catalog, gens);
    }
    return gens.get(type);
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
    return (
        rollableTiers(catalog, base, ilvl, type, tags)[0]?.gen ??
        tierLadder(catalog, base, type, tags)[0]?.gen ??
        firstGen(catalog, type)
    );
}

/** The row at tier `n` of a ladder (1-based, T1 = best), or `undefined` if out of range. */
export function tierMod(ladder: readonly Mod[], n: number): Mod | undefined {
    return n >= 1 ? ladder[n - 1] : undefined;
}
