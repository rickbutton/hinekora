/**
 * What the rest of the tool reads of a state (docs/EXACT.md §6), each fact
 * computed from the diagram and cached by its identity. Every view is exact:
 * "guaranteed" is on every item of the state, "possible" on some, a range is
 * the least and greatest over the items.
 */
import type { ItemSummary } from "../check/diagnostics.js";
import type { Range } from "../check/domain.js";
import { type Caps, caps } from "../model/capacity.js";
import { type Effect, effectsOf } from "../model/effects.js";
import type { Gen, GroupId, ModId, Rarity, TagId, TypeId } from "../model/ids.js";
import type { ItemFacts } from "../model/item.js";
import {
    type EldritchKey,
    type EldritchSide,
    eldritchKey,
    type InfluenceKey,
    influencesOf,
} from "../model/marks.js";
import type { Mod } from "../model/mod.js";
import type { Dd } from "./dd.js";
import type { XItem } from "./state.js";
import { type CountKind, type ModValue, RARITIES, type Universe } from "./universe.js";

const cache = new WeakMap<Dd, Map<string, unknown>>();

function memo<T>(s: XItem, key: string, f: () => T): T {
    let m = cache.get(s.dd);
    if (m === undefined) cache.set(s.dd, (m = new Map<string, unknown>()));
    if (m.has(key)) return m.get(key) as T;
    const r = f();
    m.set(key, r);
    return r;
}

/** The values each diagram slot takes over the items, by slot. */
function slotValues(s: XItem): readonly (readonly number[])[] {
    return memo(s, "slots", () => s.u.dd.valuesOfEach(s.dd));
}

const valuesAt = (s: XItem, slot: number): readonly number[] => slotValues(s)[slot]!;

/** The types of the universe with the values their slot takes, in slot order. */
function typeValues(
    s: XItem,
): readonly { type: TypeId; slot: number; values: readonly number[] }[] {
    return memo(s, "types", () =>
        s.u.modSlots().map((slot) => ({
            type: s.u.modSlot(slot)!.type,
            slot,
            values: valuesAt(s, slot),
        })),
    );
}

// --- counts -------------------------------------------------------------------

function extentOf(s: XItem, kind: CountKind): Range {
    return memo(s, `count:${kind}`, () => s.u.dd.extent(s.dd, s.u.weight(kind)) ?? [0, 0]);
}

export interface CountRanges {
    readonly total: Range;
    readonly prefix: Range;
    readonly suffix: Range;
}

/** The least and greatest number of affixes, prefixes and suffixes. */
export function counts(s: XItem): CountRanges {
    return {
        total: extentOf(s, "affix"),
        prefix: extentOf(s, "prefix"),
        suffix: extentOf(s, "suffix"),
    };
}

export function suffixRange(s: XItem): Range {
    return extentOf(s, "suffix");
}

/** The least and greatest number of crafted modifiers. */
export function craftedCount(s: XItem): Range {
    return extentOf(s, "crafted");
}

/** The least and greatest number of fractured modifiers. */
export function fracturedCount(s: XItem): Range {
    return extentOf(s, "fractured");
}

/** The least and greatest number of these types present: the k of "at least k
 *  of these" is the first. */
export function presentAmong(s: XItem, types: Iterable<TypeId>): Range {
    const slots = new Set<number>();
    for (const t of types) {
        const slot = s.u.slotOfType(t);
        if (slot !== undefined) slots.add(slot);
    }
    const key = `among:${[...slots].sort((x, y) => x - y).join(",")}`;
    return memo(
        s,
        key,
        () =>
            s.u.dd.extent(s.dd, (slot, value) => (value !== 0 && slots.has(slot) ? 1 : 0)) ?? [
                0, 0,
            ],
    );
}

// --- rarity and caps ------------------------------------------------------------

export function rarities(s: XItem): ReadonlySet<Rarity> {
    return memo(
        s,
        "rarities",
        () => new Set(valuesAt(s, s.u.scalar("rarity")).map((v) => RARITIES[v]!)),
    );
}

/** The one rarity every item has, or undefined while they differ. */
export function rarityOf(s: XItem): Rarity | undefined {
    const r = rarities(s);
    return r.size === 1 ? [...r][0] : undefined;
}

/** The caps over the items' rarities, each field picked by `pick`: `Math.max`
 *  for the loosest, `Math.min` for the tightest. */
export function capsOver(s: XItem, pick: (...n: number[]) => number): Caps {
    const all = [...rarities(s)].map((r) => caps(r, s.u.base));
    return {
        prefix: pick(...all.map((c) => c.prefix)),
        suffix: pick(...all.map((c) => c.suffix)),
        total: pick(...all.map((c) => c.total)),
    };
}

// --- the modifiers ------------------------------------------------------------

/** The types present on every item. */
export function guaranteedTypes(s: XItem): ReadonlySet<TypeId> {
    return memo(
        s,
        "guaranteed",
        () => new Set(typeValues(s).flatMap((t) => (t.values.includes(0) ? [] : [t.type]))),
    );
}

/** The types present on some item. */
export function possibleTypes(s: XItem): ReadonlySet<TypeId> {
    return memo(
        s,
        "possible",
        () => new Set(typeValues(s).flatMap((t) => (t.values.some((v) => v > 0) ? [t.type] : []))),
    );
}

/** The types of `among` (by default every type of the universe) absent from
 *  every item. A type the universe has no slot for is absent everywhere. */
export function excludedTypes(s: XItem, among?: Iterable<TypeId>): ReadonlySet<TypeId> {
    const possible = possibleTypes(s);
    const types = among ?? typeValues(s).map((t) => t.type);
    return new Set([...types].filter((t) => !possible.has(t)));
}

export function isGuaranteed(s: XItem, type: TypeId): boolean {
    return guaranteedTypes(s).has(type);
}

export function isExcluded(s: XItem, type: TypeId): boolean {
    return !possibleTypes(s).has(type);
}

function presentValues(s: XItem, type: TypeId): { slot: number; values: ModValue[] } | undefined {
    const slot = s.u.slotOfType(type);
    if (slot === undefined) return undefined;
    const ms = s.u.modSlot(slot)!;
    return { slot, values: valuesAt(s, slot).flatMap((v) => (v === 0 ? [] : [ms.values[v]!])) };
}

/** The rows the type is at on the items that carry it, best first: what the
 *  present checker's tier overlay approximates. Empty where it is absent. */
export function rowsOf(s: XItem, type: TypeId): readonly Mod[] {
    return memo(s, `rows:${type}`, () => {
        const at = presentValues(s, type);
        if (at === undefined) return [];
        const seen = new Set(at.values.map((v) => v.row));
        return s.u.modSlot(at.slot)!.rows.filter((r) => seen.has(r));
    });
}

/**
 * The span the type's value lies in over the items that carry it (at `row`
 * only, when given): the hull of the value cells present. Cells are cut only
 * at the craft's thresholds, so this is as fine as any condition can tell.
 * The hull is closed: a cell open at a threshold (on a span of fractions)
 * gives that threshold as its bound. Undefined where it is absent or has no
 * number.
 */
export function valueSpan(s: XItem, type: TypeId, row?: ModId): Range | undefined {
    const at = presentValues(s, type);
    if (at === undefined) return undefined;
    let lo = Infinity;
    let hi = -Infinity;
    for (const v of at.values) {
        if (v.cell === undefined || (row !== undefined && v.row.id !== row)) continue;
        lo = Math.min(lo, v.cell.lo);
        hi = Math.max(hi, v.cell.hi);
    }
    return lo > hi ? undefined : [lo, hi];
}

/** The types crafted on some item. */
export function craftedTypes(s: XItem): ReadonlySet<TypeId> {
    return memo(
        s,
        "craftedTypes",
        () =>
            new Set(
                typeValues(s).flatMap((t) =>
                    presentValues(s, t.type)!.values.some((v) => v.crafted) ? [t.type] : [],
                ),
            ),
    );
}

/** Is the type crafted on every item that carries it (and on some)? */
export function isCrafted(s: XItem, type: TypeId): boolean {
    const at = presentValues(s, type);
    return at !== undefined && at.values.length > 0 && at.values.every((v) => v.crafted);
}

/**
 * The least and greatest number of modifiers whose type is not one of
 * `named`, on the `gen` side when given (a value counts on its own row's
 * side): what a view that names `named` leaves unnamed.
 */
export function countOutside(s: XItem, named: ReadonlySet<TypeId>, gen?: Gen): Range {
    const key = `outside:${gen ?? "*"}:${[...named].sort().join(",")}`;
    return memo(s, key, () => {
        const counted = new Set(
            s.u.modSlots().filter((slot) => !named.has(s.u.modSlot(slot)!.type)),
        );
        const weight = (slot: number, value: number): number => {
            if (value === 0 || !counted.has(slot)) return 0;
            return gen === undefined || s.u.modSlot(slot)!.values[value]!.row.gen === gen ? 1 : 0;
        };
        return s.u.dd.extent(s.dd, weight) ?? [0, 0];
    });
}

/** Is the type present and fractured on every item? */
export function isFractured(s: XItem, type: TypeId): boolean {
    const at = presentValues(s, type);
    return (
        at !== undefined && !valuesAt(s, at.slot).includes(0) && at.values.every((v) => v.fractured)
    );
}

/** May the type be fractured: fractured on some item. */
export function mayBeFractured(s: XItem, type: TypeId): boolean {
    return presentValues(s, type)?.values.some((v) => v.fractured) ?? false;
}

/** The types fractured on every item. */
export function fracturedTypes(s: XItem): ReadonlySet<TypeId> {
    return memo(
        s,
        "fractured",
        () => new Set(typeValues(s).flatMap((t) => (isFractured(s, t.type) ? [t.type] : []))),
    );
}

/**
 * The fractured modifiers whose type is not fractured on every item, as a
 * range over the items: the fractured count less the types `fracturedTypes`
 * names, each of which is one of every item's fractured modifiers. Where a
 * lock may be is `mayBeFractured`.
 */
export function unprovenFractures(s: XItem): Range {
    const named = fracturedTypes(s).size;
    const [lo, hi] = fracturedCount(s);
    return [lo - named, hi - named];
}

// --- the marks ----------------------------------------------------------------

export function influenceSets(s: XItem): ReadonlySet<InfluenceKey> {
    return memo(
        s,
        "influences",
        () => new Set(valuesAt(s, s.u.scalar("influences")).map((v) => s.u.influenceKeys[v]!)),
    );
}

/** Whether the items are corrupted: `{false}`, `{true}` or both. */
export function corruptions(s: XItem): ReadonlySet<boolean> {
    return memo(
        s,
        "corrupted",
        () => new Set(valuesAt(s, s.u.scalar("corrupted")).map((v) => v === 1)),
    );
}

/** The pairs of eldritch tiers the items have, as `eldritchKey`s. */
export function eldritchPairs(s: XItem): ReadonlySet<EldritchKey> {
    return memo(s, "eldritch", () => {
        const m = s.u.dd;
        const exarch = s.u.scalar("exarchTier");
        const eater = s.u.scalar("eaterTier");
        const out = new Set<EldritchKey>();
        for (const a of valuesAt(s, exarch)) {
            const part = m.and(s.dd, m.slotIn(exarch, [a]));
            for (const e of m.valuesOf(part, eater)) out.add(eldritchKey(a, e));
        }
        return out;
    });
}

/** The implicits a side is on the items that have one, among those the
 *  catalogue names; an unnamed implicit adds none. */
export function eldritchTypes(s: XItem, side: EldritchSide): ReadonlySet<TypeId> {
    return memo(s, `eldritchTypes:${side}`, () => {
        const m = s.u.dd;
        const present = m.and(s.dd, m.slotIn(s.u.scalar(`${side}Tier`), tiersAbove0(s.u, side)));
        const names = s.u.eldritchTypes(side);
        return new Set(
            m.valuesOf(present, s.u.scalar(`${side}Type`)).flatMap((v) => names[v] ?? []),
        );
    });
}

/** Does some item carry an implicit of the side that the catalogue names
 *  no implicit for (exact/item.ts `CEldritch`)? */
export function unnamedImplicit(s: XItem, side: EldritchSide): boolean {
    const m = s.u.dd;
    const present = m.and(s.dd, m.slotIn(s.u.scalar(`${side}Tier`), tiersAbove0(s.u, side)));
    return m.valuesOf(present, s.u.scalar(`${side}Type`)).includes(0);
}

function tiersAbove0(u: Universe, side: EldritchSide): number[] {
    const n = u.dd.domains[u.scalar(`${side}Tier`)]!;
    return Array.from({ length: n - 1 }, (_, i) => i + 1);
}

/** The least and greatest number of memory strands. */
export function strandsRange(s: XItem): Range {
    const v = valuesAt(s, s.u.scalar("strands"));
    return [v[0]!, v[v.length - 1]!];
}

/** The influence tags the items carry: `sure` on every item, `maybe` on some
 *  only, read over the items' influence sets. */
export function influenceTagsOf(s: XItem): {
    readonly sure: ReadonlySet<TagId>;
    readonly maybe: ReadonlySet<TagId>;
} {
    return memo(s, "influenceTags", () => {
        const sets = [...influenceSets(s)].map(influencesOf);
        const sure = new Set<TagId>();
        const maybe = new Set<TagId>();
        for (const influence of new Set(sets.flat())) {
            const everywhere = sets.every((x) => x.includes(influence));
            for (const tag of s.u.registry.influenceTags(s.u.base, influence)) {
                (everywhere ? sure : maybe).add(tag);
            }
        }
        return { sure, maybe };
    });
}

/** The influence tags some item carries. */
export function influenceTagsAny(s: XItem): ReadonlySet<TagId> {
    const { sure, maybe } = influenceTagsOf(s);
    return new Set([...sure, ...maybe]);
}

/** What an error's words read of the items (check/diagnostics.ts). */
export function summaryOf(s: XItem): ItemSummary {
    return {
        base: s.u.base,
        ilvl: s.u.ilvl,
        rarities: rarities(s),
        counts: counts(s),
        influences: influenceSets(s),
        corrupted: corruptions(s),
        eldritch: eldritchPairs(s),
    };
}

// --- the imprint ----------------------------------------------------------------

/** Whether the items hold an imprint: `{false}` in a universe without one. */
export function imprintHeld(s: XItem): ReadonlySet<boolean> {
    if (!s.u.imprint) return new Set([false]);
    return new Set(valuesAt(s, s.u.held!).map((v) => v === 1));
}

const bare = new WeakMap<Universe, Dd>();

/** The items holding no imprint: every copy slot at its default. */
function noImprint(u: Universe): Dd {
    let r = bare.get(u);
    if (r === undefined) {
        r = u.dd.automaton<number>({
            init: 0,
            slots: [...u.itemSlots(true), u.held!],
            step: (_slot, value) => (value === 0 ? 0 : undefined),
            accept: () => true,
            key: () => 0,
        });
        bare.set(u, r);
    }
    return r;
}

/** The imprints the items hold, read as items of their own (holding none);
 *  undefined when no item holds one. */
export function imprintOf(s: XItem): XItem | undefined {
    if (!s.u.imprint) return undefined;
    return memo(s, "imprint", () => {
        const u = s.u;
        const m = u.dd;
        const held = m.and(s.dd, m.slotIn(u.held!, [1]));
        if (held === m.EMPTY) return undefined;
        const copy = m.forget(held, [...u.itemSlots(), u.held!]);
        const moved = m.rename(copy, (slot) => slot - 1);
        return { u, dd: m.and(moved, noImprint(u)) };
    });
}

// --- guarantees of "at least one of these" ---------------------------------------------

/** The most types a searched clause names by default. Past it the search
 *  grows with the types the items may carry; a consumer that already knows
 *  a group asks `atLeastOneOf` instead. */
export const MAX_CLAUSE = 3;

/** Does every item carry one of these types: the way to ask of a group known
 *  already (a pool's "one of", a `hasGroup` condition). */
export function atLeastOneOf(s: XItem, types: Iterable<TypeId>): boolean {
    return presentAmong(s, types)[0] >= 1;
}

/**
 * The minimal sets of types, each of two to `maxSize` types of `among` (by
 * default every type) and none guaranteed, such that every item carries one
 * of the set. These are exactly the positive clauses the items satisfy over
 * those types that no smaller such set implies: "at least one of these" with
 * nothing to drop. The search branches on an item that carries none of the
 * set so far, so it walks only what the items hold.
 */
export function disjunctiveGuarantees(
    s: XItem,
    among?: ReadonlySet<TypeId>,
    maxSize = MAX_CLAUSE,
): readonly (readonly TypeId[])[] {
    const key = `clauses:${among === undefined ? "*" : [...among].sort().join(",")}:${maxSize}`;
    return memo(s, key, () => {
        const u = s.u;
        const m = u.dd;
        const sure = guaranteedTypes(s);
        const eligible = (t: TypeId): boolean =>
            !sure.has(t) && (among === undefined || among.has(t));
        const found: TypeId[][] = [];
        const tried = new Set<string>();
        const go = (chosen: readonly TypeId[], rest: Dd): void => {
            const k = [...chosen].sort().join(",");
            if (tried.has(k)) return;
            tried.add(k);
            if (found.some((f) => f.every((t) => chosen.includes(t)))) return;
            if (rest === m.EMPTY) {
                found.push([...chosen].sort());
                return;
            }
            if (chosen.length >= maxSize) return;
            if (chosen.length === maxSize - 1) {
                // One type left to choose: it closes the clause only where every
                // item left carries it, which one pass over them tells for all.
                const values = m.valuesOfEach(rest);
                for (const slot of u.modSlots()) {
                    if (values[slot]!.includes(0)) continue;
                    const t = u.modSlot(slot)!.type;
                    if (eligible(t)) go([...chosen, t], m.EMPTY);
                }
                return;
            }
            const w = m.witness(rest)!;
            for (const slot of u.modSlots()) {
                if (w[slot] === 0) continue;
                const t = u.modSlot(slot)!.type;
                if (!eligible(t)) continue;
                go([...chosen, t], m.and(rest, m.slotIn(slot, [0])));
            }
        };
        go([], s.dd);
        const minimal = found.filter(
            (c) =>
                !found.some((f) => f !== c && f.length < c.length && f.every((t) => c.includes(t))),
        );
        return minimal.sort((a, b) => a.length - b.length || cmp(a.join(), b.join()));
    });
}

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** At least `atLeast` of `types` are on every item. */
export interface CardinalityGuarantee {
    readonly atLeast: number;
    readonly types: readonly TypeId[];
}

/** Does "at least `k` of `types`" make the clause true on every item: of the
 *  k present, at most those outside the clause can miss it. */
export function impliesClause(g: CardinalityGuarantee, clause: readonly TypeId[]): boolean {
    return g.atLeast - g.types.filter((t) => !clause.includes(t)).length >= 1;
}

/**
 * The clauses of `disjunctiveGuarantees` gathered into "at least k of these",
 * as few as cover them: clauses sharing a type are one problem; its candidate
 * groups are their types together, those of each side, and each of these less
 * one type or less one clause's types (so a side, or the item's own modifiers
 * apart from a pair that replaced one, can each be a group); the candidate
 * that implies the most clauses not yet implied is taken, the smaller first
 * on a tie, until every clause is. A clause is its own candidate, so this
 * ends; a clause no other group implies stays "at least one".
 */
export function cardinalityGuarantees(
    s: XItem,
    among?: ReadonlySet<TypeId>,
    maxSize = MAX_CLAUSE,
): readonly CardinalityGuarantee[] {
    const key = `cardinality:${among === undefined ? "*" : [...among].sort().join(",")}:${maxSize}`;
    return memo(s, key, () => {
        const clauses = disjunctiveGuarantees(s, among, maxSize);
        const problems: (readonly TypeId[])[][] = [];
        for (const c of clauses) {
            const joined = problems.filter((g) => g.some((d) => d.some((t) => c.includes(t))));
            const merged = [c, ...joined.flat()];
            for (const g of joined) problems.splice(problems.indexOf(g), 1);
            problems.push(merged);
        }
        const sideOf = (t: TypeId): Gen | undefined => {
            const sides = new Set(rowsOf(s, t).map((r) => r.gen));
            return sides.size === 1 ? [...sides][0] : undefined;
        };
        const out: CardinalityGuarantee[] = [];
        for (const problem of problems) {
            const union = [...new Set(problem.flat())].sort();
            const bases = [
                union,
                ...(["prefix", "suffix"] as const).map((g) => union.filter((t) => sideOf(t) === g)),
            ].filter((b) => b.length >= 2);
            const candidates = new Map<string, readonly TypeId[]>();
            const add = (types: readonly TypeId[]): void => {
                if (types.length >= 1) candidates.set(types.join(","), types);
            };
            for (const b of bases) {
                add(b);
                for (const t of b) add(b.filter((x) => x !== t));
                for (const c of problem) add(b.filter((x) => !c.includes(x)));
            }
            for (const c of problem) add([...c].sort());
            const groups: CardinalityGuarantee[] = [];
            for (const types of candidates.values()) {
                const atLeast = presentAmong(s, types)[0];
                if (atLeast >= 1) groups.push({ atLeast, types });
            }
            let open = [...problem];
            while (open.length > 0) {
                let best: { g: CardinalityGuarantee; n: number } | undefined;
                for (const g of groups) {
                    const n = open.filter((c) => impliesClause(g, c)).length;
                    if (
                        n > 0 &&
                        (best === undefined ||
                            n > best.n ||
                            (n === best.n && g.types.length < best.g.types.length))
                    ) {
                        best = { g, n };
                    }
                }
                const taken = best!.g;
                out.push(taken);
                open = open.filter((c) => !impliesClause(taken, c));
            }
        }
        return out;
    });
}

/**
 * For a clause, the row each member is at where it makes the clause true: the
 * one choice of a row per type such that every item carries some member at
 * its chosen row. Empty when no choice, or more than one, does.
 */
export function disjunctiveTier(s: XItem, types: readonly TypeId[]): Map<TypeId, ModId> {
    const u = s.u;
    const m = u.dd;
    const options = types.map((t) => ({ t, rows: rowsOf(s, t) }));
    if (options.some((o) => o.rows.length === 0)) return new Map();
    let combos = 1;
    for (const o of options) combos *= o.rows.length;
    if (combos > 256) return new Map();
    let chosen: Map<TypeId, ModId> | undefined;
    for (let i = 0; i < combos; i++) {
        let n = i;
        const pick = new Map<TypeId, ModId>();
        let some = m.EMPTY;
        for (const o of options) {
            const row = o.rows[n % o.rows.length]!;
            n = Math.floor(n / o.rows.length);
            pick.set(o.t, row.id);
            some = m.or(some, u.rowsDiagram([row.id]));
        }
        if (m.implies(s.dd, some)) {
            if (chosen !== undefined) return new Map();
            chosen = pick;
        }
    }
    return chosen ?? new Map<TypeId, ModId>();
}

/**
 * For "at least `atLeast` of these types", the rows of each member the
 * guarantee rests on: those it is at on the items that carry no more members
 * than the guarantee asks, where each member present is needed. Empty when
 * the items do not carry `atLeast` members at those rows, so the guarantee
 * names no rows; a member no such item needs keeps every row.
 */
export function clauseRows(
    s: XItem,
    types: readonly TypeId[],
    atLeast = 1,
): ReadonlyMap<TypeId, readonly Mod[]> {
    return memo(s, `clauseRows:${atLeast}:${[...types].sort().join(",")}`, () => {
        const u = s.u;
        const m = u.dd;
        const members = types.flatMap((t) => {
            const slot = u.slotOfType(t);
            return slot === undefined ? [] : [{ t, slot }];
        });
        const slots = new Set(members.map((x) => x.slot));
        const tight = m.and(
            s.dd,
            m.automaton<number>({
                init: 0,
                slots: [...slots].sort((a, b) => a - b),
                step: (_slot, value, c) => (value === 0 ? c : c + 1 > atLeast ? undefined : c + 1),
                accept: (c) => c === atLeast,
                key: (c) => c,
            }),
        );
        const out = new Map<TypeId, readonly Mod[]>();
        const pinned = new Map<number, ReadonlySet<ModId>>();
        for (const { t, slot } of members) {
            const ms = u.modSlot(slot)!;
            const needed = new Set(
                m.valuesOf(tight, slot).flatMap((v) => (v === 0 ? [] : [ms.values[v]!.row.id])),
            );
            const rows = rowsOf(s, t).filter((r) => needed.size === 0 || needed.has(r.id));
            out.set(t, rows);
            pinned.set(slot, new Set(rows.map((r) => r.id)));
        }
        const weight = (slot: number, value: number): number =>
            value !== 0 && pinned.get(slot)?.has(u.modSlot(slot)!.values[value]!.row.id) === true
                ? 1
                : 0;
        const fewest = m.extent(s.dd, weight)?.[0] ?? 0;
        return fewest >= atLeast ? out : new Map<TypeId, readonly Mod[]>();
    });
}

// --- pool facts ------------------------------------------------------------------

/**
 * What every item carries, as the facts the pool reads at Rare caps (model/item.ts
 * `ItemFacts`): the guaranteed types, counted on a side where every
 * row they are at sits on it; their families and the tags they add; the
 * effects every item's carriers share; the fewest strands when `strands`.
 */
export function guaranteedFacts(
    s: XItem,
    level = s.u.ilvl,
    strands = false,
    moreStrands = 0,
): ItemFacts {
    const types = guaranteedTypes(s);
    const families = new Set<GroupId>();
    const tags = new Set([...s.u.base.tags, ...influenceTagsOf(s).sure]);
    let prefixCount = 0;
    let suffixCount = 0;
    const effects: Effect[] = [];
    for (const t of types) {
        const rows = rowsOf(s, t);
        const sides = new Set<Gen>(rows.map((r) => r.gen));
        if (sides.size === 1) {
            if (sides.has("prefix")) prefixCount++;
            else suffixCount++;
        }
        for (const f of s.u.modSlot(s.u.slotOfType(t)!)!.families) families.add(f);
        for (const tag of rows[0]!.addsTags)
            if (rows.every((r) => r.addsTags.has(tag))) tags.add(tag);
        for (const e of effectsOf(rows[0]!)) {
            if (rows.every((r) => effectsOf(r).includes(e))) effects.push(e);
        }
    }
    const fewest = strandsRange(s)[0];
    return {
        base: s.u.base,
        ilvl: level,
        rarity: "rare",
        prefixCount,
        suffixCount,
        types,
        families,
        tags,
        effects,
        ...(strands && fewest > 0 && { strands: fewest + moreStrands }),
    };
}
