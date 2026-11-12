/**
 * The exact checker's driver (docs/EXACT.md §5): the craft run over one state,
 * the set of items each point of the craft can hold, every statement an exact
 * image of it. It reports what check/check.ts reports, in the same words.
 *
 * - An operation is built per part (exact/build.ts), parts given the same
 *   operations run together, and the results united.
 * - An `if` narrows the state both ways and unites the arms that fall through.
 * - A loop's head holds the entry and every item the body brings back to it,
 *   falling off its end or by `restart`, from the head's items that do not yet
 *   meet the condition; the rounds run until the head stops changing, each
 *   exact, and its exit is the head narrowed by the condition.
 * - A call is its body inlined (check/defs.ts), traced as one step.
 *
 * A statement that leaves no item ends the path. The rounds that settle a
 * loop report and trace nothing; the body's last run from the settled head
 * does.
 */
import type { Craft, Def, ProcDef, Stmt } from "../ast/ast.js";
import type { SourceSpan } from "../ast/span.js";
import type { CheckContext } from "../check/check.js";
import {
    bindArgs,
    collectDefs,
    collectProcs,
    type DefEntry,
    type PredDefs,
    type ProcEntry,
    substituteStmts,
} from "../check/defs.js";
import {
    type CheckDiagnostic,
    describePred,
    preconditionMessage,
    unknownOperation,
} from "../check/diagnostics.js";
import { findMethod, type Literal } from "../check/methods.js";
import type { PreconditionFailure } from "../check/ops.js";
import type { TypeId } from "../model/ids.js";
import { type BuiltPart, buildKey, buildMethod } from "./build.js";
import { levelReasonsOn, narrowBy, readCondition } from "./conditions.js";
import { type Dd, DdBudgetError } from "./dd.js";
import { startOf } from "./initial.js";
import { runMethodTrace } from "./method.js";
import { stateOf, type XItem } from "./state.js";
import type { Universe } from "./universe.js";
import { summaryOf } from "./views.js";

/** How the exact check is run, apart from what it is run on. */
export interface ExactTuning {
    /** The rounds a loop is given to settle. */
    readonly maxRounds?: number;
    /** The engine's node budget. */
    readonly maxNodes?: number;
}

/** The items before and after a statement (or the item block). */
export interface XTraceEntry {
    readonly span: SourceSpan;
    readonly kind: Stmt["kind"] | "item";
    readonly before: XItem;
    /** The items it lets through; absent where none falls through. */
    readonly after?: XItem;
    /** The statement, inside a call's body (check/check.ts `TraceEntry`). */
    readonly stmt?: Stmt;
    /** A call's body with its arguments bound, and its own trace. */
    readonly inlined?: { readonly body: readonly Stmt[]; readonly trace: readonly XTraceEntry[] };
}

/** What a reported error is about, for a consumer that reads more than the words. */
export type FindingKind =
    | "refused"
    | "deadIf"
    | "deadElse"
    | "neverRuns"
    | "neverExits"
    | "unreachable"
    | "ended"
    | "unsettled"
    | "limit";

export interface Finding {
    readonly kind: FindingKind;
    /** The statement the finding is about (the next one, for `unreachable`). */
    readonly span: SourceSpan;
    /** A refused step's items that broke a check or that an operation could
     *  not act on, by `buildKey` and operation index: `${key}#${index}`. */
    readonly failing?: ReadonlyMap<string, Dd>;
    /** A refused step's items its builder gave no operations. */
    readonly unbuilt?: Dd;
}

export interface ExactCheckResult {
    readonly ok: boolean;
    readonly diagnostics: readonly CheckDiagnostic[];
    readonly trace: readonly XTraceEntry[];
    /** The items after the last statement, where some fall through it. */
    readonly finalState?: XItem;
    readonly findings: readonly Finding[];
}

/** The rounds a loop is given to settle. Every round is exact and the items
 *  are finite, so a loop settles; one that has not by here is refused, as the
 *  present checker refuses it. */
const MAX_ROUNDS = 256;

/** How a statement leaves: the items that fall through it, none when it ends
 *  the path, and whether some item went back to the enclosing loop's head. */
interface Flow {
    readonly fall: XItem | null;
    readonly restarted: boolean;
}

/** The check stops at a limit: the message, and the statement it is at. */
class Abandoned extends Error {
    constructor(
        readonly span: SourceSpan,
        readonly words: string,
        readonly kind: FindingKind,
    ) {
        super(words);
        this.name = "Abandoned";
    }
}

/** The words of a node-budget error: the items' possibilities past what the
 *  engine holds. The steps after it are not judged, as nothing sound
 *  continues the craft from a state that was never built. */
const TOO_MANY =
    "The item can turn out too many different ways here to follow each, so the steps from here on are not checked.";

export function checkExact(
    craft: Craft,
    ctx: CheckContext,
    tuning: ExactTuning = {},
): ExactCheckResult {
    return new ExactChecker(ctx, tuning).run(craft);
}

class ExactChecker {
    private readonly diagnostics: CheckDiagnostic[] = [];
    private readonly findings: Finding[] = [];
    private readonly trace: XTraceEntry[] = [];
    private sink: XTraceEntry[] = this.trace;
    /** Above 0 while a loop's rounds run: nothing is reported or traced. */
    private quiet = 0;
    private readonly defs = new Map<string, DefEntry>();
    private readonly procs = new Map<string, ProcEntry>();
    private readonly predDefs: PredDefs = { defs: this.defs, procs: this.procs };
    private readonly maxRounds: number;
    /** The items a `restart` sends back, by loop, innermost last. */
    private readonly frames: { back: Dd }[] = [];
    /** A loop's settled head by its body and entry: diagrams are canonical, so
     *  an entry met again is the same diagram, and the head depends on nothing
     *  else. An outer loop's rounds enter an inner loop with the same items
     *  most rounds. */
    private readonly settled = new WeakMap<readonly Stmt[], Map<Dd, XItem>>();
    /** One body per call site, so a loop in it is the same loop every pass. */
    private readonly bodies = new WeakMap<Stmt, readonly Stmt[]>();
    private readonly inlined = new WeakMap<Stmt, NonNullable<XTraceEntry["inlined"]>>();
    private u!: Universe;

    constructor(
        private readonly ctx: CheckContext,
        private readonly tuning: ExactTuning,
    ) {
        this.maxRounds = tuning.maxRounds ?? MAX_ROUNDS;
    }

    run(craft: Craft): ExactCheckResult {
        this.collect(craft.defs, craft.procs);
        const done = (finalState?: XItem): ExactCheckResult => ({
            ok: this.diagnostics.length === 0,
            diagnostics: this.diagnostics,
            trace: this.trace,
            findings: this.findings,
            ...(finalState !== undefined && { finalState }),
        });
        try {
            const start = startOf(
                this.ctx.registry,
                craft,
                (m, span) => this.diag(m, span),
                this.tuning.maxNodes === undefined ? {} : { maxNodes: this.tuning.maxNodes },
            );
            if (start === null || start.state === null) return done();
            this.u = start.u;
            const first = start.state;
            this.trace.push({ span: craft.item.span, kind: "item", before: first, after: first });
            const flow = this.seq(first, craft.body);
            return done(flow.fall ?? undefined);
        } catch (e) {
            const stop =
                e instanceof DdBudgetError ? new Abandoned(craft.item.span, TOO_MANY, "limit") : e;
            if (!(stop instanceof Abandoned)) throw e;
            this.diagnostics.push({ message: stop.words, span: stop.span });
            this.findings.push({ kind: stop.kind, span: stop.span });
            return done();
        }
    }

    private collect(defs: readonly Def[], procs: readonly ProcDef[]): void {
        const diag = (m: string, span: SourceSpan): void => this.diag(m, span);
        collectDefs(defs, diag, this.defs);
        collectProcs(procs, this.defs, diag, this.procs);
    }

    private diag(message: string, span: SourceSpan): void {
        if (this.quiet === 0) this.diagnostics.push({ message, span });
    }

    private report(kind: FindingKind, message: string, span: SourceSpan, more = {}): void {
        if (this.quiet > 0) return;
        this.diagnostics.push({ message, span });
        this.findings.push({ kind, span, ...more });
    }

    private quietly<T>(fn: () => T): T {
        this.quiet++;
        try {
            return fn();
        } finally {
            this.quiet--;
        }
    }

    private dd(items: XItem | null): Dd {
        return items?.dd ?? this.u.dd.EMPTY;
    }

    // --- statements --------------------------------------------------------

    private seq(entry: XItem, stmts: readonly Stmt[]): Flow {
        let s = entry;
        let restarted = false;
        for (const [i, stmt] of stmts.entries()) {
            const flow = this.stmt(s, stmt);
            restarted ||= flow.restarted;
            if (this.quiet === 0) {
                const inlined = this.inlined.get(stmt);
                this.sink.push({
                    span: stmt.span,
                    kind: stmt.kind,
                    ...(this.sink !== this.trace && { stmt }),
                    before: s,
                    ...(flow.fall !== null && { after: flow.fall }),
                    ...(inlined !== undefined && { inlined }),
                });
            }
            if (flow.fall === null) {
                const next = stmts[i + 1];
                if (next !== undefined) {
                    const why =
                        !flow.restarted || this.frames.length === 0
                            ? "the craft always stops before it"
                            : stmt.kind === "restart"
                              ? "the loop always restarts before it"
                              : "every path before it stops or restarts";
                    this.report("unreachable", `this step can never run: ${why}`, next.span);
                }
                return { fall: null, restarted };
            }
            s = flow.fall;
        }
        return { fall: s, restarted };
    }

    /** One statement, its diagram operations sharing the engine's cache. A
     *  node budget passed anywhere inside it is reported at the innermost
     *  statement and ends the check. */
    private stmt(s: XItem, stmt: Stmt): Flow {
        try {
            return this.u.dd.batch(() => this.stmtOn(s, stmt));
        } catch (e) {
            if (e instanceof DdBudgetError) throw new Abandoned(stmt.span, TOO_MANY, "limit");
            throw e;
        }
    }

    private stmtOn(s: XItem, stmt: Stmt): Flow {
        switch (stmt.kind) {
            case "operation":
                return this.operation(s, stmt);
            case "restart": {
                // At top level a restart ends the craft (language.md §4.3).
                const frame = this.frames[this.frames.length - 1];
                if (frame === undefined) return { fall: null, restarted: false };
                frame.back = this.u.dd.or(frame.back, s.dd);
                return { fall: null, restarted: true };
            }
            case "stop":
                return { fall: null, restarted: false };
            case "if":
                return this.branch(s, stmt);
            case "until":
                return this.loop(s, stmt);
            case "call":
                return this.call(s, stmt);
            case "paramStep":
                this.diag(`parameter "${stmt.param}" was never given a value`, stmt.span);
                return { fall: s, restarted: false };
        }
    }

    // --- operations ----------------------------------------------------------

    /**
     * The method built per part and run on the parts it builds alike. Where
     * some part refuses, the step is reported once, worded over every item
     * the step is used on, by the earliest part that refuses: the parts come
     * in a fixed order (by influence, row, dominant side), so the message is
     * stable, and two refusals of different kinds have no one wording. A part
     * the builder refuses goes on unchanged; a refused run goes on from what
     * the run leaves (exact/method.ts).
     */
    private operation(s: XItem, stmt: Extract<Stmt, { kind: "operation" }>): Flow {
        const keep: Flow = { fall: s, restarted: false };
        const method = findMethod(stmt.words);
        if (method === undefined) {
            this.diag(unknownOperation(stmt.words), stmt.span);
            return keep;
        }
        const literals: Literal[] = [];
        for (const arg of stmt.args) {
            if (arg.kind === "param") {
                this.diag(`parameter "${arg.param}" was never given a value`, stmt.span);
                return keep;
            }
            literals.push(arg);
        }
        const m = this.u.dd;
        let fall = m.EMPTY;
        let unbuilt = m.EMPTY;
        let message: string | undefined;
        const failing = new Map<string, Dd>();
        for (const { part, key } of together(buildMethod(s, method, literals))) {
            if ("refused" in part.built) {
                message ??= part.built.refused;
                unbuilt = m.or(unbuilt, part.state.dd);
                fall = m.or(fall, part.state.dd);
                continue;
            }
            const { result, failing: refused } = runMethodTrace(part.state, part.built);
            for (const [i, dd] of refused) failing.set(`${key}#${i}`, dd);
            if (!result.ok) message ??= this.refusal(s, result.failure, result.under);
            if (result.ended !== true) fall = m.or(fall, result.state.dd);
        }
        if (message !== undefined) {
            this.report("refused", message, stmt.span, {
                ...(failing.size > 0 && { failing }),
                ...(unbuilt !== m.EMPTY && { unbuilt }),
            });
        }
        const after = stateOf(this.u, fall);
        // A method that leaves no item on any outcome ends the path, as `stop` does.
        if (after === null && this.quiet === 0)
            this.findings.push({ kind: "ended", span: stmt.span });
        return { fall: after, restarted: false };
    }

    private refusal(
        s: XItem,
        failure: PreconditionFailure,
        under: readonly TypeId[] | undefined,
    ): string {
        const carriers = (under ?? []).map((t) => `"${this.ctx.registry.typeLabel(t)}"`);
        const where =
            carriers.length > 0
                ? `\nThis is so where the item has ${carriers.join(" and ")}, which it may have here — settle it with an 'if has' first.`
                : "";
        return preconditionMessage(summaryOf(s), failure) + where;
    }

    // --- if / else -----------------------------------------------------------

    private branch(s: XItem, stmt: Extract<Stmt, { kind: "if" }>): Flow {
        const resolved = readCondition(s, stmt.pred, this.predDefs, (m, span) =>
            this.diag(m, span),
        );
        const yes = narrowBy(s, stmt.pred, true, this.predDefs);
        const no = narrowBy(s, stmt.pred, false, this.predDefs);
        if (yes === null) {
            this.report(
                "deadIf",
                `the 'if' branch can never run: ${describePred(stmt.pred)} is impossible here${levelReasonsOn(s, resolved)}`,
                stmt.pred.span,
            );
        }
        if (no === null && stmt.elseBody !== undefined) {
            this.report(
                "deadElse",
                `the 'else' branch can never run: ${describePred(stmt.pred)} always holds here`,
                stmt.pred.span,
            );
        }
        let fall = this.u.dd.EMPTY;
        let restarted = false;
        for (const [entry, body] of [
            [yes, stmt.body],
            [no, stmt.elseBody ?? []],
        ] as const) {
            if (entry === null) continue;
            const f = this.seq(entry, body);
            fall = this.u.dd.or(fall, this.dd(f.fall));
            restarted ||= f.restarted;
        }
        return { fall: stateOf(this.u, fall), restarted };
    }

    // --- until -----------------------------------------------------------------

    /**
     * The loop's head settled (`settle`), then the body run once more from
     * its items that go on, for its errors and its trace. The exit is the head
     * narrowed by the condition. A loop that can never exit goes on from its
     * whole head: no item leaves it, and the steps after it are judged on the
     * items it works on, so one error is not followed by one at every step.
     */
    private loop(entry: XItem, stmt: Extract<Stmt, { kind: "until" }>): Flow {
        const resolved = readCondition(entry, stmt.pred, this.predDefs, (m, span) =>
            this.diag(m, span),
        );
        const head = this.settle(entry, stmt);
        const going = narrowBy(head, stmt.pred, false, this.predDefs);
        const exit = narrowBy(head, stmt.pred, true, this.predDefs);
        if (going === null) {
            this.report(
                "neverRuns",
                `this loop's body never runs: ${describePred(stmt.pred)} already holds here`,
                stmt.pred.span,
            );
            return { fall: entry, restarted: false };
        }
        if (exit === null) {
            this.report(
                "neverExits",
                `this loop can never exit: ${describePred(stmt.pred)} can never become true here${levelReasonsOn(head, resolved)}`,
                stmt.pred.span,
            );
        }
        if (this.quiet === 0) this.back(going, stmt.body);
        return { fall: exit ?? head, restarted: false };
    }

    /**
     * The least head the rounds reach: the entry, then each round the head
     * united with what the body brings back from the head's items that do not
     * meet the condition, until a round adds nothing. Each round runs the body
     * on all of them, not on the new ones alone: a refused step's recovery
     * reads the items it is used on together. A loop past the round limit is
     * refused and the check stops there: a head short of the fixpoint would
     * leave later rounds of the body unjudged, and no sound head is known to
     * judge the rest of the craft from.
     */
    private settle(entry: XItem, stmt: Extract<Stmt, { kind: "until" }>): XItem {
        let known = this.settled.get(stmt.body);
        if (known === undefined) this.settled.set(stmt.body, (known = new Map<Dd, XItem>()));
        const hit = known.get(entry.dd);
        if (hit !== undefined) return hit;
        const m = this.u.dd;
        const head = this.quietly(() => {
            let at = entry;
            for (let round = 1; ; round++) {
                const going = narrowBy(at, stmt.pred, false, this.predDefs);
                if (going === null) return at;
                const next = m.or(at.dd, this.back(going, stmt.body));
                if (next === at.dd) return at;
                if (round > this.maxRounds) {
                    throw new Abandoned(
                        stmt.span,
                        `The item this loop works on is still changing after ${this.maxRounds} rounds, too many to follow.`,
                        "unsettled",
                    );
                }
                at = { u: this.u, dd: next };
            }
        });
        known.set(entry.dd, head);
        return head;
    }

    /** The items the body brings back to the loop's head from `entry`: those
     *  falling off its end and those a `restart` sends. */
    private back(entry: XItem, body: readonly Stmt[]): Dd {
        const frame = { back: this.u.dd.EMPTY };
        this.frames.push(frame);
        try {
            const flow = this.seq(entry, body);
            return this.u.dd.or(this.dd(flow.fall), frame.back);
        } finally {
            this.frames.pop();
        }
    }

    // --- calls -------------------------------------------------------------------

    /** The body inlined, so a `restart` in it re-enters the caller's loop; the
     *  call is traced as one step, its body's trace hanging off it. */
    private call(s: XItem, stmt: Extract<Stmt, { kind: "call" }>): Flow {
        const keep: Flow = { fall: s, restarted: false };
        const entry = this.procs.get(stmt.name);
        if (entry === undefined) {
            this.diag(
                this.defs.has(stmt.name)
                    ? `"${stmt.name}" is a condition, use it inside 'if' or 'until', not as a step`
                    : `unknown def "${stmt.name}"`,
                stmt.span,
            );
            return keep;
        }
        const { proc, paramTypes, valid } = entry;
        if (!valid) return keep;
        const env = bindArgs(stmt.name, proc.params, paramTypes, stmt.args, stmt.span, (m, span) =>
            this.diag(m, span),
        );
        if (env === null) return keep;
        const body = this.bodies.get(stmt) ?? substituteStmts(proc.body, env);
        this.bodies.set(stmt, body);
        const trace: XTraceEntry[] = [];
        const outer = this.sink;
        this.sink = trace;
        try {
            return this.seq(s, body);
        } finally {
            this.sink = outer;
            if (this.quiet === 0) this.inlined.set(stmt, { body, trace });
        }
    }
}

/** The parts with their build keys, those given the same operations as one:
 *  the method runs once over all the items it is built alike for. */
function together(parts: readonly BuiltPart[]): { part: BuiltPart; key: string }[] {
    const byKey = new Map<string, BuiltPart>();
    for (const p of parts) {
        const key = buildKey(p.built);
        const held = byKey.get(key);
        byKey.set(
            key,
            held === undefined
                ? p
                : {
                      ...held,
                      state: { u: p.state.u, dd: p.state.u.dd.or(held.state.dd, p.state.dd) },
                  },
        );
    }
    return [...byKey].map(([key, part]) => ({ part, key }));
}
