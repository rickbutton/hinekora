/**
 * The chance a condition holds after a roll: the checker's resolved predicate
 * evaluated against the roll (`roll.ts`) through the race (`race.ts`). An atom
 * about a modifier on a side is a question about that side's race given how
 * many it drew; count atoms read the split; a value atom reads the share of the
 * row's range that compares so, a value being equally likely anywhere in
 * it (Modifier § Mechanics overview); the atoms of one roll are
 * combined exactly by enumerating which of the few modifiers the condition
 * names were drawn, never which modifiers the item has. A condition the roll
 * says nothing about is settled by the checker's item where it can be, and is
 * otherwise unknown.
 */
import type { Cmp } from "../ast/ast.js";
import type { Gen, ModId, TypeId } from "../model/ids.js";
import type { RPred } from "../check/astate.js";
import type { Dd } from "../exact/dd.js";
import { narrow, predKey, type XItem } from "../exact/state.js";
import { counts, guaranteedTypes, rowsOf, suffixRange } from "../exact/views.js";
import type { Range } from "../check/domain.js";
import { narrowRange } from "../check/values.js";
import { amongSplitDistribution } from "./race.js";
import {
    type Candidate,
    type CountCase,
    type DrawVariant,
    type Group,
    holdsNamed,
    type Member,
    memberCases,
    type Present,
    type Roll,
    unveilOffers,
} from "./roll.js";

/** How many joint outcomes an exact enumeration may visit before the atoms are
 *  taken as independent instead. */
const EXACT_LIMIT = 20000;

type Leaf = Exclude<RPred, { kind: "and" | "or" | "not" }>;

/** The truth of a leaf under one outcome; `undefined` when the outcome says nothing. */
type Truth = (leaf: Leaf) => boolean | undefined;

function holds(pred: RPred, truth: Truth): boolean | undefined {
    switch (pred.kind) {
        case "not": {
            const t = holds(pred.inner, truth);
            return t === undefined ? undefined : !t;
        }
        case "and": {
            const l = holds(pred.left, truth);
            const r = holds(pred.right, truth);
            if (l === false || r === false) return false;
            return l === undefined || r === undefined ? undefined : true;
        }
        case "or": {
            const l = holds(pred.left, truth);
            const r = holds(pred.right, truth);
            if (l === true || r === true) return true;
            return l === undefined || r === undefined ? undefined : false;
        }
        default:
            return truth(pred);
    }
}

function leaves(pred: RPred, out: Leaf[] = []): Leaf[] {
    switch (pred.kind) {
        case "not":
            return leaves(pred.inner, out);
        case "and":
        case "or":
            leaves(pred.left, out);
            return leaves(pred.right, out);
        default:
            out.push(pred);
            return out;
    }
}

const settledBy = new WeakMap<Dd, Map<string, boolean | undefined>>();

/** What the checker's items settle on their own: impossible, certain, or neither. */
export function certainty(pred: RPred, a: XItem): boolean | undefined {
    let known = settledBy.get(a.dd);
    if (known === undefined) settledBy.set(a.dd, (known = new Map<string, boolean | undefined>()));
    const key = predKey(pred);
    if (known.has(key)) return known.get(key);
    const r =
        narrow(a, pred, true) === null ? false : narrow(a, pred, false) === null ? true : undefined;
    known.set(key, r);
    return r;
}

/**
 * The chance `pred` holds after `roll` left the item `after`. `undefined` when
 * neither the roll nor the item settles it.
 */
export function chance(pred: RPred, roll: Roll, after: XItem): number | undefined {
    const settled = certainty(pred, after);
    if (settled !== undefined) return settled ? 1 : 0;
    // A leaf the roll does not model is read off the item; one the item cannot
    // settle either leaves the whole condition unknown.
    const fixed = new Map<Leaf, boolean>();
    for (const leaf of leaves(pred)) {
        if (modelled(leaf, roll)) continue;
        const c = certainty(leaf, after);
        if (c === undefined) return undefined;
        fixed.set(leaf, c);
    }
    const base: Truth = (leaf) => fixed.get(leaf);
    switch (roll.kind) {
        case "none":
            return undefined;
        case "draw":
            return drawChance(pred, roll.variants, after, base);
        case "removal":
            return removalChance(pred, roll, after, base);
        case "reroll":
            return rerollChance(pred, after, base);
        case "lock":
            return pickChance(pred, roll.candidates, after, base, (leaf, picked) =>
                leaf.kind === "fractured" ? leaf.type === picked : undefined,
            );
        case "implicit":
            return pickChance(pred, roll.options, after, base, (leaf, picked) => {
                if (leaf.kind !== "eldritch" || leaf.side !== roll.side) return undefined;
                if (leaf.tier !== undefined && leaf.tier !== roll.tier) return false;
                return leaf.types === undefined || leaf.types.has(picked);
            });
        case "unveil":
            return unveilChance(pred, roll.options, base);
    }
}

/** Whether a roll of this kind has anything to say about a leaf. */
function modelled(leaf: Leaf, roll: Roll): boolean {
    switch (roll.kind) {
        case "none":
            return false;
        case "draw":
        case "unveil":
            return (
                leaf.kind === "has" ||
                leaf.kind === "hasValue" ||
                leaf.kind === "hasGroup" ||
                (roll.kind === "draw" && leaf.kind === "compare")
            );
        case "removal":
            return (
                leaf.kind === "has" ||
                leaf.kind === "hasValue" ||
                leaf.kind === "hasGroup" ||
                leaf.kind === "compare"
            );
        case "reroll":
            return leaf.kind === "hasValue";
        case "lock":
            return leaf.kind === "fractured";
        case "implicit":
            return leaf.kind === "eldritch";
    }
}

/**
 * A random removal takes one modifier: a named candidate, or an unnamed one of
 * either side. A named modifier not taken is as the item before knew it; the
 * counts fall by one on the side taken.
 */
function removalChance(
    pred: RPred,
    roll: Extract<Roll, { kind: "removal" }>,
    after: XItem,
    base: Truth,
): number | undefined {
    const picks: { type?: TypeId; gen?: Gen; prob: number }[] = [...roll.candidates];
    for (const gen of ["prefix", "suffix"] as const) {
        const p = roll.sides[gen].unnamed;
        if (p > 0) picks.push({ gen, prob: p });
    }
    const candidates = new Set(roll.candidates.map((c) => c.type));
    let total = 0;
    let mass = 0;
    for (const pick of picks) {
        const counts = {
            prefix: roll.sides.prefix.count - (pick.gen === "prefix" ? 1 : 0),
            suffix: roll.sides.suffix.count - (pick.gen === "suffix" ? 1 : 0),
        };
        const t = holds(pred, (leaf) => {
            const b = base(leaf);
            if (b !== undefined) return b;
            switch (leaf.kind) {
                case "compare":
                    return compare(
                        counts[leaf.projection === "prefixCount" ? "prefix" : "suffix"],
                        leaf.op,
                        leaf.value,
                    );
                case "has":
                case "hasValue":
                    if (leaf.type === pick.type) return false;
                    return candidates.has(leaf.type)
                        ? certainty(leaf, roll.before)
                        : certainty(leaf, after);
                case "hasGroup": {
                    const survivors = [...leaf.types].filter(
                        (x) => candidates.has(x) && x !== pick.type,
                    );
                    if (survivors.length > 0) return true;
                    return certainty(leaf, after);
                }
                default:
                    return certainty(leaf, after);
            }
        });
        if (t === undefined) return survival(pred, roll);
        if (t) total += pick.prob;
        mass += pick.prob;
    }
    return mass > 0 ? Math.min(1, total / mass) : undefined;
}

/**
 * A condition the removal's candidates do not decide, read from the item
 * before: one that held rests on some modifier the item has, and a removal
 * fails it only by taking that modifier, one of the `n` it reaches; one that
 * failed comes to hold only by the same chance. A condition resting on several
 * modifiers is a little more fragile than this; the report says so.
 */
function survival(pred: RPred, roll: Extract<Roll, { kind: "removal" }>): number | undefined {
    const held = certainty(pred, roll.before);
    if (held === undefined) return undefined;
    const n = roll.sides.prefix.count + roll.sides.suffix.count;
    if (!(n >= 1)) return undefined;
    // The removal reaches `n` modifiers (the sides it cannot reach count zero).
    return held ? 1 - 1 / n : 1 / n;
}

/** A Divine Orb: a present modifier's value is uniform over its row's range
 *  again; which row it is, the item knows or does not. */
function rerollChance(pred: RPred, after: XItem, base: Truth): number | undefined {
    const valueLeaves = leaves(pred).filter(
        (l): l is Extract<Leaf, { kind: "hasValue" }> => l.kind === "hasValue",
    );
    const present = guaranteedTypes(after);
    const taken = new Map<TypeId, readonly RowLike[]>();
    const needsRow = new Set<TypeId>();
    for (const leaf of valueLeaves) {
        if (!present.has(leaf.type)) continue;
        const held = new Set(rowsOf(after, leaf.type).map((m) => m.id));
        const ids = [...leaf.rows.keys()].filter((id) => held.has(id));
        if (ids.length === 0) continue;
        taken.set(
            leaf.type,
            ids.map((id) => ({ id, weight: 1 })),
        );
        needsRow.add(leaf.type);
    }
    const prefix = counts(after).prefix;
    const suffix = suffixRange(after);
    return jointChance(
        pred,
        taken,
        needsRow,
        valueLeaves,
        {
            prefix: prefix[0] === prefix[1] ? prefix[0] : undefined,
            suffix: suffix[0] === suffix[1] ? suffix[0] : undefined,
        },
        (leaf) => base(leaf) ?? certainty(leaf, after),
    );
}

/** One of the candidates is picked, each with its probability. */
function pickChance(
    pred: RPred,
    candidates: readonly Candidate[],
    after: XItem,
    base: Truth,
    truthFor: (leaf: Leaf, picked: TypeId) => boolean | undefined,
): number | undefined {
    let total = 0;
    let mass = 0;
    for (const c of candidates) {
        const t = holds(
            pred,
            (leaf) => base(leaf) ?? truthFor(leaf, c.type) ?? certainty(leaf, after),
        );
        if (t === undefined) return undefined;
        if (t) total += c.prob;
        mass += c.prob;
    }
    // The pick may land on a modifier the state does not name: the atoms are
    // then as the item after the pick settles them.
    if (mass < 1 - 1e-9) {
        const rest = holds(pred, (leaf) => base(leaf) ?? certainty(leaf, after));
        if (rest === undefined) return undefined;
        if (rest) total += 1 - mass;
    }
    return total;
}

/** Three options drawn by weight without replacement; the player takes the
 *  one the condition wants, so a modifier offered counts as present. */
function unveilChance(pred: RPred, options: readonly Member[], base: Truth): number | undefined {
    const types = typesOfInterest(pred);
    let total = 0;
    for (const offer of unveilOffers(options, (t) => types.has(t))) {
        const offered = new Map(offer.members.map((m) => [m.type, m]));
        const t = holds(pred, (leaf) => base(leaf) ?? offeredTruth(leaf, offered));
        if (t === undefined) return undefined;
        if (t) total += offer.prob;
    }
    return total;
}

function offeredTruth(leaf: Leaf, offered: ReadonlyMap<TypeId, Member>): boolean | undefined {
    switch (leaf.kind) {
        case "has": {
            const member = offered.get(leaf.type);
            if (member === undefined) return false;
            if (leaf.tierMod === undefined) return true;
            return member.rows.some((r) => r.mod.id === leaf.tierMod);
        }
        case "hasGroup":
            return [...leaf.types].some((t) => offered.has(t));
        case "hasValue":
            return offered.has(leaf.type) ? undefined : false;
        default:
            return undefined;
    }
}

function typesOf(leaf: Leaf): readonly TypeId[] {
    if (leaf.kind === "has" || leaf.kind === "hasValue") return [leaf.type];
    return leaf.kind === "hasGroup" ? [...leaf.types] : [];
}

function typesOfInterest(pred: RPred): Set<TypeId> {
    const out = new Set<TypeId>();
    for (const leaf of leaves(pred)) {
        if (leaf.kind === "has" || leaf.kind === "hasValue") out.add(leaf.type);
        if (leaf.kind === "hasGroup") for (const t of leaf.types) out.add(t);
    }
    return out;
}

// --- the draw ---------------------------------------------------------------

/**
 * Which named groups each side drew, given how the draws split: each side's
 * joint with the split (`amongSplitDistribution`). The two sides are then
 * taken as independent given the split, which the race tests bound.
 */
export function sidesGivenSplit(
    v: DrawVariant,
    c: CountCase,
    prefixSpecial: readonly number[],
    suffixSpecial: readonly number[],
): [Float64Array, Float64Array] {
    const prefix = v.prefix.map((g) => g.weight);
    const suffix = v.suffix.map((g) => g.weight);
    const m = c.prefix + c.suffix;
    const { prefix: capP, suffix: capS } = v.room;
    return [
        amongSplitDistribution(prefix, suffix, prefixSpecial, c.prefix, m, capP, capS),
        amongSplitDistribution(suffix, prefix, suffixSpecial, c.suffix, m, capS, capP),
    ];
}

/** A row by id with the weight it is drawn at among its type's rows. */
interface RowLike {
    readonly id: ModId;
    readonly weight: number;
}

/** One way a modifier of interest can turn out: its row and, when a value
 *  atom asks, the part of the row's range its value fell in. */
interface Outcome {
    readonly prob: number;
    readonly row: ModId;
    readonly value?: Range;
}

/** The state of one modifier of interest in one joint outcome. */
interface Drawn {
    readonly outcome?: Outcome;
}

function drawChance(
    pred: RPred,
    variants: readonly DrawVariant[],
    after: XItem,
    base: Truth,
): number | undefined {
    const interest = typesOfInterest(pred);
    const valueLeaves = leaves(pred).filter(
        (l): l is Extract<Leaf, { kind: "hasValue" }> => l.kind === "hasValue",
    );
    const needsRow = new Set<TypeId>();
    for (const leaf of leaves(pred)) {
        if (leaf.kind === "has" && leaf.tierMod !== undefined) needsRow.add(leaf.type);
        if (leaf.kind === "hasValue") needsRow.add(leaf.type);
    }
    let total = 0;
    for (const v of variants) {
        const presentOf = new Map<TypeId, Present>();
        for (const p of v.present) presentOf.set(p.type, p);
        const named = (t: TypeId): boolean => interest.has(t);
        const sideSpecials = (groups: readonly Group[]): number[] => {
            const out: number[] = [];
            groups.forEach((g, i) => {
                if (holdsNamed(g, named)) out.push(i);
            });
            return out;
        };
        const prefixSpecial = sideSpecials(v.prefix);
        const suffixSpecial = sideSpecials(v.suffix);
        const presentCount = { prefix: 0, suffix: 0 };
        for (const p of v.present) presentCount[p.gen]++;
        for (const c of v.counts) {
            const [pd, sd] = sidesGivenSplit(v, c, prefixSpecial, suffixSpecial);
            // A side whose count the item left open has no count the roll can
            // give; a count atom on it is what the item after settles.
            const counts = {
                prefix:
                    v.before.prefix === undefined
                        ? undefined
                        : presentCount.prefix + v.before.prefix + c.prefix,
                suffix:
                    v.before.suffix === undefined
                        ? undefined
                        : presentCount.suffix + v.before.suffix + c.suffix,
            };
            for (let pm = 0; pm < pd.length; pm++) {
                if (pd[pm] === 0) continue;
                for (let sm = 0; sm < sd.length; sm++) {
                    const prob = v.prob * c.prob * pd[pm]! * sd[sm]!;
                    if (prob === 0) continue;
                    const rowsOf = (
                        rows: readonly { mod: { id: ModId }; weight: number }[],
                    ): RowLike[] => rows.map((r) => ({ id: r.mod.id, weight: r.weight }));
                    const drawn = [
                        ...prefixSpecial.filter((_i, b) => pm & (1 << b)).map((i) => v.prefix[i]!),
                        ...suffixSpecial.filter((_i, b) => sm & (1 << b)).map((i) => v.suffix[i]!),
                    ];
                    for (const c of memberCases(drawn, named)) {
                        // The modifiers of interest that are on the item in this outcome.
                        const taken = new Map<TypeId, readonly RowLike[]>();
                        for (const p of v.present) {
                            if (interest.has(p.type)) taken.set(p.type, rowsOf(p.rows));
                        }
                        for (const m of c.members) taken.set(m.type, rowsOf(m.rows));
                        const r = jointChance(
                            pred,
                            taken,
                            needsRow,
                            valueLeaves,
                            counts,
                            (leaf) =>
                                base(leaf) ??
                                (leaf.kind === "compare" ? certainty(leaf, after) : undefined),
                            // A modifier the item may hold before the fill and
                            // the draws do not lay down is as the item after
                            // the step settles it.
                            (leaf) =>
                                typesOf(leaf).some((t) => v.maybe.has(t))
                                    ? certainty(leaf, after)
                                    : false,
                        );
                        if (r === undefined) return undefined;
                        total += prob * c.prob * r;
                    }
                }
            }
        }
    }
    return Math.min(1, total);
}

/**
 * Given which modifiers of interest the item has, the chance the condition
 * holds: the rows of those whose row matters are enumerated jointly, or taken
 * as independent when there are too many to enumerate.
 */
function jointChance(
    pred: RPred,
    taken: ReadonlyMap<TypeId, readonly RowLike[]>,
    needsRow: ReadonlySet<TypeId>,
    valueLeaves: readonly Extract<Leaf, { kind: "hasValue" }>[],
    counts: Readonly<Record<Gen, number | undefined>>,
    base: Truth,
    absent: Truth = () => false,
): number | undefined {
    const enumerated: { type: TypeId; outcomes: Outcome[] }[] = [];
    let combos = 1;
    for (const [type, rows] of taken) {
        if (!needsRow.has(type)) continue;
        const outcomes = outcomesOf(
            rows,
            valueLeaves.filter((l) => l.type === type),
        );
        combos *= Math.max(1, outcomes.length);
        enumerated.push({ type, outcomes });
    }
    const truthWith =
        (drawn: ReadonlyMap<TypeId, Drawn>): Truth =>
        (leaf) => {
            const b = base(leaf);
            if (b !== undefined) return b;
            switch (leaf.kind) {
                case "compare": {
                    const n = counts[leaf.projection === "prefixCount" ? "prefix" : "suffix"];
                    return n === undefined ? undefined : compare(n, leaf.op, leaf.value);
                }
                case "hasGroup":
                    return [...leaf.types].some((t) => taken.has(t)) || absent(leaf);
                case "has": {
                    if (!taken.has(leaf.type)) return absent(leaf);
                    if (leaf.tierMod === undefined) return true;
                    return drawn.get(leaf.type)?.outcome?.row === leaf.tierMod;
                }
                case "hasValue": {
                    if (!taken.has(leaf.type)) return absent(leaf);
                    const o = drawn.get(leaf.type)?.outcome;
                    if (o === undefined) return undefined;
                    if (!leaf.rows.has(o.row)) return false;
                    if (o.value === undefined) return undefined;
                    return narrowRange(o.value, leaf.op, leaf.value) !== null;
                }
                default:
                    return undefined;
            }
        };
    if (enumerated.length === 0) {
        return boolToChance(holds(pred, truthWith(new Map())));
    }
    if (combos <= EXACT_LIMIT) {
        let total = 0;
        const drawn = new Map<TypeId, Drawn>();
        const walk = (i: number, prob: number): boolean => {
            if (i === enumerated.length) {
                const t = holds(pred, truthWith(drawn));
                if (t === undefined) return false;
                if (t) total += prob;
                return true;
            }
            const { type, outcomes } = enumerated[i]!;
            for (const o of outcomes) {
                drawn.set(type, { outcome: o });
                if (!walk(i + 1, prob * o.prob)) return false;
            }
            return true;
        };
        return walk(0, 1) ? total : undefined;
    }
    // Too many rows to enumerate jointly: each modifier's row independently,
    // the condition's leaves evaluated one at a time.
    let total = 0;
    const marginal = (leaf: Leaf): number | undefined => {
        const e = enumerated.find(
            (x) => (leaf.kind === "has" || leaf.kind === "hasValue") && x.type === leaf.type,
        );
        if (e === undefined) return boolToChance(truthWith(new Map())(leaf));
        let sum = 0;
        for (const o of e.outcomes) {
            const t = truthWith(new Map([[e.type, { outcome: o }]]))(leaf);
            if (t === undefined) return undefined;
            if (t) sum += o.prob;
        }
        return sum;
    };
    const all = leaves(pred);
    const probs: number[] = [];
    for (const leaf of all) {
        const p = marginal(leaf);
        if (p === undefined) return undefined;
        probs.push(p);
    }
    for (let mask = 0; mask < 1 << all.length; mask++) {
        let prob = 1;
        for (let b = 0; b < all.length; b++) prob *= mask & (1 << b) ? probs[b]! : 1 - probs[b]!;
        if (prob === 0) continue;
        const t = holds(pred, (leaf) => Boolean(mask & (1 << all.indexOf(leaf))));
        if (t) total += prob;
    }
    return total;
}

function boolToChance(t: boolean | undefined): number | undefined {
    return t === undefined ? undefined : t ? 1 : 0;
}

function compare(n: number, op: Cmp, v: number): boolean {
    switch (op) {
        case "==":
            return n === v;
        case "!=":
            return n !== v;
        case "<":
            return n < v;
        case "<=":
            return n <= v;
        case ">":
            return n > v;
        case ">=":
            return n >= v;
    }
}

/**
 * The ways a modifier of these rows turns out: each row by its weight share,
 * and within a row every part of its range the value atoms tell apart, by the
 * share of the range it is (the value uniform over the range).
 */
function outcomesOf(
    rows: readonly RowLike[],
    valueLeaves: readonly Extract<Leaf, { kind: "hasValue" }>[],
): Outcome[] {
    const total = rows.reduce((s, r) => s + r.weight, 0);
    const out: Outcome[] = [];
    for (const r of rows) {
        const prob = total > 0 ? r.weight / total : 1 / rows.length;
        const span = valueLeaves.map((l) => l.rows.get(r.id)).find((s) => s !== undefined);
        if (span === undefined || valueLeaves.length === 0) {
            out.push({ prob, row: r.id });
            continue;
        }
        for (const piece of pieces(span, valueLeaves)) {
            out.push({ prob: prob * piece.share, row: r.id, value: piece.range });
        }
    }
    return out;
}

/** The parts of `span` the value atoms tell apart, each with its share of the span. */
export function pieces(
    span: Range,
    valueLeaves: readonly Extract<Leaf, { kind: "hasValue" }>[],
): { range: Range; share: number }[] {
    const [lo, hi] = span;
    const whole = Number.isInteger(lo) && Number.isInteger(hi);
    const cuts = new Set<number>();
    for (const l of valueLeaves) {
        if (!Number.isInteger(l.value) && whole) continue;
        switch (l.op) {
            case ">=":
            case "<":
                cuts.add(l.value);
                break;
            case ">":
            case "<=":
                cuts.add(whole ? l.value + 1 : l.value);
                break;
            case "==":
            case "!=":
                cuts.add(l.value);
                cuts.add(whole ? l.value + 1 : l.value);
                break;
        }
    }
    const inside = [...cuts].filter((c) => c > lo && c <= hi).sort((a, b) => a - b);
    const length = whole ? hi - lo + 1 : hi - lo;
    if (length <= 0) return [{ range: span, share: 1 }];
    const out: { range: Range; share: number }[] = [];
    let start = lo;
    for (const c of [...inside, whole ? hi + 1 : hi]) {
        const end = whole ? c - 1 : c;
        if (end < start) continue;
        const len = whole ? end - start + 1 : end - start;
        if (len > 0) out.push({ range: [start, end], share: len / length });
        start = c;
    }
    return out;
}
