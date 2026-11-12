import { describe, expect, it } from "vitest";
import { check, type CheckContext } from "./check.js";
import * as v from "./views.js";
import { buildRegistry } from "../resolve/registry.js";
import { bench, cmp, craft, iff, item, notp, op, stop } from "../__fixtures__/ast.js";
import {
    BENCH_LIFE_ROW,
    CATALOG,
    CLASS_RING,
    INCREASED_ARMOUR,
    INCREASED_MANA,
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

describe("a side the named modifiers fill", () => {
    it("carries no other modifier once a count proves it full", () => {
        // The exalt may have rolled a second prefix; where the craft goes on,
        // the life is alone on that side, so the others are gone for good.
        const c = craft(
            item({ base: "Iron Ring", ilvl: 100, rarity: "rare", prefixes: [LIFE_T1.id] }),
            [op("exalt"), iff(notp(cmp("prefixCount", "==", 1)), [stop()])],
        );
        const r = check(c, ctx);
        expect(r.diagnostics).toEqual([]);
        const possible = v.possibleTypes(r.finalState!);
        expect(possible.has(LIFE_T1.type)).toBe(true);
        expect(possible.has(INCREASED_MANA.type)).toBe(false);
        expect(possible.has(INCREASED_ARMOUR.type)).toBe(false);
    });

    it("lets a later bench craft of a group a reforge might have rolled through", () => {
        const c = craft(
            item({ base: "Iron Ring", ilvl: 100, rarity: "rare", prefixes: [INCREASED_MANA.id] }),
            [op("exalt"), iff(notp(cmp("prefixCount", "==", 1)), [stop()]), bench("maximum life")],
        );
        expect(check(c, ctx).diagnostics).toEqual([]);
    });
});
