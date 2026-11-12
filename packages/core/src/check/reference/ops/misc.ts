/**
 * The rest, on one concrete item: the definition check/ops/misc.ts is held
 * equal to.
 *
 * - `reroll` (Divine Orb § Crafting): each modifier takes any value of its
 *   row's span, the row kept; a fractured one keeps its value (Fractured item
 *   § Mechanics) and so does one on a side a metamod protects (Metamod § Rules
 *   and Exceptions: "Respected"). Assumed, the wiki silent ("the random
 *   modifiers"): a crafted one is rerolled too.
 * - `relax` (Tainted Divine Teardrop § Mechanics): each modifier, on its own,
 *   stays or moves one tier up or down its ladder (ops/misc.ts
 *   `teardropMoves`), never past either end; one moved rolls a value of its
 *   new row. A row on no ladder of the item ("can't normally roll", the
 *   3.16.1 note) stays, and so does a crafted modifier ("It cannot modify
 *   crafted modifiers"); `crafted` moves them, which no method asks for.
 *   Metamods are ignored (Metamod § Rules and Exceptions: "Ignored").
 *   Assumed, the wiki silent:
 *   - the ladder runs above the item's level ("a tier usually obtainable on
 *     that base type");
 *   - a fractured modifier moves like any other;
 *   - an unmoved modifier keeps its value, a moved one rolls a value of its
 *     new row.
 * - `strands` (Memory strand § Crafting methods consuming memory strands): a
 *   use takes from none up to its figure, read at the modifier count of the
 *   item the method started on (ops/misc.ts `strandsTaken`), never below none.
 * - `imprint` (Imprint § Mechanics): the item as it stands is held.
 *   Assumed, the wiki silent: a new imprint replaces a held one. `restore`:
 *   the item becomes the held one, strands and all ("Memory Strand count"),
 *   and holds none.
 * - `remove:type`: the type's modifier goes, the rest stay; one absent,
 *   fractured (Fractured item § Mechanics) or on a protected side (Metamod §
 *   Rules and Exceptions, "Change Element of Resistance": "Respected") has no
 *   outcome.
 * - `change` (Modifier § Harvest Crafting: "preserves the tier, but not the
 *   roll"): that removal, and in its place one of the rows the pool gives for
 *   the removed row (check/methods.ts `harvestChange`), at any value of its
 *   span, not fractured, crafted where the removed one was (a changed bench
 *   craft is crafted still, check/ops/types.ts PoolSpec "rows"); one the item cannot
 *   then hold is no outcome, and so is a removed row the pool gives no row
 *   for (an essence row with no counterpart).
 */
import { rollRange } from "../../values.js";
import type { TypeId } from "../../../model/ids.js";
import type { Mod } from "../../../model/mod.js";
import { changeRows, strandsTaken, TALISMAN, teardropMoves } from "../../ops/misc.js";
import type { Rules } from "../../rules.js";
import { keeps } from "../rules.js";
import { type CItem, type CMod, modOfType, type RefCtx, rowOf } from "../item.js";
import { isWellFormed } from "../wellformed.js";
import type { RefCheckTable, RefCompoundTable, RefTransformTable } from "./handler.js";

/** Every value of the row's span; none for a row with no number. */
function spanValues(row: Mod): (number | undefined)[] {
    const span = row.text === undefined ? undefined : rollRange(row.text);
    if (span === undefined) return [undefined];
    if (!Number.isInteger(span[0]) || !Number.isInteger(span[1])) {
        throw new Error(`${row.id} has a span of fractions, which cannot be listed`);
    }
    const out: number[] = [];
    for (let v = span[0]; v <= span[1]; v++) out.push(v);
    return out;
}

/** Every item made by choosing, for each modifier, one of its forms. */
function product(item: CItem, forms: readonly (readonly CMod[])[]): CItem[] {
    let lists: CMod[][] = [[]];
    for (const f of forms) lists = lists.flatMap((l) => f.map((m) => [...l, m]));
    return lists.map((mods) => ({ ...item, mods }));
}

const at = (m: CMod, row: Mod, value: number | undefined): CMod => ({ ...m, row: row.id, value });

/** The type's modifier where a removal of it can take it. */
function removable(item: CItem, type: TypeId, ctx: RefCtx, rules: Rules): CMod | undefined {
    const m = modOfType(ctx, item, type);
    if (m === undefined || m.fractured || keeps(rules.protected, rowOf(ctx, m))) return undefined;
    return m;
}

const without = (item: CItem, m: CMod): CItem => ({
    ...item,
    mods: item.mods.filter((x) => x !== m),
});

export const transforms: RefTransformTable = {
    "remove:type": {
        reads: ["protected"],
        apply: (op, item, { ctx, rules }) => {
            const m = removable(item, op.selector.type, ctx, rules);
            return m === undefined ? [] : [without(item, m)];
        },
    },
    reroll: {
        reads: ["protected"],
        apply: (_op, item, { ctx, rules }) =>
            product(
                item,
                item.mods.map((m) => {
                    const row = rowOf(ctx, m);
                    if (m.fractured || keeps(rules.protected, row)) return [m];
                    return spanValues(row).map((v) => at(m, row, v));
                }),
            ),
    },
    relax: {
        reads: [],
        apply: (op, item, { ctx }) =>
            product(
                item,
                item.mods.map((m) => {
                    if (m.crafted && !op.crafted) return [m];
                    const row = rowOf(ctx, m);
                    const moves = teardropMoves(ctx.registry, ctx.base, row, item.influences);
                    if (moves === undefined) return [m];
                    return [m, ...moves.flatMap((t) => spanValues(t).map((v) => at(m, t, v)))];
                }),
            ).filter((x) => isWellFormed(x, ctx)),
    },
    strands: {
        reads: [],
        apply: (op, item, { start }) => {
            const most = strandsTaken(op.consume, start.mods.length);
            const out: CItem[] = [];
            for (let s = Math.max(0, item.strands - most); s <= item.strands; s++) {
                out.push({ ...item, strands: s });
            }
            return out;
        },
    },
    imprint: {
        reads: [],
        apply: (_op, item) => [{ ...item, imprint: { ...item, imprint: undefined } }],
    },
    restore: {
        reads: [],
        apply: (_op, item) =>
            item.imprint === undefined ? [] : [{ ...item.imprint, imprint: undefined }],
    },
};

export const compounds: RefCompoundTable = {
    change: {
        reads: ["protected"],
        apply: (run, item, { ctx, rules }) => {
            const m = removable(item, run.remove.selector.type, ctx, rules);
            if (m === undefined) return [];
            const targets = changeRows(run.fill.pool, m.row);
            const rest = without(item, m);
            return targets
                .filter((t) => m.crafted || t.source !== "bench")
                .flatMap((t) =>
                    spanValues(t).map((value) => ({
                        ...rest,
                        mods: [
                            ...rest.mods,
                            { row: t.id, value, fractured: false, crafted: m.crafted },
                        ],
                    })),
                )
                .filter((x) => modOfType(ctx, rest, rowOf(ctx, x.mods.at(-1)!).type) === undefined)
                .filter((x) => isWellFormed(x, ctx));
        },
    },
};

export const checks: RefCheckTable = {
    typeRemovable: {
        reads: ["protected"],
        pass: (check, item, { ctx, rules }) =>
            removable(item, check.type, ctx, rules) !== undefined,
    },
    hasImprint: {
        reads: [],
        pass: (_check, item) => item.imprint !== undefined,
    },
    // Beastcrafting: "Create an Imprint" of a Magic item or of a Rare Talisman.
    imprintable: {
        reads: [],
        pass: (_check, item, { ctx }) =>
            item.rarity === "magic" || (item.rarity === "rare" && ctx.base.tags.has(TALISMAN)),
    },
};
