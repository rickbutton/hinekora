/**
 * The item as the cost layer tracks it: a distribution over a small state,
 * the (prefix, suffix) counts and, for each modifier a condition names, whether
 * it is on the item and at which row (`ChainState`). A loop solved as a chain
 * (`chain.ts`) carries it round by round; these are the pieces that read a
 * step, a condition or a roll in its terms.
 */
import type { Gen, ModId, TypeId } from "../model/ids.js";
import type { Op } from "../check/ops.js";
import type { Registry } from "../resolve/registry.js";
import type { AItem, RPred } from "../check/astate.js";
import { influenceTagsAny } from "../check/ops.js";
import { rollableGen } from "../resolve/tiers.js";
import type { ChainAtom, ChainState, ChainStep, Outcome } from "./chain.js";
import { amongFirstDistribution } from "./race.js";
import type { Roll } from "./roll.js";

/** The states a chain-solved loop's exit leaves the item in, over the
 *  modifiers that loop named; the weights sum to one. */
export interface Carried {
    readonly types: readonly TypeId[];
    /** Per type, whether its row is the one on the item or a reforge's
     *  stand-in for a modifier no condition of that loop tells apart by tier. */
    readonly rowed: readonly boolean[];
    readonly dist: readonly { readonly state: ChainState; readonly weight: number }[];
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
 * row by weight share where a condition pins it; the counts are the modifiers
 * placed, kept and drawn. Undefined when the roll has more atoms on a side
 * than the race can list.
 */
export function reforgeOutcomes(
    roll: Extract<Roll, { kind: "draw" }>,
    atoms: readonly ChainAtom[],
    atomIndex: ReadonlyMap<TypeId, number>,
    needsRow: ReadonlySet<TypeId>,
): Outcome[] | undefined {
    const typeOf = new Map<number, TypeId>();
    for (const [type, i] of atomIndex) typeOf.set(i, type);
    const rowsFor = (
        i: number,
        rows: readonly { readonly id: ModId; readonly weight: number }[],
    ) => {
        const type = typeOf.get(i)!;
        if (!needsRow.has(type) || rows.length <= 1)
            return [{ id: rows[0]?.id ?? atoms[i]!.rows[0]!.id, share: 1 }];
        const total = rows.reduce((s, r) => s + r.weight, 0);
        return rows.map((r) => ({
            id: r.id,
            share: total > 0 ? r.weight / total : 1 / rows.length,
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
