import { describe, expect, it } from "vitest";
import { check, type CheckContext } from "./check.js";
import * as v from "./views.js";
import { buildRegistry } from "../resolve/registry.js";
import { corruptedP, craft, has, iff, influencedP, item, op, until } from "../__fixtures__/ast.js";
import { CATALOG, HUNTER_RING_SUFFIX, RING_BASE } from "../__fixtures__/mods.js";
import { rowIds } from "../__fixtures__/views.js";

const registry = buildRegistry({
    bases: [RING_BASE],
    mods: CATALOG,
    modAliases: {
        life: "IncreasedLife1",
        mana: "IncreasedMana1",
        armour: "IncreasedArmour1",
        cold: "ColdResist1",
    },
    baseAliases: { "Iron Ring": "IronRing" },
});
const ctx: CheckContext = { registry };

const ring = (extra: { influences?: ("hunter" | "shaper")[]; corrupted?: boolean } = {}) =>
    item({ base: "Iron Ring", ilvl: 100, rarity: "rare", ...extra });

const messages = (c: ReturnType<typeof craft>) => check(c, ctx).diagnostics.map((d) => d.message);

describe("influence", () => {
    it("widens the pool with the influence's rows, and only then", () => {
        const influenced = check(craft(ring({ influences: ["hunter"] }), [op("chaos")]), ctx);
        expect(influenced.diagnostics).toEqual([]);
        expect(v.possibleTypes(influenced.finalState!).has(HUNTER_RING_SUFFIX.type)).toBe(true);

        const plain = check(craft(ring(), [op("chaos")]), ctx);
        expect(v.possibleTypes(plain.finalState!).has(HUNTER_RING_SUFFIX.type)).toBe(false);
        const other = check(craft(ring({ influences: ["shaper"] }), [op("chaos")]), ctx);
        expect(v.possibleTypes(other.finalState!).has(HUNTER_RING_SUFFIX.type)).toBe(false);
    });

    it("makes an until on an influence modifier reachable", () => {
        const loop = [until(has("Hunter ring suffix"), [op("chaos")])];
        expect(messages(craft(ring({ influences: ["hunter"] }), loop))).toEqual([]);
        expect(messages(craft(ring(), loop)).join("\n")).toMatch(/never/);
    });

    it("resolves and tiers an influence modifier on the declared item and in `has`", () => {
        const declared = item({
            base: "Iron Ring",
            ilvl: 100,
            rarity: "rare",
            suffixes: [{ mod: "Hunter ring suffix", tier: 1 }],
            influences: ["hunter"],
        });
        expect(check(craft(declared, [op("exalt")]), ctx).diagnostics).toEqual([]);
        const hunter = item({
            base: "Iron Ring",
            ilvl: 100,
            rarity: "rare",
            influences: ["hunter"],
        });
        const r = check(craft(hunter, [until(has("Hunter ring suffix", 1), [op("chaos")])]), ctx);
        expect(r.diagnostics).toEqual([]);
        expect(rowIds(r.finalState!, HUNTER_RING_SUFFIX.type)).toEqual(
            new Set([HUNTER_RING_SUFFIX.id]),
        );
        const plain = item({
            base: "Iron Ring",
            ilvl: 100,
            rarity: "rare",
            suffixes: [{ mod: "Hunter ring suffix", tier: 1 }],
        });
        expect(messages(craft(plain, [])).join("\n")).toMatch(/cannot roll on this item/);
    });

    it("reads a two-influence item as both, for `influenced` and for a fracture", () => {
        const both = item({
            base: "Iron Ring",
            ilvl: 100,
            rarity: "rare",
            prefixes: ["life", "mana", "armour"],
            suffixes: ["cold"],
            influences: ["shaper", "elder"],
        });
        const r = check(
            craft(both, [iff(influencedP("shaper"), [op("fracture")], [op("chaos")])]),
            ctx,
        );
        const text = r.diagnostics.map((d) => d.message).join("\n");
        expect(text).toContain("'else' branch can never run");
        expect(text).toContain("this item has Shaper and Elder");
    });

    it("refuses a fracture on an influenced item", () => {
        const four = item({
            base: "Iron Ring",
            ilvl: 100,
            rarity: "rare",
            prefixes: ["life", "mana", "armour"],
            suffixes: ["cold"],
            influences: ["hunter"],
        });
        expect(messages(craft(four, [op("fracture")])).join("\n")).toContain(
            "cannot be used on an influenced item — this item has Hunter",
        );
    });

    it("rejects a declared fracture on an influenced item", () => {
        const declared = item({
            base: "Iron Ring",
            ilvl: 100,
            rarity: "rare",
            suffixes: [{ mod: "cold", fractured: true }],
            influences: ["hunter"],
        });
        expect(messages(craft(declared, [])).join("\n")).toContain("cannot have a fractured");
    });

    it("narrows by `influenced`, naming an influence or not", () => {
        const hunter = craft(ring({ influences: ["hunter"] }), [
            iff(influencedP("hunter"), [op("chaos")], [op("chaos")]),
        ]);
        expect(messages(hunter).join("\n")).toContain("'else' branch can never run");
        const any = craft(ring(), [iff(influencedP(), [op("chaos")], [op("chaos")])]);
        expect(messages(any).join("\n")).toContain("'if' branch can never run");
    });
});

describe("corruption", () => {
    it("refuses every craft on a corrupted item", () => {
        expect(messages(craft(ring({ corrupted: true }), [op("exalt")])).join("\n")).toContain(
            "The item is corrupted — a corrupted item takes only the Tainted currency",
        );
    });

    it("narrows by `corrupted`", () => {
        const c = craft(ring(), [iff(corruptedP(), [op("chaos")], [op("chaos")])]);
        expect(messages(c).join("\n")).toContain("'if' branch can never run");
    });
});
