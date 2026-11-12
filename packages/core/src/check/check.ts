/**
 * The checker: thread the abstract item state (`AItem`) through a parsed
 * `Craft`, verifying every operation's precondition on every path. Errors are
 * collected as diagnostics, not thrown, a craft can have several independent
 * problems.
 */
import type { Craft, Def, ItemBlock, Pred, ProcDef, Stmt } from "../ast/ast.js";
import type { SourceSpan } from "../ast/span.js";
import { type Gen, type ModId, type TagId, type TypeId } from "../model/ids.js";
import type { Mod } from "../model/mod.js";
import { type EldritchSide, eldritchOf } from "../model/marks.js";
import type { Registry } from "../resolve/registry.js";
import {
    type AItem,
    type RPred,
    cardinalityGuarantees,
    guaranteedTypes,
    isExcluded,
    isGuaranteed,
    suffixRange,
    initialState,
    join,
    refine,
    stateEqual,
    widenPresence,
    widenRanges,
} from "./astate.js";
import { BddManager } from "./bdd.js";
import {
    type CheckDiagnostic,
    describePred,
    preconditionMessage,
    unknownOperation,
} from "./diagnostics.js";
import {
    bindArgs,
    collectDefs,
    collectProcs,
    type DefEntry,
    type ProcEntry,
    substituteStmts,
} from "./defs.js";
import { declareItem, type ItemDecl } from "./item-block.js";
import { rollableGen } from "../resolve/tiers.js";
import { findMethod, type Literal } from "./methods.js";
import { anonymousRows, influenceTagsAny, influenceTagsOf, runMethod } from "./ops.js";
import {
    carriedRows,
    comparesValue,
    levelReasons,
    type PredEnv,
    type Resolved,
    resolvePred,
    type ResolveView,
} from "./resolve-pred.js";

export { PARAM_SORT_WORD, type ParamType, paramSorts } from "./defs.js";

export interface CheckContext {
    readonly registry: Registry;
}

/** How the analysis is run, apart from what it is run on. */
export interface CheckTuning {
    /** The rounds a loop's invariant is given to settle (`MAX_ROUNDS`). */
    readonly maxRounds?: number;
    /** The most summaries kept apart at one point (`MAX_PARTS`). */
    readonly maxParts?: number;
}

const cmpAtLeast = (projection: "prefixCount" | "suffixCount", value: number): RPred => ({
    kind: "compare",
    projection,
    op: ">=",
    value,
});

/** The abstract item state before and after a statement (or the item block). */
export interface TraceEntry {
    readonly span: SourceSpan;
    /** What produced this entry, the statement kind, or "item" for the block. */
    readonly kind: Stmt["kind"] | "item";
    readonly before: AItem;
    /** State after it completes; absent if that path diverges (via restart). */
    readonly after?: AItem;
    /** The statement, inside a call's body, where one written statement may
     *  run as several (a step parameter used twice). */
    readonly stmt?: Stmt;
    /** A call's body with its arguments bound, and its own trace. */
    readonly inlined?: { readonly body: readonly Stmt[]; readonly trace: readonly TraceEntry[] };
}

export interface CheckResult {
    readonly ok: boolean;
    readonly diagnostics: readonly CheckDiagnostic[];
    /** The abstract item state after the last fall-through statement, if any. */
    readonly finalState?: AItem;
    /**
     * State entering each statement (and the item block), for editor hover
     * ("what is my item here"). Populated on the real pass only, so each source
     * statement appears once.
     */
    readonly trace: readonly TraceEntry[];
}

/**
 * The innermost (smallest-span) trace entry containing `offset`. Hovering a
 * loop (whose span runs through its closing `}`) yields the loop entry, whose
 * `after` is the proven post-loop state.
 */
export function traceAt(trace: readonly TraceEntry[], offset: number): TraceEntry | undefined {
    let best: TraceEntry | undefined;
    for (const e of trace) {
        if (e.span.start.offset <= offset && offset < e.span.end.offset) {
            const width = e.span.end.offset - e.span.start.offset;
            if (best === undefined || width < best.span.end.offset - best.span.start.offset)
                best = e;
        }
    }
    return best;
}

/** The rounds a loop's invariant is given to settle. Every round is exact, and
 *  what a summary can hold is finite, so a loop settles on its own; one that
 *  has not by here is refused, since cutting it short by widening would
 *  refuse a later step for an item no round makes. Loops written to make an
 *  item settle within ten. */
const MAX_ROUNDS = 256;

/**
 * The items a point of the craft may hold, as a few summaries kept apart; never
 * empty. One summary for them all would hold "four or five modifiers" and "with
 * the life or without", and forget that the five go with the life: the counts,
 * the rarity and the marks are ranges and sets of their own, tied to nothing.
 * So summaries that differ in those stay apart (`partition`), and each is
 * checked on its own.
 */
type Parts = readonly AItem[];

/** How a statement leaves: with an item, or ending the path, by re-entering the
 *  enclosing loop (`restart`) or by ending the craft on this path (`stop`). */
type Flow =
    | { readonly kind: "fall"; readonly parts: Parts }
    | { readonly kind: "restart" }
    | { readonly kind: "stop" };

/** The most summaries kept apart at one point. A craft that needs more is
 *  refused: joining some to fit would refuse a later step for an item no path
 *  makes, at a point the craft's author cannot see. No craft written to make
 *  an item comes near it. */
const MAX_PARTS = 256;

/** The fields a step's precondition reads that a join blurs. Summaries that
 *  agree on all of them are joined; what else differs between them (tiers,
 *  values, strands, the possible types) is joined field by field. An eldritch
 *  implicit counts by whether it may be there and may be missing: its tier
 *  changes with every ember, and paths that differ in the tier alone would
 *  each be a part, for a fact the set of tier pairs keeps well enough. */
function partKey(a: AItem): string {
    const set = (s: ReadonlySet<unknown>): string => [...s].sort().join(",");
    const implicit = (side: EldritchSide): string => {
        const tiers = [...a.eldritch].map((key) => eldritchOf(key)[side]);
        return `${tiers.some((t) => t > 0)}${tiers.some((t) => t === 0)}`;
    };
    return [
        set(a.rarities),
        a.counts.total,
        a.counts.prefix,
        a.counts.suffix,
        a.crafted,
        a.fractures,
        set(a.corrupted),
        set(a.influences),
        implicit("exarch"),
        implicit("eater"),
    ].join("|");
}

/** The states reaching one point as parts: those with one key joined, the rest
 *  apart. Empty only for no states. Past `most` it calls `over` and joins
 *  the last ones to fit, so the rest of a refused craft is still checked. */
function partition(states: readonly AItem[], most: number, over: () => void): AItem[] {
    const byKey = new Map<string, AItem>();
    const add = (s: AItem): void => {
        const key = partKey(s);
        const held = byKey.get(key);
        byKey.set(key, held === undefined ? s : join(held, s));
    };
    states.forEach(add);
    if (byKey.size > Math.max(1, most)) over();
    while (byKey.size > Math.max(1, most)) {
        const [a, b] = [...byKey].slice(-2) as [[string, AItem], [string, AItem]];
        byKey.delete(a[0]);
        byKey.delete(b[0]);
        add(join(a[1], b[1]));
    }
    return [...byKey.values()];
}

/** One summary covering every part: what the trace shows of a point. */
function joinAll(parts: Parts): AItem {
    return parts.reduce(join);
}

/** How many entries a loop's settled invariants are kept for. */
const SETTLED_PER_LOOP = 16;

/** A loop's invariant for the parts it was entered with (`Checker.settled`). */
interface Settled {
    readonly entry: Parts;
    readonly invariant: Parts;
    readonly heads: readonly AItem[];
}

function sameParts(a: Parts, b: Parts): boolean {
    if (a.length !== b.length) return false;
    const byKey = new Map(b.map((s) => [partKey(s), s]));
    return a.every((s) => {
        const other = byKey.get(partKey(s));
        return other !== undefined && stateEqual(s, other);
    });
}

const isLive = (s: AItem | null): s is AItem => s !== null;

/** The present checker's state of what the item block declares. */
function initialAItem(bdd: BddManager, registry: Registry, decl: ItemDecl): AItem {
    const start = initialState(
        bdd,
        decl.base,
        decl.ilvl,
        decl.rarity,
        {
            prefixCount: decl.prefixCount,
            suffixCount: decl.suffixCount,
            present: decl.present,
            pinned: decl.pinned,
            crafted: decl.crafted,
            craftedTypes: decl.craftedTypes,
            ...(decl.fracturedTypes.length > 0 && { fractured: decl.fracturedTypes }),
            ...(decl.fracturedAnonymous > 0 && { fracturedAnonymous: decl.fracturedAnonymous }),
        },
        {
            influences: decl.influences,
            corrupted: decl.corrupted,
            ...(decl.exarch !== undefined && { exarch: decl.exarch.tier }),
            ...(decl.eater !== undefined && { eater: decl.eater.tier }),
            ...(decl.exarch?.types !== undefined && { exarchTypes: decl.exarch.types }),
            ...(decl.eater?.types !== undefined && { eaterTypes: decl.eater.types }),
            ...(decl.strands !== undefined && { strands: decl.strands }),
        },
    );
    // An anonymous affix is some modifier of its side the item could roll, so
    // a `has` may name it and a bench craft of its group may clash with it.
    const possible = new Set([...start.possible, ...start.craftedTypes]);
    // It is a natural roll, so its type is held to the natural rows: an
    // unveiled or bench row sharing the type is on the item only when the
    // block says so. A type an anonymous bench affix may be stays any row.
    const natural = new Map<TypeId, Set<ModId>>();
    for (const gen of ["prefix", "suffix"] as const) {
        if (decl.anonymousBy[gen] === 0) continue;
        for (const m of anonymousRows(start, registry, gen)) {
            possible.add(m.type);
            const rows = natural.get(m.type);
            if (rows) rows.add(m.id);
            else natural.set(m.type, new Set([m.id]));
        }
    }
    const tiers = new Map<TypeId, ReadonlySet<ModId>>([...start.tiers, ...decl.oneOf]);
    for (const [type, rows] of natural) {
        if (!start.possible.has(type) && !start.craftedTypes.has(type)) tiers.set(type, rows);
    }
    return { ...start, possible, tiers };
}

export function check(craft: Craft, ctx: CheckContext, tuning: CheckTuning = {}): CheckResult {
    return new Checker(ctx.registry, tuning.maxRounds, tuning.maxParts).run(craft);
}

class Checker {
    private readonly diagnostics: CheckDiagnostic[] = [];
    /** When > 0, suppress diagnostics, loop-invariant passes re-check the body
     *  and must not emit duplicates; only the final, real pass does. */
    private quiet = 0;
    /** How many diagnostics the quiet passes held back: a quiet run of a step
     *  that moves it found something to report. */
    private unsaid = 0;
    private readonly trace: TraceEntry[] = [];
    /** One BDD manager per check, shared by all states so `presence` ids compare. */
    private readonly bdd = new BddManager();
    /** Local predicate defs. */
    private readonly defs = new Map<string, DefEntry>();
    /** Local operation functions (`def name(p) { … }`). */
    private readonly procs = new Map<string, ProcEntry>();
    /** What a condition is resolved with. */
    private readonly env: PredEnv;
    /** Where statements are recorded: the trace, or a call's own while its
     *  body runs, so hover sees a call as one step. */
    private sink: TraceEntry[] = this.trace;
    private readonly inlined = new WeakMap<Stmt, NonNullable<TraceEntry["inlined"]>>();
    /** Stack of `restart` back-edge collectors, innermost loop last. A `restart`
     *  re-enters the innermost enclosing loop, so its state is a loop-head state
     *  that must join into that loop's invariant. */
    private readonly restartHeads: AItem[][] = [];
    /** The invariants already worked out, by loop body. An outer loop runs its
     *  body once a round until it settles, and an inner loop is entered with
     *  the same parts on most of those rounds: its invariant depends on
     *  nothing else, so it is worked out once for each. */
    private readonly settled = new WeakMap<readonly Stmt[], Settled[]>();
    private readonly bodies = new WeakMap<Stmt, readonly Stmt[]>();
    /** The statement being checked, and those already reported as reached by
     *  more parts than are kept apart. */
    private current: Stmt | undefined;
    private readonly tooMany = new WeakSet<Stmt>();
    /** The loops already reported as not settling within `maxRounds`. */
    private readonly unsettled = new WeakSet<Stmt>();

    constructor(
        private readonly registry: Registry,
        private readonly maxRounds = MAX_ROUNDS,
        private readonly maxParts = MAX_PARTS,
    ) {
        this.env = {
            registry,
            defs: this.defs,
            procs: this.procs,
            diag: (message, span) => this.diag(message, span),
        };
    }

    private apart(states: readonly AItem[]): AItem[] {
        return partition(states, this.maxParts, () => {
            // Reported from a quiet pass too: a loop may pass the limit only
            // on the rounds that settle it.
            const at = this.current;
            if (at === undefined || this.tooMany.has(at)) return;
            this.tooMany.add(at);
            this.diagnostics.push({
                message: `Too many different items reach this step to check each: more than ${this.maxParts} combinations of modifier counts, rarity, corruption and influence.`,
                span: at.span,
            });
        });
    }

    run(craft: Craft): CheckResult {
        this.collectDefs(craft.defs);
        this.collectProcs(craft.procs);
        const initial = this.elaborateItem(craft.item);
        if (initial === null) {
            return { ok: false, diagnostics: this.diagnostics, trace: this.trace };
        }
        this.trace.push({ span: craft.item.span, kind: "item", before: initial, after: initial });
        const flow = this.checkSeq([initial], craft.body);
        const result: CheckResult = {
            ok: this.diagnostics.length === 0,
            diagnostics: this.diagnostics,
            trace: this.trace,
            ...(flow.kind === "fall" && { finalState: joinAll(flow.parts) }),
        };
        return result;
    }

    /** The defs collected and every condition resolved quietly (`predicateResolver`). */
    resolver(craft: Craft): (pred: Pred, a: AItem) => RPred | null {
        this.quietly(() => {
            this.collectDefs(craft.defs);
            this.collectProcs(craft.procs);
        });
        return (pred, a) => this.quietly(() => this.resolvePred(pred, a)?.pred ?? null);
    }

    private diag(message: string, span: CheckDiagnostic["span"]): void {
        if (this.quiet > 0) {
            this.unsaid++;
            return;
        }
        this.diagnostics.push({ message, span });
    }

    /** Run `fn` with diagnostics AND trace suppressed, a probe/fixpoint pass that
     *  must not emit duplicates or pollute the real trace. */
    private quietly<T>(fn: () => T): T {
        this.quiet++;
        try {
            return fn();
        } finally {
            this.quiet--;
        }
    }

    // --- item block → initial state ---------------------------------------

    private elaborateItem(item: ItemBlock): AItem | null {
        const decl = declareItem(item, this.registry, (m, span) => this.diag(m, span));
        return decl === null ? null : initialAItem(this.bdd, this.registry, decl);
    }

    // --- statement sequencing ---------------------------------------------

    private checkSeq(entry: Parts, stmts: readonly Stmt[]): Flow {
        let parts = entry;
        // The joined item is the trace's alone, so a quiet pass never builds it.
        let joined: AItem | undefined;
        for (const [i, stmt] of stmts.entries()) {
            const outer = this.current;
            this.current = stmt;
            const flow = this.checkStmt(parts, stmt);
            this.current = outer;
            // Only the real (non-quiet) pass records, so each statement appears once.
            if (this.quiet === 0) {
                const before = joined ?? joinAll(parts);
                joined = flow.kind === "fall" ? joinAll(flow.parts) : undefined;
                const inlined = this.inlined.get(stmt);
                this.sink.push({
                    span: stmt.span,
                    kind: stmt.kind,
                    ...(this.sink !== this.trace && { stmt }),
                    before,
                    ...(joined !== undefined && { after: joined }),
                    ...(inlined !== undefined && { inlined }),
                });
            }
            if (flow.kind !== "fall") {
                const next = stmts[i + 1];
                if (next !== undefined) {
                    // A branch that ends as a restart may stop on its other arm.
                    const why =
                        flow.kind === "stop" || this.restartHeads.length === 0
                            ? "the craft always stops before it"
                            : stmt.kind === "restart"
                              ? "the loop always restarts before it"
                              : "every path before it stops or restarts";
                    this.diag(`this step can never run: ${why}`, next.span);
                }
                return flow;
            }
            parts = flow.parts;
        }
        return { kind: "fall", parts };
    }

    private checkStmt(parts: Parts, stmt: Stmt): Flow {
        switch (stmt.kind) {
            case "operation":
                return this.checkOperationOn(parts, stmt);
            case "restart": {
                // The loop invariant must fold in this back-edge: a `restart`
                // after an additive op can fill the item the same way falling off
                // the body end can.
                const frame = this.restartHeads[this.restartHeads.length - 1];
                if (frame !== undefined) frame.push(...parts);
                return { kind: "restart" };
            }
            case "stop":
                return { kind: "stop" };
            case "until":
                return this.checkUntil(parts, stmt);
            case "if":
                return this.checkIf(parts, stmt);
            case "call":
                return this.checkCall(parts, stmt);
            case "paramStep":
                // Inlining splices the bound steps in; one left standing was
                // never bound (the proc's own error was reported).
                this.diag(`parameter "${stmt.param}" was never given a value`, stmt.span);
                return { kind: "fall", parts };
        }
    }

    // --- operations --------------------------------------------------------

    /** The step on every part. One that fails on some part is reported once,
     *  and worded for the item over all the parts: "may be Magic or Rare" is
     *  what the craft's author can act on, where one part alone reads as if
     *  the step failed on every path. */
    private checkOperationOn(parts: Parts, stmt: Extract<Stmt, { kind: "operation" }>): Flow {
        const run = (a: AItem): AItem | null => this.checkOperation(a, stmt);
        const [only] = parts;
        let afters: (AItem | null)[];
        if (parts.length === 1 && only !== undefined) {
            afters = [run(only)];
        } else {
            const unsaid = this.unsaid;
            afters = this.quietly(() => parts.map(run));
            if (this.unsaid > unsaid && this.quiet === 0) {
                const reported = this.diagnostics.length;
                run(joinAll(parts));
                // The join is checked only for its wording; where it finds
                // nothing to say, the first part that fails speaks.
                for (const a of parts) {
                    if (this.diagnostics.length > reported) break;
                    run(a);
                }
            }
        }
        const falls = afters.filter(isLive);
        return falls.length === 0 ? { kind: "stop" } : { kind: "fall", parts: this.apart(falls) };
    }

    /** Look the method up, bind its arguments, build its operations and run them.
     *  An unknown method, or one the catalog cannot build, leaves the state as it
     *  was; one whose check fails continues from the state it would have left.
     *  `null` when the method leaves no item. */
    private checkOperation(a: AItem, stmt: Extract<Stmt, { kind: "operation" }>): AItem | null {
        const method = findMethod(stmt.words);
        if (method === undefined) {
            this.diag(unknownOperation(stmt.words), stmt.span);
            return a;
        }
        const literals: Literal[] = [];
        for (const arg of stmt.args) {
            if (arg.kind === "param") {
                this.diag(`parameter "${arg.param}" was never given a value`, stmt.span);
                return a;
            }
            literals.push(arg);
        }
        const built = method.build(literals, a, this.registry);
        if ("refused" in built) {
            this.diag(built.refused, stmt.span);
            return a;
        }
        const result = runMethod(a, built, this.registry);
        if (!result.ok) {
            const carriers = (result.under ?? []).map((t) => `"${this.registry.typeLabel(t)}"`);
            const where =
                carriers.length > 0
                    ? `\nThis is so where the item has ${carriers.join(" and ")}, which it may have here — settle it with an 'if has' first.`
                    : "";
            this.diag(preconditionMessage(a, result.failure) + where, stmt.span);
        }
        // A method that leaves no item on any outcome ends the path, as `stop` does.
        return result.ended ? null : result.state;
    }

    // --- narrowing (if / else) --------------------------------------------

    private checkIf(parts: Parts, stmt: Extract<Stmt, { kind: "if" }>): Flow {
        const all = joinAll(parts);
        const resolved = this.resolvePred(stmt.pred, all);
        const rpred = this.condition(stmt.pred, resolved);

        // A narrowed count may leave a proven "≥k of these suffixes" below the
        // suffix count's new floor, so the presence facts are pushed back in.
        const narrow = (positive: boolean): AItem[] =>
            this.apart(this.tightened(this.refineParts(parts, rpred, positive)));
        const thenParts = narrow(true);
        const elseParts = narrow(false);

        if (thenParts.length === 0) {
            this.diag(
                `the 'if' branch can never run: ${describePred(stmt.pred)} is impossible here${levelReasons(resolved, (t) => isGuaranteed(all, t))}`,
                stmt.pred.span,
            );
        }
        if (elseParts.length === 0 && stmt.elseBody !== undefined) {
            this.diag(
                `the 'else' branch can never run: ${describePred(stmt.pred)} always holds here`,
                stmt.pred.span,
            );
        }

        const falls: AItem[] = [];
        // An arm that ends the path contributes nothing downstream; when no arm
        // falls through, the statement ends the path as its arms did (a restart
        // over a stop, since the loop is re-entered on that arm).
        let ended: Flow | null = null;
        const arm = (entry: Parts, body: readonly Stmt[]): void => {
            const f = this.checkSeq(entry, body);
            if (f.kind === "fall") falls.push(...f.parts);
            else if (ended === null || f.kind === "restart") ended = f;
        };
        if (thenParts.length > 0) arm(thenParts, stmt.body);
        if (elseParts.length > 0) arm(elseParts, stmt.elseBody ?? []);

        if (falls.length === 0) return ended ?? { kind: "fall", parts };
        const live = this.tightened(falls);
        return { kind: "fall", parts: this.apart(live.length > 0 ? live : falls) };
    }

    // --- loops (until) -----------------------------------------------------

    private checkUntil(parts: Parts, stmt: Extract<Stmt, { kind: "until" }>): Flow {
        const resolved = this.resolvePred(stmt.pred, joinAll(parts));
        const rpred = this.condition(stmt.pred, resolved);

        // Compute the loop invariant (a quiet join-fixpoint) and probe the exit
        // from it, quietly: a loop that needs several iterations to reach its
        // goal (two annuls from a full item to two open slots) is only
        // unsatisfiable when no head state of the whole invariant satisfies the
        // predicate. Report that root cause instead of a downstream symptom.
        const { invariant, heads } = this.loopInvariant(parts, stmt.body, rpred);
        // The body runs only where the exit predicate is false; a head state that
        // already satisfies it leaves at once. An inner loop entered from an outer
        // loop's invariant would otherwise run its body on states no path
        // continues from.
        const entering = this.apart(this.refineParts(invariant, rpred, false));
        if (entering.length === 0) {
            this.diag(
                `this loop's body never runs: ${describePred(stmt.pred)} already holds here`,
                stmt.pred.span,
            );
            return { kind: "fall", parts };
        }
        // The states at the head are the entry and the body's results, so the
        // exits are the entry where it already satisfies the predicate and those
        // results where they do; the invariant would blur the two.
        const leaving = rpred === null ? [] : this.refineParts(parts, rpred, true);
        const exits = (heads: readonly AItem[]): AItem[] =>
            this.apart(this.tightened([...leaving, ...this.refineParts(heads, rpred, true)]));
        // The invariant's last round ran the body from these very parts.
        const probe = heads;
        if (rpred !== null && exits(probe).length === 0) {
            const joined = joinAll(invariant);
            this.diag(
                `this loop can never exit: ${describePred(stmt.pred)} can never become true here${levelReasons(resolved, (t) => isGuaranteed(joined, t))}`,
                stmt.pred.span,
            );
            return { kind: "fall", parts: probe.length > 0 ? this.apart(probe) : invariant };
        }

        // Then run the body once more FROM the invariant, the real pass that
        // emits the loop's diagnostics and trace, and catches a precondition that
        // only fails on a later iteration (`until has X { exalt }` eventually fills
        // the item). On exit the exit predicate is known to hold: the after-state
        // is every loop-head state refined by it.
        // A quiet pass has nothing to emit, so what the probe found stands.
        const exit = exits(this.quiet > 0 ? probe : this.headStates(entering, stmt.body));
        return { kind: "fall", parts: exit.length > 0 ? exit : invariant };
    }

    /** Run a loop body while collecting the states of any `restart` inside it
     *  (back-edges to this loop's head). */
    private runBody(entry: Parts, body: readonly Stmt[]): { flow: Flow; restarts: AItem[] } {
        const frame: AItem[] = [];
        this.restartHeads.push(frame);
        try {
            return { flow: this.checkSeq(entry, body), restarts: frame };
        } finally {
            this.restartHeads.pop();
        }
    }

    /** Run the body once from `entry` and return every state that re-enters the
     *  loop head: the fall-off-end states (when the body falls through) plus every
     *  `restart` back-edge collected inside it. */
    private headStates(entry: Parts, body: readonly Stmt[]): AItem[] {
        const { flow, restarts } = this.runBody(entry, body);
        return flow.kind === "fall" ? [...flow.parts, ...restarts] : restarts;
    }

    /** A condition as the parts are narrowed by it. One that compares a value
     *  is resolved against the item it narrows: the rows it may be are read off
     *  the item, and a part may hold the modifier at a row the join of the parts
     *  does not single out. */
    private condition(pred: Pred, resolved: Resolved | null): Cond | null {
        if (resolved === null) return null;
        return { pred, rpred: resolved.pred, perPart: comparesValue(resolved.pred) };
    }

    /** Each state where the condition holds (`positive`) or fails, the ones where
     *  it cannot dropped; all of them while the condition did not resolve. */
    private refineParts(states: readonly AItem[], cond: Cond | null, positive: boolean): AItem[] {
        const narrowed = (h: AItem): AItem | null => {
            if (cond === null) return h;
            if (!cond.perPart) return refine(h, cond.rpred, positive);
            // A part the condition does not resolve on may go either way.
            const own = this.quietly(() => this.resolvePred(cond.pred, h));
            return own === null ? h : refine(h, own.pred, positive);
        };
        return states.map(narrowed).filter(isLive);
    }

    /**
     * Push presence knowledge into the count ranges: a proven "≥k of {types}"
     * where all those types sit in one generation forces that generation's count
     * ≥ k (and guaranteed types each count for one). A disjunction of resistance
     * suffixes therefore pins the suffix count, and, via the total coupling, the
     * prefix count, where the presence BDD alone left it a range. A sound
     * tightening: it only ever removes a spurious slot, never adds one. `null`
     * where the counts cannot hold what is proven present: no item is so.
     */
    private tightenCounts(a: AItem): AItem | null {
        // A type with rows on both sides has its side guessed from this base;
        // a guess may narrow a count, but is no ground to rule the state out.
        let guessed = false;
        const genOf = (t: TypeId): Gen => {
            if (this.registry.sidesOfType(t).size !== 1) guessed = true;
            return (
                rollableGen(this.registry.catalog, a.base, a.ilvl, t, this.tagsOf(a)) ?? "prefix"
            );
        };
        const guaranteed = guaranteedTypes(a);
        const cards = cardinalityGuarantees(a);
        const minFor = (gen: Gen): number => {
            let n = 0;
            for (const t of guaranteed) if (genOf(t) === gen) n++;
            // Groups that share a type may be met by that one modifier ("fire, or
            // cold and lightning" reads as "fire or cold" and "fire or lightning"),
            // so only groups with no type in common add up.
            const counted = new Set<TypeId>();
            for (const c of [...cards].sort((x, y) => y.atLeast - x.atLeast)) {
                if (!c.types.every((t) => genOf(t) === gen)) continue;
                if (c.types.some((t) => counted.has(t))) continue;
                n += c.atLeast;
                for (const t of c.types) counted.add(t);
            }
            return n;
        };
        let s: AItem | null = a;
        const minS = minFor("suffix");
        if (minS > 0) s = refine(s, cmpAtLeast("suffixCount", minS));
        if (s !== null) {
            const minP = minFor("prefix");
            if (minP > 0) s = refine(s, cmpAtLeast("prefixCount", minP));
        }
        if (s === null) return guessed ? a : null;
        return this.dropUnnamed(s);
    }

    /** The states with their counts tightened, without those the tightening
     *  shows to hold no item: a part with one suffix that the condition proved
     *  to have two of the resistances. */
    private tightened(states: readonly AItem[]): AItem[] {
        return states.map((s) => this.tightenCounts(s)).filter(isLive);
    }

    /**
     * The reduction the other way: a side whose count the guaranteed types fill
     * carries no other modifier, so every other type that sits only on that
     * side leaves `possible`. After `until prefixCount == 1` on an item whose
     * one named prefix is sure, the prefixes a reforge might have rolled are
     * gone for good, and a later bench craft of their group is not refused for
     * them.
     */
    private dropUnnamed(a: AItem): AItem {
        const guaranteed = guaranteedTypes(a);
        const onlyOn = (t: TypeId, gen: Gen): boolean => {
            const sides = this.registry.sidesOfType(t);
            return sides.size === 1 && sides.has(gen);
        };
        const full = (["prefix", "suffix"] as const).filter((gen) => {
            let named = 0;
            for (const t of guaranteed) if (onlyOn(t, gen)) named++;
            const max = gen === "prefix" ? a.counts.prefix[1] : suffixRange(a)[1];
            return max <= named;
        });
        if (full.length === 0) return a;
        const possible = new Set(a.possible);
        for (const t of a.possible) {
            if (guaranteed.has(t)) continue;
            if (full.some((gen) => onlyOn(t, gen))) possible.delete(t);
        }
        if (possible.size === a.possible.size) return a;
        const tiers = new Map([...a.tiers].filter(([t]) => possible.has(t)));
        const values = new Map([...a.values].filter(([t]) => possible.has(t)));
        return { ...a, possible, tiers, values };
    }

    /**
     * The loop invariant: the least parts (by join) covering the entry and every
     * "continue" state (a back-edge whose exit predicate is still false). The
     * lattice is finite and the iteration monotone, so this converges. The
     * loop ends only at a fixpoint, never at a round count: an invariant short
     * of it would leave later rounds of the body unchecked. A loop past
     * `MAX_ROUNDS` is refused, and to judge the rest of the craft its parts
     * become one whose moving ranges jump to their bounds (`widenRanges`),
     * from where a fixpoint is reached in a few rounds more.
     */
    private loopInvariant(
        entry: Parts,
        body: readonly Stmt[],
        rpred: Cond | null,
    ): { invariant: Parts; heads: readonly AItem[] } {
        const start = this.apart(entry);
        const known = this.settled.get(body) ?? [];
        // `stateEqual` leaves the base and level out.
        const [first] = start;
        const hit = known.find(
            (k) =>
                k.entry.every((s) => s.base === first?.base && s.ilvl === first.ilvl) &&
                sameParts(k.entry, start),
        );
        if (hit !== undefined) return hit;
        return this.quietly(() => {
            let invariant: Parts = start;
            let heads: readonly AItem[] = [];
            for (let i = 0; ; i++) {
                const entering = this.apart(this.refineParts(invariant, rpred, false));
                if (entering.length === 0) break; // every head state leaves at once
                heads = this.headStates(entering, body);
                const continues = this.refineParts(heads, rpred, false);
                if (continues.length === 0) break;
                const next = this.grown(invariant, continues, i);
                if (sameParts(next, invariant)) break;
                invariant = next;
            }
            if (known.length >= SETTLED_PER_LOOP) known.shift();
            known.push({ entry: start, invariant, heads });
            this.settled.set(body, known);
            return { invariant, heads };
        });
    }

    /** The invariant after round `i` brought `continues` back to the head. */
    private grown(invariant: Parts, continues: readonly AItem[], i: number): Parts {
        if (i < this.maxRounds) return this.apart([...invariant, ...continues]);
        const at = this.current;
        if (at !== undefined && !this.unsettled.has(at)) {
            this.unsettled.add(at);
            this.diagnostics.push({
                message: `The item this loop works on is still changing after ${this.maxRounds} rounds, too many to follow.`,
                span: at.span,
            });
        }
        const prev = joinAll(invariant);
        return [widenRanges(prev, widenPresence([prev, ...continues].reduce(join)))];
    }

    // --- predicate defs ----------------------------------------------------

    private collectDefs(defs: readonly Def[]): void {
        collectDefs(defs, (m, span) => this.diag(m, span), this.defs);
    }

    private collectProcs(procs: readonly ProcDef[]): void {
        collectProcs(procs, this.defs, (m, span) => this.diag(m, span), this.procs);
    }

    /** Inlining lets a `restart` inside the body re-enter the caller's enclosing
     *  loop, so the body composes exactly as if written in place. The call site
     *  is traced as one step; the body's own trace hangs off it. */
    private checkCall(parts: Parts, stmt: Extract<Stmt, { kind: "call" }>): Flow {
        const entry = this.procs.get(stmt.name);
        if (!entry) {
            if (this.defs.has(stmt.name)) {
                this.diag(
                    `"${stmt.name}" is a condition, use it inside 'if' or 'until', not as a step`,
                    stmt.span,
                );
            } else {
                this.diag(`unknown def "${stmt.name}"`, stmt.span);
            }
            return { kind: "fall", parts };
        }
        const { proc, paramTypes, valid } = entry;
        if (!valid) return { kind: "fall", parts }; // the proc's own error was reported
        const env = bindArgs(stmt.name, proc.params, paramTypes, stmt.args, stmt.span, (m, span) =>
            this.diag(m, span),
        );
        if (env === null) return { kind: "fall", parts };

        // One body for a call site, so a loop in it is the same loop on every
        // pass and its invariant is found again (`settled`).
        const body = this.bodies.get(stmt) ?? substituteStmts(proc.body, env);
        this.bodies.set(stmt, body);
        const trace: TraceEntry[] = [];
        const outer = this.sink;
        this.sink = trace;
        try {
            return this.checkSeq(parts, body);
        } finally {
            this.sink = outer;
            this.inlined.set(stmt, { body, trace });
        }
    }

    // --- predicate resolution ---------------------------------------------

    /** What resolving a condition reads of the present checker's item. */
    private view(a: AItem): ResolveView {
        let carry: ((m: Mod) => boolean) | undefined;
        return {
            base: a.base,
            ilvl: a.ilvl,
            tags: this.tagsOf(a),
            mayCarry: (m) => (carry ??= this.carriedRows(a))(m),
        };
    }

    /** The rows of a type the item may be at, read under the tags a present
     *  modifier may add too (`carriedRows`). */
    private carriedRows(a: AItem): (m: Mod) => boolean {
        const influence = influenceTagsOf(a, this.registry);
        const itemTags = new Set([...a.base.tags, ...influence.sure]);
        const maybeTags = new Set<TagId>(influence.maybe);
        for (const t of a.possible) {
            if (isExcluded(a, t)) continue;
            for (const tag of this.registry.addsTagsOfType(t)) maybeTags.add(tag);
        }
        return carriedRows(this.registry, a.base, itemTags, maybeTags, (t) => a.tiers.get(t));
    }

    private resolvePred(pred: Pred, a: AItem): Resolved | null {
        return resolvePred(pred, this.view(a), this.env);
    }

    /** The influence tags the item carries on any path: a predicate names what
     *  the item may have, so its influence rows resolve and tier here. */
    private tagsOf(a: AItem): ReadonlySet<TagId> {
        return influenceTagsAny(a, this.registry);
    }
}

/** A resolved condition with the words it came from, for the parts whose
 *  own item decides what it means (`Checker.condition`). */
interface Cond {
    readonly pred: Pred;
    readonly rpred: RPred;
    readonly perPart: boolean;
}

/**
 * The checker's reading of a guide's conditions, for a consumer that evaluates
 * them against another model (the cost layer): the predicate defs collected,
 * each condition resolved against the item it is read on, quietly, so nothing
 * is reported twice. `null` where the checker could not resolve it.
 */
export function predicateResolver(
    craft: Craft,
    registry: Registry,
): (pred: Pred, a: AItem) => RPred | null {
    return new Checker(registry).resolver(craft);
}
