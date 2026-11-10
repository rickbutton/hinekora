/**
 * The expected cost of a guide: one walk over the syntax tree beside the
 * checker's trace, carrying the probability of reaching each step and, while
 * the tracker can follow the item, a distribution over it (`track.ts`). A loop
 * the tracker follows is solved as a chain (`chain.ts`); any other runs its
 * body once over the chance one attempt reaches its exit, judged on the last
 * roll of the body and the conditions passed on the way to it (the attempts
 * taken as independent trials); a branch splits the mass by its condition's
 * chance; a `restart` goes back to its loop's head and a `stop` ends the craft (docs/cost.md
 * §3, §6).
 */
import type { Craft, Pred, Stmt } from "../ast/ast.js";
import type { SourceSpan } from "../ast/span.js";
import type { Gen, ModId, TypeId } from "../model/ids.js";
import type { Mod } from "../model/mod.js";
import type { Registry } from "../resolve/registry.js";
import { type AItem, type RPred, refine } from "../check/astate.js";
import { type CheckResult, predicateResolver, type TraceEntry } from "../check/check.js";
import { findMethod, type Literal } from "../check/methods.js";
import { rollableGen } from "../resolve/tiers.js";
import { influenceTagsAny } from "../check/ops.js";
import { chance } from "./chance.js";
import { advance, chain, type ChainState, type ChainStep } from "./chain.js";
import { guaranteedTypes, isExcluded, rarityOf, sideCap, suffixRange } from "../check/astate.js";
import { addPrices, inChaos, type Price, type Prices, unitCost } from "./prices.js";
import { type Reading, type Roll, rollOf, unmodelled, withPresent } from "./roll.js";
import {
    ASSUMED_ODDS,
    type Carried,
    genOfOn,
    holdsOn,
    predLeaves,
    splitCarried,
    Tracker,
    TrackerOverflow,
} from "./track.js";

/** The ends of a figure over the two items at the ends of what the checker
 *  allows at the step (`Reading`), given only where they differ. */
export interface Bounds {
    readonly low: number;
    readonly high: number;
}

export interface StepCost {
    readonly span: SourceSpan;
    readonly kind: Stmt["kind"];
    /** The chance the step is reached in one pass of its enclosing block; inside
     *  a repeat, in one round. */
    readonly reached: number;
    /** How many times it is expected to run over the whole guide. */
    readonly runs: number;
    /** What one run consumes; absent when the price is not known. */
    readonly unit?: readonly Price[];
    /** `unit` times `runs`. */
    readonly expected?: readonly Price[];
    /** A loop: the chance one attempt reaches its exit, and the attempts it takes. */
    readonly attempts?: { readonly chance: number; readonly expected: number };
    /** A branch: the chance its condition holds here. */
    readonly branch?: number;
    /** Why a figure is missing or approximate, in the guide's words. */
    readonly note?: string;
    /** The step has no figure: a loop whose rounds could not be worked out, or
     *  a step inside one, whose `runs` then count a single round. */
    readonly unknown?: true;
    /** The spread of `runs`, of a loop's expected rounds and of a branch's
     *  chance over the item's open counts, where they differ. */
    readonly runsRange?: Bounds;
    readonly attemptsRange?: Bounds;
    /** The spread of a loop's chance per round. */
    readonly chanceRange?: Bounds;
    readonly branchRange?: Bounds;
}

export interface CostReport {
    readonly steps: readonly StepCost[];
    /** Every currency the guide is expected to spend, summed. */
    readonly total: readonly Price[];
    /** The total under the snapshot, where every item has a price. */
    readonly chaos?: number;
    readonly divine?: number;
    /** The spread of `chaos` over the item's open counts, where it differs. */
    readonly chaosRange?: Bounds;
    /** The items the snapshot could not price; a step whose price is unknown says
     *  so in its own note. */
    readonly unpriced: readonly string[];
    /** The chance the craft ends on a `stop` before its last step. */
    readonly stopped: number;
    /** Some loop's rounds are not known: `total` leaves its steps out, and no
     *  figure in Chaos Orbs is given. */
    readonly unknown: boolean;
}

/** The conditions passed since the last roll, whose joint chance with the next
 *  condition is the mass that reaches it. */
interface Path {
    readonly roll: Roll;
    /** The item after the roll's statement, for what the roll leaves to the checker. */
    readonly after: AItem;
    readonly conditions: readonly RPred[];
    /** The mass at the roll: a branch's mass is this times the chance of its
     *  conditions over the roll. */
    readonly base: number;
}

/** One way of being at a point: with this much mass, on this path. A sequence
 *  carries a few of them, one per arm of the branches it passed. */
interface Branch {
    readonly mass: number;
    readonly path: Path | undefined;
    /** Where a loop solved as a chain left the item, until a step changes it. */
    readonly states?: Carried;
}

/** How many branches a sequence keeps apart before the lightest are folded
 *  into the heaviest. */
const BRANCH_LIMIT = 12;

interface Frame {
    /** The expected runs of one pass through the enclosing sequence. */
    readonly scale: number;
    /** Mass ending the craft (`stop`), per pass. */
    stopped: number;
    /** Mass a `restart` sent back to the head of the loop around it. */
    restarted: number;
    /** The ways of being at each `restart`, with the item the check has
     *  there, where the loop around it reads its rounds as independent: a
     *  restart is at the loop's head, so its exit is asked of them too. */
    again?: { readonly branch: Branch; readonly at: AItem | undefined }[];
}

/** One walk's figures under one reading of the item's open counts. */
interface Walk {
    readonly steps: readonly StepCost[];
    readonly total: readonly Price[];
    readonly chaos?: number;
    readonly stopped: number;
    /** Every step was read on the tracker's states, none on the checker's item alone. */
    readonly followed: boolean;
}

export function costOf(
    craft: Craft,
    result: CheckResult,
    registry: Registry,
    snapshot?: Prices,
): CostReport {
    const estimate = walk(craft, result, registry, snapshot, "estimate");
    // The two ends of what the checker allows, for the spread beside the
    // estimate. A walk the tracker followed throughout reads no open range but
    // the memory strands; with those settled the ends are the estimate.
    const strandsOpen = result.trace.some((e) => e.before.strands[0] !== e.before.strands[1]);
    const ends =
        estimate.followed && !strandsOpen
            ? [estimate, estimate]
            : [
                  walk(craft, result, registry, snapshot, "floors"),
                  walk(craft, result, registry, snapshot, "ceilings"),
              ];
    const unknown = estimate.steps.some((s) => s.unknown);
    const unpriced = new Set<string>();
    for (const p of estimate.total) {
        if (snapshot === undefined || inChaos([p], snapshot) === undefined) unpriced.add(p.item);
    }
    const { steps, reliable } = withBounds(
        estimate.steps,
        ends.map((w) => w.steps),
    );
    const chaosRange =
        estimate.chaos === undefined || !reliable || unknown
            ? undefined
            : bounds(
                  estimate.chaos,
                  ends.map((w) => w.chaos),
              );
    return {
        steps,
        total: estimate.total,
        ...(snapshot !== undefined &&
            !unknown &&
            estimate.chaos !== undefined && {
                chaos: estimate.chaos,
                divine: estimate.chaos / snapshot.chaosPerDivine,
            }),
        ...(chaosRange !== undefined && { chaosRange }),
        unpriced: [...unpriced],
        stopped: estimate.stopped,
        unknown,
    };
}

function walk(
    craft: Craft,
    result: CheckResult,
    registry: Registry,
    snapshot: Prices | undefined,
    reading: Reading,
): Walk {
    const walker = new Walker(craft, result, registry, reading);
    const top: Frame = { scale: 1, stopped: 0, restarted: 0 };
    walker.sequence(craft.body, [walker.start()], top);
    const steps = walker.steps;
    let total: Price[] = [];
    for (const s of steps) if (s.expected) total = addPrices(total, s.expected);
    let chaos: number | undefined = 0;
    for (const p of total) {
        const c = snapshot === undefined ? undefined : inChaos([p], snapshot);
        if (c === undefined) chaos = undefined;
        else if (chaos !== undefined) chaos += c;
    }
    return {
        steps,
        total,
        ...(chaos !== undefined && { chaos }),
        // A restart outside every loop has no head to go back to: the craft ends.
        stopped: Math.min(1, top.stopped + top.restarted),
        followed: !walker.lost && (walker.tracker?.misses ?? 1) === 0,
    };
}

/** The spread of a figure over the readings, when they do not agree. */
function bounds(estimate: number, others: readonly (number | undefined)[]): Bounds | undefined {
    let low = estimate;
    let high = estimate;
    for (const x of others) {
        if (x === undefined) return undefined;
        low = Math.min(low, x);
        high = Math.max(high, x);
    }
    const scale = Math.max(1, Math.abs(estimate));
    return high - low > 1e-9 * scale ? { low, high } : undefined;
}

/**
 * The estimate's steps, each with the spread of its figures over the other
 * readings' walks; a step a reading never reached counts as run no times. A
 * step whose figure rests on an assumption (its note) in any reading gets no
 * spread, nor do the steps inside a loop or branch so judged: a difference of
 * assumption is not a difference of item. `reliable` is false when one was
 * left out, since the total's spread would carry it.
 */
function withBounds(
    estimate: readonly StepCost[],
    others: readonly (readonly StepCost[])[],
): { steps: StepCost[]; reliable: boolean } {
    const key = (s: StepCost): string => `${s.kind}@${s.span.start.offset}`;
    const indexed = others.map((steps) => {
        const byKey = new Map<string, StepCost[]>();
        for (const s of steps) {
            const list = byKey.get(key(s));
            if (list) list.push(s);
            else byKey.set(key(s), [s]);
        }
        return byKey;
    });
    const seen = new Map<string, number>();
    const peersOf = (s: StepCost): (StepCost | undefined)[] => {
        const k = key(s);
        const n = seen.get(k) ?? 0;
        seen.set(k, n + 1);
        return indexed.map((byKey) => byKey.get(k)?.[n]);
    };
    const assumed: { start: number; end: number }[] = [];
    const peerLists = estimate.map((s) => peersOf(s));
    estimate.forEach((s, i) => {
        if (s.kind !== "until" && s.kind !== "if") return;
        if (
            s.note !== undefined ||
            peerLists[i]!.some((p) => p !== undefined && p.note !== s.note)
        ) {
            assumed.push({ start: s.span.start.offset, end: s.span.end.offset });
        }
    });
    const inside = (s: StepCost): boolean =>
        assumed.some((a) => s.span.start.offset >= a.start && s.span.end.offset <= a.end);
    const steps = estimate.map((s, i) => {
        if (s.note !== undefined || inside(s)) return s;
        const peers = peerLists[i]!;
        const runs = bounds(
            s.runs,
            peers.map((p) => p?.runs ?? 0),
        );
        const attempts =
            s.attempts === undefined
                ? undefined
                : bounds(
                      s.attempts.expected,
                      peers.map((p) => p?.attempts?.expected ?? s.attempts!.expected),
                  );
        const chance =
            s.attempts === undefined
                ? undefined
                : bounds(
                      s.attempts.chance,
                      peers.map((p) => p?.attempts?.chance ?? s.attempts!.chance),
                  );
        const branch =
            s.branch === undefined
                ? undefined
                : bounds(
                      s.branch,
                      peers.map((p) => p?.branch ?? s.branch!),
                  );
        return {
            ...s,
            ...(runs !== undefined && { runsRange: runs }),
            ...(attempts !== undefined && { attemptsRange: attempts }),
            ...(chance !== undefined && { chanceRange: chance }),
            ...(branch !== undefined && { branchRange: branch }),
        };
    });
    return { steps, reliable: assumed.length === 0 };
}

/** The note on a loop whose rounds were cut off before they settled. */
const ESTIMATED =
    "the item drifts between easier and harder states for thousands of rounds; the rounds beyond those followed are estimated";

/** The note on a step where some state of the item could not be followed. */
const MISSED =
    "this step can leave the item in more ways than could be followed, so the steps after it are read on every item the check allows at once";

/** The note on a loop read as independent rounds because a step in it could
 *  not be followed. */
const UNFOLLOWED =
    "a step in this loop can leave the item in more ways than could be followed, so every round is read alike, on every item the check allows at once";

/** The sides' caps on an item of its rarity. */
function capsOf(item: AItem): Record<Gen, number> {
    const rarity = rarityOf(item) ?? "rare";
    return {
        prefix: sideCap("prefix", rarity, item.base),
        suffix: sideCap("suffix", rarity, item.base),
    };
}

function massOf(branches: readonly Branch[]): number {
    let m = 0;
    for (const b of branches) m += b.mass;
    return m;
}

/** Keep the mixture small: the lightest branches join the heaviest. */
function trim(branches: readonly Branch[]): Branch[] {
    const live = branches.filter((b) => b.mass > 0);
    if (live.length <= BRANCH_LIMIT) return live;
    const sorted = [...live].sort((a, b) => b.mass - a.mass);
    const kept = sorted.slice(0, BRANCH_LIMIT - 1);
    const rest = massOf(sorted.slice(BRANCH_LIMIT - 1));
    const heaviest = kept[0]!;
    // The folded mass may have come from elsewhere: its states are not the heaviest's.
    const mixed = sorted.slice(BRANCH_LIMIT - 1).some((b) => b.states !== heaviest.states);
    const mass = heaviest.mass + rest;
    kept[0] = mixed ? { mass, path: heaviest.path } : { ...heaviest, mass };
    return kept;
}

/** Several branches' states as one, each by its branch's share of the mass. */
function mixture(states: readonly Carried[], branches: readonly Branch[]): Carried | undefined {
    const mass = massOf(branches);
    const first = states[0];
    if (first === undefined || !(mass > 0)) return undefined;
    const dist: { state: ChainState; weight: number }[] = [];
    states.forEach((c, i) => {
        const share = branches[i]!.mass / mass;
        for (const s of c.dist) dist.push({ state: s.state, weight: s.weight * share });
    });
    return { ...first, dist };
}

/** The branches with what a solved loop said about the item forgotten. */
function withoutStates(branches: readonly Branch[]): Branch[] {
    return branches.map((b) => ({ mass: b.mass, path: b.path }));
}

class Walker {
    readonly steps: StepCost[] = [];
    private readonly byStart = new Map<string, TraceEntry>();
    /** The traces of the calls being walked, innermost last. */
    private readonly calls: Map<Stmt, TraceEntry>[] = [];
    /** The item a statement is judged on where the trace's is not it: the
     *  first step of a loop body reads the item the loop finds, not the join
     *  over every round, so the attempts are taken alike. */
    private readonly firstSteps = new Map<Stmt, AItem>();
    private readonly resolve: (pred: Pred, a: AItem) => RPred | null;
    /** The guide's named modifiers, tracked from the item block on. */
    readonly tracker: Tracker | undefined;
    /** Some step was read on the checker's item rather than the tracked states. */
    lost = false;
    /** How many loops whose rounds are not known the walk is inside. */
    private unknown = 0;

    /** `f` with every step it records marked as having no figure. */
    private unknowable<T>(f: () => T): T {
        this.unknown++;
        try {
            return f();
        } finally {
            this.unknown--;
        }
    }

    constructor(
        craft: Craft,
        result: CheckResult,
        private readonly registry: Registry,
        private readonly reading: Reading,
    ) {
        for (const e of result.trace) this.byStart.set(`${e.kind}@${e.span.start.offset}`, e);
        this.resolve = predicateResolver(craft, registry);
        this.first = result.trace[0]?.before;
        this.tracker = this.trackerFor(craft, result);
    }

    /** The item block's item. */
    private readonly first: AItem | undefined;

    /** Every condition and bench craft of the guide, read on the checker's
     *  item where it stands, names what the tracker follows. */
    private trackerFor(craft: Craft, result: CheckResult): Tracker | undefined {
        const first = result.trace[0]?.before;
        if (first === undefined) return undefined;
        const items: AItem[] = [];
        const collect = (trace: readonly TraceEntry[]): void => {
            for (const e of trace) {
                items.push(e.before);
                if (e.after !== undefined) items.push(e.after);
                if (e.inlined !== undefined) collect(e.inlined.trace);
            }
        };
        collect(result.trace);
        const preds: RPred[] = [];
        const crafted: TypeId[] = [];
        const visit = (stmts: readonly Stmt[]): void => {
            for (const s of stmts) {
                const e = this.traced(s);
                if (s.kind === "until" || s.kind === "if") {
                    const r = e === undefined ? null : this.resolve(s.pred, e.before);
                    if (r !== null) preds.push(r);
                    visit(s.body);
                    if (s.kind === "if") visit(s.elseBody ?? []);
                } else if (s.kind === "call" && e?.inlined !== undefined) {
                    const body = e.inlined.body;
                    this.within(e, () => visit(body));
                } else if (s.kind === "operation" && s.words[0] === "bench" && e !== undefined) {
                    const literals: Literal[] = [];
                    for (const arg of s.args) if (arg.kind !== "param") literals.push(arg);
                    const mod = this.benchMod(literals, e.before);
                    if (mod !== undefined) crafted.push(mod.type);
                }
            }
        };
        visit(craft.body);
        return new Tracker(this.registry, first, items, preds, crafted);
    }

    /** What `f` reads off the tracked states, or undefined once they are too
     *  many to follow, the walk then read on the checker's item. */
    private untilOverflow<T>(f: () => T): T | undefined {
        try {
            return f();
        } catch (e) {
            if (!(e instanceof TrackerOverflow)) throw e;
            this.lost = true;
            return undefined;
        }
    }

    /** Where the guide starts: the item block as the tracker's states, when it
     *  settles them. */
    start(): Branch {
        const states =
            this.tracker === undefined || this.first === undefined
                ? undefined
                : this.untilOverflow(() => this.tracker!.statesIn(this.first!, this.reading));
        return {
            mass: 1,
            path: undefined,
            ...(states !== undefined && {
                states: this.tracker!.carried(
                    states.map((o) => ({ state: o.state, weight: o.prob })),
                ),
            }),
        };
    }

    private entry(s: Stmt): TraceEntry | undefined {
        const e = this.traced(s);
        const before = this.firstSteps.get(s);
        return e === undefined || before === undefined ? e : { ...e, before };
    }

    /** The checker's entry for a statement: inside a loop, the join over its rounds. */
    private traced(s: Stmt): TraceEntry | undefined {
        for (let i = this.calls.length - 1; i >= 0; i--) {
            const e = this.calls[i]!.get(s);
            if (e !== undefined) return e;
        }
        return this.byStart.get(`${s.kind}@${s.span.start.offset}`);
    }

    /** `f` with a call's body read against the call's own trace, statement by
     *  statement, since one written statement may run there more than once. */
    private within<T>(call: TraceEntry, f: () => T): T {
        const scope = new Map<Stmt, TraceEntry>();
        for (const e of call.inlined?.trace ?? []) if (e.stmt !== undefined) scope.set(e.stmt, e);
        this.calls.push(scope);
        try {
            return f();
        } finally {
            this.calls.pop();
        }
    }

    sequence(stmts: readonly Stmt[], branches: readonly Branch[], frame: Frame): Branch[] {
        let current = trim(branches);
        for (const stmt of stmts) {
            if (current.length === 0) break;
            if (current.some((b) => b.states === undefined)) this.lost = true;
            current = trim(this.statement(stmt, current, frame));
        }
        return current;
    }

    private statement(stmt: Stmt, branches: readonly Branch[], frame: Frame): Branch[] {
        const entry = this.entry(stmt);
        const mass = massOf(branches);
        switch (stmt.kind) {
            case "operation":
                return this.operation(stmt, entry, branches, frame);
            case "call": {
                const inlined = entry?.inlined;
                if (entry === undefined || inlined === undefined) {
                    this.record(stmt, mass, frame, {
                        note: `${stmt.name}: the steps inside a call are not costed`,
                    });
                    // A call may change the item in ways this walk does not follow.
                    return withoutStates(branches);
                }
                this.record(stmt, mass, frame, {});
                return this.within(entry, () => this.sequence(inlined.body, branches, frame));
            }
            case "restart":
                frame.restarted += mass;
                for (const branch of branches) frame.again?.push({ branch, at: entry?.before });
                this.record(stmt, mass, frame, {});
                return [];
            case "stop":
                frame.stopped += mass;
                this.record(stmt, mass, frame, {});
                return [];
            case "paramStep":
                return withoutStates(branches);
            case "if":
                return this.branchStmt(stmt, entry, branches, frame);
            case "until":
                return this.loop(stmt, entry, branches, frame);
        }
    }

    private record(
        stmt: Stmt,
        mass: number,
        frame: Frame,
        extra: Partial<Pick<StepCost, "unit" | "attempts" | "branch" | "note" | "unknown">>,
    ): void {
        const runs = mass * frame.scale;
        const unknown = extra.unknown === true || this.unknown > 0;
        this.steps.push({
            span: stmt.span,
            kind: stmt.kind,
            reached: mass,
            runs,
            ...(unknown && { unknown }),
            ...(extra.unit !== undefined && {
                unit: extra.unit,
                ...(!unknown && {
                    expected: extra.unit.map((p) => ({ ...p, amount: p.amount * runs })),
                }),
            }),
            ...(extra.attempts !== undefined && { attempts: extra.attempts }),
            ...(extra.branch !== undefined && { branch: extra.branch }),
            ...(extra.note !== undefined && { note: extra.note }),
        });
    }

    private operation(
        stmt: Extract<Stmt, { kind: "operation" }>,
        entry: TraceEntry | undefined,
        branches: readonly Branch[],
        frame: Frame,
    ): Branch[] {
        const method = findMethod(stmt.words);
        const literals: Literal[] = [];
        for (const arg of stmt.args) if (arg.kind !== "param") literals.push(arg);
        const words = stmt.words.join(" ");
        if (method === undefined) {
            this.record(stmt, massOf(branches), frame, {
                note: `${words}: not a step this report knows`,
            });
            return withoutStates(branches);
        }
        if (entry === undefined) {
            // The check stopped short of the step: a loop it refused, whose
            // own note says so, or a path it never takes.
            this.record(
                stmt,
                massOf(branches),
                frame,
                this.unknown > 0 ? {} : { note: `${words}: the check never reaches this step` },
            );
            return withoutStates(branches);
        }
        if (literals.length !== stmt.args.length) {
            this.record(stmt, massOf(branches), frame, {
                note: `${words}: a parameter stands where a name is needed`,
            });
            return withoutStates(branches);
        }
        const unit = unitCost(method, literals, entry.before, this.registry);
        // Where each branch's states go: the method read on the item as each
        // state has it.
        const misses = this.tracker?.misses ?? 0;
        const carried = this.untilOverflow(() => this.moved(stmt, entry, branches));
        const missed = (this.tracker?.misses ?? 0) > misses;
        // A state the step could not carry is not where the step left it, so
        // the steps after read the checker's item instead.
        const moved = missed ? undefined : carried;
        const built = method.build(literals, entry.before, this.registry);
        const cause = "refused" in built ? undefined : unmodelled(built);
        const notes = [
            ...(unit === undefined ? [`${words}: no price is known for this step`] : []),
            ...(cause !== undefined ? [cause] : missed ? [MISSED] : []),
            ...(!missed && ASSUMED_ODDS[words] !== undefined ? [ASSUMED_ODDS[words]] : []),
        ];
        this.record(stmt, massOf(branches), frame, {
            ...(unit !== undefined ? { unit } : {}),
            ...(notes.length > 0 && { note: notes.join("; ") }),
        });
        if ("refused" in built || entry.after === undefined) return withoutStates(branches);
        const roll = rollOf(entry.before, built, this.registry, this.reading);
        if (roll.kind !== "none") {
            // A new roll: every way of getting here is one way of being after it.
            const mass = massOf(branches);
            const merged = moved === undefined ? undefined : mixture(moved, branches);
            return [
                {
                    mass,
                    path: { roll, after: entry.after, conditions: [], base: mass },
                    ...(merged !== undefined && { states: merged }),
                },
            ];
        }
        if (moved !== undefined) {
            const after = entry.after;
            return branches.map((b, i) => ({
                mass: b.mass,
                path:
                    b.path === undefined || stmt.words[0] !== "bench"
                        ? b.path
                        : this.benchOnPath(b.path, literals, after),
                states: moved[i]!,
            }));
        }
        // The step changed the item: where a loop left it is no longer where it is.
        if (stmt.words[0] === "bench") {
            const after = entry.after;
            return branches.map((b) => ({
                mass: b.mass,
                path: b.path === undefined ? undefined : this.benchOnPath(b.path, literals, after),
            }));
        }
        // A step that could not be followed changed the item in ways the roll
        // before it does not show: what that roll left is no longer the item.
        const stale = missed || cause !== undefined;
        return branches.map((b) => ({ mass: b.mass, path: stale ? undefined : b.path }));
    }

    /** Each branch's states after a method; undefined when a branch has none or
     *  the tracker cannot follow the method. */
    private moved(
        stmt: Extract<Stmt, { kind: "operation" }>,
        entry: TraceEntry,
        branches: readonly Branch[],
    ): Carried[] | undefined {
        const tracker = this.tracker;
        if (tracker === undefined || entry.after === undefined) return undefined;
        if (branches.some((b) => b.states === undefined)) return undefined;
        const step = this.methodStep(stmt, 0);
        if (step === undefined) return undefined;
        const caps = capsOf(entry.after);
        return branches.map((b) =>
            tracker.carried(advance(step, b.states!.dist, tracker.atoms, caps)),
        );
    }

    private branchStmt(
        stmt: Extract<Stmt, { kind: "if" }>,
        entry: TraceEntry | undefined,
        branches: readonly Branch[],
        frame: Frame,
    ): Branch[] {
        const before = entry?.before;
        const rpred = before === undefined ? null : this.resolve(stmt.pred, before);
        const then: Branch[] = [];
        const otherwise: Branch[] = [];
        let unknown = false;
        for (const b of branches) {
            // Where the tracked states hold the condition's terms, they answer it.
            const split =
                rpred === null || b.states === undefined
                    ? undefined
                    : splitCarried(b.states, rpred);
            if (split !== undefined) {
                if (split.then !== undefined)
                    then.push({
                        mass: b.mass * split.chance,
                        path: extend(b.path, rpred!, true),
                        states: split.then,
                    });
                if (split.otherwise !== undefined) {
                    otherwise.push({
                        mass: b.mass * (1 - split.chance),
                        path: extend(b.path, rpred!, false),
                        states: split.otherwise,
                    });
                }
                continue;
            }
            const p =
                rpred === null || before === undefined
                    ? undefined
                    : this.conditionChance(rpred, b.path, before);
            if (p === undefined) unknown = true;
            const q = p ?? 0.5;
            if (q > 0)
                then.push({
                    mass: b.mass * q,
                    path: rpred === null ? b.path : extend(b.path, rpred, true),
                });
            if (q < 1) {
                otherwise.push({
                    mass: b.mass * (1 - q),
                    path: rpred === null ? b.path : extend(b.path, rpred, false),
                });
            }
        }
        const mass = massOf(branches);
        this.record(stmt, mass, frame, {
            branch: mass > 0 ? massOf(then) / mass : 0,
            ...(unknown && { note: "the chance of this condition is not known; half is assumed" }),
        });
        const out = this.sequence(stmt.body, then, frame);
        const elseOut = stmt.elseBody ? this.sequence(stmt.elseBody, otherwise, frame) : otherwise;
        return [...out, ...elseOut];
    }

    private loop(
        stmt: Extract<Stmt, { kind: "until" }>,
        entry: TraceEntry | undefined,
        branches: readonly Branch[],
        frame: Frame,
    ): Branch[] {
        // Only a method reads the item as found: a loop or branch at the head
        // of the body asks what the round before left, which the join over the
        // rounds holds and the path in weighs.
        const first = stmt.body[0];
        const before = entry?.before;
        if (first?.kind === "operation" && before !== undefined) this.firstSteps.set(first, before);
        try {
            return this.loopFrom(stmt, entry, branches, frame);
        } finally {
            if (first !== undefined) this.firstSteps.delete(first);
        }
    }

    private loopFrom(
        stmt: Extract<Stmt, { kind: "until" }>,
        entry: TraceEntry | undefined,
        branches: readonly Branch[],
        frame: Frame,
    ): Branch[] {
        const mass = massOf(branches);
        const before = entry?.before;
        const rpred = before === undefined ? null : this.resolve(stmt.pred, before);
        const opening = stmt.body[0];
        if (before !== undefined && opening !== undefined && this.traced(opening) === undefined) {
            // The check did not run the body: the exit already holds on every
            // path, and the loop takes no round, or it can never hold.
            if (rpred !== null && refine(before, rpred, false) === null) {
                this.record(stmt, mass, frame, { attempts: { chance: 1, expected: 0 } });
                return [...branches];
            }
            return this.unknownLoop(
                stmt,
                branches,
                frame,
                "the check finds this loop can never reach its exit, so its rounds and the guide's total are not known",
            );
        }
        const misses = this.tracker?.misses ?? 0;
        if (before !== undefined && rpred !== null) {
            const solved = this.untilOverflow(() =>
                this.chainLoop(stmt, before, rpred, branches, frame),
            );
            if (solved !== undefined) return solved;
        }
        const unfollowed = (this.tracker?.misses ?? 0) > misses;
        this.lost = true;
        // One attempt: the body from the head with mass one, in a frame of its
        // own, its steps discarded. A round ends where the body does or at a
        // restart, and the attempt ends there in the exit (its chance judged on
        // each such branch's path), or in a stop, or goes another round.
        // The head of a later attempt is where the one before left off, short of
        // the exit, so a condition at the top of the body reads the last roll.
        const round = (from: readonly Branch[]) => {
            const own: Frame = { scale: 1, stopped: 0, restarted: 0, again: [] };
            const saved = this.steps.length;
            const fell = this.sequence(stmt.body, from, own);
            this.steps.length = saved;
            const exitAfter = this.lastAfter(stmt.body) ?? entry?.after;
            const ends = [
                ...fell.map((branch) => ({ branch, at: exitAfter })),
                ...(own.again ?? []),
            ];
            return { ends, stopped: own.stopped };
        };
        const first = round([{ mass: 1, path: undefined }]);
        const head = this.headAfter(
            first.ends.map((e) => e.branch),
            rpred,
        );
        const attempt = round(head);
        let exit: number | undefined = 0;
        const exits: Branch[] = [];
        for (const { branch: b, at } of attempt.ends) {
            let p: number | undefined;
            if (rpred === null) p = undefined;
            else if (b.path !== undefined) {
                // The chance of the whole attempt ending here: the mass at the
                // branch's roll times the chance of its conditions and the exit.
                const joint = this.jointChance(b.path, rpred, b.path.after);
                p = joint === undefined ? undefined : joint * b.path.base;
            } else if (at !== undefined) {
                const c = this.conditionChance(rpred, undefined, at);
                p = c === undefined ? undefined : c * b.mass;
            }
            if (p === undefined) {
                exit = undefined;
                break;
            }
            exit += p;
            exits.push({
                mass: p,
                path: b.path === undefined ? undefined : extend(b.path, rpred!, true),
            });
        }
        const stop = attempt.stopped;
        if (exit === undefined || exit + stop <= 0) {
            return this.unknownLoop(
                stmt,
                branches,
                frame,
                (unfollowed ? `${UNFOLLOWED}; ` : "") +
                    (exit === undefined
                        ? "the chance a round of this loop reaches its exit could not be worked out, so its rounds and the guide's total are not known"
                        : "no round of this loop reaches its exit as the steps in it are read, so its rounds and the guide's total are not known"),
                head,
            );
        }
        const ending = exit + stop;
        const expected = 1 / ending;
        this.record(stmt, mass, frame, {
            attempts: { chance: exit, expected },
            ...(unfollowed && { note: UNFOLLOWED }),
        });
        // The real pass: the body's steps, each run `expected` times per pass of
        // the enclosing frame, from the loop head with mass one.
        const inner: Frame = { scale: frame.scale * mass * expected, stopped: 0, restarted: 0 };
        this.sequence(stmt.body, head, inner);
        // Of all the loop's rounds, the share that ends in a stop ends the craft.
        const stopShare = stop / ending;
        frame.stopped += mass * stopShare;
        const continuing = mass * (1 - stopShare);
        if (exits.length === 0 || exit <= 0) return [{ mass: continuing, path: undefined }];
        const scale = continuing / exit;
        return exits.map((b) => ({ mass: b.mass * scale, path: b.path }));
    }

    /**
     * A loop whose rounds cannot be given: the loop and every step in it are
     * recorded without a figure, one round's worth, and the walk goes on past
     * it as if it had ended, so the steps after it still show.
     */
    private unknownLoop(
        stmt: Extract<Stmt, { kind: "until" }>,
        branches: readonly Branch[],
        frame: Frame,
        note: string,
        head: readonly Branch[] = [{ mass: 1, path: undefined }],
    ): Branch[] {
        const mass = massOf(branches);
        this.lost = true;
        this.record(stmt, mass, frame, { note, unknown: true });
        const inner: Frame = { scale: frame.scale * mass, stopped: 0, restarted: 0 };
        this.unknowable(() => this.sequence(stmt.body, head, inner));
        return [{ mass, path: undefined }];
    }

    /** Where the next attempt starts: the branches a round ended on, each
     *  short of the exit, with their masses summing to one; the head alone when
     *  nothing fell or the exit did not resolve. */
    private headAfter(fell: readonly Branch[], rpred: RPred | null): Branch[] {
        if (rpred === null || fell.length === 0) return [{ mass: 1, path: undefined }];
        const total = massOf(fell);
        if (total <= 0) return [{ mass: 1, path: undefined }];
        return fell.map((b) => ({
            mass: b.mass / total,
            path: extend(scaled(b.path, 1 / total), rpred, false),
        }));
    }

    /**
     * A loop whose body the tracker can follow (`chain.ts`): methods it reads
     * on the item as each state has it, and branches over them that restart,
     * stop or craft, exiting on the counts and the named modifiers. Solved as
     * a chain from the states the loop may enter with, including how often each
     * step inside runs; undefined for any other body, which takes the general
     * path.
     */
    private chainLoop(
        stmt: Extract<Stmt, { kind: "until" }>,
        before: AItem,
        rpred: RPred,
        branches: readonly Branch[],
        frame: Frame,
    ): Branch[] | undefined {
        const tracker = this.tracker;
        if (tracker === undefined) return undefined;
        const mass = massOf(branches);
        const exit = this.compiled(rpred, before);
        if (exit === undefined) return undefined;
        // Every branch's guard and inner loop's exit, read on the item there.
        const guards = new Map<Stmt, (s: ChainState) => boolean>();
        const collect = (stmts: readonly Stmt[]): boolean => {
            for (const s of stmts) {
                if (s.kind === "call") {
                    const e = this.traced(s);
                    const inlined = e?.inlined;
                    if (e === undefined || inlined === undefined) return false;
                    if (!this.within(e, () => collect(inlined.body))) return false;
                    continue;
                }
                if (s.kind !== "if" && s.kind !== "until") continue;
                const at = this.traced(s)?.before ?? before;
                const guard = this.resolve(s.pred, at);
                const holds = guard === null ? undefined : this.compiled(guard, at);
                if (holds === undefined) return false;
                guards.set(s, holds);
                if (!collect(s.body)) return false;
                if (s.kind === "if" && s.elseBody !== undefined && !collect(s.elseBody))
                    return false;
            }
            return true;
        };
        if (!collect(stmt.body)) return undefined;
        const body = this.chainSteps(stmt.body, guards, new Map());
        if (body === undefined) return undefined;

        // The states the loop enters with.
        const starts = this.statesOf(before, branches);
        if (starts === undefined || starts.length === 0) return undefined;
        const misses = tracker.misses;
        const solved = chain({ atoms: tracker.atoms, body, starts, caps: capsOf(before), exit });
        // A state the body could not carry is not where the rounds left it, so
        // the loop is read the general way instead.
        if (solved === undefined || tracker.misses > misses) return undefined;
        // An attempt that can never end (the item full, nothing removing) is
        // counted as ending, so the figures stay finite; the note says so.
        const ending = solved.exit + solved.stop + solved.unresolved;
        const attempts = ending > 0 ? 1 / ending : 1;
        // Rounds, not attempts: an attempt here is as many rounds as the item
        // takes, and may be none when the loop is entered at its exit.
        const rounds = solved.passes * attempts;
        // Rounds that never end have no expected number: the rounds followed
        // before giving up are no figure of the craft's.
        const stuck = solved.unresolved >= 0.005;
        const note = stuck
            ? `${Math.round(solved.unresolved * 100)}% of the time the item never reaches the exit${solved.stuckInside >= solved.unresolved / 2 ? " of a loop inside" : ""}, so the loop cannot end as written and its rounds and the guide's total are not known`
            : solved.estimated
              ? ESTIMATED
              : undefined;
        this.record(
            stmt,
            mass,
            frame,
            stuck
                ? { note: note!, unknown: true }
                : {
                      attempts: {
                          // Per round run: the attempts that end on entering take none.
                          chance:
                              solved.passes > 0
                                  ? Math.min(1, (ending - solved.exitAtStart) / solved.passes)
                                  : 1,
                          expected: rounds,
                      },
                      ...(note !== undefined && { note }),
                  },
        );
        // A step inside is reached so often per round, and runs that times the
        // rounds of the loop, so its `reached` stays a chance.
        const scale = frame.scale * mass * (stuck ? 1 : rounds);
        const perRound = (n: number | undefined): number =>
            solved.passes > 0 ? (n ?? 0) / solved.passes : 0;
        const emit = (stmts: readonly Stmt[], steps: readonly ChainStep[]): void => {
            stmts.forEach((s, i) => {
                const step = steps[i]!;
                const reached = perRound(solved.reached.get(step.id));
                const inner: Frame = { scale, stopped: 0, restarted: 0 };
                if (s.kind === "until" && step.kind === "loop") {
                    // An inner loop's rounds per time it is reached; the ones
                    // entered at its exit take none.
                    const rounds = solved.rounds.get(step.id) ?? 0;
                    const entered = solved.reached.get(step.id) ?? 0;
                    const atExit = solved.taken.get(step.id) ?? 0;
                    this.record(s, reached, inner, {
                        attempts: {
                            chance: rounds > 0 ? Math.min(1, (entered - atExit) / rounds) : 1,
                            expected: entered > 0 ? rounds / entered : 0,
                        },
                        ...(solved.estimatedLoops.has(step.id) && { note: ESTIMATED }),
                    });
                    emit(s.body, step.body);
                } else if (s.kind === "if" && step.kind === "branch") {
                    const taken = perRound(solved.taken.get(step.id));
                    this.record(s, reached, inner, { branch: reached > 0 ? taken / reached : 0 });
                    emit(s.body, step.body);
                    if (s.elseBody !== undefined && step.otherwise !== undefined) {
                        emit(s.elseBody, step.otherwise);
                    }
                } else if (s.kind === "call" && step.kind === "branch") {
                    this.record(s, reached, inner, {});
                    const e = this.traced(s);
                    if (e?.inlined !== undefined) {
                        const body = e.inlined.body;
                        this.within(e, () => emit(body, step.body));
                    }
                } else if (s.kind === "restart" || s.kind === "stop") {
                    this.record(s, reached, inner, {});
                } else {
                    this.statement(s, [{ mass: reached, path: undefined }], inner);
                }
            });
        };
        if (stuck) this.unknowable(() => emit(stmt.body, body));
        else emit(stmt.body, body);
        const stopShare = ending > 0 ? solved.stop / ending : 0;
        frame.stopped += mass * stopShare;
        const leaving = mass * (1 - stopShare);
        if (!(solved.exit > 0)) return [{ mass: leaving, path: undefined }];
        return [
            {
                mass: leaving,
                path: undefined,
                states: tracker.carried(
                    solved.exits.map((e) => ({ state: e.state, weight: e.prob / solved.exit })),
                ),
            },
        ];
    }

    /**
     * A condition as a test of the tracker's state. A leaf about neither the
     * counts nor a named modifier is what the item says there, for every state.
     * Undefined for a value condition, which the state does not hold.
     */
    private compiled(pred: RPred, item: AItem): ((s: ChainState) => boolean) | undefined {
        const tracker = this.tracker;
        if (tracker === undefined) return undefined;
        const fixed = new Map<RPred, boolean>();
        for (const leaf of predLeaves(pred)) {
            switch (leaf.kind) {
                case "compare":
                    break;
                case "has":
                    if (!tracker.index.has(leaf.type)) return undefined;
                    break;
                case "hasGroup":
                    if (![...leaf.types].every((t) => tracker.index.has(t))) return undefined;
                    break;
                case "hasValue":
                    if (!tracker.valued(leaf.type)) return undefined;
                    break;
                case "fractured":
                    if (!tracker.locks || !tracker.index.has(leaf.type)) return undefined;
                    break;
                case "eldritch":
                case "dominant":
                    if (!tracker.implicits) return undefined;
                    break;
                default: {
                    // Only a leaf the item settles is fixed for every state.
                    const c = this.conditionChance(leaf, undefined, item);
                    if (c === undefined || (c > 1e-12 && c < 1 - 1e-12)) return undefined;
                    fixed.set(leaf, c >= 0.5);
                }
            }
        }
        return (state) => holdsOn(pred, state, tracker.index, fixed);
    }

    /**
     * The chain steps of statements, inside a loop or one at a time outside
     * one: a method is a transition the tracker reads on the checker's item (the
     * join over the rounds inside a loop), a branch its guard, a restart or a
     * stop itself. Undefined for a statement the tracker cannot follow.
     */
    private chainSteps(
        stmts: readonly Stmt[],
        guards: ReadonlyMap<Stmt, (s: ChainState) => boolean>,
        stepOf: Map<number, Stmt>,
    ): ChainStep[] | undefined {
        const out: ChainStep[] = [];
        for (const s of stmts) {
            const id = stepOf.size;
            stepOf.set(id, s);
            if (s.kind === "restart" || s.kind === "stop") {
                out.push({ id, kind: s.kind });
                continue;
            }
            if (s.kind === "until") {
                const exit = guards.get(s);
                const body = this.chainSteps(s.body, guards, stepOf);
                if (exit === undefined || body === undefined) return undefined;
                out.push({ id, kind: "loop", exit, body });
                continue;
            }
            if (s.kind === "if") {
                const holds = guards.get(s);
                const body = this.chainSteps(s.body, guards, stepOf);
                if (holds === undefined || body === undefined) return undefined;
                const otherwise =
                    s.elseBody === undefined
                        ? undefined
                        : this.chainSteps(s.elseBody, guards, stepOf);
                if (s.elseBody !== undefined && otherwise === undefined) return undefined;
                out.push({
                    id,
                    kind: "branch",
                    holds,
                    body,
                    ...(otherwise !== undefined && { otherwise }),
                });
                continue;
            }
            if (s.kind === "call") {
                const e = this.traced(s);
                const inlined = e?.inlined;
                if (e === undefined || inlined === undefined) return undefined;
                const body = this.within(e, () => this.chainSteps(inlined.body, guards, stepOf));
                if (body === undefined) return undefined;
                out.push({ id, kind: "branch", holds: () => true, body });
                continue;
            }
            if (s.kind !== "operation") return undefined;
            const step = this.methodStep(s, id);
            if (step === undefined) return undefined;
            out.push(step);
        }
        return out;
    }

    /** A method as a chain step: where it takes each state. */
    private methodStep(s: Extract<Stmt, { kind: "operation" }>, id: number): ChainStep | undefined {
        const tracker = this.tracker;
        if (tracker === undefined) return undefined;
        // A step runs on every round's item: the join over the rounds.
        const entry = this.traced(s);
        const method = findMethod(s.words);
        if (entry === undefined || method === undefined || entry.after === undefined)
            return undefined;
        const literals: Literal[] = [];
        for (const arg of s.args) if (arg.kind !== "param") literals.push(arg);
        if (literals.length !== s.args.length) return undefined;
        const built = method.build(literals, entry.before, this.registry);
        if ("refused" in built) return undefined;
        if (built.some((op) => op.kind === "restore")) {
            // The item becomes the imprint, whatever it held: a reforge whose
            // outcomes are the item restored.
            const back = this.statesOf(entry.after, [{ mass: 1, path: undefined }]);
            if (back === undefined || back.length === 0) return undefined;
            // The imprint's counts, where the checker left them open, are
            // weighed by the reading, so the walk's ends are walked too.
            const { total, prefix } = entry.after.counts;
            if (total[0] !== total[1] || prefix[0] !== prefix[1]) this.lost = true;
            const mass = back.reduce((sum, b) => sum + b.weight, 0);
            const read = back.map((b) => ({ state: b.state, prob: b.weight / mass }));
            // A state that saw its imprint taken goes back to that very item;
            // one that did not, to the imprint as the check knows it.
            return {
                id,
                kind: "transition",
                next: (state) =>
                    state.held === undefined ? read : [{ state: state.held, prob: 1 }],
            };
        }
        const next = tracker.transition(entry.before, built, this.reading, s.words.join(" "));
        if (next === undefined) return undefined;
        if (!built.some((op) => op.kind === "imprint")) return { id, kind: "transition", next };
        // The imprint keeps the item as the state has it.
        const kept = new Map<ChainState, readonly { state: ChainState; prob: number }[]>();
        return {
            id,
            kind: "transition",
            next: (state) => {
                let out = kept.get(state);
                if (out === undefined) {
                    out = next(state).map((o) => {
                        const held = {
                            prefix: o.state.prefix,
                            suffix: o.state.suffix,
                            rows: o.state.rows,
                        };
                        return { prob: o.prob, state: { ...held, held } };
                    });
                    kept.set(state, out);
                }
                return out;
            },
        };
    }

    /**
     * The states an item may be in: from where a solved loop or the steps
     * before left it where they did; otherwise every count pair it allows and
     * every way the uncertain named modifiers may be present, weighted by the
     * chance the paths in give each, equal over the counts when no roll is on
     * the path.
     */
    private statesOf(
        item: AItem,
        ins: readonly Branch[],
    ): { state: ChainState; weight: number }[] | undefined {
        const tracker = this.tracker;
        if (tracker === undefined) return undefined;
        const atoms = tracker.atoms;
        const uncertain: number[] = [];
        const presence: ("yes" | "no" | "maybe")[] = [];
        atoms.forEach((_atom, i) => {
            const type = tracker.types[i]!;
            if (guaranteedTypes(item).has(type)) presence.push("yes");
            else if (isExcluded(item, type) || !item.possible.has(type)) presence.push("no");
            else {
                presence.push("maybe");
                uncertain.push(i);
            }
        });
        const states: { state: ChainState; weight: number }[] = [];
        const plain: Branch[] = [];
        for (const b of ins) {
            if (b.states === undefined) plain.push(b);
            else for (const s of b.states.dist) states.push({ ...s, weight: b.mass * s.weight });
        }
        if (plain.length === 0) return states;
        if (uncertain.length > 4) return undefined;
        const itemKnown = { prefix: 0, suffix: 0 };
        for (const t of guaranteedTypes(item)) {
            if (!tracker.index.has(t)) itemKnown[genOfOn(this.registry, item, t)]++;
        }
        let pairs: [number, number][] = [];
        const [t0, t1] = item.counts.total;
        const [p0, p1] = item.counts.prefix;
        const [s0, s1] = suffixRange(item);
        for (let p = p0; p <= p1; p++) {
            for (let t = t0; t <= t1; t++) {
                if (t - p >= s0 && t - p <= s1) pairs.push([p, t - p]);
            }
        }
        if (this.reading !== "estimate") {
            // The item with the fewest or the most modifiers the counts allow.
            const totals = pairs.map(([p, sfx]) => p + sfx);
            const pick = this.reading === "floors" ? Math.min(...totals) : Math.max(...totals);
            pairs = pairs.filter(([p, sfx]) => p + sfx === pick);
        }
        if (pairs.length === 0) return undefined;
        for (let mask = 0; mask < 1 << uncertain.length; mask++) {
            const present = presence.map((p, i) =>
                p === "yes" || (p === "maybe" && mask & (1 << uncertain.indexOf(i))) ? true : false,
            );
            const named = { prefix: 0, suffix: 0 };
            atoms.forEach((atom, i) => {
                if (present[i]) named[atom.gen]++;
            });
            for (const [p, sfx] of pairs) {
                if (p < named.prefix + itemKnown.prefix || sfx < named.suffix + itemKnown.suffix)
                    continue;
                let presenceCond: RPred | undefined;
                for (const i of uncertain) {
                    const has: RPred = { kind: "has", type: tracker.types[i]!, gen: atoms[i]!.gen };
                    const term: RPred = present[i] ? has : { kind: "not", inner: has };
                    presenceCond =
                        presenceCond === undefined
                            ? term
                            : { kind: "and", left: presenceCond, right: term };
                }
                let cond: RPred = {
                    kind: "and",
                    left: { kind: "compare", projection: "prefixCount", op: "==", value: p },
                    right: { kind: "compare", projection: "suffixCount", op: "==", value: sfx },
                };
                if (presenceCond !== undefined) {
                    cond = { kind: "and", left: cond, right: presenceCond };
                }
                let weight = 0;
                for (const b of plain) {
                    const c = this.conditionChance(cond, b.path, item);
                    if (c !== undefined) {
                        weight += b.mass * c;
                        continue;
                    }
                    // The path does not know the counts: every pair alike, the
                    // named modifiers' presence still read off the path.
                    const alone =
                        presenceCond === undefined
                            ? 1
                            : this.conditionChance(presenceCond, b.path, item);
                    if (alone === undefined) return undefined;
                    weight += (b.mass * alone) / pairs.length;
                }
                if (weight <= 0) continue;
                // The classes of the present atoms, each combination by weight share.
                let rowed: { rows: (ModId | null)[]; weight: number }[] = [
                    { rows: atoms.map(() => null), weight },
                ];
                atoms.forEach((_atom, i) => {
                    if (!present[i]) return;
                    const rows = tracker.rowsOn(i, item);
                    const total = rows.reduce((sum, r) => sum + r.weight, 0);
                    rowed = rowed.flatMap((st) =>
                        rows.map((r) => {
                            const copy = [...st.rows];
                            copy[i] = r.id;
                            return { rows: copy, weight: (st.weight * r.weight) / total };
                        }),
                    );
                });
                for (const st of rowed) {
                    const marked = tracker.marked(item, st.rows);
                    if (marked === undefined) return undefined;
                    for (const m of marked) {
                        states.push({
                            state: { prefix: p, suffix: sfx, rows: m.rows },
                            weight: st.weight * m.share,
                        });
                    }
                }
            }
        }
        return states;
    }

    /** The row a bench statement crafts on this item, when it resolves. */
    private benchMod(literals: readonly Literal[], a: AItem): Mod | undefined {
        const name = literals[0];
        if (name === undefined || name.kind !== "string") return undefined;
        const tier = literals[1];
        const craft = this.registry.resolveBench(
            name.value,
            a.base.itemClass,
            tier !== undefined && (tier.kind === "tier" || tier.kind === "int")
                ? tier.value
                : undefined,
        );
        if (!craft.ok) return undefined;
        const mod = this.registry.resolveMod(craft.value.mod);
        return mod.ok ? mod.value : undefined;
    }

    /** The item after the last statement of a body that has one in the trace. */
    private lastAfter(body: readonly Stmt[]): AItem | undefined {
        for (let i = body.length - 1; i >= 0; i--) {
            const e = this.entry(body[i]!);
            if (e?.after !== undefined) return e.after;
        }
        return undefined;
    }

    /** A bench craft after a roll: its modifier is on the item for certain. */
    private benchOnPath(path: Path, literals: readonly Literal[], after: AItem): Path {
        const mod = this.benchMod(literals, after);
        if (mod === undefined) return path;
        const gen =
            rollableGen(
                this.registry.catalog,
                after.base,
                after.ilvl,
                mod.type,
                influenceTagsAny(after, this.registry),
            ) ?? mod.gen;
        return { ...path, roll: withPresent(path.roll, mod.type, gen, mod), after };
    }

    /** The chance a condition holds at a point, given the path since the last roll. */
    private conditionChance(
        pred: RPred,
        path: Path | undefined,
        before: AItem,
    ): number | undefined {
        if (path === undefined) {
            if (refine(before, pred, true) === null) return 0;
            if (refine(before, pred, false) === null) return 1;
            return undefined;
        }
        // P(pred | path) = P(path ∧ pred) / P(path), both over the roll.
        const joint = this.jointChance(path, pred, path.after);
        const given =
            path.conditions.length === 0
                ? 1
                : chance(conjunction(path.conditions), path.roll, path.after);
        if (joint === undefined || given === undefined || given <= 0) return undefined;
        return Math.min(1, joint / given);
    }

    private jointChance(path: Path, pred: RPred, after: AItem): number | undefined {
        return chance(conjunction([...path.conditions, pred]), path.roll, after);
    }
}

function conjunction(preds: readonly RPred[]): RPred {
    return preds.reduce((left, right) => ({ kind: "and", left, right }));
}

function extend(path: Path | undefined, pred: RPred, positive: boolean): Path | undefined {
    if (path === undefined) return undefined;
    const cond: RPred = positive ? pred : { kind: "not", inner: pred };
    return { ...path, conditions: [...path.conditions, cond] };
}

function scaled(path: Path | undefined, factor: number): Path | undefined {
    return path === undefined ? undefined : { ...path, base: path.base * factor };
}
