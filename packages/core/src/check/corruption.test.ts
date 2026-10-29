import { describe, expect, it } from "vitest";
import { check, type CheckContext } from "./check.js";
import { guaranteedTypes } from "./astate.js";
import { buildRegistry } from "../resolve/registry.js";
import { corruptedP, craft, iff, influencedP, item, op } from "../__fixtures__/ast.js";
import type { OperationStmt } from "../ast/ast.js";
import {
    CATALOG,
    FLASK_BASE,
    LIFE_T1,
    PROTECT_SUFFIXES_CARRIER,
    RING_BASE,
} from "../__fixtures__/mods.js";
import { influenceKey, INFLUENCES } from "../model/marks.js";

const registry = buildRegistry({
    bases: [RING_BASE, FLASK_BASE],
    mods: [...CATALOG, PROTECT_SUFFIXES_CARRIER],
    modAliases: { life: "IncreasedLife1", cold: "ColdResist1" },
    baseAliases: { "Iron Ring": "IronRing", "Life Flask": "LifeFlask" },
});
const ctx: CheckContext = { registry };

const words = (...ws: string[]): OperationStmt => ({
    kind: "operation",
    words: ws,
    args: [],
    span: { start: { offset: 0, line: 1, column: 1 }, end: { offset: 0, line: 1, column: 1 } },
});
const run = (c: ReturnType<typeof craft>) => check(c, ctx);
const messages = (c: ReturnType<typeof craft>) =>
    run(c)
        .diagnostics.map((d) => d.message)
        .join("\n");

const ring = (extra: Partial<Parameters<typeof item>[0]> = {}) =>
    item({ base: "Iron Ring", ilvl: 100, rarity: "rare", ...extra });

describe("the Vaal Orb", () => {
    it("corrupts the item and leaves it as it was or a Rare with six modifiers", () => {
        const magic = item({ base: "Iron Ring", ilvl: 100, rarity: "magic", prefixes: ["life"] });
        const r = run(craft(magic, [op("vaal")]));
        expect(r.diagnostics).toEqual([]);
        const s = r.finalState!;
        expect(s.corrupted).toEqual(new Set([true]));
        expect(s.rarities).toEqual(new Set(["magic", "rare"]));
        expect(s.counts.total).toEqual([1, 6]);
        expect(guaranteedTypes(s).has(LIFE_T1.type)).toBe(false);
    });

    it("ends every ordinary craft afterwards, and `corrupted` then always holds", () => {
        expect(messages(craft(ring(), [op("vaal"), op("exalt")]))).toContain(
            "The item is corrupted",
        );
        expect(
            messages(craft(ring(), [op("vaal"), iff(corruptedP(), [], [op("vaal")])])),
        ).toContain("'else' branch can never run");
        expect(messages(craft(ring({ corrupted: true }), [op("vaal")]))).toContain(
            "The item is corrupted",
        );
    });

    it("only corrupts a base that cannot be Rare", () => {
        const flask = item({ base: "Life Flask", ilvl: 100, rarity: "magic" });
        const r = run(craft(flask, [op("vaal")]));
        expect(r.diagnostics).toEqual([]);
        expect(r.finalState!.rarities).toEqual(new Set(["magic"]));
        expect(r.finalState!.corrupted).toEqual(new Set([true]));
    });
});

describe("the Corruption Altar", () => {
    it("may make an influenced Rare, or destroy the item", () => {
        const r = run(craft(ring(), [op("locus")]));
        expect(r.diagnostics).toEqual([]);
        const s = r.finalState!;
        expect(s.corrupted).toEqual(new Set([true]));
        expect(s.influences).toEqual(
            new Set([influenceKey([]), ...INFLUENCES.map((i) => influenceKey([i]))]),
        );
        // Both arms are reachable: the item kept its state or was reforged with an influence.
        expect(messages(craft(ring(), [op("locus"), iff(influencedP(), [], [])]))).not.toContain(
            "never run",
        );
    });
});

describe("the Tainted currency", () => {
    const corruptedRing = ring({ corrupted: true, prefixes: ["life"], suffixes: ["cold"] });

    it("needs a corrupted item", () => {
        expect(messages(craft(ring(), [words("tainted", "chaos")]))).toContain(
            "A Tainted Chaos Orb needs a corrupted item — this item is not corrupted",
        );
    });

    it("chaos: reforges, or strips to the rarity the survivors allow", () => {
        const r = run(craft(corruptedRing, [words("tainted", "chaos")]));
        expect(r.diagnostics).toEqual([]);
        expect(r.finalState!.rarities).toEqual(new Set(["normal", "rare"]));
        expect(r.finalState!.counts.total).toEqual([0, 6]);
    });

    it("exalt: adds a modifier or removes one", () => {
        const r = run(craft(corruptedRing, [words("tainted", "exalt")]));
        expect(r.diagnostics).toEqual([]);
        expect(r.finalState!.counts.total).toEqual([1, 3]);
        expect(guaranteedTypes(r.finalState!).has(LIFE_T1.type)).toBe(false);
    });

    it("divine: forgets every tier but a crafted modifier's", () => {
        const benched = ring({ corrupted: true, prefixes: ["life", PROTECT_SUFFIXES_CARRIER.id] });
        const before = run(craft(benched, [])).finalState!;
        expect(before.tiers.get(LIFE_T1.type)).toBeDefined();
        const r = run(craft(benched, [words("tainted", "divine")]));
        expect(r.diagnostics).toEqual([]);
        expect(r.finalState!.tiers.has(LIFE_T1.type)).toBe(false);
        expect(r.finalState!.tiers.get(PROTECT_SUFFIXES_CARRIER.type)).toEqual(
            new Set([PROTECT_SUFFIXES_CARRIER.id]),
        );
    });
});
