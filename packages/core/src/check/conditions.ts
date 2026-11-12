/**
 * A surface condition read exactly, item by item (docs/ARCHITECTURE.md §4.4).
 *
 * What a name, a tier or a value comparison means depends on the item it is
 * read on (check/resolve-pred.ts): a name resolves to a type that rolls on the
 * base under the item's influences, a tier number is a place in the ladders
 * those influences rank, a comparison lists the rows of those ladders. The
 * tags the item's other modifiers add take no part: language.md §2 reads
 * names and tiers on the base and its influences, a rule the wiki's tooltip
 * pages do not settle further. So the universe is split by the influence
 * slot's value alone, each case read once under its influences' tags and
 * narrowed by its reading, and the cases united.
 *
 * An atom that does not resolve for a case (a tier its ladders do not reach,
 * a name no type of its tags answers to) never holds there. The faults of the
 * condition itself are reported by `readCondition`: those of an atom that
 * resolves in no case of the state, and those of the condition's structure.
 */
import type { Pred } from "../ast/ast.js";
import type { SourceSpan } from "../ast/span.js";
import type { RPred } from "./pred.js";
import type { Diag, PredDefs } from "./defs.js";
import {
    carriedRows,
    levelReasons,
    type PredEnv,
    type Resolved,
    resolvePred,
    type ResolveView,
} from "./resolve-pred.js";
import type { ModId, TagId, TypeId } from "../model/ids.js";
import type { Mod } from "../model/mod.js";
import { shapeKey } from "./craft.js";
import type { Dd } from "./dd.js";
import { influenceTagsOfKey } from "./influence.js";
import { conditionOf, predKey, stateOf, type XItem } from "./state.js";
import type { Universe } from "./universe.js";
import { isGuaranteed, possibleTypes, rowsOf } from "./views.js";

const SILENT: Diag = () => {};

const cache = new WeakMap<Universe, Map<string, Dd | null>>();
const byNode = new WeakMap<Pred, WeakMap<PredDefs["defs"], string>>();

/**
 * The items of the universe on which the condition holds, each read under its
 * own tags; null when the condition cannot be resolved for any item (a def
 * misused, a parameter never given a value), which `readCondition` reports.
 * Cached per universe by what the condition says and, where it calls a def,
 * what the defs say: a re-check parses the craft anew, and a universe is
 * reused across checks.
 */
export function conditionOfPred(u: Universe, pred: Pred, defs: PredDefs): Dd | null {
    let byKey = cache.get(u);
    if (byKey === undefined) cache.set(u, (byKey = new Map<string, Dd | null>()));
    const key = conditionKey(pred, defs);
    if (byKey.has(key)) return byKey.get(key)!;
    const r = buildCondition(u, pred, defs);
    byKey.set(key, r);
    return r;
}

/** What a condition says, with the defs it calls: the same key for the same
 *  condition parsed again. */
export function conditionKey(pred: Pred, defs: PredDefs): string {
    let forDefs = byNode.get(pred);
    if (forDefs === undefined) byNode.set(pred, (forDefs = new WeakMap()));
    let key = forDefs.get(defs.defs);
    if (key === undefined) {
        const shape = shapeKey(pred);
        key = callsIn(pred) ? `${shape}|${defsKey(defs)}` : shape;
        forDefs.set(defs.defs, key);
    }
    return key;
}

function callsIn(p: Pred): boolean {
    switch (p.kind) {
        case "call":
            return true;
        case "not":
            return callsIn(p.inner);
        case "and":
        case "or":
            return callsIn(p.left) || callsIn(p.right);
        default:
            return false;
    }
}

/** What a call reads of the defs: each def, and which names are procs. */
function defsKey(defs: PredDefs): string {
    return shapeKey(
        [...defs.defs].map(([name, e]) => [
            name,
            e.def,
            [...e.paramTypes],
            e.valid,
            defs.procs.has(name),
        ]),
    );
}

/** The tags a case of the influence slot reads names and tiers under. */
function caseTags(u: Universe, influence: number): ReadonlySet<TagId> {
    return influenceTagsOfKey(u.registry, u.base, u.influenceKeys[influence]!);
}

function buildCondition(u: Universe, pred: Pred, defs: PredDefs): Dd | null {
    const m = u.dd;
    const env: PredEnv = { ...defs, registry: u.registry, diag: SILENT, atomsNever: true };
    const byMeaning = new Map<string, { pred: RPred; cases: number[] }>();
    for (let i = 0; i < u.influenceKeys.length; i++) {
        const r = resolvePred(
            pred,
            {
                base: u.base,
                ilvl: u.ilvl,
                tags: caseTags(u, i),
                // Every row an item of the check can be at: a reading lists no
                // fewer rows than an item holds, which is all a comparison reads.
                mayCarry: (row) => u.rows.has(row),
            },
            env,
        );
        if (r === null) return null;
        const key = predKey(r.pred);
        const held = byMeaning.get(key);
        if (held === undefined) byMeaning.set(key, { pred: r.pred, cases: [i] });
        else held.cases.push(i);
    }
    let out = m.EMPTY;
    for (const { pred: p, cases } of byMeaning.values()) {
        out = m.or(out, m.and(m.slotIn(u.scalar("influences"), cases), conditionOf(u, p)));
    }
    return out;
}

/**
 * The items of the state on which the condition holds (or fails, when not
 * `positive`), each read under its own tags; null when there are none. A
 * condition that cannot be resolved narrows nothing.
 */
export function narrowBy(
    state: XItem,
    pred: Pred,
    positive: boolean,
    defs: PredDefs,
): XItem | null {
    const c = conditionOfPred(state.u, pred, defs);
    if (c === null) return state;
    const m = state.u.dd;
    return stateOf(state.u, positive ? m.and(state.dd, c) : m.diff(state.dd, c));
}

/**
 * The condition read for the driver's messages, once per influence set the
 * state's items have, each under its own influences, its rows those the items
 * of that set may be at. A fault is reported where it holds in every case: an
 * atom that resolves for no influence set of the state (the first set's
 * wording), or a fault of the condition's structure (a def misused). The result is then null, and the
 * driver narrows by nothing. Otherwise an atom that fails for some sets only
 * never holds there (`conditionOfPred`), and the result is the first set's
 * reading with the tiers each set waits for above the item's level.
 */
export function readCondition(
    state: XItem,
    pred: Pred,
    defs: PredDefs,
    diag: Diag,
): Resolved | null {
    const { u } = state;
    const m = u.dd;
    const slot = u.scalar("influences");
    const spanKey = (s: SourceSpan): string => `${s.start.offset}:${s.end.offset}`;
    interface Said {
        readonly key: string;
        readonly message: string;
        readonly span: SourceSpan;
    }
    let failing: Set<string> | undefined;
    let first: Said[] | undefined;
    const readings: Resolved[] = [];
    for (const i of m.valuesOf(state.dd, slot)) {
        const part: XItem = { u, dd: m.and(state.dd, m.slotIn(slot, [i])) };
        const view = caseView(part, i);
        const said: Said[] = [];
        resolvePred(pred, view, {
            ...defs,
            registry: u.registry,
            diag: (message, span) => said.push({ key: spanKey(span), message, span }),
        });
        first ??= said;
        const keys = new Set(said.map((x) => x.key));
        failing = failing === undefined ? keys : new Set([...failing].filter((k) => keys.has(k)));
        const r = resolvePred(pred, view, {
            ...defs,
            registry: u.registry,
            diag: SILENT,
            atomsNever: true,
        });
        if (r !== null) readings.push(r);
    }
    const everywhere = failing ?? new Set<string>();
    if (everywhere.size > 0 || readings.length === 0) {
        for (const x of first ?? []) if (everywhere.has(x.key)) diag(x.message, x.span);
        return null;
    }
    return { pred: readings[0]!.pred, aboveLevel: readings.flatMap((r) => r.aboveLevel) };
}

/** One influence case of the state as a resolution reads it: its influences'
 *  tags, and the rows its items may be at (`carriedRows`). */
function caseView(part: XItem, influence: number): ResolveView {
    const { u } = part;
    const tags = caseTags(u, influence);
    let carried: ((row: Mod) => boolean) | undefined;
    return {
        base: u.base,
        ilvl: u.ilvl,
        tags,
        mayCarry: (row) => {
            if (carried === undefined) {
                const maybe = new Set<TagId>();
                for (const t of possibleTypes(part)) {
                    for (const tag of u.registry.addsTagsOfType(t)) maybe.add(tag);
                }
                carried = carriedRows(
                    u.registry,
                    u.base,
                    new Set([...u.base.tags, ...tags]),
                    maybe,
                    (type) => heldRows(part, type),
                );
            }
            return carried(row);
        },
    };
}

function heldRows(state: XItem, type: TypeId): ReadonlySet<ModId> | undefined {
    const rows = rowsOf(state, type);
    return rows.length === 0 ? undefined : new Set(rows.map((r) => r.id));
}

/** Why a condition read so can never hold here, where the item's level is the
 *  reason (check/resolve-pred.ts `levelReasons`): the tiers `readCondition`
 *  found an influence case of the state waiting for, less those of a type
 *  every item of the state holds. */
export function levelReasonsOn(state: XItem, resolved: Resolved | null): string {
    return levelReasons(resolved, (t) => isGuaranteed(state, t));
}
