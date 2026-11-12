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

/**
 * Does the condition read on these items: no fault of it holds under the
 * influences of every one of them (an atom no influence set of theirs
 * resolves, a def misused). One that does not narrows nothing, the
 * driver's recovery after reporting it.
 */
export function readsOn(pred: Pred, items: Iterable<CItem>, ctx: RefCtx, defs: PredDefs): boolean {
    let common: Set<string> | undefined;
    let resolved = false;
    for (const key of new Set([...items].map((x) => x.influences))) {
        const tags = influenceTagsOfKey(ctx.registry, ctx.base, key);
        const said = new Set<string>();
        const view = { base: ctx.base, ilvl: ctx.ilvl, tags, mayCarry: () => true };
        resolvePred(pred, view, {
            ...defs,
            registry: ctx.registry,
            diag: (_m, span) => said.add(`${span.start.offset}:${span.end.offset}`),
        });
        const r = resolvePred(pred, view, {
            ...defs,
            registry: ctx.registry,
            diag: () => {},
            atomsNever: true,
        });
        if (r !== null) resolved = true;
        common = common === undefined ? said : new Set([...common].filter((k) => said.has(k)));
    }
    return resolved && (common === undefined || common.size === 0);
}

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
