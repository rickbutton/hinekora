import { describe, expect, it } from "vitest";
import { check, type CheckContext } from "./check.js";
import { disjunctiveGuarantees, guaranteedTypes } from "./astate.js";
import { buildRegistry } from "../resolve/registry.js";
import { craft, item, op } from "../__fixtures__/ast.js";
import {
    BOOTS_BASE,
    CATALOG,
    ELEVATED_BOOTS_PREFIX,
    HUNTER_BOOTS_PREFIX,
    HUNTER_BOOTS_SUFFIX,
    LIFE_T1,
    PROTECT_SUFFIXES_CARRIER,
    RING_BASE,
} from "../__fixtures__/mods.js";

const registry = buildRegistry({
    bases: [RING_BASE, BOOTS_BASE],
    mods: [
        ...CATALOG,
        HUNTER_BOOTS_PREFIX,
        HUNTER_BOOTS_SUFFIX,
        ELEVATED_BOOTS_PREFIX,
        PROTECT_SUFFIXES_CARRIER,
    ],
    modAliases: { life: "IncreasedLife1" },
    baseAliases: { "Iron Ring": "IronRing" },
});
const ctx: CheckContext = { registry };
const run = (c: ReturnType<typeof craft>) => check(c, ctx);
const messages = (c: ReturnType<typeof craft>) =>
    run(c)
        .diagnostics.map((d) => d.message)
        .join("\n");

const boots = (prefixes: string[], suffixes: string[] = []) =>
    item({
        base: "Iron Greaves",
        ilvl: 100,
        rarity: "rare",
        prefixes,
        suffixes,
        influences: ["hunter"],
    });

describe("the Orb of Dominance", () => {
    it("removes one influenced modifier and may elevate another; the rest stay", () => {
        const r = run(
            craft(boots([HUNTER_BOOTS_PREFIX.id, "life"], [HUNTER_BOOTS_SUFFIX.id]), [
                op("dominance"),
            ]),
        );
        expect(r.diagnostics).toEqual([]);
        const s = r.finalState!;
        expect(s.counts.total).toEqual([2, 2]);
        expect(guaranteedTypes(s).has(LIFE_T1.type)).toBe(true);
        expect(guaranteedTypes(s).has(HUNTER_BOOTS_PREFIX.type)).toBe(false);
        expect(s.possible.has(ELEVATED_BOOTS_PREFIX.type)).toBe(true);
        expect(s.tiers.get(ELEVATED_BOOTS_PREFIX.type)).toEqual(
            new Set([ELEVATED_BOOTS_PREFIX.id]),
        );
        expect(s.tiers.has(HUNTER_BOOTS_PREFIX.type)).toBe(false);
        // One influenced modifier remains: the kept one, plain or elevated.
        const one = disjunctiveGuarantees(s).find((clause) =>
            clause.includes(HUNTER_BOOTS_SUFFIX.type),
        );
        expect(one).toBeDefined();
        expect(one).toEqual(
            expect.arrayContaining([
                HUNTER_BOOTS_PREFIX.type,
                ELEVATED_BOOTS_PREFIX.type,
                HUNTER_BOOTS_SUFFIX.type,
            ]),
        );
    });

    it("needs two influenced modifiers on sides a metamod does not protect", () => {
        expect(
            messages(craft(boots([HUNTER_BOOTS_PREFIX.id, "life"]), [op("dominance")])),
        ).toContain(
            "needs 2 influenced modifiers on sides a metamod does not protect — only one is guaranteed",
        );
        const guarded = boots(
            [HUNTER_BOOTS_PREFIX.id, PROTECT_SUFFIXES_CARRIER.id],
            [HUNTER_BOOTS_SUFFIX.id],
        );
        expect(messages(craft(guarded, [op("dominance")]))).toContain("only one is guaranteed");
    });

    it("takes the four armour classes only", () => {
        const ring = item({ base: "Iron Ring", ilvl: 100, rarity: "rare", influences: ["hunter"] });
        expect(messages(craft(ring, [op("dominance")]))).toContain(
            "Needs a body armour, boots, gloves or helmet",
        );
    });
});
