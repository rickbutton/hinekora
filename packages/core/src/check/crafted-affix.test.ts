import { describe, expect, it } from "vitest";
import { check, type CheckContext } from "./check.js";
import { guaranteedTypes } from "./astate.js";
import { buildRegistry } from "../resolve/registry.js";
import { benchRemove, craft, item } from "../__fixtures__/ast.js";
import { BENCH_LIFE_ROW, CATALOG, CLASS_RING, RING_BASE } from "../__fixtures__/mods.js";

// A `crafted` affix in the item block is the bench's row: it counts toward the
// crafted limit, named or not.
const registry = buildRegistry({
    bases: [RING_BASE],
    mods: [...CATALOG, BENCH_LIFE_ROW],
    baseAliases: { "Iron Ring": "IronRing" },
    benchCrafts: [{ mod: BENCH_LIFE_ROW.id, tier: 1, itemClasses: new Set([CLASS_RING]) }],
});
const ctx: CheckContext = { registry };

describe("a crafted affix in the item block", () => {
    it("named, is the bench's row and counts as crafted", () => {
        const c = craft(
            item({
                base: "Iron Ring",
                ilvl: 100,
                rarity: "rare",
                prefixes: [{ mod: "maximum life", tier: 1, crafted: true }],
            }),
            [],
        );
        const r = check(c, ctx);
        expect(r.diagnostics).toEqual([]);
        expect(r.finalState!.crafted).toEqual([1, 1]);
        expect(guaranteedTypes(r.finalState!).has(BENCH_LIFE_ROW.type)).toBe(true);
    });

    it("anonymous, is a crafted modifier the bench's removal can take", () => {
        const start = item({
            base: "Iron Ring",
            ilvl: 100,
            rarity: "rare",
            prefixes: [{ mod: "random", crafted: true }],
            suffixes: ["FireResist1"],
        });
        const r = check(craft(start, [benchRemove()]), ctx);
        expect(r.diagnostics).toEqual([]);
        expect(r.finalState!.counts.total).toEqual([1, 1]);
        expect(r.finalState!.crafted).toEqual([0, 0]);
        // A natural random prefix gives the removal nothing it is sure of.
        const natural = item({
            base: "Iron Ring",
            ilvl: 100,
            rarity: "rare",
            prefixes: ["random"],
            suffixes: ["FireResist1"],
        });
        expect(check(craft(natural, [benchRemove()]), ctx).diagnostics[0]!.message).toContain(
            "No crafted modifier is guaranteed",
        );
    });
});
