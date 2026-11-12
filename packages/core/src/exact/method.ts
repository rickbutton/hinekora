/**
 * A method run exactly (docs/EXACT.md §4): the exact counterpart of
 * check/ops.ts `runMethod`, with the same result shape over the exact state.
 *
 * - The method's steps are matched first (ops/steps.ts): a compound run goes
 *   to one handler, and a `require` may follow only operations that leave
 *   one item of each.
 * - The rules are read once, per item, from the metamods it carries when the
 *   method starts. The state is split by the carriers that decide a rule some
 *   handler of this method reads, each case runs under its own rules, and the
 *   results are united. `unprotect` and `keep` change a case's rules.
 * - A `require` is judged on the items the method has reached; those that
 *   break it are refused and the method goes on from those that pass. Any
 *   refused item refuses the method, which is all or nothing; the refusal is
 *   worded once, over every case together.
 * - The craft ends when every item that passed the checks was consumed by an
 *   `end`.
 * - Recovery, outside the equality of §1: when no item passes, the craft goes
 *   on from the refused items of the first refusing check as the guide meant
 *   them (`CheckVerdict.repair`), or from the unchanged state, so one wrong
 *   step does not refuse every step after it.
 */
import type { Op, PreconditionFailure } from "../check/ops.js";
import { type Effect, effectsOf } from "../model/effects.js";
import type { TypeId } from "../model/ids.js";
import type { Dd } from "./dd.js";
import {
    type CheckHandler,
    type CheckVerdict,
    type CompoundHandler,
    type DispatchKey,
    dispatchKey,
    type Handlers,
    InternalError,
    type MethodCtx,
    NotImplementedError,
    readsFor,
    restrictRules,
    type TransformHandler,
} from "./ops/handler.js";
import { HANDLERS } from "./ops/registry.js";
import { checkPlacement, type CompoundKind, type Step, stepsOf } from "./ops/steps.js";
import {
    effectsKey,
    keeping,
    relevantEffects,
    type RuleField,
    type Rules,
    rulesOf,
    unprotected,
} from "./rules.js";
import type { XItem } from "./state.js";

export type XTransferResult = (
    | { readonly ok: true; readonly state: XItem }
    | {
          readonly ok: false;
          readonly failure: PreconditionFailure;
          readonly state: XItem;
          /** The metamods every refused case carries and some other case does
           *  not, when some case goes through. */
          readonly under?: readonly TypeId[];
      }
) & {
    /** Every item that passed the checks was consumed by an `end`. */
    readonly ended?: true;
};

export interface MethodRun {
    readonly result: XTransferResult;
    /** By the index of each `require`, the items it refused over every case;
     *  absent where it refused none. */
    readonly failing: ReadonlyMap<number, Dd>;
}

export function runMethod(
    state: XItem,
    ops: readonly Op[],
    handlers: Handlers = HANDLERS,
): XTransferResult {
    return runMethodTrace(state, ops, handlers).result;
}

/** A metamod case: the items carrying one combination of the effects the
 *  method reads. */
export interface MetamodCase {
    readonly dd: Dd;
    readonly effects: readonly Effect[];
    /** The types carrying those effects on every item of the case. */
    readonly carriers: readonly TypeId[];
}

/**
 * The state split by the effect-carrying values of each modifier slot, as
 * far as the effects decide a field of `reads`; combinations equal on those
 * fields are one case. The case carrying none comes first.
 */
export function metamodCases(s: XItem, reads: ReadonlySet<RuleField>): readonly MetamodCase[] {
    const { u } = s;
    const m = u.dd;
    interface Combo {
        dd: Dd;
        effects: Effect[];
        carriers: TypeId[];
    }
    let combos: Combo[] = [{ dd: s.dd, effects: [], carriers: [] }];
    for (const slot of u.modSlots()) {
        const ms = u.modSlot(slot)!;
        const groups = new Map<string, { effects: Effect[]; values: number[] }>();
        ms.values.forEach((v, i) => {
            const effects = v === undefined ? [] : relevantEffects(effectsOf(v.row), reads);
            const key = effectsKey(effects);
            const g = groups.get(key);
            if (g === undefined) groups.set(key, { effects, values: [i] });
            else g.values.push(i);
        });
        if (groups.size < 2 && groups.has("")) continue;
        const next: Combo[] = [];
        const ordered = [...groups.entries()].sort(([a], [b]) =>
            a === "" ? -1 : b === "" ? 1 : 0,
        );
        for (const [key, g] of ordered) {
            for (const c of combos) {
                const dd = m.and(c.dd, m.slotIn(slot, g.values));
                if (dd === m.EMPTY) continue;
                next.push(
                    key === ""
                        ? { ...c, dd }
                        : {
                              dd,
                              effects: [...c.effects, ...g.effects],
                              carriers: [...c.carriers, ms.type],
                          },
                );
            }
        }
        combos = next;
    }
    const merged = new Map<string, Combo>();
    for (const c of combos) {
        const key = effectsKey(c.effects);
        const held = merged.get(key);
        if (held === undefined) merged.set(key, { ...c });
        else {
            held.dd = m.or(held.dd, c.dd);
            held.carriers = held.carriers.filter((t) => c.carriers.includes(t));
        }
    }
    return [...merged.values()];
}

/** What one `require` saw over the parts run so far. */
interface Judged {
    reached: Dd;
    failing: Dd;
    verdict: CheckVerdict;
}

interface CaseRun {
    out: Dd;
    reachedEnd: boolean;
    judged: Map<number, Judged>;
}

export function runMethodTrace(
    state: XItem,
    ops: readonly Op[],
    handlers: Handlers = HANDLERS,
): MethodRun {
    checkPlacement(ops);
    const { u } = state;
    const m = u.dd;
    const steps = stepsOf(ops);
    const reads = readsOf(steps, handlers);
    const cases = metamodCases(state, reads);
    const splits = splitsOf(steps, handlers, state);
    let out = m.EMPTY;
    let reachedEnd = false;
    let passedCase = false;
    const judged = new Map<number, Judged>();
    const refusedAt = new Map<number, MetamodCase[]>();
    for (const c of cases) {
        let refused = false;
        for (const part of parts(c.dd, splits, state)) {
            const run = runCase(state, part, rulesOf(c.effects, ops), steps, handlers);
            out = m.or(out, run.out);
            reachedEnd ||= run.reachedEnd;
            for (const [i, j] of run.judged) {
                const held = judged.get(i);
                if (held === undefined) judged.set(i, { ...j });
                else {
                    if (held.failing === m.EMPTY && j.failing !== m.EMPTY) held.verdict = j.verdict;
                    held.reached = m.or(held.reached, j.reached);
                    held.failing = m.or(held.failing, j.failing);
                }
                if (j.failing !== m.EMPTY) {
                    refused = true;
                    const at = refusedAt.get(i) ?? [];
                    if (!at.includes(c)) refusedAt.set(i, [...at, c]);
                }
            }
        }
        if (!refused) passedCase = true;
    }
    const failing = new Map<number, Dd>();
    for (const [i, j] of judged) if (j.failing !== m.EMPTY) failing.set(i, j.failing);
    const first = failing.size === 0 ? undefined : Math.min(...failing.keys());
    const ended = out === m.EMPTY && reachedEnd ? ({ ended: true } as const) : {};
    if (first === undefined) {
        return {
            result: { ok: true, state: out === m.EMPTY ? state : { u, dd: out }, ...ended },
            failing,
        };
    }
    const j = judged.get(first)!;
    const failure = j.verdict.word({ u, dd: j.failing }, { u, dd: j.reached });
    const common = (cs: readonly MetamodCase[]): TypeId[] =>
        cs
            .map((c) => c.carriers)
            .reduce<TypeId[]>((a, b) => a.filter((t) => b.includes(t)), [...cs[0]!.carriers]);
    const everywhere = common(cases);
    const under = common(refusedAt.get(first)!).filter((t) => !everywhere.includes(t));
    const refusal = {
        ok: false as const,
        failure,
        ...(passedCase && under.length > 0 && { under }),
    };
    if (out !== m.EMPTY) return { result: { ...refusal, state: { u, dd: out } }, failing };
    if (reachedEnd) return { result: { ...refusal, state, ...ended }, failing };
    const repaired = j.verdict.repair?.(j.failing) ?? m.EMPTY;
    if (repaired === m.EMPTY) return { result: { ...refusal, state }, failing };
    const rest = runMethodTrace({ u, dd: repaired }, ops.slice(first + 1), handlers).result;
    return {
        result: {
            ...refusal,
            state: rest.state,
            ...(rest.ended === true && { ended: true as const }),
        },
        failing,
    };
}

function transformHandler(handlers: Handlers, key: DispatchKey): TransformHandler<DispatchKey> {
    const h = handlers.transforms[key] as TransformHandler<DispatchKey> | undefined;
    if (h === undefined) throw new NotImplementedError(`the operation "${key}"`);
    return h;
}

function compoundHandler(handlers: Handlers, kind: CompoundKind): CompoundHandler<CompoundKind> {
    const h = handlers.compounds[kind] as CompoundHandler<CompoundKind> | undefined;
    if (h === undefined) throw new NotImplementedError(`the run "${kind}"`);
    return h;
}

function checkHandler(
    handlers: Handlers,
    kind: Step & { kind: "require" },
): CheckHandler<typeof kind.check.kind> {
    const h = handlers.checks[kind.check.kind] as CheckHandler<typeof kind.check.kind> | undefined;
    if (h === undefined) throw new NotImplementedError(`the check "${kind.check.kind}"`);
    return h;
}

/** Every rule field a handler of the method reads. */
function readsOf(steps: readonly Step[], handlers: Handlers): Set<RuleField> {
    const out = new Set<RuleField>();
    const visit = (s: Step): void => {
        switch (s.kind) {
            case "require":
                for (const f of readsFor(checkHandler(handlers, s).reads, s.check)) out.add(f);
                return;
            case "single":
                for (const f of readsFor(
                    transformHandler(handlers, dispatchKey(s.op)).reads,
                    s.op as never,
                ))
                    out.add(f);
                return;
            case "compound":
                for (const f of readsFor(
                    compoundHandler(handlers, s.compound.kind).reads,
                    s.compound,
                ))
                    out.add(f);
                return;
            case "either":
                for (const b of s.branches) b.forEach(visit);
                return;
            default:
                return;
        }
    };
    steps.forEach(visit);
    return out;
}

/** The partitions the method's operations cut the start by. */
function splitsOf(steps: readonly Step[], handlers: Handlers, s: XItem): (readonly Dd[])[] {
    const out: (readonly Dd[])[] = [];
    const visit = (step: Step): void => {
        let split: readonly Dd[] | undefined;
        if (step.kind === "single") {
            split = transformHandler(handlers, dispatchKey(step.op)).split?.(step.op as never, s.u);
        } else if (step.kind === "compound") {
            split = compoundHandler(handlers, step.compound.kind).split?.(step.compound, s.u);
        } else if (step.kind === "either") {
            for (const b of step.branches) b.forEach(visit);
        }
        if (split !== undefined) out.push(split);
    };
    steps.forEach(visit);
    return out;
}

function parts(dd: Dd, splits: readonly (readonly Dd[])[], s: XItem): Dd[] {
    const m = s.u.dd;
    let out = [dd];
    for (const split of splits) {
        out = out.flatMap((p) => split.map((q) => m.and(p, q)).filter((r) => r !== m.EMPTY));
    }
    return out;
}

function runCase(
    s: XItem,
    start: Dd,
    initial: Rules,
    steps: readonly Step[],
    handlers: Handlers,
): CaseRun {
    const { u } = s;
    const m = u.dd;
    let ctx: MethodCtx = {
        u,
        rules: initial,
        start,
        ...(handlers.pools !== undefined && { pools: handlers.pools }),
    };
    const run: CaseRun = { out: m.EMPTY, reachedEnd: false, judged: new Map() };
    let cur = start;
    for (const step of steps) {
        if (cur === m.EMPTY) break;
        switch (step.kind) {
            case "require": {
                const h = checkHandler(handlers, step);
                const verdict = h.verdict(step.check, cur, {
                    ...ctx,
                    rules: restrictRules(
                        ctx.rules,
                        readsFor(h.reads, step.check),
                        `the check "${step.check.kind}"`,
                    ),
                });
                const fail = m.diff(cur, verdict.pass);
                run.judged.set(step.at, { reached: cur, failing: fail, verdict });
                cur = m.and(cur, verdict.pass);
                break;
            }
            case "unprotect":
                ctx = { ...ctx, rules: unprotected(ctx.rules) };
                break;
            case "keep":
                ctx = { ...ctx, rules: keeping(ctx.rules, step.op.gen) };
                break;
            default:
                cur = exec(step, cur, ctx, handlers, run, false);
        }
    }
    run.out = cur;
    return run;
}

/** The image of one step; an item may go without an outcome only in a
 *  branch of an `either` or through an `end`. */
function exec(
    step: Step,
    state: Dd,
    ctx: MethodCtx,
    handlers: Handlers,
    run: CaseRun,
    branch: boolean,
): Dd {
    const m = ctx.u.dd;
    if (state === m.EMPTY) return state;
    let r: Dd;
    let who: string;
    switch (step.kind) {
        case "end":
            run.reachedEnd = true;
            return m.EMPTY;
        case "either": {
            const ends = run.reachedEnd;
            run.reachedEnd = false;
            r = m.EMPTY;
            for (const b of step.branches) {
                let x = state;
                for (const s of b) x = exec(s, x, ctx, handlers, run, true);
                r = m.or(r, x);
            }
            if (r === m.EMPTY && !run.reachedEnd && !branch) {
                throw new InternalError("no branch of an either has an outcome or ends");
            }
            run.reachedEnd ||= ends;
            return r;
        }
        case "single": {
            const key = dispatchKey(step.op);
            const h = transformHandler(handlers, key);
            who = `the operation "${key}"`;
            r = h.apply(step.op as never, state, {
                ...ctx,
                rules: restrictRules(ctx.rules, readsFor(h.reads, step.op as never), who),
            });
            break;
        }
        case "compound": {
            const h = compoundHandler(handlers, step.compound.kind);
            who = `the run "${step.compound.kind}"`;
            r = h.apply(step.compound, state, {
                ...ctx,
                rules: restrictRules(ctx.rules, readsFor(h.reads, step.compound), who),
            });
            break;
        }
        default:
            throw new InternalError(`a "${step.kind}" inside a branch`);
    }
    if (r === m.EMPTY && !branch)
        throw new InternalError(`${who} leaves no outcome on items the checks passed`);
    return r;
}
