/**
 * A method built for one concrete item alone: the item as its builder reads it
 * (`MethodItem`), every fact one value. Test support: what exact/build.ts
 * builds for a part is held to what this builds for each of its items.
 */
import type { Literal, Method, MethodItem, Refusal } from "../../check/methods.js";
import type { Op } from "../../check/ops.js";
import type { ModId, TypeId } from "../../model/ids.js";
import { eldritchKey } from "../../model/marks.js";
import { type CItem, type RefCtx, rowOf } from "./item.js";

export function itemMethodView(ctx: RefCtx, item: CItem): MethodItem {
    const tiers = new Map<TypeId, ReadonlySet<ModId>>();
    for (const m of item.mods) tiers.set(rowOf(ctx, m).type, new Set([m.row]));
    return {
        base: ctx.base,
        ilvl: ctx.ilvl,
        influences: new Set([item.influences]),
        eldritch: new Set([eldritchKey(item.exarch.tier, item.eater.tier)]),
        tiers,
    };
}

export function buildFor(
    ctx: RefCtx,
    item: CItem,
    method: Method,
    literals: readonly Literal[],
): readonly Op[] | Refusal {
    return method.build(literals, itemMethodView(ctx, item), ctx.registry);
}
