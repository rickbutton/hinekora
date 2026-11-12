/**
 * What a family of operations implements for the reference frame
 * (reference/method.ts): each operation on one concrete item, the obvious
 * way, under the contract of exact/ops/handler.ts. Each handler declares the
 * rules it reads, as its symbolic counterpart does. Test support.
 */
import type { Check } from "../../../check/ops.js";
import type { CheckOf, DispatchKey, OpAt, Reads } from "../../ops/handler.js";
import type { PoolTable } from "../../ops/pools.js";
import type { CompoundKind, CompoundOf } from "../../ops/steps.js";
import type { Rules } from "../../rules.js";
import type { CItem, RefCtx } from "../item.js";

export interface RefMethodCtx {
    readonly ctx: RefCtx;
    /** The rules the item's own metamods set when the method started, as
     *  `unprotect` and `keep` left them. */
    readonly rules: Rules;
    /** The item the method started on. */
    readonly start: CItem;
    /** The pools of other families a draw resolves (`RefHandlers.pools`). */
    readonly pools?: PoolTable;
}

export interface RefTransformHandler<K extends DispatchKey> {
    readonly reads: Reads<OpAt<K>>;
    /** The items the operation can leave of `item`; none where it cannot act. */
    readonly apply: (op: OpAt<K>, item: CItem, ctx: RefMethodCtx) => readonly CItem[];
}

export interface RefCompoundHandler<K extends CompoundKind> {
    readonly reads: Reads<CompoundOf<K>>;
    readonly apply: (run: CompoundOf<K>, item: CItem, ctx: RefMethodCtx) => readonly CItem[];
}

export interface RefCheckHandler<K extends Check["kind"]> {
    readonly reads: Reads<CheckOf<K>>;
    readonly pass: (check: CheckOf<K>, item: CItem, ctx: RefMethodCtx) => boolean;
    /** The refused item as the craft meant it; recovery only. */
    readonly repair?: (check: CheckOf<K>, item: CItem, ctx: RefMethodCtx) => readonly CItem[];
}

export type RefTransformTable = { readonly [K in DispatchKey]?: RefTransformHandler<K> };
export type RefCompoundTable = { readonly [K in CompoundKind]?: RefCompoundHandler<K> };
export type RefCheckTable = { readonly [K in Check["kind"]]?: RefCheckHandler<K> };

export interface RefHandlers {
    readonly transforms: RefTransformTable;
    readonly compounds: RefCompoundTable;
    readonly checks: RefCheckTable;
    /** The pools a family states for the draws of every family. */
    readonly pools?: PoolTable;
}
