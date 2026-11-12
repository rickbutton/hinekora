import { describe, expect, it } from "vitest";
import { check, type CheckContext } from "./check.js";
import { isGuaranteed } from "./views.js";
import { buildRegistry } from "../resolve/registry.js";
import { bench, craft, has, iff, item, op } from "../__fixtures__/ast.js";
import {
    BENCH_LIFE_ROW,
    CATALOG,
    CLASS_RING,
    COLD_RESIST,
    FIRE_RESIST,
    LIFE_T1,
    RING_BASE,
} from "../__fixtures__/mods.js";

const registry = buildRegistry({
    bases: [RING_BASE],
    mods: [...CATALOG, BENCH_LIFE_ROW],
    baseAliases: { "Iron Ring": "IronRing" },
    benchCrafts: [{ mod: BENCH_LIFE_ROW.id, tier: 1, itemClasses: new Set([CLASS_RING]) }],
});
const ctx: CheckContext = { registry };

describe("an add where paths meet", () => {
    it("keeps what a path knew on which the added modifier was excluded", () => {
        // After the exalt the life may or may not be there. Where it is not, an
        // annul may have taken the fire resistance; where it is, the fire is
        // sure. Benching the life afterwards must not make the fire sure.
        const c = craft(
            item({
                base: "Iron Ring",
                ilvl: 100,
                rarity: "rare",
                suffixes: [FIRE_RESIST.id, COLD_RESIST.id],
            }),
            [op("exalt"), iff(has(LIFE_T1.id), [], [op("annul")]), bench("maximum life")],
        );
        const r = check(c, ctx);
        expect(isGuaranteed(r.finalState!, FIRE_RESIST.type)).toBe(false);
        expect(isGuaranteed(r.finalState!, LIFE_T1.type)).toBe(true);
    });
});
