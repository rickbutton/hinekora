/**
 * The reference frame: a method over explicit items, one at a time, with the
 * semantics check/method.ts states. Each item reads its rules from its own
 * modifiers; a `require` an item reached by the method breaks, or an
 * operation that cannot act on it, is reported, and the method does not
 * apply to that item. Test support.
 */
import type { Op } from "../ops/types.js";
import type { TypeId } from "../../model/ids.js";
import {
    dispatchKey,
    type DispatchKey,
    InternalError,
    NotImplementedError,
    readsFor,
    restrictRules,
} from "../ops/handler.js";
import type { PoolTable } from "../ops/pools.js";
import { HANDLERS } from "../ops/registry.js";
import { checkPlacement, type CompoundKind, type Step, stepsOf } from "../ops/steps.js";
import { type Choice, effectsKey, NO_CHOICE, relevantEffects, type RuleField } from "../rules.js";
import { type CItem, effectsOn, type RefCtx, rowOf } from "./item.js";
import { choicesFor, refKeeping, refRulesOf } from "./rules.js";
import type {
    RefCheckHandler,
    RefCompoundHandler,
    RefHandlers,
    RefMethodCtx,
    RefTransformHandler,
} from "./ops/handler.js";
import { REF_HANDLERS } from "./ops/registry.js";
import { CItemSet } from "./sets.js";
import { effectsOf } from "../../model/effects.js";

export interface RefMethodRun {
    /** No item breaks a check. */
    readonly ok: boolean;
    /** The items the method leaves; on a refusal with none, the recovery. */
    readonly state: CItemSet;
    /** Every item that passed the checks was consumed by an `end`. */
    readonly ended: boolean;
    /** By the index of each `require`, the items it refused, and of each
     *  operation, the items it could not act on; absent where none. */
    readonly failing: ReadonlyMap<number, CItemSet>;
    /** As `TransferResult.under`. */
    readonly under?: readonly TypeId[];
    /** Some item's path was consumed by an `end`. */
    readonly reachedEnd: boolean;
}

type Check = Extract<Step, { kind: "require" }>;

const transformOf = (h: RefHandlers, key: DispatchKey): RefTransformHandler<DispatchKey> => {
    const t = h.transforms[key] as RefTransformHandler<DispatchKey> | undefined;
    if (t === undefined) throw new NotImplementedError(`the operation "${key}"`);
    return t;
};
const compoundOf = (h: RefHandlers, kind: CompoundKind): RefCompoundHandler<CompoundKind> => {
    const t = h.compounds[kind] as RefCompoundHandler<CompoundKind> | undefined;
    if (t === undefined) throw new NotImplementedError(`the run "${kind}"`);
    return t;
};
const checkOf = (h: RefHandlers, s: Check): RefCheckHandler<Check["check"]["kind"]> => {
    const t = h.checks[s.check.kind] as RefCheckHandler<Check["check"]["kind"]> | undefined;
    if (t === undefined) throw new NotImplementedError(`the check "${s.check.kind}"`);
    return t;
};

function readsOf(steps: readonly Step[], h: RefHandlers): Set<RuleField> {
    const out = new Set<RuleField>();
    const visit = (s: Step): void => {
        if (s.kind === "require") readsFor(checkOf(h, s).reads, s.check).forEach((f) => out.add(f));
        else if (s.kind === "single")
            readsFor(transformOf(h, dispatchKey(s.op)).reads, s.op as never).forEach((f) =>
                out.add(f),
            );
        else if (s.kind === "compound")
            readsFor(compoundOf(h, s.compound.kind).reads, s.compound).forEach((f) => out.add(f));
        else if (s.kind === "either") s.branches.forEach((b) => b.forEach(visit));
    };
    steps.forEach(visit);
    return out;
}

interface Run {
    reachedEnd: boolean;
    reached: Map<number, CItem[]>;
    failing: Map<number, CItem[]>;
}

export function refRunMethod(
    start: CItemSet,
    ops: readonly Op[],
    ctx: RefCtx,
    handlers: RefHandlers = REF_HANDLERS,
): RefMethodRun {
    checkPlacement(ops);
    const steps = stepsOf(ops);
    const reads = readsOf(steps, handlers);
    const run: Run = { reachedEnd: false, reached: new Map(), failing: new Map() };
    const out: CItem[] = [];
    // The items by metamod case, as the symbolic frame splits them.
    const cases = new Map<string, { carriers: TypeId[]; refusedAt: Set<number> }>();
    for (const item of start) {
        const key = effectsKey(relevantEffects(effectsOn(ctx, item), reads));
        const carriers = item.mods
            .map((m) => rowOf(ctx, m))
            .filter((r) => relevantEffects(effectsOf(r), reads).length > 0)
            .map((r) => r.type);
        const held = cases.get(key);
        const c = held ?? { carriers, refusedAt: new Set<number>() };
        if (held !== undefined) c.carriers = c.carriers.filter((t) => carriers.includes(t));
        cases.set(key, c);
        const before = new Set(run.failing.keys());
        const sizes = new Map([...run.failing].map(([i, xs]) => [i, xs.length]));
        // An item may have more outcomes than a spread's arguments may hold.
        const choices = reads.has("protected") ? choicesFor(ctx, item) : [NO_CHOICE];
        for (const choice of choices) {
            for (const x of runItem(item, choice, ops, steps, ctx, handlers, run)) out.push(x);
        }
        for (const [i, xs] of run.failing) {
            if (!before.has(i) || xs.length > (sizes.get(i) ?? 0)) c.refusedAt.add(i);
        }
    }
    const passed = CItemSet.of(out);
    const failing = new Map([...run.failing].map(([i, xs]) => [i, CItemSet.of(xs)]));
    const first = failing.size === 0 ? undefined : Math.min(...failing.keys());
    if (first === undefined) {
        return {
            ok: true,
            state: passed.size > 0 ? passed : start,
            ended: passed.size === 0 && run.reachedEnd,
            failing,
            reachedEnd: run.reachedEnd,
        };
    }
    const all = [...cases.values()];
    const common = (cs: readonly { carriers: TypeId[] }[]): TypeId[] =>
        cs
            .map((c) => c.carriers)
            .reduce((a, b) => a.filter((t) => b.includes(t)), [...cs[0]!.carriers]);
    const everywhere = common(all);
    const under = common(all.filter((c) => c.refusedAt.has(first))).filter(
        (t) => !everywhere.includes(t),
    );
    const refusal = {
        ok: false,
        failing,
        reachedEnd: run.reachedEnd,
        ...(all.some((c) => c.refusedAt.size === 0) && under.length > 0 && { under }),
    };
    if (passed.size > 0) return { ...refusal, state: passed, ended: false };
    if (run.reachedEnd) return { ...refusal, state: start, ended: true };
    const step = steps.find((s): s is Check => s.kind === "require" && s.at === first);
    const repair = step === undefined ? undefined : checkOf(handlers, step).repair;
    const mctx = (item: CItem): RefMethodCtx => ({
        ctx,
        rules: refRulesOf(ctx, item, ops),
        start: item,
        pools: poolsOf(handlers),
    });
    const repaired =
        repair === undefined
            ? CItemSet.empty
            : CItemSet.of(
                  failing
                      .get(first)!
                      .items()
                      .flatMap((x) => repair(step!.check as never, x, mctx(x))),
              );
    if (repaired.size === 0) return { ...refusal, state: start, ended: false };
    const rest = refRunMethod(repaired, ops.slice(first + 1), ctx, handlers);
    return { ...refusal, state: rest.state, ended: rest.ended };
}

/** The pools the draws read: the handlers' own, every family's by default,
 *  since the reference's families state none of their own. */
function poolsOf(handlers: RefHandlers): PoolTable {
    return handlers.pools ?? HANDLERS.pools ?? {};
}

function runItem(
    item: CItem,
    choice: Choice,
    ops: readonly Op[],
    steps: readonly Step[],
    ctx: RefCtx,
    handlers: RefHandlers,
    run: Run,
): CItem[] {
    let mctx: RefMethodCtx = {
        ctx,
        rules: refRulesOf(ctx, item, ops, choice),
        start: item,
        pools: poolsOf(handlers),
    };
    let cur: CItem[] = [item];
    for (const step of steps) {
        if (cur.length === 0) break;
        switch (step.kind) {
            case "require": {
                const h = checkOf(handlers, step);
                const rules = restrictRules(
                    mctx.rules,
                    readsFor(h.reads, step.check),
                    `the check "${step.check.kind}"`,
                );
                const pass = cur.filter((x) => h.pass(step.check as never, x, { ...mctx, rules }));
                if (pass.length !== 0 && pass.length !== cur.length) {
                    throw new InternalError(
                        `the outcomes of one item disagree on the check "${step.check.kind}"`,
                    );
                }
                run.reached.set(step.at, [...(run.reached.get(step.at) ?? []), ...cur]);
                if (pass.length === 0)
                    run.failing.set(step.at, [...(run.failing.get(step.at) ?? []), ...cur]);
                cur = pass;
                break;
            }
            case "keep":
                mctx = { ...mctx, rules: refKeeping(mctx.rules, step.op.gen) };
                break;
            default:
                cur = cur.flatMap((x) => {
                    const r = exec(step, x, mctx, handlers, run);
                    if (r.stuck) run.failing.set(step.at, [...(run.failing.get(step.at) ?? []), x]);
                    return r.items;
                });
        }
    }
    return cur;
}

/** The outcomes of one step on one item, and whether it has none because
 *  the step cannot act on it. */
function exec(
    step: Step,
    item: CItem,
    ctx: RefMethodCtx,
    handlers: RefHandlers,
    run: Run,
): { items: CItem[]; stuck: boolean } {
    let r: readonly CItem[];
    let who: string;
    switch (step.kind) {
        case "end":
            run.reachedEnd = true;
            return { items: [], stuck: false };
        case "either": {
            // Stuck only where no branch has an outcome for the item and none
            // ended it; within a branch a path without one goes.
            const ends = run.reachedEnd;
            run.reachedEnd = false;
            const items = step.branches.flatMap((b) =>
                b.reduce<CItem[]>(
                    (xs, s) => xs.flatMap((x) => exec(s, x, ctx, handlers, run).items),
                    [item],
                ),
            );
            const stuck = items.length === 0 && !run.reachedEnd;
            run.reachedEnd ||= ends;
            return { items, stuck };
        }
        case "single": {
            const key = dispatchKey(step.op);
            const h = transformOf(handlers, key);
            who = `the operation "${key}"`;
            r = h.apply(step.op as never, item, {
                ...ctx,
                rules: restrictRules(ctx.rules, readsFor(h.reads, step.op as never), who),
            });
            break;
        }
        case "compound": {
            const h = compoundOf(handlers, step.compound.kind);
            who = `the run "${step.compound.kind}"`;
            r = h.apply(step.compound, item, {
                ...ctx,
                rules: restrictRules(ctx.rules, readsFor(h.reads, step.compound), who),
            });
            break;
        }
        default:
            throw new InternalError(`a "${step.kind}" inside a branch`);
    }
    return { items: [...r], stuck: r.length === 0 };
}
