/**
 * A surface condition on one concrete item: resolved for that item alone, on
 * the base under its influences' tags (language.md §2, the tags its other
 * modifiers add taking no part), then judged by `holds`. The definition the
 * exact checker's case split is held to. Test support.
 */
import type { Pred } from "../../ast/ast.js";
import type { PredDefs } from "../../check/defs.js";
import { resolvePred } from "../../check/resolve-pred.js";
import { influenceTagsOfKey } from "../influence.js";
import { holds } from "./conditions.js";
import type { CItem, RefCtx } from "./item.js";

export function holdsPred(pred: Pred, item: CItem, ctx: RefCtx, defs: PredDefs): boolean {
    const tags = influenceTagsOfKey(ctx.registry, ctx.base, item.influences);
    const r = resolvePred(
        pred,
        { base: ctx.base, ilvl: ctx.ilvl, tags, mayCarry: () => true },
        { ...defs, registry: ctx.registry, diag: () => {}, atomsNever: true },
    );
    if (r === null) throw new Error("the condition does not resolve on any item");
    return holds(r.pred, item, ctx);
}
