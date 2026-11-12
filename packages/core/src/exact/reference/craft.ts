/**
 * The reference driver: a craft run over explicit sets of concrete items, the
 * language's semantics written the obvious way. Each statement maps a set of
 * items to the set it lets through. Test support: what exact/check.ts is held
 * to.
 *
 * - An operation is built for each item alone (`buildFor`); the items built
 *   the same operations run as one set (`refRunMethod`), and the sets that
 *   fall through are united. An item its builder refuses goes on unchanged.
 * - An `if` splits the set by the condition read on each item (`holdsPred`).
 * - A loop's head starts as the entry; each round adds what the body brings
 *   back (falling off its end or by `restart`) from the head's items that do
 *   not meet the condition, until a round adds nothing. Then the body runs
 *   once more from those items, for the findings and the records; the exit is
 *   the head's items that meet the condition, the whole head where none does.
 * - A call runs its body with its arguments bound (check/defs.ts).
 *
 * Only the last run of a loop's body records anything. A loop past the round
 * limit ends the run.
 */
import type { Craft, Pred, Stmt } from "../../ast/ast.js";
import type { SourceSpan } from "../../ast/span.js";
import {
    bindArgs,
    collectDefs,
    collectProcs,
    type PredDefs,
    type ProcEntry,
    substituteStmts,
} from "../../check/defs.js";
import { findMethod, type Literal } from "../../check/methods.js";
import type { Op } from "../../check/ops.js";
import type { Registry } from "../../resolve/registry.js";
import { buildKey } from "../build.js";
import {
    checkExact,
    type ExactCheckResult,
    type ExactTuning,
    type FindingKind,
    type XTraceEntry,
} from "../check.js";
import type { Dd } from "../dd.js";
import { buildFor } from "./build.js";
import { atCells } from "./harness.js";
import { initialItems } from "./initial.js";
import { type CItem, itemKey, type RefCtx } from "./item.js";
import { listItems } from "./listing.js";
import { refRunMethod } from "./method.js";
import { holdsPred } from "./pred.js";
import { diffSets, ItemSet } from "./sets.js";

export interface RefRecord {
    readonly span: SourceSpan;
    readonly kind: Stmt["kind"] | "item";
    readonly before: ItemSet;
    /** Absent where no item falls through. */
    readonly after?: ItemSet;
    /** A call's body's records. */
    readonly inner?: readonly RefRecord[];
}

export interface RefFinding {
    readonly kind: FindingKind;
    readonly span: SourceSpan;
    /** As exact/check.ts `Finding.failing`. */
    readonly failing?: ReadonlyMap<string, ItemSet>;
    readonly unbuilt?: ItemSet;
}

export interface RefCraftRun {
    readonly records: readonly RefRecord[];
    readonly findings: readonly RefFinding[];
    /** The items after the last statement, where some fall through it. */
    readonly final?: ItemSet;
    /** The body's runs each loop took to settle, outside the rounds of an
     *  enclosing loop. */
    readonly rounds: readonly number[];
}

export interface RefCraftOptions {
    readonly maxRounds?: number;
    /** Applied to the first set and to every operation's result: the exact
     *  side reads an item at its value cells (reference/harness.ts `atCells`). */
    readonly normalize?: (items: ItemSet) => ItemSet;
}

interface Flow {
    readonly fall: ItemSet;
    readonly restarted: boolean;
}

class Stop extends Error {}

export function refCheckCraft(
    craft: Craft,
    ctx: RefCtx,
    options: RefCraftOptions = {},
): RefCraftRun {
    const normalize = options.normalize ?? ((s: ItemSet) => s);
    const maxRounds = options.maxRounds ?? 256;
    const silent = (): void => {};
    const defs = collectDefs(craft.defs, silent);
    const procs: Map<string, ProcEntry> = collectProcs(craft.procs, defs, silent);
    const predDefs: PredDefs = { defs, procs };
    const findings: RefFinding[] = [];
    const rounds: number[] = [];
    const frames: { back: ItemSet }[] = [];
    let records: RefRecord[] = [];
    let quiet = 0;

    const find = (f: RefFinding): void => {
        if (quiet === 0) findings.push(f);
    };
    // The loops run the same conditions and methods on the same items round
    // after round; both are functions of their inputs, so each is worked out once.
    const truths = new Map<Pred, Map<string, boolean>>();
    const holds = (p: Pred, x: CItem): boolean => {
        let byItem = truths.get(p);
        if (byItem === undefined) truths.set(p, (byItem = new Map<string, boolean>()));
        const k = itemKey(x);
        let t = byItem.get(k);
        if (t === undefined) byItem.set(k, (t = holdsPred(p, x, ctx, predDefs)));
        return t;
    };
    const runs = new Map<string, ReturnType<typeof refRunMethod>>();
    const runOn = (
        key: string,
        set: ItemSet,
        ops: readonly Op[],
    ): ReturnType<typeof refRunMethod> => {
        const k = `${key}|${set.keys().join(";")}`;
        let r = runs.get(k);
        if (r === undefined) runs.set(k, (r = refRunMethod(set, ops, ctx)));
        return r;
    };
    const none: Flow = { fall: ItemSet.empty, restarted: false };

    const seq = (entry: ItemSet, stmts: readonly Stmt[]): Flow => {
        let s = entry;
        let restarted = false;
        for (const [i, stmt] of stmts.entries()) {
            const f = run(s, stmt);
            restarted ||= f.restarted;
            if (f.fall.size === 0) {
                const next = stmts[i + 1];
                if (next !== undefined) find({ kind: "unreachable", span: next.span });
                return { fall: ItemSet.empty, restarted };
            }
            s = f.fall;
        }
        return { fall: s, restarted };
    };

    const run = (s: ItemSet, stmt: Stmt): Flow => {
        const outer = records;
        let inner: RefRecord[] | undefined;
        if (stmt.kind === "call") records = inner = [];
        let f: Flow;
        try {
            f = step(s, stmt);
        } finally {
            records = outer;
        }
        if (quiet === 0) {
            records.push({
                span: stmt.span,
                kind: stmt.kind,
                before: s,
                ...(f.fall.size > 0 && { after: f.fall }),
                ...(inner !== undefined && { inner }),
            });
        }
        return f;
    };

    const step = (s: ItemSet, stmt: Stmt): Flow => {
        switch (stmt.kind) {
            case "operation":
                return operation(s, stmt);
            case "restart": {
                const frame = frames[frames.length - 1];
                if (frame === undefined) return none;
                frame.back = frame.back.union(s);
                return { fall: ItemSet.empty, restarted: true };
            }
            case "stop":
                return none;
            case "if": {
                const yes = s.filter((x) => holds(stmt.pred, x));
                const no = s.minus(yes);
                if (yes.size === 0) find({ kind: "deadIf", span: stmt.pred.span });
                if (no.size === 0 && stmt.elseBody !== undefined) {
                    find({ kind: "deadElse", span: stmt.pred.span });
                }
                let fall = ItemSet.empty;
                let restarted = false;
                for (const [entry, body] of [
                    [yes, stmt.body],
                    [no, stmt.elseBody ?? []],
                ] as const) {
                    if (entry.size === 0) continue;
                    const f = seq(entry, body);
                    fall = fall.union(f.fall);
                    restarted ||= f.restarted;
                }
                return { fall, restarted };
            }
            case "until": {
                const going = (h: ItemSet): ItemSet => h.filter((x) => !holds(stmt.pred, x));
                let head = s;
                let ran = 0;
                quiet++;
                try {
                    for (let round = 1; ; round++) {
                        const g = going(head);
                        if (g.size === 0) break;
                        ran++;
                        const next = head.union(back(g, stmt.body));
                        if (next.equals(head)) break;
                        if (round > maxRounds) {
                            findings.push({ kind: "unsettled", span: stmt.span });
                            throw new Stop();
                        }
                        head = next;
                    }
                } finally {
                    quiet--;
                }
                if (quiet === 0) rounds.push(ran);
                const g = going(head);
                const exit = head.minus(g);
                if (g.size === 0) {
                    find({ kind: "neverRuns", span: stmt.pred.span });
                    return { fall: s, restarted: false };
                }
                if (exit.size === 0) find({ kind: "neverExits", span: stmt.pred.span });
                if (quiet === 0) back(g, stmt.body);
                return { fall: exit.size > 0 ? exit : head, restarted: false };
            }
            case "call": {
                const entry = procs.get(stmt.name);
                if (entry === undefined || !entry.valid) return { fall: s, restarted: false };
                const env = bindArgs(
                    stmt.name,
                    entry.proc.params,
                    entry.paramTypes,
                    stmt.args,
                    stmt.span,
                    silent,
                );
                if (env === null) return { fall: s, restarted: false };
                return seq(s, substituteStmts(entry.proc.body, env));
            }
            case "paramStep":
                return { fall: s, restarted: false };
        }
    };

    const back = (entry: ItemSet, body: readonly Stmt[]): ItemSet => {
        const frame = { back: ItemSet.empty };
        frames.push(frame);
        try {
            return seq(entry, body).fall.union(frame.back);
        } finally {
            frames.pop();
        }
    };

    const operation = (s: ItemSet, stmt: Extract<Stmt, { kind: "operation" }>): Flow => {
        const method = findMethod(stmt.words);
        const literals: Literal[] = [];
        for (const a of stmt.args) if (a.kind !== "param") literals.push(a);
        if (method === undefined || literals.length < stmt.args.length) {
            return { fall: s, restarted: false };
        }
        const groups = new Map<string, { ops: ReturnType<typeof buildFor>; items: CItem[] }>();
        for (const x of s) {
            const built = buildFor(ctx, x, method, literals);
            const key = buildKey(built);
            const g = groups.get(key);
            if (g === undefined) groups.set(key, { ops: built, items: [x] });
            else g.items.push(x);
        }
        let fall = ItemSet.empty;
        let unbuilt = ItemSet.empty;
        let refused = false;
        const failing = new Map<string, ItemSet>();
        for (const [key, { ops, items }] of groups) {
            const set = ItemSet.of(items);
            if ("refused" in ops) {
                refused = true;
                unbuilt = unbuilt.union(set);
                fall = fall.union(set);
                continue;
            }
            const r = runOn(key, set, ops);
            for (const [i, xs] of r.failing) failing.set(`${key}#${i}`, xs);
            if (!r.ok) refused = true;
            if (!r.ended) fall = fall.union(normalize(r.state));
        }
        if (refused) {
            find({
                kind: "refused",
                span: stmt.span,
                ...(failing.size > 0 && { failing }),
                ...(unbuilt.size > 0 && { unbuilt }),
            });
        }
        if (fall.size === 0) find({ kind: "ended", span: stmt.span });
        return { fall, restarted: false };
    };

    const first = normalize(initialItems(ctx, craft.item));
    records.push({ span: craft.item.span, kind: "item", before: first, after: first });
    try {
        const f = seq(first, craft.body);
        return { records, findings, rounds, ...(f.fall.size > 0 && { final: f.fall }) };
    } catch (e) {
        if (!(e instanceof Stop)) throw e;
        return { records, findings, rounds };
    }
}

// --- the comparison ------------------------------------------------------------------

export interface CraftComparison {
    /** The first difference, or the empty string. */
    readonly diff: string;
    readonly exact: ExactCheckResult;
    readonly reference?: RefCraftRun;
    /** How many traced statements were compared, the most items one held,
     *  and the items over them all. */
    readonly statements: number;
    readonly largest: number;
    readonly items: number;
}

/**
 * The craft run by the exact driver and by the reference, compared: the
 * findings in order (a refused step's items by operation), every traced
 * statement's items before and after, and the final items. Both sides are
 * read at the universe's value cells.
 */
export function compareCraft(
    craft: Craft,
    registry: Registry,
    ctx: RefCtx,
    tuning: ExactTuning = {},
): CraftComparison {
    const exact = checkExact(craft, { registry }, tuning);
    const counts = { statements: 0, largest: 0, items: 0 };
    const u = exact.trace[0]?.before.u;
    if (u === undefined) {
        const said = exact.diagnostics.map((d) => d.message).join("; ");
        return { diff: `the exact driver has no first item: ${said}`, exact, ...counts };
    }
    const reference = refCheckCraft(craft, ctx, {
        ...(tuning.maxRounds !== undefined && { maxRounds: tuning.maxRounds }),
        normalize: (s) => atCells(u, s),
    });
    const done = (diff: string): CraftComparison => ({ diff, exact, reference, ...counts });
    const listed = (dd: Dd | undefined): ItemSet =>
        dd === undefined ? ItemSet.empty : listItems(u, dd, { lowest: true });
    const at = (f: { kind: string; span: SourceSpan }): string =>
        `${f.kind}@${f.span.start.offset}`;
    const ek = exact.findings.map(at).join(" ");
    const rk = reference.findings.map(at).join(" ");
    if (ek !== rk) {
        const said = exact.diagnostics.map((d) => `  said @${d.span.start.offset}: ${d.message}`);
        return done(
            [`the findings differ:`, `  exact:     ${ek}`, `  reference: ${rk}`, ...said].join(
                "\n",
            ),
        );
    }
    for (const [i, e] of exact.findings.entries()) {
        const f = reference.findings[i]!;
        const keys = new Set([...(e.failing?.keys() ?? []), ...(f.failing?.keys() ?? [])]);
        for (const k of keys) {
            const d = diffSets(f.failing?.get(k) ?? ItemSet.empty, listed(e.failing?.get(k)));
            if (d !== "")
                return done(`${at(e)}: the items refused by ${k} differ:
${d}`);
        }
        const d = diffSets(f.unbuilt ?? ItemSet.empty, listed(e.unbuilt));
        if (d !== "")
            return done(`${at(e)}: the items the builder refused differ:
${d}`);
    }
    const records = (
        xs: readonly XTraceEntry[],
        ys: readonly RefRecord[],
        where: string,
    ): string => {
        const shape = (zs: readonly { kind: string; span: SourceSpan }[]): string =>
            zs.map(at).join(" ");
        if (shape(xs) !== shape(ys)) {
            return `${where}the statements traced differ:
  exact:     ${shape(xs)}
  reference: ${shape(ys)}`;
        }
        for (const [i, e] of xs.entries()) {
            const f = ys[i]!;
            counts.statements++;
            counts.largest = Math.max(counts.largest, f.before.size);
            counts.items += f.before.size;
            const here = `${where}${at(e)}`;
            const before = diffSets(f.before, listed(e.before.dd));
            if (before !== "")
                return `${here}: the items before differ:
${before}`;
            const after = diffSets(f.after ?? ItemSet.empty, listed(e.after?.dd));
            if (after !== "")
                return `${here}: the items after differ:
${after}`;
            if ((e.inlined === undefined) !== (f.inner === undefined)) {
                return `${here}: one side traced the call's body and the other did not`;
            }
            if (e.inlined !== undefined) {
                const d = records(e.inlined.trace, f.inner!, `${here} > `);
                if (d !== "") return d;
            }
        }
        return "";
    };
    const d = records(exact.trace, reference.records, "");
    if (d !== "") return done(d);
    const final = diffSets(reference.final ?? ItemSet.empty, listed(exact.finalState?.dd));
    return done(
        final === ""
            ? ""
            : `the final items differ:
${final}`,
    );
}
