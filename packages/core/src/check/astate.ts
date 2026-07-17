/**
 * The abstract item state — the checker's threaded index (brief §5).
 *
 * This is the intensional-union rule applied to CHECKING. Rather than a concrete
 * item, or an enumerated list of a union's arms, the checker carries a symbolic
 * SUMMARY of the union:
 *
 *   - `total` and `prefix` are integer RANGES `[min, max]`. `total` is the
 *     affix count and stays a tight point except where control flow joins
 *     branches; `prefix` spreads to a range after an unforced add/remove (the
 *     mod could land in / leave either generation). The suffix range is DERIVED
 *     (`suffix = total − prefix`), so the prefix/suffix/total correlation is
 *     preserved — the abstraction stays tight enough that "exalt; exalt" is
 *     range arithmetic, not a 200×200 product.
 *   - `guaranteed` / `possible` / `excluded` are ModType sets: present in every
 *     arm / present in some arm / absent in every arm. Narrowing filters these
 *     (a membership test), exactly as the design intends.
 *
 * Operations are transfer functions over this summary (see `transfer.ts`);
 * narrowing is `refine` (below); loop-exit-as-proof is `refine` by the exit
 * predicate. `null` from `refine`/`normalize` means an UNINHABITED state — a
 * provably-impossible arm, which the checker reports as a dead-arm error.
 */
import type { Base } from "../model/base.js";
import type { Cmp } from "../ast/ast.js";
import type { Game, Gen, ModId, Rarity, TypeId } from "../model/ids.js";

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
    /** ModTypes present in EVERY arm (the floor). */
    readonly guaranteed: ReadonlySet<TypeId>;
    /** ModTypes that MAY be present in some arm (over-approximation). */
    readonly possible: ReadonlySet<TypeId>;
    /** ModTypes proven absent in EVERY arm. */
    readonly excluded: ReadonlySet<TypeId>;
    /**
     * TIER OVERLAY. For a type that is present (in any arm), which specific mods
     * (tiers) it could be. Absent from the map ⇒ unconstrained (any tier). This
     * is what lets the checker prove "has X at tier N" without dropping to full
     * per-mod state: the type-level sets above stay authoritative, and this only
     * refines *which tier* a present type is.
     */
    readonly tiers: ReadonlyMap<TypeId, ReadonlySet<ModId>>;
}

/** Base per-generation slot cap by rarity (M5 ignores slot-effect deltas). */
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

/**
 * Re-establish the invariants after a field is changed: clamp `prefix` so that
 * both it and the derived suffix stay within `[0, cap]` and consistent with
 * `total`. Returns `null` if no consistent assignment remains (uninhabited).
 */
export function normalize(a: AItem): AItem | null {
    const cap = rarityCap(a.rarity);
    // `total`, `prefix`, and the derived `suffix = total − prefix` constrain each
    // other; each bound tightens the others, so we iterate to a fixpoint. Two
    // couplings, from prefix ∈ [0, cap] and suffix ∈ [0, cap]:
    //   prefix ∈ [total − cap, total]        (suffix ≥ 0 and suffix ≤ cap)
    //   total  ∈ [prefix, prefix + cap]       (suffix ≥ 0 and suffix ≤ cap)
    // Propagating BOTH ways is load-bearing: without the second, refining
    // `prefixCount < 3` would leave `total` at its old max, so an exalt guarded
    // by that very check would spuriously look "possibly full".
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
}

export function initialState(
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
        guaranteed: new Set(counts.present),
        possible: new Set(counts.present),
        excluded: new Set(),
        // Item-block affixes are declared by type (no tier), so tiers start
        // unconstrained. Tier declarations in the item block are a future add.
        tiers: new Map(),
    };
}

// --- join (merge two branch states) ---------------------------------------

/**
 * The least-upper-bound of two states reaching the same program point (e.g. the
 * two arms of an if/else). Ranges widen; `guaranteed`/`excluded` intersect (only
 * facts true on BOTH paths survive); `possible` unions. Rarity is assumed equal
 * across branches from a shared start (M5 does not model rarity-divergent
 * joins); the first branch's rarity is kept.
 */
export function join(a: AItem, b: AItem): AItem {
    return {
        game: a.game,
        base: a.base,
        ilvl: a.ilvl,
        rarity: a.rarity,
        total: rJoin(a.total, b.total),
        prefix: rJoin(a.prefix, b.prefix),
        guaranteed: intersect(a.guaranteed, b.guaranteed),
        possible: union(a.possible, b.possible),
        excluded: intersect(a.excluded, b.excluded),
        tiers: joinTiers(a.tiers, b.tiers),
    };
}

/**
 * Join two tier overlays. A tier possible in either branch is possible, so
 * shared types union their tier sets. A type constrained in one branch but
 * unconstrained in the other becomes unconstrained (dropped) — we can't claim a
 * tier bound the other branch didn't have.
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
 * Structural equality of two states, used to detect a loop-invariant fixpoint.
 * (`game`/`base`/`ilvl` never change within a loop, so they are not compared.)
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
        setEq(a.guaranteed, b.guaranteed) &&
        setEq(a.possible, b.possible) &&
        setEq(a.excluded, b.excluded) &&
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
    | { readonly kind: "not"; readonly inner: RPred };

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
    }
}

/** Can this state be refined so `type` (optionally at tier `tierMod`) is present? */
function tierAllows(a: AItem, type: TypeId, tierMod: ModId | undefined): boolean {
    if (tierMod === undefined) return true;
    const allowed = a.tiers.get(type);
    return allowed === undefined || allowed.has(tierMod); // unconstrained, or M is a possible tier
}

function refineHas(a: AItem, type: TypeId, gen: Gen, tierMod: ModId | undefined): AItem | null {
    if (a.excluded.has(type)) return null; // proven absent → dead arm
    const alreadyPresent = a.guaranteed.has(type);
    if (!alreadyPresent && !a.possible.has(type)) return null; // cannot be present → dead arm
    if (!tierAllows(a, type, tierMod)) return null; // that tier can't occur → dead arm

    // Constrain the tier when one was requested.
    const tiers: ReadonlyMap<TypeId, ReadonlySet<ModId>> = tierMod === undefined
        ? a.tiers
        : new Map(a.tiers).set(type, new Set([tierMod]));

    if (alreadyPresent) {
        return tierMod === undefined ? a : { ...a, tiers };
    }

    // Learn it present: add to `guaranteed`, and record what that implies about
    // counts. A present mod means ≥1 affix (total ≥ 1) and ≥1 in its own
    // generation. The `total ≥ 1` part is load-bearing: it stops a "remove until
    // X gone" loop from spuriously concluding the item could be empty while X is
    // still present.
    const guaranteed = new Set(a.guaranteed).add(type);
    const total: Range = [Math.max(a.total[0], 1), a.total[1]];
    const prefix: Range =
        gen === "prefix"
            ? [Math.max(a.prefix[0], 1), a.prefix[1]]
            : // suffix ≥ 1 ⇒ prefix ≤ total − 1
              [a.prefix[0], Math.min(a.prefix[1], total[1] - 1)];
    return normalize({ ...a, guaranteed, tiers, total, prefix });
}

function refineLacks(a: AItem, type: TypeId, tierMod: ModId | undefined): AItem | null {
    if (tierMod !== undefined) {
        // "not has X tier M": X is not present as tier M (X may still be present
        // as another tier). We don't exclude the type — we remove M from its
        // possible tiers.
        const allowed = a.tiers.get(type);
        if (
            a.guaranteed.has(type) &&
            allowed !== undefined &&
            allowed.size === 1 &&
            allowed.has(tierMod)
        ) {
            return null; // guaranteed to be exactly tier M → cannot lack it
        }
        if (allowed === undefined) return a; // unconstrained → can't refine precisely (sound)
        const narrowed = new Set(allowed);
        narrowed.delete(tierMod);
        if (narrowed.size === 0 && a.guaranteed.has(type)) return null; // present but only tier was M
        const tiers = new Map(a.tiers);
        if (narrowed.size === 0) tiers.delete(type);
        else tiers.set(type, narrowed);
        return { ...a, tiers };
    }

    if (a.guaranteed.has(type)) return null; // known present → cannot lack it (dead arm)
    const possible = new Set(a.possible);
    possible.delete(type);
    const excluded = new Set(a.excluded).add(type);
    const tiers = new Map(a.tiers);
    tiers.delete(type); // absent ⇒ no tier info
    return { ...a, possible, excluded, tiers };
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

function intersect<T>(a: ReadonlySet<T>, b: ReadonlySet<T>): Set<T> {
    const out = new Set<T>();
    for (const x of a) if (b.has(x)) out.add(x);
    return out;
}
function union<T>(a: ReadonlySet<T>, b: ReadonlySet<T>): Set<T> {
    return new Set([...a, ...b]);
}
