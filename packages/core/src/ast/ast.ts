/**
 * The surface AST — the contract between parser and checker. It lives in core
 * so the checker doesn't depend on the parser. Deliberately shallow: it mirrors
 * the surface syntax and does no resolution or lowering; names stay raw
 * strings, keeping the parser a pure syntax-to-tree transform.
 */
import type { Game, Rarity } from "../model/ids.js";
import type { SourceSpan } from "./span.js";

/** A whole craft file: `craft in <game>` header, an item block, then a body. */
export interface Craft {
    readonly kind: "craft";
    readonly game: Game;
    readonly item: ItemBlock;
    /** Local predicate definitions (`def name(p) = <pred>`), usable in any predicate. */
    readonly defs: readonly Def[];
    readonly body: readonly Stmt[];
    readonly span: SourceSpan;
}

/**
 * A local, parameterized predicate definition: `def anyEleRes(t) = has … t or …`.
 * Pure; a call substitutes arguments into `body`. Parameter sorts are inferred
 * from use (see the checker).
 */
export interface Def {
    readonly kind: "def";
    readonly name: string;
    readonly params: readonly string[];
    readonly body: Pred;
    readonly span: SourceSpan;
}

/** A reference to a def parameter, appearing in a value slot of the def body. */
export interface ParamRef {
    readonly param: string;
    readonly span: SourceSpan;
}

/**
 * An argument to a def call. A `tier` (`t1`) is a distinct sort from an `int`
 * count; `param` is a parameter forwarded to a nested call (`def a(t) = b(t)`).
 */
export type Arg =
    | { readonly kind: "tier"; readonly value: number; readonly span: SourceSpan }
    | { readonly kind: "int"; readonly value: number; readonly span: SourceSpan }
    | { readonly kind: "string"; readonly value: string; readonly span: SourceSpan }
    | { readonly kind: "param"; readonly param: string; readonly span: SourceSpan };

/**
 * A declared affix in the item block: a named modifier with its tier
 * (`"maximum life" t1`), or a `"random"`/`"?"` placeholder (no tier). A named
 * mod must pin a specific tier so the starting item is concrete.
 */
export interface AffixDecl {
    readonly mod: string;
    readonly tier?: number;
}

/**
 * The item declaration — the only place state is given rather than inferred.
 * Optional fields default: `augments` to none, `quality` to 0.
 */
export interface ItemBlock {
    readonly kind: "itemBlock";
    readonly base: string;
    readonly ilvl: number;
    readonly rarity: Rarity;
    readonly prefixes: readonly AffixDecl[];
    readonly suffixes: readonly AffixDecl[];
    readonly augments: readonly string[];
    readonly quality: number;
    readonly span: SourceSpan;
}

// --- Statements (surface §3–§4) -------------------------------------------

export type Stmt =
    OpStmt | EssenceStmt | BenchStmt | RestartStmt | UntilStmt | IfStmt | WithOmenStmt;

/** A currency/operation line — a single (still-unresolved) currency name. */
export interface OpStmt {
    readonly kind: "op";
    readonly name: string;
    readonly span: SourceSpan;
}

/**
 * `essence "<name>" [t1]` — apply an essence. `name` is a full name
 * ("Deafening Essence of Greed") or, with a `tier`, an essence type ("greed",
 * `t1` = best). Resolution and semantics are the checker's job.
 */
export interface EssenceStmt {
    readonly kind: "essence";
    readonly name: string;
    readonly tier?: number;
    readonly span: SourceSpan;
}

/**
 * `bench "<mod>" [t1]` — add a specific crafting-bench mod. `name` is a mod
 * description ("increased life"); an optional `tier` picks the bench tier
 * (`t1` = best). Resolution (to a `BenchCraft`) and semantics are the checker's.
 */
export interface BenchStmt {
    readonly kind: "bench";
    readonly name: string;
    readonly tier?: number;
    readonly span: SourceSpan;
}

/** `restart` — re-enter the enclosing craft/loop from its start. */
export interface RestartStmt {
    readonly kind: "restart";
    readonly span: SourceSpan;
}

/** `until <pred> { … }` — loop; on exit the predicate is known to hold. */
export interface UntilStmt {
    readonly kind: "until";
    readonly pred: Pred;
    readonly body: readonly Stmt[];
    readonly span: SourceSpan;
}

/** `if <pred> { … }` with an optional `else { … }`. */
export interface IfStmt {
    readonly kind: "if";
    readonly pred: Pred;
    readonly body: readonly Stmt[];
    readonly elseBody?: readonly Stmt[];
    readonly span: SourceSpan;
}

/** `with omen "<name>" { … }` — omen-directed scope. */
export interface WithOmenStmt {
    readonly kind: "withOmen";
    readonly omen: string;
    readonly body: readonly Stmt[];
    readonly span: SourceSpan;
}

// --- Predicates (surface §5) ----------------------------------------------

export type Pred = RarityPred | HasPred | ComparePred | NotPred | BinaryPred | CallPred;

/** Comparison operators for count projections. */
export type Cmp = "==" | "!=" | "<" | "<=" | ">" | ">=";

/** `isRare` / `isMagic` / `isNormal` — niladic rarity check. */
export interface RarityPred {
    readonly kind: "isRarity";
    readonly rarity: Rarity;
    readonly span: SourceSpan;
}

/**
 * `has "<mod>"` — presence of a mod, matched fuzzily to a ModType. An optional
 * `t<n>` qualifier (T1 = best) narrows to a specific tier; without it, any
 * tier counts.
 */
export interface HasPred {
    readonly kind: "has";
    /** A mod description, or (inside a def body) a parameter standing in for one. */
    readonly mod: string | ParamRef;
    readonly tier?: number | ParamRef;
    readonly span: SourceSpan;
}

/** `<prefixCount|suffixCount> <cmp> <int>` — a relational count check. */
export interface ComparePred {
    readonly kind: "compare";
    readonly projection: "prefixCount" | "suffixCount";
    readonly op: Cmp;
    readonly value: number | ParamRef;
    readonly span: SourceSpan;
}

/** `name(arg, …)` — a call to a local def, in predicate position. */
export interface CallPred {
    readonly kind: "call";
    readonly name: string;
    readonly args: readonly Arg[];
    readonly span: SourceSpan;
}

/** `not <pred>` — the single, general negation. */
export interface NotPred {
    readonly kind: "not";
    readonly inner: Pred;
    readonly span: SourceSpan;
}

/** `<pred> and <pred>` / `<pred> or <pred>`. `or` binds looser than `and`. */
export interface BinaryPred {
    readonly kind: "and" | "or";
    readonly left: Pred;
    readonly right: Pred;
    readonly span: SourceSpan;
}
