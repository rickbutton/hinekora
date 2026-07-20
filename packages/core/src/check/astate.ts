/**
 * The abstract item state `AItem`, the symbolic summary the checker threads
 * instead of concrete items or enumerated outcome arms (see docs/REFERENCE.md §4).
 * Counts are coupled ranges (`total`, `prefix`; suffix derived); mod-presence
 * knowledge is one BDD (`bdd.ts`) so disjunctions survive control-flow joins.
 * `refine` narrows by a predicate; `null` from `refine`/`normalize` means the
 * state is impossible, the dead-branch signal.
 */
import type { Base } from "../model/base.js";
import type { Cmp } from "../ast/ast.js";
import type { Game, Gen, Rarity } from "../model/ids.js";
import { ModId, TypeId } from "../model/ids.js";
import { type Bdd, BddManager } from "./bdd.js";
import { type Domain, type Range, RangeDomain, SetDomain } from "./domain.js";
import { type Caps, type Counts, CountDomain, caps } from "./counts.js";

// The sub-domains live in their own modules (`domain.ts`, `counts.ts`); re-export
// the surface existing importers reach through `astate` (the caps + `Range`).
export type { Range } from "./domain.js";
export { hardTotalCap, maxTotal, sideCap } from "./counts.js";

/** The tier overlay as a lattice element: for each present type, the specific
 *  mods (tiers) it could be. Absent from the map ⇒ any tier. */
export type Tiers = ReadonlyMap<TypeId, ReadonlySet<ModId>>;

export interface AItem {
    readonly game: Game;
    readonly base: Base;
    readonly ilvl: number;
    readonly rarity: Rarity;
    /** Affix counts (total + prefix; suffix derived), the count sub-domain. */
    readonly counts: Counts;
    /** Shared per-check BDD manager, ids only mean something within one manager. */
    readonly bdd: BddManager;
    /** Presence knowledge as one boolean function over type-presence variables;
     *  guaranteed/excluded/disjunctions are views of it. */
    readonly presence: Bdd;
    /** ModTypes that MAY be present, the pool whitelist. */
    readonly possible: ReadonlySet<TypeId>;
    /** Tier overlay (`TierDomain`): for a present type, which specific mods
     *  (tiers) it could be. Absent from the map ⇒ any tier. */
    readonly tiers: Tiers;
    /** How many bench-CRAFTED mods are present (a range). An item holds at most
     *  one, the "can have multiple crafted mods" metacraft is not modelled, so
     *  `bench` requires this to be provably 0. Reforges/scour clear it to 0. */
    readonly crafted: Range;
}

// --- rarity feasibility ---------------------------------------------------

/** Flasks and tinctures top out at Magic, there are no Rare flasks (wiki). */
const NO_RARE_CLASSES: ReadonlySet<string> = new Set([
    "LifeFlask",
    "ManaFlask",
    "HybridFlask",
    "UtilityFlask",
    "Tincture",
]);

/** Can this base be made Rare at all? (Flasks/tinctures cannot.) */
export function canBeRare(base: Base): boolean {
    return !NO_RARE_CLASSES.has(base.itemClass);
}

/** The caps this item's counts live under (rarity + base). */
function capsOf(a: AItem): Caps {
    return caps(a.rarity, a.base);
}

/** The derived suffix range: `total − prefix`, clamped to the suffix cap. */
export function suffixRange(a: AItem): Range {
    return CountDomain.suffix(a.counts, capsOf(a));
}

// --- presence knowledge (views over the BDD) ------------------------------

/**
 * A presence BDD from unit facts: guaranteed types forced true, excluded ones
 * false. Rebuilding this way drops disjunctions, sound, because disjunctions
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

// --- tier presence atoms --------------------------------------------------
//
// A family's presence is one BDD variable named by its `TypeId`. A tier-qualified
// fact ("present AT this specific mod") is a SECOND variable, so a disjunction of
// tier-qualified clauses (`fire@t1 ∨ cold@t1 ∨ light@t1`) survives a control-flow
// join the same way a family disjunction does, where the flat `tiers` overlay,
// joined per-type, would drop it. Atoms are introduced lazily by `refine`, only
// for the tiers a predicate actually names.
//
// We do NOT assert `tierAtom ⇒ family` or tier mutual-exclusion. Both are true
// facts we could AND in; omitting them only ever under-claims (loses precision,
// never adds a false error, the soundness principle), and nothing yet needs them.

const TIER_SEP = "\u0000"; // NUL: cannot occur in a TypeId/ModId string

function tierAtomName(type: TypeId, mod: ModId): string {
    return `${type}${TIER_SEP}${mod}`;
}
function isTierAtom(name: string): boolean {
    return name.includes(TIER_SEP);
}
function tierAtomType(name: string): TypeId {
    const i = name.indexOf(TIER_SEP);
    return TypeId(i < 0 ? name : name.slice(0, i));
}
function tierAtomMod(name: string): ModId {
    return ModId(name.slice(name.indexOf(TIER_SEP) + 1));
}

/** The tier atoms allocated for `type` (the specific mods a predicate has named). */
function tierAtomsOf(a: AItem, type: TypeId): ModId[] {
    const out: ModId[] = [];
    for (const v of a.bdd.variables()) {
        if (isTierAtom(v) && tierAtomType(v) === type) out.push(tierAtomMod(v));
    }
    return out;
}

/**
 * For a known disjunctive clause over `types`, the specific tier each member is
 * pinned to, but only when every member has exactly one named tier atom AND the
 * tier-lifted clause is still entailed (so we never show a tier we can't prove).
 * Empty when the clause carries no such tier (e.g. plain `has X` disjunctions).
 */
export function disjunctiveTier(a: AItem, types: readonly TypeId[]): Map<TypeId, ModId> {
    const pick = new Map<TypeId, ModId>();
    for (const t of types) {
        const atoms = tierAtomsOf(a, t);
        if (atoms.length !== 1) return new Map<TypeId, ModId>();
        pick.set(t, atoms[0]!);
    }
    let clause = a.bdd.FALSE;
    for (const [t, m] of pick) clause = a.bdd.or(clause, a.bdd.variable(tierAtomName(t, m)));
    return a.bdd.entails(a.presence, clause) ? pick : new Map<TypeId, ModId>();
}

/**
 * Presence after an additive add of one of `added`: keep every positive fact,
 * relax only the excluded-and-addable atoms (an add removes nothing).
 *
 * Only atoms that are ALREADY BDD variables can be excluded, and we must not
 * touch the rest, because `bdd.variable(name)` ALLOCATES a variable. Allocating
 * one per addable mod would flood `bdd.variables()` (used by the presence views,
 * e.g. `disjunctiveGuarantees`'s `MAX_DISJUNCTION_VARS` guard) with hundreds of
 * spurious entries.
 */
export function admitAdd(
    a: AItem,
    added: Iterable<{ readonly type: TypeId; readonly id: ModId }>,
): Bdd {
    const allocated = new Set(a.bdd.variables());
    let p = a.presence;
    const free = (atom: string): void => {
        if (allocated.has(atom) && a.bdd.entails(p, a.bdd.not(a.bdd.variable(atom)))) {
            p = a.bdd.exists(p, atom);
        }
    };
    for (const m of added) {
        free(m.type);
        free(tierAtomName(m.type, m.id));
    }
    return p;
}

/** Is `type` guaranteed present, forced true in every model of `presence`? */
export function isGuaranteed(a: AItem, type: TypeId): boolean {
    return a.bdd.entails(a.presence, a.bdd.variable(type));
}

/** Is `type` proven absent, forced false in every model of `presence`? */
export function isExcluded(a: AItem, type: TypeId): boolean {
    return a.bdd.entails(a.presence, a.bdd.not(a.bdd.variable(type)));
}

/** The types `presence` forces present (over the constrained variables only). */
export function guaranteedTypes(a: AItem): Set<TypeId> {
    const out = new Set<TypeId>();
    for (const t of a.bdd.variables()) {
        if (!isTierAtom(t) && isGuaranteed(a, TypeId(t))) out.add(TypeId(t));
    }
    return out;
}

/** The types `presence` forces absent. */
export function excludedTypes(a: AItem): Set<TypeId> {
    const out = new Set<TypeId>();
    for (const t of a.bdd.variables()) {
        if (!isTierAtom(t) && isExcluded(a, TypeId(t))) out.add(TypeId(t));
    }
    return out;
}

/** Guard: skip disjunction extraction past this many uncertain variables (2^n). */
const MAX_DISJUNCTION_VARS = 12;

/**
 * Disjunctive guarantees: minimal sets of types where `presence` forces at
 * least one present, the positive prime implicates over the still-uncertain
 * variables. A set S qualifies iff `presence ⊨ ⋁S`; searching by ascending size
 * and skipping supersets of hits keeps only minimal clauses. Only the handful
 * of types a craft refines appear as variables, so the search is cheap.
 */
export function disjunctiveGuarantees(a: AItem): TypeId[][] {
    const guaranteed = guaranteedTypes(a);
    const excluded = excludedTypes(a);
    const cand = a.bdd
        .variables()
        .filter((v) => !isTierAtom(v))
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
 * Re-establish the invariants after a field is changed: renormalize the count
 * sub-domain (the `total`/`prefix`/suffix coupling) and re-apply the one
 * cross-domain reduction, crafted mods are a subset of the affixes, so their
 * count can't exceed the total. Returns `null` if no consistent count assignment
 * remains (an uninhabited state).
 */
export function normalize(a: AItem): AItem | null {
    const counts = CountDomain.normalize(a.counts, capsOf(a));
    if (counts === null) return null;
    const cap = counts.total[1];
    const crafted: Range = [Math.min(a.crafted[0], cap), Math.min(a.crafted[1], cap)];
    return { ...a, counts, crafted };
}

/**
 * `normalize`, but total: on a contradictory count state, unreachable in
 * practice, since each op pre-clamps its ranges to the caps, it falls back to a
 * consistent zero-mod item rather than the raw, cap-violating state. Sound: a
 * contradictory state over-approximates the empty set, so any consistent state
 * stands in for it, and a zero-mod item never pollutes a later `join` with a
 * bogus over-cap count.
 */
export function settled(a: AItem): AItem {
    const empty = { ...a, counts: CountDomain.empty(), crafted: [0, 0] as Range };
    return normalize(a) ?? normalize(empty) ?? empty;
}

/**
 * Widening for the loop-invariant fixpoint. The presence BDD's disjunctive/tier
 * structure has a lattice ~2^atoms tall, so a `≥k of n` tier-qualified loop can
 * crawl toward a fixpoint over dozens of iterations (and, past the cap, return an
 * unsound non-fixpoint). Over-approximate the invariant's presence to its UNIT
 * facts (guarantees + exclusions), dropping that tall part, sound (it only
 * forgets), and the loop's after-state re-establishes the disjunction via the
 * exit-predicate refine. Counts/`possible`/tiers converge on their own (bounded),
 * so they are left exact.
 */
export function widenPresence(a: AItem): AItem {
    return { ...a, presence: presenceFacts(a.bdd, guaranteedTypes(a), excludedTypes(a)) };
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
        counts: CountDomain.point(p, s),
        bdd,
        presence: presenceFacts(bdd, counts.present, []),
        possible: new Set(counts.present),
        tiers: new Map([...counts.pinned].map(([type, mod]) => [type, new Set([mod])])),
        crafted: [0, 0], // a declared item block has no bench-crafted mods
    };
}

// --- join (merge two branch states) ---------------------------------------

/**
 * The tier overlay as a lattice element. `join`: shared types union their tier
 * sets; a type constrained in only one branch drops to unconstrained (we can't
 * claim a bound the other branch didn't have). Refinement of the overlay is
 * coupled to `presence` (tier atoms), so it lives in `refine`, not here.
 */
export const TierDomain = {
    join(a: Tiers, b: Tiers): Tiers {
        const out = new Map<TypeId, ReadonlySet<ModId>>();
        for (const [type, sa] of a) {
            const sb = b.get(type);
            if (sb !== undefined) out.set(type, SetDomain.join(sa, sb));
        }
        return out;
    },
    equal(a: Tiers, b: Tiers): boolean {
        if (a.size !== b.size) return false;
        for (const [t, sa] of a) {
            const sb = b.get(t);
            if (sb === undefined || !SetDomain.equal(sa, sb)) return false;
        }
        return true;
    },
} satisfies Domain<Tiers>;

/**
 * The least-upper-bound of two states reaching the same program point, the
 * reduced product's join, applied field-by-field through each sub-domain.
 * `presence` is the one relational domain: its join is BDD-OR (`a.bdd.or`),
 * which is what keeps a disjunctive fact alive where a per-type set would
 * destroy it, and it needs the shared manager, so it stays explicit here.
 * Rarity/base/ilvl are invariant across branches from a shared start.
 */
export function join(a: AItem, b: AItem): AItem {
    return {
        game: a.game,
        base: a.base,
        ilvl: a.ilvl,
        rarity: a.rarity,
        bdd: a.bdd,
        counts: CountDomain.join(a.counts, b.counts),
        presence: a.bdd.or(a.presence, b.presence),
        possible: SetDomain.join(a.possible, b.possible),
        tiers: TierDomain.join(a.tiers, b.tiers),
        crafted: RangeDomain.join(a.crafted, b.crafted),
    };
}

/**
 * Structural equality, used to detect a loop fixpoint, the product's equality,
 * a conjunction of each sub-domain's. `presence` compares by `===` (the BDD is
 * canonical). `game`/`base`/`ilvl` never change within a loop, so they are not
 * compared.
 */
export function stateEqual(a: AItem, b: AItem): boolean {
    return (
        a.rarity === b.rarity &&
        CountDomain.equal(a.counts, b.counts) &&
        a.presence === b.presence &&
        SetDomain.equal(a.possible, b.possible) &&
        TierDomain.equal(a.tiers, b.tiers) &&
        RangeDomain.equal(a.crafted, b.crafted)
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
 * (`!positive`). Returns `null` when that sub-state is uninhabited, the
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

/** Narrow by `left` then `right` at the same polarity, the conjunction case. */
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

    // A named tier is also a presence atom, so it rides through a control-flow
    // join where the flat `tiers` overlay would drop it.
    const withTier = (p: Bdd): Bdd =>
        tierMod === undefined ? p : a.bdd.and(p, a.bdd.variable(tierAtomName(type, tierMod)));

    if (alreadyPresent) {
        return tierMod === undefined ? a : { ...a, presence: withTier(a.presence), tiers };
    }

    // Learn it present, and what that implies about counts (≥1 affix, ≥1 in its
    // generation) via the count domain.
    const presence = withTier(a.bdd.and(a.presence, a.bdd.variable(type)));
    const counts = CountDomain.learnPresent(a.counts, gen);
    return normalize({ ...a, presence, tiers, counts });
}

function refineLacks(a: AItem, type: TypeId, tierMod: ModId | undefined): AItem | null {
    if (tierMod !== undefined) {
        // "not has X t<n>": X may still be present at another tier. Record that
        // this specific tier is absent as a presence atom, that is what lets it
        // contradict a surviving tier-qualified disjunction (`X@t1 ∨ Y@t1`).
        const presence = a.bdd.and(
            a.presence,
            a.bdd.not(a.bdd.variable(tierAtomName(type, tierMod))),
        );
        if (a.bdd.isFalse(presence)) return null;

        // The overlay also narrows the possible tiers rather than excluding X.
        const allowed = a.tiers.get(type);
        if (
            isGuaranteed(a, type) &&
            allowed !== undefined &&
            allowed.size === 1 &&
            allowed.has(tierMod)
        ) {
            return null; // guaranteed to be exactly tier M → cannot lack it
        }
        if (allowed === undefined) return { ...a, presence }; // overlay unconstrained; keep the atom
        const narrowed = new Set(allowed);
        narrowed.delete(tierMod);
        if (narrowed.size === 0 && isGuaranteed(a, type)) return null; // present but only tier was M
        const tiers = new Map(a.tiers);
        if (narrowed.size === 0) tiers.delete(type);
        else tiers.set(type, narrowed);
        return { ...a, presence, tiers };
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
    const counts = CountDomain.refine(a.counts, capsOf(a), projection, op, value);
    return counts === null ? null : normalize({ ...a, counts });
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
