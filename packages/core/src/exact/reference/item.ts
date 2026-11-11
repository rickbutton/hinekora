/**
 * The concrete item of the exact checker's model: one item on a fixed base and
 * item level, every fact about it known. Test support: the reference
 * interpreter holds explicit sets of these over tiny catalogues.
 */
import type { Base } from "../../model/base.js";
import { craftedCapOf, type Effect, effectsOf } from "../../model/effects.js";
import type { Gen, GroupId, ModId, TypeId } from "../../model/ids.js";
import { NO_INFLUENCE } from "../../model/marks.js";
import type { Mod } from "../../model/mod.js";
import type { Registry } from "../../resolve/registry.js";
import type { CEldritch, CItem, CMod } from "../item.js";

export type { CEldritch, CItem, CMod } from "../item.js";

/** What every concrete item of a check shares: the catalogue, the base and the
 *  item level, with the rows indexed by id. */
export interface RefCtx {
    readonly registry: Registry;
    readonly base: Base;
    readonly ilvl: number;
    readonly rows: ReadonlyMap<ModId, Mod>;
}

export function refCtx(registry: Registry, base: Base, ilvl: number): RefCtx {
    return { registry, base, ilvl, rows: new Map(registry.catalog.map((m) => [m.id, m])) };
}

export const NO_IMPLICIT: CEldritch = { tier: 0, type: undefined };

/** An item with the given fields, the rest empty: Normal, no mods, no marks. */
export function cItem(fields: Partial<CItem> = {}): CItem {
    return {
        rarity: "normal",
        mods: [],
        influences: NO_INFLUENCE,
        corrupted: false,
        exarch: NO_IMPLICIT,
        eater: NO_IMPLICIT,
        strands: 0,
        imprint: undefined,
        ...fields,
    };
}

/** A modifier on `row`, neither fractured nor crafted unless said. */
export function cMod(row: ModId, value: number | undefined, marks: Partial<CMod> = {}): CMod {
    return { row, value, fractured: false, crafted: false, ...marks };
}

/** The row of a modifier; throws on a row the catalogue lacks, which is a
 *  fault of the test, not an item to judge. */
export function rowOf(ctx: RefCtx, m: CMod): Mod {
    const row = ctx.rows.get(m.row);
    if (row === undefined) throw new Error(`row ${m.row} is not in the catalogue`);
    return row;
}

export function sideOf(ctx: RefCtx, m: CMod): Gen {
    return rowOf(ctx, m).gen;
}

export function modsOn(ctx: RefCtx, item: CItem, gen: Gen): CMod[] {
    return item.mods.filter((m) => sideOf(ctx, m) === gen);
}

export interface CCounts {
    readonly prefix: number;
    readonly suffix: number;
    readonly total: number;
    readonly crafted: number;
    readonly fractured: number;
}

export function countsOf(ctx: RefCtx, item: CItem): CCounts {
    const prefix = modsOn(ctx, item, "prefix").length;
    return {
        prefix,
        suffix: item.mods.length - prefix,
        total: item.mods.length,
        crafted: item.mods.filter((m) => m.crafted).length,
        fractured: item.mods.filter((m) => m.fractured).length,
    };
}

/** The modifier of a type on the item; a well-formed item has at most one. */
export function modOfType(ctx: RefCtx, item: CItem, type: TypeId): CMod | undefined {
    return item.mods.find((m) => rowOf(ctx, m).type === type);
}

export function typesOf(ctx: RefCtx, item: CItem): Set<TypeId> {
    return new Set(item.mods.map((m) => rowOf(ctx, m).type));
}

export function familiesOf(ctx: RefCtx, item: CItem): Set<GroupId> {
    return new Set(item.mods.flatMap((m) => [...rowOf(ctx, m).families]));
}

/** The effects the present modifiers carry (item-model.md §6). */
export function effectsOn(ctx: RefCtx, item: CItem): Effect[] {
    return item.mods.flatMap((m) => [...effectsOf(rowOf(ctx, m))]);
}

/** The crafted-modifier limit the item's own modifiers set. */
export function craftedLimit(ctx: RefCtx, item: CItem): number {
    return craftedCapOf(effectsOn(ctx, item));
}

const modKey = (m: CMod): string =>
    `${m.row}=${m.value ?? "-"}${m.fractured ? "F" : ""}${m.crafted ? "C" : ""}`;

const implicitKey = (e: CEldritch): string => `${e.tier}:${e.type ?? "?"}`;

/** Code-unit order, independent of the locale. */
export function compareStrings(a: string, b: string): number {
    return a < b ? -1 : a > b ? 1 : 0;
}

/** A stable string naming the item exactly: two items are equal iff their keys are. */
export function itemKey(item: CItem): string {
    const mods = item.mods.map(modKey).sort().join(",");
    const imprint = item.imprint === undefined ? "" : ` imprint(${itemKey(item.imprint)})`;
    return (
        `${item.rarity} [${mods}] inf=${item.influences === NO_INFLUENCE ? "-" : item.influences}` +
        `${item.corrupted ? " corrupted" : ""} exarch=${implicitKey(item.exarch)}` +
        ` eater=${implicitKey(item.eater)} strands=${item.strands}${imprint}`
    );
}

/** The item with its modifiers in key order, so equal items are equal objects
 *  field by field. */
export function canonical(item: CItem): CItem {
    const mods = [...item.mods].sort((a, b) => compareStrings(modKey(a), modKey(b)));
    return {
        ...item,
        mods,
        imprint: item.imprint === undefined ? undefined : canonical(item.imprint),
    };
}
