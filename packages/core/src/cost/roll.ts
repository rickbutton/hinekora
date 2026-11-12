/**
 * A method's roll: what one use of it draws, read off its operation sequence
 * and the item it is used on, as the pools and counts the race (`race.ts`)
 * needs. The item is the checker's set of items, the trace's or one narrowed
 * to a state the cost walk tracks (docs/cost.md §3), so the pool is the pool
 * of the facts every one of them holds (the base, the kept and fractured
 * modifiers, the influence). Nothing here lists outcomes; a roll is a few weighted
 * rows per side and a distribution of counts.
 */
import type { Gen, GroupId, TypeId } from "../model/ids.js";
import type { Base } from "../model/base.js";
import type { ItemFacts } from "../model/item.js";
import type { EldritchSide } from "../model/marks.js";
import type { Mod } from "../model/mod.js";
import { lookupWeight, pool } from "../pool/pool.js";
import { veiledPool } from "../pool/veiled.js";
import { FOULBORN_AS_STRANDS } from "../model/strands.js";
import { VEILED_PREFIX, VEILED_SUFFIX } from "../model/veiled.js";
import type { Registry } from "../resolve/registry.js";
import { rollableGen, rollableTiers } from "../resolve/tiers.js";
import { sideCap } from "../model/capacity.js";
import type { FillCount, Op, PoolSpec } from "../check/ops/types.js";
import { buildKey } from "../check/build.js";
import { effectsKey, partialProtections } from "../check/rules.js";
import type { Dd } from "../check/dd.js";
import { runMethod, type TransferResult } from "../check/method.js";
import type { ItemSet } from "../check/state.js";
import {
    capsOver,
    counts as countsOf,
    guaranteedFacts,
    guaranteedTypes,
    influenceTagsAny,
    possibleTypes,
    rarityOf,
    rowsOf,
    strandsRange,
    suffixRange,
} from "../check/views.js";
import { splitDistribution } from "./race.js";

/**
 * How the item's open ranges are read where the checker leaves them open, its
 * counts and its memory strands: the `estimate` takes a side's count and the
 * strands at their floors (exact for a reforge and for an item whose named
 * modifiers fill it) and a removal's count at the middle; `floors` and
 * `ceilings` take every range at that end, the two items at the ends of what
 * the checker allows, whose figures bracket the estimate.
 */
export type Reading = "estimate" | "floors" | "ceilings";

export interface Row {
    readonly mod: Mod;
    readonly weight: number;
}

/** One modifier type of a group: its rows and their weight together. */
export interface Member {
    readonly type: TypeId;
    readonly weight: number;
    readonly rows: readonly Row[];
}

/**
 * What one clock of the race stands for: the modifier types of one side that
 * exclude each other (Modifier § Group/family), so drawing one closes them
 * all. Which type the draw was is read off the members by weight share.
 */
export interface Group {
    readonly gen: Gen;
    readonly weight: number;
    readonly members: readonly Member[];
}

/** A modifier that is on the item after the roll for certain: kept through the
 *  reforge, or placed by the method before the random draws (an essence's
 *  grant). Its row is drawn among `rows` by weight. */
export interface Present {
    readonly type: TypeId;
    readonly gen: Gen;
    readonly rows: readonly Row[];
}

/** How many modifiers the race draws on each side, beyond the present ones. */
export interface CountCase {
    readonly prob: number;
    readonly prefix: number;
    readonly suffix: number;
}

export interface DrawVariant {
    readonly prob: number;
    readonly present: readonly Present[];
    readonly prefix: readonly Group[];
    readonly suffix: readonly Group[];
    readonly counts: readonly CountCase[];
    /** The modifiers of each side on the item before the fill that no
     *  condition names, when the item knows the side's count exactly; the
     *  counts after the fill are these, the present ones and the draws. */
    readonly before: Readonly<Record<Gen, number | undefined>>;
    /** The types some item before the fill holds and some does not: one of
     *  them the draws do not lay down may be on the item all the same. */
    readonly maybe: ReadonlySet<TypeId>;
    /** The slots each side has open for the draws. */
    readonly room: Readonly<Record<Gen, number>>;
}

/** One candidate of a uniform pick: a removal or a fracture lands on one of them. */
export interface Candidate {
    readonly type: TypeId;
    readonly prob: number;
    /** The side the modifier sits on, when a removal's count depends on it. */
    readonly gen?: Gen;
}

export type Roll =
    /** A fill: a weighted draw of some modifiers from the pool, possibly a
     *  mixture (a Harvest reforge places one of several tagged rows first). */
    | { readonly kind: "draw"; readonly variants: readonly DrawVariant[] }
    /** A random removal, uniform over the modifiers it can reach (Q61): the
     *  named candidates, and the rest of the reachable count on each side. */
    | {
          readonly kind: "removal";
          readonly candidates: readonly Candidate[];
          /** The item before the removal, which knows the candidates' tiers. */
          readonly before: ItemSet;
          /** How many modifiers each side holds, and the chance the removal takes
           *  one of that side that no candidate names. */
          readonly sides: Readonly<
              Record<Gen, { readonly count: number; readonly unnamed: number }>
          >;
          /** The one side the removal reaches, when the method or a
           *  protecting metamod limits it to one. */
          readonly gen?: Gen;
      }
    /** A Divine Orb: every value rolled again within its tier. */
    | { readonly kind: "reroll" }
    /** A fracture, uniform over the modifiers present. */
    | { readonly kind: "lock"; readonly candidates: readonly Candidate[] }
    /** An unveil: three options (Veiled modifier) from these modifier types,
     *  drawn as `unveilOffers` takes them to be. */
    | { readonly kind: "unveil"; readonly options: readonly Member[] }
    /** An ember or ichor: one implicit of the tier, by weight. */
    | {
          readonly kind: "implicit";
          readonly side: "exarch" | "eater";
          readonly tier: number;
          readonly options: readonly Candidate[];
      }
    /** Nothing this model reads: a deterministic step, or one it does not model. */
    | { readonly kind: "none" };

const NO_ROLL: Roll = { kind: "none" };

/**
 * How many modifiers a rare reforge lays down: four, five or six at 8:3:1
 * (Chaos Orb § Mechanics), the ratio every rare reforge is taken to share
 * (QUESTIONS.md Q59); a base holding four, a jewel, takes three or four
 * (Orb of Alchemy) at 65:35 and a Magic item one or two at even odds (Q58),
 * craftofexile's readings where the wiki gives no ratio.
 */
function countDistribution(
    range: readonly [number, number],
    maxTotal: number,
): Map<number, number> {
    // The library's rare range clamps to a jewel's four; the game rolls three or four.
    if (maxTotal < range[1] && maxTotal >= 4 && range[0] >= 4) {
        return new Map([
            [maxTotal - 1, 0.65],
            [maxTotal, 0.35],
        ]);
    }
    const hi = Math.min(range[1], maxTotal);
    const lo = Math.min(range[0], hi);
    const out = new Map<number, number>();
    if (hi - lo >= 2) {
        out.set(hi - 2, 8 / 12);
        out.set(hi - 1, 3 / 12);
        out.set(hi, 1 / 12);
    } else if (hi - lo === 1) {
        if (hi >= 4) {
            out.set(lo, 0.65);
            out.set(hi, 0.35);
        } else {
            out.set(lo, 0.5);
            out.set(hi, 0.5);
        }
    } else {
        out.set(hi, 1);
    }
    return out;
}

function countCases(
    prefix: readonly Group[],
    suffix: readonly Group[],
    m: number,
    capPrefix: number,
    capSuffix: number,
): CountCase[] {
    // A count the open slots cannot take lays down what fits: an Eldritch
    // Chaos Orb's four to six count the kept side, and the rerolled side
    // holds three at most.
    const room =
        Math.min(Math.max(0, capPrefix), prefix.length) +
        Math.min(Math.max(0, capSuffix), suffix.length);
    const draws = Math.min(m, room);
    if (draws <= 0) return [{ prob: 1, prefix: 0, suffix: 0 }];
    const split = splitOf(
        prefix.map((g) => g.weight),
        suffix.map((g) => g.weight),
        draws,
        capPrefix,
        capSuffix,
    );
    const cases: CountCase[] = [];
    split.forEach((prob, p) => {
        if (prob > 0) cases.push({ prob, prefix: p, suffix: draws - p });
    });
    return cases;
}

function splitOf(
    prefix: readonly number[],
    suffix: readonly number[],
    m: number,
    capPrefix: number,
    capSuffix: number,
): readonly number[] {
    return splitDistribution(prefix, suffix, m, Math.max(0, capPrefix), Math.max(0, capSuffix));
}

/**
 * The counts a reading takes the item at. The estimate and the floors read each
 * side at its floor. The ceilings read the fullest item the counts allow: the
 * total at its ceiling, split between the sides as evenly as their own ceilings
 * let it, since the sides' ceilings alone may add up to more than the item can
 * hold and would show a full item where the checker proved a slot open.
 */
function countsAt(a: ItemSet, reading: Reading): Readonly<Record<Gen, number>> {
    const prefix = countsOf(a).prefix;
    const suffix = suffixRange(a);
    if (reading !== "ceilings") return { prefix: prefix[0], suffix: suffix[0] };
    const total = countsOf(a).total[1];
    let p = Math.min(prefix[1], Math.ceil(total / 2));
    const s = Math.min(suffix[1], total - p);
    p = Math.min(prefix[1], total - s);
    return { prefix: p, suffix: s };
}

/** The item's facts the pool reads: the guaranteed modifiers, with each side's
 *  count raised to what the reading takes it at, so a side the unnamed
 *  modifiers fill admits nothing more. */
function sureFacts(a: ItemSet, level?: number, reading: Reading = "estimate", withStrands = false) {
    const facts = guaranteedFacts(a, level);
    const counts = countsAt(a, reading);
    const strands = withStrands ? strandsRange(a)[reading === "ceilings" ? 1 : 0] : 0;
    return {
        ...facts,
        prefixCount: Math.max(facts.prefixCount, counts.prefix),
        suffixCount: Math.max(facts.suffixCount, counts.suffix),
        ...(strands > 0 && { strands }),
    };
}

/** The rows a draw can land, by modifier type. */
function membersOf(rows: readonly Row[]): Member[] {
    const byType = new Map<TypeId, Row[]>();
    for (const r of rows) {
        if (!(r.weight > 0)) continue;
        const known = byType.get(r.mod.type);
        if (known) known.push(r);
        else byType.set(r.mod.type, [r]);
    }
    return [...byType].map(([type, list]) => ({
        type,
        weight: list.reduce((s, r) => s + r.weight, 0),
        rows: list,
    }));
}

/**
 * The rows as the race's clocks: the types of a side that share a modifier
 * group are one clock. A type listing several groups joins a clock only where
 * it excludes every type already in it, so a clock never closes two types the
 * game would draw together; the exclusions that leaves out are missed, the
 * draw a little too generous to those types.
 */
function groupRows(rows: readonly Row[], genOf: (m: Mod) => Gen): Group[] {
    const clocks: { gen: Gen; families: ReadonlySet<GroupId>[]; members: Member[] }[] = [];
    for (const member of membersOf(rows)) {
        const { families } = member.rows[0]!.mod;
        const gen = genOf(member.rows[0]!.mod);
        const home = clocks.find(
            (c) =>
                c.gen === gen &&
                c.families.every((other) => [...families].some((f) => other.has(f))),
        );
        if (home === undefined) clocks.push({ gen, families: [families], members: [member] });
        else {
            home.families.push(families);
            home.members.push(member);
        }
    }
    return clocks.map((c) => ({
        gen: c.gen,
        weight: c.members.reduce((s, m) => s + m.weight, 0),
        members: c.members,
    }));
}

/** How many groups with rows on both sides a draw follows exactly. */
const MAX_CROSSING = 3;

/**
 * A modifier group with rows on both sides (a jewel's damage group) is one
 * clock whose draw lands on a side by that side's share of its weight: the
 * roll becomes a mixture, the group wholly a prefix in one part and wholly a
 * suffix in the other. Exact but for a draw the full side turns away, after
 * which the game could still draw the group's other side. Past `MAX_CROSSING`
 * such groups the lighter ones stay a clock on each side.
 */
function crossings(
    prefix: readonly Group[],
    suffix: readonly Group[],
): { prob: number; prefix: readonly Group[]; suffix: readonly Group[] }[] {
    const familiesOf = (g: Group): Set<GroupId> =>
        new Set(g.members.flatMap((m) => [...m.rows[0]!.mod.families]));
    const suffixFamilies = suffix.map(familiesOf);
    const pairs: { p: Group; s: Group }[] = [];
    const used = new Set<Group>();
    for (const p of prefix) {
        const own = familiesOf(p);
        const s = suffix.find(
            (g, i) => !used.has(g) && [...suffixFamilies[i]!].some((f) => own.has(f)),
        );
        if (s === undefined) continue;
        used.add(s);
        pairs.push({ p, s });
    }
    pairs.sort((x, y) => Math.min(y.p.weight, y.s.weight) - Math.min(x.p.weight, x.s.weight));
    let out = [{ prob: 1, prefix, suffix }];
    for (const { p, s } of pairs.slice(0, MAX_CROSSING)) {
        const total = p.weight + s.weight;
        const whole = (g: Group): Group => ({
            ...g,
            weight: total,
            members: g.members.map((m) => ({ ...m, weight: (m.weight * total) / g.weight })),
        });
        out = out.flatMap((v) => [
            {
                prob: (v.prob * p.weight) / total,
                prefix: v.prefix.map((g) => (g === p ? whole(p) : g)),
                suffix: v.suffix.filter((g) => g !== s),
            },
            {
                prob: (v.prob * s.weight) / total,
                prefix: v.prefix.filter((g) => g !== p),
                suffix: v.suffix.map((g) => (g === s ? whole(s) : g)),
            },
        ]);
    }
    return out;
}

/** The groups without the types a modifier now on the item excludes: its own
 *  type and every type sharing a modifier group with it. */
export function withoutClosed(
    groups: readonly Group[],
    type: TypeId,
    mod: Mod | undefined,
): Group[] {
    const out: Group[] = [];
    for (const g of groups) {
        const members = g.members.filter(
            (m) =>
                m.type !== type &&
                !(
                    mod !== undefined &&
                    [...m.rows[0]!.mod.families].some((f) => mod.families.has(f))
                ),
        );
        if (members.length === g.members.length) out.push(g);
        else if (members.length > 0)
            out.push({ ...g, members, weight: members.reduce((s, m) => s + m.weight, 0) });
    }
    return out;
}

/**
 * Which modifier each drawn group turned out to be, as far as anyone asks:
 * one of its members a condition names, by its share of the group's weight,
 * or some other member. Each case lists the named members drawn.
 */
export function memberCases(
    drawn: readonly Group[],
    named: (type: TypeId) => boolean,
): { readonly prob: number; readonly members: readonly Member[] }[] {
    let cases: { prob: number; members: readonly Member[] }[] = [{ prob: 1, members: [] }];
    for (const g of drawn) {
        const own = g.members.filter((m) => named(m.type));
        const rest = g.weight - own.reduce((s, m) => s + m.weight, 0);
        const next: typeof cases = [];
        for (const c of cases) {
            for (const m of own) {
                next.push({ prob: (c.prob * m.weight) / g.weight, members: [...c.members, m] });
            }
            if (rest > 1e-12 * g.weight)
                next.push({ prob: (c.prob * rest) / g.weight, members: c.members });
        }
        cases = next;
    }
    return cases;
}

/** Whether a group holds a type someone names. */
export function holdsNamed(g: Group, named: (type: TypeId) => boolean): boolean {
    return g.members.some((m) => named(m.type));
}

/** Of a type's `n` eligible tiers a Foulborn orb lets the top `k` roll, each
 *  kept row's weight scaled by `n / k` so the type keeps its share against the
 *  others (Foulborn currency § Mechanics). */
export function foulbornRows(rows: readonly Row[]): Row[] {
    const byType = new Map<TypeId, Row[]>();
    for (const r of rows) {
        const list = byType.get(r.mod.type);
        if (list) list.push(r);
        else byType.set(r.mod.type, [r]);
    }
    const out: Row[] = [];
    for (const list of byType.values()) {
        const sorted = [...list].sort((x, y) => y.mod.minLevel - x.mod.minLevel);
        const n = sorted.length;
        const kept = n <= 6 ? Math.ceil(n / 2) : Math.floor(n / 2) + 1;
        for (const r of sorted.slice(0, kept))
            out.push({ mod: r.mod, weight: (r.weight * n) / kept });
    }
    return out;
}

/** The two fossils whose effect is not a tag's multiplier, by the game's names. */
const SANCTIFIED = "Sanctified Fossil";
const TANGLED = "Tangled Fossil";

/**
 * Why a method's roll is not read, where a rule of it is not modelled: the
 * Tangled Fossil gives one category of modifier, picked at random when the
 * resonator is socketed, far more weight and bars another (Tangled Fossil §
 * Mechanics), so the pool it rolls from is not one pool.
 */
export function unmodelled(
    ops: readonly Op[],
    item?: ItemSet,
    registry?: Registry,
): string | undefined {
    const tangled = ops.some(
        (op) =>
            op.kind === "fill" &&
            op.pool.kind === "fossil" &&
            op.pool.fossils.some((f) => f.name === TANGLED),
    );
    if (tangled) {
        return "a Tangled Fossil makes one kind of modifier, picked at random, far likelier and bars another, which is not modelled, so the chances after it are not known";
    }
    if (item !== undefined && registry !== undefined && removes(ops)) {
        const partial = partialReadings(registry, possibleTypes(item));
        if (keepsBeyondRemoval(ops) && partial.size > 0) {
            return "a metamod keeps some of a side's modifiers, chosen at random each use, which this step's chances are not read under, so the chances after it are not known";
        }
        if ([...partial.values()].some((counts) => counts.length > 1)) {
            return "two metamods each keep some modifiers of one side, and how many they keep together is not known, so the chances after this step are not known";
        }
    }
    return undefined;
}

/** Does the method take or replace any modifier? */
function removes(ops: readonly Op[]): boolean {
    return ops.some(
        (op) =>
            op.kind === "strip" ||
            op.kind === "reroll" ||
            op.kind === "elevate" ||
            op.kind === "remove" ||
            (op.kind === "either" && removes(op.branches.flat())),
    );
}

/** Does the method keep modifiers a protection holds otherwise than by one
 *  random removal: a strip, a reroll, an upgrade, a removal of a named or an
 *  influenced modifier, or a removal that spares what it added? */
function keepsBeyondRemoval(ops: readonly Op[]): boolean {
    return ops.some(
        (op) =>
            op.kind === "strip" ||
            op.kind === "reroll" ||
            op.kind === "elevate" ||
            (op.kind === "remove" &&
                (op.selector.kind !== "random" || op.selector.sparing !== undefined)) ||
            (op.kind === "either" && keepsBeyondRemoval(op.branches.flat())),
    );
}

/** By side, every count of modifiers the checker reads the partial
 *  protections among `types` as keeping. */
function partialReadings(
    registry: Registry,
    types: Iterable<TypeId>,
): ReadonlyMap<Gen, readonly number[]> {
    return partialProtections([...types].flatMap((t) => [...registry.effectsOfType(t)]));
}

/**
 * The weighted rows a pool holds on the item as it stands before the fill:
 * the natural pool at the level asked, narrowed or re-weighted as the pool
 * says. Empty for a pool this model does not read.
 */
function poolRows(
    a: ItemSet,
    spec: PoolSpec,
    registry: Registry,
    reading: Reading = "estimate",
    stranded = false,
): Row[] {
    // Only a method that uses memory strands up has its fill cut by them.
    const natural = (level?: number, withStrands = false, more = 0): Row[] => {
        const facts = sureFacts(a, level, reading, withStrands);
        const cut =
            facts.strands === undefined ? facts : { ...facts, strands: facts.strands + more };
        return [...poolOf(registry, cut)];
    };
    switch (spec.kind) {
        case "natural": {
            const cap = spec.maxLevel ?? Infinity;
            // On an item holding strands a Foulborn orb is one cut, the
            // strands' at thirty more, not its own after theirs (Memory strand
            // § Mechanics), as the checker reads it.
            const held = stranded ? strandsRange(a)[reading === "ceilings" ? 1 : 0] : 0;
            const asStrands = spec.topTiers === true && held > 0;
            const rows = natural(spec.level, stranded, asStrands ? FOULBORN_AS_STRANDS : 0).filter(
                (r) => r.mod.minLevel <= cap && (spec.gen === undefined || r.mod.gen === spec.gen),
            );
            return spec.topTiers && !asStrands ? foulbornRows(rows) : rows;
        }
        case "tagged":
            return natural().filter((r) => r.mod.implicitTags.has(spec.tag));
        case "fossil": {
            // A fossil's "more" multiplies the weight of the rows carrying its
            // tags, once per fossil (the larger when two of its tags match), the
            // fossils' "more" multipliers adding up (Fossil § Mechanics, "Fossil
            // weight multipliers"; QUESTIONS.md Q60). A "fewer" multiplies what that
            // leaves, as craftofexile reads it: a sample of a thousand
            // Sanctified and Pristine reforges from 2020, when the Pristine
            // Fossil had life at ten times and flat life regeneration at a
            // tenth, shows the regeneration at its plain rate, ten times a
            // tenth, where adding the two would give ten times. The rows a
            // fossil blocks are gone.
            const sanctified = spec.fossils.some((f) => f.name === SANCTIFIED);
            const multiplier = (m: Mod): number => {
                let more = 0;
                let fewer = 1;
                for (const f of spec.fossils) {
                    let best = 0;
                    for (const [tag, w] of f.weights) {
                        if (!m.implicitTags.has(tag)) continue;
                        if (w >= 100) best = Math.max(best, w);
                        else fewer *= w / 100;
                    }
                    more += best / 100;
                }
                // Sanctified Fossil § Further analysis: a hundredth more for each
                // level a row requires above forty, a hundredth less below.
                const level = sanctified ? 1 + (m.minLevel - 40) / 100 : 1;
                return (more > 0 ? more : 1) * fewer * level;
            };
            const untagged = (m: Mod): boolean => spec.noTagless && m.implicitTags.size === 0;
            const blocked = (m: Mod): boolean =>
                [...m.implicitTags].some((t) => spec.blocked.has(t));
            const rows = natural()
                .filter((r) => !blocked(r.mod) && !untagged(r.mod))
                .map((r) => ({ mod: r.mod, weight: r.weight * multiplier(r.mod) }));
            for (const m of spec.added) {
                if (blocked(m) || m.minLevel > a.u.ilvl) continue;
                const w = lookupWeight(m, a.u.base.tags) ?? 0;
                if (w > 0) rows.push({ mod: m, weight: w * multiplier(m) });
            }
            return rows;
        }
        case "influence": {
            // The rows the influence admits: in the pool with the influence's
            // tags and not without them.
            const facts = sureFacts(a, undefined, reading, stranded);
            const tags = influenceTagsAny(a);
            const plain = new Set(
                pool(registry.catalog, {
                    ...facts,
                    tags: new Set([...facts.tags].filter((t) => !tags.has(t))),
                }).map((c) => c.mod.id),
            );
            return natural(undefined, stranded).filter((r) => !plain.has(r.mod.id));
        }
        case "unveil": {
            const families = new Set<GroupId>();
            for (const t of guaranteedTypes(a)) {
                for (const f of registry.familiesOfType(t)) families.add(f);
            }
            return veiledPool(registry.catalog, a.u.base, a.u.ilvl, families).map((m) => ({
                mod: m,
                weight: lookupWeight(m, a.u.base.tags) ?? 1,
            }));
        }
        case "bench":
            return [{ mod: spec.mod, weight: 1 }];
        case "essenceGrant": {
            const id = spec.spec.grants.get(a.u.base.itemClass);
            const mod = id === undefined ? undefined : registry.resolveMod(id);
            return mod?.ok ? [{ mod: mod.value, weight: 1 }] : [];
        }
        case "rows":
            return spec.mods.map((mod) => ({ mod, weight: 1 }));
        case "veiledPlaceholder": {
            // A veiled prefix or a veiled suffix, alike: the placeholders carry
            // no spawn weight to say otherwise.
            const rows = registry.catalog.filter(
                (m) => m.type === VEILED_PREFIX || m.type === VEILED_SUFFIX,
            );
            const of = (gen: Gen): number => rows.filter((m) => m.gen === gen).length;
            return rows.map((mod) => ({ mod, weight: 1 / of(mod.gen) }));
        }
        case "metamods":
            return [];
    }
}

const pools = new WeakMap<Registry, Map<string, readonly Row[]>>();
const sorted = (xs: Iterable<string>): string => [...xs].sort().join(",");

/** The natural pool on these facts, kept by what they say: the tracked states
 *  of a walk share a few sets of facts among many items. */
function poolOf(registry: Registry, facts: ItemFacts): readonly Row[] {
    let byFacts = pools.get(registry);
    if (byFacts === undefined) pools.set(registry, (byFacts = new Map<string, readonly Row[]>()));
    const key = [
        facts.base.id,
        facts.ilvl,
        facts.rarity,
        facts.prefixCount,
        facts.suffixCount,
        facts.strands ?? "",
        sorted(facts.types),
        sorted(facts.families),
        sorted(facts.tags),
        effectsKey(facts.effects),
    ].join("|");
    let rows = byFacts.get(key);
    if (rows === undefined) {
        rows = pool(registry.catalog, facts).map((c) => ({ mod: c.mod, weight: c.weight }));
        byFacts.set(key, rows);
    }
    return rows;
}

/** The groups a modifier the item holds but no one names could be, per side:
 *  its natural pool on the item, the groups of what it surely holds left out. */
export function naturalGroups(
    a: ItemSet,
    registry: Registry,
): { readonly prefix: readonly Group[]; readonly suffix: readonly Group[] } {
    // The pool those modifiers were rolled from: the item's sure facts alone,
    // the unnamed ones not yet on it, or a side they fill would admit none.
    const rows = poolOf(registry, guaranteedFacts(a));
    const taken = guaranteedTypes(a);
    const groups = groupRows(
        rows.filter((r) => !taken.has(r.mod.type)),
        (m) => genOfType(a, registry, m.type, m),
    );
    return {
        prefix: groups.filter((g) => g.gen === "prefix"),
        suffix: groups.filter((g) => g.gen === "suffix"),
    };
}

/** The side a type's rows take on this item. */
function genOfType(a: ItemSet, registry: Registry, type: TypeId, hint?: Mod): Gen {
    return (
        rollableGen(registry.catalog, a.u.base, a.u.ilvl, type, influenceTagsAny(a)) ??
        hint?.gen ??
        registry.genOfType(type) ??
        "prefix"
    );
}

/** The side a modifier of these rows takes on the item: its type's on the
 *  base where the base rolls it, else the one its rows share (a bench craft
 *  of a type whose rows sit on both sides elsewhere). */
function sideOf(a: ItemSet, registry: Registry, rows: readonly Row[]): Gen {
    const first = rows[0]?.mod;
    if (first === undefined || rows.some((r) => (r.mod.source ?? "natural") === "natural")) {
        return genOfType(a, registry, first?.type ?? ("" as TypeId), first);
    }
    const sides = new Set(rows.map((r) => r.mod.gen));
    return sides.size === 1 ? first.gen : genOfType(a, registry, first.type, first);
}

/** The side the items hold a type on, as `sideOf` reads its rows. */
function heldSide(a: ItemSet, registry: Registry, type: TypeId): Gen {
    const rows = rowsOf(a, type).map((mod) => ({ mod, weight: 1 }));
    return rows.length === 0 ? genOfType(a, registry, type) : sideOf(a, registry, rows);
}

/** The modifiers present on every item of `a`, each with the rows it may be. */
function presentOn(a: ItemSet, registry: Registry): Present[] {
    const tags = influenceTagsAny(a);
    const out: Present[] = [];
    for (const type of guaranteedTypes(a)) {
        const pinned = new Set(rowsOf(a, type).map((m) => m.id));
        const weightOf = (m: Mod): number | null =>
            lookupWeight(m, new Set([...a.u.base.tags, ...tags]));
        let rows: Row[] = rollableTiers(registry.catalog, a.u.base, a.u.ilvl, type, tags).map(
            (m) => ({
                mod: m,
                weight: weightOf(m) ?? 1,
            }),
        );
        rows = rows.filter((r) => pinned.has(r.mod.id));
        if (rows.length < pinned.size) {
            // A row the ladder at the item's level lacks: a bench, essence
            // or unveiled row, or a natural row above that level, which an
            // essence places and a Harvest change leaves (it keeps the
            // tier). It may stand beside rows of the ladder where paths
            // meet. It weighs by its spawn weight as they do, and one
            // where it never spawns.
            const held = new Set(rows.map((r) => r.mod.id));
            for (const m of registry.catalog) {
                if (pinned.has(m.id) && !held.has(m.id))
                    rows.push({ mod: m, weight: weightOf(m) || 1 });
            }
        }
        out.push({ type, gen: sideOf(a, registry, rows), rows });
    }
    return out;
}

/** The eldritch implicits of a tier a base can take on one side, each row
 *  with the weight an ember or ichor of the tier draws it at. */
export function implicitWeights(
    registry: Registry,
    base: Base,
    side: EldritchSide,
    tier: number,
): { readonly type: TypeId; readonly weight: number }[] {
    return registry.eldritchPool(base, side, tier).map((e) => {
        let weight = 0;
        for (const [tag, w] of e.weights) if (base.tags.has(tag)) weight = Math.max(weight, w);
        return { type: e.type, weight };
    });
}

const runs = new WeakMap<Dd, Map<string, TransferResult>>();
const opsKeys = new WeakMap<readonly Op[], string>();

/**
 * The method's first `end` operations run on the items, its requirements
 * among them: where they refuse some items, the run goes on as the checker's
 * does, from those that pass or else from its recovery, so no operation is
 * run on an item its requirements turn away. The cost walk asks this of the same
 * items again and again, as each tracked state's outcomes and its share of a
 * draw are read, and a re-check after an edit hands it the same diagrams, so
 * the runs are kept by the items' diagram and what the operations say.
 */
export function ranOn(a: ItemSet, ops: readonly Op[], end = ops.length): TransferResult {
    const steps = ops.slice(0, end);
    if (steps.length === 0) return { ok: true, state: a };
    let said = opsKeys.get(ops);
    if (said === undefined) opsKeys.set(ops, (said = buildKey(ops)));
    let byOps = runs.get(a.dd);
    if (byOps === undefined) runs.set(a.dd, (byOps = new Map<string, TransferResult>()));
    const key = `${end}:${said}`;
    const hit = byOps.get(key);
    if (hit !== undefined) return hit;
    const r = runMethod(a, steps);
    byOps.set(key, r);
    return r;
}

/** The total a reforge may reach on this item, the loosest cap over its rarities. */
function totalCap(a: ItemSet): number {
    return capsOver(a, Math.max).total;
}

interface FillPlan {
    readonly spec: PoolSpec;
    readonly count: FillCount;
    /** The item as the fill finds it: after the strip and the removals before it. */
    readonly before: ItemSet;
}

/**
 * Read a method's operations into its roll on the item `a`: the random fill with
 * the pools and counts it draws, the forced rows placed beside it, or a random
 * removal, fracture, unveil or implicit. A method whose randomness this model
 * does not read (a Vaal Orb's outcomes, a Bestiary's random metamod) is
 * `none`.
 */
export function rollOf(
    a: ItemSet,
    ops: readonly Op[],
    registry: Registry,
    reading: Reading = "estimate",
): Roll {
    if (unmodelled(ops, a, registry) !== undefined) return NO_ROLL;
    let main: FillPlan | undefined;
    const forced: FillPlan[] = [];
    const stranded = ops.some((op) => op.kind === "strands");
    for (let i = 0; i < ops.length; i++) {
        const op = ops[i]!;
        switch (op.kind) {
            case "fill": {
                // A veiled modifier added on its own is the tracker's to place
                // (`veiledSides`); one a reforge lays down is placed first here.
                if (op.pool.kind === "veiledPlaceholder" && op.count.kind !== "within") break;
                const before = ranOn(a, ops, i).state;
                if (op.pool.kind === "unveil") {
                    return unveilRoll(before, op.pool, registry, reading);
                }
                if (op.count.kind === "within") {
                    // The forced row goes down before the draws (`drawRoll`), so
                    // one listed after the main fill reads the item that fill
                    // starts from: after it, a side the draws may fill reads full.
                    forced.push({ spec: op.pool, count: op.count, before: main?.before ?? before });
                } else if (main === undefined) {
                    main = { spec: op.pool, count: op.count, before };
                } else {
                    return NO_ROLL;
                }
                break;
            }
            case "remove":
                if (main === undefined && op.selector.kind === "random") {
                    const before = ranOn(a, ops, i).state;
                    const after = ranOn(a, ops, i + 1).state;
                    const fillsAfter = ops
                        .slice(i + 1)
                        .some((o) => o.kind === "fill" && o.pool.kind !== "veiledPlaceholder");
                    if (!fillsAfter) {
                        return removalRoll(before, after, op.selector.gen, registry, reading);
                    }
                }
                break;
            case "reroll":
                return { kind: "reroll" };
            case "lock": {
                const before = ranOn(a, ops, i).state;
                const types = [...guaranteedTypes(before)];
                const n = Math.max(countsOf(before).total[0], types.length, 1);
                return {
                    kind: "lock",
                    candidates: types.map((type) => ({ type, prob: 1 / n })),
                };
            }
            case "eldritch":
                if (op.change.kind === "set") {
                    const rows = implicitWeights(
                        registry,
                        a.u.base,
                        op.change.side,
                        op.change.tier,
                    );
                    const total = rows.reduce((s, r) => s + r.weight, 0);
                    if (total <= 0) return NO_ROLL;
                    const byType = new Map<TypeId, number>();
                    for (const r of rows)
                        byType.set(r.type, (byType.get(r.type) ?? 0) + r.weight / total);
                    return {
                        kind: "implicit",
                        side: op.change.side,
                        tier: op.change.tier,
                        options: [...byType].map(([type, prob]) => ({ type, prob })),
                    };
                }
                return NO_ROLL;
            case "either":
                return NO_ROLL;
            default:
                break;
        }
    }
    // Forced rows alone (a bench craft, a Harvest change) draw nothing: the
    // checker's item says what they placed.
    return main === undefined ? NO_ROLL : drawRoll(main, forced, registry, reading, stranded);
}

/**
 * A random removal: the modifiers it may take are those guaranteed before and
 * not after on the sides it reaches, each as likely as any other modifier
 * there; what the item holds beyond the named ones is the unnamed share of
 * each side. The counts are read at the middle of their ranges, or at the
 * end the reading asks for.
 */
function removalRoll(
    before: ItemSet,
    after: ItemSet,
    gen: Gen | undefined,
    registry: Registry,
    reading: Reading,
): Roll {
    const kept = guaranteedTypes(after);
    const reachable = [...guaranteedTypes(before)].filter((t) => !kept.has(t));
    const at = countsAt(before, reading);
    const mid = (gen: Gen): number => {
        const r = gen === "prefix" ? countsOf(before).prefix : suffixRange(before);
        return reading === "estimate" ? (r[0] + r[1]) / 2 : at[gen];
    };
    // A side a metamod protects, or the other side of a one-sided orb, is out
    // of the removal's reach.
    const protectedSides = new Set<Gen>();
    for (const t of guaranteedTypes(before)) {
        for (const e of registry.effectsOfType(t))
            if (e.kind === "protect") protectedSides.add(e.gen);
    }
    // A partial protection keeps that many of its side's modifiers, each
    // choice of them as likely (QUESTIONS.md Q128): a modifier of the side is
    // out of reach in that share of the uses, and the side holds that many
    // fewer to take.
    // A side with several readings never gets here (`unmodelled`).
    const partial = partialReadings(registry, guaranteedTypes(before));
    const free = (g: Gen): number => {
        const n = partial.get(g)?.[0] ?? 0;
        return n === 0 ? 1 : Math.max(0, mid(g) - n) / Math.max(mid(g), 1);
    };
    const reaches = (g: Gen): boolean =>
        (gen === undefined || gen === g) && !protectedSides.has(g) && free(g) > 0;
    const count = {
        prefix: reaches("prefix") ? mid("prefix") * free("prefix") : 0,
        suffix: reaches("suffix") ? mid("suffix") * free("suffix") : 0,
    };
    const named = { prefix: 0, suffix: 0 };
    for (const t of reachable) named[heldSide(before, registry, t)]++;
    // What the removal surely leaves (a fractured modifier) is on its side but
    // never taken: the odds are over the rest.
    const removable = { ...count };
    for (const t of guaranteedTypes(before)) {
        if (!kept.has(t)) continue;
        const g = heldSide(before, registry, t);
        if (reaches(g)) removable[g] = Math.max(0, removable[g] - free(g));
    }
    const shares = reachable.map((t) => free(heldSide(before, registry, t)));
    const total = Math.max(
        1,
        removable.prefix + removable.suffix,
        shares.reduce((a, b) => a + b, 0),
    );
    const sides = {
        prefix: {
            count: count.prefix,
            unnamed: Math.max(0, removable.prefix - named.prefix * free("prefix")) / total,
        },
        suffix: {
            count: count.suffix,
            unnamed: Math.max(0, removable.suffix - named.suffix * free("suffix")) / total,
        },
    };
    const only: Gen | undefined =
        reaches("prefix") && !reaches("suffix")
            ? "prefix"
            : reaches("suffix") && !reaches("prefix")
              ? "suffix"
              : undefined;
    return {
        kind: "removal",
        ...(only !== undefined && { gen: only }),
        candidates: reachable.map((type, i) => ({
            type,
            prob: shares[i]! / total,
            gen: heldSide(before, registry, type),
        })),
        before,
        sides,
    };
}

function unveilRoll(
    before: ItemSet,
    spec: Extract<PoolSpec, { kind: "unveil" }>,
    registry: Registry,
    reading: Reading,
): Roll {
    // The veiled modifier becomes one of its own side, where the item says
    // which side that is.
    const held = guaranteedTypes(before);
    const side =
        held.has(VEILED_PREFIX) === held.has(VEILED_SUFFIX)
            ? undefined
            : held.has(VEILED_PREFIX)
              ? "prefix"
              : "suffix";
    const rows = poolRows(before, spec, registry, reading).filter(
        (r) => side === undefined || r.mod.gen === side,
    );
    const options = membersOf(rows);
    return options.length === 0 ? NO_ROLL : { kind: "unveil", options };
}

/** How many options an unveil offers (Veiled modifier). */
const UNVEIL_OPTIONS = 3;

/** One way an unveil's options can fall: the named types among them. */
export interface Offer {
    readonly prob: number;
    readonly members: readonly Member[];
}

const offerSets = new WeakMap<readonly Member[], ReadonlyMap<string, number>>();

/**
 * Every set of options an unveil can offer, with its chance: the three draws
 * played out one after another by weight, a type drawn closing every type that
 * shares a modifier group with it. The wiki says only that three random
 * modifiers are offered; that they are drawn as the modifiers of one item are
 * is an assumption (QUESTIONS.md Q99). The pool is a
 * few dozen types, so the ordered draws are some thousands: three draws from a
 * short list, not the items a step can leave.
 */
function offerSetsOf(options: readonly Member[]): ReadonlyMap<string, number> {
    const known = offerSets.get(options);
    if (known !== undefined) return known;
    const families = options.map((m) => m.rows[0]!.mod.families);
    const closes = options.map((_m, i) =>
        options.map((_o, j) => i === j || [...families[i]!].some((f) => families[j]!.has(f))),
    );
    const sets = new Map<string, number>();
    const walk = (chosen: readonly number[], open: readonly boolean[], prob: number): void => {
        let total = 0;
        options.forEach((m, i) => {
            if (open[i]) total += m.weight;
        });
        if (chosen.length === UNVEIL_OPTIONS || !(total > 0)) {
            const key = [...chosen].sort((a, b) => a - b).join(",");
            sets.set(key, (sets.get(key) ?? 0) + prob);
            return;
        }
        options.forEach((m, i) => {
            if (!open[i]) return;
            walk(
                [...chosen, i],
                open.map((o, j) => o && !closes[i]![j]),
                (prob * m.weight) / total,
            );
        });
    };
    walk(
        [],
        options.map(() => true),
        1,
    );
    offerSets.set(options, sets);
    return sets;
}

/** The ways an unveil's options can fall as far as anyone asks: which of the
 *  types a condition names are offered, each such set with its chance. */
export function unveilOffers(
    options: readonly Member[],
    named: (type: TypeId) => boolean,
): Offer[] {
    const out = new Map<string, { prob: number; members: Member[] }>();
    for (const [set, prob] of offerSetsOf(options)) {
        const members = (set === "" ? [] : set.split(",").map((i) => options[Number(i)]!)).filter(
            (m) => named(m.type),
        );
        const key = members.map((m) => m.type).join(",");
        const hit = out.get(key);
        if (hit) hit.prob += prob;
        else out.set(key, { prob, members });
    }
    return [...out.values()];
}

function drawRoll(
    main: FillPlan,
    forced: readonly FillPlan[],
    registry: Registry,
    reading: Reading,
    stranded: boolean,
): Roll {
    const a = main.before;
    const rows = poolRows(a, main.spec, registry, reading, stranded);
    if (rows.length === 0) return NO_ROLL;
    const sure = guaranteedTypes(a);
    const maybe = new Set([...possibleTypes(a)].filter((t) => !sure.has(t)));
    const genOf = (m: Mod): Gen => sideOf(a, registry, [{ mod: m, weight: 1 }]);
    const groups = groupRows(rows, genOf);
    const present = presentOn(a, registry);

    // The rows a forced fill places first: one certain row, or one of several
    // by weight, each a variant of the roll.
    let variants: { prob: number; present: Present[] }[] = [{ prob: 1, present }];
    for (const f of forced) {
        const frows = poolRows(f.before, f.spec, registry, reading);
        if (frows.length === 0) continue;
        const fgroups = groupRows(frows, genOf);
        const total = fgroups.reduce((s, g) => s + g.weight, 0);
        const next: { prob: number; present: Present[] }[] = [];
        for (const v of variants) {
            for (const g of fgroups) {
                for (const m of g.members) {
                    if (v.present.some((p) => p.type === m.type)) continue;
                    next.push({
                        prob: v.prob * (m.weight / total),
                        present: [...v.present, { type: m.type, gen: g.gen, rows: m.rows }],
                    });
                }
            }
        }
        if (next.length > 0) variants = next;
    }

    const rarity = rarityOf(a) ?? "rare";
    const capP = sideCap("prefix", rarity, a.u.base);
    const capS = sideCap("suffix", rarity, a.u.base);
    const totals = countTotals(main.count, a, reading);
    // What the item holds before the fill beyond the named modifiers: its
    // sure count less them, and exactly that when the side's count is settled
    // or the reading takes it at an end.
    const facts = sureFacts(a, undefined, reading, stranded);
    const ranges = { prefix: countsOf(a).prefix, suffix: suffixRange(a) };
    const settled = (r: readonly [number, number]): boolean =>
        reading !== "estimate" || r[0] === r[1];
    const out: DrawVariant[] = [];
    for (const v of variants) {
        // A modifier placed first closes its group to the draws after it.
        let left: Group[] = groups;
        for (const p of v.present) left = withoutClosed(left, p.type, p.rows[0]?.mod);
        const presentP = v.present.filter((p) => p.gen === "prefix").length;
        const presentS = v.present.length - presentP;
        const unnamedP = Math.max(0, facts.prefixCount - presentP);
        const unnamedS = Math.max(0, facts.suffixCount - presentS);
        const before = {
            prefix: settled(ranges.prefix) ? unnamedP : undefined,
            suffix: settled(ranges.suffix) ? unnamedS : undefined,
        };
        const sides = crossings(
            left.filter((g) => g.gen === "prefix"),
            left.filter((g) => g.gen === "suffix"),
        );
        const open = [capP - presentP - unnamedP, capS - presentS - unnamedS] as const;
        for (const { prob: share, prefix, suffix } of sides) {
            const counts = new Map<string, CountCase>();
            for (const [m, prob] of totals) {
                const draws = Math.max(0, m - v.present.length - unnamedP - unnamedS);
                for (const c of countCases(prefix, suffix, draws, open[0], open[1])) {
                    const key = `${c.prefix}/${c.suffix}`;
                    const seen = counts.get(key);
                    counts.set(key, {
                        prob: (seen?.prob ?? 0) + prob * c.prob,
                        prefix: c.prefix,
                        suffix: c.suffix,
                    });
                }
            }
            out.push({
                prob: v.prob * share,
                present: v.present,
                prefix,
                suffix,
                counts: [...counts.values()],
                before,
                maybe,
                room: { prefix: Math.max(0, open[0]), suffix: Math.max(0, open[1]) },
            });
        }
    }
    return { kind: "draw", variants: out };
}

/** The total modifier count a fill leaves, with its probability: what the item
 *  holds for sure counts toward a reforge's total; an add is that many more. */
function countTotals(count: FillCount, a: ItemSet, reading: Reading): Map<number, number> {
    const cap = totalCap(a);
    const present = Math.max(
        guaranteedTypes(a).size,
        countsOf(a).total[reading === "ceilings" ? 1 : 0],
    );
    switch (count.kind) {
        case "add": {
            const out = new Map<number, number>();
            const lo = present + count.n[0];
            const hi = present + count.n[1];
            for (let m = lo; m <= hi; m++) out.set(Math.min(m, cap), 1 / (hi - lo + 1));
            return out;
        }
        case "reforge": {
            const range: readonly [number, number] =
                count.n === "byRarity"
                    ? rarityOf(a) === "magic"
                        ? [1, 2]
                        : rarityOf(a) === "normal"
                          ? [0, 0]
                          : [4, 6]
                    : count.n;
            return countDistribution(range, cap);
        }
        case "within":
            return new Map([[present, 1]]);
    }
}

/** A roll with one more modifier present for certain: a bench craft after it. */
export function withPresent(roll: Roll, type: TypeId, gen: Gen, mod: Mod): Roll {
    if (roll.kind !== "draw") return roll;
    const added: Present = { type, gen, rows: [{ mod, weight: 1 }] };
    return {
        kind: "draw",
        variants: roll.variants.map((v) => ({
            ...v,
            present: v.present.some((p) => p.type === type) ? v.present : [...v.present, added],
            maybe: new Set([...v.maybe].filter((t) => t !== type)),
            prefix: withoutClosed(v.prefix, type, mod),
            suffix: withoutClosed(v.suffix, type, mod),
        })),
    };
}
