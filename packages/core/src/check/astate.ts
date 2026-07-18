/**
 * The abstract item state `AItem` — the symbolic summary the checker threads
 * instead of concrete items or enumerated outcome arms (see docs/HANDOFF.md §4).
 * Counts are coupled ranges (`total`, `prefix`; suffix derived); mod-presence
 * knowledge is one BDD (`bdd.ts`) so disjunctions survive control-flow joins.
 * `refine` narrows by a predicate; `null` from `refine`/`normalize` means the
 * state is impossible — the dead-branch signal.
 */
import type { Base } from "../model/base.js";
import type { Cmp } from "../ast/ast.js";
import type { Game, Gen, ModId, Rarity } from "../model/ids.js";
import { TypeId } from "../model/ids.js";
import { type Bdd, BddManager } from "./bdd.js";

/** An inclusive integer range `[min, max]`. */
export type Range = readonly [min: number, max: number];

export interface AItem {
    readonly game: Game;
    readonly base: Base;
    readonly ilvl: number;
    readonly rarity: Rarity;
    /** Total affix count (usually a point; a range only after a branch join). */
    readonly total: Range;
    /** Prefix count range; the suffix range is derived as `total − prefix`. */
    readonly prefix: Range;
    /** Shared per-check BDD manager — ids only mean something within one manager. */
    readonly bdd: BddManager;
    /** Presence knowledge as one boolean function over type-presence variables;
     *  guaranteed/excluded/disjunctions are views of it. */
    readonly presence: Bdd;
    /** ModTypes that MAY be present — the pool whitelist. */
    readonly possible: ReadonlySet<TypeId>;
    /** Tier overlay: for a present type, which specific mods (tiers) it could
     *  be. Absent from the map ⇒ any tier. */
    readonly tiers: ReadonlyMap<TypeId, ReadonlySet<ModId>>;
}

/** Per-generation slot cap by rarity (slot-effect deltas not yet modelled). */
export function rarityCap(rarity: Rarity): number {
    switch (rarity) {
        case "normal":
            return 0;
        case "magic":
            return 1;
        case "rare":
            return 3;
    }
}

// --- range helpers --------------------------------------------------------

const rIntersect = (a: Range, b: Range): Range | null => {
    const lo = Math.max(a[0], b[0]);
    const hi = Math.min(a[1], b[1]);
    return lo <= hi ? [lo, hi] : null;
};
const rJoin = (a: Range, b: Range): Range => [Math.min(a[0], b[0]), Math.max(a[1], b[1])];

/** The derived suffix range: `total − prefix`, clamped to the cap. */
export function suffixRange(a: AItem): Range {
    const cap = rarityCap(a.rarity);
    const lo = Math.max(0, a.total[0] - a.prefix[1]);
    const hi = Math.min(cap, a.total[1] - a.prefix[0]);
    return [lo, hi];
}

// --- presence knowledge (views over the BDD) ------------------------------

/**
 * A presence BDD from unit facts: guaranteed types forced true, excluded ones
 * false. Rebuilding this way drops disjunctions — sound, because disjunctions
 * arise from and are consumed by control flow, not carried across operations.
 */
export function presenceFacts(
    bdd: BddManager,
    guaranteed: Iterable<TypeId>,
    excluded: Iterable<TypeId>,
): Bdd {
    let p = bdd.TRUE;
    for (const g of guaranteed) p = bdd.and(p, bdd.variable(g));
    for (const e of excluded) p = bdd.and(p, bdd.not(bdd.variable(e)));
    return p;
}

/** Is `type` guaranteed present — forced true in every model of `presence`? */
export function isGuaranteed(a: AItem, type: TypeId): boolean {
    return a.bdd.entails(a.presence, a.bdd.variable(type));
}

/** Is `type` proven absent — forced false in every model of `presence`? */
export function isExcluded(a: AItem, type: TypeId): boolean {
    return a.bdd.entails(a.presence, a.bdd.not(a.bdd.variable(type)));
}

/** The types `presence` forces present (over the constrained variables only). */
export function guaranteedTypes(a: AItem): Set<TypeId> {
    const out = new Set<TypeId>();
    for (const t of a.bdd.variables()) if (isGuaranteed(a, TypeId(t))) out.add(TypeId(t));
    return out;
}

/** The types `presence` forces absent. */
export function excludedTypes(a: AItem): Set<TypeId> {
    const out = new Set<TypeId>();
    for (const t of a.bdd.variables()) if (isExcluded(a, TypeId(t))) out.add(TypeId(t));
    return out;
}

/** Guard: skip disjunction extraction past this many uncertain variables (2^n). */
const MAX_DISJUNCTION_VARS = 12;

/**
 * Disjunctive guarantees: minimal sets of types where `presence` forces at
 * least one present — the positive prime implicates over the still-uncertain
 * variables. A set S qualifies iff `presence ⊨ ⋁S`; searching by ascending size
 * and skipping supersets of hits keeps only minimal clauses. Only the handful
 * of types a craft refines appear as variables, so the search is cheap.
 */
export function disjunctiveGuarantees(a: AItem): TypeId[][] {
    const guaranteed = guaranteedTypes(a);
    const excluded = excludedTypes(a);
    const cand = a.bdd
        .variables()
        .map((v) => TypeId(v))
        .filter((t) => !guaranteed.has(t) && !excluded.has(t) && a.possible.has(t));
    if (cand.length < 2 || cand.length > MAX_DISJUNCTION_VARS) return [];

    const entailsAnyOf = (set: readonly TypeId[]): boolean => {
        let clause = a.bdd.FALSE;
        for (const t of set) clause = a.bdd.or(clause, a.bdd.variable(t));
        return a.bdd.entails(a.presence, clause);
    };

    const found: TypeId[][] = [];
    const supersetOfFound = (s: readonly TypeId[]): boolean =>
        found.some((f) => f.every((x) => s.includes(x)));

    for (let size = 2; size <= cand.length; size++) {
        for (const combo of combinations(cand, size)) {
            if (supersetOfFound(combo)) continue; // keep only minimal clauses
            if (entailsAnyOf(combo)) found.push(combo);
        }
    }
    return found;
}

/** All size-`k` subsets of `xs`. */
function combinations<T>(xs: readonly T[], k: number): T[][] {
    if (k === 0) return [[]];
    if (k > xs.length) return [];
    const out: T[][] = [];
    const rec = (start: number, pick: T[]): void => {
        if (pick.length === k) {
            out.push([...pick]);
            return;
        }
        for (let i = start; i < xs.length; i++) {
            pick.push(xs[i]!);
            rec(i + 1, pick);
            pick.pop();
        }
    };
    rec(0, []);
    return out;
}

/** A cardinality guarantee: at least `atLeast` of `types` are present. */
export interface CardinalityGuarantee {
    readonly atLeast: number;
    readonly types: TypeId[];
}

/** Binomial coefficient C(n, k). */
function binom(n: number, k: number): number {
    if (k < 0 || k > n) return 0;
    let r = 1;
    for (let i = 0; i < k; i++) r = (r * (n - i)) / (i + 1);
    return Math.round(r);
}

/**
 * Fold disjunctive guarantees into cardinality form. A "≥k of n" fact appears
 * as ALL the (n−k+1)-subsets of an n-set among the prime implicates ("≥2 of
 * {a,b,c}" is exactly the three pairs), so: group clauses sharing variables
 * into connected components; a component that is exactly the C(n, m) uniform
 * m-subsets of its n-variable union collapses to `atLeast = n − m + 1`. A lone
 * clause is `atLeast = 1`; non-matching components stay individual clauses.
 */
export function cardinalityGuarantees(a: AItem): CardinalityGuarantee[] {
    const clauses = disjunctiveGuarantees(a);
    if (clauses.length === 0) return [];

    // Union-find the clauses into connected components (sharing a type).
    const parent = clauses.map((_, i) => i);
    const find = (x: number): number => {
        while (parent[x] !== x) x = parent[x] = parent[parent[x]!]!;
        return x;
    };
    const seen = new Map<TypeId, number>();
    clauses.forEach((c, i) => {
        for (const t of c) {
            const j = seen.get(t);
            if (j === undefined) seen.set(t, i);
            else parent[find(i)] = find(j);
        }
    });
    const components = new Map<number, number[]>();
    clauses.forEach((_, i) => {
        const r = find(i);
        (components.get(r) ?? components.set(r, []).get(r)!).push(i);
    });

    const out: CardinalityGuarantee[] = [];
    for (const idxs of components.values()) {
        const cls = idxs.map((i) => clauses[i]!);
        const union = new Set<TypeId>();
        for (const c of cls) for (const t of c) union.add(t);
        const n = union.size;
        const m = cls[0]!.length;
        // All clauses the same size and exactly every m-subset of the union?
        if (cls.every((c) => c.length === m) && cls.length === binom(n, m)) {
            out.push({ atLeast: n - m + 1, types: [...union] });
        } else {
            for (const c of cls) out.push({ atLeast: 1, types: [...c] });
        }
    }
    return out;
}

/**
 * Re-establish the invariants after a field is changed: clamp `prefix` so that
 * both it and the derived suffix stay within `[0, cap]` and consistent with
 * `total`. Returns `null` if no consistent assignment remains (uninhabited).
 */
export function normalize(a: AItem): AItem | null {
    const cap = rarityCap(a.rarity);
    // `total`, `prefix`, and the derived suffix bound each other, so iterate to
    // a fixpoint over both couplings:
    //   prefix ∈ [total − cap, total]     total ∈ [prefix, prefix + cap]
    // Propagating BOTH ways matters: without the second, refining
    // `prefixCount < 3` leaves `total` at its old max, and an exalt guarded by
    // that very check spuriously looks "possibly full".
    let prefix = a.prefix;
    let total = a.total;
    for (let i = 0; i < 4; i++) {
        const p = rIntersect(prefix, [Math.max(0, total[0] - cap), Math.min(cap, total[1])]);
        if (p === null) return null;
        const t = rIntersect(total, [Math.max(0, p[0]), Math.min(2 * cap, p[1] + cap)]);
        if (t === null) return null;
        const stable =
            p[0] === prefix[0] && p[1] === prefix[1] && t[0] === total[0] && t[1] === total[1];
        prefix = p;
        total = t;
        if (stable) break;
    }
    return { ...a, prefix, total };
}

// --- construction ---------------------------------------------------------

export interface InitialCounts {
    readonly prefixCount: number;
    readonly suffixCount: number;
    /** ModTypes known present from the item block (resolvable named affixes). */
    readonly present: ReadonlySet<TypeId>;
    /** For each declared mod pinned to a specific tier, that exact mod (id). */
    readonly pinned: ReadonlyMap<TypeId, ModId>;
}

export function initialState(
    bdd: BddManager,
    game: Game,
    base: Base,
    ilvl: number,
    rarity: Rarity,
    counts: InitialCounts,
): AItem {
    const p = counts.prefixCount;
    const s = counts.suffixCount;
    return {
        game,
        base,
        ilvl,
        rarity,
        total: [p + s, p + s],
        prefix: [p, p],
        bdd,
        presence: presenceFacts(bdd, counts.present, []),
        possible: new Set(counts.present),
        tiers: new Map([...counts.pinned].map(([type, mod]) => [type, new Set([mod])])),
    };
}

// --- join (merge two branch states) ---------------------------------------

/**
 * The least-upper-bound of two states reaching the same program point. Ranges
 * widen; `possible` unions; `presence` is BDD-OR — which is what keeps a
 * disjunctive fact alive where intersecting per-type sets would destroy it.
 * Rarity is assumed equal across branches from a shared start.
 */
export function join(a: AItem, b: AItem): AItem {
    return {
        game: a.game,
        base: a.base,
        ilvl: a.ilvl,
        rarity: a.rarity,
        total: rJoin(a.total, b.total),
        prefix: rJoin(a.prefix, b.prefix),
        bdd: a.bdd,
        presence: a.bdd.or(a.presence, b.presence),
        possible: union(a.possible, b.possible),
        tiers: joinTiers(a.tiers, b.tiers),
    };
}

/**
 * Join two tier overlays: shared types union their tier sets; a type
 * constrained in only one branch drops to unconstrained (we can't claim a
 * bound the other branch didn't have).
 */
function joinTiers(
    a: ReadonlyMap<TypeId, ReadonlySet<ModId>>,
    b: ReadonlyMap<TypeId, ReadonlySet<ModId>>,
): Map<TypeId, ReadonlySet<ModId>> {
    const out = new Map<TypeId, ReadonlySet<ModId>>();
    for (const [type, sa] of a) {
        const sb = b.get(type);
        if (sb !== undefined) out.set(type, union(sa, sb));
    }
    return out;
}

/**
 * Structural equality, used to detect a loop fixpoint. `game`/`base`/`ilvl`
 * never change within a loop, so they are not compared.
 */
export function stateEqual(a: AItem, b: AItem): boolean {
    const rangeEq = (x: Range, y: Range): boolean => x[0] === y[0] && x[1] === y[1];
    const setEq = <T>(x: ReadonlySet<T>, y: ReadonlySet<T>): boolean => {
        if (x.size !== y.size) return false;
        for (const v of x) if (!y.has(v)) return false;
        return true;
    };
    const tiersEq = (
        x: ReadonlyMap<TypeId, ReadonlySet<ModId>>,
        y: ReadonlyMap<TypeId, ReadonlySet<ModId>>,
    ): boolean => {
        if (x.size !== y.size) return false;
        for (const [t, sx] of x) {
            const sy = y.get(t);
            if (sy === undefined || !setEq(sx, sy)) return false;
        }
        return true;
    };
    return (
        a.rarity === b.rarity &&
        rangeEq(a.total, b.total) &&
        rangeEq(a.prefix, b.prefix) &&
        a.presence === b.presence && // canonical BDD ⇒ structural equality is `===`
        setEq(a.possible, b.possible) &&
        tiersEq(a.tiers, b.tiers)
    );
}

// --- resolved predicates + refinement -------------------------------------

/**
 * A predicate with its mod names already resolved to (type, gen). The checker
 * lowers the surface `Pred` into this before refining, so `refine` is a pure
 * function of the state.
 */
export type RPred =
    | { readonly kind: "isRarity"; readonly rarity: Rarity }
    | {
          readonly kind: "has";
          readonly type: TypeId;
          readonly gen: Gen;
          /** When a tier was requested, the specific mod for that tier. */
          readonly tierMod?: ModId;
      }
    | {
          readonly kind: "compare";
          readonly projection: "prefixCount" | "suffixCount";
          readonly op: Cmp;
          readonly value: number;
      }
    | { readonly kind: "not"; readonly inner: RPred }
    | { readonly kind: "and" | "or"; readonly left: RPred; readonly right: RPred };

/**
 * Refine `a` to the sub-state where `pred` holds (`positive`) or fails
 * (`!positive`). Returns `null` when that sub-state is uninhabited — the
 * signal the checker turns into a dead-arm / unreachable diagnostic.
 */
export function refine(a: AItem, pred: RPred, positive = true): AItem | null {
    switch (pred.kind) {
        case "not":
            return refine(a, pred.inner, !positive);

        case "isRarity": {
            const holds = a.rarity === pred.rarity;
            // Rarity is exact, so the predicate's truth is decided: keep the
            // state when it matches the requested polarity, else uninhabited.
            return holds === positive ? a : null;
        }

        case "has":
            return positive
                ? refineHas(a, pred.type, pred.gen, pred.tierMod)
                : refineLacks(a, pred.type, pred.tierMod);

        case "compare":
            return refineCompare(
                a,
                pred.projection,
                positive ? pred.op : negateCmp(pred.op),
                pred.value,
            );

        // Conjunction narrows sequentially; disjunction joins (the LUB
        // over-approximates "one of them holds"); negation swaps via De Morgan.
        case "and":
            return positive
                ? refineBoth(a, pred.left, pred.right, true)
                : joinOrNull(refine(a, pred.left, false), refine(a, pred.right, false));
        case "or":
            return positive
                ? joinOrNull(refine(a, pred.left, true), refine(a, pred.right, true))
                : refineBoth(a, pred.left, pred.right, false);
    }
}

/** Narrow by `left` then `right` at the same polarity — the conjunction case. */
function refineBoth(a: AItem, left: RPred, right: RPred, positive: boolean): AItem | null {
    const s = refine(a, left, positive);
    return s === null ? null : refine(s, right, positive);
}

/** Join two sub-states, treating `null` (impossible) as absent; `null` only
 *  when both sides are impossible. */
function joinOrNull(s1: AItem | null, s2: AItem | null): AItem | null {
    if (s1 === null) return s2;
    if (s2 === null) return s1;
    return join(s1, s2);
}

/** Can this state be refined so `type` (optionally at tier `tierMod`) is present? */
function tierAllows(a: AItem, type: TypeId, tierMod: ModId | undefined): boolean {
    if (tierMod === undefined) return true;
    const allowed = a.tiers.get(type);
    return allowed === undefined || allowed.has(tierMod); // unconstrained, or M is a possible tier
}

function refineHas(a: AItem, type: TypeId, gen: Gen, tierMod: ModId | undefined): AItem | null {
    if (isExcluded(a, type)) return null;
    const alreadyPresent = isGuaranteed(a, type);
    if (!alreadyPresent && !a.possible.has(type)) return null;
    if (!tierAllows(a, type, tierMod)) return null;

    const tiers: ReadonlyMap<TypeId, ReadonlySet<ModId>> = tierMod === undefined
        ? a.tiers
        : new Map(a.tiers).set(type, new Set([tierMod]));

    if (alreadyPresent) {
        return tierMod === undefined ? a : { ...a, tiers };
    }

    // Learn it present, and what that implies about counts: ≥1 affix total and
    // ≥1 in its generation. The `total ≥ 1` part stops a "remove until X gone"
    // loop from concluding the item could be empty while X is still present.
    const presence = a.bdd.and(a.presence, a.bdd.variable(type));
    const total: Range = [Math.max(a.total[0], 1), a.total[1]];
    const prefix: Range =
        gen === "prefix"
            ? [Math.max(a.prefix[0], 1), a.prefix[1]]
            : // suffix ≥ 1 ⇒ prefix ≤ total − 1
              [a.prefix[0], Math.min(a.prefix[1], total[1] - 1)];
    return normalize({ ...a, presence, tiers, total, prefix });
}

function refineLacks(a: AItem, type: TypeId, tierMod: ModId | undefined): AItem | null {
    if (tierMod !== undefined) {
        // "not has X t<n>": X may still be present at another tier, so remove
        // just that mod from its possible tiers rather than excluding the type.
        const allowed = a.tiers.get(type);
        if (
            isGuaranteed(a, type) &&
            allowed !== undefined &&
            allowed.size === 1 &&
            allowed.has(tierMod)
        ) {
            return null; // guaranteed to be exactly tier M → cannot lack it
        }
        if (allowed === undefined) return a; // unconstrained → can't refine precisely (sound)
        const narrowed = new Set(allowed);
        narrowed.delete(tierMod);
        if (narrowed.size === 0 && isGuaranteed(a, type)) return null; // present but only tier was M
        const tiers = new Map(a.tiers);
        if (narrowed.size === 0) tiers.delete(type);
        else tiers.set(type, narrowed);
        return { ...a, tiers };
    }

    // Force the presence variable false: a guaranteed type collapses the BDD to
    // FALSE (impossible); a disjunction that relied on it gets pruned.
    const presence = a.bdd.and(a.presence, a.bdd.not(a.bdd.variable(type)));
    if (a.bdd.isFalse(presence)) return null; // known present → cannot lack it
    const tiers = new Map(a.tiers);
    tiers.delete(type); // absent ⇒ no tier info
    return { ...a, presence, tiers };
}

function refineCompare(
    a: AItem,
    projection: "prefixCount" | "suffixCount",
    op: Cmp,
    value: number,
): AItem | null {
    if (projection === "prefixCount") {
        const prefix = refineRange(a.prefix, op, value);
        return prefix === null ? null : normalize({ ...a, prefix });
    }
    // suffixCount: refine the derived suffix range, then map back onto prefix
    // via prefix = total − suffix.
    const suffix = refineRange(suffixRange(a), op, value);
    if (suffix === null) return null;
    const mapped = rIntersect(a.prefix, [a.total[0] - suffix[1], a.total[1] - suffix[0]]);
    return mapped === null ? null : normalize({ ...a, prefix: mapped });
}

/** Intersect a range with the constraint `x op value`. */
function refineRange(range: Range, op: Cmp, value: number): Range | null {
    switch (op) {
        case "==":
            return rIntersect(range, [value, value]);
        case "!=":
            // A range can only be tightened by `!=` when it is exactly {value}.
            return range[0] === value && range[1] === value ? null : range;
        case "<":
            return rIntersect(range, [-Infinity, value - 1]);
        case "<=":
            return rIntersect(range, [-Infinity, value]);
        case ">":
            return rIntersect(range, [value + 1, Infinity]);
        case ">=":
            return rIntersect(range, [value, Infinity]);
    }
}

function negateCmp(op: Cmp): Cmp {
    switch (op) {
        case "==":
            return "!=";
        case "!=":
            return "==";
        case "<":
            return ">=";
        case "<=":
            return ">";
        case ">":
            return "<=";
        case ">=":
            return "<";
    }
}

// --- small set helpers ----------------------------------------------------

function union<T>(a: ReadonlySet<T>, b: ReadonlySet<T>): Set<T> {
    return new Set([...a, ...b]);
}
