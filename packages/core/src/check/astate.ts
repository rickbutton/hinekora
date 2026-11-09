/**
 * The abstract item state `AItem`, the symbolic summary the checker threads
 * instead of concrete items or enumerated outcome arms (see docs/REFERENCE.md §4).
 * Counts are three coupled ranges (`total`, `prefix`, `suffix`); mod-presence
 * knowledge is one BDD (`bdd.ts`) so disjunctions survive control-flow joins.
 * `refine` narrows by a predicate; `null` from `refine`/`normalize` means the
 * state is impossible, the dead-branch signal.
 */
import type { Base } from "../model/base.js";
import type { Cmp } from "../ast/ast.js";
import type { Gen, Rarity } from "../model/ids.js";
import { ModId, TypeId } from "../model/ids.js";
import {
    dominantOf,
    type EldritchKey,
    type EldritchSide,
    eldritchKey,
    eldritchOf,
    type Influence,
    type InfluenceKey,
    influenceKey,
    influencesOf,
    NO_INFLUENCE,
} from "../model/marks.js";
import { type Bdd, BddManager } from "./bdd.js";
import { type Domain, type Range, RangeDomain, SetDomain } from "./domain.js";
import { type Caps, type Counts, CountDomain, caps } from "./counts.js";
import { narrowRange, NEGATED_CMP, ValueDomain, type Values } from "./values.js";

// The sub-domains live in their own modules (`domain.ts`, `counts.ts`); re-export
// the surface existing importers reach through `astate` (the caps + `Range`).
export type { Range } from "./domain.js";
export { hardTotalCap, maxTotal, sideCap } from "./counts.js";
export { canBeRare } from "../model/capacity.js";

/** The tier overlay as a lattice element: for each present type, the specific
 *  mods (tiers) it could be. Absent from the map ⇒ any tier. */
export type Tiers = ReadonlyMap<TypeId, ReadonlySet<ModId>>;

export interface AItem {
    readonly base: Base;
    readonly ilvl: number;
    /** The rarities the item may have: one on a straight line, more where paths
     *  that changed it meet or a scour's survivor count is uncertain. */
    readonly rarities: ReadonlySet<Rarity>;
    /** Affix counts (total, prefix and suffix ranges), the count sub-domain. */
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
    /** For a present type, the span its value (its first number) is known to lie
     *  in, narrower than its rows' spans; absent means the rows' spans. A
     *  predicate narrows it, and whatever rerolls or replaces the modifier
     *  drops it (`values.ts`). */
    readonly values: Values;
    /** How many bench-CRAFTED mods are present (a range). `bench` requires it
     *  provably below the crafted cap (one, or three under an active multimod). */
    readonly crafted: Range;
    /** The types a bench craft may have put on the item, the ones `crafted`
     *  counts: a removal of crafted modifiers reaches these and no others. */
    readonly craftedTypes: ReadonlySet<TypeId>;
    /** The influence sets the item may have (`influenceKey`): one on a straight
     *  line, more after a Harvest randomise or where paths meet. */
    readonly influences: ReadonlySet<InfluenceKey>;
    /** Whether the item may be corrupted: `{false}`, `{true}`, or both where a
     *  path that corrupted it meets one that did not. */
    readonly corrupted: ReadonlySet<boolean>;
    /** The pairs of eldritch implicit tiers the item may have (`eldritchKey`),
     *  tracked as pairs so the dominance rule survives a join. */
    readonly eldritch: ReadonlySet<EldritchKey>;
    /** How many modifiers are fractured, a range: one per Fracturing Orb or
     *  Bestiary fracture, two for the talisman recipe; which ones is the
     *  presence BDD's business (`frac@type` atoms), and the difference between
     *  this count and the pinned types is the locks on unnamed modifiers. */
    readonly fractures: Range;
    /** How many memory strands the item may hold, a range: the ceiling what it
     *  had, the floor after every currency that may have used some up. The fill
     *  of a method that uses them up reads the floor, the fewest strands and so
     *  the most tiers that may roll, which keeps its pool an over-approximation
     *  (`model/strands.ts`); other fills are not cut. */
    readonly strands: Range;
    /** Which implicit each side may be: the types an ember's pool holds, narrowed
     *  by a wording; `"any"` when nothing is known. Independent of the tiers,
     *  which a wording never changes. */
    readonly eldritchTypes: Readonly<Record<EldritchSide, ImplicitTypes>>;
    /** The item an imprint would restore, when one is held on every path. */
    readonly imprint?: AItem;
}

export type ImplicitTypes = ReadonlySet<TypeId> | "any";

export const ImplicitTypesDomain = {
    join(a: ImplicitTypes, b: ImplicitTypes): ImplicitTypes {
        return a === "any" || b === "any" ? "any" : SetDomain.join(a, b);
    },
    equal(a: ImplicitTypes, b: ImplicitTypes): boolean {
        if (a === "any" || b === "any") return a === b;
        return SetDomain.equal(a, b);
    },
} satisfies Domain<ImplicitTypes>;

/** The loosest caps over the item's rarities: what its counts may reach on some
 *  path, the bound the ranges are kept under. */
function capsOf(a: AItem): Caps {
    return capsOver(a, Math.max);
}

/** The caps over the item's rarities, each field picked by `pick`: `Math.max`
 *  for the loosest (what some path allows), `Math.min` for the tightest (what
 *  every path allows). */
export function capsOver(a: AItem, pick: (...n: number[]) => number): Caps {
    const all = [...a.rarities].map((r) => caps(r, a.base));
    return {
        prefix: pick(...all.map((c) => c.prefix)),
        suffix: pick(...all.map((c) => c.suffix)),
        total: pick(...all.map((c) => c.total)),
    };
}

/** The one rarity the item has on every path, or `undefined` while it may differ. */
export function rarityOf(a: AItem): Rarity | undefined {
    return a.rarities.size === 1 ? [...a.rarities][0] : undefined;
}

/** The suffix range, no looser than `total − prefix` and clamped to the suffix cap. */
export function suffixRange(a: AItem): Range {
    return CountDomain.suffix(a.counts, capsOf(a));
}

// --- presence knowledge (views over the BDD) ------------------------------

/**
 * A presence BDD from unit facts: guaranteed types forced true, excluded ones
 * false. An operation that rebuilds its presence this way drops the
 * disjunctions, soundly; one that must keep them forgets only the types it
 * touches (`forgetTypes`).
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

/**
 * What a removal of one modifier leaves of the guaranteed types it could reach:
 * all but one of them remain, so every pair has a present member; and when the
 * removal could reach nothing else (`certainly`), one of them is gone, so not
 * all are present. A branch on one of them then settles the others: "the orb
 * took the metamod or the life" and "the life is still there" leave the metamod
 * gone.
 */
export function assertOneRemovedAmong(
    bdd: BddManager,
    presence: Bdd,
    types: readonly TypeId[],
    certainly: boolean,
): Bdd {
    let p = presence;
    for (const [x, y] of combinations(types, 2)) {
        p = bdd.and(p, bdd.or(bdd.variable(x!), bdd.variable(y!)));
    }
    if (certainly && types.length > 0) {
        let all = bdd.TRUE;
        for (const t of types) all = bdd.and(all, bdd.variable(t));
        p = bdd.and(p, bdd.not(all));
    }
    return p;
}

/** `presence` with at least `k` of `types` present: every subset that leaves
 *  fewer than `k` out has a present member. All of them when `k` is their count
 *  or more; unchanged when `k` is nothing. */
export function assertAtLeast(
    bdd: BddManager,
    presence: Bdd,
    types: readonly TypeId[],
    k: number,
): Bdd {
    if (k <= 0 || types.length === 0) return presence;
    let p = presence;
    if (k >= types.length) {
        for (const t of types) p = bdd.and(p, bdd.variable(t));
        return p;
    }
    for (const group of combinations(types, types.length - k + 1)) {
        let some = bdd.FALSE;
        for (const t of group) some = bdd.or(some, bdd.variable(t));
        p = bdd.and(p, some);
    }
    return p;
}

/** The presence function with everything it knows about `types` forgotten (their
 *  presence variables and tier atoms existentially quantified), every other fact,
 *  the disjunctions among the rest included, kept. What a removal that can only
 *  touch those types leaves. */
export function forgetTypes(a: AItem, types: ReadonlySet<TypeId>): Bdd {
    let p = a.presence;
    for (const v of a.bdd.support(p)) {
        if (isFracAtom(v)) continue;
        if (types.has(isTierAtom(v) ? tierAtomType(v) : TypeId(v))) p = a.bdd.exists(p, v);
    }
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
// Two facts tie the atoms to the item: a modifier at a specific row is present
// (`atom ⇒ family`), and it is at one row only (two atoms of a type exclude each
// other). They are asserted whenever a predicate reasons about a type
// (`withTierFacts`), which is what lets "one of these is T1" followed by "not
// has fire" conclude that cold is the T1 one; the overlay is then read back
// from what the presence function proves (`reduceTiers`).

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

// --- fracture atoms -------------------------------------------------------
//
// "type X is the fractured (locked) mod" is a BDD variable `frac@X`, distinct
// from X's presence variable, so an unproven Fracturing Orb ("one of these mods
// is fractured") rides as a disjunction that a `fractured X` branch collapses.
// Two facts are asserted with a fracture: `frac@X ⇒ present@X` (a locked mod is
// present) and exactly-one over the candidates (the one-fracture-max rule).

const FRAC_PREFIX_CODE = 1; // SOH
/** "some mod is fractured" — the sentinel atom, set by every fracture so a
 *  fracture on an anonymous (unnamed) mod is still tracked. */
const FRAC_EXISTS = String.fromCharCode(FRAC_PREFIX_CODE);
function fracAtomName(type: TypeId): string {
    return `${FRAC_EXISTS}${type}`;
}
function isFracAtom(name: string): boolean {
    return name.charCodeAt(0) === FRAC_PREFIX_CODE;
}
/** The type a fracture atom names, or "" for the `FRAC_EXISTS` sentinel. */
function fracAtomType(name: string): TypeId {
    return TypeId(name.slice(1));
}

/** A BDD variable that is not a plain type-presence variable (a tier or fracture
 *  atom); the presence-view scans skip these. */
function isAtom(name: string): boolean {
    return isTierAtom(name) || isFracAtom(name);
}

/**
 * Forget which tier each present modifier is, for the types `relaxed` admits:
 * the overlay entry goes and every tier atom of the type is quantified away,
 * so the modifier could be any row that rolls here (the Tainted Divine
 * Teardrop). Sound: it only forgets.
 */
export function relaxTiers(a: AItem, relaxed: (type: TypeId) => boolean): AItem {
    const tiers = new Map([...a.tiers].filter(([t]) => !relaxed(t)));
    const values = new Map([...a.values].filter(([t]) => !relaxed(t)));
    let presence = a.presence;
    for (const v of a.bdd.support(presence)) {
        if (isTierAtom(v) && relaxed(tierAtomType(v))) presence = a.bdd.exists(presence, v);
    }
    return { ...a, tiers, values, presence };
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
 * `p` with the facts every tier atom of `type` obeys: the modifier at that row
 * is present, and it is at no other row. True of every item, so this only ever
 * removes states that cannot exist.
 */
function withTierFacts(a: AItem, p: Bdd, type: TypeId): Bdd {
    const atoms = tierAtomsOf(a, type).map((m) => a.bdd.variable(tierAtomName(type, m)));
    const family = a.bdd.variable(type);
    atoms.forEach((atom, i) => {
        p = a.bdd.and(p, a.bdd.or(a.bdd.not(atom), family));
        for (const other of atoms.slice(i + 1)) p = a.bdd.and(p, a.bdd.not(a.bdd.and(atom, other)));
    });
    return p;
}

/**
 * The tier overlay narrowed by what the presence function proves: a type whose
 * atom is forced true is pinned to that row, and a row whose atom is forced
 * false leaves the type's set. `null` when a present type is left with no row.
 */
function reduceTiers(a: AItem): AItem | null {
    let tiers: Map<TypeId, ReadonlySet<ModId>> | undefined;
    const types = new Set(a.bdd.support(a.presence).filter(isTierAtom).map(tierAtomType));
    for (const type of types) {
        const atoms = tierAtomsOf(a, type);
        const forced = atoms.find((m) =>
            a.bdd.entails(a.presence, a.bdd.variable(tierAtomName(type, m))),
        );
        const current = a.tiers.get(type);
        let next: ReadonlySet<ModId> | undefined;
        if (forced !== undefined) {
            if (current?.size === 1 && current.has(forced)) continue;
            next = new Set([forced]);
        } else if (current !== undefined) {
            const gone = atoms.filter(
                (m) =>
                    current.has(m) &&
                    a.bdd.entails(a.presence, a.bdd.not(a.bdd.variable(tierAtomName(type, m)))),
            );
            if (gone.length === 0) continue;
            next = new Set([...current].filter((m) => !gone.includes(m)));
            if (next.size === 0) {
                if (isGuaranteed(a, type)) return null;
                next = undefined; // every named row ruled out; the overlay says nothing more
            }
        } else continue;
        tiers ??= new Map(a.tiers);
        if (next === undefined) tiers.delete(type);
        else tiers.set(type, next);
    }
    return tiers === undefined ? a : { ...a, tiers };
}

/**
 * For a known disjunctive clause over `types`, the specific tier each member is
 * pinned to, but only when every member has exactly one named tier atom AND the
 * tier-lifted clause is still entailed (so we never show a tier we can't prove).
 * Empty when the clause carries no such tier (e.g. plain `has X` disjunctions).
 */
export function disjunctiveTier(a: AItem, types: readonly TypeId[]): Map<TypeId, ModId> {
    // A view: only the atoms this state's function mentions count, not the
    // ones a later step named.
    const support = a.bdd.support(a.presence);
    const pick = new Map<TypeId, ModId>();
    for (const t of types) {
        const atoms = support
            .filter((v) => isTierAtom(v) && tierAtomType(v) === t)
            .map(tierAtomMod);
        if (atoms.length !== 1) return new Map<TypeId, ModId>();
        pick.set(t, atoms[0]!);
    }
    let clause = a.bdd.FALSE;
    for (const [t, m] of pick) clause = a.bdd.or(clause, a.bdd.variable(tierAtomName(t, m)));
    return a.bdd.entails(a.presence, clause) ? pick : new Map<TypeId, ModId>();
}

/**
 * Presence after an additive add of one of `added`: every model the item had,
 * plus each of them with the added atom set true (an add removes nothing, so
 * every positive fact and every disjunction among the rest survives). Taking
 * the models with the atom set true, rather than only freeing an atom that is
 * excluded on every path, is what keeps a path on which the atom was excluded
 * alive where it meets one on which it was not: asserting the atom afterwards
 * would otherwise delete that path's models and the state would inherit what
 * the other paths knew.
 *
 * Only atoms the presence function mentions are touched; the others are already
 * free, and `bdd.variable(name)` ALLOCATES a variable, hundreds per natural pool
 * that a craft never constrains.
 */
export function admitAdd(
    a: AItem,
    added: Iterable<{ readonly type: TypeId; readonly id?: ModId }>,
): Bdd {
    const mentioned = new Set(a.bdd.support(a.presence));
    let p = a.presence;
    const admit = (atom: string): void => {
        if (!mentioned.has(atom)) return;
        const set = a.bdd.and(a.bdd.exists(p, atom), a.bdd.variable(atom));
        p = a.bdd.or(p, set);
    };
    for (const m of added) {
        admit(m.type);
        if (m.id !== undefined) admit(tierAtomName(m.type, m.id));
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
    for (const t of a.bdd.support(a.presence)) {
        if (!isAtom(t) && isGuaranteed(a, TypeId(t))) out.add(TypeId(t));
    }
    return out;
}

/** The types `presence` forces absent. */
export function excludedTypes(a: AItem): Set<TypeId> {
    const out = new Set<TypeId>();
    for (const t of a.bdd.support(a.presence)) {
        if (!isAtom(t) && isExcluded(a, TypeId(t))) out.add(TypeId(t));
    }
    return out;
}

/** Is `type` the fractured (locked) mod, forced in every model of `presence`? */
export function isFractured(a: AItem, type: TypeId): boolean {
    return a.bdd.entails(a.presence, a.bdd.variable(fracAtomName(type)));
}

/** The types proven to be fractured (locked); empty when a fracture exists
 *  but isn't yet pinned to a type. */
export function fracturedTypes(a: AItem): Set<TypeId> {
    const out = new Set<TypeId>();
    for (const v of a.bdd.support(a.presence)) {
        if (isFracAtom(v) && v !== FRAC_EXISTS && a.bdd.entails(a.presence, a.bdd.variable(v))) {
            out.add(fracAtomType(v));
        }
    }
    return out;
}

/** The fractured modifiers not pinned to a type, as a range: the count less
 *  the proven types. Such a lock may sit on any current modifier. */
export function unprovenFractures(a: AItem): Range {
    const pinned = fracturedTypes(a).size;
    return [Math.max(0, a.fractures[0] - pinned), Math.max(0, a.fractures[1] - pinned)];
}

/** Does the item carry a fracture at all (proven or not)? Tracked by the
 *  `FRAC_EXISTS` sentinel, so it holds even for a fracture on an anonymous mod. */
export function hasFracture(a: AItem): boolean {
    return (
        a.bdd.support(a.presence).includes(FRAC_EXISTS) &&
        a.bdd.entails(a.presence, a.bdd.variable(FRAC_EXISTS))
    );
}

/** The fracture facts alone: `presence` existentially reduced to the fracture
 *  atoms, with the coupling `frac ⇒ present` re-asserted for each candidate. A
 *  strip or a removal keeps this (the locked mod is permanent) and forgets the
 *  rest; keeping a candidate's own presence variable instead would carry its
 *  pre-strip guarantee across the operation that may have removed it. */
export function fractureProjection(a: AItem): Bdd {
    const support = a.bdd.support(a.presence);
    const fracAtoms = support.filter(isFracAtom);
    let p = a.presence;
    for (const v of support) if (!fracAtoms.includes(v)) p = a.bdd.exists(p, v);
    for (const v of fracAtoms) {
        if (v === FRAC_EXISTS) continue;
        p = a.bdd.and(p, a.bdd.or(a.bdd.not(a.bdd.variable(v)), a.bdd.variable(fracAtomType(v))));
    }
    return p;
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
        .support(a.presence)
        .filter((v) => !isAtom(v))
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
 * Re-establish the invariants after a field is changed: drop a rarity whose caps
 * cannot hold the counts' minimums (a modifier every path carries rules out
 * Normal), renormalize the count sub-domain (the `total`/`prefix`/suffix
 * coupling) and re-apply the cross-domain reductions, crafted and fractured mods
 * are subsets of the affixes, so neither count can exceed the total. Returns
 * `null` if no rarity or no consistent count assignment remains (an uninhabited
 * state).
 */
export function normalize(a: AItem): AItem | null {
    const rarities = new Set(
        [...a.rarities].filter((r) => {
            const c = caps(r, a.base);
            return (
                a.counts.total[0] <= c.total &&
                a.counts.prefix[0] <= c.prefix &&
                a.counts.suffix[0] <= c.suffix
            );
        }),
    );
    if (rarities.size === 0) return null;
    if (rarities.size < a.rarities.size) a = { ...a, rarities };
    const counts = CountDomain.normalize(a.counts, capsOf(a));
    if (counts === null) return null;
    const cap = counts.total[1];
    const within = (r: Range): Range => [Math.min(r[0], cap), Math.min(r[1], cap)];
    // A crafted modifier is one of the crafted types still possibly present, so
    // the count is bounded by those: once a branch rules the metamod out, the
    // item is known to carry no crafted modifier at all.
    let mayBeCrafted = 0;
    for (const t of a.craftedTypes) if (!isExcluded(a, t)) mayBeCrafted++;
    const crafted = within([
        Math.min(a.crafted[0], mayBeCrafted),
        Math.min(a.crafted[1], mayBeCrafted),
    ]);
    return { ...a, counts, crafted, fractures: within(a.fractures) };
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
    const empty = {
        ...a,
        counts: CountDomain.empty(),
        crafted: [0, 0] as Range,
        craftedTypes: new Set<TypeId>(),
    };
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
    return {
        ...a,
        presence: presenceFacts(a.bdd, guaranteedTypes(a), excludedTypes(a)),
        ...(a.imprint && { imprint: widenPresence(a.imprint) }),
    };
}

// --- construction ---------------------------------------------------------

export interface InitialCounts {
    readonly prefixCount: number;
    readonly suffixCount: number;
    /** ModTypes known present from the item block (resolvable named affixes). */
    readonly present: ReadonlySet<TypeId>;
    /** For each declared mod pinned to a specific tier, that exact mod (id). */
    readonly pinned: ReadonlyMap<TypeId, ModId>;
    /** The declared fractured (locked) mods' types. */
    readonly fractured?: readonly TypeId[];
    /** How many anonymous (`"random"`) affixes the item block marks fractured:
     *  locks that exist with no type known to carry them. */
    readonly fracturedAnonymous?: number;
    /** How many declared mods are bench-crafted rows. */
    readonly crafted: number;
    /** The types those rows may be. */
    readonly craftedTypes?: ReadonlySet<TypeId>;
}

/** The marks the item block declares. */
export interface InitialMarks {
    readonly influences: readonly Influence[];
    readonly corrupted: boolean;
    /** The eldritch implicits' tiers, 1 to 6, absent for none. */
    readonly exarch?: number;
    readonly eater?: number;
    /** Which implicit each is, when the item block names it. */
    readonly exarchTypes?: ReadonlySet<TypeId>;
    readonly eaterTypes?: ReadonlySet<TypeId>;
    /** The memory strands the item holds; none when absent. */
    readonly strands?: number;
}

export function initialState(
    bdd: BddManager,
    base: Base,
    ilvl: number,
    rarity: Rarity,
    counts: InitialCounts,
    marks: InitialMarks = { influences: [], corrupted: false },
): AItem {
    const p = counts.prefixCount;
    const s = counts.suffixCount;
    const fracturedTypes = counts.fractured ?? [];
    const anonymousLocks = counts.fracturedAnonymous ?? 0;
    const locks = fracturedTypes.length + anonymousLocks;
    let presence = presenceFacts(bdd, counts.present, []);
    for (const t of fracturedTypes) presence = assertDeclaredFracture(bdd, presence, t);
    if (anonymousLocks > 0) presence = bdd.and(presence, bdd.variable(FRAC_EXISTS));
    return settled({
        base,
        ilvl,
        rarities: new Set([rarity]),
        fractures: [locks, locks],
        strands: [marks.strands ?? 0, marks.strands ?? 0],
        influences: new Set([influenceKey(marks.influences)]),
        corrupted: new Set([marks.corrupted]),
        eldritch: new Set([eldritchKey(marks.exarch ?? 0, marks.eater ?? 0)]),
        eldritchTypes: {
            exarch: marks.exarchTypes ?? "any",
            eater: marks.eaterTypes ?? "any",
        },
        counts: CountDomain.point(p, s),
        bdd,
        presence,
        possible: new Set(counts.present),
        tiers: new Map([...counts.pinned].map(([type, mod]) => [type, new Set([mod])])),
        values: new Map(),
        crafted: [counts.crafted, counts.crafted],
        craftedTypes: new Set(counts.craftedTypes ?? []),
    });
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
 * Join a per-type overlay, keeping what one branch knows of a type the other
 * branch excludes: if the type is on the item at all, it came from the branch
 * that pinned it. Without this, "life or mana, one of them" refined into its
 * two arms and joined back forgot both tiers.
 */
function joinKnown<V>(
    a: AItem,
    b: AItem,
    oa: ReadonlyMap<TypeId, V>,
    ob: ReadonlyMap<TypeId, V>,
    join: (x: ReadonlyMap<TypeId, V>, y: ReadonlyMap<TypeId, V>) => ReadonlyMap<TypeId, V>,
): ReadonlyMap<TypeId, V> {
    const out = new Map(join(oa, ob));
    for (const [t, v] of oa) if (!ob.has(t) && isExcluded(b, t)) out.set(t, v);
    for (const [t, v] of ob) if (!oa.has(t) && isExcluded(a, t)) out.set(t, v);
    return out;
}

/**
 * The least-upper-bound of two states reaching the same program point, the
 * reduced product's join, applied field-by-field through each sub-domain.
 * `presence` is the one relational domain: its join is BDD-OR (`a.bdd.or`),
 * which is what keeps a disjunctive fact alive where a per-type set would
 * destroy it, and it needs the shared manager, so it stays explicit here.
 * Base/ilvl are invariant across branches from a shared start.
 */
export function join(a: AItem, b: AItem): AItem {
    return {
        base: a.base,
        ilvl: a.ilvl,
        rarities: SetDomain.join(a.rarities, b.rarities),
        influences: SetDomain.join(a.influences, b.influences),
        corrupted: SetDomain.join(a.corrupted, b.corrupted),
        eldritch: SetDomain.join(a.eldritch, b.eldritch),
        fractures: RangeDomain.join(a.fractures, b.fractures),
        strands: RangeDomain.join(a.strands, b.strands),
        eldritchTypes: {
            exarch: ImplicitTypesDomain.join(a.eldritchTypes.exarch, b.eldritchTypes.exarch),
            eater: ImplicitTypesDomain.join(a.eldritchTypes.eater, b.eldritchTypes.eater),
        },
        bdd: a.bdd,
        counts: CountDomain.join(a.counts, b.counts),
        presence: a.bdd.or(a.presence, b.presence),
        possible: SetDomain.join(a.possible, b.possible),
        tiers: joinKnown(a, b, a.tiers, b.tiers, (x, y) => TierDomain.join(x, y)),
        values: joinKnown(a, b, a.values, b.values, (x, y) => ValueDomain.join(x, y)),
        crafted: RangeDomain.join(a.crafted, b.crafted),
        craftedTypes: SetDomain.join(a.craftedTypes, b.craftedTypes),
        ...(a.imprint && b.imprint && { imprint: join(a.imprint, b.imprint) }),
    };
}

/**
 * Structural equality, used to detect a loop fixpoint, the product's equality,
 * a conjunction of each sub-domain's. `presence` compares by `===` (the BDD is
 * canonical). `base`/`ilvl` never change within a loop, so they are not
 * compared.
 */
export function stateEqual(a: AItem, b: AItem): boolean {
    return (
        SetDomain.equal(a.rarities, b.rarities) &&
        SetDomain.equal(a.influences, b.influences) &&
        SetDomain.equal(a.corrupted, b.corrupted) &&
        SetDomain.equal(a.eldritch, b.eldritch) &&
        RangeDomain.equal(a.fractures, b.fractures) &&
        RangeDomain.equal(a.strands, b.strands) &&
        ImplicitTypesDomain.equal(a.eldritchTypes.exarch, b.eldritchTypes.exarch) &&
        ImplicitTypesDomain.equal(a.eldritchTypes.eater, b.eldritchTypes.eater) &&
        CountDomain.equal(a.counts, b.counts) &&
        a.presence === b.presence &&
        SetDomain.equal(a.possible, b.possible) &&
        TierDomain.equal(a.tiers, b.tiers) &&
        ValueDomain.equal(a.values, b.values) &&
        RangeDomain.equal(a.crafted, b.crafted) &&
        SetDomain.equal(a.craftedTypes, b.craftedTypes) &&
        (a.imprint === undefined
            ? b.imprint === undefined
            : b.imprint !== undefined && stateEqual(a.imprint, b.imprint))
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
          /** That tier's roll span, which a value already known is clipped to. */
          readonly tierSpan?: Range;
      }
    /** Some modifier of the named modifier's group is present. */
    | { readonly kind: "hasGroup"; readonly type: TypeId; readonly types: ReadonlySet<TypeId> }
    /** The modifier is present with its value comparing so; `rows` are the
     *  spans of the rows it may be here. */
    | {
          readonly kind: "hasValue";
          readonly type: TypeId;
          readonly gen: Gen;
          readonly op: Cmp;
          readonly value: number;
          readonly rows: ReadonlyMap<ModId, Range>;
          /** Rows of the type with no number in their text: the comparison can
           *  neither rule them in nor out. */
          readonly unnumbered: ReadonlySet<ModId>;
      }
    | {
          readonly kind: "compare";
          readonly projection: "prefixCount" | "suffixCount";
          readonly op: Cmp;
          readonly value: number;
      }
    | { readonly kind: "fractured"; readonly type: TypeId }
    /** The item has that influence, or any influence when none is named. */
    | { readonly kind: "influenced"; readonly influence?: Influence }
    | { readonly kind: "corrupted" }
    /** That eldritch implicit is present, at that tier when one is named, and
     *  one of `types` when a wording was given. */
    | {
          readonly kind: "eldritch";
          readonly side: EldritchSide;
          readonly tier?: number;
          readonly types?: ReadonlySet<TypeId>;
      }
    /** That implicit is the dominant one. */
    | { readonly kind: "dominant"; readonly side: EldritchSide }
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
            const rarities = new Set(
                [...a.rarities].filter((r) => (r === pred.rarity) === positive),
            );
            return rarities.size === 0 ? null : settled({ ...a, rarities });
        }

        case "has":
            return positive
                ? refineHas(a, pred.type, pred.gen, pred.tierMod, pred.tierSpan)
                : refineLacks(a, pred.type, pred.tierMod);

        case "hasGroup":
            return positive ? refineHasGroup(a, pred.types) : refineLacksGroup(a, pred.types);

        case "hasValue":
            return refineHasValue(a, pred, positive);

        case "fractured":
            return positive ? refineFractured(a, pred.type) : refineNotFractured(a, pred.type);

        case "influenced": {
            const wanted = pred.influence;
            const holds = (key: InfluenceKey): boolean =>
                wanted === undefined ? key !== NO_INFLUENCE : influencesOf(key).includes(wanted);
            const influences = new Set([...a.influences].filter((k) => holds(k) === positive));
            return influences.size === 0 ? null : { ...a, influences };
        }

        case "corrupted": {
            const corrupted = new Set([...a.corrupted].filter((c) => c === positive));
            return corrupted.size === 0 ? null : { ...a, corrupted };
        }

        case "eldritch": {
            const holds = (key: EldritchKey): boolean => {
                const tier = eldritchOf(key)[pred.side];
                return pred.tier === undefined ? tier > 0 : tier === pred.tier;
            };
            const wanted = pred.types;
            const have = a.eldritchTypes[pred.side];
            if (positive) {
                const eldritch = new Set([...a.eldritch].filter(holds));
                if (eldritch.size === 0) return null;
                if (wanted === undefined) return { ...a, eldritch };
                const types =
                    have === "any" ? wanted : new Set([...have].filter((t) => wanted.has(t)));
                if (types.size === 0) return null;
                return {
                    ...a,
                    eldritch,
                    eldritchTypes: { ...a.eldritchTypes, [pred.side]: types },
                };
            }
            // Negative with a wording: the implicit may be absent, or present and
            // another; only when it is surely present can the wording be excluded.
            if (wanted === undefined) {
                const eldritch = new Set([...a.eldritch].filter((k) => !holds(k)));
                return eldritch.size === 0 ? null : { ...a, eldritch };
            }
            if ([...a.eldritch].every(holds) && have !== "any") {
                const types = new Set([...have].filter((t) => !wanted.has(t)));
                if (types.size === 0) return null;
                return { ...a, eldritchTypes: { ...a.eldritchTypes, [pred.side]: types } };
            }
            return a;
        }

        case "dominant": {
            const eldritch = new Set(
                [...a.eldritch].filter((k) => (dominantOf(k) === pred.side) === positive),
            );
            return eldritch.size === 0 ? null : { ...a, eldritch };
        }

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

function refineHas(
    a: AItem,
    type: TypeId,
    gen: Gen,
    tierMod: ModId | undefined,
    tierSpan?: Range,
): AItem | null {
    if (isExcluded(a, type)) return null;
    const alreadyPresent = isGuaranteed(a, type);
    if (!alreadyPresent && !a.possible.has(type)) return null;
    if (!tierAllows(a, type, tierMod)) return null;

    const tiers: ReadonlyMap<TypeId, ReadonlySet<ModId>> = tierMod === undefined
        ? a.tiers
        : new Map(a.tiers).set(type, new Set([tierMod]));
    // A value learnt before the tier was named lies within the tier's own roll
    // span, or the modifier is not at that tier.
    let values = a.values;
    const known = tierSpan === undefined ? undefined : a.values.get(type);
    if (known !== undefined && tierSpan !== undefined) {
        const clipped: Range = [Math.max(known[0], tierSpan[0]), Math.min(known[1], tierSpan[1])];
        if (clipped[0] > clipped[1]) return null;
        values = new Map(a.values).set(type, clipped);
    }

    // A named tier is also a presence atom, so it rides through a control-flow
    // join where the flat `tiers` overlay would drop it.
    const withTier = (p: Bdd): Bdd => {
        if (tierMod === undefined) return withTierFacts(a, p, type);
        const atom = a.bdd.variable(tierAtomName(type, tierMod));
        return withTierFacts(a, a.bdd.and(p, atom), type);
    };

    if (alreadyPresent) {
        if (tierMod === undefined) return a;
        const presence = withTier(a.presence);
        if (a.bdd.isFalse(presence)) return null; // proven at another row
        return reduceTiers({ ...a, presence, tiers, values });
    }

    // Learn it present, and what that implies about counts (≥1 affix, ≥1 in its
    // generation) via the count domain.
    const presence = withTier(a.bdd.and(a.presence, a.bdd.variable(type)));
    if (a.bdd.isFalse(presence)) return null;
    const counts = CountDomain.learnPresent(a.counts, gen);
    const s = normalize({ ...a, presence, tiers, counts, values });
    return s === null ? null : reduceTiers(s);
}

/**
 * The modifier's value compares so. Positive: the modifier is present at one
 * of the rows whose span reaches the comparison, and its value lies in the
 * part of those spans that does; impossible when no row reaches it. Negative:
 * the modifier is absent or its value compares the other way, so only a
 * guaranteed modifier learns anything, and what it learns is the other part.
 * A row with no number stays possible on both branches, and while it may be
 * the one present the value is unknown.
 */
function refineHasValue(
    a: AItem,
    pred: Extract<RPred, { kind: "hasValue" }>,
    positive: boolean,
): AItem | null {
    const { type } = pred;
    if (!positive && !isGuaranteed(a, type)) return a;
    const op = positive ? pred.op : NEGATED_CMP[pred.op];
    const pinned = a.tiers.get(type);
    const known = a.values.get(type);
    const kept = new Map<ModId, Range>();
    for (const [id, span] of pred.rows) {
        if (pinned !== undefined && !pinned.has(id)) continue;
        const within =
            known === undefined
                ? span
                : ([Math.max(span[0], known[0]), Math.min(span[1], known[1])] as const);
        if (within[0] > within[1]) continue;
        const part = narrowRange(within, op, pred.value);
        if (part !== null) kept.set(id, part);
    }
    const blank = [...pred.unnumbered].filter((id) => pinned === undefined || pinned.has(id));
    if (kept.size === 0 && blank.length === 0) return null;
    let hull: Range | undefined;
    for (const r of kept.values()) hull = hull === undefined ? r : RangeDomain.join(hull, r);
    const only = kept.size === 1 && blank.length === 0 ? [...kept.keys()][0] : undefined;
    const present = positive ? refineHas(a, type, pred.gen, only) : a;
    if (present === null) return null;
    const tiers = new Map(present.tiers);
    if (kept.size + blank.length < pred.rows.size + pred.unnumbered.size || pinned !== undefined) {
        tiers.set(type, new Set([...kept.keys(), ...blank]));
    }
    const values = new Map(present.values);
    if (hull !== undefined && blank.length === 0) values.set(type, hull);
    else values.delete(type);
    return reduceTiers({ ...present, tiers, values });
}

/** Some modifier of the group is present: one of the group's types the item may
 *  carry, a disjunction when several may be. */
function refineHasGroup(a: AItem, types: ReadonlySet<TypeId>): AItem | null {
    const candidates = [...types].filter((t) => a.possible.has(t) && !isExcluded(a, t));
    if (candidates.length === 0) return null;
    if (candidates.some((t) => isGuaranteed(a, t))) return a;
    let some = a.bdd.FALSE;
    for (const t of candidates) some = a.bdd.or(some, a.bdd.variable(t));
    const presence = a.bdd.and(a.presence, some);
    if (a.bdd.isFalse(presence)) return null;
    const total: Range = [Math.max(1, a.counts.total[0]), a.counts.total[1]];
    const s = normalize({ ...a, presence, counts: { ...a.counts, total } });
    return s === null ? null : reduceTiers(s);
}

/** No modifier of the group is present: every type of it the item may carry is
 *  excluded, which is what lets a bench craft of the group through. */
function refineLacksGroup(a: AItem, types: ReadonlySet<TypeId>): AItem | null {
    let presence = a.presence;
    for (const t of types) {
        if (a.possible.has(t)) presence = a.bdd.and(presence, a.bdd.not(a.bdd.variable(t)));
    }
    if (a.bdd.isFalse(presence)) return null;
    return reduceTiers({ ...a, presence });
}

function refineLacks(a: AItem, type: TypeId, tierMod: ModId | undefined): AItem | null {
    if (tierMod !== undefined) {
        // "not has X t<n>": X may still be present at another tier. Record that
        // this specific tier is absent as a presence atom, that is what lets it
        // contradict a surviving tier-qualified disjunction (`X@t1 ∨ Y@t1`).
        const atom = a.bdd.variable(tierAtomName(type, tierMod));
        const presence = withTierFacts(a, a.bdd.and(a.presence, a.bdd.not(atom)), type);
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
        if (allowed === undefined) return reduceTiers({ ...a, presence }); // overlay unconstrained; keep the atom
        const narrowed = new Set(allowed);
        narrowed.delete(tierMod);
        if (narrowed.size === 0 && isGuaranteed(a, type)) return null; // present but only tier was M
        const tiers = new Map(a.tiers);
        if (narrowed.size === 0) tiers.delete(type);
        else tiers.set(type, narrowed);
        return reduceTiers({ ...a, presence, tiers });
    }

    // Force the presence variable false: a guaranteed type collapses the BDD to
    // FALSE (impossible); a disjunction that relied on it gets pruned, and with
    // the atom facts so does any tier atom of the type, which is what pins the
    // other member of a "one of these is T1" clause to its row.
    const presence = withTierFacts(a, a.bdd.and(a.presence, a.bdd.not(a.bdd.variable(type))), type);
    if (a.bdd.isFalse(presence)) return null; // known present → cannot lack it
    const tiers = new Map(a.tiers);
    tiers.delete(type); // absent ⇒ no tier info
    return reduceTiers({ ...a, presence, tiers });
}

/** Is `type` a fracture candidate — i.e. does its fracture atom exist? Only the
 *  declared/Orb assertions allocate one, so allocation ⇔ candidacy. */
function isFractureCandidate(a: AItem, type: TypeId): boolean {
    return a.bdd.variables().includes(fracAtomName(type));
}

/** Narrow to "X is a fractured mod". A non-candidate can never be fractured,
 *  so the branch is dead; otherwise assert the fracture atom (the at-most-n
 *  rule then limits the other candidates, and the `frac ⇒ present` coupling
 *  makes X present). */
function refineFractured(a: AItem, type: TypeId): AItem | null {
    if (!isFractureCandidate(a, type)) return null;
    const presence = a.bdd.and(a.presence, a.bdd.variable(fracAtomName(type)));
    if (a.bdd.isFalse(presence)) return null;
    return normalize({ ...a, presence });
}

/** Narrow to "X is not the fractured mod". A non-candidate is trivially not
 *  fractured; otherwise force the fracture atom false (a proven fracture on X
 *  makes this impossible). */
function refineNotFractured(a: AItem, type: TypeId): AItem | null {
    if (!isFractureCandidate(a, type)) return a;
    const presence = a.bdd.and(a.presence, a.bdd.not(a.bdd.variable(fracAtomName(type))));
    if (a.bdd.isFalse(presence)) return null;
    return normalize({ ...a, presence });
}

/** Assert a definite fracture on `type` (a declared fractured affix): a fracture
 *  exists, it is present, and it is the locked mod (the sole candidate). */
export function assertDeclaredFracture(bdd: BddManager, presence: Bdd, type: TypeId): Bdd {
    let p = bdd.and(presence, bdd.variable(FRAC_EXISTS));
    p = bdd.and(p, bdd.variable(type)); // present
    return bdd.and(p, bdd.variable(fracAtomName(type))); // fractured
}

/**
 * Assert a fracture of `n` modifiers: a fracture exists and at most `n` of
 * `candidates` are it (each implying its mod present), and at least `atLeast`
 * of them, the locks the anonymous mods cannot account for, which lets a branch
 * chain over the named mods prove where they landed. The candidate sets are
 * small (an item's few modifiers), so the cardinality constraints enumerate
 * subsets.
 */
export function assertFractureDisjunction(
    bdd: BddManager,
    presence: Bdd,
    candidates: readonly TypeId[],
    n = 1,
    atLeast = 0,
): Bdd {
    let p = bdd.and(presence, bdd.variable(FRAC_EXISTS));
    const fracOf = (t: TypeId): Bdd => bdd.variable(fracAtomName(t));
    // Each candidate: frac ⇒ present.
    for (const c of candidates) p = bdd.and(p, bdd.or(bdd.not(fracOf(c)), bdd.variable(c)));
    // At most n fractured: no n+1 of them together.
    for (const group of combinations(candidates, n + 1)) {
        let all = bdd.TRUE;
        for (const c of group) all = bdd.and(all, fracOf(c));
        p = bdd.and(p, bdd.not(all));
    }
    // The locks the anonymous mods cannot account for are among the candidates.
    if (atLeast > 0 && candidates.length >= atLeast) {
        let some = bdd.FALSE;
        for (const group of combinations(candidates, atLeast)) {
            let all = bdd.TRUE;
            for (const c of group) all = bdd.and(all, fracOf(c));
            some = bdd.or(some, all);
        }
        p = bdd.and(p, bdd.or(bdd.not(bdd.variable(FRAC_EXISTS)), some));
    }
    return p;
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
