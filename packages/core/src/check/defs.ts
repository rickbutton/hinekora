/**
 * A craft's definitions: its predicate defs and operation functions, the sort
 * of each parameter as its uses determine it, the binding of a call's
 * arguments, and the substitution that inlines a call. Read the same way by
 * the present checker and the exact one.
 */
import type { Arg, Def, OperationArg, ParamRef, Pred, ProcDef, Stmt } from "../ast/ast.js";
import type { SourceSpan } from "../ast/span.js";
import { plural } from "../words.js";
import { findMethod, type Method, slotAt } from "./methods.js";

/** Where a definition's errors go. */
export type Diag = (message: string, span: SourceSpan) => void;

/** A predicate def with its parameters' sorts; `valid: false` marks an
 *  ill-formed one whose calls are dropped without cascading errors. */
export interface DefEntry {
    readonly def: Def;
    readonly paramTypes: ReadonlyMap<string, ParamType>;
    readonly valid: boolean;
}

/** An operation function, as `DefEntry`. */
export interface ProcEntry {
    readonly proc: ProcDef;
    readonly paramTypes: ReadonlyMap<string, ParamType>;
    readonly valid: boolean;
}

/** The predicate defs a condition may call, and the names of the operation
 *  functions, which a condition may not. */
export interface PredDefs {
    readonly defs: ReadonlyMap<string, DefEntry>;
    readonly procs: { has(name: string): boolean };
}

/** The predicate defs, each checked for repeated names and for parameters
 *  used in conflicting ways or not at all. */
export function collectDefs(
    defs: readonly Def[],
    diag: Diag,
    into = new Map<string, DefEntry>(),
): Map<string, DefEntry> {
    for (const def of defs) {
        if (into.has(def.name)) {
            diag(`duplicate def "${def.name}"`, def.span);
            continue;
        }
        const { types, conflicts, used } = inferParamTypes(def);
        for (const c of conflicts) {
            const ways = c.sorts.map((s) => SORT_LABEL[s]).join(" and as ");
            diag(
                `parameter "${c.param}" of "${def.name}" is used in conflicting ways (as ${ways})`,
                def.span,
            );
        }
        for (const p of def.params) {
            if (!used.has(p)) diag(`parameter "${p}" of "${def.name}" is never used`, def.span);
        }
        into.set(def.name, { def, paramTypes: types, valid: conflicts.length === 0 });
    }
    return into;
}

/** The operation functions, as `collectDefs`; they share the name space with
 *  the predicate defs, a name can't be both. */
export function collectProcs(
    procs: readonly ProcDef[],
    defs: ReadonlyMap<string, DefEntry>,
    diag: Diag,
    into = new Map<string, ProcEntry>(),
): Map<string, ProcEntry> {
    for (const proc of procs) {
        if (defs.has(proc.name) || into.has(proc.name)) {
            diag(`duplicate def "${proc.name}"`, proc.span);
            continue;
        }
        const { types, conflicts, used } = inferProcParamTypes(proc);
        for (const c of conflicts) {
            const ways = c.sorts.map((s) => SORT_LABEL[s]).join(" and as ");
            diag(
                `parameter "${c.param}" of "${proc.name}" is used in conflicting ways (as ${ways})`,
                proc.span,
            );
        }
        for (const p of proc.params) {
            if (!used.has(p)) diag(`parameter "${p}" of "${proc.name}" is never used`, proc.span);
        }
        into.set(proc.name, { proc, paramTypes: types, valid: conflicts.length === 0 });
    }
    // Recursion is decided on the definitions, not while inlining: a step
    // argument may legitimately call the very proc it is passed to
    // (`twice(twice({ chaos }))`), which an expansion-time guard would refuse.
    for (const name of recursiveProcs(into)) {
        const entry = into.get(name)!;
        diag(`recursive def "${name}" is not allowed`, entry.proc.span);
        into.set(name, { ...entry, valid: false });
    }
    return into;
}

/** Bind call arguments to parameters, checking arity and each arg's sort.
 *  Returns the environment, or `null` if any check failed (already reported). */
export function bindArgs(
    callName: string,
    params: readonly string[],
    paramTypes: ReadonlyMap<string, ParamType>,
    args: readonly Arg[],
    span: SourceSpan,
    diag: Diag,
): Map<string, Arg> | null {
    if (args.length !== params.length) {
        const n = params.length;
        diag(`"${callName}" expects ${n} ${plural(n, "argument")}, got ${args.length}`, span);
        return null;
    }
    const env = new Map<string, Arg>();
    let bad = false;
    params.forEach((p, i) => {
        const arg = args[i]!;
        const want = paramTypes.get(p);
        // A param with no inferred sort is a pass-through: any arg kind is
        // accepted here and re-checked at the callee.
        if (want !== undefined && arg.kind !== WANT_KIND[want]) {
            diag(`argument ${i + 1} of "${callName}" should be ${WANT_LABEL[want]}`, arg.span);
            bad = true;
        }
        env.set(p, arg);
    });
    return bad ? null : env;
}

// --- parameter sorts --------------------------------------------------------

/**
 * The sort of a def parameter, four distinct kinds even though a tier and a
 * count are both written with digits: a `tier` (t1) indexes a mod's tier
 * ladder, a `count` is a number of affixes, a `mod` is a stat description, a
 * `block` is one or more steps run where the parameter stands.
 */
export type ParamType = "tier" | "count" | "mod" | "block";

const SORT_LABEL: Record<ParamType, string> = {
    tier: "a tier",
    count: "a count",
    mod: "a mod name",
    block: "a step",
};

/** The one argument kind each sort accepts (a pass-through param has no sort and
 *  accepts any kind, re-checked at the callee). */
const WANT_KIND: Record<ParamType, Arg["kind"]> = {
    tier: "tier",
    count: "int",
    mod: "string",
    block: "block",
};
const WANT_LABEL: Record<ParamType, string> = {
    tier: "a tier (t1)",
    count: "a number",
    mod: "a quoted mod name",
    block: "a step or a { … } block of steps",
};

/** The procs a statement list calls, directly or inside a step argument. */
function calledProcs(stmts: readonly Stmt[], out = new Set<string>()): Set<string> {
    for (const s of stmts) {
        switch (s.kind) {
            case "call":
                out.add(s.name);
                for (const arg of s.args) if (arg.kind === "block") calledProcs(arg.body, out);
                break;
            case "until":
                calledProcs(s.body, out);
                break;
            case "if":
                calledProcs(s.body, out);
                if (s.elseBody !== undefined) calledProcs(s.elseBody, out);
                break;
            case "operation":
            case "restart":
            case "stop":
            case "paramStep":
                break;
        }
    }
    return out;
}

/** The procs that can reach themselves through the call graph of their bodies.
 *  Decided on the bodies as written, not while inlining, so steps passed as an
 *  argument may call the proc they are passed to. */
function recursiveProcs(procs: ReadonlyMap<string, { proc: ProcDef }>): string[] {
    const calls = new Map<string, Set<string>>();
    for (const [name, { proc }] of procs) calls.set(name, calledProcs(proc.body));
    const reaches = (from: string, target: string, seen: Set<string>): boolean => {
        for (const next of calls.get(from) ?? []) {
            if (next === target) return true;
            if (seen.has(next)) continue;
            seen.add(next);
            if (reaches(next, target, seen)) return true;
        }
        return false;
    };
    return [...calls.keys()].filter((name) => reaches(name, name, new Set([name])));
}

/** Accumulates where each parameter is used, so its sort can be inferred (uses at
 *  two different sorts conflict) and an unused one flagged. */
interface ParamUses {
    readonly params: Set<string>;
    readonly sorts: Map<string, Set<ParamType>>;
    readonly used: Set<string>;
}

function noteSort(u: ParamUses, ref: ParamRef, ty: ParamType): void {
    if (!u.params.has(ref.param)) return;
    u.used.add(ref.param);
    const seen = u.sorts.get(ref.param) ?? new Set<ParamType>();
    seen.add(ty);
    u.sorts.set(ref.param, seen);
}

/** A pass-through arg counts as a use but adds no local sort constraint (its sort
 *  is enforced at the callee). */
function markUsed(u: ParamUses, param: string): void {
    if (u.params.has(param)) u.used.add(param);
}

function notePredUses(u: ParamUses, p: Pred): void {
    switch (p.kind) {
        case "has":
            if (typeof p.mod === "object") noteSort(u, p.mod, "mod");
            if (p.tier !== undefined && typeof p.tier === "object") noteSort(u, p.tier, "tier");
            return;
        case "fractured":
            if (typeof p.mod === "object") noteSort(u, p.mod, "mod");
            return;
        case "compare":
            if (typeof p.value === "object") noteSort(u, p.value, "count");
            return;
        case "not":
            notePredUses(u, p.inner);
            return;
        case "and":
        case "or":
            notePredUses(u, p.left);
            notePredUses(u, p.right);
            return;
        case "call":
            noteArgUses(u, p.args);
            return;
        case "isRarity":
        case "influenced":
        case "corrupted":
        case "eldritch":
        case "dominant":
            return;
    }
}

/** The sort a parameter takes from the slot it fills: every quoted name is a
 *  mod-name sort, a tier a tier, an integer a count. */
function slotSort(method: Method | undefined, i: number): ParamType | undefined {
    const slot = method === undefined ? undefined : slotAt(method, i);
    switch (slot?.kind) {
        case "name":
        case "names":
            return "mod";
        case "tier":
            return "tier";
        case "int":
            return "count";
        default:
            return undefined;
    }
}

/** A pass-through arg counts as a use; the steps of a block arg are walked like
 *  any other statements, since they may use the enclosing def's params. */
function noteArgUses(u: ParamUses, args: readonly Arg[]): void {
    for (const arg of args) {
        if (arg.kind === "param") markUsed(u, arg.param);
        else if (arg.kind === "block") for (const s of arg.body) noteStmtUses(u, s);
    }
}

function noteStmtUses(u: ParamUses, s: Stmt): void {
    switch (s.kind) {
        case "restart":
        case "stop":
            return;
        case "paramStep":
            noteSort(u, { param: s.param, span: s.span }, "block");
            return;
        case "operation": {
            const method = findMethod(s.words);
            s.args.forEach((arg, i) => {
                if (arg.kind !== "param") return;
                const sort = slotSort(method, i);
                if (sort !== undefined) noteSort(u, arg, sort);
            });
            return;
        }
        case "until":
            notePredUses(u, s.pred);
            for (const b of s.body) noteStmtUses(u, b);
            return;
        case "if":
            notePredUses(u, s.pred);
            for (const b of s.body) noteStmtUses(u, b);
            if (s.elseBody !== undefined) for (const b of s.elseBody) noteStmtUses(u, b);
            return;
        case "call":
            noteArgUses(u, s.args);
            return;
    }
}

/** Resolve accumulated uses into inferred sorts: exactly one sort is well-typed,
 *  more than one is a conflict. */
function finishUses(u: ParamUses): {
    types: Map<string, ParamType>;
    conflicts: { param: string; sorts: ParamType[] }[];
    used: Set<string>;
} {
    const types = new Map<string, ParamType>();
    const conflicts: { param: string; sorts: ParamType[] }[] = [];
    for (const [param, seen] of u.sorts) {
        if (seen.size === 1) types.set(param, [...seen][0]!);
        else conflicts.push({ param, sorts: [...seen] });
    }
    return { types, conflicts, used: u.used };
}

function inferParamTypes(def: Def): ReturnType<typeof finishUses> {
    const u: ParamUses = { params: new Set(def.params), sorts: new Map(), used: new Set() };
    notePredUses(u, def.body);
    return finishUses(u);
}

function inferProcParamTypes(proc: ProcDef): ReturnType<typeof finishUses> {
    const u: ParamUses = { params: new Set(proc.params), sorts: new Map(), used: new Set() };
    for (const s of proc.body) noteStmtUses(u, s);
    return finishUses(u);
}

/** What a def's parameter stands for, in the guide's words, for the editor. */
export const PARAM_SORT_WORD: Record<ParamType, string> = {
    tier: "tier",
    count: "count",
    mod: "mod",
    block: "steps",
};

/**
 * The sort of each parameter of a def as its uses determine it; a parameter
 * used in conflicting ways, or only forwarded to another def, has none.
 */
export function paramSorts(d: Def | ProcDef): ReadonlyMap<string, ParamType> {
    return (d.kind === "def" ? inferParamTypes(d) : inferProcParamTypes(d)).types;
}

/** Substitute a bound value into a `mod`/`tier`/`count` slot. Bound to a literal
 *  ⇒ its value; unbound (or a not-yet-resolved pass-through param) ⇒ the ref,
 *  caught downstream. */
function subValue<T extends string | number>(
    v: T | ParamRef,
    env: ReadonlyMap<string, Arg>,
): T | ParamRef {
    if (typeof v !== "object") return v;
    const arg = env.get(v.param);
    if (arg && (arg.kind === "tier" || arg.kind === "int" || arg.kind === "string")) {
        return arg.value as T;
    }
    return v;
}

/** A pass-through param arg (`… b(t) …` called with `t` bound) is replaced by the
 *  value bound here; a block arg has the enclosing def's params substituted into
 *  its steps; other args pass unchanged. */
function subArgs(args: readonly Arg[], env: ReadonlyMap<string, Arg>): Arg[] {
    return args.map((arg) =>
        arg.kind === "param"
            ? (env.get(arg.param) ?? arg)
            : arg.kind === "block"
              ? { ...arg, body: substituteStmts(arg.body, env) }
              : arg,
    );
}

export function substitute(pred: Pred, env: ReadonlyMap<string, Arg>): Pred {
    switch (pred.kind) {
        case "isRarity":
        case "influenced":
        case "corrupted":
        case "eldritch":
        case "dominant":
            return pred;
        case "call":
            return { ...pred, args: subArgs(pred.args, env) };
        case "has": {
            const mod = subValue(pred.mod, env);
            return pred.tier === undefined
                ? { ...pred, mod }
                : { ...pred, mod, tier: subValue(pred.tier, env) };
        }
        case "fractured":
            return { ...pred, mod: subValue(pred.mod, env) };
        case "compare":
            return { ...pred, value: subValue(pred.value, env) };
        case "not":
            return { ...pred, inner: substitute(pred.inner, env) };
        case "and":
        case "or":
            return {
                ...pred,
                left: substitute(pred.left, env),
                right: substitute(pred.right, env),
            };
    }
}

/** Replace parameter references throughout a proc body's statements. A step
 *  parameter bound to a block is spliced in as the block's statements, already
 *  substituted in the caller's scope, so a callee param of the same name cannot
 *  capture a name inside them. */
export function substituteStmts(stmts: readonly Stmt[], env: ReadonlyMap<string, Arg>): Stmt[] {
    return stmts.flatMap((s) => {
        if (s.kind !== "paramStep") return [substituteStmt(s, env)];
        const bound = env.get(s.param);
        // Each use is a statement of its own, so a consumer telling statements
        // apart by identity sees two uses as two.
        return bound?.kind === "block" ? bound.body.map(copyStmt) : [s];
    });
}

/** A bound parameter in an operation's argument becomes the bound literal; an
 *  unbound one stays a reference, caught downstream. A block cannot fill a
 *  value slot; `bindArgs` refuses it before substitution runs. */
function subOperationArg(arg: OperationArg, env: ReadonlyMap<string, Arg>): OperationArg {
    if (arg.kind !== "param") return arg;
    const bound = env.get(arg.param);
    return bound === undefined || bound.kind === "block" ? arg : bound;
}

function copyStmt(stmt: Stmt): Stmt {
    switch (stmt.kind) {
        case "until":
            return { ...stmt, body: stmt.body.map(copyStmt) };
        case "if":
            return {
                ...stmt,
                body: stmt.body.map(copyStmt),
                ...(stmt.elseBody !== undefined && { elseBody: stmt.elseBody.map(copyStmt) }),
            };
        default:
            return { ...stmt };
    }
}

function substituteStmt(stmt: Stmt, env: ReadonlyMap<string, Arg>): Stmt {
    switch (stmt.kind) {
        case "restart":
        case "stop":
        case "paramStep":
            return { ...stmt };
        case "operation":
            return { ...stmt, args: stmt.args.map((arg) => subOperationArg(arg, env)) };
        case "until":
            return {
                ...stmt,
                pred: substitute(stmt.pred, env),
                body: substituteStmts(stmt.body, env),
            };
        case "if":
            return {
                ...stmt,
                pred: substitute(stmt.pred, env),
                body: substituteStmts(stmt.body, env),
                ...(stmt.elseBody !== undefined && {
                    elseBody: substituteStmts(stmt.elseBody, env),
                }),
            };
        case "call":
            return { ...stmt, args: subArgs(stmt.args, env) };
    }
}
