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
    BenchStmt,
    EssenceStmt,
    FracturedPred,
    HarvestStmt,
    OpStmt,
    UnveilStmt,
    VeiledStmt,
    ParamRef,
    Pred,
    ProcDef,
    RarityPred,
    RestartStmt,
    SourceSpan,
    Stmt,
    UntilStmt,
    WithOmenStmt,
} from "../ast/index.js";
import type { Cmp } from "../ast/ast.js";
import type { Game, Rarity } from "../model/ids.js";

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
    readonly augments?: readonly string[];
    readonly quality?: number;
}

const affix = (a: AffixSpec): AffixDecl => (typeof a === "string" ? { mod: a } : a);

export const craft = (
    game: Game,
    item: ItemBlock,
    body: readonly Stmt[],
    defs: readonly Def[] = [],
    procs: readonly ProcDef[] = [],
): Craft => ({
    kind: "craft",
    game,
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
    augments: spec.augments ?? [],
    quality: spec.quality ?? 0,
    span: DS,
});

export const op = (name: string): OpStmt => ({ kind: "op", name, span: DS });
export const essence = (name: string | ParamRef, tier?: number | ParamRef): EssenceStmt => ({
    kind: "essence",
    name,
    ...(tier !== undefined && { tier }),
    span: DS,
});
export const bench = (name: string | ParamRef, tier?: number | ParamRef): BenchStmt => ({
    kind: "bench",
    name,
    ...(tier !== undefined && { tier }),
    span: DS,
});
export const harvest = (verb: "reforge" | "augment", tag: string | ParamRef): HarvestStmt => ({
    kind: "harvest",
    verb,
    tag,
    span: DS,
});
export const veiled = (verb: "chaos" | "exalt"): VeiledStmt => ({ kind: "veiled", verb, span: DS });
export const unveil = (mod?: string | ParamRef): UnveilStmt => ({
    kind: "unveil",
    ...(mod !== undefined && { mod }),
    span: DS,
});
export const restart = (): RestartStmt => ({ kind: "restart", span: DS });
export const until = (pred: Pred, body: readonly Stmt[]): UntilStmt => ({
    kind: "until",
    pred,
    body,
    span: DS,
});
export const withOmen = (omen: string, body: readonly Stmt[]): WithOmenStmt => ({
    kind: "withOmen",
    omen,
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
