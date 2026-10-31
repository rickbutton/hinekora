import { describe, expect, it } from "vitest";
import { check, type CheckContext } from "./check.js";
import {
    disjunctiveGuarantees,
    fracturedTypes,
    guaranteedTypes,
    hasFracture,
    join,
} from "./astate.js";
import { buildRegistry } from "../resolve/registry.js";
import { beast, craft, fracturedP, has, iff, item, op, until } from "../__fixtures__/ast.js";
import {
    ASPECT_AVIAN,
    ASPECT_CAT,
    CANNOT_ROLL_ATTACK_CARRIER,
    CLASS_RING,
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
    benchCrafts: [
        { mod: PROTECT_SUFFIXES_CARRIER.id, tier: 1, itemClasses: new Set([CLASS_RING]) },
    ],
    modAliases: {
        "T1 Life": "IncreasedLife1",
        mana: "IncreasedMana1",
        armour: "IncreasedArmour1",
        cold: "ColdResist1",
    },
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
        // No level named: a beast of any level, so the top tier is possible on a
        // level-20 ring.
        const any = check(
            craft(rareRing([], [FIRE_RESIST.id], 20), [beast({ kind: "add", side: "prefix" })]),
            ctx,
        );
        expect(any.finalState!.tiers.get(LIFE)).toEqual(new Set([LIFE_T1.id, "IncreasedLife2"]));
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

    it("fractures two modifiers of a talisman with six, which a scour leaves Rare", () => {
        const r = check(craft(talisman(6), [beast({ kind: "fracture", n: 2 }), op("scour")]), ctx);
        expect(r.diagnostics).toEqual([]);
        const s = r.finalState!;
        expect(s.fractures).toEqual([2, 2]);
        expect(s.counts.total).toEqual([2, 2]);
        expect(s.rarities).toEqual(new Set(["rare"]));
        const few = check(craft(talisman(5), [beast({ kind: "fracture", n: 2 })]), ctx);
        expect(few.diagnostics[0]!.message).toContain("at least 6");
        expect(
            check(craft(talisman(6), [beast({ kind: "fracture", n: 3 })]), ctx).diagnostics[0]!
                .message,
        ).toContain("fractures one modifier or two");
    });

    it("lets a branch prove both locked modifiers, and no third", () => {
        const named = item({
            base: "Talisman",
            ilvl: 100,
            rarity: "rare",
            prefixes: ["T1 Life", "mana", "armour"],
            suffixes: ["cold", FIRE_RESIST.id, "random"],
        });
        const both = craft(named, [
            beast({ kind: "fracture", n: 2 }),
            iff(fracturedP("T1 Life"), [iff(fracturedP("mana"), [], [])], []),
        ]);
        expect(check(both, ctx).diagnostics).toEqual([]);
        const third = craft(named, [
            beast({ kind: "fracture", n: 2 }),
            iff(
                fracturedP("T1 Life"),
                [iff(fracturedP("mana"), [iff(fracturedP("armour"), [], [])], [])],
                [],
            ),
        ]);
        expect(
            check(third, ctx)
                .diagnostics.map((d) => d.message)
                .join("\n"),
        ).toContain("'if' branch can never run");
    });

    it("refuses an item that may be fractured, so a loop of fractures settles", () => {
        // After a reforge, whether the item has T1 life is unknown, so only one
        // path fractures first.
        const maybe = craft(talisman(4), [
            op("chaos"),
            iff(has("T1 Life"), [beast({ kind: "fracture" })], []),
            beast({ kind: "fracture" }),
        ]);
        const r = check(maybe, ctx);
        expect(r.diagnostics.map((d) => d.message).join("\n")).toContain(
            "already has a fractured modifier",
        );
        expect(r.finalState!.fractures).toEqual([0, 1]);
        const loop = craft(talisman(4), [
            until(fracturedP("T1 Life"), [beast({ kind: "fracture" })]),
        ]);
        const l = check(loop, ctx);
        expect(l.finalState!.fractures[1]).toBeLessThanOrEqual(1);
    });

    it("counts both locks against what an annul may remove", () => {
        const annuls = Array.from({ length: 5 }, () => op("annul"));
        const r = check(craft(talisman(6), [beast({ kind: "fracture", n: 2 }), ...annuls]), ctx);
        const text = r.diagnostics.map((d) => d.message).join("\n");
        expect(r.diagnostics).toHaveLength(1);
        expect(text).toContain("Requires a removable affix");
        expect(r.finalState!.counts.total).toEqual([2, 2]);
    });

    it("joins the count where one path locked two and another one", () => {
        const two = check(craft(talisman(6), [beast({ kind: "fracture", n: 2 })]), ctx).finalState!;
        const one = check(craft(talisman(6), [beast({ kind: "fracture" })]), ctx).finalState!;
        expect(join(two, one).fractures).toEqual([1, 2]);
    });

    it("takes a declared item with two fractured modifiers", () => {
        const declared = item({
            base: "Talisman",
            ilvl: 100,
            rarity: "rare",
            prefixes: [{ mod: "T1 Life", fractured: true }, "mana"],
            suffixes: [{ mod: "cold", fractured: true }],
        });
        const r = check(craft(declared, [op("scour")]), ctx);
        expect(r.diagnostics).toEqual([]);
        expect(r.finalState!.fractures).toEqual([2, 2]);
        expect(r.finalState!.rarities).toEqual(new Set(["rare"]));
        expect(fracturedTypes(r.finalState!).size).toBe(2);
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

    it("keeps every metamod a path may fit: an uncertain side, a possibly present carrier", () => {
        // The exalt may have landed a prefix, leaving a suffix slot on that path,
        // so no suffix metamod is ruled out and the prefix one is not guaranteed.
        const uncertain = check(
            craft(rareRing(["T1 Life"], [FIRE_RESIST.id, COLD_RESIST.id]), [
                op("exalt"),
                beast({ kind: "metamod" }),
            ]),
            ctx,
        );
        expect(uncertain.diagnostics).toEqual([]);
        expect(guaranteedTypes(uncertain.finalState!).has(PROTECT_SUFFIXES_CARRIER.type)).toBe(
            false,
        );
        expect(uncertain.finalState!.possible.has(PROTECT_PREFIXES_CARRIER.type)).toBe(true);
        // A carrier the annul may have removed is still in the pool: on the path
        // where it is gone the game may craft it, so the fill's "one of these"
        // names it beside the suffix metamods that fit on every path.
        const maybe = check(
            craft(
                item({
                    base: "Iron Ring",
                    ilvl: 100,
                    rarity: "rare",
                    prefixes: [PROTECT_SUFFIXES_CARRIER.id, "random"],
                    suffixes: [{ mod: MULTIMOD_CARRIER.id, fractured: true }],
                }),
                [op("annul"), beast({ kind: "metamod" })],
            ),
            ctx,
        );
        expect(maybe.diagnostics).toEqual([]);
        expect(disjunctiveGuarantees(maybe.finalState!).map((c) => new Set(c))).toContainEqual(
            new Set([
                PROTECT_SUFFIXES_CARRIER.type,
                PROTECT_PREFIXES_CARRIER.type,
                CANNOT_ROLL_ATTACK_CARRIER.type,
            ]),
        );
    });

    it("needs a metamod that fits on every path, not only on some", () => {
        // The exalt may have filled the suffixes; on that path the only prefix
        // metamod is already on the item, so nothing can be crafted there.
        const c = craft(
            rareRing([PROTECT_SUFFIXES_CARRIER.id], [MULTIMOD_CARRIER.id, FIRE_RESIST.id]),
            [op("exalt"), beast({ kind: "metamod" })],
        );
        expect(check(c, ctx).diagnostics[0]!.message).toContain("No metamod fits");
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
