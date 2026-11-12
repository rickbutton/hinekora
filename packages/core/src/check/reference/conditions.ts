/**
 * A resolved condition on one concrete item (language.md §5): the concrete
 * meaning each kind of `RPred` narrows a state by.
 */
import type { Cmp } from "../../ast/ast.js";
import type { RPred } from "../pred.js";
import { dominantOf, eldritchKey, influencesOf, NO_INFLUENCE } from "../../model/marks.js";
import { type CItem, countsOf, modOfType, type RefCtx, rowOf } from "./item.js";

export function compare(left: number, op: Cmp, right: number): boolean {
    switch (op) {
        case "==":
            return left === right;
        case "!=":
            return left !== right;
        case "<":
            return left < right;
        case "<=":
            return left <= right;
        case ">":
            return left > right;
        case ">=":
            return left >= right;
    }
}

export function holds(pred: RPred, item: CItem, ctx: RefCtx): boolean {
    switch (pred.kind) {
        case "isRarity":
            return item.rarity === pred.rarity;
        case "has": {
            // The side is the row's: `gen` is what the resolver expects, not a
            // further condition.
            const m = modOfType(ctx, item, pred.type);
            return m !== undefined && (pred.tierMod === undefined || m.row === pred.tierMod);
        }
        case "hasGroup":
            return item.mods.some((m) => pred.types.has(rowOf(ctx, m).type));
        case "hasValue": {
            // A row with no number has no value to compare and fails, whatever
            // the comparison. `rows` is part of the meaning only where the
            // condition names a tier; otherwise any row of the type compares.
            const m = modOfType(ctx, item, pred.type);
            if (m === undefined || m.value === undefined) return false;
            if (pred.oneTier && !pred.rows.has(m.row)) return false;
            return compare(m.value, pred.op, pred.value);
        }
        case "compare": {
            const counts = countsOf(ctx, item);
            const n = pred.projection === "prefixCount" ? counts.prefix : counts.suffix;
            return compare(n, pred.op, pred.value);
        }
        case "fractured":
            return modOfType(ctx, item, pred.type)?.fractured === true;
        case "influenced":
            return pred.influence === undefined
                ? item.influences !== NO_INFLUENCE
                : influencesOf(item.influences).includes(pred.influence);
        case "corrupted":
            return item.corrupted !== false;
        case "eldritch": {
            const { tier, type } = item[pred.side];
            if (tier === 0 || (pred.tier !== undefined && tier !== pred.tier)) return false;
            return pred.types === undefined || (type !== undefined && pred.types.has(type));
        }
        case "dominant":
            return dominantOf(eldritchKey(item.exarch.tier, item.eater.tier)) === pred.side;
        case "not":
            return !holds(pred.inner, item, ctx);
        case "and":
            return holds(pred.left, item, ctx) && holds(pred.right, item, ctx);
        case "or":
            return holds(pred.left, item, ctx) || holds(pred.right, item, ctx);
    }
}
