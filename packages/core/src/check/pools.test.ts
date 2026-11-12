import { describe, expect, it } from "vitest";
import type { Op } from "./ops/types.js";
import { RING_BASE } from "../__fixtures__/mods.js";
import { buildRegistry } from "../resolve/registry.js";
import { runMethod } from "./method.js";
import { type Handlers, InternalError } from "./ops/handler.js";
import { mergePools, type PoolTable } from "./ops/pools.js";
import { HANDLERS } from "./ops/registry.js";
import { modRow, VEILED_PLACEHOLDERS } from "./reference/catalog.js";
import { compareMethod } from "./reference/harness.js";
import { cItem, refCtx } from "./reference/item.js";
import { listItems } from "./reference/listing.js";
import type { RefHandlers } from "./reference/ops/handler.js";
import { REF_HANDLERS } from "./reference/ops/registry.js";
import { CItemSet } from "./reference/sets.js";
import { fromItems } from "./state.js";
import { buildUniverse } from "./universe.js";

describe("the pools of other families", () => {
    it("are merged once each, none over one stated in ops/pools.ts", () => {
        const stub = { rows: () => [] };
        expect(() => mergePools([["crafted", { natural: stub }]])).toThrow(InternalError);
        expect(() =>
            mergePools([
                ["crafted", { bench: stub }],
                ["misc", { bench: stub }],
            ]),
        ).toThrow(/stated twice/);
        expect(mergePools([["crafted", { bench: stub }]]).bench).toBe(stub);
    });

    it("are drawn by a reforge as its own rows are, stubbed through the handlers", () => {
        // As the Veiled Chaos Orb: a reforge one of whose modifiers is veiled.
        const pools: PoolTable = {
            ...HANDLERS.pools,
            veiledPlaceholder: { rows: () => VEILED_PLACEHOLDERS },
        };
        const exact: Handlers = { ...HANDLERS, pools };
        const reference: RefHandlers = { ...REF_HANDLERS, pools };
        const rows = ["A1", "B1", "D1", "E1"].map((id, i) =>
            modRow({ id, type: `Type${id}`, gen: i < 2 ? "prefix" : "suffix", text: "+1 to it" }),
        );
        const registry = buildRegistry({
            bases: [RING_BASE],
            mods: [...rows, ...VEILED_PLACEHOLDERS],
        });
        const u = buildUniverse(registry, RING_BASE, 84, undefined);
        const ctx = refCtx(registry, RING_BASE, 84);
        const ops: Op[] = [
            { kind: "fill", pool: { kind: "natural" }, count: { kind: "reforge", n: [4, 6] } },
            { kind: "fill", pool: { kind: "veiledPlaceholder" }, count: { kind: "within" } },
        ];
        const start = [cItem({ rarity: "rare" })];
        const d = compareMethod(u, ctx, CItemSet.of(start), ops, { exact, reference });
        expect(d, d).toBe("");
        const out = listItems(u, runMethod(fromItems(u, start)!, ops, exact).state.dd, {
            lowest: true,
        });
        expect(out.size).toBeGreaterThan(0);
        expect(
            out.every((x) => x.mods.filter((m) => m.row.startsWith("Veiled")).length === 1),
        ).toBe(true);
    });
});
