/**
 * Tiny AST builders for checker tests.
 *
 * The checker consumes a `Craft` AST, not source text — and core cannot depend
 * on @hinekora/parser (the one-way arrow). So instead of parsing, tests build
 * ASTs directly with these terse constructors. Every node gets the same dummy
 * span (the checker's logic doesn't depend on span values, only carries them).
 */
import type {
    AffixDecl,
    Arg,
    CallPred,
    CallStmt,
    ComparePred,
    Craft,
    BinaryPred,
    Def,
    HasPred,
    IfStmt,
    ItemBlock,
    NotPred,
    FracturedPred,
    OperationArg,
    OperationStmt,
    ParamRef,
    Pred,
    ProcDef,
    RarityPred,
    RestartStmt,
    SourceSpan,
    Stmt,
    UntilStmt,
} from "../ast/index.js";
import type { Cmp } from "../ast/ast.js";
import type { Rarity } from "../model/ids.js";

const DS: SourceSpan = {
    start: { offset: 0, line: 1, column: 1 },
    end: { offset: 0, line: 1, column: 1 },
};

/** A test affix: a bare mod id/alias (tier pinned by the id) or `{ mod, tier }`. */
type AffixSpec = string | AffixDecl;

interface ItemSpec {
    readonly base: string;
    readonly ilvl: number;
    readonly rarity: Rarity;
    readonly prefixes?: readonly AffixSpec[];
    readonly suffixes?: readonly AffixSpec[];
}

const affix = (a: AffixSpec): AffixDecl => (typeof a === "string" ? { mod: a } : a);

export const craft = (
    item: ItemBlock,
    body: readonly Stmt[],
    defs: readonly Def[] = [],
    procs: readonly ProcDef[] = [],
): Craft => ({
    kind: "craft",
    item,
    defs,
    procs,
    body,
    span: DS,
});

export const item = (spec: ItemSpec): ItemBlock => ({
    kind: "itemBlock",
    base: spec.base,
    ilvl: spec.ilvl,
    rarity: spec.rarity,
    prefixes: (spec.prefixes ?? []).map(affix),
    suffixes: (spec.suffixes ?? []).map(affix),
    span: DS,
});

// --- operation statements: a method's words and its arguments -------------

/** A quoted-name slot's argument: the name, or a proc param standing in for it. */
const named = (v: string | ParamRef): OperationArg =>
    typeof v === "string"
        ? { kind: "string", value: v, span: DS }
        : { kind: "param", param: v.param, span: DS };
/** A tier slot's argument: the tier, or a proc param standing in for it. */
const tiered = (v: number | ParamRef): OperationArg =>
    typeof v === "number"
        ? { kind: "tier", value: v, span: DS }
        : { kind: "param", param: v.param, span: DS };
const operation = (
    words: readonly string[],
    args: readonly OperationArg[] = [],
): OperationStmt => ({
    kind: "operation",
    words,
    args,
    span: DS,
});

/** A bare currency: `chaos`, `exalt`, … */
export const op = (name: string): OperationStmt => operation([name]);
export const essence = (name: string | ParamRef, tier?: number | ParamRef): OperationStmt =>
    operation(["essence"], tier === undefined ? [named(name)] : [named(name), tiered(tier)]);
export const bench = (name: string | ParamRef, tier?: number | ParamRef): OperationStmt =>
    operation(["bench"], tier === undefined ? [named(name)] : [named(name), tiered(tier)]);
export const harvest = (verb: "reforge" | "augment", tag: string | ParamRef): OperationStmt =>
    operation(["harvest", verb], [named(tag)]);
export const benchRemove = (): OperationStmt => operation(["bench", "remove"]);
export const restore = (): OperationStmt => operation(["restore"]);
export const fossil = (...names: (string | ParamRef)[]): OperationStmt =>
    operation(["fossil"], names.map(named));
export const harvestChange = (from: string | ParamRef, to: string | ParamRef): OperationStmt =>
    operation(["harvest", "change"], [named(from), named(to)]);
export const veiled = (verb: "chaos" | "exalt"): OperationStmt => operation(["veiled", verb]);
export const foulborn = (verb: "augment" | "regal" | "exalt"): OperationStmt =>
    operation(["foulborn", verb]);
export const unveil = (mod?: string | ParamRef): OperationStmt =>
    operation(["unveil"], mod === undefined ? [] : [named(mod)]);

/** A Bestiary recipe: `beast add prefix 84`, `beast fracture`, `beast aspect "cat"`, … */
type BeastAction =
    | { readonly kind: "add"; readonly side: "prefix" | "suffix"; readonly level?: number }
    | { readonly kind: "fracture" }
    | { readonly kind: "metamod" }
    | { readonly kind: "aspect"; readonly name: string | ParamRef }
    | { readonly kind: "imprint" };
export const beast = (action: BeastAction): OperationStmt => {
    switch (action.kind) {
        case "add": {
            const side: OperationArg = { kind: "word", value: action.side, span: DS };
            return operation(
                ["beast", "add"],
                action.level === undefined
                    ? [side]
                    : [side, { kind: "int", value: action.level, span: DS }],
            );
        }
        case "aspect":
            return operation(["beast", "aspect"], [named(action.name)]);
        default:
            return operation(["beast", action.kind]);
    }
};
export const restart = (): RestartStmt => ({ kind: "restart", span: DS });
export const until = (pred: Pred, body: readonly Stmt[]): UntilStmt => ({
    kind: "until",
    pred,
    body,
    span: DS,
});
export const iff = (pred: Pred, body: readonly Stmt[], elseBody?: readonly Stmt[]): IfStmt => ({
    kind: "if",
    pred,
    body,
    ...(elseBody !== undefined && { elseBody }),
    span: DS,
});

// predicates
export const isRarity = (rarity: Rarity): RarityPred => ({ kind: "isRarity", rarity, span: DS });
export const has = (mod: string, tier?: number): HasPred => ({
    kind: "has",
    mod,
    ...(tier !== undefined && { tier }),
    span: DS,
});
export const fracturedP = (mod: string | ParamRef): FracturedPred => ({
    kind: "fractured",
    mod,
    span: DS,
});
export const cmp = (
    projection: "prefixCount" | "suffixCount",
    op: Cmp,
    value: number,
): ComparePred => ({ kind: "compare", projection, op, value, span: DS });
export const notp = (inner: Pred): NotPred => ({ kind: "not", inner, span: DS });
export const andp = (left: Pred, right: Pred): BinaryPred => ({
    kind: "and",
    left,
    right,
    span: DS,
});
export const orp = (left: Pred, right: Pred): BinaryPred => ({ kind: "or", left, right, span: DS });

// predicate defs
export const param = (name: string): ParamRef => ({ param: name, span: DS });
/** A `has` with a param in the tier and/or mod slot (for building def bodies). */
export const hasP = (mod: string | ParamRef, tier?: number | ParamRef): HasPred => ({
    kind: "has",
    mod,
    ...(tier !== undefined && { tier }),
    span: DS,
});
export const def = (name: string, params: readonly string[], body: Pred): Def => ({
    kind: "def",
    name,
    params,
    body,
    span: DS,
});
/** An operation function (`def name(params) { body }`). */
export const procDef = (
    name: string,
    params: readonly string[],
    body: readonly Stmt[],
): ProcDef => ({
    kind: "procDef",
    name,
    params,
    body,
    span: DS,
});
/** A tier argument (`t1`) — a distinct sort from a bare-int count. */
export const tierArg = (value: number): Arg => ({ kind: "tier", value, span: DS });
const toArg = (v: number | string | ParamRef | Arg): Arg =>
    typeof v === "number"
        ? { kind: "int", value: v, span: DS }
        : typeof v === "string"
          ? { kind: "string", value: v, span: DS }
          : "kind" in v // already an Arg (e.g. tierArg)
            ? v
            : { kind: "param", param: v.param, span: DS };
export const arg = toArg;
export const call = (
    name: string,
    args: readonly (number | string | ParamRef | Arg)[] = [],
): CallPred => ({
    kind: "call",
    name,
    args: args.map(toArg),
    span: DS,
});
/** A call to an operation function, in statement position. */
export const callStmt = (
    name: string,
    args: readonly (number | string | ParamRef | Arg)[] = [],
): CallStmt => ({
    kind: "call",
    name,
    args: args.map(toArg),
    span: DS,
});
