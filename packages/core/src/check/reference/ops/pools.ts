/**
 * Drawing a modifier from a pool on one concrete item, the obvious way: the
 * rows the pool offers the item as it stands (check/ops/pools.ts `poolRows`,
 * read with the item's own view), those that fit it, and every item one of
 * them makes at each value of its span. Test support.
 */
import type { PoolSpec } from "../../ops/types.js";
import { rollRange } from "../../values.js";
import { maxTotal, sideCap } from "../../../model/capacity.js";
import { effectsOf } from "../../../model/effects.js";
import type { Gen, TagId } from "../../../model/ids.js";
import type { Mod } from "../../../model/mod.js";
import { poolRows, type PoolTable, poolView, type PoolView } from "../../ops/pools.js";
import type { CannotRoll } from "../../rules.js";
import { type CItem, countsOf, modOfType, type RefCtx, rowOf } from "../item.js";
import { isWellFormed } from "../wellformed.js";

/** Does the item have an open slot: on that side, or on either. */
export function hasRoom(item: CItem, ctx: RefCtx, gen?: Gen): boolean {
    const c = countsOf(ctx, item);
    if (c.total >= maxTotal(item.rarity, ctx.base)) return false;
    const room = (g: Gen): boolean =>
        (g === "prefix" ? c.prefix : c.suffix) < sideCap(g, item.rarity, ctx.base);
    return gen === undefined ? room("prefix") || room("suffix") : room(gen);
}

/** What the pool reads of the item: its tags, the cannot-roll metamods on it,
 *  its strands where the draws are `cut` by them, its open sides. */
export function viewOf(item: CItem, ctx: RefCtx, cut: boolean): PoolView {
    const rows = item.mods.map((m) => rowOf(ctx, m));
    const modTags = new Set<TagId>(rows.flatMap((r) => [...r.addsTags]));
    const restrictions = rows.flatMap((r) =>
        effectsOf(r).filter((e): e is CannotRoll => e.kind === "poolRestrict"),
    );
    return poolView(ctx, item.influences, modTags, restrictions, cut ? item.strands : 0, {
        prefix: hasRoom(item, ctx, "prefix"),
        suffix: hasRoom(item, ctx, "suffix"),
    });
}

/** The item with the row added at a value, fresh: not fractured, crafted
 *  where it is a bench row. */
function withRow(item: CItem, row: Mod, value: number | undefined): CItem {
    const mod = { row: row.id, value, fractured: false, crafted: row.source === "bench" };
    return { ...item, mods: [...item.mods, mod] };
}

/** Does the row go on the item: its type absent, and the item it makes one
 *  the game allows (its families free, room on its side). */
export function fits(item: CItem, row: Mod, ctx: RefCtx): boolean {
    return (
        modOfType(ctx, item, row.type) === undefined &&
        isWellFormed(withRow(item, row, lowestOf(row)), ctx)
    );
}

function lowestOf(row: Mod): number | undefined {
    const span = row.text === undefined ? undefined : rollRange(row.text);
    return span?.[0];
}

/** Every value of the row's span; none for a row with no number. */
function valuesOf(row: Mod): (number | undefined)[] {
    const span = row.text === undefined ? undefined : rollRange(row.text);
    if (span === undefined) return [undefined];
    if (!Number.isInteger(span[0]) || !Number.isInteger(span[1])) {
        throw new Error(`${row.id} has a span of fractions, which cannot be listed`);
    }
    const out: number[] = [];
    for (let v = span[0]; v <= span[1]; v++) out.push(v);
    return out;
}

/** The rows a draw from the pool can lay on the item as it stands. */
export function eligible(
    spec: PoolSpec,
    item: CItem,
    ctx: RefCtx,
    cut: boolean,
    pools: PoolTable = {},
): Mod[] {
    return poolRows(ctx, spec, viewOf(item, ctx, cut), cut, pools).filter((r) =>
        fits(item, r, ctx),
    );
}

/** Every item that adding one of the rows makes, at any value of its span. */
export function drawOne(item: CItem, rows: readonly Mod[]): CItem[] {
    return rows.flatMap((r) => valuesOf(r).map((v) => withRow(item, r, v)));
}
