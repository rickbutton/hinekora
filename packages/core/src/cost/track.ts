/**
 * The item as the cost layer tracks it: a distribution over a small state,
 * the (prefix, suffix) counts and, for each modifier a condition names, whether
 * it is on the item and at which row (`ChainState`). A loop solved as a chain
 * (`chain.ts`) carries it round by round; these are the pieces that read a
 * step, a condition or a roll in its terms.
 */
import type { Gen, ModId, TagId, TypeId } from "../model/ids.js";
import type { Op } from "../check/ops.js";
import type { Registry } from "../resolve/registry.js";
import {
    type AItem,
    guaranteedTypes,
    isExcluded,
    rarityOf,
    refine,
    type RPred,
} from "../check/astate.js";
import { influenceTagsAny, runMethod } from "../check/ops.js";
import { lookupWeight } from "../pool/pool.js";
import { rollableGen, rollableTiers } from "../resolve/tiers.js";
import type { ChainAtom, ChainState, ChainStep, Outcome } from "./chain.js";
import { amongFirstDistribution } from "./race.js";
import { naturalGroups, type Reading, type Roll, rollOf } from "./roll.js";

/** The states a chain-solved loop's exit leaves the item in, over the
 *  modifiers that loop named; the weights sum to one. */
export interface Carried {
    readonly types: readonly TypeId[];
    /** Per type, whether its row is the one on the item or a reforge's
     *  stand-in for a modifier no condition of that loop tells apart by tier. */
    readonly rowed: readonly boolean[];
    readonly dist: readonly { readonly state: ChainState; readonly weight: number }[];
}

/** Rows a condition tells apart: one named tier, or the rest of a ladder. */
interface RowClass {
    /** The row that stands for the class on the state: a named tier is itself. */
    readonly rep: ModId;
    readonly members: readonly { readonly id: ModId; readonly weight: number }[];
}

/**
 * The modifiers the guide's conditions name, tracked through it: one atom per
 * type, whatever loop or branch names it, so a distribution means the same
 * thing from the item block to the last step. A type's rows are grouped into
 * the classes the conditions tell apart (each tier a condition names on its
 * own, the rest together), so a type no condition tiers is one class, not a
 * dozen rows. A metamod that protects a side is an atom too: a removal may
 * take it, and its side is out of reach while it is there.
 */
export class Tracker {
    readonly atoms: ChainAtom[] = [];
    readonly types: TypeId[] = [];
    readonly index = new Map<TypeId, number>();
    readonly protections: { readonly atom: number; readonly side: Gen }[] = [];
    private readonly classes: RowClass[][] = [];
    private readonly repOf: Map<ModId, ModId>[] = [];

    constructor(
        private readonly registry: Registry,
        first: AItem,
        items: readonly AItem[],
        preds: readonly RPred[],
        crafted: readonly TypeId[],
    ) {
        const named = new Set<ModId>();
        const wanted: TypeId[] = [];
        for (const pred of preds) {
            for (const leaf of predLeaves(pred)) {
                if (leaf.kind === "has") {
                    wanted.push(leaf.type);
                    if (leaf.tierMod !== undefined) named.add(leaf.tierMod);
                } else if (leaf.kind === "hasGroup") wanted.push(...leaf.types);
            }
        }
        const protecting: { type: TypeId; side: Gen }[] = [];
        const seen = new Set<TypeId>();
        for (const item of items) {
            for (const t of [...guaranteedTypes(item), ...item.possible, ...crafted]) {
                if (seen.has(t)) continue;
                seen.add(t);
                for (const e of registry.effectsOfType(t)) {
                    if (e.kind === "protect") protecting.push({ type: t, side: e.gen });
                }
            }
        }
        const tags = new Set<TagId>();
        for (const item of items) for (const t of influenceTagsAny(item, registry)) tags.add(t);
        const baseTags = new Set([...first.base.tags, ...tags]);
        const add = (type: TypeId): number => {
            const known = this.index.get(type);
            if (known !== undefined) return known;
            const i = this.atoms.length;
            this.index.set(type, i);
            this.types.push(type);
            let rows = rollableTiers(registry.catalog, first.base, first.ilvl, type, tags)
                .map((m) => ({ id: m.id, weight: lookupWeight(m, baseTags) ?? 0 }))
                .filter((r) => r.weight > 0);
            const weight = rows.reduce((sum, r) => sum + r.weight, 0);
            if (rows.length === 0) {
                // A row no roll lays down (a bench craft's): placed, never drawn.
                rows = registry.catalog
                    .filter((m) => m.type === type)
                    .map((m) => ({ id: m.id, weight: 1 }));
            }
            const own = rows.filter((r) => named.has(r.id));
            const rest = rows.filter((r) => !named.has(r.id));
            const classes: RowClass[] = own.map((r) => ({ rep: r.id, members: [r] }));
            if (rest.length > 0) classes.push({ rep: rest[0]!.id, members: rest });
            const repOf = new Map<ModId, ModId>();
            for (const c of classes) for (const m of c.members) repOf.set(m.id, c.rep);
            this.classes.push(classes);
            this.repOf.push(repOf);
            this.atoms.push({
                gen: genOfOn(registry, first, type),
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
    }

    /** The class a row of atom `i` falls in, by the row that stands for it. */
    classOf(i: number, id: ModId): ModId {
        return this.repOf[i]?.get(id) ?? id;
    }

    /** Atom `i`'s classes the item allows, by the weight of their rows it allows. */
    rowsOn(i: number, item: AItem): readonly { id: ModId; weight: number }[] {
        const pinned = item.tiers.get(this.types[i]!);
        const out: { id: ModId; weight: number }[] = [];
        for (const c of this.classes[i]!) {
            const weight = c.members
                .filter((m) => pinned === undefined || pinned.has(m.id))
                .reduce((sum, m) => sum + m.weight, 0);
            if (weight > 0) out.push({ id: c.rep, weight });
        }
        return out.length > 0 ? out : this.atoms[i]!.rows;
    }

    /** States over the tracked atoms, as carried states. */
    carried(dist: readonly { readonly state: ChainState; readonly weight: number }[]): Carried {
        return { types: this.types, rowed: this.types.map(() => true), dist };
    }

    /** States a method left as they were because the checker's item, narrowed
     *  to them, could not say exactly where the method takes them. */
    misses = 0;

    /**
     * Where a method takes each state: the checker's item before it narrowed to
     * the state (its counts, each atom present at its class or absent), the
     * method read on that item, and the item it leaves read back as states. A
     * random method's roll gives the outcomes and their chances; a sure one
     * gives one state. Undefined for a method whose randomness the state does
     * not hold (a Divine Orb's values, an unveil's choice, a fracture's lock,
     * an implicit), which the walk reads off the roll instead.
     */
    transition(
        before: AItem,
        ops: readonly Op[],
        reading: Reading,
    ): ((state: ChainState) => readonly Outcome[]) | undefined {
        const kind = rollOf(before, ops, this.registry, reading).kind;
        if (kind !== "draw" && kind !== "removal" && kind !== "none") return undefined;
        const cache = new Map<string, readonly Outcome[]>();
        // A draw's outcomes rest on the item its fill starts from, which many
        // states share where a reforge strips what tells them apart.
        const fillAt = ops.findIndex((op) => op.kind === "fill");
        const drawn = new Map<string, readonly Outcome[]>();
        return (state) => {
            const key = stateKey(state);
            const hit = cache.get(key);
            if (hit !== undefined) return hit;
            let out: readonly Outcome[] | undefined;
            const item = kind === "draw" && fillAt >= 0 ? this.narrow(before, state) : null;
            if (item !== null) {
                const sig = this.signature(
                    runMethod(item, ops.slice(0, fillAt), this.registry).state,
                );
                out = drawn.get(sig);
                if (out === undefined) {
                    out = this.outcomes(before, ops, state, reading) ?? [{ state, prob: 1 }];
                    drawn.set(sig, out);
                }
            } else {
                out = this.outcomes(before, ops, state, reading) ?? [{ state, prob: 1 }];
            }
            cache.set(key, out);
            return out;
        };
    }

    /** What a draw reads of an item: its counts, rarity, strands, influences,
     *  the modifiers it surely holds and the named ones' tiers. */
    private signature(a: AItem): string {
        const guaranteed = [...guaranteedTypes(a)].sort();
        const tiers = this.types.map((t) => [...(a.tiers.get(t) ?? [])].sort().join("+"));
        return JSON.stringify([
            a.counts,
            rarityOf(a) ?? "any",
            a.strands,
            [...a.influences].sort(),
            guaranteed,
            tiers,
        ]);
    }

    private outcomes(
        before: AItem,
        ops: readonly Op[],
        state: ChainState,
        reading: Reading,
    ): readonly Outcome[] | undefined {
        const item = this.narrow(before, state);
        if (item === null) return undefined;
        const roll = rollOf(item, ops, this.registry, reading);
        switch (roll.kind) {
            case "draw":
                return this.counted(
                    reforgeOutcomes(this.closed(roll), this.atoms, this.index, (i, id) =>
                        this.classOf(i, id),
                    ),
                );
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
            case "none": {
                const ran = runMethod(item, ops, this.registry);
                // A method this state cannot take leaves it as it was.
                if (!ran.ok) return [{ state, prob: 1 }];
                return this.counted(this.statesIn(ran.state, reading));
            }
            default:
                return this.counted(undefined);
        }
    }

    /**
     * A draw onto an item that holds modifiers no condition names: which ones
     * they are is not tracked, so each is taken to close a group of its side
     * of average weight among the groups no condition names, as craftofexile's
     * calculator does. The unnamed groups' weights shrink by that much
     * together; the named ones keep theirs.
     */
    private closed(roll: Extract<Roll, { kind: "draw" }>): Extract<Roll, { kind: "draw" }> {
        const variants = roll.variants.map((v) => {
            const side = (gen: Gen, groups: typeof v.prefix): typeof v.prefix => {
                const unnamed = v.before[gen] ?? 0;
                if (unnamed <= 0) return groups;
                const others = groups.filter((g) => !this.index.has(g.type));
                const total = others.reduce((s, g) => s + g.weight, 0);
                if (!(total > 0)) return groups;
                const closedWeight = Math.min(total, (unnamed * total) / others.length);
                const factor = (total - closedWeight) / total;
                return groups.map((g) =>
                    this.index.has(g.type) ? g : { ...g, weight: g.weight * factor },
                );
            };
            return { ...v, prefix: side("prefix", v.prefix), suffix: side("suffix", v.suffix) };
        });
        return { ...roll, variants };
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
    statesIn(item: AItem, reading: Reading = "estimate"): readonly Outcome[] | undefined {
        const [t0, t1] = item.counts.total;
        const [p0, p1] = item.counts.prefix;
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
            if (guaranteed.has(type)) choose(i, this.rowsOn(i, item));
            else if (!isExcluded(item, type) && item.possible.has(type)) maybe.push(i);
        }
        if (maybe.length > 0) {
            // The modifiers the item holds that no one names are taken as its
            // own natural rolls (QUESTIONS.md Q75): drawn by spawn weight from
            // its pool, what it surely holds closing its groups, so a named
            // modifier among them comes up by its share of the race.
            const known = { prefix: 0, suffix: 0 };
            for (const t of guaranteed) known[genOfOn(this.registry, item, t)]++;
            const groups = naturalGroups(item, this.registry, reading);
            for (const gen of ["prefix", "suffix"] as const) {
                const slots = counts[gen] - known[gen];
                const side = groups[gen];
                const special = side
                    .map((g, gi) => (maybe.includes(this.index.get(g.type) ?? -1) ? gi : -1))
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
                    const p = dist[mask]!;
                    if (p === 0) continue;
                    let part = states.map((st) => ({ rows: [...st.rows], prob: st.prob * p }));
                    special.forEach((gi, b) => {
                        if (!(mask & (1 << b))) return;
                        const g = side[gi]!;
                        const i = this.index.get(g.type)!;
                        const byClass = new Map<ModId, number>();
                        for (const r of g.rows) {
                            const c = this.classOf(i, r.mod.id);
                            byClass.set(c, (byClass.get(c) ?? 0) + r.weight);
                        }
                        const total = [...byClass.values()].reduce((s, w) => s + w, 0);
                        part = part.flatMap((st) =>
                            [...byClass].map(([id, w]) => {
                                const copy = [...st.rows];
                                copy[i] = id;
                                return { rows: copy, prob: (st.prob * w) / total };
                            }),
                        );
                    });
                    next.push(...part);
                }
                states = next;
            }
        }
        return states.map((st) => ({
            state: { prefix: counts.prefix, suffix: counts.suffix, rows: st.rows },
            prob: st.prob,
        }));
    }

    /** The checker's item narrowed to a state: null where the two cannot meet. */
    narrow(item: AItem, state: ChainState): AItem | null {
        let a: AItem | null = item;
        const conds: RPred[] = [
            { kind: "compare", projection: "prefixCount", op: "==", value: state.prefix },
            { kind: "compare", projection: "suffixCount", op: "==", value: state.suffix },
        ];
        this.atoms.forEach((atom, i) => {
            const type = this.types[i]!;
            const has: RPred = { kind: "has", type, gen: atom.gen };
            const row = state.rows[i] ?? null;
            if (row === null) {
                conds.push({ kind: "not", inner: has });
                return;
            }
            const classes = this.classes[i]!;
            const own = classes.find((c) => c.rep === row);
            if (own !== undefined && own.members.length === 1) {
                conds.push({ ...has, tierMod: row });
                return;
            }
            // The rest of the ladder: present, at none of the tiers named apart.
            conds.push(has);
            for (const c of classes) {
                if (c.rep !== row && c.members.length === 1)
                    conds.push({ kind: "not", inner: { ...has, tierMod: c.rep } });
            }
        });
        for (const c of conds) {
            if (a === null) return null;
            a = refine(a, c, true);
        }
        return a;
    }
}

function stateKey(s: ChainState): string {
    return `${s.prefix}/${s.suffix}/${s.rows.map((r) => r ?? "-").join(",")}`;
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
        if (
            leaf.kind === "has" &&
            index.has(leaf.type) &&
            (leaf.tierMod === undefined || c.rowed[index.get(leaf.type)!])
        )
            continue;
        if (leaf.kind === "hasGroup" && [...leaf.types].every((t) => index.has(t))) continue;
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

/** Whether a chain body reforges the item anywhere. */
export function reforgesIn(steps: readonly ChainStep[]): boolean {
    return steps.some(
        (s) =>
            s.kind === "reforge" ||
            (s.kind === "branch" && (reforgesIn(s.body) || reforgesIn(s.otherwise ?? []))),
    );
}

/** Whether an op sequence reforges the item: a fill that lays down the reforge's count. */
export function reforges(ops: readonly Op[]): boolean {
    return ops.some((op) => op.kind === "fill" && op.count.kind === "reforge");
}

/**
 * The states a reforge leaves the chain in: for each variant and count case of
 * its roll, which of the atoms the race draws on each side (`amongFirstDistribution`,
 * the sides independent given the split), the present ones placed, each atom's
 * row class by its rows' weight share; the counts are the modifiers placed,
 * kept and drawn. Undefined when the roll has more atoms on a side than the
 * race can list.
 */
export function reforgeOutcomes(
    roll: Extract<Roll, { kind: "draw" }>,
    atoms: readonly ChainAtom[],
    atomIndex: ReadonlyMap<TypeId, number>,
    classOf: (i: number, id: ModId) => ModId,
): Outcome[] | undefined {
    const rowsFor = (
        i: number,
        rows: readonly { readonly id: ModId; readonly weight: number }[],
    ): { id: ModId; share: number }[] => {
        if (rows.length === 0) return [{ id: atoms[i]!.rows[0]!.id, share: 1 }];
        const byClass = new Map<ModId, number>();
        for (const r of rows) {
            const c = classOf(i, r.id);
            byClass.set(c, (byClass.get(c) ?? 0) + r.weight);
        }
        const total = rows.reduce((s, r) => s + r.weight, 0);
        return [...byClass].map(([id, w]) => ({
            id,
            share: total > 0 ? w / total : 1 / byClass.size,
        }));
    };
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
                if (atomIndex.has(g.type)) special.push(gi);
            });
            return { gen, groups, special };
        });
        if (sides.some((s) => s.special.length > 12)) return undefined;
        for (const c of v.counts) {
            const dists = sides.map((s) =>
                amongFirstDistribution(
                    s.groups.map((g) => g.weight),
                    s.special,
                    c[s.gen],
                ),
            );
            const counts = {
                prefix: presentCount.prefix + (v.before.prefix ?? 0) + c.prefix,
                suffix: presentCount.suffix + (v.before.suffix ?? 0) + c.suffix,
            };
            const [pd, sd] = dists as [Float64Array, Float64Array];
            for (let pm = 0; pm < pd.length; pm++) {
                if (pd[pm] === 0) continue;
                for (let sm = 0; sm < sd.length; sm++) {
                    const prob = v.prob * c.prob * pd[pm]! * sd[sm]!;
                    if (prob === 0) continue;
                    // Every atom drawn or placed in this outcome, with its row choices.
                    const drawn: { i: number; rows: { id: ModId; share: number }[] }[] = [
                        ...placed,
                    ];
                    sides.forEach((s, si) => {
                        const mask = si === 0 ? pm : sm;
                        s.special.forEach((gi, b) => {
                            if (!(mask & (1 << b))) return;
                            const g = s.groups[gi]!;
                            const i = atomIndex.get(g.type)!;
                            drawn.push({
                                i,
                                rows: rowsFor(
                                    i,
                                    g.rows.map((r) => ({ id: r.mod.id, weight: r.weight })),
                                ),
                            });
                        });
                    });
                    let states: { rows: (ModId | null)[]; prob: number }[] = [
                        { rows: atoms.map(() => null), prob },
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
    return [...outcomes.values()];
}

/** Whether an op sequence is one draw added to the item, nothing stripped or removed. */
export function singleAdd(ops: readonly Op[]): boolean {
    let fills = 0;
    for (const op of ops) {
        if (op.kind === "strip" || op.kind === "remove") return false;
        if (op.kind === "fill" && op.pool.kind !== "veiledPlaceholder") {
            if (op.count.kind !== "add" || op.count.n[0] !== 1 || op.count.n[1] !== 1) return false;
            fills++;
        }
    }
    return fills === 1;
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
            return row !== null && (pred.tierMod === undefined || row === pred.tierMod);
        }
        case "hasGroup":
            return [...pred.types].some((t) => {
                const i = atomIndex.get(t);
                return i !== undefined && s.rows[i] !== null;
            });
        default:
            return fixed.get(pred) ?? false;
    }
    return false;
}

/** The side a type's rows sit on, on this item. */
export function genOfOn(registry: Registry, a: AItem, type: TypeId): Gen {
    return (
        rollableGen(registry.catalog, a.base, a.ilvl, type, influenceTagsAny(a, registry)) ??
        registry.genOfType(type) ??
        "prefix"
    );
}
