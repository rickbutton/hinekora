/**
 * The item as the cost layer tracks it: a distribution over a small state,
 * the (prefix, suffix) counts and, for each modifier the craft names or the
 * checker knows is there (declared, granted, crafted, a protecting metamod),
 * whether it is on the item and at which row (`ChainState`). The walk carries
 * it from the item block through every step it can read, and a loop solved as
 * a chain (`chain.ts`) round by round; these are the pieces that read a step, a
 * condition or a roll in its terms.
 */
import { type Gen, ModId, type TagId, TypeId } from "../model/ids.js";
import {
    ELDRITCH_SIDES,
    type EldritchSide,
    dominantOf,
    eldritchKey,
    eldritchOf,
    influenceOfTag,
    NO_ELDRITCH,
} from "../model/marks.js";
import type { Mod } from "../model/mod.js";
import type { Range } from "../check/range.js";
import { narrowRange } from "../check/values.js";
import type { Op } from "../check/ops/types.js";
import type { Registry } from "../resolve/registry.js";
import type { RPred } from "../check/pred.js";
import type { Dd } from "../check/dd.js";
import { narrow as narrowTo, stateOf, type ItemSet } from "../check/state.js";
import type { ModValue, Universe } from "../check/universe.js";
import {
    counts as countsOf,
    eldritchPairs,
    eldritchTypes,
    fracturedCount,
    guaranteedFacts,
    guaranteedTypes,
    influenceSets,
    influenceTagsAny,
    influenceTagsOf,
    isExcluded,
    isFractured,
    possibleTypes,
    rarities,
    rowsOf,
    strandsRange,
    unnamedImplicit,
    valueSpan,
} from "../check/views.js";
import { lookupWeight } from "../pool/pool.js";
import { VEILED_PREFIX, VEILED_SUFFIX } from "../model/veiled.js";
import { rollableGen, rollableTiers } from "../resolve/tiers.js";
import type { ChainAtom, ChainState, Outcome } from "./chain.js";
import { pieces, sidesGivenSplit } from "./chance.js";
import { amongFirstDistribution } from "./race.js";
import {
    holdsNamed,
    implicitWeights,
    type Member,
    memberCases,
    naturalGroups,
    ranOn,
    type Reading,
    type Roll,
    rollOf,
    unmodelled,
    unveilOffers,
} from "./roll.js";

/** The states a chain-solved loop's exit leaves the item in, over the
 *  modifiers that loop named; the weights sum to one. */
export interface Carried {
    readonly types: readonly TypeId[];
    /** The types whose rows carry the part of the range their value is in. */
    readonly valued?: ReadonlySet<TypeId>;
    /** The rows say which modifier is fractured. */
    readonly locks?: boolean;
    /** The rows say which eldritch implicits the item carries. */
    readonly implicits?: boolean;
    /** The states passed a method of several outcomes, read on odds and
     *  counts of the walk's own (`OUTCOME_ODDS`, QUESTIONS.md Q112), which may
     *  leave out items the check reaches. */
    readonly forked?: boolean;
    readonly dist: readonly { readonly state: ChainState; readonly weight: number }[];
}

type ValueLeaf = Extract<RPred, { kind: "hasValue" }>;

/** How much of `part` lies in `span`, as a share of `part`, whole numbers
 *  counted one by one as the value roll is. */
function overlap(part: Range, span: Range): number {
    const whole = [...part, ...span].every(Number.isInteger);
    const lo = Math.max(part[0], span[0]);
    const hi = Math.min(part[1], span[1]);
    const len = whole ? hi - lo + 1 : hi - lo;
    const of = whole ? part[1] - part[0] + 1 : part[1] - part[0];
    if (!(of > 0)) return lo <= hi ? 1 : 0;
    return Math.max(0, len) / of;
}

/**
 * A tracked row of a modifier whose value a condition compares carries the
 * part of the row's range its value is in, as `row~lo~hi`; any other row is
 * the row alone. A fractured modifier's row ends in `!`.
 */
export function readRow(row: ModId): { base: ModId; value?: Range; locked?: true } {
    if (row.endsWith("!")) return { ...readRow(ModId(row.slice(0, -1))), locked: true };
    const at = row.indexOf("~");
    if (at < 0) return { base: row };
    const [lo, hi] = row
        .slice(at + 1)
        .split("~")
        .map(Number) as [number, number];
    return { base: ModId(row.slice(0, at)), value: [lo, hi] };
}

function valueRow(base: ModId, value: Range): ModId {
    return ModId(`${base}~${value[0]}~${value[1]}`);
}

function lockedRow(row: ModId): ModId {
    return row.endsWith("!") ? row : ModId(`${row}!`);
}

function unlockedRow(row: ModId): ModId {
    return row.endsWith("!") ? ModId(row.slice(0, -1)) : row;
}

/** The atom that holds an eldritch implicit: its row is the tier, and the
 *  implicit's type after a colon where a condition names types. */
const IMPLICIT_ATOM: Readonly<Record<EldritchSide, TypeId>> = {
    exarch: TypeId("~exarch"),
    eater: TypeId("~eater"),
};

/** The implicit types no condition names, held as one. */
const OTHER_IMPLICIT = TypeId("*");

function implicitRow(tier: number, type: TypeId | undefined): ModId {
    return ModId(type === undefined ? `${tier}` : `${tier}:${type}`);
}

function readImplicit(row: ModId): { tier: number; type?: TypeId } {
    const at = row.indexOf(":");
    if (at < 0) return { tier: Number(row) };
    return { tier: Number(row.slice(0, at)), type: TypeId(row.slice(at + 1)) };
}

/** What each tier of lead takes off an implicit's chance to rise under an Orb
 *  of Conflict, and the least chance either side is given. */
const CONFLICT_STEP = 0.11;
const CONFLICT_FLOOR = 0.01;

type Outcomes = readonly (readonly Op[])[];

/** Four outcomes, each as likely: the ones that change nothing the item block
 *  names (a socket's colour, no effect, an outcome the base cannot take) are
 *  the empty branch, which holds what the others leave of the four. */
const fourAlike = (branches: Outcomes): readonly number[] =>
    branches.map((b) => (b.length === 0 ? 4 - (branches.length - 1) : 1));

/**
 * How likely each outcome of a method with several is, by the method's words,
 * as weights over its `either` branches on the item it is used on; undefined
 * where the odds are not known.
 */
const OUTCOME_ODDS: Readonly<
    Record<string, (branches: Outcomes, item: ItemSet) => readonly number[] | undefined>
> = {
    // Vaal Orb § Equipment, § Jewels: a new implicit, the reforge, and on the
    // three basic jewels a unique jewel, on which the craft ends.
    vaal: fourAlike,
    // The Corruption Altar keeps the four outcomes of Locus of Corruption §
    // Possible outcomes, its reforge now destroying the item (Version 3.30.0,
    // Incursion and Atziri): no change one in four, a corruption implicit one in four,
    // the item destroyed two in four (`ASSUMED_ODDS`, QUESTIONS.md Q32).
    locus: (branches) => branches.map((b) => (endsCraft(b) ? 2 : 1)),
};

/** What a step whose odds no source states is taken to do, for its note. */
const ASSUMED_ODDS: Readonly<Record<string, string>> = {
    locus: "the Corruption Altar is taken to destroy the item two times in four, as its old reforge and destruction did together; no source states its odds",
    dominance:
        "an Orb of Dominance is taken to remove each influenced modifier it can reach alike, and to raise each of the others alike; no source states its odds",
};

/** The note of a step that rests on odds no source states. */
export function assumedOdds(method: string): string | undefined {
    return ASSUMED_ODDS[method];
}

/** How a step ends the craft on one of its outcomes, for its note. */
const ENDINGS: Readonly<Record<string, string>> = {
    vaal: "a Vaal Orb turns this jewel into a unique jewel, which ends the craft there",
    locus: "the Corruption Altar destroys the item, which ends the craft there",
};

function endsCraft(branch: readonly Op[]): boolean {
    return branch.some((op) => op.kind === "end");
}

/**
 * The share of a method's uses that end the craft (the item destroyed, or
 * turned into another), with the words that say so; undefined for a method
 * with no such outcome or whose odds are not known.
 */
export function ending(
    method: string,
    ops: readonly Op[],
    item: ItemSet,
): { readonly share: number; readonly note: string } | undefined {
    const either = ops.find((op) => op.kind === "either");
    if (either?.kind !== "either") return undefined;
    const odds = OUTCOME_ODDS[method]?.(either.branches, item);
    const note = ENDINGS[method];
    if (odds === undefined || note === undefined) return undefined;
    let ends = 0;
    let total = 0;
    either.branches.forEach((b, i) => {
        total += odds[i]!;
        if (endsCraft(b)) ends += odds[i]!;
    });
    return ends > 0 ? { share: ends / total, note } : undefined;
}

/** Rows a condition tells apart: one named tier, or the rest of a ladder. */
interface RowClass {
    /** The row that stands for the class on the state: a named tier is itself. */
    readonly rep: ModId;
    readonly members: readonly { readonly id: ModId; readonly weight: number }[];
}

/** The states one walk may read a method on, and the outcomes one reading may
 *  give: past them the craft's named modifiers are too many to follow by
 *  state, a product of their rows and value pieces, and the walk takes the
 *  checker's item instead. */
const MAX_STATES = 5000;
const MAX_OUTCOMES = 5000;

/** Thrown where a craft's states outgrow `MAX_STATES` or `MAX_OUTCOMES`. */
export class TrackerOverflow extends Error {
    constructor() {
        super("too many states to follow");
    }
}

/**
 * The modifiers the craft's conditions name, the ones any step's item surely
 * holds, and the metamods that protect a side, tracked through it: one atom per
 * type, whatever loop or branch names it, so a distribution means the same
 * thing from the item block to the last step. A type's rows are grouped into
 * the classes the conditions tell apart (each tier a condition names on its
 * own, the rest together), so a type no condition tiers is one class, not a
 * dozen rows. A protecting metamod is an atom because a removal may take it,
 * and its side is out of reach while it is there.
 */
export class Tracker {
    readonly atoms: ChainAtom[] = [];
    readonly types: TypeId[] = [];
    readonly index = new Map<TypeId, number>();
    readonly protections: { readonly atom: number; readonly side: Gen }[] = [];
    /** Some step's item may carry a fractured modifier, so a state says which. */
    readonly locks: boolean;
    /** Some step's item may carry an eldritch implicit, so a state says which,
     *  and its type when a condition names one. */
    readonly implicits: boolean;
    private readonly implicitTypes: ReadonlySet<TypeId>;
    /** The modifier types the craft's conditions ask to be present, in the
     *  order they first do: what a player takes when an unveil offers one. */
    private readonly asked: TypeId[] = [];
    readonly classes: RowClass[][] = [];
    /** Per atom, each row's classes with the share of the row's weight each holds. */
    private readonly classesOfRow: Map<ModId, { rep: ModId; share: number }[]>[] = [];
    /** The value conditions each type is compared by, which split its rows. */
    private readonly valueLeaves = new Map<TypeId, ValueLeaf[]>();

    constructor(
        private readonly registry: Registry,
        first: ItemSet,
        items: readonly ItemSet[],
        preds: readonly RPred[],
        crafted: readonly TypeId[],
    ) {
        this.locks = items.some((a) => fracturedCount(a)[1] > 0);
        this.implicits = items.some((a) => [...eldritchPairs(a)].some((k) => k !== NO_ELDRITCH));
        const implicitTypes = new Set<TypeId>();
        for (const p of preds)
            for (const l of predLeaves(p))
                if (l.kind === "eldritch") for (const t of l.types ?? []) implicitTypes.add(t);
        this.implicitTypes = implicitTypes;
        for (const pred of preds)
            for (const t of askedFor(pred)) if (!this.asked.includes(t)) this.asked.push(t);
        const named = new Set<ModId>();
        const wanted: TypeId[] = [];
        for (const pred of preds) {
            for (const leaf of predLeaves(pred)) {
                if (leaf.kind === "has") {
                    wanted.push(leaf.type);
                    if (leaf.tierMod !== undefined) named.add(leaf.tierMod);
                } else if (leaf.kind === "hasGroup") wanted.push(...leaf.types);
                else if (leaf.kind === "fractured") wanted.push(leaf.type);
                else if (leaf.kind === "hasValue") {
                    wanted.push(leaf.type);
                    const list = this.valueLeaves.get(leaf.type) ?? [];
                    list.push(leaf);
                    this.valueLeaves.set(leaf.type, list);
                }
            }
        }
        const protecting: { type: TypeId; side: Gen }[] = [];
        const seen = new Set<TypeId>();
        for (const item of items) {
            for (const t of [...guaranteedTypes(item), ...possibleTypes(item), ...crafted]) {
                if (seen.has(t)) continue;
                seen.add(t);
                for (const e of registry.effectsOfType(t)) {
                    if (e.kind === "protect") protecting.push({ type: t, side: e.gen });
                }
            }
        }
        const tags = new Set<TagId>();
        for (const item of items) for (const t of influenceTagsAny(item)) tags.add(t);
        const { base, ilvl } = first.u;
        const baseTags = new Set([...base.tags, ...tags]);
        const add = (type: TypeId): number => {
            const known = this.index.get(type);
            if (known !== undefined) return known;
            const i = this.atoms.length;
            this.index.set(type, i);
            this.types.push(type);
            let rows = rollableTiers(registry.catalog, base, ilvl, type, tags)
                .map((m) => ({ id: m.id, weight: lookupWeight(m, baseTags) ?? 0 }))
                .filter((r) => r.weight > 0);
            const weight = rows.reduce((sum, r) => sum + r.weight, 0);
            let gen = genOfOn(registry, first, type);
            if (rows.length === 0) {
                // A row no roll lays down (a bench craft's): placed, never drawn,
                // on the side of the rows the craft's items hold, where its
                // type's rows elsewhere sit on both.
                rows = registry.catalog
                    .filter((m) => m.type === type)
                    .map((m) => ({ id: m.id, weight: 1 }));
                const sides = new Set(items.flatMap((a) => rowsOf(a, type).map((m) => m.gen)));
                if (sides.size === 1) gen = [...sides][0]!;
            } else {
                // An elevated row of a type that rolls: an Orb of Dominance
                // alone makes it, so it is placed, never drawn.
                for (const m of registry.catalog) {
                    if (m.type === type && m.source === "elevated" && m.domain === base.domain)
                        rows.push({ id: m.id, weight: 0 });
                }
            }
            const leaves = this.valueLeaves.get(type);
            const classes: RowClass[] = [];
            const ofRow = new Map<ModId, { rep: ModId; share: number }[]>();
            const into = (r: { id: ModId; weight: number }, rep: ModId, share: number): void => {
                const list = ofRow.get(r.id) ?? [];
                list.push({ rep, share });
                ofRow.set(r.id, list);
            };
            if (leaves !== undefined) {
                // Compared by value: each row apart, cut where the conditions'
                // thresholds fall, each part by its share of the range.
                for (const r of rows) {
                    const span = leaves.map((l) => l.rows.get(r.id)).find((s) => s !== undefined);
                    const parts =
                        span === undefined
                            ? [{ range: undefined, share: 1 }]
                            : pieces(span, leaves);
                    for (const p of parts) {
                        const rep = p.range === undefined ? r.id : valueRow(r.id, p.range);
                        classes.push({ rep, members: [{ id: r.id, weight: r.weight * p.share }] });
                        into(r, rep, p.share);
                    }
                }
            } else {
                const own = rows.filter((r) => named.has(r.id));
                const rest = rows.filter((r) => !named.has(r.id));
                for (const r of own) classes.push({ rep: r.id, members: [r] });
                if (rest.length > 0) classes.push({ rep: rest[0]!.id, members: rest });
                for (const c of classes) for (const m of c.members) into(m, c.rep, 1);
            }
            this.classes.push(classes);
            this.classesOfRow.push(ofRow);
            this.atoms.push({
                gen,
                rows: classes.map((c) => ({
                    id: c.rep,
                    weight: c.members.reduce((sum, m) => sum + m.weight, 0),
                })),
                weight,
            });
            return i;
        };
        for (const t of wanted) add(t);
        for (const p of protecting) this.protections.push({ atom: add(p.type), side: p.side });
        // A modifier the checker knows is there somewhere (declared, granted,
        // crafted) is followed by name too, so a draw onto the item closes its
        // group for certain rather than on average.
        for (const item of items) for (const t of guaranteedTypes(item)) add(t);
        // A modifier an Orb of Dominance made of another type stays one the
        // orb can pick, so it is followed by name.
        const made = new Set(registry.catalog.map((m) => m.type));
        for (const m of registry.catalog) if (m.source !== "elevated") made.delete(m.type);
        for (const item of items) for (const t of possibleTypes(item)) if (made.has(t)) add(t);
        if (this.implicits) {
            for (const side of ELDRITCH_SIDES) {
                const type = IMPLICIT_ATOM[side];
                this.index.set(type, this.atoms.length);
                this.types.push(type);
                this.classes.push([]);
                this.classesOfRow.push(new Map());
                this.atoms.push({ gen: "prefix", rows: [], weight: 0 });
            }
        }
        // A veiled modifier's side decides which side its unveil fills.
        if (
            items.some(
                (a) => possibleTypes(a).has(VEILED_PREFIX) || possibleTypes(a).has(VEILED_SUFFIX),
            )
        ) {
            add(VEILED_PREFIX);
            add(VEILED_SUFFIX);
        }
    }

    /**
     * The classes a row of atom `i` falls in, each with its share of the row:
     * one, unless the type is compared by value, when a fresh roll lands in
     * each part of the range by its share and a kept modifier stays in the
     * part its known span is in.
     */
    classesOf(i: number, id: ModId, kept?: Range): readonly { id: ModId; share: number }[] {
        const list = this.classesOfRow[i]?.get(id);
        if (list === undefined) return [{ id, share: 1 }];
        const out = list
            .map((c) => {
                const value = readRow(c.rep).value;
                const share =
                    kept === undefined || value === undefined ? c.share : overlap(value, kept);
                return { id: c.rep, share };
            })
            .filter((c) => c.share > 0);
        const total = out.reduce((s, c) => s + c.share, 0);
        return total > 0 ? out.map((c) => ({ ...c, share: c.share / total })) : [{ id, share: 1 }];
    }

    /** Whether a condition on the type's value can be read off the state. */
    valued(type: TypeId): boolean {
        return this.valueLeaves.has(type);
    }

    /** Atom `i`'s classes the item allows, by the weight of their rows it allows. */
    rowsOn(i: number, item: ItemSet): readonly { id: ModId; weight: number }[] {
        const type = this.types[i]!;
        const held = heldRows(item, type);
        const out: { id: ModId; weight: number }[] = [];
        // The rows no roll lays down (an elevated row), which count alike
        // where the item allows no other.
        const placed: { id: ModId; weight: number }[] = [];
        for (const c of this.classes[i]!) {
            // A class cut by value holds one row, whose values the items narrow.
            const value = readRow(c.rep).value;
            const known = value === undefined ? undefined : valueSpan(item, type, c.members[0]!.id);
            const part = known === undefined || value === undefined ? 1 : overlap(value, known);
            const allowed = c.members.filter((m) => held.has(m.id));
            const weight = part * allowed.reduce((sum, m) => sum + m.weight, 0);
            if (weight > 0) out.push({ id: c.rep, weight });
            if (part * allowed.length > 0)
                placed.push({ id: c.rep, weight: part * allowed.length });
        }
        if (out.length > 0) return out;
        return placed.length > 0 ? placed : this.atoms[i]!.rows;
    }

    /** States over the tracked atoms, as carried states. */
    carried(dist: readonly { readonly state: ChainState; readonly weight: number }[]): Carried {
        return {
            types: this.types,
            valued: new Set(this.valueLeaves.keys()),
            locks: this.locks,
            implicits: this.implicits,
            dist,
        };
    }

    /** States a method left as they were because the checker's item, narrowed
     *  to them, could not say exactly where the method takes them. */
    misses = 0;
    /** Why the last such state was left, where the reason can be named. */
    unfollowed: string | undefined;
    private computed = 0;

    private another(): void {
        if (++this.computed > MAX_STATES) throw new TrackerOverflow();
    }

    /**
     * Where a method takes each state: the checker's item before it narrowed to
     * the state (its counts, each atom present at its class or absent), the
     * method read on that item, and the item it leaves read back as states. A
     * random method's roll gives the outcomes and their chances; a sure one
     * gives one state; a Divine Orb rolls the value of every modifier a
     * condition compares again within its tier. Undefined for a method whose
     * randomness the state does not hold (an implicit), which the walk reads
     * off the roll instead.
     */
    transition(
        before: ItemSet,
        ops: readonly Op[],
        reading: Reading,
        method = "",
    ): ((state: ChainState) => readonly Outcome[]) | undefined {
        const kind = rollOf(before, ops, this.registry, reading).kind;
        const cache = new Map<string, readonly Outcome[]>();
        if (kind === "reroll") {
            return besideImprint((state) => {
                const key = stateKey(state);
                if (!cache.has(key)) this.another();
                const out = cache.get(key) ?? this.kept(state, ops, this.rerolled(state));
                cache.set(key, out);
                return out;
            });
        }
        if (
            kind !== "draw" &&
            kind !== "removal" &&
            kind !== "none" &&
            kind !== "unveil" &&
            kind !== "lock" &&
            kind !== "implicit"
        )
            return undefined;
        // A draw's outcomes rest on the item its fill starts from, which many
        // states share where a reforge strips what tells them apart.
        const fillAt = ops.findIndex((op) => op.kind === "fill");
        const cut = removalBeforeFill(ops);
        const drawn = new Map<string, readonly Outcome[]>();
        return besideImprint((state) => {
            const key = stateKey(state);
            const hit = cache.get(key);
            if (hit !== undefined) return hit;
            this.another();
            let out: readonly Outcome[] | undefined;
            // A removal after the fill reads the whole state, so its outcomes
            // are not shared by the fill's item.
            const item =
                kind === "draw" && fillAt >= 0 && cut < 0 && removalAfterFill(ops) < 0
                    ? this.narrow(before, state)
                    : null;
            if (item !== null) {
                const sig = this.signature(this.stripped(item, ops, fillAt));
                out = drawn.get(sig);
                if (out === undefined) {
                    out = this.outcomes(before, ops, state, reading, method) ?? [
                        { state, prob: 1 },
                    ];
                    drawn.set(sig, out);
                }
            } else {
                out = this.outcomes(before, ops, state, reading, method) ?? [{ state, prob: 1 }];
            }
            if (out.length > MAX_OUTCOMES) throw new TrackerOverflow();
            out = pruned(out);
            out = this.kept(state, ops, out);
            cache.set(key, out);
            return out;
        });
    }

    /** What a draw reads of an item: its counts, rarity, strands, influences,
     *  the modifiers it surely holds and the named ones' tiers and values. */
    private signature(a: ItemSet): string {
        const guaranteed = [...guaranteedTypes(a)].sort();
        const tiers = this.types.map((t) =>
            rowsOf(a, t)
                .map((m) => `${m.id}@${valueSpan(a, t, m.id)?.join("..") ?? ""}`)
                .join("+"),
        );
        return JSON.stringify([
            countsOf(a),
            [...rarities(a)].sort(),
            strandsRange(a),
            [...influenceSets(a)].sort(),
            guaranteed,
            tiers,
        ]);
    }

    private outcomes(
        before: ItemSet,
        ops: readonly Op[],
        state: ChainState,
        reading: Reading,
        method: string,
    ): readonly Outcome[] | undefined {
        const item = this.narrow(before, state);
        if (item === null || unmodelled(ops, item, this.registry) !== undefined) {
            return this.counted(undefined);
        }
        const at = ops.findIndex((op) => op.kind === "either");
        const either = ops[at];
        if (either?.kind !== "either") return this.outcomesOn(item, ops, state, reading);
        // A method whose every outcome ends the craft (`runMethod`'s `ended`)
        // ends it, whatever its odds.
        if (either.branches.length > 0 && either.branches.every(endsCraft))
            return [{ state, prob: 1, ends: true }];
        // A method of several outcomes whose odds are known: each outcome's
        // steps read in the method's place, by its share.
        const odds = OUTCOME_ODDS[method]?.(either.branches, item);
        if (odds === undefined) return this.counted(undefined);
        const total = odds.reduce((sum, w) => sum + w, 0);
        const out: Outcome[] = [];
        for (let b = 0; b < either.branches.length; b++) {
            if (!(odds[b]! > 0)) continue;
            const share = odds[b]! / total;
            if (endsCraft(either.branches[b]!)) {
                out.push({ state, prob: share, ends: true });
                continue;
            }
            const taken = [...ops.slice(0, at), ...either.branches[b]!, ...ops.slice(at + 1)];
            const next = this.outcomesOn(item, taken, state, reading);
            if (next === undefined) return undefined;
            for (const o of next) out.push({ state: o.state, prob: o.prob * share });
        }
        return out;
    }

    private kept(
        state: ChainState,
        ops: readonly Op[],
        out: readonly Outcome[],
    ): readonly Outcome[] {
        const touched = touchesImplicits(ops);
        const implicitAtoms = touched
            ? []
            : ELDRITCH_SIDES.map((side) => this.index.get(IMPLICIT_ATOM[side])).filter(
                  (i) => i !== undefined,
              );
        return keepAcross(state, out, implicitAtoms);
    }

    /**
     * An Orb of Conflict on a state with both implicits: one side up a tier, to
     * Perfect at most, the other down, a Lesser one lowered gone (the orb's
     * text: "Lesser modifiers that have their strength lowered will be removed").
     * Equal tiers rise alike and each tier a side is ahead takes about eleven
     * hundredths off its chance (Orb of Conflict § Mechanics); a gap wider than
     * the page's example is that line carried on, held above `CONFLICT_FLOOR`
     * (QUESTIONS.md Q96). Each keeps its type.
     */
    private conflicted(state: ChainState): readonly Outcome[] | undefined {
        const at = ELDRITCH_SIDES.map((side) => this.index.get(IMPLICIT_ATOM[side]));
        const [ex, eat] = at;
        if (ex === undefined || eat === undefined) return undefined;
        const rowEx = state.rows[ex] ?? null;
        const rowEat = state.rows[eat] ?? null;
        if (rowEx === null || rowEat === null) return [{ state, prob: 1 }];
        const a = readImplicit(rowEx);
        const b = readImplicit(rowEat);
        const moved = (up: typeof a, down: typeof a): [ModId, ModId | null] => [
            implicitRow(Math.min(up.tier + 1, 6), up.type),
            down.tier > 1 ? implicitRow(down.tier - 1, down.type) : null,
        ];
        const rise = (
            raised: number,
            lowered: number,
            rows: [ModId, ModId | null],
            prob: number,
        ): Outcome => {
            const next = [...state.rows];
            next[raised] = rows[0];
            next[lowered] = rows[1];
            return { state: { ...state, rows: next }, prob };
        };
        const exarchUp = Math.min(
            1 - CONFLICT_FLOOR,
            Math.max(CONFLICT_FLOOR, 1 / 2 - CONFLICT_STEP * (a.tier - b.tier)),
        );
        return [rise(ex, eat, moved(a, b), exarchUp), rise(eat, ex, moved(b, a), 1 - exarchUp)];
    }

    /** The eldritch implicit on one side of an item the checker settles, as
     *  rows by weight: none for no implicit, undefined where the item leaves
     *  its tier open. A type a condition names that the item leaves open is the
     *  state's own, or else each type the item allows by its weight in the
     *  ember pool of that tier. */
    private implicitIn(
        item: ItemSet,
        side: EldritchSide,
        from: ChainState | undefined,
    ): readonly { id: ModId; weight: number }[] | undefined {
        const tiers = new Set([...eldritchPairs(item)].map((k) => eldritchOf(k)[side]));
        if (tiers.size !== 1) return undefined;
        const tier = [...tiers][0]!;
        if (tier === 0) return [];
        if (this.implicitTypes.size === 0) return [{ id: implicitRow(tier, undefined), weight: 1 }];
        // An implicit the catalogue does not name is one no condition names.
        const have = eldritchTypes(item, side);
        const kinds = new Set([...have].map((t) => this.kindOf(t)));
        if (unnamedImplicit(item, side)) kinds.add(OTHER_IMPLICIT);
        if (kinds.size === 1) return [{ id: implicitRow(tier, [...kinds][0]), weight: 1 }];
        const fromRow = from?.rows[this.index.get(IMPLICIT_ATOM[side])!] ?? null;
        const was = fromRow === null ? undefined : readImplicit(fromRow).type;
        if (was !== undefined && kinds.has(was)) return [{ id: implicitRow(tier, was), weight: 1 }];
        const byKind = new Map<TypeId, number>();
        for (const e of implicitWeights(this.registry, item.u.base, side, tier)) {
            if (!have.has(e.type)) continue;
            const kind = this.kindOf(e.type);
            if (e.weight > 0) byKind.set(kind, (byKind.get(kind) ?? 0) + e.weight);
        }
        if (byKind.size === 0) return [{ id: implicitRow(tier, OTHER_IMPLICIT), weight: 1 }];
        return [...byKind].map(([kind, weight]) => ({ id: implicitRow(tier, kind), weight }));
    }

    /**
     * Rows read off an item without the tracker (a loop's plain start) marked
     * as the item settles them: a modifier fractured on every item that
     * carries it locked, and the eldritch implicits by `implicitIn`. Undefined
     * where the item leaves either open.
     */
    marked(
        item: ItemSet,
        rows: readonly (ModId | null)[],
    ): { rows: (ModId | null)[]; share: number }[] | undefined {
        let out = [{ rows: [...rows], share: 1 }];
        if (this.locks) {
            for (const st of out) {
                for (const [i, r] of st.rows.entries()) {
                    if (r === null || implicitSide(this.types[i]!) !== undefined) continue;
                    const locked = lockedOn(item, this.types[i]!);
                    if (locked === undefined) return undefined;
                    if (locked) st.rows[i] = lockedRow(r);
                }
            }
        }
        if (this.implicits) {
            for (const side of ELDRITCH_SIDES) {
                const i = this.index.get(IMPLICIT_ATOM[side])!;
                const options = this.implicitIn(item, side, undefined);
                if (options === undefined) return undefined;
                if (options.length === 0) continue;
                const total = options.reduce((sum, o) => sum + o.weight, 0);
                out = out.flatMap((st) =>
                    options.map((o) => {
                        const copy = [...st.rows];
                        copy[i] = o.id;
                        return { rows: copy, share: (st.share * o.weight) / total };
                    }),
                );
            }
        }
        return out;
    }

    /** An implicit's type as a state holds it: a type a condition names, or
     *  any other alike. */
    private kindOf(type: TypeId): TypeId {
        return this.implicitTypes.has(type) ? type : OTHER_IMPLICIT;
    }

    private crafted(row: ModId): boolean {
        const mod = this.registry.resolveMod(readRow(row).base);
        return mod.ok && mod.value.source === "bench";
    }

    /**
     * An unveil: three options (Veiled modifier), drawn as `unveilOffers`
     * takes them to be, the veiled modifier becoming the one the player takes:
     * the target when it is offered, else the first modifier a condition of the
     * craft asks for, else one no one names.
     */
    private unveiled(
        state: ChainState,
        options: readonly Member[],
        target: TypeId | undefined,
    ): readonly Outcome[] | undefined {
        const veiled = [VEILED_PREFIX, VEILED_SUFFIX]
            .map((t) => this.index.get(t))
            .find((i) => i !== undefined && state.rows[i] !== null);
        if (veiled === undefined) return undefined;
        const wanted = (t: TypeId): boolean =>
            t === target || (this.index.has(t) && this.asked.includes(t));
        const rank = (t: TypeId): number => (t === target ? -1 : this.asked.indexOf(t));
        const out: Outcome[] = [];
        for (const { prob, members } of unveilOffers(options, wanted)) {
            const rows = [...state.rows];
            rows[veiled] = null;
            if (members.length === 0) {
                out.push({ state: { ...state, rows }, prob });
                continue;
            }
            const taken = members.reduce((a, b) => (rank(b.type) < rank(a.type) ? b : a));
            const i = this.index.get(taken.type);
            if (i === undefined) {
                // A target no condition names: a modifier the state does not hold.
                out.push({ state: { ...state, rows }, prob });
                continue;
            }
            for (const r of taken.rows) {
                for (const c of this.classesOf(i, r.mod.id)) {
                    const placed = [...rows];
                    placed[i] = c.id;
                    out.push({
                        state: { ...state, rows: placed },
                        prob: (prob * r.weight * c.share) / taken.weight,
                    });
                }
            }
        }
        return out;
    }

    /** The item a veiled placeholder went onto, read on each side it may be
     *  on, the sides with room alike (QUESTIONS.md Q76). */
    private veiledSides(a: ItemSet, from: ChainState): readonly Outcome[] | undefined {
        const sides: (readonly Outcome[])[] = [];
        for (const [type, gen] of [
            [VEILED_PREFIX, "prefix"],
            [VEILED_SUFFIX, "suffix"],
        ] as const) {
            const to = bump(from, gen, 1, from.rows);
            let side: ItemSet | null = a;
            for (const c of [
                { kind: "compare", projection: "prefixCount", op: "==", value: to.prefix },
                { kind: "compare", projection: "suffixCount", op: "==", value: to.suffix },
                { kind: "has", type, gen },
            ] as const) {
                side = side === null ? null : narrowTo(side, c, true);
            }
            if (side === null) continue;
            const states = this.statesIn(side, from);
            if (states === undefined) return undefined;
            sides.push(states);
        }
        return sides.flatMap((out) => out.map((o) => ({ ...o, prob: o.prob / sides.length })));
    }

    /** `outcomes` on the checker's item already narrowed to `state`. */
    private outcomesOn(
        item: ItemSet,
        ops: readonly Op[],
        state: ChainState,
        reading: Reading,
    ): readonly Outcome[] | undefined {
        const cut = removalBeforeFill(ops);
        if (cut >= 0) {
            // What the fill finds rests on what the removal took: each removal
            // outcome is read on its own before the rest of the method runs.
            const head = ops.slice(0, cut + 1);
            const removed = this.outcomesOn(item, head, state, reading);
            if (removed === undefined) return undefined;
            const mid = ranOn(item, ops, cut + 1).state;
            const tail = ops.slice(cut + 1);
            const out: Outcome[] = [];
            for (const r of removed) {
                const at = this.narrow(mid, r.state);
                const next = at === null ? undefined : this.outcomesOn(at, tail, r.state, reading);
                if (next === undefined) return this.counted(undefined);
                for (const o of next) out.push({ state: o.state, prob: r.prob * o.prob });
            }
            return out;
        }
        const spared = removalAfterFill(ops);
        if (spared >= 0) {
            // A Harvest augment: the add is read on the item as it stands, the
            // removal on what the item held before it.
            const added = this.outcomesOn(item, ops.slice(0, spared), state, reading);
            return added?.flatMap((o) =>
                o.state.prefix + o.state.suffix > state.prefix + state.suffix
                    ? this.otherRemoved(state, o.state).map((r) => ({
                          state: r.state,
                          prob: o.prob * r.prob,
                      }))
                    : [o],
            );
        }
        const roll = rollOf(item, ops, this.registry, reading);
        switch (roll.kind) {
            case "draw": {
                // A modifier the fill keeps keeps its value; a drawn or forced
                // one rolls it fresh.
                const fillAt = ops.findIndex((op) => op.kind === "fill");
                const kept = this.stripped(item, ops, fillAt);
                const keptTypes = guaranteedTypes(kept);
                return this.counted(
                    reforgeOutcomes(this.closed(roll), this.atoms, this.index, (i, id) =>
                        this.classesOf(
                            i,
                            id,
                            keptTypes.has(this.types[i]!)
                                ? valueSpan(kept, this.types[i]!, id)
                                : undefined,
                        ),
                    ),
                );
            }
            case "removal": {
                const out: Outcome[] = [];
                for (const c of roll.candidates) {
                    const rows = [...state.rows];
                    const i = this.index.get(c.type);
                    if (i !== undefined) rows[i] = null;
                    const gen = c.gen ?? (i === undefined ? undefined : this.atoms[i]!.gen);
                    if (gen === undefined) return this.counted(undefined);
                    out.push({ state: bump(state, gen, -1, rows), prob: c.prob });
                }
                for (const g of ["prefix", "suffix"] as const) {
                    const share = roll.sides[g].unnamed;
                    if (share > 0) out.push({ state: bump(state, g, -1, state.rows), prob: share });
                }
                const total = out.reduce((s, o) => s + o.prob, 0);
                return total > 0
                    ? out.map((o) => ({ ...o, prob: o.prob / total }))
                    : [{ state, prob: 1 }];
            }
            case "implicit": {
                const i = this.index.get(IMPLICIT_ATOM[roll.side]);
                if (i === undefined) return this.counted(undefined);
                const byKind = new Map<TypeId | undefined, number>();
                for (const o of roll.options) {
                    const kind = this.implicitTypes.size > 0 ? this.kindOf(o.type) : undefined;
                    byKind.set(kind, (byKind.get(kind) ?? 0) + o.prob);
                }
                return [...byKind].map(([kind, prob]) => {
                    const rows = [...state.rows];
                    rows[i] = implicitRow(roll.tier, kind);
                    return { state: { ...state, rows }, prob };
                });
            }
            case "lock": {
                // A lock that may land on a modifier no one names leaves a state
                // that cannot say which side keeps it.
                const out: Outcome[] = [];
                let mass = 0;
                for (const c of roll.candidates) {
                    const i = this.index.get(c.type);
                    const row = i === undefined ? null : (state.rows[i] ?? null);
                    if (row === null) return this.counted(undefined);
                    const rows = [...state.rows];
                    rows[i!] = lockedRow(row);
                    out.push({ state: { ...state, rows }, prob: c.prob });
                    mass += c.prob;
                }
                return mass > 1 - 1e-9 ? out : this.counted(undefined);
            }
            case "unveil": {
                let target: TypeId | undefined;
                for (const op of ops)
                    if (op.kind === "fill" && op.pool.kind === "unveil") target = op.pool.target;
                return this.counted(this.unveiled(state, roll.options, target));
            }
            case "none": {
                if (ops.some((op) => op.kind === "eldritch" && op.change.kind === "conflict"))
                    return this.counted(this.conflicted(state));
                const ran = ranOn(item, ops);
                // A method this state cannot take leaves it as it was.
                if (!ran.ok) return [{ state, prob: 1 }];
                // The checker's items after an Orb of Dominance are every way
                // a modifier went and one rose; the state says which.
                if (ops.some((op) => op.kind === "elevate"))
                    return this.counted(this.dominated(item, state));
                if (ops.some((op) => op.kind === "fill" && op.pool.kind === "veiledPlaceholder"))
                    return this.counted(this.veiledSides(ran.state, state));
                return this.counted(this.statesIn(ran.state, state));
            }
            default:
                return this.counted(undefined);
        }
    }

    /** The catalog's rows an influence's tag admits, by type. */
    private influenceRows: Map<TypeId, Mod[]> | undefined;

    private influenceRowsOf(type: TypeId): readonly Mod[] {
        if (this.influenceRows === undefined) {
            this.influenceRows = new Map();
            for (const m of this.registry.catalog) {
                if (!m.spawn.some((w) => influenceOfTag(w.tag) !== undefined)) continue;
                const list = this.influenceRows.get(m.type) ?? [];
                list.push(m);
                this.influenceRows.set(m.type, list);
            }
        }
        return this.influenceRows.get(type) ?? [];
    }

    /** The rows a state's row of atom `i` may be on the item, each with its
     *  share: the rows of its class the item allows, by weight, alike where
     *  no roll lays any of them down. */
    private membersOn(i: number, row: ModId, item: ItemSet): { mod: Mod; share: number }[] {
        const bare = unlockedRow(row);
        const members = this.classes[i]!.find((c) => c.rep === bare)?.members ?? [
            { id: readRow(row).base, weight: 1 },
        ];
        const held = heldRows(item, this.types[i]!);
        const allowed = members.filter((m) => held.has(m.id));
        const on = allowed.length > 0 ? allowed : members;
        const drawn = on.filter((m) => m.weight > 0);
        const live = drawn.length > 0 ? drawn : on.map((m) => ({ ...m, weight: 1 }));
        const total = live.reduce((sum, m) => sum + m.weight, 0);
        return live.flatMap((m) => {
            const mod = this.registry.resolveMod(m.id);
            return mod.ok ? [{ mod: mod.value, share: m.weight / total }] : [];
        });
    }

    /**
     * An Orb of Dominance on a state (Orb of Dominance § Mechanics): one of the
     * influenced modifiers it can reach is removed and another goes a tier up,
     * a top-tier one becoming its elevated modifier and an elevated one
     * rolling its values again. A modifier on a side a metamod protects is not
     * affected. Every pair of removed and raised is taken as likely as any
     * other (`ASSUMED_ODDS`, QUESTIONS.md Q61). Which
     * rows are an influence's, and which is the next one up, is read as the
     * checker reads it (`check/ops/remove.ts` `elevations`). Undefined, with
     * the reason, where the state does not say which modifiers are influenced
     * or no source says what the raised one becomes.
     */
    private dominated(item: ItemSet, state: ChainState): readonly Outcome[] | undefined {
        const lose = (why: string): undefined => {
            this.unfollowed = why;
            return undefined;
        };
        const { sure, maybe } = influenceTagsOf(item);
        if (maybe.size > 0)
            return lose("which influences the item has is not settled at this step");
        const isInfluenceRow = influenceRowTest(item);
        const isRow = (m: Mod): boolean => m.domain === item.u.base.domain && isInfluenceRow(m);
        const influenced = (type: TypeId): boolean =>
            this.influenceRowsOf(type).some(
                (m) => isRow(m) && m.spawn.some((w) => sure.has(w.tag)),
            );
        const shut = new Set(
            this.protections
                .filter((p) => (state.rows[p.atom] ?? null) !== null)
                .map((p) => p.side),
        );
        const unnamed = { prefix: state.prefix, suffix: state.suffix };
        const reach: number[] = [];
        state.rows.forEach((row, i) => {
            const type = this.types[i]!;
            if (row === null || implicitSide(type) !== undefined) return;
            const gen = this.atoms[i]!.gen;
            unnamed[gen]--;
            if (influenced(type) && !shut.has(gen)) reach.push(i);
        });
        // The modifiers no one names are a count: which of them are
        // influenced is known only where none can be.
        for (const t of possibleTypes(item)) {
            if (this.index.has(t) || !influenced(t)) continue;
            const gen = genOfOn(this.registry, item, t);
            if (unnamed[gen] > 0 && !shut.has(gen))
                return lose(
                    "an Orb of Dominance picks among every influenced modifier on the item, and the item may hold some the craft does not name",
                );
        }
        if (reach.length < 2)
            return lose(
                "an Orb of Dominance needs two influenced modifiers it can reach, and the item does not always have them here",
            );

        const raised = new Map<number, { to: Mod; share: number }[]>();
        for (const i of reach) {
            const type = this.types[i]!;
            const forms: { to: Mod; share: number }[] = [];
            for (const { mod, share } of this.membersOn(i, state.rows[i]!, item)) {
                if (mod.source === "elevated") {
                    forms.push({ to: mod, share });
                    continue;
                }
                const ladder = new Set(
                    mod.spawn.filter((w) => w.weight > 0 && sure.has(w.tag)).map((w) => w.tag),
                );
                const above = this.influenceRowsOf(type)
                    .filter(
                        (m) =>
                            m.source !== "elevated" &&
                            m.minLevel > mod.minLevel &&
                            isRow(m) &&
                            m.spawn.some((w) => ladder.has(w.tag) && w.weight > 0),
                    )
                    .sort((a, b) => a.minLevel - b.minLevel);
                const next = above[0];
                if (next !== undefined) {
                    if (next.minLevel > item.u.ilvl)
                        return lose(
                            "whether an Orb of Dominance raises a modifier to a tier above the item's level is not known",
                        );
                    if (above[1]?.minLevel === next.minLevel)
                        return lose(
                            "which tier an Orb of Dominance raises a modifier to is not settled where two tiers share a level",
                        );
                    forms.push({ to: next, share });
                    continue;
                }
                const families = this.registry.familiesOfType(type);
                const elevated = this.registry.catalog.filter(
                    (m) =>
                        m.source === "elevated" &&
                        [...m.families].some((f) => families.has(f)) &&
                        m.spawn.some((w) => ladder.has(w.tag)),
                );
                const [only] = elevated;
                if (only === undefined || elevated.length > 1)
                    return lose(
                        "the elevated modifier an Orb of Dominance makes of a top-tier modifier here is not known",
                    );
                forms.push({ to: only, share });
            }
            if (forms.length === 0)
                return lose("what an Orb of Dominance makes of a modifier here is not known");
            raised.set(i, forms);
        }

        const pairs = reach.length * (reach.length - 1);
        const out = new Map<string, Outcome>();
        const put = (next: ChainState, prob: number): void => {
            const key = stateKey(next);
            out.set(key, { state: next, prob: (out.get(key)?.prob ?? 0) + prob });
        };
        for (const gone of reach) {
            for (const up of reach) {
                if (up === gone) continue;
                const rows = [...state.rows];
                rows[gone] = null;
                const left = bump(state, this.atoms[gone]!.gen, -1, rows);
                for (const { to, share } of raised.get(up)!) {
                    // An elevated modifier of a type of its own takes the place
                    // of the one it was made of.
                    const at = to.type === this.types[up] ? up : this.index.get(to.type);
                    const base = [...rows];
                    if (at !== up) base[up] = null;
                    if (at === undefined) {
                        put({ ...left, rows: base }, share / pairs);
                        continue;
                    }
                    if (at !== up && (base[at] ?? null) !== null)
                        return lose(
                            "the elevated modifier an Orb of Dominance would make is already on the item",
                        );
                    for (const c of this.classesOf(at, to.id)) {
                        const next = [...base];
                        next[at] = c.id;
                        put({ ...left, rows: next }, (share * c.share) / pairs);
                    }
                }
            }
        }
        return [...out.values()];
    }

    /**
     * The removal that follows an add and spares what it added: one of the
     * modifiers `from` held, each as likely (QUESTIONS.md Q61), a fractured one
     * and a protected side's excepted, taken out of `added`.
     */
    private otherRemoved(from: ChainState, added: ChainState): readonly Outcome[] {
        const shut = new Set(
            this.protections.filter((p) => (from.rows[p.atom] ?? null) !== null).map((p) => p.side),
        );
        const unnamed = { prefix: from.prefix, suffix: from.suffix };
        const named: number[] = [];
        from.rows.forEach((row, i) => {
            if (row === null || implicitSide(this.types[i]!) !== undefined) return;
            const gen = this.atoms[i]!.gen;
            unnamed[gen]--;
            if (!shut.has(gen) && !readRow(row).locked) named.push(i);
        });
        const sides = (["prefix", "suffix"] as const).filter((g) => !shut.has(g) && unnamed[g] > 0);
        const reach = named.length + sides.reduce((n, g) => n + unnamed[g], 0);
        if (reach === 0) return [{ state: added, prob: 1 }];
        const out: Outcome[] = named.map((i) => {
            const rows = [...added.rows];
            rows[i] = null;
            return { state: bump(added, this.atoms[i]!.gen, -1, rows), prob: 1 / reach };
        });
        for (const g of sides) {
            out.push({ state: bump(added, g, -1, added.rows), prob: unnamed[g] / reach });
        }
        return out;
    }

    /**
     * A draw onto an item that holds modifiers no condition names: which ones
     * they are is not tracked, so each group keeps its weight by the chance
     * that none of its types no condition names is among that many draws by
     * weight from those types. A group of named types only keeps its whole.
     */
    private readonly openShares = new Map<string, number[]>();

    private closed(roll: Extract<Roll, { kind: "draw" }>): Extract<Roll, { kind: "draw" }> {
        const variants = roll.variants.map((v) => {
            const side = (gen: Gen, groups: typeof v.prefix): typeof v.prefix => {
                const unnamed = v.before[gen] ?? 0;
                if (unnamed <= 0) return groups;
                // The part of each group an unnamed modifier may be.
                const part = groups.map((g) =>
                    g.members.reduce((s, m) => s + (this.index.has(m.type) ? 0 : m.weight), 0),
                );
                const others = groups.filter((_g, i) => part[i]! > 0);
                if (others.length === 0) return groups;
                if (unnamed >= others.length) return groups.filter((_g, i) => !(part[i]! > 0));
                // Each unnamed modifier came from a draw by weight, so a group is
                // closed by its chance of being among that many draws.
                const weights = part.filter((w) => w > 0);
                const key = `${unnamed}:${weights.join(",")}`;
                let open = this.openShares.get(key);
                if (open === undefined) {
                    open = weights.map(
                        (_w, i) => amongFirstDistribution(weights, [i], unnamed)[0]!,
                    );
                    this.openShares.set(key, open);
                }
                const share = new Map(others.map((g, i) => [g, open[i]!]));
                return groups.map((g) => {
                    const s = share.get(g);
                    return s === undefined
                        ? g
                        : {
                              ...g,
                              weight: g.weight * s,
                              members: g.members.map((m) => ({ ...m, weight: m.weight * s })),
                          };
                });
            };
            return { ...v, prefix: side("prefix", v.prefix), suffix: side("suffix", v.suffix) };
        });
        return { ...roll, variants };
    }

    /** The item a method's fill starts from: what its steps before the fill
     *  leave. */
    private stripped(item: ItemSet, ops: readonly Op[], fillAt: number): ItemSet {
        if (fillAt < 0) return item;
        return ranOn(item, ops, fillAt).state;
    }

    /** A Divine Orb on a state: each present modifier a condition compares by
     *  value lands again in each part of its row's range by its share. */
    private rerolled(state: ChainState): readonly Outcome[] {
        let out: { rows: (ModId | null)[]; prob: number }[] = [{ rows: [...state.rows], prob: 1 }];
        // A fractured modifier keeps its value, and so does one on a side a
        // metamod protects (Divine Orb § Mechanics; Metamod § Rules and Exceptions).
        const shut = new Set(
            this.protections
                .filter((p) => (state.rows[p.atom] ?? null) !== null)
                .map((p) => p.side),
        );
        state.rows.forEach((row, i) => {
            if (row === null) return;
            const { value, locked } = readRow(row);
            if (value === undefined || locked || shut.has(this.atoms[i]!.gen)) return;
            const parts = this.classesOf(i, readRow(row).base);
            out = out.flatMap((st) =>
                parts.map((c) => {
                    const rows = [...st.rows];
                    rows[i] = c.id;
                    return { rows, prob: st.prob * c.share };
                }),
            );
        });
        return out.map((st) => ({ state: { ...state, rows: st.rows }, prob: st.prob }));
    }

    private counted(out: readonly Outcome[] | undefined): readonly Outcome[] | undefined {
        if (out === undefined) this.misses++;

        return out;
    }

    /**
     * The states an item the checker settles holds: its counts exact and each
     * atom present or absent, a present one's class by its rows' weight.
     * Undefined where the item leaves a count or an atom open.
     */
    statesIn(item: ItemSet, from?: ChainState): readonly Outcome[] | undefined {
        const [t0, t1] = countsOf(item).total;
        const [p0, p1] = countsOf(item).prefix;
        if (t0 !== t1 || p0 !== p1) return undefined;
        const counts = { prefix: p0, suffix: t0 - p0 };
        const guaranteed = guaranteedTypes(item);
        let states: { rows: (ModId | null)[]; prob: number }[] = [
            { rows: this.atoms.map(() => null), prob: 1 },
        ];
        const choose = (i: number, rows: readonly { id: ModId; weight: number }[]): void => {
            const total = rows.reduce((s, r) => s + r.weight, 0);
            states = states.flatMap((st) =>
                rows.map((r) => {
                    const copy = [...st.rows];
                    copy[i] = r.id;
                    return { rows: copy, prob: (st.prob * r.weight) / total };
                }),
            );
        };
        const maybe: number[] = [];
        for (let i = 0; i < this.atoms.length; i++) {
            const type = this.types[i]!;
            const side = implicitSide(type);
            if (side !== undefined) {
                const rows = this.implicitIn(item, side, from);
                if (rows === undefined) return undefined;
                if (rows.length > 0) choose(i, rows);
                continue;
            }
            if (guaranteed.has(type)) {
                const fromRow = from?.rows[i] ?? null;
                const locked =
                    this.locks &&
                    (isFractured(item, type) || (fromRow !== null && readRow(fromRow).locked));
                const rows = this.rowsOn(i, item);
                choose(i, locked ? rows.map((r) => ({ ...r, id: lockedRow(r.id) })) : rows);
            } else if (isExcluded(item, type)) continue;
            else if (from !== undefined) {
                // A sure method the checker reads as perhaps removing a modifier
                // the state holds removes it only if it was a crafted one.
                const row = from.rows[i] ?? null;
                if (row !== null && !this.crafted(row)) choose(i, [{ id: row, weight: 1 }]);
            } else maybe.push(i);
        }
        if (maybe.length > 0) {
            // The modifiers the item holds that no one names are taken as its
            // own natural rolls: drawn by spawn weight from
            // its pool, what it surely holds closing its groups, so a named
            // modifier among them comes up by its share of the race.
            const known = { prefix: 0, suffix: 0 };
            for (const t of guaranteed) known[genOfOn(this.registry, item, t)]++;
            const groups = naturalGroups(item, this.registry);
            for (const gen of ["prefix", "suffix"] as const) {
                const slots = counts[gen] - known[gen];
                const side = groups[gen];
                const open = (t: TypeId): boolean => maybe.includes(this.index.get(t) ?? -1);
                const special = side
                    .map((g, gi) => (holdsNamed(g, open) ? gi : -1))
                    .filter((gi) => gi >= 0);
                if (special.length === 0 || slots <= 0) continue;
                if (special.length > 12) return undefined;
                const dist = amongFirstDistribution(
                    side.map((g) => g.weight),
                    special,
                    slots,
                );
                const next: typeof states = [];
                for (let mask = 0; mask < dist.length; mask++) {
                    if (dist[mask] === 0) continue;
                    const drawn = special
                        .filter((_gi, b) => mask & (1 << b))
                        .map((gi) => side[gi]!);
                    for (const held of memberCases(drawn, open)) {
                        const p = dist[mask]! * held.prob;
                        let part = states.map((st) => ({ rows: [...st.rows], prob: st.prob * p }));
                        for (const m of held.members) {
                            const i = this.index.get(m.type)!;
                            const byClass = new Map<ModId, number>();
                            for (const r of m.rows) {
                                for (const c of this.classesOf(i, r.mod.id))
                                    byClass.set(
                                        c.id,
                                        (byClass.get(c.id) ?? 0) + r.weight * c.share,
                                    );
                            }
                            const total = [...byClass.values()].reduce((s, w) => s + w, 0);
                            part = part.flatMap((st) =>
                                [...byClass].map(([id, w]) => {
                                    const copy = [...st.rows];
                                    copy[i] = id;
                                    return { rows: copy, prob: (st.prob * w) / total };
                                }),
                            );
                        }
                        next.push(...part);
                    }
                }
                states = next;
            }
        }
        if (states.length > MAX_OUTCOMES) throw new TrackerOverflow();
        return states.map((st) => ({
            state: { prefix: counts.prefix, suffix: counts.suffix, rows: st.rows },
            prob: st.prob,
        }));
    }

    /** The checker's items narrowed to a state: null where the two cannot meet. */
    narrow(item: ItemSet, state: ChainState): ItemSet | null {
        const u = item.u;
        const m = u.dd;
        // Each atom's slot first: the counts read every slot, and are cheaper
        // to meet on the few items left.
        let dd = item.dd;
        for (let i = 0; i < this.atoms.length && dd !== m.EMPTY; i++) {
            dd = m.and(dd, this.atomOf(u, i, state.rows[i] ?? null));
        }
        if (dd !== m.EMPTY) dd = m.and(dd, u.countIn("prefix", state.prefix, state.prefix));
        if (dd !== m.EMPTY) dd = m.and(dd, u.countIn("suffix", state.suffix, state.suffix));
        return stateOf(u, dd);
    }

    private readonly atomsAt = new WeakMap<Universe, Map<string, Dd>>();

    private atomOf(u: Universe, i: number, row: ModId | null): Dd {
        let byKey = this.atomsAt.get(u);
        if (byKey === undefined) this.atomsAt.set(u, (byKey = new Map<string, Dd>()));
        const key = `${i}/${row ?? "-"}`;
        let dd = byKey.get(key);
        if (dd === undefined) byKey.set(key, (dd = this.atomItems(u, i, row)));
        return dd;
    }

    /** The items whose atom `i` is as `row` says: absent for null. */
    private atomItems(u: Universe, i: number, row: ModId | null): Dd {
        const m = u.dd;
        const type = this.types[i]!;
        const side = implicitSide(type);
        if (side !== undefined) {
            const tierSlot = u.scalar(`${side}Tier`);
            if (row === null) return m.slotIn(tierSlot, [0]);
            const { tier, type: of } = readImplicit(row);
            const at = m.slotIn(tierSlot, [tier]);
            if (of === undefined || of === OTHER_IMPLICIT) return at;
            const types: number[] = [];
            u.eldritchTypes(side).forEach((t, v) => {
                if (t === of) types.push(v);
            });
            return m.and(at, m.slotIn(u.scalar(`${side}Type`), types));
        }
        const slot = u.slotOfType(type);
        if (slot === undefined) return row === null ? m.ALL : m.EMPTY;
        if (row === null) return m.slotIn(slot, [0]);
        const { base, value, locked } = readRow(row);
        const bare = unlockedRow(row);
        const classes = this.classes[i]!;
        const own = classes.find((c) => c.rep === bare);
        // A class of one row is that row; the rest of the ladder is any row but
        // the tiers named apart.
        const apart = new Set(
            classes.filter((c) => c.rep !== bare && c.members.length === 1).map((c) => c.rep),
        );
        const single = value !== undefined || own?.members.length === 1;
        return m.slotIn(
            slot,
            u.valuesWhere(slot, (v) => {
                if (this.locks && v.fractured !== (locked === true)) return false;
                if (!single) return !apart.has(v.row.id);
                // The row, its value in the part of the range the state holds.
                return v.row.id === base && (value === undefined || meets(v.cell, value));
            }),
        );
    }
}

/** Whether some value of the cell lies in the closed range. */
function meets(cell: ModValue["cell"], range: Range): boolean {
    if (cell === undefined) return false;
    const aboveLo = cell.hi > range[0] || (cell.hi === range[0] && !cell.hiOpen);
    const belowHi = cell.lo < range[1] || (cell.lo === range[1] && !cell.loOpen);
    return aboveLo && belowHi;
}

/** Where a method removes a random modifier and then fills: the removal's
 *  index, or -1. */
function removalBeforeFill(ops: readonly Op[]): number {
    const at = ops.findIndex((op) => op.kind === "remove" && op.selector.kind === "random");
    if (at < 0 || ops.slice(0, at).some((op) => op.kind === "fill")) return -1;
    return ops.slice(at + 1).some((op) => op.kind === "fill") ? at : -1;
}

/** Where a method fills and then removes a random modifier other than the one
 *  it added: the removal's index, or -1. */
function removalAfterFill(ops: readonly Op[]): number {
    return ops.findIndex(
        (op) =>
            op.kind === "remove" &&
            op.selector.kind === "random" &&
            op.selector.sparing !== undefined,
    );
}

/** The types a condition asks to be present: those under an even number of
 *  negations. */
function askedFor(pred: RPred, negated = false): TypeId[] {
    switch (pred.kind) {
        case "not":
            return askedFor(pred.inner, !negated);
        case "and":
        case "or":
            return [...askedFor(pred.left, negated), ...askedFor(pred.right, negated)];
        case "has":
        case "hasValue":
            return negated ? [] : [pred.type];
        case "hasGroup":
            return negated ? [] : [...pred.types];
        default:
            return [];
    }
}

/** Outcomes without the specks of mass the race's quadrature leaves on
 *  outcomes that cannot happen, which no later step could read. */
export function pruned(out: readonly Outcome[]): readonly Outcome[] {
    const kept = out.filter((o) => o.prob > 1e-12);
    if (kept.length === out.length) return out;
    const total = kept.reduce((sum, o) => sum + o.prob, 0);
    return total > 0 ? kept.map((o) => ({ ...o, prob: o.prob / total })) : out;
}

/** What no step but its own changes: a fractured modifier stays fractured, and
 *  the eldritch implicits stay as they were through a method that does not
 *  touch them. */
function keepAcross(
    from: ChainState,
    out: readonly Outcome[],
    implicitAtoms: readonly number[],
): readonly Outcome[] {
    const locked: number[] = [];
    from.rows.forEach((r, i) => {
        if (r !== null && readRow(r).locked) locked.push(i);
    });
    if (locked.length === 0 && implicitAtoms.length === 0) return out;
    return out.map((o) => {
        const rows = [...o.state.rows];
        for (const i of locked) {
            const r = rows[i] ?? null;
            if (r !== null) rows[i] = lockedRow(r);
        }
        for (const i of implicitAtoms) rows[i] = from.rows[i] ?? null;
        return { ...o, state: { ...o.state, rows } };
    });
}

/** Whether a method changes an eldritch implicit. One that may in only some
 *  of its outcomes (a Vaal Orb) is not asked: with an implicit on the item
 *  that outcome cannot be read back as a state, and the step is not followed. */
function touchesImplicits(ops: readonly Op[]): boolean {
    return ops.some((op) => op.kind === "eldritch");
}

function implicitSide(type: TypeId): EldritchSide | undefined {
    return ELDRITCH_SIDES.find((side) => IMPLICIT_ATOM[side] === type);
}

const stateKeys = new WeakMap<ChainState, string>();

/** A state's name, without the imprint it holds. Kept per state: the chain
 *  asks for the same states round after round. */
function stateKey(s: ChainState): string {
    let k = stateKeys.get(s);
    if (k === undefined) {
        k = `${s.prefix}/${s.suffix}/${s.rows.map((r) => r ?? "-").join(",")}`;
        stateKeys.set(s, k);
    }
    return k;
}

/** A step read on a state without the imprint it holds, which no method but
 *  the imprint's own and its restore touches, and handed back with it. */
function besideImprint(
    next: (state: ChainState) => readonly Outcome[],
): (state: ChainState) => readonly Outcome[] {
    const cache = new Map<ChainState, Map<readonly Outcome[], readonly Outcome[]>>();
    return (state) => {
        const held = state.held;
        if (held === undefined) return next(state);
        const out = next({ prefix: state.prefix, suffix: state.suffix, rows: state.rows });
        // One array for one imprint and one set of outcomes, so the chain
        // can spread the states that share them together.
        let byOut = cache.get(held);
        if (byOut === undefined) {
            byOut = new Map<readonly Outcome[], readonly Outcome[]>();
            cache.set(held, byOut);
        }
        let withHeld = byOut.get(out);
        if (withHeld === undefined) {
            withHeld = out.map((o) => ({ ...o, state: { ...o.state, held } }));
            byOut.set(out, withHeld);
        }
        return withHeld;
    };
}

function bump(s: ChainState, gen: Gen, by: number, rows: readonly (ModId | null)[]): ChainState {
    return {
        prefix: gen === "prefix" ? s.prefix + by : s.prefix,
        suffix: gen === "suffix" ? s.suffix + by : s.suffix,
        rows,
    };
}

/** The leaves of a condition. */
export function predLeaves(pred: RPred, out: RPred[] = []): RPred[] {
    switch (pred.kind) {
        case "not":
            return predLeaves(pred.inner, out);
        case "and":
        case "or":
            predLeaves(pred.left, out);
            return predLeaves(pred.right, out);
        default:
            out.push(pred);
            return out;
    }
}

/**
 * A condition over where a solved loop left the item: the chance it holds and
 * the states on either side. Undefined when it reads anything but the counts
 * and the modifiers that loop named.
 */
export function splitCarried(
    c: Carried,
    pred: RPred,
): { chance: number; then?: Carried; otherwise?: Carried } | undefined {
    const index = new Map<TypeId, number>();
    c.types.forEach((t, i) => index.set(t, i));
    for (const leaf of predLeaves(pred)) {
        if (leaf.kind === "compare") continue;
        if (leaf.kind === "has" && index.has(leaf.type)) continue;
        if (leaf.kind === "hasGroup" && [...leaf.types].every((t) => index.has(t))) continue;
        if (leaf.kind === "hasValue" && c.valued?.has(leaf.type)) continue;
        if (leaf.kind === "fractured" && c.locks && index.has(leaf.type)) continue;
        if ((leaf.kind === "eldritch" || leaf.kind === "dominant") && c.implicits) continue;
        return undefined;
    }
    const yes: Carried["dist"][number][] = [];
    const no: Carried["dist"][number][] = [];
    for (const s of c.dist) (holdsOn(pred, s.state, index, new Map()) ? yes : no).push(s);
    const chance = yes.reduce((sum, s) => sum + s.weight, 0);
    const part = (dist: typeof yes, mass: number): Carried | undefined =>
        mass > 0 ? { ...c, dist: dist.map((s) => ({ ...s, weight: s.weight / mass })) } : undefined;
    const then = part(yes, chance);
    const otherwise = part(no, 1 - chance);
    return {
        chance,
        ...(then !== undefined && { then }),
        ...(otherwise !== undefined && { otherwise }),
    };
}

/**
 * The states a reforge leaves the chain in: for each variant and count case of
 * its roll, which of the atoms the race draws on each side (`sidesGivenSplit`),
 * the present ones placed, each atom's
 * row class by its rows' weight share; the counts are the modifiers placed,
 * kept and drawn. Undefined when the roll has more atoms on a side than the
 * race can list.
 */
export function reforgeOutcomes(
    roll: Extract<Roll, { kind: "draw" }>,
    atoms: readonly ChainAtom[],
    atomIndex: ReadonlyMap<TypeId, number>,
    classesOf: (i: number, id: ModId) => readonly { id: ModId; share: number }[],
): Outcome[] | undefined {
    const rowsFor = (
        i: number,
        rows: readonly { readonly id: ModId; readonly weight: number }[],
    ): { id: ModId; share: number }[] => {
        if (rows.length === 0) return [{ id: atoms[i]!.rows[0]!.id, share: 1 }];
        const byClass = new Map<ModId, number>();
        for (const r of rows) {
            for (const c of classesOf(i, r.id))
                byClass.set(c.id, (byClass.get(c.id) ?? 0) + r.weight * c.share);
        }
        const total = rows.reduce((s, r) => s + r.weight, 0);
        return [...byClass].map(([id, w]) => ({
            id,
            share: total > 0 ? w / total : 1 / byClass.size,
        }));
    };
    const tracked = (t: TypeId): boolean => atomIndex.has(t);
    const outcomes = new Map<string, Outcome>();
    const put = (state: ChainState, prob: number): void => {
        if (prob <= 0) return;
        const key = `${state.prefix}/${state.suffix}/${state.rows.map((r) => r ?? "-").join(",")}`;
        const hit = outcomes.get(key);
        if (hit) outcomes.set(key, { state, prob: hit.prob + prob });
        else outcomes.set(key, { state, prob });
    };
    for (const v of roll.variants) {
        const presentCount = { prefix: 0, suffix: 0 };
        for (const p of v.present) presentCount[p.gen]++;
        // The atoms the variant places for certain, with their rows.
        const placed: { i: number; rows: { id: ModId; share: number }[] }[] = [];
        for (const p of v.present) {
            const i = atomIndex.get(p.type);
            if (i !== undefined)
                placed.push({
                    i,
                    rows: rowsFor(
                        i,
                        p.rows.map((r) => ({ id: r.mod.id, weight: r.weight })),
                    ),
                });
        }
        const sides = (["prefix", "suffix"] as const).map((gen) => {
            const groups = gen === "prefix" ? v.prefix : v.suffix;
            const special: number[] = [];
            groups.forEach((g, gi) => {
                if (holdsNamed(g, tracked)) special.push(gi);
            });
            return { gen, groups, special };
        });
        if (sides.some((s) => s.special.length > 12)) return undefined;
        for (const c of v.counts) {
            const counts = {
                prefix: presentCount.prefix + (v.before.prefix ?? 0) + c.prefix,
                suffix: presentCount.suffix + (v.before.suffix ?? 0) + c.suffix,
            };
            const [pd, sd] = sidesGivenSplit(v, c, sides[0]!.special, sides[1]!.special);
            for (let pm = 0; pm < pd.length; pm++) {
                if (pd[pm] === 0) continue;
                for (let sm = 0; sm < sd.length; sm++) {
                    const mass = v.prob * c.prob * pd[pm]! * sd[sm]!;
                    if (mass === 0) continue;
                    const groups = sides.flatMap((s, si) => {
                        const mask = si === 0 ? pm : sm;
                        return s.special
                            .filter((_gi, b) => mask & (1 << b))
                            .map((gi) => s.groups[gi]!);
                    });
                    for (const held of memberCases(groups, tracked)) {
                        // Every atom drawn or placed in this outcome, with its row choices.
                        const drawn: { i: number; rows: { id: ModId; share: number }[] }[] = [
                            ...placed,
                        ];
                        for (const m of held.members) {
                            const i = atomIndex.get(m.type)!;
                            drawn.push({
                                i,
                                rows: rowsFor(
                                    i,
                                    m.rows.map((r) => ({ id: r.mod.id, weight: r.weight })),
                                ),
                            });
                        }
                        let states: { rows: (ModId | null)[]; prob: number }[] = [
                            { rows: atoms.map(() => null), prob: mass * held.prob },
                        ];
                        for (const d of drawn) {
                            const next: typeof states = [];
                            for (const st of states) {
                                for (const r of d.rows) {
                                    const rows = [...st.rows];
                                    rows[d.i] = r.id;
                                    next.push({ rows, prob: st.prob * r.share });
                                }
                            }
                            states = next;
                        }
                        for (const st of states) put({ ...counts, rows: st.rows }, st.prob);
                    }
                }
            }
        }
    }
    return [...outcomes.values()];
}

/** A condition on the chain's state: the counts, the named modifiers' rows,
 *  and the leaves fixed by the item entering the loop. */
export function holdsOn(
    pred: RPred,
    s: ChainState,
    atomIndex: ReadonlyMap<TypeId, number>,
    fixed: ReadonlyMap<RPred, boolean>,
): boolean {
    switch (pred.kind) {
        case "not":
            return !holdsOn(pred.inner, s, atomIndex, fixed);
        case "and":
            return (
                holdsOn(pred.left, s, atomIndex, fixed) && holdsOn(pred.right, s, atomIndex, fixed)
            );
        case "or":
            return (
                holdsOn(pred.left, s, atomIndex, fixed) || holdsOn(pred.right, s, atomIndex, fixed)
            );
        case "compare": {
            const n = pred.projection === "prefixCount" ? s.prefix : s.suffix;
            switch (pred.op) {
                case "==":
                    return n === pred.value;
                case "!=":
                    return n !== pred.value;
                case "<":
                    return n < pred.value;
                case "<=":
                    return n <= pred.value;
                case ">":
                    return n > pred.value;
                case ">=":
                    return n >= pred.value;
            }
            break;
        }
        case "has": {
            const i = atomIndex.get(pred.type);
            const row = i === undefined ? null : (s.rows[i] ?? null);
            return (
                row !== null && (pred.tierMod === undefined || readRow(row).base === pred.tierMod)
            );
        }
        case "hasValue": {
            // A row carries the part of its range the value is in, cut where
            // the conditions' thresholds fall, so it holds wholly or not at all.
            const i = atomIndex.get(pred.type);
            const row = i === undefined ? null : (s.rows[i] ?? null);
            if (row === null) return false;
            // Another condition's threshold may have given a row this one does
            // not name a value too.
            const { base, value } = readRow(row);
            return (
                pred.rows.has(base) &&
                value !== undefined &&
                narrowRange(value, pred.op, pred.value) !== null
            );
        }
        case "hasGroup":
            return [...pred.types].some((t) => {
                const i = atomIndex.get(t);
                return i !== undefined && s.rows[i] !== null;
            });
        case "eldritch": {
            const i = atomIndex.get(IMPLICIT_ATOM[pred.side]);
            const row = i === undefined ? null : (s.rows[i] ?? null);
            if (row === null) return false;
            const { tier, type } = readImplicit(row);
            return (
                (pred.tier === undefined || tier === pred.tier) &&
                (pred.types === undefined || (type !== undefined && pred.types.has(type)))
            );
        }
        case "dominant": {
            const tierOf = (side: EldritchSide): number => {
                const i = atomIndex.get(IMPLICIT_ATOM[side]);
                const row = i === undefined ? null : (s.rows[i] ?? null);
                return row === null ? 0 : readImplicit(row).tier;
            };
            return dominantOf(eldritchKey(tierOf("exarch"), tierOf("eater"))) === pred.side;
        }
        case "fractured": {
            const i = atomIndex.get(pred.type);
            const row = i === undefined ? null : (s.rows[i] ?? null);
            return row !== null && readRow(row).locked === true;
        }
        default:
            return fixed.get(pred) ?? false;
    }
    return false;
}

/** The side a type's rows sit on, on this item. */
export function genOfOn(registry: Registry, a: ItemSet, type: TypeId): Gen {
    return (
        rollableGen(registry.catalog, a.u.base, a.u.ilvl, type, influenceTagsAny(a)) ??
        registry.genOfType(type) ??
        "prefix"
    );
}

/** The rows the items carry the type at. */
function heldRows(s: ItemSet, type: TypeId): ReadonlySet<ModId> {
    return new Set(rowsOf(s, type).map((m) => m.id));
}

/** Whether the type is fractured on the items that carry it: undefined where
 *  it is on some of them only. */
function lockedOn(s: ItemSet, type: TypeId): boolean | undefined {
    const slot = s.u.slotOfType(type);
    if (slot === undefined) return false;
    const marks = new Set(
        s.u.dd
            .valuesOf(s.dd, slot)
            .flatMap((v) => (v === 0 ? [] : [s.u.modValue(slot, v)!.fractured])),
    );
    return marks.size > 1 ? undefined : marks.has(true);
}

/**
 * Whether a row is an influence's: one no tag the items carry for sure but
 * their influences' admits, whose spawn table names an influence's tag (as
 * check/ops/pools.ts `influenceRow` reads it).
 */
function influenceRowTest(s: ItemSet): (m: Mod) => boolean {
    const sure = influenceTagsOf(s).sure;
    const own = new Set([...guaranteedFacts(s).tags].filter((t) => !sure.has(t)));
    return (m) =>
        (lookupWeight(m, own) ?? 0) <= 0 &&
        m.spawn.some((w) => influenceOfTag(w.tag) !== undefined);
}
