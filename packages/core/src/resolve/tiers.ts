/**
 * Tier resolution. A tier number is the game's: a row's place, best first,
 * among the rows of its ModType that roll on the base, whatever the item's
 * level (`tierLadders`, `tierNumber`); the advanced tooltip shows the same
 * number on an item whose level stops short of Tier 1. The item's level
 * decides only which of those rows a currency can roll (`rollableTiers`). Both
 * are derived from `pool`, ranked by `minLevel` descending. An influenced
 * item's rows roll on its influence tags, passed as `tags` beside the base's
 * own.
 */
import type { Base } from "../model/base.js";
import type { Gen, ModId, TagId, TypeId } from "../model/ids.js";
import { emptyItem } from "../model/item.js";
import { type Influence, influenceOfTag, INFLUENCES } from "../model/marks.js";
import type { Mod } from "../model/mod.js";
import { type ModCatalog, pool } from "../pool/pool.js";

/** The item level at which every row of a ladder rolls. */
const TOP_ITEM_LEVEL = 100;

const NO_TAGS: ReadonlySet<TagId> = new Set();
const NO_ROWS: readonly Mod[] = [];

/** Whose rows a ladder is: the base's own, or those one influence adds. */
export type LadderOwner = Influence | "base";

/** The ladders of one ModType on an item, the base's own first, then each
 *  influence's in the order of `INFLUENCES`; each best (T1) first. */
export type TierLadders = ReadonlyMap<LadderOwner, readonly Mod[]>;

const NO_LADDERS: TierLadders = new Map();
const OWNERS: readonly LadderOwner[] = ["base", ...INFLUENCES];

/** What is derived from one "empty Rare item" pool: the pool, and each type's
 *  rows in it, best first, filled on the first question about a type. */
interface Ladders {
    readonly pool: ReturnType<typeof pool>;
    tiers?: ReadonlyMap<TypeId, readonly Mod[]>;
    ladders?: Map<TypeId, TierLadders>;
}

/**
 * Best first. Rows of one level are different modifiers that share a ModType
 * and a tier number (`tiersOf`); the id only keeps their order the same on
 * every run, whatever order the catalog lists them in.
 */
function byLevel(a: Mod, b: Mod): number {
    return b.minLevel - a.minLevel || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/**
 * A ladder's tiers, best first. Rows of one level are one tier: they are
 * modifiers of their own that share the ModType (an Elder amulet's "+1 to
 * maximum number of Skeletons" and "… of Raised Zombies"), each the only tier
 * of its own modifier, so neither is a tier above the other. The game's number
 * for such a row has not been observed (`QUESTIONS.md` Q102).
 */
function tiersOf(ladder: readonly Mod[]): readonly (readonly Mod[])[] {
    const tiers: Mod[][] = [];
    for (const m of ladder) {
        const last = tiers.at(-1);
        if (last !== undefined && last[0]!.minLevel === m.minLevel) last.push(m);
        else tiers.push([m]);
    }
    return tiers;
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
 *  item's level too and only those of the row's own ladder (`tierLadders`). */
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
        for (const list of rows.values()) list.sort(byLevel);
        ladders.tiers = rows;
    }
    return ladders.tiers.get(type) ?? NO_ROWS;
}

/** Every row of `type` that rolls on `base` at some item level, best first.
 *  A row's place here is its tier only where the type has one ladder
 *  (`tierLadders`). A row's id does not give its tier: ids count up with mod
 *  level, T-numbers down from the best, so `IncreasedLife11` can be T1. */
export function tierLadder(
    catalog: ModCatalog,
    base: Base,
    type: TypeId,
    tags: ReadonlySet<TagId> = NO_TAGS,
): readonly Mod[] {
    return rollableTiers(catalog, base, TOP_ITEM_LEVEL, type, tags);
}

/**
 * The ladders of `type` on `base`. A row is ranked among the rows that roll on
 * the item by the same right as it does: the base's own tags, or the tag of
 * one influence. So an influence's rows are numbered apart from the base's and
 * from another influence's, and a tier number may name a row of each ladder.
 * This is the reading under which a Harvest change keeps a modifier within its
 * own influence; how the game numbers a modifier with rows under two
 * influences, or under an influence and the base, has not been observed
 * (`QUESTIONS.md` Q101).
 */
export function tierLadders(
    catalog: ModCatalog,
    base: Base,
    type: TypeId,
    tags: ReadonlySet<TagId> = NO_TAGS,
): TierLadders {
    const rows = tierLadder(catalog, base, type, tags);
    if (rows.length === 0) return NO_LADDERS;
    const cache = (laddersOf(catalog, base, TOP_ITEM_LEVEL, tags).ladders ??= new Map());
    let ladders = cache.get(type);
    if (ladders === undefined) {
        const byOwner = new Map<LadderOwner, Mod[]>();
        for (const m of rows) {
            // The first entry the item matches is the one that gives the row
            // its weight (`lookupWeight`).
            const tag = m.spawn.find((w) => base.tags.has(w.tag) || tags.has(w.tag))?.tag;
            const owner =
                tag === undefined || base.tags.has(tag)
                    ? "base"
                    : (influenceOfTag(tag)?.influence ?? "base");
            const ladder = byOwner.get(owner);
            if (ladder) ladder.push(m);
            else byOwner.set(owner, [m]);
        }
        ladders = new Map(
            OWNERS.flatMap((o) => {
                const ladder = byOwner.get(o);
                return ladder === undefined ? [] : [[o, ladder] as const];
            }),
        );
        cache.set(type, ladders);
    }
    return ladders;
}

/** The tier of a row, 1 the best of its ladder; `undefined` for a row on none. */
export function tierNumber(ladders: TierLadders, row: ModId): number | undefined {
    for (const ladder of ladders.values()) {
        const i = tiersOf(ladder).findIndex((tier) => tier.some((m) => m.id === row));
        if (i >= 0) return i + 1;
    }
    return undefined;
}

/**
 * The rows at tier `n` (T1 = best) of each ladder that reaches it. A ladder
 * has several where modifiers that share the ModType share the tier; `pick`
 * chooses among those (the ones a name's wording means).
 */
export function tierRows(
    ladders: TierLadders,
    n: number,
    pick: (rows: readonly Mod[]) => readonly Mod[] = (rows) => rows,
): readonly Mod[] {
    if (n < 1) return NO_ROWS;
    return [...ladders.values()].flatMap((ladder) => {
        const rows = tiersOf(ladder)[n - 1];
        return rows === undefined ? [] : pick(rows);
    });
}

/** How many tiers the modifier has: those of its longest ladder. */
export function tierCount(ladders: TierLadders): number {
    return Math.max(0, ...[...ladders.values()].map((ladder) => tiersOf(ladder).length));
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
