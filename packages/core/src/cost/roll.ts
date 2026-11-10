/**
 * A method's roll: what one use of it draws, read off its operation sequence
 * and the item it is used on, as the pools and counts the race (`race.ts`)
 * needs. The item is a checker's abstract item, the trace's or one narrowed to
 * a state the cost walk tracks (docs/cost.md §3), so the pool is the pool of
 * the facts it holds on every path (the base, the kept and fractured modifiers,
 * the influence). Nothing here lists outcomes; a roll is a few weighted
 * rows per side and a distribution of counts.
 */
import type { Gen, GroupId, TypeId } from "../model/ids.js";
import type { Mod } from "../model/mod.js";
import { lookupWeight, pool } from "../pool/pool.js";
import { veiledPool } from "../pool/veiled.js";
import { VEILED_PREFIX, VEILED_SUFFIX } from "../model/veiled.js";
import type { Registry } from "../resolve/registry.js";
import { rollableGen, rollableTiers } from "../resolve/tiers.js";
import {
    type AItem,
    capsOver,
    guaranteedTypes,
    rarityOf,
    suffixRange,
    sideCap,
} from "../check/astate.js";
import type { FillCount, Op, PoolSpec } from "../check/ops.js";
import { guaranteedFacts, influenceTagsAny, runMethod } from "../check/ops.js";
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
          readonly before: AItem;
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
    /** An unveil: three options drawn by weight without replacement (Veiled
     *  modifier § Version history). */
    | { readonly kind: "unveil"; readonly options: readonly Group[] }
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
): number[] {
    return splitDistribution(prefix, suffix, m, Math.max(0, capPrefix), Math.max(0, capSuffix));
}

/**
 * The counts a reading takes the item at. The estimate and the floors read each
 * side at its floor. The ceilings read the fullest item the counts allow: the
 * total at its ceiling, split between the sides as evenly as their own ceilings
 * let it, since the sides' ceilings alone may add up to more than the item can
 * hold and would show a full item where the checker proved a slot open.
 */
function countsAt(a: AItem, reading: Reading): Readonly<Record<Gen, number>> {
    const prefix = a.counts.prefix;
    const suffix = suffixRange(a);
    if (reading !== "ceilings") return { prefix: prefix[0], suffix: suffix[0] };
    const total = a.counts.total[1];
    let p = Math.min(prefix[1], Math.ceil(total / 2));
    const s = Math.min(suffix[1], total - p);
    p = Math.min(prefix[1], total - s);
    return { prefix: p, suffix: s };
}

/** The item's facts the pool reads: the guaranteed modifiers, with each side's
 *  count raised to what the reading takes it at, so a side the unnamed
 *  modifiers fill admits nothing more. */
function sureFacts(
    a: AItem,
    registry: Registry,
    level?: number,
    reading: Reading = "estimate",
    withStrands = false,
) {
    const facts = guaranteedFacts(a, registry, level);
    const counts = countsAt(a, reading);
    const strands = withStrands ? a.strands[reading === "ceilings" ? 1 : 0] : 0;
    return {
        ...facts,
        prefixCount: Math.max(facts.prefixCount, counts.prefix),
        suffixCount: Math.max(facts.suffixCount, counts.suffix),
        ...(strands > 0 && { strands }),
    };
}

/**
 * The rows as the race's clocks: the types of a side that share a modifier
 * group are one clock. A type listing several groups (an unveil's attribute
 * hybrids) joins a clock only where it excludes every type already in it, so
 * a clock never closes two types the game would draw together; the exclusions
 * that leaves out are missed, the draw a little too generous to those types.
 */
function groupRows(rows: readonly Row[], genOf: (m: Mod) => Gen): Group[] {
    const byType = new Map<TypeId, { gen: Gen; families: ReadonlySet<GroupId>; rows: Row[] }>();
    for (const r of rows) {
        if (!(r.weight > 0)) continue;
        const known = byType.get(r.mod.type);
        if (known) known.rows.push(r);
        else byType.set(r.mod.type, { gen: genOf(r.mod), families: r.mod.families, rows: [r] });
    }
    const clocks: { gen: Gen; families: ReadonlySet<GroupId>[]; members: Member[] }[] = [];
    for (const [type, { gen, families, rows: list }] of byType) {
        const member = { type, weight: list.reduce((s, r) => s + r.weight, 0), rows: list };
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

/**
 * The weighted rows a pool holds on the item as it stands before the fill:
 * the natural pool at the level asked, narrowed or re-weighted as the pool
 * says. Empty for a pool this model does not read.
 */
function poolRows(
    a: AItem,
    spec: PoolSpec,
    registry: Registry,
    reading: Reading = "estimate",
    stranded = false,
): Row[] {
    // Only a method that uses memory strands up has its fill cut by them.
    const natural = (level?: number, withStrands = false): Row[] =>
        pool(registry.catalog, sureFacts(a, registry, level, reading, withStrands)).map((c) => ({
            mod: c.mod,
            weight: c.weight,
        }));
    switch (spec.kind) {
        case "natural": {
            const cap = spec.maxLevel ?? Infinity;
            const rows = natural(spec.level, stranded).filter(
                (r) => r.mod.minLevel <= cap && (spec.gen === undefined || r.mod.gen === spec.gen),
            );
            return spec.topTiers ? foulbornRows(rows) : rows;
        }
        case "tagged":
            return natural().filter((r) => r.mod.implicitTags.has(spec.tag));
        case "fossil": {
            // A fossil multiplies the weight of the rows carrying its tags, once
            // per fossil (the larger of its multipliers when two of its tags
            // match), the fossils' multipliers adding up (Fossil § Fossil weight
            // multipliers; QUESTIONS.md Q60); the rows it blocks are gone.
            const multiplier = (m: Mod): number => {
                let sum = 0;
                for (const f of spec.fossils) {
                    let best = 0;
                    for (const [tag, w] of f.weights)
                        if (m.implicitTags.has(tag)) best = Math.max(best, w);
                    sum += best / 100;
                }
                return sum > 0 ? sum : 1;
            };
            const untagged = (m: Mod): boolean => spec.noTagless && m.implicitTags.size === 0;
            const blocked = (m: Mod): boolean =>
                [...m.implicitTags].some((t) => spec.blocked.has(t));
            const rows = natural()
                .filter((r) => !blocked(r.mod) && !untagged(r.mod))
                .map((r) => ({ mod: r.mod, weight: r.weight * multiplier(r.mod) }));
            for (const m of spec.added) {
                if (blocked(m) || m.minLevel > a.ilvl) continue;
                const w = lookupWeight(m, a.base.tags) ?? 0;
                if (w > 0) rows.push({ mod: m, weight: w * multiplier(m) });
            }
            return rows;
        }
        case "influence": {
            // The rows the influence admits: in the pool with the influence's
            // tags and not without them.
            const facts = sureFacts(a, registry, undefined, reading, stranded);
            const tags = influenceTagsAny(a, registry);
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
            return veiledPool(registry.catalog, a.base, a.ilvl, families).map((m) => ({
                mod: m,
                weight: lookupWeight(m, a.base.tags) ?? 1,
            }));
        }
        case "bench":
            return [{ mod: spec.mod, weight: 1 }];
        case "essenceGrant": {
            const id = spec.spec.grants.get(a.base.itemClass);
            const mod = id === undefined ? undefined : registry.resolveMod(id);
            return mod?.ok ? [{ mod: mod.value, weight: 1 }] : [];
        }
        case "rows":
            return spec.mods.map((mod) => ({ mod, weight: 1 }));
        case "veiledPlaceholder":
        case "metamods":
            return [];
    }
}

/** The groups a modifier the item holds but no one names could be, per side:
 *  its natural pool on the item, the groups of what it surely holds left out. */
export function naturalGroups(
    a: AItem,
    registry: Registry,
    reading: Reading = "estimate",
): { readonly prefix: readonly Group[]; readonly suffix: readonly Group[] } {
    const rows = poolRows(a, { kind: "natural" }, registry, reading);
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
function genOfType(a: AItem, registry: Registry, type: TypeId, hint?: Mod): Gen {
    return (
        rollableGen(registry.catalog, a.base, a.ilvl, type, influenceTagsAny(a, registry)) ??
        hint?.gen ??
        registry.genOfType(type) ??
        "prefix"
    );
}

/** The modifiers present on every path after `a`, each with the rows it may be. */
function presentOn(a: AItem, registry: Registry): Present[] {
    const tags = influenceTagsAny(a, registry);
    const out: Present[] = [];
    for (const type of guaranteedTypes(a)) {
        const pinned = a.tiers.get(type);
        let rows: Row[] = rollableTiers(registry.catalog, a.base, a.ilvl, type, tags).map((m) => ({
            mod: m,
            weight: lookupWeight(m, new Set([...a.base.tags, ...tags])) ?? 1,
        }));
        if (pinned !== undefined) {
            const kept = rows.filter((r) => pinned.has(r.mod.id));
            if (kept.length > 0) rows = kept;
            else {
                // A row the natural ladder lacks (a bench, essence or unveiled row).
                rows = registry.catalog
                    .filter((m) => pinned.has(m.id))
                    .map((m) => ({ mod: m, weight: 1 }));
            }
        }
        out.push({ type, gen: genOfType(a, registry, type, rows[0]?.mod), rows });
    }
    return out;
}

/** The total a reforge may reach on this item, the loosest cap over its rarities. */
function totalCap(a: AItem): number {
    return capsOver(a, Math.max).total;
}

interface FillPlan {
    readonly spec: PoolSpec;
    readonly count: FillCount;
    /** The item as the fill finds it: after the strip and the removals before it. */
    readonly before: AItem;
}

/**
 * Read a method's operations into its roll on the item `a`: the random fill with
 * the pools and counts it draws, the forced rows placed beside it, or a random
 * removal, fracture, unveil or implicit. A method whose randomness this model
 * does not read (a Vaal Orb's outcomes, a Bestiary's random metamod) is
 * `none`.
 */
export function rollOf(
    a: AItem,
    ops: readonly Op[],
    registry: Registry,
    reading: Reading = "estimate",
): Roll {
    let main: FillPlan | undefined;
    const forced: FillPlan[] = [];
    const stranded = ops.some((op) => op.kind === "strands");
    for (let i = 0; i < ops.length; i++) {
        const op = ops[i]!;
        switch (op.kind) {
            case "fill": {
                // The veiled placeholder is a modifier no condition names.
                if (op.pool.kind === "veiledPlaceholder") break;
                const before = runMethod(a, ops.slice(0, i), registry).state;
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
                    const before = runMethod(a, ops.slice(0, i), registry).state;
                    const after = runMethod(a, ops.slice(0, i + 1), registry).state;
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
                const before = runMethod(a, ops.slice(0, i), registry).state;
                const types = [...guaranteedTypes(before)];
                const n = Math.max(before.counts.total[0], types.length, 1);
                return {
                    kind: "lock",
                    candidates: types.map((type) => ({ type, prob: 1 / n })),
                };
            }
            case "eldritch":
                if (op.change.kind === "set") {
                    const rows = registry
                        .eldritchPool(a.base, op.change.side, op.change.tier)
                        .map((e) => {
                            let w = 0;
                            for (const [tag, weight] of e.weights) {
                                if (a.base.tags.has(tag)) w = Math.max(w, weight);
                            }
                            return { type: e.type, w };
                        });
                    const total = rows.reduce((s, r) => s + r.w, 0);
                    if (total <= 0) return NO_ROLL;
                    const byType = new Map<TypeId, number>();
                    for (const r of rows)
                        byType.set(r.type, (byType.get(r.type) ?? 0) + r.w / total);
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
    before: AItem,
    after: AItem,
    gen: Gen | undefined,
    registry: Registry,
    reading: Reading,
): Roll {
    const kept = guaranteedTypes(after);
    const reachable = [...guaranteedTypes(before)].filter((t) => !kept.has(t));
    const at = countsAt(before, reading);
    const mid = (gen: Gen): number => {
        const r = gen === "prefix" ? before.counts.prefix : suffixRange(before);
        return reading === "estimate" ? (r[0] + r[1]) / 2 : at[gen];
    };
    // A side a metamod protects, or the other side of a one-sided orb, is out
    // of the removal's reach.
    const protectedSides = new Set<Gen>();
    for (const t of guaranteedTypes(before)) {
        for (const e of registry.effectsOfType(t))
            if (e.kind === "protect") protectedSides.add(e.gen);
    }
    const reaches = (g: Gen): boolean => (gen === undefined || gen === g) && !protectedSides.has(g);
    const count = {
        prefix: reaches("prefix") ? mid("prefix") : 0,
        suffix: reaches("suffix") ? mid("suffix") : 0,
    };
    const named = { prefix: 0, suffix: 0 };
    for (const t of reachable) named[genOfType(before, registry, t)]++;
    // What the removal surely leaves (a fractured modifier) is on its side but
    // never taken: the odds are over the rest.
    const removable = { ...count };
    for (const t of guaranteedTypes(before)) {
        if (!kept.has(t)) continue;
        const g = genOfType(before, registry, t);
        if (reaches(g)) removable[g] = Math.max(0, removable[g] - 1);
    }
    const total = Math.max(1, removable.prefix + removable.suffix, reachable.length);
    const sides = {
        prefix: {
            count: count.prefix,
            unnamed: Math.max(0, removable.prefix - named.prefix) / total,
        },
        suffix: {
            count: count.suffix,
            unnamed: Math.max(0, removable.suffix - named.suffix) / total,
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
        candidates: reachable.map((type) => ({
            type,
            prob: 1 / total,
            gen: genOfType(before, registry, type),
        })),
        before,
        sides,
    };
}

function unveilRoll(
    before: AItem,
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
    const options = groupRows(rows, (m) => m.gen);
    return options.length === 0 ? NO_ROLL : { kind: "unveil", options };
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
    const genOf = (m: Mod): Gen => genOfType(a, registry, m.type, m);
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
    const capP = sideCap("prefix", rarity, a.base);
    const capS = sideCap("suffix", rarity, a.base);
    const totals = countTotals(main.count, a, reading);
    // What the item holds before the fill beyond the named modifiers: its
    // sure count less them, and exactly that when the side's count is settled
    // or the reading takes it at an end.
    const facts = sureFacts(a, registry, undefined, reading, stranded);
    const ranges = { prefix: a.counts.prefix, suffix: suffixRange(a) };
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
        for (const { prob: share, prefix, suffix } of sides) {
            const counts = new Map<string, CountCase>();
            for (const [m, prob] of totals) {
                const draws = Math.max(0, m - v.present.length - unnamedP - unnamedS);
                const open = [capP - presentP - unnamedP, capS - presentS - unnamedS] as const;
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
            });
        }
    }
    return { kind: "draw", variants: out };
}

/** The total modifier count a fill leaves, with its probability: what the item
 *  holds for sure counts toward a reforge's total; an add is that many more. */
function countTotals(count: FillCount, a: AItem, reading: Reading): Map<number, number> {
    const cap = totalCap(a);
    const present = Math.max(
        guaranteedTypes(a).size,
        a.counts.total[reading === "ceilings" ? 1 : 0],
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
            prefix: withoutClosed(v.prefix, type, mod),
            suffix: withoutClosed(v.suffix, type, mod),
        })),
    };
}
