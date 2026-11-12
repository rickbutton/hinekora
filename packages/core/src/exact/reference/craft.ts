/**
 * The reference driver: which concrete items can be at each point of a craft,
 * as plain reachability over configurations, a point of the craft and one
 * item, with no recovery anywhere. Test support: what exact/check.ts is held
 * to.
 *
 * - An operation is built for the item alone (`buildFor`) and run on it alone
 *   (`refRunMethod`). An item its builder or its run refuses is recorded as
 *   refusing the step and goes no further; an item whose every path the
 *   method ends goes no further.
 * - An `if` sends an item into the arm its condition (`holdsPred`) picks; a
 *   condition with a fault on the item (it does not resolve under the item's
 *   own influences) picks both.
 * - An item at a loop's head that meets its condition leaves the loop; one
 *   that does not goes through the body, which brings it back to the head by
 *   falling off its end or by a `restart`. The head is the least set so
 *   closed; an item never leaves a loop when no path from it meets the
 *   condition.
 * - A `restart` puts the item at the innermost loop enclosing it as written
 *   after inlining; at top level, and at a `stop`, the item's path ends.
 * - A call runs its body with its arguments bound (check/defs.ts).
 *
 * The findings are properties of the reachable sets: a step is refused when
 * some item at it is refused; an arm is dead when no item enters it; a loop's
 * body never runs when no item at its head fails the condition, and the loop
 * never exits when items reach its head and none meets it; a step is
 * unreachable when the step before it is reached and no item gets past it,
 * because every path before it in its block stopped, went back to a loop's
 * head, or some of each (a path stops at a `stop`, a top-level `restart`, a
 * refused or ending step, and in a loop no item leaves).
 */
import type { Craft, Pred, Stmt } from "../../ast/ast.js";
import type { SourceSpan } from "../../ast/span.js";
import {
    bindArgs,
    collectDefs,
    collectProcs,
    type PredDefs,
    substituteStmts,
} from "../../check/defs.js";
import { findMethod, type Literal } from "../../check/methods.js";
import { resolvePred } from "../../check/resolve-pred.js";
import type { Registry } from "../../resolve/registry.js";
import { buildKey } from "../build.js";
import {
    checkExact,
    exactDetail,
    type ExactCheckResult,
    type ExactTuning,
    type FindingKind,
    type Unreached,
    type XTraceEntry,
} from "../check.js";
import type { Dd } from "../dd.js";
import { influenceTagsOfKey } from "../influence.js";
import { buildFor } from "./build.js";
import { atCells } from "./harness.js";
import { initialItems } from "./initial.js";
import { type CItem, itemKey, type RefCtx } from "./item.js";
import { listItems } from "./listing.js";
import { refRunMethod } from "./method.js";
import { holdsPred } from "./pred.js";
import { diffSets, ItemSet } from "./sets.js";

export interface RefRecord {
    readonly kind: Stmt["kind"] | "item";
    readonly before: ItemSet;
    /** Empty where no item gets past it. */
    readonly after: ItemSet;
}

export interface RefFinding {
    readonly kind: FindingKind;
    readonly span: SourceSpan;
    /** As exact/check.ts `FindingItems`. */
    readonly failing?: ReadonlyMap<string, ItemSet>;
    readonly unbuilt?: ItemSet;
    readonly unreached?: Unreached;
}

export interface RefCraftRun {
    /** By statement: the offsets of the calls it is inlined in, then its own,
     *  joined by `>`; the item block is `item`. Only statements some item
     *  reaches. */
    readonly records: ReadonlyMap<string, RefRecord>;
    readonly findings: readonly RefFinding[];
    /** The items past the last statement. */
    readonly final: ItemSet;
}

export interface RefCraftOptions {
    /** Applied to the first items and to every operation's outcomes: the exact
     *  side reads an item at its value cells (reference/harness.ts `atCells`). */
    readonly normalize?: (items: ItemSet) => ItemSet;
}

type Owner =
    { readonly kind: "top" } | { readonly kind: "arm" | "body" | "call"; readonly node: Node };

interface Block {
    readonly nodes: Node[];
    readonly owner: Owner;
}

interface Node {
    readonly key: string;
    readonly stmt: Stmt;
    readonly block: Block;
    readonly index: number;
    /** The call offsets it is inlined in, as a key prefix. */
    readonly path: string;
    readonly before: Map<string, CItem>;
    readonly after: Map<string, CItem>;
    /** A loop's head. */
    readonly head: Map<string, CItem>;
    /** An `if`'s arms and a loop's body, once built. */
    arms?: [Block, Block];
    body?: Block;
    entered: [boolean, boolean];
    faulty: boolean;
    stops: boolean;
    restarts: boolean;
    readonly failing: Map<string, Map<string, CItem>>;
    readonly unbuilt: Map<string, CItem>;
    refused: boolean;
}

export function refCheckCraft(
    craft: Craft,
    ctx: RefCtx,
    options: RefCraftOptions = {},
): RefCraftRun {
    const normalize = options.normalize ?? ((s: ItemSet) => s);
    const silent = (): void => {};
    const defs = collectDefs(craft.defs, silent);
    const procs = collectProcs(craft.procs, defs, silent);
    const predDefs: PredDefs = { defs, procs };
    const nodes: Node[] = [];
    const blocks: Block[] = [];
    const final = new Map<string, CItem>();
    const queue: (() => void)[] = [];

    const block = (stmts: readonly Stmt[], owner: Owner, path: string): Block => {
        const b: Block = { nodes: [], owner };
        stmts.forEach((stmt, index) => {
            const n: Node = {
                key: `${path}${stmt.span.start.offset}`,
                stmt,
                block: b,
                index,
                path,
                before: new Map(),
                after: new Map(),
                head: new Map(),
                entered: [false, false],
                faulty: false,
                stops: false,
                restarts: false,
                failing: new Map(),
                unbuilt: new Map(),
                refused: false,
            };
            b.nodes.push(n);
            nodes.push(n);
        });
        blocks.push(b);
        return b;
    };
    const put = (m: Map<string, CItem>, x: CItem): boolean => {
        const k = itemKey(x);
        if (m.has(k)) return false;
        m.set(k, x);
        return true;
    };
    const parentOf = (n: Node): Node | undefined => {
        const o = n.block.owner;
        return o.kind === "top" ? undefined : o.node;
    };
    const markStop = (n: Node): void => {
        for (let at: Node | undefined = n; at !== undefined; at = parentOf(at)) at.stops = true;
    };
    const markRestart = (n: Node, loop: Node): void => {
        for (let at: Node | undefined = n; at !== undefined && at !== loop; at = parentOf(at)) {
            at.restarts = true;
        }
    };
    const loopOf = (n: Node): Node | undefined => {
        for (let at: Node | undefined = n; at !== undefined; at = parentOf(at)) {
            if (at.block.owner.kind === "body") return at.block.owner.node;
        }
        return undefined;
    };

    // Conditions and runs are functions of the item, so each is worked out once.
    const truths = new Map<Pred, Map<string, boolean>>();
    const holds = (p: Pred, x: CItem): boolean => {
        let byItem = truths.get(p);
        if (byItem === undefined) truths.set(p, (byItem = new Map<string, boolean>()));
        const k = itemKey(x);
        let t = byItem.get(k);
        if (t === undefined) byItem.set(k, (t = holdsPred(p, x, ctx, predDefs)));
        return t;
    };
    const faults = (p: Pred, x: CItem): boolean => {
        const tags = influenceTagsOfKey(ctx.registry, ctx.base, x.influences);
        const view = { base: ctx.base, ilvl: ctx.ilvl, tags, mayCarry: () => true };
        return resolvePred(p, view, { ...predDefs, registry: ctx.registry, diag: silent }) === null;
    };
    const runs = new Map<string, ReturnType<typeof refRunMethod>>();

    const arrive = (n: Node, x: CItem): void => {
        queue.push(() => at(n, x));
    };
    const enter = (b: Block, x: CItem): void => {
        const first = b.nodes[0];
        if (first !== undefined) arrive(first, x);
        else exit(b, x);
    };
    const leave = (n: Node, x: CItem): void => {
        if (!put(n.after, x)) return;
        const next = n.block.nodes[n.index + 1];
        if (next !== undefined) arrive(next, x);
        else exit(n.block, x);
    };
    const exit = (b: Block, x: CItem): void => {
        const o = b.owner;
        if (o.kind === "top") put(final, x);
        else if (o.kind === "body") toHead(o.node, x);
        else leave(o.node, x);
    };
    const toHead = (loop: Node, x: CItem): void => {
        if (!put(loop.head, x)) return;
        const stmt = loop.stmt as Extract<Stmt, { kind: "until" }>;
        const body = (loop.body ??= block(stmt.body, { kind: "body", node: loop }, loop.path));
        const fault = faults(stmt.pred, x);
        if (fault) loop.faulty = true;
        const meets = !fault && holds(stmt.pred, x);
        if (fault || meets) leave(loop, x);
        if (fault || !meets) {
            loop.entered[1] = true;
            enter(body, x);
        }
    };

    const at = (n: Node, x: CItem): void => {
        if (!put(n.before, x)) return;
        const stmt = n.stmt;
        switch (stmt.kind) {
            case "operation":
                return operation(n, stmt, x);
            case "restart": {
                const loop = loopOf(n);
                if (loop === undefined) return markStop(n);
                markRestart(n, loop);
                return toHead(loop, x);
            }
            case "stop":
                return markStop(n);
            case "if": {
                const arms = (n.arms ??= [
                    block(stmt.body, { kind: "arm", node: n }, n.path),
                    block(stmt.elseBody ?? [], { kind: "arm", node: n }, n.path),
                ]);
                const fault = faults(stmt.pred, x);
                if (fault) n.faulty = true;
                const yes = fault || holds(stmt.pred, x);
                const no = fault || !yes;
                if (yes) {
                    n.entered[0] = true;
                    enter(arms[0], x);
                }
                if (no) {
                    n.entered[1] = true;
                    enter(arms[1], x);
                }
                return;
            }
            case "until":
                return toHead(n, x);
            case "call": {
                const entry = procs.get(stmt.name);
                const env =
                    entry === undefined || !entry.valid
                        ? null
                        : bindArgs(
                              stmt.name,
                              entry.proc.params,
                              entry.paramTypes,
                              stmt.args,
                              stmt.span,
                              silent,
                          );
                if (entry === undefined || env === null) return leave(n, x);
                n.body ??= block(
                    substituteStmts(entry.proc.body, env),
                    { kind: "call", node: n },
                    `${n.key}>`,
                );
                return enter(n.body, x);
            }
            case "paramStep":
                return leave(n, x);
        }
    };

    const operation = (n: Node, stmt: Extract<Stmt, { kind: "operation" }>, x: CItem): void => {
        const method = findMethod(stmt.words);
        const literals: Literal[] = [];
        for (const a of stmt.args) if (a.kind !== "param") literals.push(a);
        if (method === undefined || literals.length < stmt.args.length) return leave(n, x);
        const ops = buildFor(ctx, x, method, literals);
        if ("refused" in ops) {
            n.refused = true;
            put(n.unbuilt, x);
            return markStop(n);
        }
        const key = buildKey(ops);
        const k = `${key}|${itemKey(x)}`;
        let r = runs.get(k);
        if (r === undefined) runs.set(k, (r = refRunMethod(ItemSet.of([x]), ops, ctx)));
        for (const [i, xs] of r.failing) {
            const fk = `${key}#${i}`;
            let m = n.failing.get(fk);
            if (m === undefined) n.failing.set(fk, (m = new Map<string, CItem>()));
            for (const y of xs) put(m, y);
        }
        if (r.reachedEnd) markStop(n);
        if (!r.ok) {
            n.refused = true;
            return markStop(n);
        }
        if (r.ended) return;
        for (const y of normalize(r.state)) leave(n, y);
    };

    const top = block(craft.body, { kind: "top" }, "");
    const first = normalize(initialItems(ctx, craft.item));
    for (const x of first) enter(top, x);
    for (let job = queue.shift(); job !== undefined; job = queue.shift()) job();

    // The findings, from the reachable sets.
    const findings: RefFinding[] = [];
    const reached = (n: Node): boolean => n.before.size > 0;
    for (const n of nodes) {
        if (n.stmt.kind !== "until" || !reached(n) || n.faulty) continue;
        if (n.entered[1] && n.after.size === 0) markStop(n);
    }
    for (const n of nodes) {
        if (!reached(n)) continue;
        const stmt = n.stmt;
        if (stmt.kind === "operation") {
            if (n.refused) {
                const failing = new Map(
                    [...n.failing].map(([k, m]) => [k, ItemSet.of(m.values())] as const),
                );
                findings.push({
                    kind: "refused",
                    span: stmt.span,
                    ...(failing.size > 0 && { failing }),
                    ...(n.unbuilt.size > 0 && { unbuilt: ItemSet.of(n.unbuilt.values()) }),
                });
            } else if (n.after.size === 0) findings.push({ kind: "ended", span: stmt.span });
        } else if (stmt.kind === "if" && !n.faulty) {
            if (!n.entered[0]) findings.push({ kind: "deadIf", span: stmt.pred.span });
            if (!n.entered[1] && stmt.elseBody !== undefined) {
                findings.push({ kind: "deadElse", span: stmt.pred.span });
            }
        } else if (stmt.kind === "until" && !n.faulty) {
            if (!n.entered[1]) findings.push({ kind: "neverRuns", span: stmt.pred.span });
            else if (n.after.size === 0) {
                findings.push({ kind: "neverExits", span: stmt.pred.span });
            }
        }
    }
    for (const b of blocks) {
        let restarts = false;
        let stops = false;
        for (const [i, n] of b.nodes.entries()) {
            const next = b.nodes[i + 1];
            restarts ||= n.restarts;
            stops ||= n.stops;
            if (next === undefined || !reached(n) || reached(next)) continue;
            const unreached: Unreached = !restarts ? "stops" : stops ? "both" : "restarts";
            findings.push({ kind: "unreachable", span: next.stmt.span, unreached });
        }
    }

    const records = new Map<string, RefRecord>([
        ["item", { kind: "item", before: first, after: first }],
    ]);
    for (const n of nodes) {
        if (!reached(n)) continue;
        records.set(n.key, {
            kind: n.stmt.kind,
            before: ItemSet.of(n.before.values()),
            after: ItemSet.of(n.after.values()),
        });
    }
    return { records, findings, final: ItemSet.of(final.values()) };
}

// --- the comparison ------------------------------------------------------------------

export interface CraftComparison {
    /** The first difference, or the empty string. */
    readonly diff: string;
    /** The exact driver taking no recovery, and as the tool runs it. */
    readonly strict: ExactCheckResult;
    readonly exact: ExactCheckResult;
    readonly reference?: RefCraftRun;
    /** How many statements were compared, the most items one held, and the
     *  items over them all. */
    readonly statements: number;
    readonly largest: number;
    readonly items: number;
}

/** The exact trace by statement, keyed as `RefCraftRun.records`. */
function traced(trace: readonly XTraceEntry[], path = ""): Map<string, XTraceEntry> {
    const out = new Map<string, XTraceEntry>();
    for (const e of trace) {
        const key = e.kind === "item" ? "item" : `${path}${e.span.start.offset}`;
        out.set(key, e);
        if (e.inlined !== undefined) {
            for (const [k, v] of traced(e.inlined.trace, `${key}>`)) out.set(k, v);
        }
    }
    return out;
}

/** The statements of a craft by the offset of their condition. */
function byCondition(craft: Craft): Map<number, number> {
    const out = new Map<number, number>();
    const visit = (stmts: readonly Stmt[]): void => {
        for (const s of stmts) {
            if (s.kind === "if") {
                out.set(s.pred.span.start.offset, s.span.start.offset);
                visit(s.body);
                visit(s.elseBody ?? []);
            } else if (s.kind === "until") {
                out.set(s.pred.span.start.offset, s.span.start.offset);
                visit(s.body);
            } else if (s.kind === "call") {
                for (const a of s.args) if (a.kind === "block") visit(a.body);
            }
        }
    };
    visit(craft.body);
    for (const p of craft.procs) visit(p.body);
    return out;
}

const ABORTS: readonly FindingKind[] = ["unsettled", "limit"];
const FEWER: readonly FindingKind[] = ["deadIf", "deadElse", "neverRuns", "neverExits"];

/**
 * The craft run by the exact driver and by the reference, compared.
 *
 * - The driver taking no recovery (`strict`) is held to the reference:
 *   the same findings (a refused step's items by operation, an unreachable
 *   step's reason), every statement's items before and after, the final
 *   items. Where it stopped at a limit, the statements it finished and the
 *   findings it made before are held to the reference's.
 * - The driver as the tool runs it recovers after an error, so it is held to
 *   the strict run by inclusion: each statement the strict run reaches it
 *   reaches with at least those items before and after, it refuses every step
 *   the strict run refuses, and a branch, a loop or a step it finds dead the
 *   strict run finds dead too, or never reaches.
 *
 * Both sides are read at the universe's value cells.
 */
export function compareCraft(
    craft: Craft,
    registry: Registry,
    ctx: RefCtx,
    tuning: ExactTuning = {},
): CraftComparison {
    const strict = checkExact(craft, { registry }, { ...tuning, strict: true });
    const exact = checkExact(craft, { registry }, { ...tuning, strict: false });
    const counts = { statements: 0, largest: 0, items: 0 };
    const u = strict.trace[0]?.before.u;
    if (u === undefined) {
        const said = strict.diagnostics.map((d) => d.message).join("; ");
        return { diff: `the exact driver has no first item: ${said}`, strict, exact, ...counts };
    }
    const reference = refCheckCraft(craft, ctx, { normalize: (s) => atCells(u, s) });
    const done = (diff: string): CraftComparison => ({
        diff,
        strict,
        exact,
        reference,
        ...counts,
    });
    const listed = (dd: Dd | undefined): ItemSet =>
        dd === undefined ? ItemSet.empty : listItems(u, dd, { lowest: true });
    const detail = exactDetail(strict)!;
    const at = (f: { kind: string; span: SourceSpan }, why?: Unreached): string =>
        `${f.kind}@${f.span.start.offset}${why === undefined ? "" : `(${why})`}`;
    const sorted = (xs: string[]): string => xs.sort().join(" ");
    const aborted = strict.findings.some((f) => ABORTS.includes(f.kind));

    // The findings.
    const ek = strict.findings
        .filter((f) => !ABORTS.includes(f.kind))
        .map((f) => at(f, detail.items.get(f)?.unreached));
    const rk = reference.findings.map((f) => at(f, f.unreached));
    if (aborted) {
        const rest = [...rk];
        for (const k of ek) {
            const i = rest.indexOf(k);
            if (i < 0) return done(`a finding before the limit the reference lacks: ${k}`);
            rest.splice(i, 1);
        }
    } else if (sorted([...ek]) !== sorted([...rk])) {
        const said = strict.diagnostics.map((d) => `  said @${d.span.start.offset}: ${d.message}`);
        return done(
            [
                "the findings differ:",
                `  exact:     ${sorted([...ek])}`,
                `  reference: ${sorted([...rk])}`,
                ...said,
            ].join("\n"),
        );
    }
    // A refused step's items, by statement and operation; a step inlined at
    // two calls is one statement here, its items united.
    const refusedItems = new Map<string, Map<string, ItemSet>>();
    const add = (where: number, key: string, xs: ItemSet): void => {
        const k = String(where);
        let m = refusedItems.get(k);
        if (m === undefined) refusedItems.set(k, (m = new Map<string, ItemSet>()));
        m.set(key, (m.get(key) ?? ItemSet.empty).union(xs));
    };
    for (const f of reference.findings) {
        if (f.kind !== "refused") continue;
        for (const [k, xs] of f.failing ?? []) add(f.span.start.offset, `ref ${k}`, xs);
        if (f.unbuilt !== undefined) add(f.span.start.offset, "ref unbuilt", f.unbuilt);
    }
    for (const e of strict.findings) {
        if (e.kind !== "refused") continue;
        const items = detail.items.get(e) ?? {};
        for (const [k, dd] of items.failing ?? [])
            add(e.span.start.offset, `exact ${k}`, listed(dd));
        if (items.unbuilt !== undefined)
            add(e.span.start.offset, "exact unbuilt", listed(items.unbuilt));
    }
    const judged = new Set(
        strict.findings.filter((f) => f.kind === "refused").map((f) => String(f.span.start.offset)),
    );
    for (const [where, m] of refusedItems) {
        if (!judged.has(where)) continue;
        const keys = new Set([...m.keys()].map((k) => k.slice(k.indexOf(" ") + 1)));
        for (const k of keys) {
            const d = diffSets(
                m.get(`ref ${k}`) ?? ItemSet.empty,
                m.get(`exact ${k}`) ?? ItemSet.empty,
            );
            if (d !== "") return done(`refused@${where}: the items refused by ${k} differ:\n${d}`);
        }
    }

    // Every statement's items.
    const mine = traced(strict.trace);
    if (!aborted) {
        const missing = [...reference.records.keys()].filter((k) => !mine.has(k));
        const extra = [...mine.keys()].filter((k) => !reference.records.has(k));
        if (missing.length > 0 || extra.length > 0) {
            return done(
                `the statements reached differ: the reference only ${missing.join(" ")}; the exact only ${extra.join(" ")}`,
            );
        }
    }
    for (const [key, e] of mine) {
        const f = reference.records.get(key);
        if (f === undefined) return done(`${key}: the reference reaches no item here`);
        counts.statements++;
        counts.largest = Math.max(counts.largest, f.before.size);
        counts.items += f.before.size;
        const before = diffSets(f.before, listed(e.before.dd));
        if (before !== "") return done(`${key} (${e.kind}): the items before differ:\n${before}`);
        const after = diffSets(f.after, listed(e.after?.dd));
        if (after !== "") return done(`${key} (${e.kind}): the items after differ:\n${after}`);
    }
    if (!aborted) {
        const final = diffSets(reference.final, listed(strict.finalState?.dd));
        if (final !== "") return done(`the final items differ:\n${final}`);
    }

    // The driver as the tool runs it, against the strict run.
    if (aborted || exact.findings.some((f) => ABORTS.includes(f.kind))) return done("");
    const theirs = traced(exact.trace);
    const conditions = byCondition(craft);
    const holds = (big: Dd | undefined, small: Dd | undefined): boolean =>
        small === undefined || (big !== undefined && u.dd.implies(small, big));
    for (const [key, e] of mine) {
        const t = theirs.get(key);
        if (t === undefined) return done(`${key}: reached with no recovery, not with it`);
        if (!holds(t.before.dd, e.before.dd) || !holds(t.after?.dd, e.after?.dd)) {
            return done(`${key}: with recovery, fewer items than without`);
        }
        // The rounds that settle a loop take no recovery, so a loop entered
        // with the same items settles alike, and its exit is the same.
        if (e.kind === "until" && t.before.dd === e.before.dd) {
            if (e.after !== undefined && t.after?.dd !== e.after.dd) {
                return done(`${key}: entered alike, the loop's exit differs with recovery`);
            }
            for (const kind of ["neverRuns", "neverExits"] as const) {
                const said = (r: ExactCheckResult): boolean =>
                    r.findings.some(
                        (f) =>
                            f.kind === kind &&
                            conditions.get(f.span.start.offset) === e.span.start.offset,
                    );
                if (said(strict) && !said(exact)) {
                    return done(`${key}: entered alike, ${kind} without recovery only`);
                }
            }
        }
    }
    const count = (r: ExactCheckResult, kind: FindingKind): string[] =>
        r.findings.filter((f) => f.kind === kind).map((f) => at(f));
    const refusedWith = count(exact, "refused");
    for (const k of count(strict, "refused")) {
        const i = refusedWith.indexOf(k);
        if (i < 0) return done(`${k}: refused with no recovery, not with it`);
        refusedWith.splice(i, 1);
    }
    // A statement reached at several calls is found dead once per call; at
    // each it is reached with recovery and not without, it may be dead with
    // recovery alone.
    const tally = (xs: Iterable<string>): Map<string, number> => {
        const out = new Map<string, number>();
        for (const x of xs) out.set(x, (out.get(x) ?? 0) + 1);
        return out;
    };
    const offsetOf = (key: string): string => key.slice(key.lastIndexOf(">") + 1);
    const strictFound = tally(strict.findings.map((f) => at(f)));
    const looseFound = tally(
        exact.findings.filter((f) => FEWER.includes(f.kind)).map((f) => at(f)),
    );
    const onlyLoose = tally([...theirs.keys()].filter((k) => !mine.has(k)).map(offsetOf));
    for (const [k, n] of looseFound) {
        const pred = Number(k.slice(k.indexOf("@") + 1));
        const stmt = String(conditions.get(pred));
        if (n > (strictFound.get(k) ?? 0) + (onlyLoose.get(stmt) ?? 0)) {
            return done(`${k}: found with recovery, not without it`);
        }
    }
    return done("");
}
