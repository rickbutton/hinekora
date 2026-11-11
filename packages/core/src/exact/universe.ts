/**
 * The universe of one check: the fixed, ordered slots every state lives over,
 * the values each slot takes, the well-formed items as one diagram, and the
 * lookups the conditions and the operations build their diagrams from.
 *
 * Slots, in order: the rarity and the marks, then one slot per modifier type
 * (prefix-only groups of types, then groups with rows of both sides, then
 * suffix-only groups; the types sharing a family adjacent), then the memory
 * strands. A craft that can imprint gets a copy of each slot for the held
 * imprint, slot i at 2i and its copy at 2i + 1, and a last slot saying
 * whether an imprint is held: copying the item into the imprint, or back, is
 * then an `equate` or a `rename` between neighbours.
 */
import type { Cmp, Craft } from "../ast/ast.js";
import { rollRange } from "../check/values.js";
import type { Base } from "../model/base.js";
import { canBeRare, maxTotal, sideCap } from "../model/capacity.js";
import type { Gen, GroupId, ModId, Rarity, TagId, TypeId } from "../model/ids.js";
import {
    AMULET_ELDRITCH_TOP_TIER,
    canHaveEldritch,
    ELDRITCH_ITEM_LEVEL,
    ELDRITCH_TIERS,
    type EldritchSide,
    type InfluenceKey,
    isEldritchAmulet,
    NO_INFLUENCE,
} from "../model/marks.js";
import type { Mod } from "../model/mod.js";
import { MAX_STRANDS } from "../model/strands.js";
import { isVeiledPlaceholder } from "../model/veiled.js";
import type { Registry } from "../resolve/registry.js";
import { type Cell, cellCompare, cellHas, cellLabel, cellSample, cellsOf } from "./cells.js";
import {
    type Comparisons,
    comparisonsOf,
    craftImprints,
    NO_COMPARISONS,
    thresholdsOf,
} from "./craft.js";
import { type Dd, DdManager, type DdRelation } from "./dd.js";
import { influenceKeysFor, influenceTagsOfKey } from "./influence.js";
import type { CEldritch, CItem, CMod } from "./item.js";
import { candidateRows, type RowSource } from "./rows.js";

// --- slots and values -------------------------------------------------------

export type ScalarKind =
    | "rarity"
    | "corrupted"
    | "influences"
    | "exarchTier"
    | "exarchType"
    | "eaterTier"
    | "eaterType"
    | "strands";

/**
 * A present modifier as a slot value: its row, the cell its value lies in
 * (none for a row whose text has no number), and its two marks.
 *
 * A slot's values are laid out row by row (best first); within a row, cell by
 * cell (lowest first); within a cell, not fractured then fractured; within
 * those, not crafted then crafted (a bench row only crafted). The lookups
 * `withFractured`, `rerolled` and `asRow` walk this layout through an index.
 */
export interface ModValue {
    readonly row: Mod;
    readonly cell: Cell | undefined;
    /** The cell's place among its row's cells. */
    readonly cellIndex: number;
    readonly fractured: boolean;
    readonly crafted: boolean;
}

/** A modifier as a fresh draw lays it down: not fractured, and crafted exactly
 *  where its row is a bench row. */
export function isFresh(v: ModValue): boolean {
    return !v.fractured && v.crafted === (v.row.source === "bench");
}

/** Where an item may carry a tag: the influence values that add it, and the
 *  modifier values whose row adds it while present. */
export interface TagSuppliers {
    readonly influences: readonly number[];
    readonly mods: ReadonlyMap<number, readonly number[]>;
}

export interface ModSlot {
    readonly kind: "mod";
    readonly type: TypeId;
    /** The sides its rows sit on. Most types have one; some have rows of both
     *  on one base (an influence's prefix beside the base's suffix, a veiled
     *  prefix beside a bench suffix), so a value's side is its row's. */
    readonly sides: ReadonlySet<Gen>;
    readonly families: ReadonlySet<GroupId>;
    /** The type's candidate rows, best first. */
    readonly rows: readonly Mod[];
    /** By slot value; value 0 is absent and holds `undefined`. */
    readonly values: readonly (ModValue | undefined)[];
    /** Does a condition compare this type's value: its rows are cut into cells. */
    readonly compared: boolean;
}

export interface ScalarSlot {
    readonly kind: ScalarKind;
    readonly size: number;
}

/** A slot of the item, independent of whether it is the item's or its copy. */
export type LogicalSlot = ModSlot | ScalarSlot;

/** What the diagram slot is: a logical slot, of the item or of the held imprint,
 *  or the slot saying whether an imprint is held. */
export type SlotRef =
    | { readonly kind: "logical"; readonly logical: number; readonly copy: boolean }
    | { readonly kind: "held" };

export type CountKind = "prefix" | "suffix" | "affix" | "crafted" | "fractured";

export const RARITIES: readonly Rarity[] = ["normal", "magic", "rare"];
const NUM_TIERS = ELDRITCH_TIERS.length + 1;
const SCALARS_BEFORE: readonly ScalarKind[] = [
    "rarity",
    "corrupted",
    "influences",
    "exarchTier",
    "exarchType",
    "eaterTier",
    "eaterType",
];

export interface UniverseOptions {
    /** The engine's node budget. */
    readonly maxNodes?: number;
    /** Give the imprint its slots whatever the craft does. */
    readonly imprint?: boolean;
}

export class UniverseError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "UniverseError";
    }
}

/** The implicit types the catalogue names for the base on a side, any tier;
 *  value 0 is "none or unnamed" (exact/item.ts `CEldritch`). */
function eldritchTypesFor(
    registry: Registry,
    base: Base,
    side: EldritchSide,
): (TypeId | undefined)[] {
    const types = new Set<TypeId>();
    for (let t = 1; t < NUM_TIERS; t++) {
        for (const e of registry.eldritchRows(base, side, t)) types.add(e.type);
    }
    return [undefined, ...[...types].sort()];
}

// --- the universe -----------------------------------------------------------

export class Universe {
    readonly dd: DdManager;
    /** The well-formed items (reference/wellformed.ts), over the item's own
     *  slots: what an operation's result is intersected with. The copy slots
     *  are left free; the copy is well-formed by construction, written only by
     *  an `equate` from a well-formed item or reset to its default. */
    readonly wf: Dd;
    readonly logical: readonly LogicalSlot[];
    readonly imprint: boolean;
    /** The diagram slot of "an imprint is held", when the universe has one. */
    readonly held: number | undefined;
    readonly influenceKeys: readonly InfluenceKey[];
    private readonly eldritchTypeList: Readonly<
        Record<EldritchSide, readonly (TypeId | undefined)[]>
    >;
    private readonly scalarAt = new Map<ScalarKind, number>();
    private readonly typeAt = new Map<TypeId, number>();
    private readonly valueByRow = new Map<ModId, { logical: number; values: number[] }>();
    /** The values of a row with given marks, by cell index. */
    private readonly byMarks = new Map<string, { logical: number; values: number[] }>();
    private readonly counts = new Map<string, Dd>();
    private withImprint: Dd | undefined;

    constructor(
        readonly registry: Registry,
        readonly base: Base,
        readonly ilvl: number,
        /** The candidate rows and the source that admitted each. */
        readonly rows: ReadonlyMap<Mod, RowSource>,
        readonly comparisons: Comparisons,
        imprint: boolean,
        options: UniverseOptions = {},
    ) {
        this.imprint = imprint;
        this.influenceKeys = influenceKeysFor(base);
        this.eldritchTypeList = {
            exarch: eldritchTypesFor(registry, base, "exarch"),
            eater: eldritchTypesFor(registry, base, "eater"),
        };
        const sizes: Record<ScalarKind, number> = {
            rarity: RARITIES.length,
            corrupted: 2,
            influences: this.influenceKeys.length,
            exarchTier: NUM_TIERS,
            exarchType: this.eldritchTypeList.exarch.length,
            eaterTier: NUM_TIERS,
            eaterType: this.eldritchTypeList.eater.length,
            strands: MAX_STRANDS + 1,
        };
        const logical: LogicalSlot[] = SCALARS_BEFORE.map((kind) => ({ kind, size: sizes[kind] }));
        for (const slot of modSlots(rows, comparisons)) logical.push(slot);
        logical.push({ kind: "strands", size: sizes.strands });
        this.logical = logical;
        logical.forEach((s, i) => {
            if (s.kind === "mod") {
                this.typeAt.set(s.type, i);
                s.values.forEach((v, value) => {
                    if (v === undefined) return;
                    let entry = this.valueByRow.get(v.row.id);
                    if (!entry) this.valueByRow.set(v.row.id, (entry = { logical: i, values: [] }));
                    entry.values.push(value);
                    const key = marksKey(v.row.id, v.fractured, v.crafted);
                    let marked = this.byMarks.get(key);
                    if (!marked) this.byMarks.set(key, (marked = { logical: i, values: [] }));
                    marked.values[v.cellIndex] = value;
                });
            } else this.scalarAt.set(s.kind, i);
        });

        const domains: number[] = [];
        for (const s of logical) {
            const size = s.kind === "mod" ? s.values.length : s.size;
            domains.push(size);
            if (imprint) domains.push(size);
        }
        if (imprint) domains.push(2);
        this.held = imprint ? domains.length - 1 : undefined;
        this.dd = new DdManager(
            domains,
            options.maxNodes === undefined ? {} : { maxNodes: options.maxNodes },
        );
        this.wf = this.dd.automaton(this.wfAutomaton(false));
    }

    /** The well-formed items with what they hold: with an imprint held, a
     *  well-formed imprint (which holds none, having no slots for one); with
     *  none held, the copy at its default, every copy slot 0, so each item is
     *  one assignment. `wf` itself when the universe holds no imprint. Built
     *  on first use. */
    get wfWithImprint(): Dd {
        if (!this.imprint) return this.wf;
        if (this.withImprint !== undefined) return this.withImprint;
        const copy = this.dd.automaton(this.wfAutomaton(true));
        const atDefault = this.dd.automaton<number>({
            init: 0,
            slots: this.itemSlots(true),
            step: (_slot, value) => (value === 0 ? 0 : undefined),
            accept: () => true,
            key: () => 0,
        });
        const held = this.held!;
        const imprint = this.dd.or(
            this.dd.and(this.dd.slotIn(held, [1]), copy),
            this.dd.and(this.dd.slotIn(held, [0]), atDefault),
        );
        this.withImprint = this.dd.and(this.wf, imprint);
        return this.withImprint;
    }

    // --- slots --------------------------------------------------------------

    /** The diagram slot of a logical slot, of the item or of its copy. */
    slot(logical: number, copy = false): number {
        if (copy && !this.imprint) throw new UniverseError("this universe holds no imprint");
        return this.imprint ? 2 * logical + (copy ? 1 : 0) : logical;
    }

    /** What a diagram slot is. */
    ref(slot: number): SlotRef {
        if (slot === this.held) return { kind: "held" };
        return this.imprint
            ? { kind: "logical", logical: slot >> 1, copy: (slot & 1) === 1 }
            : { kind: "logical", logical: slot, copy: false };
    }

    /** The logical slot behind a diagram slot; undefined for the held slot. */
    logicalOf(slot: number): LogicalSlot | undefined {
        const r = this.ref(slot);
        return r.kind === "held" ? undefined : this.logical[r.logical];
    }

    /** The slot of a scalar: rarity, a mark, an eldritch implicit, the strands. */
    scalar(kind: ScalarKind, copy = false): number {
        return this.slot(this.scalarAt.get(kind)!, copy);
    }

    /** The slot of a modifier type, undefined for a type no candidate row has. */
    slotOfType(type: TypeId, copy = false): number | undefined {
        const i = this.typeAt.get(type);
        return i === undefined ? undefined : this.slot(i, copy);
    }

    /** The modifier slot behind a diagram slot, if it is one. */
    modSlot(slot: number): ModSlot | undefined {
        const s = this.logicalOf(slot);
        return s?.kind === "mod" ? s : undefined;
    }

    /** Every modifier slot of the item (or of its copy), in order. */
    modSlots(copy = false): number[] {
        const out: number[] = [];
        this.logical.forEach((s, i) => {
            if (s.kind === "mod") out.push(this.slot(i, copy));
        });
        return out;
    }

    /** The slots of the item (or of its copy), every one, in order. */
    itemSlots(copy = false): number[] {
        return this.logical.map((_, i) => this.slot(i, copy));
    }

    // --- values -------------------------------------------------------------

    /** A modifier slot's value, undefined for absent. */
    modValue(slot: number, value: number): ModValue | undefined {
        const s = this.modSlot(slot);
        if (s === undefined) throw new UniverseError(`slot ${slot} is not a modifier slot`);
        return s.values[value];
    }

    /** The present values of a modifier slot that satisfy `keep`. */
    valuesWhere(slot: number, keep: (v: ModValue) => boolean = () => true): number[] {
        const s = this.modSlot(slot);
        if (s === undefined) throw new UniverseError(`slot ${slot} is not a modifier slot`);
        const out: number[] = [];
        s.values.forEach((v, i) => {
            if (v !== undefined && keep(v)) out.push(i);
        });
        return out;
    }

    /** The values a fresh draw lays down in the slot (`isFresh`). */
    freshValues(slot: number): number[] {
        return this.valuesWhere(slot, isFresh);
    }

    /** The values of these rows that satisfy `keep`, by the slot they sit in.
     *  A row that is not a candidate has none. */
    rowValues(
        rows: Iterable<ModId>,
        copy = false,
        keep: (v: ModValue) => boolean = () => true,
    ): Map<number, number[]> {
        const out = new Map<number, number[]>();
        for (const id of rows) {
            const entry = this.valueByRow.get(id);
            if (entry === undefined) continue;
            const slot = this.slot(entry.logical, copy);
            const s = this.logical[entry.logical] as ModSlot;
            const values = entry.values.filter((v) => keep(s.values[v]!));
            if (values.length > 0) out.set(slot, [...(out.get(slot) ?? []), ...values]);
        }
        return out;
    }

    /** The items holding one of these rows (with a value `keep` admits). */
    rowsDiagram(
        rows: Iterable<ModId>,
        copy = false,
        keep: (v: ModValue) => boolean = () => true,
    ): Dd {
        let r = this.dd.EMPTY;
        for (const [slot, values] of this.rowValues(rows, copy, keep)) {
            r = this.dd.or(r, this.dd.slotIn(slot, values));
        }
        return r;
    }

    /**
     * The values of the slot whose value compares so with `threshold`, of the
     * given rows only when `rows` is given. A row with no number gives none.
     * Throws when a cell straddles the threshold: the threshold is not one the
     * craft's conditions were read for.
     */
    valuesComparing(slot: number, op: Cmp, threshold: number, rows?: Iterable<ModId>): number[] {
        const only = rows === undefined ? undefined : new Set(rows);
        return this.valuesWhere(slot, (v) => {
            if (v.cell === undefined || (only !== undefined && !only.has(v.row.id))) return false;
            const r = cellCompare(v.cell, op, threshold);
            if (r === undefined) {
                throw new UniverseError(
                    `${v.row.id} ${cellLabel(v.cell)} is not cut at ${threshold}: the comparison was not read from the craft`,
                );
            }
            return r;
        });
    }

    /** The value of the same row and cell with the other fractured mark;
     *  undefined for absent. */
    withFractured(slot: number, value: number, fractured: boolean): number | undefined {
        const v = this.modValue(slot, value);
        if (v === undefined) return undefined;
        return this.byMarks.get(marksKey(v.row.id, fractured, v.crafted))?.values[v.cellIndex];
    }

    /** The values a reroll of the value can leave: its row, any cell, its marks. */
    rerolled(slot: number, value: number): number[] {
        const v = this.modValue(slot, value);
        if (v === undefined) return [];
        return [...this.byMarks.get(marksKey(v.row.id, v.fractured, v.crafted))!.values];
    }

    /**
     * The values of another row with the marks of this one, every cell: what a
     * tier shift, an elevation or a Harvest change that keeps the marks makes
     * of it. Undefined where the row is no candidate or cannot carry the marks
     * (a bench row is always crafted).
     */
    asRow(
        slot: number,
        value: number,
        row: ModId,
        marks: { readonly fractured?: boolean; readonly crafted?: boolean } = {},
    ): { readonly slot: number; readonly values: readonly number[] } | undefined {
        const v = this.modValue(slot, value);
        if (v === undefined) return undefined;
        const entry = this.byMarks.get(
            marksKey(row, marks.fractured ?? v.fractured, marks.crafted ?? v.crafted),
        );
        if (entry === undefined) return undefined;
        const r = this.ref(slot);
        const copy = r.kind === "logical" && r.copy;
        return { slot: this.slot(entry.logical, copy), values: [...entry.values] };
    }

    /** The tags a row's spawn and generation tables read that the base does
     *  not carry: those an influence or a present modifier may add. */
    extraTags(row: Mod): ReadonlySet<TagId> {
        const out = new Set<TagId>();
        for (const e of [...row.spawn, ...row.generation]) {
            if (!this.base.tags.has(e.tag)) out.add(e.tag);
        }
        return out;
    }

    /** What supplies a tag on the item: the influence slot's values whose
     *  influences add it, and the modifier values whose row adds it. */
    tagSuppliers(tag: TagId, copy = false): TagSuppliers {
        const influences: number[] = [];
        this.influenceKeys.forEach((key, i) => {
            if (influenceTagsOfKey(this.registry, this.base, key).has(tag)) influences.push(i);
        });
        const mods = new Map<number, number[]>();
        for (const slot of this.modSlots(copy)) {
            const values = this.valuesWhere(slot, (v) => v.row.addsTags.has(tag));
            if (values.length > 0) mods.set(slot, values);
        }
        return { influences, mods };
    }

    /** The items that carry the tag: all of them for one of the base's own. */
    carrying(tag: TagId, copy = false): Dd {
        if (this.base.tags.has(tag)) return this.dd.ALL;
        const { influences, mods } = this.tagSuppliers(tag, copy);
        let r = this.dd.slotIn(this.scalar("influences", copy), influences);
        for (const [slot, values] of mods) r = this.dd.or(r, this.dd.slotIn(slot, values));
        return r;
    }

    rarityValue(r: Rarity): number {
        return RARITIES.indexOf(r);
    }

    influenceValue(key: InfluenceKey): number | undefined {
        const i = this.influenceKeys.indexOf(key);
        return i < 0 ? undefined : i;
    }

    /** The implicit types of a side by slot value; value 0 is none or unnamed. */
    eldritchTypes(side: EldritchSide): readonly (TypeId | undefined)[] {
        return this.eldritchTypeList[side];
    }

    /** A value in words, for a test failure or a message under construction. */
    describe(slot: number, value: number): string {
        const r = this.ref(slot);
        if (r.kind === "held") return value === 1 ? "imprint held" : "no imprint";
        const s = this.logical[r.logical]!;
        const prefix = r.copy ? "imprint " : "";
        switch (s.kind) {
            case "mod": {
                const v = s.values[value];
                if (v === undefined) return `${prefix}${s.type} absent`;
                const marks = `${v.fractured ? " fractured" : ""}${v.crafted ? " crafted" : ""}`;
                const cell = v.cell === undefined ? "" : ` ${cellLabel(v.cell)}`;
                return `${prefix}${v.row.id}${cell}${marks}`;
            }
            case "rarity":
                return `${prefix}${RARITIES[value]}`;
            case "influences":
                return `${prefix}influences ${this.influenceKeys[value] || "none"}`;
            case "exarchType":
                return `${prefix}exarch ${this.eldritchTypeList.exarch[value] ?? "unnamed"}`;
            case "eaterType":
                return `${prefix}eater ${this.eldritchTypeList.eater[value] ?? "unnamed"}`;
            default:
                return `${prefix}${s.kind} ${value}`;
        }
    }

    // --- relations, weights and counts -----------------------------------------

    /** A relation on the modifier slots of the item (or its copy), undefined on every other slot. */
    modRelation(
        f: (slot: ModSlot, from: number, at: number) => readonly number[] | undefined,
        copy = false,
    ): DdRelation {
        return (at, from) => {
            const r = this.ref(at);
            if (r.kind === "held" || r.copy !== copy) return undefined;
            const s = this.logical[r.logical]!;
            return s.kind === "mod" ? f(s, from, at) : undefined;
        };
    }

    /** What a value adds to a count: 1 or 0 on the item's (or its copy's)
     *  modifier slots, 0 everywhere else; for `extent` and automata. */
    weight(kind: CountKind, copy = false): (slot: number, value: number) => number {
        return (slot, value) => {
            if (value === 0) return 0;
            const r = this.ref(slot);
            if (r.kind === "held" || r.copy !== copy) return 0;
            const s = this.logical[r.logical]!;
            if (s.kind !== "mod") return 0;
            return counts(kind, s.values[value]!) ? 1 : 0;
        };
    }

    /** The items whose count of `kind` lies in [min, max]. Cached. */
    countIn(kind: CountKind, min: number, max: number, copy = false): Dd {
        const key = `count:${kind}:${min}:${max}:${copy}`;
        const hit = this.counts.get(key);
        if (hit !== undefined) return hit;
        const w = this.weight(kind, copy);
        const r = this.dd.automaton<number>({
            init: 0,
            slots: this.modSlots(copy),
            step: (slot, value, c) => {
                const n = c + w(slot, value);
                return n > max ? undefined : n;
            },
            accept: (c) => c >= min,
            key: (c) => c,
        });
        this.counts.set(key, r);
        return r;
    }

    /** The items with an open affix slot: on that side, or on either
     *  (item-model.md §7 `prefix_slot_open`, `suffix_slot_open`). Cached. */
    openSlot(gen?: Gen, copy = false): Dd {
        const key = `open:${gen ?? "any"}:${copy}`;
        const hit = this.counts.get(key);
        if (hit !== undefined) return hit;
        const rarity = this.scalar("rarity", copy);
        const slots = [rarity, ...this.modSlots(copy)];
        type Room = readonly [number, number, number];
        const r = this.dd.automaton<Room>({
            init: [0, 0, 0],
            slots,
            step: (slot, value, room) => {
                if (slot === rarity) return this.capsOf(RARITIES[value]!);
                if (value === 0) return room;
                const g = this.modSlot(slot)!.values[value]!.row.gen;
                const [p, s, t] = room;
                const less = (n: number): number => Math.max(-1, n - 1);
                return g === "prefix" ? [less(p), s, less(t)] : [p, less(s), less(t)];
            },
            accept: ([p, s, t]) =>
                t > 0 && (gen === undefined || (gen === "prefix" ? p > 0 : s > 0)),
            key: ([p, s, t]) => `${p},${s},${t}`,
        });
        this.counts.set(key, r);
        return r;
    }

    /** The items some modifier of which satisfies `test`. */
    anyMod(test: (v: ModValue, slot: ModSlot) => boolean, copy = false): Dd {
        let r = this.dd.EMPTY;
        for (const slot of this.modSlots(copy)) {
            const s = this.modSlot(slot)!;
            const values = this.valuesWhere(slot, (v) => test(v, s));
            if (values.length > 0) r = this.dd.or(r, this.dd.slotIn(slot, values));
        }
        return r;
    }

    private capsOf(rarity: Rarity): readonly [number, number, number] {
        return [
            sideCap("prefix", rarity, this.base),
            sideCap("suffix", rarity, this.base),
            maxTotal(rarity, this.base),
        ];
    }

    // --- encoding -----------------------------------------------------------

    /** The item's assignment. Throws for an item the universe cannot hold. */
    encode(item: CItem): number[] {
        const out = new Array<number>(this.dd.numSlots).fill(0);
        this.encodeInto(item, out, false);
        if (item.imprint !== undefined) {
            if (!this.imprint) throw new UniverseError("this universe holds no imprint");
            if (item.imprint.imprint !== undefined) {
                throw new UniverseError("an imprint cannot hold an imprint");
            }
            this.encodeInto(item.imprint, out, true);
            out[this.held!] = 1;
        }
        return out;
    }

    private encodeInto(item: CItem, out: number[], copy: boolean): void {
        const put = (kind: ScalarKind, value: number | undefined, what: string): void => {
            const s = this.logical[this.scalarAt.get(kind)!] as ScalarSlot;
            if (value === undefined || !Number.isInteger(value) || value < 0 || value >= s.size) {
                throw new UniverseError(`${what} is outside this universe`);
            }
            out[this.slot(this.scalarAt.get(kind)!, copy)] = value;
        };
        put("rarity", this.rarityValue(item.rarity), `rarity ${item.rarity}`);
        put("corrupted", item.corrupted ? 1 : 0, "corruption");
        put("influences", this.influenceValue(item.influences), `influences "${item.influences}"`);
        for (const side of ["exarch", "eater"] as const) {
            const e: CEldritch = item[side];
            put(`${side}Tier`, e.tier, `${side} tier ${e.tier}`);
            const t = this.eldritchTypeList[side].indexOf(e.type);
            put(`${side}Type`, t < 0 ? undefined : t, `${side} implicit ${e.type}`);
        }
        put("strands", item.strands, `${item.strands} memory strands`);
        const seen = new Set<number>();
        for (const m of item.mods) {
            const entry = this.valueByRow.get(m.row);
            if (entry === undefined) throw new UniverseError(`row ${m.row} is not a candidate row`);
            if (seen.has(entry.logical)) {
                throw new UniverseError(
                    `two modifiers of type ${(this.logical[entry.logical] as ModSlot).type}`,
                );
            }
            seen.add(entry.logical);
            const s = this.logical[entry.logical] as ModSlot;
            const value = entry.values.find((v) => {
                const d = s.values[v]!;
                return (
                    d.fractured === m.fractured &&
                    d.crafted === m.crafted &&
                    (d.cell === undefined
                        ? m.value === undefined
                        : m.value !== undefined && cellHas(d.cell, m.value))
                );
            });
            if (value === undefined) {
                throw new UniverseError(
                    `${m.row} with value ${m.value ?? "none"}${m.fractured ? ", fractured" : ""}${m.crafted ? ", crafted" : ""} is not a value of its slot`,
                );
            }
            out[this.slot(entry.logical, copy)] = value;
        }
    }

    /**
     * One item of an assignment, for naming an item that breaks a step. Each
     * present modifier's value is `pick(value, slot)`, by default one value of
     * its cell; the held imprint is read when one is held.
     */
    decodeOne(
        assignment: readonly number[],
        pick: (v: ModValue, slot: number) => number = (v) => cellSample(v.cell!),
    ): CItem {
        const item = this.readItem(assignment, false, pick);
        if (!this.imprint || assignment[this.held!] !== 1) return item;
        return { ...item, imprint: this.readItem(assignment, true, pick) };
    }

    private readItem(
        a: readonly number[],
        copy: boolean,
        pick: (v: ModValue, slot: number) => number,
    ): CItem {
        const at = (kind: ScalarKind): number => a[this.scalar(kind, copy)] ?? 0;
        const mods: CMod[] = [];
        for (const slot of this.modSlots(copy)) {
            const v = this.modSlot(slot)!.values[a[slot] ?? 0];
            if (v === undefined) continue;
            const value = v.cell === undefined ? undefined : pick(v, slot);
            mods.push({ row: v.row.id, value, fractured: v.fractured, crafted: v.crafted });
        }
        const eldritch = (side: EldritchSide): CEldritch => ({
            tier: at(`${side}Tier`),
            type: this.eldritchTypeList[side][at(`${side}Type`)],
        });
        return {
            rarity: RARITIES[at("rarity")]!,
            mods,
            influences: this.influenceKeys[at("influences")]!,
            corrupted: at("corrupted") === 1,
            exarch: eldritch("exarch"),
            eater: eldritch("eater"),
            strands: at("strands"),
            imprint: undefined,
        };
    }

    // --- well-formedness ---------------------------------------------------------

    /**
     * The rules of reference/wellformed.ts over the slots, read in order. A type
     * has one slot, so "Distinct mod types" holds by construction; a value
     * exists only for a candidate row (a natural row of the base's domain, so
     * "Natural affix domain matches base" holds), within its span, and crafted
     * where it is a bench row; the influence slot holds only canonical sets the
     * base can have; the strands slot only 0 to 100.
     */
    private wfAutomaton(copy: boolean) {
        const { base, ilvl, registry } = this;
        const logical = this.logical;
        // The families a later slot may still claim: past its last slot a
        // family needs no remembering.
        const liveAfter = new Array<ReadonlySet<GroupId>>(logical.length);
        const veiledAfter = new Array<boolean>(logical.length);
        let live = new Set<GroupId>();
        let veiledLater = false;
        for (let i = logical.length - 1; i >= 0; i--) {
            liveAfter[i] = live;
            veiledAfter[i] = veiledLater;
            const s = logical[i]!;
            if (s.kind === "mod") {
                live = new Set([...live, ...s.families]);
                veiledLater ||= isVeiledPlaceholder(s.type);
            }
        }
        const named = (side: EldritchSide, tier: number): ReadonlySet<TypeId> =>
            new Set(registry.eldritchRows(base, side, tier).map((e) => e.type));
        const types = this.eldritchTypeList;
        const toLogical = (slot: number): number => (this.imprint ? slot >> 1 : slot);

        interface S {
            readonly room: readonly [number, number, number];
            readonly influenced: boolean;
            /** The tier of the side being read, until its type is. */
            readonly tier: number;
            readonly exarch: boolean;
            readonly veiled: boolean;
            readonly claimed: readonly GroupId[];
        }
        const init: S = {
            room: [0, 0, 0],
            influenced: false,
            tier: 0,
            exarch: false,
            veiled: false,
            claimed: [],
        };
        const tierOk = (side: EldritchSide, tier: number, s: S): boolean => {
            if (tier === 0) return true;
            // item-model.md §8 "Eldritch implicits" (Eldritch implicit modifier).
            if (!canHaveEldritch(base) || ilvl < ELDRITCH_ITEM_LEVEL || s.influenced) return false;
            // An amulet's implicit is Lesser to Exceptional (Ukatoa's Ducat § Mechanics).
            if (isEldritchAmulet(base) && tier > AMULET_ELDRITCH_TOP_TIER) return false;
            // An amulet has one implicit of either pool (Ukatoa's Ducat § Mechanics).
            if (isEldritchAmulet(base) && side === "eater" && s.exarch) return false;
            return true;
        };
        // Which implicit it is: a row the catalogue has at that tier on the base
        // (resolve/registry.ts `eldritchRows`); none to name when it has none.
        const typeOk = (side: EldritchSide, tier: number, value: number): boolean => {
            const type = types[side][value];
            if (tier === 0) return type === undefined;
            const n = named(side, tier);
            return type === undefined ? n.size === 0 : n.has(type);
        };
        return {
            init,
            slots: this.itemSlots(copy),
            step: (slot: number, value: number, s: S): S | undefined => {
                const i = toLogical(slot);
                const at = logical[i]!;
                switch (at.kind) {
                    case "rarity": {
                        const rarity = RARITIES[value]!;
                        // item-model.md §8 "Rarity within class ceiling" (Rarity § Rare).
                        if (rarity === "rare" && !canBeRare(base)) return undefined;
                        return { ...s, room: this.capsOf(rarity) };
                    }
                    case "influences":
                        return { ...s, influenced: this.influenceKeys[value] !== NO_INFLUENCE };
                    case "exarchTier":
                    case "eaterTier": {
                        const side = at.kind === "exarchTier" ? "exarch" : "eater";
                        return tierOk(side, value, s) ? { ...s, tier: value } : undefined;
                    }
                    case "exarchType":
                    case "eaterType": {
                        const side = at.kind === "exarchType" ? "exarch" : "eater";
                        if (!typeOk(side, s.tier, value)) return undefined;
                        return side === "exarch"
                            ? { ...s, tier: 0, exarch: s.tier > 0 }
                            : { ...s, tier: 0, exarch: false };
                    }
                    case "mod": {
                        const keep = liveAfter[i]!;
                        const v = at.values[value];
                        if (v === undefined) {
                            const claimed = s.claimed.filter((f) => keep.has(f));
                            return {
                                ...s,
                                claimed,
                                veiled: s.veiled && veiledAfter[i]!,
                            };
                        }
                        // item-model.md §7 "Affix capacity" and §8 "within capacity".
                        const [p, q, t] = s.room;
                        const room: [number, number, number] =
                            v.row.gen === "prefix" ? [p - 1, q, t - 1] : [p, q - 1, t - 1];
                        if (room.some((r) => r < 0)) return undefined;
                        // item-model.md §8 "Influence excludes fracture" (Fractured item § Mechanics).
                        if (v.fractured && s.influenced) return undefined;
                        // item-model.md §8 "At most one veiled placeholder", Hinekora's restriction.
                        const veiledHere = isVeiledPlaceholder(at.type);
                        if (veiledHere && s.veiled) return undefined;
                        // item-model.md §8 "Disjoint families" (Modifier § Group/family).
                        if (s.claimed.some((f) => at.families.has(f))) return undefined;
                        const claimed = [...s.claimed, ...at.families]
                            .filter((f) => keep.has(f))
                            .sort();
                        return {
                            ...s,
                            room,
                            claimed,
                            veiled: (s.veiled || veiledHere) && veiledAfter[i]!,
                        };
                    }
                    default:
                        return s;
                }
            },
            accept: () => true,
            key: (s: S) =>
                `${s.room.join(",")}|${s.influenced ? 1 : 0}${s.exarch ? 1 : 0}${s.veiled ? 1 : 0}|${s.tier}|${s.claimed.join(",")}`,
        };
    }
}

const marksKey = (row: ModId, fractured: boolean, crafted: boolean): string =>
    `${row}|${fractured ? "F" : ""}${crafted ? "C" : ""}`;

function counts(kind: CountKind, v: ModValue): boolean {
    switch (kind) {
        case "prefix":
            return v.row.gen === "prefix";
        case "suffix":
            return v.row.gen === "suffix";
        case "affix":
            return true;
        case "crafted":
            return v.crafted;
        case "fractured":
            return v.fractured;
    }
}

const byTier = (a: Mod, b: Mod): number =>
    b.minLevel - a.minLevel || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * One slot per modifier type, ordered so the well-formedness automaton
 * remembers little: the types are grouped by the families they share (the
 * connected groups of "shares a family with"), prefix-only groups first, then
 * groups with rows of both sides, then suffix-only ones; within a group the
 * types are sorted by their families, so those of one family sit together and
 * a family is forgotten soon after its last slot.
 */
function modSlots(rows: ReadonlyMap<Mod, RowSource>, comparisons: Comparisons): ModSlot[] {
    const byType = new Map<TypeId, Mod[]>();
    for (const m of rows.keys()) {
        const list = byType.get(m.type);
        if (list) list.push(m);
        else byType.set(m.type, [m]);
    }
    const slots: ModSlot[] = [];
    for (const [type, list] of byType) {
        list.sort(byTier);
        const first = list[0]!;
        const famKey = (m: Mod): string => [...m.families].sort().join("|");
        for (const m of list) {
            // A type's rows share their families (item-model.md §9 "A ladder
            // shares its families"), which one slot per type rests on: no two
            // rows of a type share an item, and the families are the slot's.
            if (famKey(m) !== famKey(first)) {
                throw new UniverseError(
                    `internal: rows ${first.id} and ${m.id} of type ${type} differ in families`,
                );
            }
        }
        const thresholds = thresholdsOf(comparisons, type);
        const values: (ModValue | undefined)[] = [undefined];
        for (const row of list) {
            const span = row.text === undefined ? undefined : rollRange(row.text);
            const cells: (Cell | undefined)[] =
                span === undefined ? [undefined] : cellsOf(span, thresholds);
            // A bench row is a crafted modifier (check/ops.ts PoolSpec "bench");
            // any other may carry the mark too (exact/item.ts `CMod`). The
            // order is the layout `ModValue` documents.
            const crafted = row.source === "bench" ? [true] : [false, true];
            cells.forEach((cell, cellIndex) => {
                for (const fractured of [false, true]) {
                    for (const c of crafted) {
                        values.push({ row, cell, cellIndex, fractured, crafted: c });
                    }
                }
            });
        }
        slots.push({
            kind: "mod",
            type,
            sides: new Set(list.map((m) => m.gen)),
            families: first.families,
            rows: list,
            values,
            compared: thresholds.length > 0,
        });
    }

    // Groups of types joined by shared families.
    const parent = new Map<TypeId, TypeId>();
    const find = (t: TypeId): TypeId => {
        let r = t;
        while (parent.get(r) !== r) r = parent.get(r)!;
        parent.set(t, r);
        return r;
    };
    const owner = new Map<GroupId, TypeId>();
    for (const s of slots) parent.set(s.type, s.type);
    for (const s of slots) {
        for (const f of s.families) {
            const o = owner.get(f);
            if (o === undefined) owner.set(f, s.type);
            else parent.set(find(s.type), find(o));
        }
    }
    const groups = new Map<TypeId, ModSlot[]>();
    for (const s of slots) {
        const r = find(s.type);
        const g = groups.get(r);
        if (g) g.push(s);
        else groups.set(r, [s]);
    }
    const famKey = (s: ModSlot): string => [...s.families].sort().join("|");
    const rank = (g: readonly ModSlot[]): number => {
        const gens = new Set(g.flatMap((s) => [...s.sides]));
        return gens.size === 2 ? 1 : gens.has("prefix") ? 0 : 2;
    };
    const ordered = [...groups.values()].map((g) =>
        g.sort((a, b) => cmp(famKey(a), famKey(b)) || cmp(a.type, b.type)),
    );
    ordered.sort((a, b) => rank(a) - rank(b) || cmp(famKey(a[0]!), famKey(b[0]!)));
    return ordered.flat();
}

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** The universe of a check on `base` at `ilvl` for `craft`. */
export function buildUniverse(
    registry: Registry,
    base: Base,
    ilvl: number,
    craft: Craft | undefined,
    options: UniverseOptions = {},
): Universe {
    const rows = candidateRows(registry, base, ilvl, craft);
    const comparisons =
        craft === undefined ? NO_COMPARISONS : comparisonsOf(craft, registry, base, ilvl);
    const imprint = options.imprint ?? (craft !== undefined && craftImprints(craft));
    return new Universe(registry, base, ilvl, rows, comparisons, imprint, options);
}
