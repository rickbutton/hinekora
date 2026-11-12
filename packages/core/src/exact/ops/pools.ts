/**
 * Drawing a modifier from a pool, shared by every family that adds one.
 *
 * - `poolRows`: the rows a pool offers an item as the pool sees it (a
 *   `PoolView`: its tags, the cannot-roll metamods on it, its memory strands,
 *   the sides it has room on), before the fit. It states `pool/pool.ts`
 *   `pool` one item at a time; the reference and the symbolic image both
 *   read it, so they offer the same rows, and fill.test.ts holds it to `pool`.
 * - The fit: a row goes on only where its type is absent, its families are
 *   free and its side has room (Modifier § Group/family, item-model.md §7);
 *   the reference tests it per item, the image by intersecting with `wf`.
 * - `drawOne`: the exact image of one draw (docs/EXACT.md §4): each row the
 *   pool offers with the items it is offered on (`drawCases`), and on those
 *   items one absent slot takes a fresh value of the row (`mapOne`).
 *
 * A pool another family owns is a `PoolResolver` in its `Handlers.pools`,
 * merged in ops/registry.ts, carried by the frames into the method context
 * and read here through the draw context; a pool kind no family states is
 * refused by name.
 */
import type { PoolSpec } from "../../check/ops.js";
import type { Base } from "../../model/base.js";
import { effectsOf } from "../../model/effects.js";
import type { Gen, TagId, TypeId } from "../../model/ids.js";
import { type InfluenceKey, influenceOfTag } from "../../model/marks.js";
import type { Mod } from "../../model/mod.js";
import { FOULBORN_AS_STRANDS, foulbornKept, tiersWithStrands } from "../../model/strands.js";
import { lookupWeight } from "../../pool/pool.js";
import type { Registry } from "../../resolve/registry.js";
import type { Dd, DdRelation } from "../dd.js";
import { influenceTagsOfKey } from "../influence.js";
import { type CannotRoll, effectKey } from "../rules.js";
import { isFresh, type Universe } from "../universe.js";
import { InternalError, type MethodCtx, NotImplementedError } from "./handler.js";

/** What every item of a check shares: the catalogue, the base, the level. */
export interface Where {
    readonly registry: Registry;
    readonly base: Base;
    readonly ilvl: number;
}

export const whereOf = (u: Universe): Where => ({
    registry: u.registry,
    base: u.base,
    ilvl: u.ilvl,
});

/** What a pool reads of an item. */
export interface PoolView {
    /** Every tag the item carries: the base's, its influences', those its
     *  modifiers add (item-model.md §5). */
    readonly tags: ReadonlySet<TagId>;
    /** The tags less its influences': what admits a row besides them. */
    readonly ownTags: ReadonlySet<TagId>;
    /** The cannot-roll metamods on the item as it draws (Metamod § Rules and
     *  Exceptions: one the reforge stripped restricts nothing). */
    readonly restrictions: readonly CannotRoll[];
    /** Its memory strands where the method's draws are cut by them, else 0. */
    readonly strands: number;
    /** The sides with an open slot. Absent reads both open: the fit then
     *  decides, which is exact wherever the sides do not change a ranking. */
    readonly open?: Readonly<Record<Gen, boolean>>;
}

export type OwnPool = Extract<
    PoolSpec,
    { kind: "natural" | "tagged" | "fossil" | "essenceGrant" | "influence" | "rows" }
>;

/** The view of an item with those influences, tags its modifiers add and
 *  metamods on it. */
export function poolView(
    w: Where,
    influences: InfluenceKey,
    modTags: Iterable<TagId>,
    restrictions: readonly CannotRoll[],
    strands: number,
    open?: Readonly<Record<Gen, boolean>>,
): PoolView {
    const fromInfluence = influenceTagsOfKey(w.registry, w.base, influences);
    const tags = new Set<TagId>([...w.base.tags, ...fromInfluence, ...modTags]);
    const ownTags = new Set([...tags].filter((t) => !fromInfluence.has(t)));
    return { tags, ownTags, restrictions, strands, ...(open !== undefined && { open }) };
}

// --- the natural pool ---------------------------------------------------------

interface BaseRows {
    /** The catalogue's rows of the base's domain its class permits (`pool`'s
     *  domain and class gates). */
    readonly rows: readonly Mod[];
    readonly byType: ReadonlyMap<TypeId, readonly Mod[]>;
    readonly memo: Map<string, readonly Mod[]>;
}

const baseRowsCache = new WeakMap<Registry, Map<Base, BaseRows>>();

function baseRows(w: Where): BaseRows {
    let byBase = baseRowsCache.get(w.registry);
    if (byBase === undefined) baseRowsCache.set(w.registry, (byBase = new Map<Base, BaseRows>()));
    const hit = byBase.get(w.base);
    if (hit !== undefined) return hit;
    const rows = w.registry.catalog.filter(
        (m) =>
            m.domain === w.base.domain &&
            (m.classRestriction === undefined || m.classRestriction.has(w.base.itemClass)),
    );
    const byType = new Map<TypeId, Mod[]>();
    for (const m of rows) byType.set(m.type, [...(byType.get(m.type) ?? []), m]);
    const made: BaseRows = { rows, byType, memo: new Map() };
    byBase.set(w.base, made);
    return made;
}

const positive = (m: Mod, tags: ReadonlySet<TagId>): boolean => (lookupWeight(m, tags) ?? 0) > 0;

/**
 * `pool`'s candidates at `level`, before the strands' cut and without its
 * type, family and side-count clauses: the tier gate, the open sides, the
 * cannot-roll metamods, a positive weight (first match, `lookupWeight`).
 */
function naturalUncut(
    w: Where,
    view: PoolView,
    level: number,
    only: TypeId | undefined,
): readonly Mod[] {
    const b = baseRows(w);
    const key = [
        only ?? "",
        level,
        [...view.tags].sort().join(","),
        view.restrictions.map(effectKey).sort().join(","),
        view.open === undefined ? "" : `${view.open.prefix ? 1 : 0}${view.open.suffix ? 1 : 0}`,
    ].join("|");
    const hit = b.memo.get(key);
    if (hit !== undefined) return hit;
    const out = (only === undefined ? b.rows : (b.byType.get(only) ?? [])).filter(
        (m) =>
            m.minLevel <= level &&
            (view.open === undefined || view.open[m.gen]) &&
            view.restrictions.every((e) => e.allows(m)) &&
            positive(m, view.tags),
    );
    b.memo.set(key, out);
    return out;
}

/** The top tiers of each type that roll under memory strands, counted over the
 *  type's whole ladder on the base under the item's tags (Memory strand §
 *  Mechanics; the ladder's reading is QUESTIONS.md Q68's). */
function strandsCut(
    w: Where,
    tags: ReadonlySet<TagId>,
    rows: readonly Mod[],
    strands: number,
): Mod[] {
    if (strands <= 0) return [...rows];
    const b = baseRows(w);
    const byType = new Map<TypeId, Mod[]>();
    for (const m of rows) byType.set(m.type, [...(byType.get(m.type) ?? []), m]);
    const kept = new Set<Mod>();
    for (const [type, of] of byType) {
        const ladder = (b.byType.get(type) ?? []).filter((m) => positive(m, tags)).length;
        const tiers = tiersWithStrands(strands, Math.max(ladder, of.length));
        const sorted = [...of].sort((x, y) => y.minLevel - x.minLevel);
        for (const m of sorted.slice(0, tiers)) kept.add(m);
    }
    return rows.filter((m) => kept.has(m));
}

/** A Foulborn orb's cull: a row stays when its rank by level among its type's
 *  rows, rows of one level sharing a rank, is within `foulbornKept`. */
function foulbornCull(rows: readonly Mod[]): Mod[] {
    const byType = new Map<TypeId, Mod[]>();
    for (const m of rows) byType.set(m.type, [...(byType.get(m.type) ?? []), m]);
    return rows.filter((m) => {
        const of = byType.get(m.type)!;
        const rank = 1 + of.filter((r) => r.minLevel > m.minLevel).length;
        return rank <= foulbornKept(of.length);
    });
}

/** The natural pool with the strands' cut where the method's draws take it
 *  (`cut`), at the item's level unless `level` says otherwise. */
function natural(
    w: Where,
    view: PoolView,
    cut: boolean,
    only: TypeId | undefined,
    level = w.ilvl,
    extra = 0,
): Mod[] {
    const rows = naturalUncut(w, view, level, only);
    return strandsCut(w, view.tags, rows, cut && view.strands > 0 ? view.strands + extra : 0);
}

/** A row only an influence admits: no weight under the item's other tags, and
 *  its spawn table names an influence's tag (Influenced item § Mechanics). */
function influenceRow(m: Mod, own: ReadonlySet<TagId>): boolean {
    return (
        (lookupWeight(m, own) ?? 0) <= 0 && m.spawn.some((e) => influenceOfTag(e.tag) !== undefined)
    );
}

/** The essence's row for the base's class, if the catalogue has it (Essence §
 *  Crafting: one modifier per class). */
export function essenceRow(
    w: Where,
    spec: Extract<PoolSpec, { kind: "essenceGrant" }>["spec"],
): Mod | undefined {
    const id = spec.grants.get(w.base.itemClass);
    return id === undefined ? undefined : w.registry.catalog.find((m) => m.id === id);
}

/**
 * The rows the pool offers an item it sees as `view`, before the fit:
 * - natural: the pool at the item's level or `level`, the strands' cut taken
 *   first, then `maxLevel` and `gen`; `topTiers` is a Foulborn orb's cull, or
 *   thirty strands more on an item holding some (Memory strand § Mechanics).
 * - tagged: the natural pool's rows carrying the tag (Harvest crafting).
 * - fossil: the natural pool less the blocked tags (and the tagless under the
 *   Opulent Fossil), with the fossils' own rows that weigh on the base and the
 *   corrupted essences' rows a fossil gives a chance (Fossil § Mechanics).
 * - influence: the natural pool's rows only an influence admits.
 * - essenceGrant: the essence's row for the class, at its fixed tier on any
 *   item level (Essence § Crafting).
 * - rows: the rows named.
 * The cut is read on every pool drawn from the natural one, though today no
 * method that uses strands up draws a tagged or fossil pool: Harvest and
 * resonators consume none (Memory strand § Crafting methods consuming memory
 * strands).
 */
export function ownPoolRows(
    w: Where,
    spec: OwnPool,
    view: PoolView,
    cut: boolean,
    only?: TypeId,
): Mod[] {
    const of = (rows: readonly Mod[]): Mod[] =>
        only === undefined ? [...rows] : rows.filter((m) => m.type === only);
    switch (spec.kind) {
        case "natural": {
            const ranked = cut && view.strands > 0;
            const extra = spec.topTiers && ranked ? FOULBORN_AS_STRANDS : 0;
            const rows = natural(w, view, cut, only, spec.level ?? w.ilvl, extra).filter(
                (m) =>
                    m.minLevel <= (spec.maxLevel ?? Infinity) &&
                    (spec.gen === undefined || m.gen === spec.gen),
            );
            return spec.topTiers && !ranked ? foulbornCull(rows) : rows;
        }
        case "tagged":
            return natural(w, view, cut, only).filter((m) => m.implicitTags.has(spec.tag));
        case "influence":
            return natural(w, view, cut, only).filter((m) => influenceRow(m, view.ownTags));
        case "fossil": {
            const blocked = (m: Mod): boolean =>
                [...m.implicitTags].some((t) => spec.blocked.has(t)) ||
                (spec.noTagless && m.implicitTags.size === 0);
            const added = spec.added.filter(
                (m) => m.minLevel <= w.ilvl && positive(m, w.base.tags),
            );
            return [
                ...natural(w, view, cut, only).filter((m) => !blocked(m)),
                ...of(added),
                ...of(spec.essence),
            ];
        }
        case "essenceGrant": {
            const row = essenceRow(w, spec.spec);
            return row === undefined ? [] : of([row]);
        }
        case "rows":
            return of(spec.mods);
    }
}

/** What a pool's rows depend on, for the image to split the state by. A
 *  row's being offered depends on the item only through its own type's rows
 *  (their weights, the metamods barring them, their ladder and sides). */
export interface PoolScope {
    /** Every row whose weight the item's tags or metamods decide. */
    readonly weighed: readonly Mod[];
    /** A Foulborn orb's cull ranks each type's rows. */
    readonly ranked: boolean;
    /** The strands' cut ranks them where the item holds some. */
    readonly strands: boolean;
}

function ownScope(w: Where, spec: OwnPool, cut: boolean): PoolScope | undefined {
    switch (spec.kind) {
        case "natural":
            return { weighed: baseRows(w).rows, ranked: spec.topTiers === true, strands: cut };
        case "tagged":
        case "influence":
        case "fossil":
            return { weighed: baseRows(w).rows, ranked: false, strands: cut };
        case "essenceGrant":
        case "rows":
            return undefined;
    }
}

// --- pools of other families ---------------------------------------------------

/** A pool another family owns: its rows, and what they depend on (none when
 *  `scope` is absent, so the state is not split for it). */
export interface PoolResolver {
    readonly rows: (w: Where, spec: PoolSpec, view: PoolView, cut: boolean) => readonly Mod[];
    readonly scope?: (w: Where, spec: PoolSpec, cut: boolean) => PoolScope | undefined;
}

export type PoolTable = { readonly [K in PoolSpec["kind"]]?: PoolResolver };

export const OWN_POOLS: ReadonlySet<PoolSpec["kind"]> = new Set([
    "natural",
    "tagged",
    "fossil",
    "essenceGrant",
    "influence",
    "rows",
]);

/** The families' pools as one table. A family stating one of the pools here,
 *  or two stating one pool, is a fault of theirs. */
export function mergePools(tables: readonly (readonly [string, PoolTable])[]): PoolTable {
    const out: Record<string, PoolResolver> = {};
    for (const [family, table] of tables) {
        for (const [kind, resolver] of Object.entries(table)) {
            if (OWN_POOLS.has(kind as PoolSpec["kind"]) || kind in out) {
                throw new InternalError(`the pool "${kind}" is stated twice (${family})`);
            }
            if (resolver !== undefined) out[kind] = resolver;
        }
    }
    return out;
}

const isOwn = (spec: PoolSpec): spec is OwnPool => OWN_POOLS.has(spec.kind);

function resolverOf(pools: PoolTable, kind: PoolSpec["kind"]): PoolResolver {
    const r = pools[kind];
    if (r === undefined) throw new NotImplementedError(`the pool "${kind}"`);
    return r;
}

/** The rows any pool offers an item it sees as `view`, before the fit; of
 *  one type only when `only` is given. */
export function poolRows(
    w: Where,
    spec: PoolSpec,
    view: PoolView,
    cut: boolean,
    pools: PoolTable,
    only?: TypeId,
): readonly Mod[] {
    if (spec.kind === "rows" && spec.replacing !== undefined) {
        throw new InternalError("rows replacing a modifier are the Harvest change's");
    }
    if (isOwn(spec)) return ownPoolRows(w, spec, view, cut, only);
    const rows = resolverOf(pools, spec.kind).rows(w, spec, view, cut);
    return only === undefined ? rows : rows.filter((m) => m.type === only);
}

export function poolScope(
    w: Where,
    spec: PoolSpec,
    cut: boolean,
    pools: PoolTable,
): PoolScope | undefined {
    return isOwn(spec)
        ? ownScope(w, spec, cut)
        : resolverOf(pools, spec.kind).scope?.(w, spec, cut);
}

// --- the symbolic image ----------------------------------------------------------

/** How the method's draws run: `cut` when it uses memory strands up, so its
 *  draws lay down only the tiers they allow (`Rules.strands`). */
export interface DrawCtx {
    readonly u: Universe;
    readonly cut: boolean;
    readonly pools: PoolTable;
    /** Read the pool as if no cannot-roll metamod were on any item: what a
     *  refusal names a metamod by. */
    readonly unrestricted?: boolean;
}

/** The draw context of a method's operation; it reads `Rules.strands`. */
export function drawCtxOf(ctx: MethodCtx): DrawCtx {
    return { u: ctx.u, cut: ctx.rules.strands, pools: ctx.pools ?? {} };
}

/** Rows the pool offers on exactly the items of `dd` among the state's: the
 *  rows of one condition together. An item may be in several cases. */
export interface DrawCase {
    readonly dd: Dd;
    readonly rows: readonly Mod[];
}

const EMPTY_VIEW: PoolView = { tags: new Set(), ownTags: new Set(), restrictions: [], strands: 0 };

const SIDES = [
    [true, true],
    [true, false],
    [false, true],
    [false, false],
] as const;

/** A name for a pool by what it is, so a pool built anew per call is the
 *  same pool to the caches. */
export function poolKey(spec: PoolSpec): string {
    return JSON.stringify(spec, (_k, v: unknown) => {
        if (v instanceof Set) return [...(v as Set<unknown>)].map(String).sort();
        if (v instanceof Map) return [...(v as Map<unknown, unknown>).entries()];
        if (typeof v === "object" && v !== null && "id" in v && "type" in v && "gen" in v) {
            return (v as Mod).id;
        }
        return v;
    });
}

/**
 * The rows the pool offers, each with the items of the state it is offered
 * on, rows offered on the same items grouped. The state is cut into parts of
 * one strands class (the strands values no ladder of the pool tells apart),
 * so within a part a condition never reads the strands; then a row's
 * condition is read type by type from what its type's rows depend on: the
 * influences that add a tag their weights read, each such tag a present
 * modifier may add, each cannot-roll metamod that bars one of them, and,
 * where a cut ranks the type's rows, the open sides of a type with rows on
 * both. Influences no item holds are not read.
 */
export function drawCases(state: Dd, spec: PoolSpec, dc: DrawCtx): DrawCase[] {
    const { u } = dc;
    const m = u.dd;
    const w = whereOf(u);
    if (state === m.EMPTY) return [];
    const scope = poolScope(w, spec, dc.cut, dc.pools);
    if (scope === undefined) {
        const rows = poolRows(w, spec, EMPTY_VIEW, dc.cut, dc.pools);
        return rows.length === 0 ? [] : [{ dd: state, rows }];
    }
    const key = poolKey(spec);
    const out: DrawCase[] = [];
    for (const part of strandsParts(u, state, scope, key)) {
        const present = new Set(m.valuesOf(part.dd, u.scalar("influences")));
        const cond = rowConditions(dc, spec, key, scope, present, part.strands);
        const on = new Map<Dd, Dd>();
        const byItems = new Map<Dd, Mod[]>();
        for (const [r, c] of cond) {
            let dd = on.get(c);
            if (dd === undefined) on.set(c, (dd = m.and(part.dd, c)));
            if (dd === m.EMPTY) continue;
            const g = byItems.get(dd);
            if (g === undefined) byItems.set(dd, [r]);
            else g.push(r);
        }
        for (const [dd, rows] of byItems) out.push({ dd, rows });
    }
    return out;
}

/** The state cut by strands class; one part, read at 0, where the pool's
 *  draws are not cut or no item holds strands. */
function strandsParts(
    u: Universe,
    state: Dd,
    scope: PoolScope,
    key: string,
): { dd: Dd; strands: number }[] {
    const m = u.dd;
    const slot = u.scalar("strands");
    const values = scope.strands ? m.valuesOf(state, slot) : [0];
    if (values.every((v) => v === 0)) return [{ dd: state, strands: 0 }];
    const lengths = ladderLengths(u, scope, key);
    const byClass = new Map<string, number[]>();
    for (const v of values) {
        const c = lengths.map((n) => strandsClass(v, n)).join("/");
        byClass.set(c, [...(byClass.get(c) ?? []), v]);
    }
    const out: { dd: Dd; strands: number }[] = [];
    for (const vs of byClass.values()) {
        const dd = byClass.size === 1 ? state : m.and(state, m.slotIn(slot, vs));
        out.push({ dd, strands: vs[0]! });
    }
    return out;
}

const lengthsCache = new WeakMap<Universe, Map<string, readonly number[]>>();

/** The ladder lengths of the pool's types on the base. */
function ladderLengths(u: Universe, scope: PoolScope, key: string): readonly number[] {
    let c = lengthsCache.get(u);
    if (c === undefined) lengthsCache.set(u, (c = new Map<string, readonly number[]>()));
    const hit = c.get(key);
    if (hit !== undefined) return hit;
    const b = baseRows(whereOf(u));
    const types = new Set(scope.weighed.map((r) => r.type));
    const out = [...new Set([...types].map((t) => b.byType.get(t)?.length ?? 0))]
        .filter((n) => n > 1)
        .sort((x, y) => x - y);
    c.set(key, out);
    return out;
}

const classes = new Map<number, number[]>();

/** The strands values the cut of a ladder of `n` rows cannot tell apart, a
 *  Foulborn orb's thirty more included, share a class: by value, its class. */
function strandsClass(v: number, n: number): number {
    let table = classes.get(n);
    if (table === undefined) {
        table = [];
        const seen = new Map<string, number>();
        for (let s = 0; s <= 100; s++) {
            const name = [s > 0 ? 1 : 0];
            for (let l = 1; l <= n; l++) {
                name.push(tiersWithStrands(s, l), tiersWithStrands(s + FOULBORN_AS_STRANDS, l));
            }
            const k = name.join(",");
            if (!seen.has(k)) seen.set(k, seen.size);
            table.push(seen.get(k)!);
        }
        classes.set(n, table);
    }
    return table[v]!;
}

/** By type, its rows' conditions: cached by the pool and the facts the type
 *  reads, so a pool built anew and the rounds of one reforge hit. */
const conditionCache = new WeakMap<Universe, Map<string, ReadonlyMap<Mod, Dd>>>();

/** Each row the pool may offer on a part of one strands class, with the items
 *  it is offered on, read over the facts alone, not the state. */
function rowConditions(
    dc: DrawCtx,
    spec: PoolSpec,
    key: string,
    scope: PoolScope,
    present: ReadonlySet<number>,
    strands: number,
): ReadonlyMap<Mod, Dd> {
    const { u } = dc;
    const m = u.dd;
    const w = whereOf(u);
    let cache = conditionCache.get(u);
    if (cache === undefined) conditionCache.set(u, (cache = new Map<string, Map<Mod, Dd>>()));
    const free = dc.unrestricted === true;
    // The whole reading by what it reads, ahead of the reading type by type:
    // a loop's rounds draw from one pool on the same facts every round.
    const strandsKey =
        scope.strands && strands > 0
            ? ladderLengths(u, scope, key)
                  .map((n) => strandsClass(strands, n))
                  .join("/")
            : "-";
    const allKey = [
        "all",
        key,
        dc.cut ? 1 : 0,
        free ? 1 : 0,
        [...present].sort((a, b) => a - b).join("."),
        strands > 0 ? 1 : 0,
        strandsKey,
    ].join("|");
    const known = cache.get(allKey);
    if (known !== undefined) return known;
    const p = u.openSlot("prefix");
    const s = u.openSlot("suffix");
    // A weighed type with no slot has no row any item of the check can roll
    // (exact/rows.ts reads the natural rows under every tag an item may
    // carry), so no view offers one; a pool's own rows are read whatever.
    const types = new Set([
        ...[...byTypeOf(scope.weighed).keys()].filter((t) => u.slotOfType(t) !== undefined),
        ...poolRows(w, spec, EMPTY_VIEW, dc.cut, dc.pools).map((r) => r.type),
    ]);
    const cond = new Map<Mod, Dd>();
    for (const t of types) {
        const a = typeAnalysis(u, scope.weighed, t);
        const n = baseRows(w).byType.get(t)?.length ?? 0;
        const sides = a.twoSided && (scope.ranked || (scope.strands && strands > 0));
        const groups = a.influenceGroups.filter((g) => g.some((v) => present.has(v)));
        const typeKey = [
            key,
            t,
            dc.cut ? 1 : 0,
            free ? 1 : 0,
            sides ? 1 : 0,
            groups.map((g) => a.influenceGroups.indexOf(g)).join("."),
            scope.strands && strands > 0 ? strandsClass(strands, n) : -1,
        ].join("|");
        let rows = cache.get(typeKey);
        if (rows === undefined) {
            const made = new Map<Mod, Dd>();
            for (const x of parts(u, a, groups, sides, free, p, s)) {
                const view = poolView(w, x.influences, x.tags, x.carried, strands, x.open);
                for (const r of poolRows(w, spec, view, dc.cut, dc.pools, t)) {
                    made.set(r, m.or(made.get(r) ?? m.EMPTY, x.pure));
                }
            }
            cache.set(typeKey, (rows = made));
        }
        for (const [r, c] of rows) cond.set(r, c);
    }
    cache.set(allKey, cond);
    return cond;
}

interface Part {
    readonly pure: Dd;
    readonly influences: InfluenceKey;
    readonly tags: readonly TagId[];
    readonly carried: readonly CannotRoll[];
    readonly open?: Readonly<Record<Gen, boolean>>;
}

/** The parts a type's facts cut every item into, each a condition over the
 *  facts and the view it gives. */
function parts(
    u: Universe,
    a: TypeAnalysis,
    groups: readonly (readonly number[])[],
    sides: boolean,
    free: boolean,
    p: Dd,
    s: Dd,
): Part[] {
    const m = u.dd;
    const restrictions = free ? [] : a.restrictions;
    const out: Part[] = [];
    const narrowed = (x: Part, by: Dd, yes: boolean): Part | undefined => {
        const pure = yes ? m.and(x.pure, by) : m.diff(x.pure, by);
        return pure === m.EMPTY ? undefined : { ...x, pure };
    };
    const walkSides = (x: Part): void => {
        if (!sides) {
            out.push(x);
            return;
        }
        for (const [prefix, suffix] of SIDES) {
            const part = narrowed(x, m.and(prefix ? p : m.not(p), suffix ? s : m.not(s)), true);
            if (part !== undefined) out.push({ ...part, open: { prefix, suffix } });
        }
    };
    const walkRestrictions = (i: number, x: Part): void => {
        if (i === restrictions.length) return walkSides(x);
        const r = restrictions[i]!;
        const yes = narrowed(x, r.carriers, true);
        if (yes !== undefined)
            walkRestrictions(i + 1, { ...yes, carried: [...x.carried, r.effect] });
        const no = narrowed(x, r.carriers, false);
        if (no !== undefined) walkRestrictions(i + 1, no);
    };
    const walkTags = (i: number, x: Part): void => {
        if (i === a.modTags.length) return walkRestrictions(0, x);
        const [tag, by] = a.modTags[i]!;
        const yes = narrowed(x, by, true);
        if (yes !== undefined) walkTags(i + 1, { ...yes, tags: [...x.tags, tag] });
        const no = narrowed(x, by, false);
        if (no !== undefined) walkTags(i + 1, no);
    };
    for (const values of groups) {
        const pure =
            a.influenceGroups.length === 1 ? m.ALL : m.slotIn(u.scalar("influences"), values);
        walkTags(0, { pure, influences: u.influenceKeys[values[0]!]!, tags: [], carried: [] });
    }
    return out;
}

interface Restriction {
    readonly effect: CannotRoll;
    /** The items carrying a modifier with it. */
    readonly carriers: Dd;
}

/** What may change which of a type's rows a pool offers. */
interface TypeAnalysis {
    /** The influence values by the tags they add that the rows' weights read;
     *  one group where none does. */
    readonly influenceGroups: readonly (readonly number[])[];
    /** The tags the rows' weights read that a present modifier may add, with
     *  the items on which one does. */
    readonly modTags: readonly (readonly [TagId, Dd])[];
    /** The cannot-roll metamods the universe's modifiers carry that bar one of
     *  the rows, one per effect. */
    readonly restrictions: readonly Restriction[];
    /** The rows sit on both sides. */
    readonly twoSided: boolean;
}

/** The weighed rows by type: shared by every universe of the base. */
const weighedByType = new WeakMap<readonly Mod[], ReadonlyMap<TypeId, readonly Mod[]>>();

function byTypeOf(weighed: readonly Mod[]): ReadonlyMap<TypeId, readonly Mod[]> {
    let out = weighedByType.get(weighed);
    if (out === undefined) {
        const made = new Map<TypeId, Mod[]>();
        for (const r of weighed) {
            const list = made.get(r.type);
            if (list === undefined) made.set(r.type, [r]);
            else list.push(r);
        }
        weighedByType.set(weighed, (out = made));
    }
    return out;
}

/** What every type's analysis over a universe reads, and the analyses made. */
interface Analyser {
    readonly effects: ReadonlyMap<string, CannotRoll>;
    readonly carriers: Map<string, Dd>;
    readonly influenceTags: readonly ReadonlySet<TagId>[];
    readonly done: Map<readonly Mod[], Map<TypeId, TypeAnalysis>>;
}

const analysers = new WeakMap<Universe, Analyser>();

function analyserOf(u: Universe): Analyser {
    let a = analysers.get(u);
    if (a === undefined) {
        const effects = new Map<string, CannotRoll>();
        for (const slot of u.modSlots()) {
            for (const row of u.modSlot(slot)!.rows) {
                for (const e of effectsOf(row)) {
                    if (e.kind === "poolRestrict") effects.set(effectKey(e), e);
                }
            }
        }
        a = {
            effects,
            carriers: new Map(),
            influenceTags: u.influenceKeys.map((k) => influenceTagsOfKey(u.registry, u.base, k)),
            done: new Map(),
        };
        analysers.set(u, a);
    }
    return a;
}

/** A type's analysis, made the first time a pool asks for it. */
function typeAnalysis(u: Universe, weighed: readonly Mod[], type: TypeId): TypeAnalysis {
    const a = analyserOf(u);
    let done = a.done.get(weighed);
    if (done === undefined) a.done.set(weighed, (done = new Map<TypeId, TypeAnalysis>()));
    const rows = byTypeOf(weighed).get(type);
    if (rows === undefined) {
        return {
            influenceGroups: [u.influenceKeys.map((_, i) => i)],
            modTags: [],
            restrictions: [],
            twoSided: false,
        };
    }
    const hit = done.get(type);
    if (hit !== undefined) return hit;
    const m = u.dd;
    const carriers = (k: string): Dd => {
        let d = a.carriers.get(k);
        if (d === undefined) {
            d = u.anyMod((v) => effectsOf(v.row).some((e) => effectKey(e) === k));
            a.carriers.set(k, d);
        }
        return d;
    };
    const reads = new Set<TagId>();
    for (const r of rows) for (const t of u.extraTags(r)) reads.add(t);
    const groups = new Map<string, number[]>();
    a.influenceTags.forEach((tags, i) => {
        const k = [...tags]
            .filter((t) => reads.has(t))
            .sort()
            .join(",");
        groups.set(k, [...(groups.get(k) ?? []), i]);
    });
    const modTags: (readonly [TagId, Dd])[] = [];
    for (const t of [...reads].sort()) {
        const by = modCarrying(u, t);
        if (by !== m.EMPTY) modTags.push([t, by]);
    }
    const restrictions = [...a.effects.entries()]
        .filter(([, e]) => rows.some((r) => !e.allows(r)))
        .sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0))
        .map(([k, effect]) => ({ effect, carriers: carriers(k) }));
    const made: TypeAnalysis = {
        influenceGroups: [...groups.values()],
        modTags,
        restrictions,
        twoSided: new Set(rows.map((r) => r.gen)).size > 1,
    };
    done.set(type, made);
    return made;
}

const carrying = new WeakMap<Universe, Map<TagId, Dd>>();

/** The items a present modifier of which adds the tag. */
function modCarrying(u: Universe, tag: TagId): Dd {
    let c = carrying.get(u);
    if (c === undefined) carrying.set(u, (c = new Map<TagId, Dd>()));
    const hit = c.get(tag);
    if (hit !== undefined) return hit;
    let d = u.dd.EMPTY;
    for (const [slot, values] of u.tagSuppliers(tag).mods)
        d = u.dd.or(d, u.dd.slotIn(slot, values));
    c.set(tag, d);
    return d;
}

// --- one draw --------------------------------------------------------------------

interface RowsImage {
    readonly forward: DdRelation;
    readonly backward: DdRelation;
    readonly grow: DdRelation;
    canTake: Dd | undefined;
}

const imageCache = new WeakMap<Universe, Map<string, RowsImage>>();

/** The relations of laying one of the rows fresh in an absent slot, of
 *  taking it back off, and of laying any number of them. Throws for a row no
 *  slot of the universe holds. */
function rowsImage(u: Universe, rows: readonly Mod[]): RowsImage {
    let c = imageCache.get(u);
    if (c === undefined) imageCache.set(u, (c = new Map<string, RowsImage>()));
    const key = rows
        .map((r) => r.id)
        .sort()
        .join(",");
    const hit = c.get(key);
    if (hit !== undefined) return hit;
    for (const r of rows) {
        if (u.rowValues([r.id], false, isFresh).size === 0) {
            throw new InternalError(`the row ${r.id} can be drawn, but no slot holds it`);
        }
    }
    const fresh = u.rowValues(
        rows.map((r) => r.id),
        false,
        isFresh,
    );
    const ABSENT: readonly number[] = [0];
    const back = new Map<number, Set<number>>();
    const grown = new Map<number, readonly number[]>();
    for (const [slot, values] of fresh) {
        back.set(slot, new Set(values));
        grown.set(slot, [0, ...values]);
    }
    const made: RowsImage = {
        forward: (slot, from) => (from === 0 ? fresh.get(slot) : undefined),
        backward: (slot, from) => (back.get(slot)?.has(from) === true ? ABSENT : undefined),
        grow: (slot, from) => (from === 0 ? grown.get(slot) : undefined),
        canTake: undefined,
    };
    c.set(key, made);
    return made;
}

/**
 * The relation of one draw of the rows, for `mapOne`: an absent slot takes a
 * fresh value of one of them. The image does not say which slot was filled; a
 * caller that needs it (an add, then a removal sparing what it added) draws
 * per slot instead: for each case of `drawCases` and each slot its rows sit
 * in, `mapOne` restricted to that slot, which leaves the slot known.
 */
export function freshRelation(u: Universe, rows: readonly Mod[]): DdRelation {
    return rowsImage(u, rows).forward;
}

/** The items on which one of the rows fits: an absent slot of its type, its
 *  families free, room on its side. Cached by the rows. */
export function canTake(u: Universe, rows: readonly Mod[]): Dd {
    if (rows.length === 0) return u.dd.EMPTY;
    const img = rowsImage(u, rows);
    img.canTake ??= u.dd.mapOne(u.wf, img.backward);
    return img.canTake;
}

/** The items of `state` with one of the rows added, fresh, at any value. */
export function addOneOf(u: Universe, state: Dd, rows: readonly Mod[]): Dd {
    if (rows.length === 0 || state === u.dd.EMPTY) return u.dd.EMPTY;
    return u.dd.and(u.dd.mapOne(state, rowsImage(u, rows).forward), u.wf);
}

/** The items of `state` with any number of the rows added, fresh, none
 *  included: what any order of draws from a pool that does not change can
 *  reach, since an item the game allows allows each of its parts. */
export function addAnyOf(u: Universe, state: Dd, rows: readonly Mod[]): Dd {
    if (rows.length === 0 || state === u.dd.EMPTY) return state;
    return u.dd.and(u.dd.mapEach(state, rowsImage(u, rows).grow), u.wf);
}

export interface Draw {
    /** The items one draw can leave of those that have a row to draw. */
    readonly drawn: Dd;
    /** The items on which no row of the pool fits: the pool is dry. */
    readonly dry: Dd;
}

/** One modifier drawn from the pool on each item of the state, as the item
 *  stands (docs/EXACT.md §4). */
export function drawOne(state: Dd, spec: PoolSpec, dc: DrawCtx): Draw {
    const { u } = dc;
    const m = u.dd;
    const drawn: Dd[] = [];
    const able: Dd[] = [];
    for (const c of drawCases(state, spec, dc)) {
        const here = m.and(c.dd, canTake(u, c.rows));
        able.push(here);
        drawn.push(addOneOf(u, here, c.rows));
    }
    return { drawn: unionOf(u, drawn), dry: m.diff(state, unionOf(u, able)) };
}

/** The items of the state on which some row of the pool fits. */
export function canDraw(state: Dd, spec: PoolSpec, dc: DrawCtx): Dd {
    const m = dc.u.dd;
    return unionOf(
        dc.u,
        drawCases(state, spec, dc).map((c) => m.and(c.dd, canTake(dc.u, c.rows))),
    );
}

/** The state cut into parts on each of which the pool offers one set of rows. */
export function drawAtoms(state: Dd, spec: PoolSpec, dc: DrawCtx): DrawCase[] {
    const m = dc.u.dd;
    let atoms: { dd: Dd; rows: Mod[] }[] = [{ dd: state, rows: [] }];
    for (const c of drawCases(state, spec, dc)) {
        const next: { dd: Dd; rows: Mod[] }[] = [];
        for (const a of atoms) {
            const yes = m.and(a.dd, c.dd);
            const no = m.diff(a.dd, c.dd);
            if (yes !== m.EMPTY) next.push({ dd: yes, rows: [...a.rows, ...c.rows] });
            if (no !== m.EMPTY) next.push({ dd: no, rows: a.rows });
        }
        atoms = next;
    }
    return atoms;
}

/**
 * Do the rows the pool offers an item stay as they are while the pool's own
 * rows are laid on it? Not where a row it may lay adds a tag a row's weight
 * reads (one laid first turns another on or off) or carries a cannot-roll
 * metamod, nor where a cut ranks the rows of a type with rows of both sides,
 * since a row laid can close the side the ranking reads.
 */
export function poolHoldsStill(state: Dd, spec: PoolSpec, dc: DrawCtx): boolean {
    const { u } = dc;
    const w = whereOf(u);
    const scope = poolScope(w, spec, dc.cut, dc.pools);
    const cases = drawCases(state, spec, dc);
    const laid = new Set(cases.flatMap((c) => c.rows));
    const reads = readTagsOf(u, scope?.weighed ?? []);
    for (const r of laid) {
        if ([...r.addsTags].some((t) => reads.has(t))) return false;
        if (effectsOf(r).some((e) => e.kind === "poolRestrict")) return false;
    }
    const stranded =
        scope?.strands === true && u.dd.valuesOf(state, u.scalar("strands")).some((v) => v > 0);
    if (scope !== undefined && (scope.ranked || stranded)) {
        // The rows the ranking chooses among: the pool's with no cut.
        const unranked = spec.kind === "natural" ? withoutCull(spec) : spec;
        const sides = new Map<TypeId, Set<Gen>>();
        for (const c of drawCases(state, unranked, { ...dc, cut: false })) {
            for (const r of c.rows) sides.set(r.type, (sides.get(r.type) ?? new Set()).add(r.gen));
        }
        for (const t of new Set([...laid].map((r) => r.type))) {
            if ((sides.get(t)?.size ?? 0) > 1) return false;
        }
    }
    return true;
}

const readTags = new WeakMap<Universe, Map<readonly Mod[], ReadonlySet<TagId>>>();

/** The tags the rows' weights read that the base does not carry. */
function readTagsOf(u: Universe, rows: readonly Mod[]): ReadonlySet<TagId> {
    let c = readTags.get(u);
    if (c === undefined) readTags.set(u, (c = new Map<readonly Mod[], ReadonlySet<TagId>>()));
    let reads = c.get(rows);
    if (reads === undefined) {
        const made = new Set<TagId>();
        for (const r of rows) for (const t of u.extraTags(r)) made.add(t);
        c.set(rows, (reads = made));
    }
    return reads;
}

function withoutCull(spec: Extract<PoolSpec, { kind: "natural" }>): PoolSpec {
    const { topTiers: _cull, ...rest } = spec;
    return rest;
}

/** The union of the diagrams, pairwise so a large one is rebuilt few times. */
export function unionOf(u: Universe, parts: readonly Dd[]): Dd {
    let level = [...parts];
    if (level.length === 0) return u.dd.EMPTY;
    while (level.length > 1) {
        const next: Dd[] = [];
        for (let i = 0; i < level.length; i += 2) {
            next.push(i + 1 < level.length ? u.dd.or(level[i]!, level[i + 1]!) : level[i]!);
        }
        level = next;
    }
    return level[0]!;
}
