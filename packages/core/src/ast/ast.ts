/**
 * The surface AST, the contract between parser and checker. It lives in core
 * so the checker doesn't depend on the parser. Deliberately shallow: it mirrors
 * the surface syntax and does no resolution or lowering; names stay raw
 * strings, keeping the parser a pure syntax-to-tree transform.
 */
import type { Rarity } from "../model/ids.js";
import type { EldritchSide, EldritchTierName, Influence } from "../model/marks.js";
import type { SourceSpan } from "./span.js";

/** A whole craft file: an item block, then a body. */
export interface Craft {
    readonly kind: "craft";
    readonly item: ItemBlock;
    /** Local predicate definitions (`def name(p) = <pred>`), usable in any predicate. */
    readonly defs: readonly Def[];
    /** Local operation functions (`def name(p) { <stmts> }`), callable as a step. */
    readonly procs: readonly ProcDef[];
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

/**
 * A local operation function: `def spam(m) { until has m { scour; alchemy } }`.
 * Its body is a statement block that mutates the item; a call inlines the body
 * with arguments substituted for parameters. Same `def` keyword as a predicate
 * `Def`, distinguished at parse time by a `{ … }` body instead of `= <pred>`.
 * Parameter sorts are inferred from use, exactly as for a predicate `Def`.
 */
export interface ProcDef {
    readonly kind: "procDef";
    readonly name: string;
    readonly params: readonly string[];
    readonly body: readonly Stmt[];
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
    /** Marked `fractured` — the mod is locked (can't be removed or rerolled). */
    readonly fractured?: boolean;
}

/** The item declaration, the only place state is given rather than inferred. */
export interface ItemBlock {
    readonly kind: "itemBlock";
    readonly base: string;
    readonly ilvl: number;
    readonly rarity: Rarity;
    readonly prefixes: readonly AffixDecl[];
    readonly suffixes: readonly AffixDecl[];
    /** `influences: hunter` or `influences: shaper elder`; none when absent. */
    readonly influences: readonly Influence[];
    /** The bare `corrupted` flag. */
    readonly corrupted: boolean;
    /** `exarch: grand` and `eater: lesser "<wording>"`, the eldritch implicits. */
    readonly exarch?: EldritchDecl;
    readonly eater?: EldritchDecl;
    readonly span: SourceSpan;
}

/** A declared eldritch implicit: its tier, and its wording when known. */
export interface EldritchDecl {
    readonly tier: EldritchTierName;
    readonly text?: string;
}

// --- Statements (surface §3–§4) -------------------------------------------

export type Stmt = OperationStmt | RestartStmt | UntilStmt | IfStmt | CallStmt;

/**
 * A crafting method applied to the item: the words that name it (`chaos`,
 * `beast add`, `harvest change`) and its arguments as parsed, the shape the
 * method's slots give them (`check/methods.ts`). Inside a proc body an argument
 * may be a parameter. Resolution and semantics are the checker's job.
 */
export interface OperationStmt {
    readonly kind: "operation";
    readonly words: readonly string[];
    readonly args: readonly OperationArg[];
    readonly span: SourceSpan;
}

/** An operation's argument: a literal of the slot's kind, or a proc parameter. */
export type OperationArg =
    | { readonly kind: "tier"; readonly value: number; readonly span: SourceSpan }
    | { readonly kind: "int"; readonly value: number; readonly span: SourceSpan }
    | { readonly kind: "string"; readonly value: string; readonly span: SourceSpan }
    | { readonly kind: "word"; readonly value: string; readonly span: SourceSpan }
    | { readonly kind: "param"; readonly param: string; readonly span: SourceSpan };

/** `name(arg, …)`, a call to a local op function, in statement position. */
export interface CallStmt {
    readonly kind: "call";
    readonly name: string;
    readonly args: readonly Arg[];
    readonly span: SourceSpan;
}

/** `restart`, re-enter the enclosing craft/loop from its start. */
export interface RestartStmt {
    readonly kind: "restart";
    readonly span: SourceSpan;
}

/** `until <pred> { … }`, loop; on exit the predicate is known to hold. */
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

// --- Predicates (surface §5) ----------------------------------------------

export type Pred =
    | RarityPred
    | HasPred
    | FracturedPred
    | InfluencedPred
    | CorruptedPred
    | EldritchPred
    | DominantPred
    | ComparePred
    | NotPred
    | BinaryPred
    | CallPred;

/** `influenced` (any influence) or `influenced hunter` (that one). */
export interface InfluencedPred {
    readonly kind: "influenced";
    readonly influence?: Influence;
    readonly span: SourceSpan;
}

/** `corrupted`, whether the item is corrupted. */
export interface CorruptedPred {
    readonly kind: "corrupted";
    readonly span: SourceSpan;
}

/** `exarch` or `eater` (that implicit is present), `exarch grand` (at that tier),
 *  `exarch "<wording>"` (that implicit), in any combination. */
export interface EldritchPred {
    readonly kind: "eldritch";
    readonly side: EldritchSide;
    readonly tier?: EldritchTierName;
    readonly text?: string;
    readonly span: SourceSpan;
}

/** `dominant exarch` / `dominant eater`: that implicit's tier is the higher. */
export interface DominantPred {
    readonly kind: "dominant";
    readonly side: EldritchSide;
    readonly span: SourceSpan;
}

/** Comparison operators for count projections. */
export type Cmp = "==" | "!=" | "<" | "<=" | ">" | ">=";

/** `isRare` / `isMagic` / `isNormal`, niladic rarity check. */
export interface RarityPred {
    readonly kind: "isRarity";
    readonly rarity: Rarity;
    readonly span: SourceSpan;
}

/**
 * `has "<mod>"`, presence of a mod, matched fuzzily to a ModType. An optional
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

/**
 * `fractured "<mod>"`, whether that mod is the item's fractured (locked) one.
 * Used to prove which mod a Fracturing Orb locked (the target is random until a
 * branch narrows it).
 */
export interface FracturedPred {
    readonly kind: "fractured";
    readonly mod: string | ParamRef;
    readonly span: SourceSpan;
}

/** `<prefixCount|suffixCount> <cmp> <int>`, a relational count check. */
export interface ComparePred {
    readonly kind: "compare";
    readonly projection: "prefixCount" | "suffixCount";
    readonly op: Cmp;
    readonly value: number | ParamRef;
    readonly span: SourceSpan;
}

/** `name(arg, …)`, a call to a local def, in predicate position. */
export interface CallPred {
    readonly kind: "call";
    readonly name: string;
    readonly args: readonly Arg[];
    readonly span: SourceSpan;
}

/** `not <pred>`, the single, general negation. */
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
