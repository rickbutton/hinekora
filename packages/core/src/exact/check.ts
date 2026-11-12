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
import type { Craft, Def, Pred, ProcDef, Stmt } from "../ast/ast.js";
import type { SourceSpan } from "../ast/span.js";
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
import type { Resolved } from "../check/resolve-pred.js";
import type { PreconditionFailure } from "../check/ops.js";
import type { TypeId } from "../model/ids.js";
import type { Registry } from "../resolve/registry.js";
import { plural } from "../words.js";
import { type BuiltPart, buildKey, buildMethod } from "./build.js";
import { levelReasonsOn, narrowBy, readCondition } from "./conditions.js";
import { type Dd, DdBudgetError } from "./dd.js";
import { startOf } from "./initial.js";
import { runMethodTrace } from "./method.js";
import { type ItemView, itemView } from "../render/item.js";
import { fromItems, stateOf, type XItem } from "./state.js";
import type { Universe } from "./universe.js";
import { summaryOf } from "./views.js";

/** What a check is run against. */
export interface CheckContext {
    readonly registry: Registry;
}

/** How the exact check is run, apart from what it is run on. */
export interface ExactTuning {
    /** The rounds a loop is given to settle. */
    readonly maxRounds?: number;
    /** The engine's node budget. */
    readonly maxNodes?: number;
    /**
     * Take no recovery: after a refused step, or a loop that never exits, no
     * item goes on. Every state is then the items the game can reach, which
     * is what the exactness tests compare; the default goes on from a
     * recovery, after reporting it, so one error does not hide the next.
     */
    readonly strict?: boolean;
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
    | "limit"
    | "unjudged";

export interface Finding {
    readonly kind: FindingKind;
    /** The statement the finding is about (the next one, for `unreachable`). */
    readonly span: SourceSpan;
}

/** Why a step can never run: every path before it stopped, every one went
 *  back to the loop's head, or some of each. */
export type Unreached = "stops" | "restarts" | "both";

/** What the exactness tests read of a finding beyond its kind and place. */
export interface FindingItems {
    /** A refused step's items that broke a check or that an operation could
     *  not act on, by `buildKey` and operation index: `${key}#${index}`. */
    readonly failing?: ReadonlyMap<string, Dd>;
    /** A refused step's items its builder gave no operations. */
    readonly unbuilt?: Dd;
    readonly unreached?: Unreached;
}

/** What the exactness tests read of a check beyond its result. */
export interface ExactDetail {
    readonly items: ReadonlyMap<Finding, FindingItems>;
    /** How many loop heads were worked out, and how many found again. */
    readonly settled: number;
    readonly reused: number;
    /** The body's runs each head took, outside the rounds of another loop. */
    readonly rounds: readonly number[];
}

const details = new WeakMap<ExactCheckResult, ExactDetail>();

/** The detail of a check, for the exactness tests. */
export function exactDetail(r: ExactCheckResult): ExactDetail | undefined {
    return details.get(r);
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
 *  are finite, so a loop settles; one that has not by here is refused, and
 *  the check stops there. */
const MAX_ROUNDS = 256;

/** How a statement leaves: the items that fall through it, none when it ends
 *  the path; whether some item went back to an enclosing loop's head, and
 *  whether some item's path ended in it (a `stop`, a refused or ending step,
 *  a loop no item leaves). */
interface Flow {
    readonly fall: XItem | null;
    readonly restarted: boolean;
    readonly stopped: boolean;
}

const ENDS: Flow = { fall: null, restarted: false, stopped: true };

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

/**
 * The craft checked. A fault of the checker's own (a case it does not handle,
 * data it does not expect) never escapes: the craft is then not judged, and
 * the one error says so at the step it was checking, with the fault's words
 * for a report.
 */
export function checkExact(
    craft: Craft,
    ctx: CheckContext,
    tuning: ExactTuning = {},
): ExactCheckResult {
    const checker = new ExactChecker(ctx, tuning);
    try {
        return checker.run(craft);
    } catch (e) {
        const span = checker.at ?? craft.item.span;
        const why = e instanceof Error ? e.message : String(e);
        return {
            ok: false,
            diagnostics: [{ message: `${UNJUDGED} — ${why}`, span }],
            trace: [],
            findings: [{ kind: "unjudged", span }],
        };
    }
}

/** The words of a craft the checker could not judge. */
export const UNJUDGED =
    "This step could not be checked, so the craft is not judged from here: the checker does not handle something about it. Please report it";

/** The words of an item block no item answers to, where no fault of a field
 *  says why: the base cannot roll enough different modifiers to fill the
 *  affixes it declares, or what it declares cannot sit together. */
const NO_ITEM = "No item can have everything this item block declares on this base.";

/** The check the tool runs. */
export const check = checkExact;
export type CheckResult = ExactCheckResult;
export type TraceEntry = XTraceEntry;

/**
 * The innermost (smallest-span) trace entry containing `offset`. Hovering a
 * loop (whose span runs through its closing `}`) yields the loop entry, whose
 * `after` is the items the loop lets out.
 */
export function traceAt<E extends { readonly span: SourceSpan }>(
    trace: readonly E[],
    offset: number,
): E | undefined {
    let best: E | undefined;
    for (const e of trace) {
        if (e.span.start.offset <= offset && offset < e.span.end.offset) {
            const width = e.span.end.offset - e.span.start.offset;
            if (best === undefined || width < best.span.end.offset - best.span.start.offset)
                best = e;
        }
    }
    return best;
}

/** A finding of the reporting pass, kept until the check ends: whether it is
 *  reported, and with what item under it, depends on the strict check. */
interface Pending {
    readonly finding: Finding;
    readonly message: string | undefined;
    /** The statement it is about (`stmtKey`), and the items entering it. */
    readonly key: string;
    readonly entry: Dd;
    /** A refused step's items that break it, where they are items it is used on. */
    readonly breaking?: Dd;
    /** A loop that never exits because its body refused a step. */
    readonly refusedBody?: true;
}

const stmtKey = (s: Stmt): string => `${s.kind}@${s.span.start.offset}:${s.span.end.offset}`;

/** The control findings: about which steps run, not about an item a step meets. */
const CONTROL: ReadonlySet<FindingKind> = new Set([
    "deadIf",
    "deadElse",
    "neverRuns",
    "neverExits",
    "unreachable",
]);

/** A refusal's requirement: its words but the line that gives the item. */
const requirement = (message: string): string =>
    message
        .split("\n")
        .filter((l) => !l.startsWith("at this point the item is"))
        .join("\n");

class ExactChecker {
    private readonly diagnostics: CheckDiagnostic[] = [];
    private readonly pending: Pending[] = [];
    /** The items entering each statement on the reporting pass, by `stmtKey`. */
    readonly entries = new Map<string, Dd>();
    /** Some item went on past an error on the reporting pass. */
    private recovered = false;
    /** The refusals reported so far, for a loop to tell its body refused. */
    private refusals = 0;
    /** The statement being checked, for an error the check cannot go past. */
    at: SourceSpan | undefined;
    private readonly findings: Finding[] = [];
    private readonly trace: XTraceEntry[] = [];
    private sink: XTraceEntry[] = this.trace;
    /** Above 0 while a loop's rounds run: nothing is reported or traced. */
    private quiet = 0;
    private readonly items = new Map<Finding, FindingItems>();
    private settles = 0;
    private reused = 0;
    private readonly rounds: number[] = [];
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
    private readonly settled = new WeakMap<readonly Stmt[], Map<Dd, Settled>>();
    /** One body per call site, so a loop in it is the same loop every pass. */
    private readonly bodies = new WeakMap<Stmt, readonly Stmt[]>();
    private readonly inlined = new WeakMap<Stmt, NonNullable<XTraceEntry["inlined"]>>();
    u!: Universe;

    constructor(
        private readonly ctx: CheckContext,
        private readonly tuning: ExactTuning,
    ) {
        this.maxRounds = tuning.maxRounds ?? MAX_ROUNDS;
    }

    run(craft: Craft): ExactCheckResult {
        this.collect(craft.defs, craft.procs);
        const done = (finalState?: XItem): ExactCheckResult => {
            this.finish(craft);
            const r: ExactCheckResult = {
                ok: this.diagnostics.length === 0,
                diagnostics: this.diagnostics,
                trace: this.trace,
                findings: this.findings,
                ...(finalState !== undefined && { finalState }),
            };
            details.set(r, {
                items: this.items,
                settled: this.settles,
                reused: this.reused,
                rounds: this.rounds,
            });
            return r;
        };
        try {
            const said = this.diagnostics.length;
            const start = startOf(
                this.ctx.registry,
                craft,
                (m, span) => this.diag(m, span),
                this.tuning.maxNodes === undefined ? {} : { maxNodes: this.tuning.maxNodes },
            );
            if (start !== null && start.state === null && this.diagnostics.length === said) {
                this.diag(NO_ITEM, craft.item.span);
            }
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

    private report(
        kind: FindingKind,
        message: string | undefined,
        span: SourceSpan,
        at: {
            readonly key: string;
            readonly entry: Dd;
            readonly breaking?: Dd;
            readonly refusedBody?: true;
        },
        items: FindingItems = {},
    ): void {
        if (this.quiet > 0) return;
        if (kind === "refused") this.refusals++;
        const finding: Finding = { kind, span };
        this.findings.push(finding);
        this.pending.push({ finding, message, ...at });
        this.items.set(finding, items);
    }

    /**
     * The errors the findings of the reporting pass make: every finding stays
     * in `findings`, for what reads the analysis. After an error the
     * craft goes on from items the game does not make (a recovery), so one
     * mistake is not the end of the report; what is found only on those items
     * is a consequence of the error, not a fact of the craft. The strict check,
     * which lets no item past an error, tells them apart:
     *
     * - a control finding (a dead branch, a loop that never runs or never
     *   exits, a step that never runs) is reported only where the strict check
     *   reports it too, and a loop that never exits not where its body refused
     *   a step, which is then the cause;
     * - a refusal it does not report is reported only where no error before it
     *   has stated the same requirement;
     * - an item under a refusal is shown only where every item entering the
     *   step is one the game makes, and only some of them break it.
     *
     * The errors are then in the order of the craft.
     */
    private finish(craft: Craft): void {
        const m = this.u === undefined ? undefined : this.u.dd;
        let strict:
            | { readonly said: ReadonlySet<string>; readonly entries: ReadonlyMap<string, Dd> }
            | undefined;
        if (m !== undefined && this.recovered && this.tuning.strict !== true) {
            const checker = new ExactChecker(this.ctx, { ...this.tuning, strict: true });
            const r = checker.run(craft);
            strict = {
                said: new Set(r.findings.map((f) => `${f.kind}@${f.span.start.offset}`)),
                // A check given a node budget builds a universe of its own,
                // whose diagrams say nothing of these.
                entries: checker.u === this.u ? checker.entries : new Map<string, Dd>(),
            };
        }
        const said = (f: Finding): boolean =>
            strict === undefined || strict.said.has(`${f.kind}@${f.span.start.offset}`);
        const stated = new Set<string>();
        const ordered = [...this.pending].sort(
            (a, b) => a.finding.span.start.offset - b.finding.span.start.offset,
        );
        for (const p of ordered) {
            const f = p.finding;
            if (CONTROL.has(f.kind) && !said(f)) continue;
            // A body that refuses a step is why no item leaves: that refusal is the error.
            if (p.refusedBody === true && this.tuning.strict !== true) continue;
            if (f.kind === "refused" && p.message !== undefined) {
                const words = requirement(p.message);
                if (!said(f) && stated.has(words)) continue;
                stated.add(words);
            }
            if (p.message === undefined) continue;
            let example: ItemView | undefined;
            if (m !== undefined && p.breaking !== undefined && p.breaking !== p.entry) {
                const clean =
                    strict === undefined ? p.entry : (strict.entries.get(p.key) ?? m.EMPTY);
                if (m.implies(p.entry, clean)) example = this.example(p.breaking);
            }
            this.diagnostics.push({
                message: p.message,
                span: f.span,
                ...(example !== undefined && { example }),
            });
        }
        this.diagnostics.sort((a, b) => a.span.start.offset - b.span.start.offset);
    }

    /** A recovery feeds the steps after an error on the reporting pass only:
     *  a round that settles a loop works out what the game can do, so in it
     *  an item that cannot go on goes nowhere. */
    private get recovering(): boolean {
        return this.quiet === 0 && this.tuning.strict !== true;
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
        let stopped = false;
        for (const [i, stmt] of stmts.entries()) {
            if (this.quiet === 0) {
                const key = stmtKey(stmt);
                const held = this.entries.get(key);
                this.entries.set(key, held === undefined ? s.dd : this.u.dd.or(held, s.dd));
            }
            const flow = this.stmt(s, stmt);
            restarted ||= flow.restarted;
            stopped ||= flow.stopped;
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
                    const unreached: Unreached = !restarted
                        ? "stops"
                        : stopped
                          ? "both"
                          : "restarts";
                    const why = {
                        stops: "the craft always stops before it",
                        restarts: "the loop always restarts before it",
                        both: "every path before it stops or restarts",
                    }[unreached];
                    this.report(
                        "unreachable",
                        `this step can never run: ${why}`,
                        next.span,
                        { key: stmtKey(next), entry: this.u.dd.EMPTY },
                        { unreached },
                    );
                }
                return { fall: null, restarted, stopped };
            }
            s = flow.fall;
        }
        return { fall: s, restarted, stopped };
    }

    /** One statement, its diagram operations sharing the engine's cache. A
     *  node budget passed anywhere inside it is reported at the innermost
     *  statement and ends the check. */
    private stmt(s: XItem, stmt: Stmt): Flow {
        this.at = stmt.span;
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
                if (frame === undefined) return ENDS;
                frame.back = this.u.dd.or(frame.back, s.dd);
                return { fall: null, restarted: true, stopped: false };
            }
            case "stop":
                return ENDS;
            case "if":
                return this.branch(s, stmt);
            case "until":
                return this.loop(s, stmt);
            case "call":
                return this.call(s, stmt);
            case "paramStep":
                this.diag(`parameter "${stmt.param}" was never given a value`, stmt.span);
                return goesOn(s);
        }
    }

    // --- operations ----------------------------------------------------------

    /**
     * The method built per part and run on the parts it builds alike. Where
     * some part refuses, the step is reported once, worded over every item
     * the step is used on, by the earliest part that refuses: the parts come
     * in a fixed order (by influence, row, dominant side), so the message is
     * stable, and two refusals of different kinds have no one wording. The
     * refused items go no further; where no item of a part goes on, the
     * reporting pass recovers (`recovering`): a part the builder refuses goes
     * on unchanged, a refused run from its recovery (exact/method.ts).
     */
    private operation(s: XItem, stmt: Extract<Stmt, { kind: "operation" }>): Flow {
        const keep = goesOn(s);
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
        /** The items that break the step the way its message says; null where
         *  they are not items the step is used on, as an operation before the
         *  failing one has changed them. */
        let breaking: Dd | null | undefined;
        const firstBreak = (dd: Dd | null): void => {
            if (breaking === undefined) breaking = dd;
        };
        let stopped = false;
        const failing = new Map<string, Dd>();
        for (const { part, key } of together(buildMethod(s, method, literals))) {
            if ("refused" in part.built) {
                firstBreak(part.state.dd);
                message ??= part.built.refused;
                unbuilt = m.or(unbuilt, part.state.dd);
                if (this.recovering) {
                    fall = m.or(fall, part.state.dd);
                    this.recovered = true;
                } else stopped = true;
                continue;
            }
            const run = runMethodTrace(part.state, part.built);
            const { result } = run;
            for (const [i, dd] of run.failing) failing.set(`${key}#${i}`, dd);
            if (!result.ok) {
                const first = firstOf(run.failing);
                firstBreak(first !== undefined && m.implies(first, part.state.dd) ? first : null);
                message ??= this.refusal(s, result.failure, result.under);
            }
            const recovers = result.recovered === true;
            if (recovers && this.recovering) this.recovered = true;
            if (run.reachedEnd || (!result.ok && !(recovers && this.recovering))) stopped = true;
            if (result.ended !== true && (!recovers || this.recovering)) {
                fall = m.or(fall, result.state.dd);
            }
        }
        const at = { key: stmtKey(stmt), entry: s.dd };
        if (message !== undefined) {
            const b: Dd | null | undefined = breaking;
            this.report(
                "refused",
                message,
                stmt.span,
                { ...at, ...(b !== undefined && b !== null && { breaking: b }) },
                {
                    ...(failing.size > 0 && { failing }),
                    ...(unbuilt !== m.EMPTY && { unbuilt }),
                },
            );
        }
        const after = stateOf(this.u, fall);
        // A method that leaves no item on any outcome ends the path, as `stop` does.
        if (after === null && message === undefined) {
            this.report("ended", undefined, stmt.span, at);
        }
        return { fall: after, restarted: false, stopped };
    }

    /** One item of `items`, as an error shows it. */
    private example(items: Dd): ItemView {
        const one = this.u.decodeOne(this.u.dd.witness(items)!);
        return itemView(fromItems(this.u, [one])!, this.ctx.registry);
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
        const yes = this.cut(s, stmt.pred, true, resolved);
        const no = this.cut(s, stmt.pred, false, resolved);
        const at = { key: stmtKey(stmt), entry: s.dd };
        if (yes === null) {
            this.report(
                "deadIf",
                `the 'if' branch can never run: ${describePred(stmt.pred)} is impossible here${levelReasonsOn(s, resolved)}`,
                stmt.pred.span,
                at,
            );
        }
        if (no === null && stmt.elseBody !== undefined) {
            this.report(
                "deadElse",
                `the 'else' branch can never run: ${describePred(stmt.pred)} always holds here`,
                stmt.pred.span,
                at,
            );
        }
        let fall = this.u.dd.EMPTY;
        let restarted = false;
        let stopped = false;
        for (const [entry, body] of [
            [yes, stmt.body],
            [no, stmt.elseBody ?? []],
        ] as const) {
            if (entry === null) continue;
            const f = this.seq(entry, body);
            fall = this.u.dd.or(fall, this.dd(f.fall));
            restarted ||= f.restarted;
            stopped ||= f.stopped;
        }
        return { fall: stateOf(this.u, fall), restarted, stopped };
    }

    /** The items on which the condition holds (or fails): all of them where
     *  its reading was refused, so a reported fault is not followed by a
     *  branch or loop error. */
    private cut(s: XItem, pred: Pred, positive: boolean, resolved: Resolved | null): XItem | null {
        return resolved === null ? s : narrowBy(s, pred, positive, this.predDefs);
    }

    // --- until -----------------------------------------------------------------

    /**
     * The loop's head settled (`settle`), then, on the reporting pass, the
     * body run once more from its items that go on, for its errors and its
     * trace. The exit is the head narrowed by the condition. Where no item
     * ever leaves, the reporting pass recovers: the craft goes on from the
     * whole head, so one error is not followed by one at every step after it.
     */
    private loop(entry: XItem, stmt: Extract<Stmt, { kind: "until" }>): Flow {
        const resolved = readCondition(entry, stmt.pred, this.predDefs, (m, span) =>
            this.diag(m, span),
        );
        const { head, stopped } = this.settle(entry, stmt, resolved !== null);
        const going = this.cut(head, stmt.pred, false, resolved);
        const exit = this.cut(head, stmt.pred, true, resolved);
        const at = { key: stmtKey(stmt), entry: entry.dd };
        if (going === null) {
            this.report(
                "neverRuns",
                `this loop's body never runs: ${describePred(stmt.pred)} already holds here`,
                stmt.pred.span,
                at,
            );
            return goesOn(entry);
        }
        const refusals = this.refusals;
        const back = this.quiet === 0 ? this.back(going, stmt.body) : undefined;
        const body = back?.stopped ?? stopped;
        if (exit === null) {
            this.report(
                "neverExits",
                `this loop can never exit: ${describePred(stmt.pred)} can never become true here${levelReasonsOn(head, resolved)}`,
                stmt.pred.span,
                { ...at, ...(this.refusals > refusals && { refusedBody: true as const }) },
            );
        }
        if (exit !== null) return { fall: exit, restarted: false, stopped: body };
        if (!this.recovering) return ENDS;
        // No item leaves: the craft goes on from the items the body's recovery
        // brings back that meet the condition, else from the whole head.
        this.recovered = true;
        const recovered = this.cut(
            { u: this.u, dd: this.u.dd.or(head.dd, back?.dd ?? this.u.dd.EMPTY) },
            stmt.pred,
            true,
            resolved,
        );
        return recovered === null
            ? goesOn(head)
            : { fall: recovered, restarted: false, stopped: body };
    }

    /**
     * The least head closed under the body: the entry, then each round what
     * the body brings back from the head's new items that do not meet the
     * condition, until a round adds nothing. No recovery is taken in these
     * rounds (`recovering`), so the body is an image item by item and a round
     * runs on the new items alone. A loop past the round limit is refused and
     * the check stops there: a head short of the fixpoint would leave later
     * rounds unjudged, and no sound head is known to go on from.
     */
    private settle(
        entry: XItem,
        stmt: Extract<Stmt, { kind: "until" }>,
        readable: boolean,
    ): Settled {
        let known = this.settled.get(stmt.body);
        if (known === undefined) this.settled.set(stmt.body, (known = new Map<Dd, Settled>()));
        const hit = known.get(entry.dd);
        if (hit !== undefined) {
            this.reused++;
            return hit;
        }
        this.settles++;
        const outermost = this.quiet === 0;
        let runs = 0;
        const m = this.u.dd;
        const goingOf = (s: XItem): XItem | null =>
            readable ? narrowBy(s, stmt.pred, false, this.predDefs) : s;
        const settled = this.quietly((): Settled => {
            let at = entry;
            let fresh = entry;
            let stopped = false;
            for (let round = 1; ; round++) {
                const going = goingOf(fresh);
                if (going === null) return { head: at, stopped };
                const back = this.back(going, stmt.body);
                runs++;
                stopped ||= back.stopped;
                const next = m.or(at.dd, back.dd);
                if (next === at.dd) return { head: at, stopped };
                if (round > this.maxRounds) {
                    const n = this.maxRounds;
                    throw new Abandoned(
                        stmt.span,
                        `The item this loop works on is still changing after ${n} ${plural(n, "round")}, too many to follow, so the steps from here on are not checked.`,
                        "unsettled",
                    );
                }
                fresh = { u: this.u, dd: m.diff(next, at.dd) };
                at = { u: this.u, dd: next };
            }
        });
        known.set(entry.dd, settled);
        if (outermost) this.rounds.push(runs);
        return settled;
    }

    /** The items the body brings back to the loop's head from `entry`, those
     *  falling off its end and those a `restart` sends, and whether some
     *  item's path ended in it. */
    private back(entry: XItem, body: readonly Stmt[]): { dd: Dd; stopped: boolean } {
        const frame = { back: this.u.dd.EMPTY };
        this.frames.push(frame);
        try {
            const flow = this.seq(entry, body);
            return { dd: this.u.dd.or(this.dd(flow.fall), frame.back), stopped: flow.stopped };
        } finally {
            this.frames.pop();
        }
    }

    // --- calls -------------------------------------------------------------------

    /** The body inlined, so a `restart` in it re-enters the caller's loop; the
     *  call is traced as one step, its body's trace hanging off it. */
    private call(s: XItem, stmt: Extract<Stmt, { kind: "call" }>): Flow {
        const keep = goesOn(s);
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

/** The items failing at the method's earliest operation that fails. */
function firstOf(failing: ReadonlyMap<number, Dd>): Dd | undefined {
    return failing.size === 0 ? undefined : failing.get(Math.min(...failing.keys()));
}

/** The items all go on through a statement that does nothing to them. */
function goesOn(s: XItem): Flow {
    return { fall: s, restarted: false, stopped: false };
}

/** A loop's head, and whether some item's path ended in its body. */
interface Settled {
    readonly head: XItem;
    readonly stopped: boolean;
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
