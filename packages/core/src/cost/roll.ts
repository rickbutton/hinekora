/**
 * A method's roll: what one use of it draws, read off its operation sequence
 * and the item it is used on, as the pools and counts the race (`race.ts`)
 * needs. The item is the checker's abstract item, so the pool is the pool of
 * the facts it holds on every path (the base, the kept and fractured modifiers,
 * the influence): the item the guide is holding on the path it describes
 * (QUESTIONS.md Q57). Nothing here lists outcomes; a roll is a few weighted
 * rows per side and a distribution of counts.
 */
import type { Gen, GroupId, TagId, TypeId } from "../model/ids.js";
import type { Mod } from "../model/mod.js";
import { lookupWeight, pool } from "../pool/pool.js";
import { veiledPool } from "../pool/veiled.js";
import { HARVEST_TAGS, type Registry } from "../resolve/registry.js";
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
import {
    exclusiveTypes,
    guaranteedFacts,
    influenceTagsAny,
    rowsOf,
    runMethod,
} from "../check/ops.js";
import { emptyItem } from "../model/item.js";
import { splitDistribution } from "./race.js";
import { keptDistribution, type Pooled, type PooledSide } from "./recombine.js";

/** One row of a group with the weight it rolls at here. */
export interface Row {
    readonly mod: Mod;
    readonly weight: number;
}

/** A group in the race: a modifier type and its rows. */
export interface Group {
    readonly type: TypeId;
    readonly gen: Gen;
    readonly weight: number;
    readonly rows: readonly Row[];
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
          /** The one side the removal reaches, when it is limited to one. */
          readonly gen?: Gen;
      }
    /** A Divine Orb: every value rolled again within its tier. */
    | { readonly kind: "reroll" }
    /** A fracture, uniform over the modifiers present. */
    | { readonly kind: "lock"; readonly candidates: readonly Candidate[] }
    /** An unveil: three options drawn by weight without replacement (Q64). */
    | { readonly kind: "unveil"; readonly options: readonly Group[] }
    /** An ember or ichor: one implicit of the tier, by weight. */
    | {
          readonly kind: "implicit";
          readonly side: "exarch" | "eater";
          readonly tier: number;
          readonly options: readonly Candidate[];
      }
    /** A Recombinator: each side's pooled modifiers and how many it keeps (`recombine.ts`). */
    | { readonly kind: "recombine"; readonly sides: Readonly<Record<Gen, PooledSide>> }
    /** Nothing this model reads: a deterministic step, or one it does not model. */
    | { readonly kind: "none" };

export const NO_ROLL: Roll = { kind: "none" };

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

/** The split of `m` draws between the sides, each case's probability. */
function countCases(
    prefix: readonly Group[],
    suffix: readonly Group[],
    m: number,
    capPrefix: number,
    capSuffix: number,
): CountCase[] {
    if (m <= 0) return [{ prob: 1, prefix: 0, suffix: 0 }];
    const split = splitOf(
        prefix.map((g) => g.weight),
        suffix.map((g) => g.weight),
        m,
        capPrefix,
        capSuffix,
    );
    const cases: CountCase[] = [];
    split.forEach((prob, p) => {
        if (prob > 0) cases.push({ prob, prefix: p, suffix: m - p });
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

/** The item's facts the pool reads: the guaranteed modifiers, with each side's
 *  count raised to its proven lower bound, so a side the unnamed modifiers fill
 *  admits nothing more. */
function sureFacts(a: AItem, registry: Registry, level?: number) {
    const facts = guaranteedFacts(a, registry, level);
    return {
        ...facts,
        prefixCount: Math.max(facts.prefixCount, a.counts.prefix[0]),
        suffixCount: Math.max(facts.suffixCount, suffixRange(a)[0]),
    };
}

function groupRows(rows: readonly Row[], genOf: (m: Mod) => Gen): Group[] {
    const byType = new Map<TypeId, Row[]>();
    for (const r of rows) {
        const list = byType.get(r.mod.type);
        if (list) list.push(r);
        else byType.set(r.mod.type, [r]);
    }
    const out: Group[] = [];
    for (const [type, list] of byType) {
        const weight = list.reduce((s, r) => s + r.weight, 0);
        if (weight > 0) out.push({ type, gen: genOf(list[0]!.mod), weight, rows: list });
    }
    return out;
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

/** The grove's "more likely" tilt: ten times the weight of the rows sharing a
 *  harvest type with a modifier on the item; "less likely" a tenth
 *  (craftofexile's reading of the two crafts, QUESTIONS.md Q66). */
const LIKELY_FACTOR = { more: 10, less: 0.1 } as const;

const HARVEST_TAG_IDS: ReadonlySet<TagId> = new Set(HARVEST_TAGS.values());

/** The harvest types of the modifiers the item holds on every path. */
function harvestTagsOn(a: AItem, registry: Registry): Set<TagId> {
    const out = new Set<TagId>();
    const types = guaranteedTypes(a);
    for (const m of registry.catalog) {
        if (!types.has(m.type)) continue;
        const pinned = a.tiers.get(m.type);
        if (pinned !== undefined && !pinned.has(m.id)) continue;
        for (const tag of m.implicitTags) if (HARVEST_TAG_IDS.has(tag)) out.add(tag);
    }
    return out;
}

/**
 * The weighted rows a pool holds on the item as it stands before the fill:
 * the natural pool at the level asked, narrowed or re-weighted as the pool
 * says. Empty for a pool this model does not read. `origin` is the item the
 * method was used on, before its strip, for a tilt that reads what it held.
 */
function poolRows(a: AItem, spec: PoolSpec, registry: Registry, origin: AItem = a): Row[] {
    const natural = (level?: number): Row[] =>
        pool(registry.catalog, sureFacts(a, registry, level)).map((c) => ({
            mod: c.mod,
            weight: c.weight,
        }));
    switch (spec.kind) {
        case "natural": {
            const cap = spec.maxLevel ?? Infinity;
            let rows = natural(spec.level).filter(
                (r) => r.mod.minLevel <= cap && (spec.gen === undefined || r.mod.gen === spec.gen),
            );
            if (spec.likely !== undefined) {
                const tags = harvestTagsOn(origin, registry);
                const factor = LIKELY_FACTOR[spec.likely];
                rows = rows.map((r) =>
                    [...r.mod.implicitTags].some((t) => tags.has(t))
                        ? { mod: r.mod, weight: r.weight * factor }
                        : r,
                );
            }
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
            const blocked = (m: Mod): boolean =>
                [...m.implicitTags].some((t) => spec.blocked.has(t));
            const rows = natural()
                .filter((r) => !blocked(r.mod))
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
            const facts = sureFacts(a, registry);
            const tags = influenceTagsAny(a, registry);
            const plain = new Set(
                pool(registry.catalog, {
                    ...facts,
                    tags: new Set([...facts.tags].filter((t) => !tags.has(t))),
                }).map((c) => c.mod.id),
            );
            return natural().filter((r) => !plain.has(r.mod.id));
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
export function rollOf(a: AItem, ops: readonly Op[], registry: Registry): Roll {
    let main: FillPlan | undefined;
    const forced: FillPlan[] = [];
    for (let i = 0; i < ops.length; i++) {
        const op = ops[i]!;
        switch (op.kind) {
            case "fill": {
                // The veiled placeholder is a modifier no condition names.
                if (op.pool.kind === "veiledPlaceholder") break;
                const before = runMethod(a, ops.slice(0, i), registry).state;
                if (op.pool.kind === "unveil") return unveilRoll(before, op.pool, registry);
                if (op.count.kind === "within") {
                    forced.push({ spec: op.pool, count: op.count, before });
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
                    if (!fillsAfter) return removalRoll(before, after, op.selector.gen, registry);
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
    return main === undefined ? NO_ROLL : drawRoll(main, forced, registry, a);
}

/**
 * A random removal: the modifiers it may take are those guaranteed before and
 * not after on the sides it reaches, each as likely as any other modifier
 * there; what the item holds beyond the named ones is the unnamed share of
 * each side. The counts are read at the middle of their ranges.
 */
function removalRoll(before: AItem, after: AItem, gen: Gen | undefined, registry: Registry): Roll {
    const kept = guaranteedTypes(after);
    const reachable = [...guaranteedTypes(before)].filter((t) => !kept.has(t));
    const mid = (r: readonly [number, number]): number => (r[0] + r[1]) / 2;
    // A side a metamod protects, or the other side of a one-sided orb, is out
    // of the removal's reach.
    const protectedSides = new Set<Gen>();
    for (const t of guaranteedTypes(before)) {
        for (const e of registry.effectsOfType(t))
            if (e.kind === "protect") protectedSides.add(e.gen);
    }
    const reaches = (g: Gen): boolean => (gen === undefined || gen === g) && !protectedSides.has(g);
    const count = {
        prefix: reaches("prefix") ? mid(before.counts.prefix) : 0,
        suffix: reaches("suffix") ? mid(suffixRange(before)) : 0,
    };
    const named = { prefix: 0, suffix: 0 };
    for (const t of reachable) named[genOfType(before, registry, t)]++;
    const total = Math.max(1, count.prefix + count.suffix, reachable.length);
    const sides = {
        prefix: {
            count: count.prefix,
            unnamed: Math.max(0, count.prefix - named.prefix) / total,
        },
        suffix: {
            count: count.suffix,
            unnamed: Math.max(0, count.suffix - named.suffix) / total,
        },
    };
    return {
        kind: "removal",
        ...(gen !== undefined && { gen }),
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
): Roll {
    const rows = poolRows(before, spec, registry);
    const options = groupRows(rows, (m) => m.gen);
    return options.length === 0 ? NO_ROLL : { kind: "unveil", options };
}

function drawRoll(
    main: FillPlan,
    forced: readonly FillPlan[],
    registry: Registry,
    origin: AItem,
): Roll {
    const a = main.before;
    const rows = poolRows(a, main.spec, registry, origin);
    if (rows.length === 0) return NO_ROLL;
    const genOf = (m: Mod): Gen => genOfType(a, registry, m.type, m);
    const groups = groupRows(rows, genOf);
    const present = presentOn(a, registry);

    // The rows a forced fill places first: one certain row, or one of several
    // by weight, each a variant of the roll.
    let variants: { prob: number; present: Present[] }[] = [{ prob: 1, present }];
    for (const f of forced) {
        const frows = poolRows(f.before, f.spec, registry);
        if (frows.length === 0) continue;
        const fgroups = groupRows(frows, genOf);
        const total = fgroups.reduce((s, g) => s + g.weight, 0);
        const next: { prob: number; present: Present[] }[] = [];
        for (const v of variants) {
            for (const g of fgroups) {
                if (v.present.some((p) => p.type === g.type)) continue;
                next.push({
                    prob: v.prob * (g.weight / total),
                    present: [...v.present, { type: g.type, gen: g.gen, rows: g.rows }],
                });
            }
        }
        if (next.length > 0) variants = next;
    }

    const rarity = rarityOf(a) ?? "rare";
    const capP = sideCap("prefix", rarity, a.base);
    const capS = sideCap("suffix", rarity, a.base);
    const totals = countTotals(main.count, a);
    // What the item holds before the fill beyond the named modifiers: its
    // sure count less them, and exactly that when the side's count is settled.
    const facts = sureFacts(a, registry);
    const ranges = { prefix: a.counts.prefix, suffix: suffixRange(a) };
    const out: DrawVariant[] = [];
    for (const v of variants) {
        const taken = new Set(v.present.map((p) => p.type));
        const prefix = groups.filter((g) => g.gen === "prefix" && !taken.has(g.type));
        const suffix = groups.filter((g) => g.gen === "suffix" && !taken.has(g.type));
        const presentP = v.present.filter((p) => p.gen === "prefix").length;
        const presentS = v.present.length - presentP;
        const unnamedP = Math.max(0, facts.prefixCount - presentP);
        const unnamedS = Math.max(0, facts.suffixCount - presentS);
        const before = {
            prefix: ranges.prefix[0] === ranges.prefix[1] ? unnamedP : undefined,
            suffix: ranges.suffix[0] === ranges.suffix[1] ? unnamedS : undefined,
        };
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
            prob: v.prob,
            present: v.present,
            prefix,
            suffix,
            counts: [...counts.values()],
            before,
        });
    }
    return { kind: "draw", variants: out };
}

/** The total modifier count a fill leaves, with its probability: what the item
 *  holds for sure counts toward a reforge's total; an add is that many more. */
function countTotals(count: FillCount, a: AItem): Map<number, number> {
    const cap = totalCap(a);
    const present = Math.max(guaranteedTypes(a).size, a.counts.total[0]);
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

/**
 * The Recombinator's roll on `a` and the second item `b`: per side, the
 * modifiers both items hold on every path with the rows they may be, each at
 * its spawn weight on the base (an unnamed one at the side's average), doubled
 * when both items carry it, the exclusive ones marked; and the count the
 * result keeps by the page's table over the pooled count, the item's unnamed
 * modifiers counted at their proven floors.
 */
export function recombineRoll(a: AItem, b: AItem, registry: Registry): Roll {
    const tags = influenceTagsAny(a, registry);
    const baseTags = new Set([...a.base.tags, ...tags]);
    const exclusive = new Set([...exclusiveTypes(a, registry), ...exclusiveTypes(b, registry)]);
    const natural = groupRows(
        pool(registry.catalog, emptyItem(a.base, a.ilvl, "rare")).map((c) => ({
            mod: c.mod,
            weight: c.weight,
        })),
        (m) => genOfType(a, registry, m.type, m),
    );
    const sides = {} as Record<Gen, PooledSide>;
    for (const gen of ["prefix", "suffix"] as const) {
        const groups = natural.filter((g) => g.gen === gen);
        const mean =
            groups.length === 0 ? 1 : groups.reduce((s, g) => s + g.weight, 0) / groups.length;
        const weightOf = (type: TypeId): number => {
            const w = rollableTiers(registry.catalog, a.base, a.ilvl, type, tags).reduce(
                (s, m) => s + (lookupWeight(m, baseTags) ?? 0),
                0,
            );
            return w > 0 ? w : mean;
        };
        const named = new Map<TypeId, { rows: Map<string, Row>; copies: number }>();
        let unnamed = 0;
        for (const x of [a, b]) {
            let onSide = 0;
            for (const type of guaranteedTypes(x)) {
                if (genOfType(a, registry, type) !== gen) continue;
                onSide++;
                const entry = named.get(type) ?? { rows: new Map<string, Row>(), copies: 0 };
                entry.copies++;
                for (const m of rowsOf(x, type, registry)) {
                    entry.rows.set(m.id, { mod: m, weight: lookupWeight(m, baseTags) ?? 1 });
                }
                named.set(type, entry);
            }
            const floor = gen === "prefix" ? x.counts.prefix[0] : suffixRange(x)[0];
            unnamed += Math.max(0, floor - onSide);
        }
        let pooled = unnamed;
        const list: Pooled[] = [];
        for (const [type, { rows, copies }] of named) {
            pooled += copies;
            list.push({
                type,
                rows: [...rows.values()],
                weight: weightOf(type) * copies,
                exclusive: exclusive.has(type),
            });
        }
        sides[gen] = {
            named: list,
            unnamed,
            unnamedWeight: mean,
            keeps: keptDistribution(pooled, sideCap(gen, "rare", a.base)),
        };
    }
    return { kind: "recombine", sides };
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
            prefix: v.prefix.filter((g) => g.type !== type),
            suffix: v.suffix.filter((g) => g.type !== type),
            // A bench row fills a slot an unnamed modifier would otherwise be
            // counted in only if the side was not already full of them.
        })),
    };
}
