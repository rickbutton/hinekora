/**
 * The expected cost of a guide: one walk over the syntax tree beside the
 * checker's trace, carrying the probability of reaching each step. A loop runs
 * its body once over the chance one attempt reaches its exit, judged on the
 * last roll of the body and the conditions passed on the way to it (the
 * attempts taken as independent trials); a branch splits the mass by its
 * condition's chance; a `restart` ends the attempt and a `stop` the craft. The
 * item before a step is the checker's, so the pools are the item's on the path
 * the guide describes (docs/research/cost-model.md §5.5).
 */
import type { Craft, Pred, Stmt } from "../ast/ast.js";
import type { SourceSpan } from "../ast/span.js";
import type { Gen, ModId, TypeId } from "../model/ids.js";
import type { Mod } from "../model/mod.js";
import type { Op } from "../check/ops.js";
import type { Registry } from "../resolve/registry.js";
import { type AItem, type RPred, refine } from "../check/astate.js";
import {
    type CheckResult,
    donorItems,
    predicateResolver,
    type TraceEntry,
} from "../check/check.js";
import { findMethod, type Literal } from "../check/methods.js";
import { rollableGen } from "../resolve/tiers.js";
import { influenceTagsAny } from "../check/ops.js";
import { chance } from "./chance.js";
import { chain, type ChainAtom, type ChainState, type ChainStep } from "./chain.js";
import { guaranteedTypes, isExcluded, rarityOf, sideCap, suffixRange } from "../check/astate.js";
import { lookupWeight } from "../pool/pool.js";
import { rollableTiers } from "../resolve/tiers.js";
import { addPrices, inChaos, type Price, type Prices, unitCost } from "./prices.js";
import { NO_ROLL, type Reading, recombineRoll, type Roll, rollOf, withPresent } from "./roll.js";

/** The ends of a figure over the two items at the ends of what the checker
 *  allows at the step (`Reading`), given only where they differ. */
export interface Bounds {
    readonly low: number;
    readonly high: number;
}

/** What the cost layer says about one statement. */
export interface StepCost {
    readonly span: SourceSpan;
    readonly kind: Stmt["kind"];
    /** How often the step is reached in one pass of its enclosing block: a
     *  chance outside a repeat, a count over all its rounds inside one, so it
     *  is not printed as a percentage. */
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
    /** The spread of `runs`, of a loop's expected rounds and of a branch's
     *  chance over the item's open counts, where they differ. */
    readonly runsRange?: Bounds;
    readonly attemptsRange?: Bounds;
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
}

/** How many branches a sequence keeps apart before the lightest are folded
 *  into the heaviest. */
const BRANCH_LIMIT = 12;

interface Frame {
    /** The expected runs of one pass through the enclosing sequence. */
    readonly scale: number;
    /** Mass ending the craft (`stop`), per pass. */
    stopped: number;
    /** Mass leaving the pass early (`restart`). */
    restarted: number;
}

/** One walk's figures under one reading of the item's open counts. */
interface Walk {
    readonly steps: readonly StepCost[];
    readonly total: readonly Price[];
    readonly chaos?: number;
    readonly stopped: number;
}

export function costOf(
    craft: Craft,
    result: CheckResult,
    registry: Registry,
    snapshot?: Prices,
): CostReport {
    const estimate = walk(craft, result, registry, snapshot, "estimate");
    // The two ends of what the checker allows, for the spread beside the estimate.
    const ends = [
        walk(craft, result, registry, snapshot, "floors"),
        walk(craft, result, registry, snapshot, "ceilings"),
    ];
    const unpriced = new Set<string>();
    for (const p of estimate.total) {
        if (snapshot === undefined || inChaos([p], snapshot) === undefined) unpriced.add(p.item);
    }
    const { steps, reliable } = withBounds(
        estimate.steps,
        ends.map((w) => w.steps),
    );
    const chaosRange =
        estimate.chaos === undefined || !reliable
            ? undefined
            : bounds(
                  estimate.chaos,
                  ends.map((w) => w.chaos),
              );
    return {
        steps,
        total: estimate.total,
        ...(snapshot !== undefined &&
            estimate.chaos !== undefined && {
                chaos: estimate.chaos,
                divine: estimate.chaos / snapshot.chaosPerDivine,
            }),
        ...(chaosRange !== undefined && { chaosRange }),
        unpriced: [...unpriced],
        stopped: estimate.stopped,
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
    walker.sequence(craft.body, [{ mass: 1, path: undefined }], top);
    // A restart at the top level starts the guide over: every step runs once
    // more per restart, a geometric number of passes.
    const passes = top.restarted < 1 ? 1 / (1 - top.restarted) : 1;
    const steps = walker.steps.map((s) =>
        passes === 1
            ? s
            : {
                  ...s,
                  runs: s.runs * passes,
                  ...(s.expected && {
                      expected: s.expected.map((p) => ({ ...p, amount: p.amount * passes })),
                  }),
              },
    );
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
        stopped: Math.min(1, top.stopped * passes),
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
    // The spans of the loops and branches a reading assumed rather than solved.
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
            ...(branch !== undefined && { branchRange: branch }),
        };
    });
    return { steps, reliable: assumed.length === 0 };
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
    kept[0] = { mass: heaviest.mass + rest, path: heaviest.path };
    return kept;
}

class Walker {
    readonly steps: StepCost[] = [];
    private readonly byStart = new Map<string, TraceEntry>();
    /** The item a statement is judged on where the trace's is not it: the
     *  first step of a loop body reads the item the loop finds, not the join
     *  over every round, so the attempts are taken alike. */
    private readonly firstSteps = new Map<Stmt, AItem>();
    private readonly resolve: (pred: Pred, a: AItem) => RPred | null;
    /** The second items a `recombine` merges in, by name. */
    private readonly donors: ReadonlyMap<string, AItem>;

    constructor(
        craft: Craft,
        result: CheckResult,
        private readonly registry: Registry,
        private readonly reading: Reading,
    ) {
        for (const e of result.trace) this.byStart.set(`${e.kind}@${e.span.start.offset}`, e);
        this.resolve = predicateResolver(craft, registry);
        this.donors = donorItems(craft, registry);
    }

    private entry(s: Stmt): TraceEntry | undefined {
        const e = this.byStart.get(`${s.kind}@${s.span.start.offset}`);
        const before = this.firstSteps.get(s);
        return e === undefined || before === undefined ? e : { ...e, before };
    }

    /** Walk a sequence; the branches that fall off its end come back. */
    sequence(stmts: readonly Stmt[], branches: readonly Branch[], frame: Frame): Branch[] {
        let current = trim(branches);
        for (const stmt of stmts) {
            if (current.length === 0) break;
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
            case "call":
                this.record(stmt, mass, frame, {
                    note: `${stmt.name}: the steps inside a call are not costed`,
                });
                return [...branches];
            case "restart":
                frame.restarted += mass;
                this.record(stmt, mass, frame, {});
                return [];
            case "stop":
                frame.stopped += mass;
                this.record(stmt, mass, frame, {});
                return [];
            case "paramStep":
                return [...branches];
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
        extra: Partial<Pick<StepCost, "unit" | "attempts" | "branch" | "note">>,
    ): void {
        const runs = mass * frame.scale;
        this.steps.push({
            span: stmt.span,
            kind: stmt.kind,
            reached: mass,
            runs,
            ...(extra.unit !== undefined && {
                unit: extra.unit,
                expected: extra.unit.map((p) => ({ ...p, amount: p.amount * runs })),
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
            return [...branches];
        }
        if (entry === undefined || literals.length !== stmt.args.length) {
            this.record(stmt, massOf(branches), frame, {
                note: `${words}: a parameter stands where a name is needed`,
            });
            return [...branches];
        }
        const unit = unitCost(method, literals, entry.before, this.registry);
        this.record(stmt, massOf(branches), frame, {
            ...(unit !== undefined
                ? { unit }
                : { note: `${words}: no price is known for this step` }),
        });
        const built = method.build(literals, entry.before, this.registry);
        if ("refused" in built || entry.after === undefined) return [...branches];
        const roll = this.rollFor(stmt, literals, built, entry.before);
        if (roll.kind !== "none") {
            // A new roll: every way of getting here is one way of being after it.
            const mass = massOf(branches);
            return [{ mass, path: { roll, after: entry.after, conditions: [], base: mass } }];
        }
        if (stmt.words[0] === "bench") {
            const after = entry.after;
            return branches.map((b) =>
                b.path === undefined
                    ? b
                    : { mass: b.mass, path: this.benchOnPath(b.path, literals, after) },
            );
        }
        return [...branches];
    }

    /** A method's roll on the item; the Recombinator's reads its second item. */
    private rollFor(
        stmt: Extract<Stmt, { kind: "operation" }>,
        literals: readonly Literal[],
        built: readonly Op[],
        before: AItem,
    ): Roll {
        if (stmt.words[0] === "recombine") {
            const name = literals[0];
            const donor =
                name !== undefined && (name.kind === "word" || name.kind === "string")
                    ? this.donors.get(name.value)
                    : undefined;
            return donor === undefined
                ? NO_ROLL
                : recombineRoll(before, donor, this.registry, this.reading);
        }
        return rollOf(before, built, this.registry, this.reading);
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
        const first = stmt.body[0];
        const before = entry?.before;
        if (first !== undefined && before !== undefined) this.firstSteps.set(first, before);
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
        if (before !== undefined && rpred !== null) {
            const solved = this.chainLoop(stmt, before, rpred, branches, frame);
            if (solved !== undefined) return solved;
        }
        // One attempt: the body from the head with mass one, in a frame of its
        // own, its steps discarded. The attempt ends in the exit (its chance
        // judged on each falling branch's path), in a stop, or in another round.
        // The head of a later attempt is where the one before left off, short of
        // the exit, so a condition at the top of the body reads the last roll.
        const attempt: Frame = { scale: 1, stopped: 0, restarted: 0 };
        const saved = this.steps.length;
        const first = this.sequence(stmt.body, [{ mass: 1, path: undefined }], attempt);
        const head = this.headAfter(first, rpred);
        const fell = this.sequence(stmt.body, head, attempt);
        this.steps.length = saved;
        attempt.stopped = 0;
        attempt.restarted = 0;
        this.sequence(stmt.body, head, attempt);
        this.steps.length = saved;
        const exitAfter = this.lastAfter(stmt.body) ?? entry?.after;
        let exit: number | undefined = 0;
        const exits: Branch[] = [];
        for (const b of fell) {
            let p: number | undefined;
            if (rpred === null) p = undefined;
            else if (b.path !== undefined) {
                // The chance of the whole attempt ending here: the mass at the
                // branch's roll times the chance of its conditions and the exit.
                const joint = this.jointChance(b.path, rpred, b.path.after);
                p = joint === undefined ? undefined : joint * b.path.base;
            } else if (exitAfter !== undefined) {
                const c = this.conditionChance(rpred, undefined, exitAfter);
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
        let note: string | undefined;
        if (exit === undefined) {
            note =
                "the chance of this loop's exit per attempt is not known; one attempt is assumed";
        } else if (exit <= 0) {
            note =
                "the exit depends on modifiers already on the item, which this model does not track; one attempt is assumed";
        }
        const perAttempt = exit === undefined || exit <= 0 ? Math.max(0, 1 - stop) : exit;
        const ending = perAttempt + stop;
        const expected = ending > 0 ? 1 / ending : 1;
        this.record(stmt, mass, frame, {
            attempts: { chance: perAttempt, expected },
            ...(note !== undefined && { note }),
        });
        // The real pass: the body's steps, each run `expected` times per pass of
        // the enclosing frame, from the loop head with mass one.
        const inner: Frame = { scale: frame.scale * mass * expected, stopped: 0, restarted: 0 };
        this.sequence(stmt.body, head, inner);
        // Of all the loop's rounds, the share that ends in a stop ends the craft.
        const stopShare = ending > 0 ? stop / ending : 0;
        frame.stopped += mass * stopShare;
        const continuing = mass * (1 - stopShare);
        if (exits.length === 0 || exit === undefined || exit <= 0) {
            return [{ mass: continuing, path: undefined }];
        }
        const scale = continuing / exit;
        return exits.map((b) => ({ mass: b.mass * scale, path: b.path }));
    }

    /** Where the next attempt starts: the branches that fell off the body, each
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
     * A loop whose body changes the item one modifier at a time (`chain.ts`):
     * random removals, single draws, bench crafts, and branches over them that
     * restart, stop or craft, exiting on the counts and the named modifiers.
     * Solved as a chain from the states the loop may enter with, exactly,
     * including how often each step inside runs; undefined for any other body,
     * which takes the general path.
     */
    private chainLoop(
        stmt: Extract<Stmt, { kind: "until" }>,
        before: AItem,
        rpred: RPred,
        branches: readonly Branch[],
        frame: Frame,
    ): Branch[] | undefined {
        const mass = massOf(branches);
        const registry = this.registry;
        const tags = influenceTagsAny(before, registry);
        const baseTags = new Set([...before.base.tags, ...tags]);
        const atoms: ChainAtom[] = [];
        const atomIndex = new Map<TypeId, number>();
        const atomOf = (type: TypeId): number => {
            let i = atomIndex.get(type);
            if (i !== undefined) return i;
            i = atoms.length;
            atomIndex.set(type, i);
            let rows = rollableTiers(registry.catalog, before.base, before.ilvl, type, tags)
                .map((m) => ({ id: m.id, weight: lookupWeight(m, baseTags) ?? 0 }))
                .filter((r) => r.weight > 0);
            const weight = rows.reduce((sum, r) => sum + r.weight, 0);
            if (rows.length === 0) {
                // A row no roll lays down (a bench craft's): placed, never drawn.
                rows = registry.catalog
                    .filter((m) => m.type === type)
                    .map((m) => ({ id: m.id, weight: 1 }));
            }
            atoms.push({ gen: genOfOn(registry, before, type), rows, weight });
            return i;
        };
        // A leaf about neither the counts nor a named modifier is what the
        // item entering the loop says, for the whole loop.
        const fixed = new Map<RPred, boolean>();
        const compile = (pred: RPred): ((s: ChainState) => boolean) | undefined => {
            for (const leaf of predLeaves(pred)) {
                switch (leaf.kind) {
                    case "compare":
                        break;
                    case "has":
                        atomOf(leaf.type);
                        break;
                    case "hasGroup":
                        for (const t of leaf.types) atomOf(t);
                        break;
                    case "hasValue":
                        return undefined;
                    default: {
                        const c = this.conditionChance(leaf, undefined, before);
                        if (c === undefined) return undefined;
                        fixed.set(leaf, c >= 0.5);
                    }
                }
            }
            return (state) => holdsOn(pred, state, atomIndex, fixed) === true;
        };
        const exit = compile(rpred);
        if (exit === undefined) return undefined;
        // Every condition first, so the atoms are known before the steps are read.
        const guards = new Map<Stmt, (s: ChainState) => boolean>();
        const collect = (stmts: readonly Stmt[]): boolean => {
            for (const s of stmts) {
                if (s.kind !== "if") continue;
                if (s.elseBody !== undefined) return false;
                const guard = this.resolve(s.pred, before);
                const holds = guard === null ? undefined : compile(guard);
                if (holds === undefined) return false;
                guards.set(s, holds);
                if (!collect(s.body)) return false;
            }
            return true;
        };
        if (!collect(stmt.body)) return undefined;

        const known = { prefix: 0, suffix: 0 };
        for (const t of guaranteedTypes(before)) {
            if (!atomIndex.has(t)) known[genOfOn(registry, before, t)]++;
        }
        const stepOf = new Map<number, Stmt>();
        const mapSteps = (stmts: readonly Stmt[]): ChainStep[] | undefined => {
            const out: ChainStep[] = [];
            for (const s of stmts) {
                const id = stepOf.size;
                stepOf.set(id, s);
                if (s.kind === "restart" || s.kind === "stop") {
                    out.push({ id, kind: s.kind });
                    continue;
                }
                if (s.kind === "if") {
                    const body = mapSteps(s.body);
                    if (body === undefined) return undefined;
                    out.push({ id, kind: "branch", holds: guards.get(s)!, body });
                    continue;
                }
                if (s.kind !== "operation") return undefined;
                const entry = this.entry(s);
                const method = findMethod(s.words);
                if (entry === undefined || method === undefined || entry.after === undefined)
                    return undefined;
                const literals: Literal[] = [];
                for (const arg of s.args) if (arg.kind !== "param") literals.push(arg);
                if (literals.length !== s.args.length) return undefined;
                const built = method.build(literals, entry.before, registry);
                if ("refused" in built) return undefined;
                const roll = rollOf(entry.before, built, registry, this.reading);
                switch (roll.kind) {
                    case "none": {
                        const bench =
                            s.words[0] === "bench"
                                ? this.benchMod(literals, entry.before)
                                : undefined;
                        if (bench === undefined) {
                            out.push({ id, kind: "other" });
                            break;
                        }
                        const atom = atomIndex.get(bench.type);
                        out.push({
                            id,
                            kind: "bench",
                            gen: genOfOn(registry, entry.before, bench.type),
                            ...(atom !== undefined && { atom, row: bench.id }),
                        });
                        break;
                    }
                    case "removal": {
                        // A side the removal cannot reach counts nothing; one it
                        // alone reaches is the side it takes from.
                        const gen: Gen | undefined =
                            roll.sides.suffix.count === 0 && roll.sides.prefix.count > 0
                                ? "prefix"
                                : roll.sides.prefix.count === 0 && roll.sides.suffix.count > 0
                                  ? "suffix"
                                  : roll.gen;
                        out.push(
                            gen === undefined
                                ? { id, kind: "remove" }
                                : { id, kind: "remove", gen },
                        );
                        break;
                    }
                    case "draw": {
                        if (!singleAdd(built) || roll.variants.length !== 1) return undefined;
                        const v = roll.variants[0]!;
                        const weight = { prefix: 0, suffix: 0 };
                        const mean = { prefix: 1, suffix: 1 };
                        for (const gen of ["prefix", "suffix"] as const) {
                            const groups = gen === "prefix" ? v.prefix : v.suffix;
                            const total = groups.reduce((sum, g) => sum + g.weight, 0);
                            if (groups.length > 0) mean[gen] = total / groups.length;
                            // The pool with every atom's group open: a present
                            // atom's group was left out of the roll's groups.
                            let open = total;
                            atoms.forEach((atom, i) => {
                                const type = [...atomIndex].find(([, j]) => j === i)![0];
                                if (atom.gen === gen && v.present.some((p) => p.type === type)) {
                                    open += atom.weight;
                                }
                            });
                            weight[gen] = open;
                        }
                        out.push({ id, kind: "add", weight, known, mean });
                        break;
                    }
                    default:
                        return undefined;
                }
            }
            return out;
        };
        const body = mapSteps(stmt.body);
        if (body === undefined) return undefined;

        // The states the loop enters with: every count pair the item allows
        // and every way the uncertain named modifiers may be present, weighted
        // by the chance the path in gives each; equal over the counts when no
        // roll is on the path.
        const uncertain: number[] = [];
        const presence: ("yes" | "no" | "maybe")[] = [];
        atoms.forEach((_atom, i) => {
            const type = [...atomIndex].find(([, j]) => j === i)![0];
            if (guaranteedTypes(before).has(type)) presence.push("yes");
            else if (isExcluded(before, type) || !before.possible.has(type)) presence.push("no");
            else {
                presence.push("maybe");
                uncertain.push(i);
            }
        });
        if (uncertain.length > 4) return undefined;
        const rowsAtEntry = (i: number): readonly { id: ModId; weight: number }[] => {
            const type = [...atomIndex].find(([, j]) => j === i)![0];
            const pinned = before.tiers.get(type);
            const rows = atoms[i]!.rows.filter((r) => pinned === undefined || pinned.has(r.id));
            return rows.length > 0 ? rows : atoms[i]!.rows;
        };
        let pairs: [number, number][] = [];
        const [t0, t1] = before.counts.total;
        const [p0, p1] = before.counts.prefix;
        const [s0, s1] = suffixRange(before);
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
        const starts: { state: ChainState; weight: number }[] = [];
        for (let mask = 0; mask < 1 << uncertain.length; mask++) {
            const present = presence.map((p, i) =>
                p === "yes" || (p === "maybe" && mask & (1 << uncertain.indexOf(i))) ? true : false,
            );
            const named = { prefix: 0, suffix: 0 };
            atoms.forEach((atom, i) => {
                if (present[i]) named[atom.gen]++;
            });
            for (const [p, sfx] of pairs) {
                if (p < named.prefix + known.prefix || sfx < named.suffix + known.suffix) continue;
                let presenceCond: RPred | undefined;
                for (const i of uncertain) {
                    const type = [...atomIndex].find(([, j]) => j === i)![0];
                    const has: RPred = { kind: "has", type, gen: atoms[i]!.gen };
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
                for (const b of branches) {
                    const c = this.conditionChance(cond, b.path, before);
                    if (c !== undefined) {
                        weight += b.mass * c;
                        continue;
                    }
                    // The path does not know the counts: every pair alike, the
                    // named modifiers' presence still read off the path.
                    const alone =
                        presenceCond === undefined
                            ? 1
                            : this.conditionChance(presenceCond, b.path, before);
                    if (alone === undefined) return undefined;
                    weight += (b.mass * alone) / pairs.length;
                }
                if (weight <= 0) continue;
                // The rows of the present atoms, each combination by weight share.
                let states: { rows: (ModId | null)[]; weight: number }[] = [
                    { rows: atoms.map(() => null), weight },
                ];
                atoms.forEach((_atom, i) => {
                    if (!present[i]) return;
                    const rows = rowsAtEntry(i);
                    const total = rows.reduce((sum, r) => sum + r.weight, 0);
                    const next: typeof states = [];
                    for (const st of states) {
                        for (const r of rows) {
                            const copy = [...st.rows];
                            copy[i] = r.id;
                            next.push({ rows: copy, weight: (st.weight * r.weight) / total });
                        }
                    }
                    states = next;
                });
                for (const st of states) {
                    starts.push({
                        state: { prefix: p, suffix: sfx, rows: st.rows },
                        weight: st.weight,
                    });
                }
            }
        }
        if (starts.length === 0) return undefined;
        const rarity = rarityOf(before) ?? "rare";
        const solved = chain({
            atoms,
            body,
            starts,
            caps: {
                prefix: sideCap("prefix", rarity, before.base),
                suffix: sideCap("suffix", rarity, before.base),
            },
            exit,
        });
        if (solved === undefined) return undefined;
        // An attempt that can never end (the item full, nothing removing) is
        // counted as ending, so the figures stay finite; the note says so.
        const ending = solved.exit + solved.stop + solved.unresolved;
        const attempts = ending > 0 ? 1 / ending : 1;
        // Rounds, not attempts: an attempt here is as many rounds as the item
        // takes, and may be none when the loop is entered at its exit.
        const rounds = solved.passes * attempts;
        this.record(stmt, mass, frame, {
            attempts: {
                chance: solved.passes > 0 ? Math.min(1, ending / solved.passes) : 1,
                expected: rounds,
            },
            ...(solved.unresolved > 1e-6 && {
                note: `in ${Math.round(solved.unresolved * 100)}% of attempts the item fills up before the exit and the loop cannot end as written`,
            }),
        });
        const scale = frame.scale * mass;
        const emit = (stmts: readonly Stmt[], steps: readonly ChainStep[]): void => {
            stmts.forEach((s, i) => {
                const step = steps[i]!;
                const reached = (solved.reached.get(step.id) ?? 0) * attempts;
                const inner: Frame = { scale, stopped: 0, restarted: 0 };
                if (s.kind === "if" && step.kind === "branch") {
                    const taken = (solved.taken.get(step.id) ?? 0) * attempts;
                    this.record(s, reached, inner, { branch: reached > 0 ? taken / reached : 0 });
                    emit(s.body, step.body);
                } else if (s.kind === "restart" || s.kind === "stop") {
                    this.record(s, reached, inner, {});
                } else {
                    this.statement(s, [{ mass: reached, path: undefined }], inner);
                }
            });
        };
        emit(stmt.body, body);
        const stopShare = ending > 0 ? solved.stop / ending : 0;
        frame.stopped += mass * stopShare;
        return [{ mass: mass * (1 - stopShare), path: undefined }];
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

    /** The chance of the path's conditions and `pred` together, over the path's roll. */
    private jointChance(path: Path, pred: RPred, after: AItem): number | undefined {
        return chance(conjunction([...path.conditions, pred]), path.roll, after);
    }
}

/** The leaves of a condition. */
function predLeaves(pred: RPred, out: RPred[] = []): RPred[] {
    switch (pred.kind) {
        case "not":
            return predLeaves(pred.inner, out);
        case "and":
        case "or":
            predLeaves(pred.left, out);
            return predLeaves(pred.right, out);
        default:
            out.push(pred);
            return out;
    }
}

/** Whether an op sequence is one draw added to the item, nothing stripped or removed. */
function singleAdd(ops: readonly Op[]): boolean {
    let fills = 0;
    for (const op of ops) {
        if (op.kind === "strip" || op.kind === "remove") return false;
        if (op.kind === "fill" && op.pool.kind !== "veiledPlaceholder") {
            if (op.count.kind !== "add" || op.count.n[0] !== 1 || op.count.n[1] !== 1) return false;
            fills++;
        }
    }
    return fills === 1;
}

/** A condition on the chain's state: the counts, the named modifiers' rows,
 *  and the leaves fixed by the item entering the loop. */
function holdsOn(
    pred: RPred,
    s: ChainState,
    atomIndex: ReadonlyMap<TypeId, number>,
    fixed: ReadonlyMap<RPred, boolean>,
): boolean {
    switch (pred.kind) {
        case "not":
            return !holdsOn(pred.inner, s, atomIndex, fixed);
        case "and":
            return (
                holdsOn(pred.left, s, atomIndex, fixed) && holdsOn(pred.right, s, atomIndex, fixed)
            );
        case "or":
            return (
                holdsOn(pred.left, s, atomIndex, fixed) || holdsOn(pred.right, s, atomIndex, fixed)
            );
        case "compare": {
            const n = pred.projection === "prefixCount" ? s.prefix : s.suffix;
            switch (pred.op) {
                case "==":
                    return n === pred.value;
                case "!=":
                    return n !== pred.value;
                case "<":
                    return n < pred.value;
                case "<=":
                    return n <= pred.value;
                case ">":
                    return n > pred.value;
                case ">=":
                    return n >= pred.value;
            }
            break;
        }
        case "has": {
            const i = atomIndex.get(pred.type);
            const row = i === undefined ? null : (s.rows[i] ?? null);
            return row !== null && (pred.tierMod === undefined || row === pred.tierMod);
        }
        case "hasGroup":
            return [...pred.types].some((t) => {
                const i = atomIndex.get(t);
                return i !== undefined && s.rows[i] !== null;
            });
        default:
            return fixed.get(pred) ?? false;
    }
    return false;
}

function genOfOn(registry: Registry, a: AItem, type: TypeId): Gen {
    return (
        rollableGen(registry.catalog, a.base, a.ilvl, type, influenceTagsAny(a, registry)) ??
        registry.genOfType(type) ??
        "prefix"
    );
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
