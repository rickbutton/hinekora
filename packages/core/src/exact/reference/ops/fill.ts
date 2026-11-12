/**
 * Adding modifiers on one concrete item: the definition the symbolic fill
 * (exact/ops/fill.ts) is held equal to.
 *
 * - A draw takes one row of the pool as the item then stands (pools.ts), at
 *   any value of its span, fresh: rows are laid one after another, a group
 *   closing once one of it is laid and a side when it is full (Modifier §
 *   Group/family; cost.md §2, the order every calculator takes).
 * - `add`: `n[0]` to `n[1]` draws (Orb of Transmutation § Spending: a prefix,
 *   a suffix or both; Exalted Orb, Regal Orb: one), each held to what the
 *   rarity holds on the base. Draws that run dry after the least leave the
 *   item as they found it; before it, the item cannot take the currency and
 *   has no outcome (ops/handler.ts), as a full item under a Tainted Exalted
 *   Orb's add. A transmuted Magic Simplex holds none and keeps none (Simplex
 *   Amulet § Special Crafting Considerations).
 * - `reforge`: the total it leaves is one of ops/fill.ts `reforgeTotals`,
 *   what the strip left counting toward it (Chaos Orb § Mechanics: "a rare
 *   item with an affix count of 4, 5, or 6"; a fractured modifier is one of
 *   them); where the pool runs dry first, it lays what fits (cost.md §2).
 * - With a side kept (`Rules.protected`, a metamod or `keep`), an item is
 *   also an outcome once one modifier was laid, the draws going on up to the
 *   most: the union of that reading (Metamod § Examples: "1 prefix as well as
 *   0 to 3 suffixes ... or 0 prefix and 1 to 3 suffixes") and the count
 *   above, until a probe settles which the game does.
 * - `reforgeWith`: the guaranteed rows go down first, each from its own pool,
 *   and count toward the total (Essence § Crafting; cost.md §2: "the forced
 *   row within it"). One whose pool has no row that fits is not laid: an
 *   assumption, the wiki does not say.
 */
import type { FillCount } from "../../../check/ops.js";
import type { DispatchKey } from "../../ops/handler.js";
import { InternalError } from "../../ops/handler.js";
import { addDraws, readsOfFill, reforgeTotals } from "../../ops/fill.js";
import { essenceRow } from "../../ops/pools.js";
import type { FillOp } from "../../ops/steps.js";
import { type CItem, countsOf, type RefCtx } from "../item.js";
import type {
    RefCheckTable,
    RefCompoundTable,
    RefMethodCtx,
    RefTransformHandler,
    RefTransformTable,
} from "./handler.js";
import { drawOne, eligible, hasRoom } from "./pools.js";

const total = (item: CItem, ctx: RefCtx): number => countsOf(ctx, item).total;

function add(op: FillOp, n: readonly [number, number], item: CItem, mc: RefMethodCtx): CItem[] {
    const { ctx, rules } = mc;
    const [lo, hi] = addDraws(n, item.rarity, ctx.base);
    const go = (x: CItem, k: number): CItem[] => {
        const out = k >= lo ? [x] : [];
        if (k >= hi) return out;
        const rows = eligible(op.pool, x, ctx, rules.strands, mc.pools);
        return [...out, ...drawOne(x, rows).flatMap((y) => go(y, k + 1))];
    };
    return go(item, 0);
}

function reforge(
    op: FillOp & { readonly count: Extract<FillCount, { kind: "reforge" }> },
    forced: readonly FillOp[],
    item: CItem,
    mc: RefMethodCtx,
): CItem[] {
    const { ctx, rules } = mc;
    const [least, most] = reforgeTotals(op.count.n, item.rarity, ctx.base);
    let start: { x: CItem; laid: boolean }[] = [{ x: item, laid: false }];
    for (const f of forced) {
        start = start.flatMap(({ x, laid }) => {
            const rows = eligible(f.pool, x, ctx, rules.strands, mc.pools);
            return rows.length === 0
                ? [{ x, laid }]
                : drawOne(x, rows).map((y) => ({ x: y, laid: true }));
        });
    }
    const kept = rules.protected.size > 0;
    const go = (x: CItem, laid: boolean): CItem[] => {
        const c = total(x, ctx);
        const out = (kept && laid) || c >= least ? [x] : [];
        if (c >= most) return [x];
        const rows = eligible(op.pool, x, ctx, rules.strands, mc.pools);
        if (rows.length === 0) return [x];
        return [...out, ...drawOne(x, rows).flatMap((y) => go(y, true))];
    };
    return start.flatMap(({ x, laid }) => go(x, laid));
}

function fill<K extends DispatchKey & `fill:${string}`>(): RefTransformHandler<K> {
    return {
        reads: (op) => readsOfFill(op),
        apply: (op, item, mc) => {
            const f = op as unknown as FillOp;
            switch (f.count.kind) {
                case "add":
                    return add(f, f.count.n, item, mc);
                case "reforge":
                    return reforge(f as Parameters<typeof reforge>[0], [], item, mc);
                case "within":
                    throw new InternalError("a fill of what is already counted outside a reforge");
            }
        },
    };
}

export const transforms: RefTransformTable = {
    "fill:natural": fill(),
    "fill:tagged": fill(),
    "fill:fossil": fill(),
    "fill:essenceGrant": fill(),
    "fill:influence": fill(),
    "fill:rows": fill(),
};

export const compounds: RefCompoundTable = {
    reforgeWith: {
        reads: ["protected", "strands"],
        apply: (run, item, mc) => reforge(run.reforge, run.within, item, mc),
    },
};

export const checks: RefCheckTable = {
    openSlot: { reads: [], pass: (check, item, { ctx }) => hasRoom(item, ctx, check.gen) },
    poolNonEmpty: {
        reads: ["strands"],
        pass: (check, item, { ctx, rules, pools }) =>
            eligible(check.pool, item, ctx, rules.strands, pools).length > 0,
    },
    noBlockingMetamod: {
        reads: ["blocksSourced"],
        pass: (_c, _i, { rules }) => !rules.blocksSourced,
    },
    fossilAllowed: {
        reads: [],
        pass: (check, _item, { ctx }) => {
            const allowed = check.fossil.allowedTags;
            return allowed === undefined || [...ctx.base.tags].some((t) => allowed.has(t));
        },
    },
    essenceRarity: {
        reads: [],
        pass: (check, item) =>
            item.rarity === "normal" || (item.rarity === "rare" && check.tier >= 5),
    },
    essenceGrant: {
        reads: [],
        pass: (check, _item, { ctx }) => essenceRow(ctx, check.spec) !== undefined,
    },
};
