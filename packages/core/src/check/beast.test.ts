import { describe, expect, it } from "vitest";
import { check, type CheckContext } from "./check.js";
import { guaranteedTypes, hasFracture } from "./astate.js";
import { buildRegistry } from "../resolve/registry.js";
import { beast, craft, item } from "../__fixtures__/ast.js";
import {
    ASPECT_AVIAN,
    ASPECT_CAT,
    CANNOT_ROLL_ATTACK_CARRIER,
    CATALOG,
    COLD_RESIST,
    FIRE_RESIST,
    LIFE_T1,
    MULTIMOD_CARRIER,
    PROTECT_PREFIXES_CARRIER,
    PROTECT_SUFFIXES_CARRIER,
    RING_BASE,
    TALISMAN_BASE,
} from "../__fixtures__/mods.js";
import { TypeId } from "../model/ids.js";

const registry = buildRegistry({
    bases: [RING_BASE, TALISMAN_BASE],
    mods: [
        ...CATALOG,
        PROTECT_PREFIXES_CARRIER,
        PROTECT_SUFFIXES_CARRIER,
        CANNOT_ROLL_ATTACK_CARRIER,
        MULTIMOD_CARRIER,
        ASPECT_CAT,
        ASPECT_AVIAN,
    ],
    aspects: { cat: ASPECT_CAT.id, avian: ASPECT_AVIAN.id },
    modAliases: { "T1 Life": "IncreasedLife1" },
    baseAliases: { "Iron Ring": "IronRing", Talisman: "BlackMawTalisman" },
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

describe("beast fracture", () => {
    const talisman = (mods: number) =>
        item({
            base: "Talisman",
            ilvl: 100,
            rarity: "rare",
            prefixes: Array.from({ length: Math.min(3, mods) }, () => "random"),
            suffixes: Array.from({ length: Math.max(0, mods - 3) }, () => "random"),
        });

    it("fractures one modifier of a Rare talisman with four", () => {
        const r = check(craft(talisman(4), [beast({ kind: "fracture" })]), ctx);
        expect(r.diagnostics).toEqual([]);
        expect(hasFracture(r.finalState!)).toBe(true);
    });

    it("needs a talisman, four modifiers and no fracture yet", () => {
        const ring = check(
            craft(rareRing(["random", "random"], ["random", "random"]), [
                beast({ kind: "fracture" }),
            ]),
            ctx,
        );
        expect(ring.diagnostics[0]!.message).toContain("Needs a talisman");
        const few = check(craft(talisman(3), [beast({ kind: "fracture" })]), ctx);
        expect(few.diagnostics[0]!.message).toContain("at least 4");
        const twice = check(
            craft(talisman(4), [beast({ kind: "fracture" }), beast({ kind: "fracture" })]),
            ctx,
        );
        expect(twice.diagnostics[0]!.message).toContain("already has a fractured");
    });
});

describe("beast metamod", () => {
    it("crafts the one metamod that fits when the suffixes are full", () => {
        const c = craft(rareRing([], [FIRE_RESIST.id, COLD_RESIST.id, "random"]), [
            beast({ kind: "metamod" }),
        ]);
        const r = check(c, ctx);
        expect(r.diagnostics).toEqual([]);
        expect(guaranteedTypes(r.finalState!).has(PROTECT_SUFFIXES_CARRIER.type)).toBe(true);
        expect(r.finalState!.crafted).toEqual([1, 1]);
        expect(r.finalState!.counts.prefix).toEqual([1, 1]);
    });

    it("leaves a disjunction over every fitting metamod on an open item", () => {
        const r = check(craft(rareRing(["T1 Life"]), [beast({ kind: "metamod" })]), ctx);
        expect(r.diagnostics).toEqual([]);
        expect(guaranteedTypes(r.finalState!).has(PROTECT_SUFFIXES_CARRIER.type)).toBe(false);
        expect(r.finalState!.possible.has(MULTIMOD_CARRIER.type)).toBe(true);
        expect(r.finalState!.crafted).toEqual([1, 1]);
        expect(r.finalState!.counts.total).toEqual([2, 2]);
    });

    it("stays within the crafted limit and needs a metamod that fits", () => {
        const capped = check(
            craft(rareRing([], [PROTECT_PREFIXES_CARRIER.id]), [beast({ kind: "metamod" })]),
            ctx,
        );
        expect(capped.diagnostics[0]!.message).toContain("limit");
        const full = check(
            craft(rareRing(["random", "random", "random"], ["random", "random", "random"]), [
                beast({ kind: "metamod" }),
            ]),
            ctx,
        );
        expect(full.diagnostics[0]!.message).toContain("No metamod fits");
    });
});

describe("beast aspect", () => {
    it("crafts the Aspect's suffix into an open slot", () => {
        const r = check(
            craft(rareRing(["T1 Life"]), [beast({ kind: "aspect", name: "cat" })]),
            ctx,
        );
        expect(r.diagnostics).toEqual([]);
        expect(guaranteedTypes(r.finalState!).has(ASPECT_CAT.type)).toBe(true);
        expect(r.finalState!.crafted).toEqual([0, 0]);
    });

    it("allows one skill-granting modifier, needs an open suffix, and knows four animals", () => {
        const two = check(
            craft(rareRing(), [
                beast({ kind: "aspect", name: "cat" }),
                beast({ kind: "aspect", name: "avian" }),
            ]),
            ctx,
        );
        expect(two.diagnostics[0]!.message).toContain("at most one per group");
        const full = check(
            craft(rareRing([], ["random", "random", "random"]), [
                beast({ kind: "aspect", name: "cat" }),
            ]),
            ctx,
        );
        expect(full.diagnostics[0]!.message).toContain("open suffix slot");
        const wolf = check(craft(rareRing(), [beast({ kind: "aspect", name: "wolf" })]), ctx);
        expect(wolf.diagnostics[0]!.message).toContain("Unknown Aspect");
    });
});
