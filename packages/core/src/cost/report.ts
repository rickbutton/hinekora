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
import type { Gen, TypeId } from "../model/ids.js";
import type { Registry } from "../resolve/registry.js";
import { type AItem, type RPred, refine } from "../check/astate.js";
import { type CheckResult, predicateResolver, type TraceEntry } from "../check/check.js";
import { findMethod, type Literal } from "../check/methods.js";
import { rollableGen } from "../resolve/tiers.js";
import { influenceTagsAny } from "../check/ops.js";
import { chance } from "./chance.js";
import { countdown, type CountdownStep } from "./countdown.js";
import { guaranteedTypes } from "../check/astate.js";
import { addPrices, inChaos, type Price, type Prices, unitCost } from "./prices.js";
import { type Roll, rollOf, withPresent } from "./roll.js";

/** What the cost layer says about one statement. */
export interface StepCost {
    readonly span: SourceSpan;
    readonly kind: Stmt["kind"];
    /** The chance the step is reached in one pass of its enclosing block. */
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
}

export interface CostReport {
    readonly steps: readonly StepCost[];
    /** Every currency the guide is expected to spend, summed. */
    readonly total: readonly Price[];
    /** The total under the snapshot, where every item has a price. */
    readonly chaos?: number;
    readonly divine?: number;
    /** The items the snapshot could not price, and the steps whose price is unknown. */
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

export function costOf(
    craft: Craft,
    result: CheckResult,
    registry: Registry,
    snapshot?: Prices,
): CostReport {
    const walker = new Walker(craft, result, registry);
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
    const unpriced = new Set<string>();
    let chaos: number | undefined = 0;
    for (const p of total) {
        const c = snapshot === undefined ? undefined : inChaos([p], snapshot);
        if (c === undefined) {
            unpriced.add(p.item);
            chaos = undefined;
        } else if (chaos !== undefined) chaos += c;
    }
    for (const s of steps)
        if (s.unit === undefined && s.kind === "operation" && s.note) unpriced.add(s.note);
    return {
        steps,
        total,
        ...(snapshot !== undefined &&
            chaos !== undefined && { chaos, divine: chaos / snapshot.chaosPerDivine }),
        unpriced: [...unpriced],
        stopped: Math.min(1, top.stopped * passes),
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
    kept[0] = { mass: heaviest.mass + rest, path: heaviest.path };
    return kept;
}

class Walker {
    readonly steps: StepCost[] = [];
    private readonly byStart = new Map<string, TraceEntry>();
    private readonly resolve: (pred: Pred, a: AItem) => RPred | null;

    constructor(
        craft: Craft,
        result: CheckResult,
        private readonly registry: Registry,
    ) {
        for (const e of result.trace) this.byStart.set(`${e.kind}@${e.span.start.offset}`, e);
        this.resolve = predicateResolver(craft, registry);
    }

    private entry(s: Stmt): TraceEntry | undefined {
        return this.byStart.get(`${s.kind}@${s.span.start.offset}`);
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
        const roll = rollOf(entry.before, built, this.registry);
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
        const mass = massOf(branches);
        const before = entry?.before;
        const rpred = before === undefined ? null : this.resolve(stmt.pred, before);
        if (before !== undefined && rpred !== null) {
            const solved = this.makeRoom(stmt, before, rpred, branches, frame);
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
     * A make-room loop (`countdown.ts`): a body of random removals and the
     * branches that catch a kept modifier's loss, exiting on the counts. Solved
     * as a chain over the counts the loop enters with; undefined for any other
     * body, which takes the general path.
     */
    private makeRoom(
        stmt: Extract<Stmt, { kind: "until" }>,
        before: AItem,
        rpred: RPred,
        branches: readonly Branch[],
        frame: Frame,
    ): Branch[] | undefined {
        if (!countsOnly(rpred)) return undefined;
        const mass = massOf(branches);
        const kept = guaranteedTypes(before);
        const keepers = { prefix: 0, suffix: 0 };
        const keeperTypes = new Set<TypeId>();
        const body: CountdownStep[] = [];
        const guards: Extract<Stmt, { kind: "if" }>[] = [];
        for (const s of stmt.body) {
            if (s.kind === "operation") {
                const entry = this.entry(s);
                const method = findMethod(s.words);
                if (entry === undefined || method === undefined || entry.after === undefined)
                    return undefined;
                const literals: Literal[] = [];
                for (const arg of s.args) if (arg.kind !== "param") literals.push(arg);
                if (literals.length !== s.args.length) return undefined;
                const built = method.build(literals, entry.before, this.registry);
                if ("refused" in built) return undefined;
                const roll = rollOf(entry.before, built, this.registry);
                if (roll.kind === "none") body.push({ kind: "other" });
                else if (roll.kind === "removal") {
                    // A side the removal cannot reach counts nothing; one it alone
                    // reaches is the side it takes from.
                    const gen: Gen | undefined =
                        roll.sides.suffix.count === 0
                            ? "prefix"
                            : roll.sides.prefix.count === 0
                              ? "suffix"
                              : roll.gen;
                    body.push(gen === undefined ? { kind: "remove" } : { kind: "remove", gen });
                } else return undefined;
                continue;
            }
            if (s.kind === "if" && s.elseBody === undefined && s.body.length === 1) {
                const only = s.body[0]!;
                if (only.kind !== "restart" && only.kind !== "stop") return undefined;
                const guard = this.resolve(s.pred, before);
                if (guard === null) return undefined;
                const types = keeperTypesOf(guard);
                if (types === undefined) return undefined;
                for (const t of types) {
                    if (!kept.has(t) || keeperTypes.has(t)) continue;
                    keeperTypes.add(t);
                    keepers[genOfOn(this.registry, before, t)]++;
                }
                body.push({ kind: "guard", action: only.kind });
                guards.push(s);
                continue;
            }
            return undefined;
        }
        // The counts the loop enters with: every pair the item allows, weighted
        // by the chance the path in gives each, equal when no roll is on the path.
        const pairs: [number, number][] = [];
        const [t0, t1] = before.counts.total;
        const [p0, p1] = before.counts.prefix;
        for (let p = p0; p <= p1; p++) {
            for (let t = t0; t <= t1; t++) {
                const s = t - p;
                if (s >= 0 && s >= keepers.suffix && p >= keepers.prefix) pairs.push([p, s]);
            }
        }
        if (pairs.length === 0) return undefined;
        const starts: { prefix: number; suffix: number; weight: number }[] = [];
        for (const [p, s] of pairs) {
            let weight = 0;
            for (const b of branches) {
                const at: RPred = {
                    kind: "and",
                    left: { kind: "compare", projection: "prefixCount", op: "==", value: p },
                    right: { kind: "compare", projection: "suffixCount", op: "==", value: s },
                };
                const c = this.conditionChance(at, b.path, before);
                weight += b.mass * (c ?? 1 / pairs.length);
            }
            starts.push({ prefix: p, suffix: s, weight });
        }
        const solved = countdown({
            body,
            starts,
            keepers,
            exit: (p, s) => holdsOnCounts(rpred, p, s),
        });
        if (solved === undefined) return undefined;
        const ending = solved.exit + solved.stop;
        const attempts = ending > 0 ? 1 / ending : 1;
        // Rounds, not attempts: an attempt here is as many removals as the counts
        // take, and may be none when the loop is entered with room already.
        const rounds = solved.passes * attempts;
        this.record(stmt, mass, frame, {
            attempts: {
                chance: rounds > 0 ? Math.min(1, ending / solved.passes) : 1,
                expected: rounds,
            },
            ...(keeperTypes.size === 0 && guards.length > 0
                ? {
                      note: "the branches inside read modifiers the item is not known to have; they never fire here",
                  }
                : {}),
        });
        stmt.body.forEach((s, i) => {
            const reached = (solved.reached[i] ?? 0) * attempts;
            const scale = frame.scale * mass;
            if (s.kind === "if") {
                const fired = (solved.fired[i] ?? 0) * attempts;
                this.record(
                    s,
                    reached,
                    { scale, stopped: 0, restarted: 0 },
                    {
                        branch: reached > 0 ? fired / reached : 0,
                    },
                );
                this.record(s.body[0]!, fired, { scale, stopped: 0, restarted: 0 }, {});
                return;
            }
            const inner: Frame = { scale, stopped: 0, restarted: 0 };
            this.statement(s, [{ mass: reached, path: undefined }], inner);
        });
        const stopShare = ending > 0 ? solved.stop / ending : 0;
        frame.stopped += mass * stopShare;
        return [{ mass: mass * (1 - stopShare), path: undefined }];
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
        const name = literals[0];
        if (name === undefined || name.kind !== "string") return path;
        const tier = literals[1];
        const craft = this.registry.resolveBench(
            name.value,
            after.base.itemClass,
            tier !== undefined && (tier.kind === "tier" || tier.kind === "int")
                ? tier.value
                : undefined,
        );
        if (!craft.ok) return path;
        const mod = this.registry.resolveMod(craft.value.mod);
        if (!mod.ok) return path;
        const gen =
            rollableGen(
                this.registry.catalog,
                after.base,
                after.ilvl,
                mod.value.type,
                influenceTagsAny(after, this.registry),
            ) ?? mod.value.gen;
        return { ...path, roll: withPresent(path.roll, mod.value.type, gen, mod.value), after };
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

/** Whether a condition reads the counts alone. */
function countsOnly(pred: RPred): boolean {
    switch (pred.kind) {
        case "compare":
            return true;
        case "not":
            return countsOnly(pred.inner);
        case "and":
        case "or":
            return countsOnly(pred.left) && countsOnly(pred.right);
        default:
            return false;
    }
}

function holdsOnCounts(pred: RPred, prefix: number, suffix: number): boolean {
    switch (pred.kind) {
        case "compare": {
            const n = pred.projection === "prefixCount" ? prefix : suffix;
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
        case "not":
            return !holdsOnCounts(pred.inner, prefix, suffix);
        case "and":
            return (
                holdsOnCounts(pred.left, prefix, suffix) &&
                holdsOnCounts(pred.right, prefix, suffix)
            );
        case "or":
            return (
                holdsOnCounts(pred.left, prefix, suffix) ||
                holdsOnCounts(pred.right, prefix, suffix)
            );
        default:
            return false;
    }
    return false;
}

/** The modifiers a guard keeps: a condition of the form "not (has these)",
 *  in any combination of `and`/`or`; undefined for any other shape. */
function keeperTypesOf(pred: RPred): TypeId[] | undefined {
    if (pred.kind !== "not") return undefined;
    const out: TypeId[] = [];
    const walk = (p: RPred): boolean => {
        switch (p.kind) {
            case "has":
            case "hasValue":
                out.push(p.type);
                return true;
            case "hasGroup":
                out.push(...p.types);
                return true;
            case "and":
            case "or":
                return walk(p.left) && walk(p.right);
            default:
                return false;
        }
    };
    return walk(pred.inner) ? out : undefined;
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
