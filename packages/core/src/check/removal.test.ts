import { describe, expect, it } from "vitest";
import { type CheckContext } from "./check.js";
import { check } from "../exact/check.js";
import * as v from "../exact/views.js";
import { cardinalityGuarantees, guaranteedTypes, isExcluded } from "../exact/views.js";
import { buildRegistry } from "../resolve/registry.js";
import { craft, has, iff, item, notp, op, stop } from "../__fixtures__/ast.js";
import { CATALOG, COLD_RESIST, FIRE_RESIST, LIFE_T1, RING_BASE } from "../__fixtures__/mods.js";

const registry = buildRegistry({
    bases: [RING_BASE],
    mods: CATALOG,
    baseAliases: { "Iron Ring": "IronRing" },
});
const ctx: CheckContext = { registry };
const ring = (prefixes: string[] = [], suffixes: string[] = []) =>
    item({ base: "Iron Ring", ilvl: 100, rarity: "rare", prefixes, suffixes });

describe("a random removal and the modifiers it could reach", () => {
    it("leaves all but one of the named modifiers", () => {
        const r = check(
            craft(ring([LIFE_T1.id], [FIRE_RESIST.id, COLD_RESIST.id]), [op("annul")]),
            ctx,
        );
        expect(r.diagnostics).toEqual([]);
        const s = r.finalState!;
        expect(guaranteedTypes(s).size).toBe(0);
        const [two, ...rest] = cardinalityGuarantees(s);
        expect(rest).toEqual([]);
        expect(two?.atLeast).toBe(2);
        expect(new Set(two?.types)).toEqual(
            new Set([LIFE_T1.type, FIRE_RESIST.type, COLD_RESIST.type]),
        );
    });

    it("may have taken an unnamed modifier, so a named one beside it is neither sure nor gone", () => {
        // The Exalted Orb's modifier is of either side: the sides' most together
        // exceed what the item holds, which is what the removal counts by.
        const r = check(craft(ring([LIFE_T1.id]), [op("exalt"), op("annul")]), ctx);
        expect(r.diagnostics).toEqual([]);
        const s = r.finalState!;
        expect(v.counts(s).total).toEqual([1, 1]);
        expect(guaranteedTypes(s).has(LIFE_T1.type)).toBe(false);
        expect(isExcluded(s, LIFE_T1.type)).toBe(false);
    });

    it("took one of them when it could reach nothing else", () => {
        // Two modifiers, both named: the one still there says which one went.
        const c = craft(ring([LIFE_T1.id], [FIRE_RESIST.id]), [
            op("annul"),
            iff(notp(has(LIFE_T1.id)), [stop()]),
        ]);
        const r = check(c, ctx);
        expect(r.diagnostics).toEqual([]);
        const s = r.finalState!;
        expect(guaranteedTypes(s).has(LIFE_T1.type)).toBe(true);
        expect(isExcluded(s, FIRE_RESIST.type)).toBe(true);
    });

    it("may have taken an unnamed modifier instead", () => {
        const c = craft(ring([LIFE_T1.id, "random"], [FIRE_RESIST.id]), [
            op("annul"),
            iff(notp(has(LIFE_T1.id)), [stop()]),
        ]);
        const s = check(c, ctx).finalState!;
        expect(guaranteedTypes(s).has(LIFE_T1.type)).toBe(true);
        expect(isExcluded(s, FIRE_RESIST.type)).toBe(false);
    });
});
