import { describe, expect, it } from "vitest";
import { check, type CheckContext } from "./check.js";
import { type AItem, join, refine } from "./astate.js";
import { buildRegistry } from "../resolve/registry.js";
import { craft, item, op } from "../__fixtures__/ast.js";
import { CATALOG, COLD_RESIST, LIFE_T1, LIFE_T2, RING_BASE } from "../__fixtures__/mods.js";

const registry = buildRegistry({ bases: [RING_BASE], mods: CATALOG });
const ctx: CheckContext = { registry };

/** The items before and after the one step of a craft, of one check, so they
 *  share what a join needs them to. */
function around(prefixes: string[], step: string): { before: AItem; after: AItem } {
    const start = item({ base: "IronRing", ilvl: 100, rarity: "rare", prefixes });
    const entry = check(craft(start, [op(step)]), ctx).trace.find((e) => e.kind === "operation")!;
    return { before: entry.before, after: entry.after! };
}

describe("the rows a join keeps for a modifier one side cannot hold", () => {
    const life = { kind: "has", type: LIFE_T1.type, gen: "prefix" } as const;

    it("are the other side's, whichever side comes first, where one side excludes it", () => {
        const { after } = around([], "exalt");
        const without = refine(after, life, false)!;
        const pinned = refine(after, { ...life, tierMod: LIFE_T1.id }, true)!;
        expect(without.tiers.has(LIFE_T1.type)).toBe(false);
        const rows = new Set([LIFE_T1.id]);
        expect(join(without, pinned).tiers.get(LIFE_T1.type)).toEqual(rows);
        expect(join(pinned, without).tiers.get(LIFE_T1.type)).toEqual(rows);
    });

    it("are the other side's, whichever side comes first, where one side never had it", () => {
        // Before the Exalted Orb the item holds the one life prefix; a suffix
        // is on the joined item only by way of the orb.
        const { before, after } = around([LIFE_T1.id], "exalt");
        expect(before.possible.has(COLD_RESIST.type)).toBe(false);
        const rows = new Set([COLD_RESIST.id]);
        expect(join(before, after).tiers.get(COLD_RESIST.type)).toEqual(rows);
        expect(join(after, before).tiers.get(COLD_RESIST.type)).toEqual(rows);
    });

    it("are forgotten, whichever side comes first, where the other side may hold it as any row", () => {
        const { after } = around([], "exalt");
        const anyRow: AItem = {
            ...after,
            tiers: new Map([...after.tiers].filter(([t]) => t !== LIFE_T1.type)),
        };
        expect(after.tiers.get(LIFE_T1.type)).toEqual(new Set([LIFE_T1.id, LIFE_T2.id]));
        expect(join(after, anyRow).tiers.has(LIFE_T1.type)).toBe(false);
        expect(join(anyRow, after).tiers.has(LIFE_T1.type)).toBe(false);
    });
});
