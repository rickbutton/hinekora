import { describe, expect, it } from "vitest";
import { check, type CheckContext } from "./check.js";
import { guaranteedTypes, isExcluded } from "./astate.js";
import { buildRegistry } from "../resolve/registry.js";
import { craft, has, iff, item, notp, op, stop, until } from "../__fixtures__/ast.js";
import { CATALOG, FIRE_RESIST, LIFE_T1, RING_BASE } from "../__fixtures__/mods.js";

const registry = buildRegistry({
    bases: [RING_BASE],
    mods: CATALOG,
    baseAliases: { "Iron Ring": "IronRing" },
});
const ctx: CheckContext = { registry };
const ring = (prefixes: string[] = [], suffixes: string[] = []) =>
    item({ base: "Iron Ring", ilvl: 100, rarity: "rare", prefixes, suffixes });

describe("stop ends the craft on a path", () => {
    it("keeps only the paths that continue", () => {
        // The annul may take the life; the guide stops there, so afterwards the
        // life is sure.
        const c = craft(ring([LIFE_T1.id], [FIRE_RESIST.id]), [
            op("annul"),
            iff(notp(has(LIFE_T1.id)), [stop()]),
        ]);
        const r = check(c, ctx);
        expect(r.diagnostics).toEqual([]);
        expect(guaranteedTypes(r.finalState!).has(LIFE_T1.type)).toBe(true);
    });

    it("inside a loop, a stopped path is neither a back-edge nor an exit", () => {
        const c = craft(ring([LIFE_T1.id], [FIRE_RESIST.id]), [
            until(notp(has(FIRE_RESIST.id)), [op("annul"), iff(notp(has(LIFE_T1.id)), [stop()])]),
        ]);
        const r = check(c, ctx);
        expect(r.diagnostics).toEqual([]);
        const s = r.finalState!;
        expect(guaranteedTypes(s).has(LIFE_T1.type)).toBe(true);
        expect(isExcluded(s, FIRE_RESIST.type)).toBe(true);
    });

    it("a craft whose every path stops has no final item", () => {
        const c = craft(ring([LIFE_T1.id]), [
            op("exalt"),
            iff(has(FIRE_RESIST.id), [stop()], [stop()]),
        ]);
        const r = check(c, ctx);
        expect(r.diagnostics).toEqual([]);
        expect(r.finalState).toBeUndefined();
    });
});
