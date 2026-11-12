/**
 * Fracturing (`lock`) and the bench's and veiled modifiers on one concrete
 * item: the definition check/ops/crafted.ts is held equal to.
 *
 * - A bench craft lays its row crafted, at any value of its span (Crafting
 *   Bench § Using the crafting bench; the add the fill family's). Its checks: an open slot of the row's side, no
 *   modifier of its type or group (the same section), and fewer crafted
 *   modifiers than the item's limit, read from the modifiers it holds then
 *   (`craftedLimit`: one, three under the multimod, which counts toward its
 *   own three, QUESTIONS.md Q107).
 * - The replacing removal before a craft: under a limit of one, the item's
 *   single crafted modifier goes; under the multimod nothing goes, the craft
 *   adding beside (Crafting Bench § Using the crafting bench: the craft
 *   "will attempt to replace the current crafted modifier"). The bench
 *   refuses to replace a fractured crafted modifier, or one of several: the
 *   item an annulled multimod leaves with two crafts (`craftedReplaceable`;
 *   "This cannot replace crafted modifiers that are fractured, if the item
 *   has multiple crafted modifiers").
 * - The bench's "Remove Crafted Mods" takes every crafted modifier but the
 *   fractured ones (Crafting Bench § Other crafts; Fractured item §
 *   Mechanics: a fractured modifier cannot be removed); it needs one to take.
 * - `lock`: `n` of the item's unfractured modifiers become fractured, each
 *   choice an outcome; any explicit modifier may be chosen, a crafted one, a
 *   metamod and a placeholder among them (Fracturing Orb § Mechanics:
 *   "randomly fracture one explicit modifier"; it "does not respect
 *   metamods"). An influenced item takes none (Fractured item § Mechanics),
 *   which its checks refuse. `atLeast` counts every modifier (Fracturing Orb:
 *   "a rare item with 4 or more modifiers"); `noFracture` refuses any
 *   fractured one (the orb and the Bestiary's fractures "cannot be used on
 *   Fractured items").
 * - A veiled orb's placeholder is the plain veiled prefix or suffix, by the
 *   room the item has (QUESTIONS.md Q76, Q109); an item holds one at most
 *   (item-model.md §8). The Veiled Exalted Orb refuses an item with a veiled
 *   or unveiled modifier or a bench row crafting one (`noVeiled`, Veiled
 *   Exalted Orb § Mechanics); the Veiled Chaos Orb one whose veiled or
 *   unveiled modifier its strip would keep, fractured or on a protected
 *   side (`noVeiledKept`, as check/ops/types.ts reads "cannot be used to obtain
 *   multiple veiled modifiers", Veiled Exalted Orb § Version history 3.15.0).
 * - An unveil replaces the placeholder with one of the results its side
 *   offers (pool/veiled.ts `veiledPool`: the base's, a result whose group a
 *   present modifier holds blocked), at any value, keeping the placeholder's
 *   marks: a fractured veiled modifier unveils fractured (assumed, the wiki
 *   silent). Unnamed, any offered result is an outcome; named, only that
 *   one, and the check asks that it be offered, that three or fewer be,
 *   since the game shows three of them (Veiled modifier: "presents three
 *   random mods"), and that no other offered result share its group, since
 *   an option closes every result of its group (QUESTIONS.md Q99, as
 *   cost/roll.ts `offerSetsOf` draws them).
 * - The Bestiary's metamod: one of the metamods not on the item whose side
 *   has room, crafted, the crafted limit not reached (Beastcrafting, "Add a
 *   crafted Meta-modifier": "Requires an empty affix slot, and requires that
 *   a crafted mod could normally be added without removing another one
 *   first").
 *
 * What the wiki does not settle, assumed here:
 * - a fractured placeholder unveils fractured, and carries its crafted mark;
 * - the placeholder stays where no result can be offered (a library check is
 *   to replace this);
 * - the Veiled Chaos Orb refuses an item whose veiled or unveiled modifier its
 *   strip keeps, fractured or on a protected side, and its strip honours the
 *   protections;
 * - the bench's removal ignores the protections, and a bench craft the
 *   cannot-roll metamods;
 * - an Aspect is laid uncrafted.
 */
import { rollRange } from "../../values.js";
import type { Gen, TypeId } from "../../../model/ids.js";
import type { Mod } from "../../../model/mod.js";
import { isVeiledPlaceholder } from "../../../model/veiled.js";
import { veiledPool } from "../../../pool/veiled.js";
import { isVeiledRow, metamodRows } from "../../ops/crafted-rows.js";
import { readsOfFill } from "../../ops/fill.js";
import { InternalError } from "../../ops/handler.js";
import {
    type CItem,
    type CMod,
    countsOf,
    craftedLimit,
    familiesOf,
    type RefCtx,
    rowOf,
} from "../item.js";
import { isWellFormed } from "../wellformed.js";
import { add } from "./fill.js";
import type {
    RefCheckTable,
    RefCompoundTable,
    RefTransformHandler,
    RefTransformTable,
} from "./handler.js";
import { fits } from "./pools.js";

function viaFill<
    K extends "fill:bench" | "fill:veiledPlaceholder" | "fill:metamods",
>(): RefTransformHandler<K> {
    return {
        reads: (op) => readsOfFill(op),
        apply: (op, item, mc) => {
            if (op.count.kind !== "add") {
                throw new InternalError(`a ${op.count.kind} from the ${op.pool.kind} pool alone`);
            }
            return add(op, op.count.n, item, mc);
        },
    };
}

const craftedMods = (item: CItem): CMod[] => item.mods.filter((m) => m.crafted);

const placeholderOf = (ctx: RefCtx, item: CItem): CMod | undefined =>
    item.mods.find((m) => isVeiledPlaceholder(rowOf(ctx, m).type));

/** The results the item's placeholder offers. */
function offered(ctx: RefCtx, item: CItem, p: CMod): Mod[] {
    const gen: Gen = rowOf(ctx, p).gen;
    const others = { ...item, mods: item.mods.filter((m) => m !== p) };
    return veiledPool(ctx.registry.catalog, ctx.base, ctx.ilvl, familiesOf(ctx, others)).filter(
        (m) => m.gen === gen,
    );
}

function valuesOf(row: Mod): (number | undefined)[] {
    const span = row.text === undefined ? undefined : rollRange(row.text);
    if (span === undefined) return [undefined];
    const out: number[] = [];
    for (let v = span[0]; v <= span[1]; v++) out.push(v);
    return out;
}

function unveil(ctx: RefCtx, item: CItem, target: TypeId | undefined): CItem[] {
    const p = placeholderOf(ctx, item);
    if (p === undefined) return [];
    const rest = item.mods.filter((m) => m !== p);
    const out = offered(ctx, item, p)
        .filter((r) => target === undefined || r.type === target)
        .flatMap((r) =>
            valuesOf(r).map((value) => ({
                ...item,
                mods: [...rest, { row: r.id, value, fractured: p.fractured, crafted: p.crafted }],
            })),
        )
        .filter((x) => isWellFormed(x, ctx));
    return out.length > 0 ? out : [item];
}

/** Every way to fracture `n` of the unfractured modifiers. */
function fractured(ctx: RefCtx, item: CItem, n: number): CItem[] {
    const go = (from: number, left: number, mods: CMod[]): CItem[] => {
        if (left === 0) return [{ ...item, mods }];
        const out: CItem[] = [];
        for (let i = from; i < mods.length; i++) {
            if (mods[i]!.fractured) continue;
            const next = mods.map((m, j) => (j === i ? { ...m, fractured: true } : m));
            out.push(...go(i + 1, left - 1, next));
        }
        return out;
    };
    const out = go(0, n, [...item.mods]);
    if (out.some((x) => !isWellFormed(x, ctx))) throw new InternalError("a fracture is ill-formed");
    return out;
}

export const transforms: RefTransformTable = {
    "fill:bench": viaFill(),
    "fill:veiledPlaceholder": viaFill(),
    "fill:metamods": viaFill(),
    "fill:unveil": {
        reads: [],
        apply: (op, item, { ctx }) => unveil(ctx, item, op.pool.target),
    },
    "remove:crafted": {
        reads: [],
        apply: (op, item, { ctx }) => {
            const kept = item.mods.filter((m) => !m.crafted || m.fractured);
            if (!op.selector.replacing) return [{ ...item, mods: kept }];
            const crafts = craftedMods(item);
            const replaced =
                craftedLimit(ctx, item) === 1 && crafts.length === 1 && !crafts[0]!.fractured;
            return [replaced ? { ...item, mods: kept } : item];
        },
    },
    lock: { reads: [], apply: (op, item, { ctx }) => fractured(ctx, item, op.n) },
};

export const compounds: RefCompoundTable = {};

export const checks: RefCheckTable = {
    atLeast: { reads: [], pass: (check, item) => item.mods.length >= check.count },
    noFracture: { reads: [], pass: (_check, item) => !item.mods.some((m) => m.fractured) },
    craftedBelowCap: {
        reads: [],
        pass: (_check, item, { ctx }) => countsOf(ctx, item).crafted < craftedLimit(ctx, item),
    },
    craftedRemovable: {
        reads: [],
        pass: (_check, item) => item.mods.some((m) => m.crafted && !m.fractured),
    },
    craftedReplaceable: {
        reads: [],
        pass: (_check, item, { ctx }) => {
            if (craftedLimit(ctx, item) > 1) return true;
            const crafts = craftedMods(item);
            return crafts.length === 0 || (crafts.length === 1 && !crafts[0]!.fractured);
        },
    },
    noGroupConflict: {
        reads: [],
        pass: (check, item, { ctx }) =>
            !item.mods.some((m) => {
                const row = rowOf(ctx, m);
                return (
                    row.type !== check.replacing &&
                    [...row.families].some((f) => check.mod.families.has(f))
                );
            }),
    },
    metamodFits: {
        reads: [],
        pass: (_check, item, { ctx }) => metamodRows(ctx).some((r) => fits(item, r, ctx)),
    },
    veiledPresent: {
        reads: [],
        pass: (_check, item, { ctx }) => placeholderOf(ctx, item) !== undefined,
    },
    noVeiled: {
        reads: [],
        pass: (_check, item, { ctx }) => !item.mods.some((m) => isVeiledRow(rowOf(ctx, m), true)),
    },
    noVeiledKept: {
        reads: ["protected"],
        pass: (_check, item, { ctx, rules }) =>
            !item.mods.some((m) => {
                const row = rowOf(ctx, m);
                return isVeiledRow(row, false) && (m.fractured || rules.protected.has(row.gen));
            }),
    },
    unveilTarget: {
        reads: [],
        pass: (check, item, { ctx }) => {
            const p = placeholderOf(ctx, item);
            if (p === undefined) return false;
            const rows = offered(ctx, item, p);
            const types = new Set(rows.map((m) => m.type));
            const own = rows.find((m) => m.type === check.type);
            if (own === undefined || types.size > 3) return false;
            return !rows.some(
                (m) => m.type !== check.type && [...m.families].some((f) => own.families.has(f)),
            );
        },
    },
};
