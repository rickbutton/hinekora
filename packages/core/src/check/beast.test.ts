import { describe, expect, it } from "vitest";
import { check, type CheckContext } from "./check.js";
import { guaranteedTypes } from "./astate.js";
import { buildRegistry } from "../resolve/registry.js";
import { beast, craft, item } from "../__fixtures__/ast.js";
import {
    CATALOG,
    COLD_RESIST,
    FIRE_RESIST,
    LIFE_T1,
    PROTECT_SUFFIXES_CARRIER,
    RING_BASE,
} from "../__fixtures__/mods.js";
import { TypeId } from "../model/ids.js";

const registry = buildRegistry({
    bases: [RING_BASE],
    mods: [...CATALOG, PROTECT_SUFFIXES_CARRIER],
    modAliases: { "T1 Life": "IncreasedLife1" },
    baseAliases: { "Iron Ring": "IronRing" },
});
const ctx: CheckContext = { registry };

const rareRing = (prefixes: string[] = [], suffixes: string[] = [], ilvl = 100) =>
    item({ base: "Iron Ring", ilvl, rarity: "rare", prefixes, suffixes });

const LIFE = TypeId("IncreasedLife");

describe("beast add", () => {
    it("adds on one side and removes a random modifier of the other", () => {
        const c = craft(rareRing(["T1 Life"], [FIRE_RESIST.id, COLD_RESIST.id]), [
            beast({ kind: "add", side: "prefix" }),
        ]);
        const r = check(c, ctx);
        expect(r.diagnostics).toEqual([]);
        const s = r.finalState!;
        expect(s.counts.prefix).toEqual([2, 2]);
        expect(s.counts.total).toEqual([3, 3]);
        expect(guaranteedTypes(s).has(LIFE)).toBe(true);
        expect(guaranteedTypes(s).has(FIRE_RESIST.type)).toBe(false);
    });

    it("adds without removing when the other side is protected", () => {
        const c = craft(rareRing([PROTECT_SUFFIXES_CARRIER.id], [FIRE_RESIST.id]), [
            beast({ kind: "add", side: "prefix" }),
        ]);
        const r = check(c, ctx);
        expect(r.diagnostics).toEqual([]);
        expect(r.finalState!.counts.total).toEqual([3, 3]);
        expect(guaranteedTypes(r.finalState!).has(FIRE_RESIST.type)).toBe(true);
    });

    it("draws the added modifier at the beast's level, not the item's", () => {
        // A level-20 beast cannot add T1 life (level 60); a level-100 beast on a
        // level-20 ring can.
        const low = check(
            craft(rareRing([], [FIRE_RESIST.id]), [
                beast({ kind: "add", side: "prefix", level: 20 }),
            ]),
            ctx,
        );
        expect(low.finalState!.tiers.get(LIFE)).toBeUndefined();
        expect(low.finalState!.possible.has(LIFE)).toBe(false);
        const high = check(
            craft(rareRing([], [FIRE_RESIST.id], 20), [
                beast({ kind: "add", side: "prefix", level: 100 }),
            ]),
            ctx,
        );
        expect(high.finalState!.tiers.get(LIFE)).toEqual(new Set([LIFE_T1.id, "IncreasedLife2"]));
    });

    it("needs an open slot on the added side and a modifier to remove", () => {
        const full = check(
            craft(rareRing(["T1 Life", "random", "random"], [FIRE_RESIST.id]), [
                beast({ kind: "add", side: "prefix" }),
            ]),
            ctx,
        );
        expect(full.diagnostics[0]!.message).toContain("open prefix slot");
        const empty = check(
            craft(rareRing(["T1 Life"]), [beast({ kind: "add", side: "prefix" })]),
            ctx,
        );
        expect(empty.diagnostics[0]!.message).toContain("removable affix");
    });
});
