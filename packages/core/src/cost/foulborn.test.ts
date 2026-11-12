import { describe, expect, it } from "vitest";
import { CATALOG, RING_BASE, SEVEN_TIER_ROWS } from "../__fixtures__/mods.js";
import { craft, item } from "../__fixtures__/ast.js";
import { checkPresent } from "../check/check.js";
import { currencyOps, foulbornOps } from "../check/library.js";
import type { Op } from "../check/ops.js";
import { buildRegistry } from "../resolve/registry.js";
import { rollOf } from "./roll.js";

const registry = buildRegistry({
    bases: [RING_BASE],
    mods: [...CATALOG, ...SEVEN_TIER_ROWS],
    baseAliases: { "Iron Ring": "IronRing" },
});

/** The seven-tier modifier's rows an orb may lay down on a ring holding `strands`. */
function tiers(strands: number, ops: readonly Op[]): string[] {
    const c = craft(item({ base: "Iron Ring", ilvl: 100, rarity: "rare", strands }), []);
    const roll = rollOf(checkPresent(c, { registry }).finalState!, ops, registry);
    if (roll.kind !== "draw") throw new Error("not a draw");
    const v = roll.variants[0]!;
    return [...v.prefix, ...v.suffix]
        .flatMap((g) => g.members)
        .filter((m) => m.type === "SevenTier")
        .flatMap((m) => m.rows.map((r) => r.mod.id))
        .sort();
}

describe("a Foulborn orb's pool on an item with memory strands", () => {
    it("is one cut at thirty more strands, as the checker reads it, not two cuts", () => {
        // Seven tiers at 13 strands: the strands alone keep four, of which the
        // orb's own cut after them would keep two; 43 strands keep three.
        expect(tiers(13, currencyOps("exalt"))).toEqual([
            "SevenTier4",
            "SevenTier5",
            "SevenTier6",
            "SevenTier7",
        ]);
        expect(tiers(13, foulbornOps("exalt"))).toEqual(["SevenTier5", "SevenTier6", "SevenTier7"]);
    });

    it("is the orb's own cut on an item with none", () => {
        expect(tiers(0, foulbornOps("exalt"))).toEqual([
            "SevenTier4",
            "SevenTier5",
            "SevenTier6",
            "SevenTier7",
        ]);
    });
});
