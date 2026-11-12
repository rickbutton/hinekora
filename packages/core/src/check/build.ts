/**
 * A method's operations built for the exact state (check/methods.ts
 * `Method.build`). A builder reads the item the statement reaches
 * (`MethodItem`), and where what it builds depends on which item that is, the
 * state is split by the facts it reads and each part built on its own, so
 * every item gets the operations it would get alone. The builders that read
 * the item, and by what:
 *
 * - `harvest change "<from>" "<to>"`: the names resolve, and the ladders the
 *   changed modifier's rank is read on rank, under the item's influence tags;
 *   the rows it becomes are read from the row it is at. Split by the
 *   influence set, then by the row of the changed type (its absence a part
 *   of its own, where the method's check refuses).
 * - `unveil "<mod>"`: the name resolves under the influence tags. Split by
 *   the influence set.
 * - `eldritch chaos`, `eldritch exalt`, `eldritch annul`: they act on the
 *   dominant implicit's side. Split by which side is dominant, neither being
 *   a part the builder refuses.
 *
 * Every other builder reads only the base and the item level, the same for
 * every item of a check (an ember's or an ichor's pool is the base's at its
 * tier, an essence's level is the item's), and builds once.
 */
import type { Literal, Method, MethodItem, Refusal } from "./methods.js";
import { influenceTagsOfItem } from "./methods.js";
import type { Op } from "./ops/types.js";
import type { ModId, TypeId } from "../model/ids.js";
import type { Dd } from "./dd.js";
import { dominance, stateOf, type XItem } from "./state.js";
import { eldritchPairs, influenceSets, rowsOf } from "./views.js";

/** The rows each type is at over the items, read type by type as a builder
 *  asks: the Harvest change reads one type's, every other builder none. */
class TiersOf implements ReadonlyMap<TypeId, ReadonlySet<ModId>> {
    private readonly read = new Map<TypeId, ReadonlySet<ModId> | undefined>();
    private all: Map<TypeId, ReadonlySet<ModId>> | undefined;

    constructor(private readonly s: XItem) {}

    get(type: TypeId): ReadonlySet<ModId> | undefined {
        if (this.read.has(type)) return this.read.get(type);
        const rows = this.s.u.slotOfType(type) === undefined ? [] : rowsOf(this.s, type);
        const r = rows.length === 0 ? undefined : new Set(rows.map((m) => m.id));
        this.read.set(type, r);
        return r;
    }

    has(type: TypeId): boolean {
        return this.get(type) !== undefined;
    }

    private every(): Map<TypeId, ReadonlySet<ModId>> {
        if (this.all === undefined) {
            this.all = new Map();
            for (const slot of this.s.u.modSlots()) {
                const type = this.s.u.modSlot(slot)!.type;
                const rows = this.get(type);
                if (rows !== undefined) this.all.set(type, rows);
            }
        }
        return this.all;
    }

    get size(): number {
        return this.every().size;
    }

    forEach(
        f: (
            value: ReadonlySet<ModId>,
            key: TypeId,
            map: ReadonlyMap<TypeId, ReadonlySet<ModId>>,
        ) => void,
    ): void {
        for (const [k, v] of this.every()) f(v, k, this);
    }

    entries(): MapIterator<[TypeId, ReadonlySet<ModId>]> {
        return this.every().entries();
    }

    keys(): MapIterator<TypeId> {
        return this.every().keys();
    }

    values(): MapIterator<ReadonlySet<ModId>> {
        return this.every().values();
    }

    [Symbol.iterator](): MapIterator<[TypeId, ReadonlySet<ModId>]> {
        return this.entries();
    }
}

/** The read-only item a builder reads, over the items of the state. */
export function methodItemOf(s: XItem): MethodItem {
    return {
        base: s.u.base,
        ilvl: s.u.ilvl,
        influences: influenceSets(s),
        eldritch: eldritchPairs(s),
        tiers: new TiersOf(s),
    };
}

/** A part of the state with the operations its builder gives it, or why it
 *  gives none. */
export interface BuiltPart {
    readonly state: XItem;
    readonly built: readonly Op[] | Refusal;
}

/** The state's items in parts, a part's items alike in what the method's
 *  builder reads; each with what it builds. */
export function buildMethod(
    state: XItem,
    method: Method,
    literals: readonly Literal[],
): BuiltPart[] {
    const registry = state.u.registry;
    return partsFor(state, method, literals).map((part) => ({
        state: part,
        built: method.build(literals, methodItemOf(part), registry),
    }));
}

/**
 * What a build gives, as a key: two parts with equal keys get the same
 * operations. Rows by id, sets and maps in order; a function, which no
 * operation holds, would be dropped.
 */
export function buildKey(built: readonly Op[] | Refusal): string {
    if ("refused" in built) return `refused: ${built.refused}`;
    return JSON.stringify(built, (_k, v: unknown) => {
        if (v instanceof Set) return [...(v as Set<unknown>)].map(String).sort();
        if (v instanceof Map) {
            return [...(v as Map<unknown, unknown>).entries()].sort(([a], [b]) =>
                String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0,
            );
        }
        if (typeof v === "object" && v !== null && "id" in v && "type" in v && "gen" in v) {
            return (v as { id: string }).id;
        }
        return v;
    });
}

const words = (method: Method): string => method.words.join(" ");

function partsFor(state: XItem, method: Method, literals: readonly Literal[]): XItem[] {
    switch (words(method)) {
        case "harvest change":
            return byInfluence(state).flatMap((part) => {
                const from = literals[0];
                if (from?.kind !== "string") return [part];
                const r = part.u.registry.resolveModType(from.value, {
                    base: part.u.base,
                    ilvl: part.u.ilvl,
                    tags: influenceTagsOfItem(methodItemOf(part), part.u.registry),
                });
                return r.ok ? byRow(part, r.value) : [part];
            });
        case "unveil":
            return literals.length === 0 ? [state] : byInfluence(state);
        case "eldritch chaos":
        case "eldritch exalt":
        case "eldritch annul":
            return byDominant(state);
        default:
            return [state];
    }
}

function split(state: XItem, cuts: readonly Dd[]): XItem[] {
    const m = state.u.dd;
    return cuts.flatMap((c) => {
        const part = stateOf(state.u, m.and(state.dd, c));
        return part === null ? [] : [part];
    });
}

function byInfluence(state: XItem): XItem[] {
    const { u } = state;
    const slot = u.scalar("influences");
    const values = u.dd.valuesOf(state.dd, slot);
    if (values.length === 1) return [state];
    return split(
        state,
        values.map((v) => u.dd.slotIn(slot, [v])),
    );
}

/** By the row the type is at, its absence a part of its own. */
function byRow(state: XItem, type: TypeId): XItem[] {
    const { u } = state;
    const slot = u.slotOfType(type);
    if (slot === undefined) return [state];
    const byRowId = new Map<string, number[]>([["", [0]]]);
    for (const value of u.dd.valuesOf(state.dd, slot)) {
        if (value === 0) continue;
        const id = u.modValue(slot, value)!.row.id;
        byRowId.set(id, [...(byRowId.get(id) ?? []), value]);
    }
    return split(
        state,
        [...byRowId.values()].map((vs) => u.dd.slotIn(slot, vs)),
    );
}

/** By the dominant side; the items with none by their pair of tiers, which
 *  the refusal names. */
function byDominant(state: XItem): XItem[] {
    const { u } = state;
    const m = u.dd;
    const exarch = dominance(u, "exarch");
    const eater = dominance(u, "eater");
    const neither = split(state, [m.not(m.or(exarch, eater))]);
    const exarchTier = u.scalar("exarchTier");
    const eaterTier = u.scalar("eaterTier");
    const pairs = neither.flatMap((part) =>
        m.valuesOf(part.dd, exarchTier).flatMap((a) =>
            split(part, [m.slotIn(exarchTier, [a])]).flatMap((p) =>
                split(
                    p,
                    m.valuesOf(p.dd, eaterTier).map((e) => m.slotIn(eaterTier, [e])),
                ),
            ),
        ),
    );
    return [...split(state, [exarch, eater]), ...pairs];
}
