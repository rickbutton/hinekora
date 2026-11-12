import { describe, expect, it } from "vitest";
import { check, type CheckContext } from "./check.js";
import { guaranteedTypes, isExcluded } from "./views.js";
import { buildRegistry } from "../resolve/registry.js";
import { craft, has, iff, item, notp, op, restart, stop, until } from "../__fixtures__/ast.js";
import { CATALOG, FIRE_RESIST, LIFE_T1, RING_BASE } from "../__fixtures__/mods.js";

const registry = buildRegistry({
    bases: [RING_BASE],
    mods: CATALOG,
    baseAliases: { "Iron Ring": "IronRing" },
});
const ctx: CheckContext = { registry };
const ring = (prefixes: string[] = [], suffixes: string[] = []) =>
    item({ base: "Iron Ring", ilvl: 100, rarity: "rare", prefixes, suffixes });

describe("stop ends the craft for an item", () => {
    it("keeps only the items that continue", () => {
        // The annul may take the life; the craft stops there, so afterwards the
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

    it("a craft that stops for every item has no final item", () => {
        const c = craft(ring([LIFE_T1.id]), [
            op("exalt"),
            iff(has(FIRE_RESIST.id), [stop()], [stop()]),
        ]);
        const r = check(c, ctx);
        expect(r.diagnostics).toEqual([]);
        expect(r.finalState).toBeUndefined();
    });
});

describe("a step written where no path reaches it", () => {
    const messages = (body: Parameters<typeof craft>[1]): string[] =>
        check(craft(ring([LIFE_T1.id]), body), ctx).diagnostics.map((d) => d.message);

    it("is reported after a stop, once for the steps that follow", () => {
        expect(messages([op("exalt"), stop(), op("exalt"), op("exalt")])).toEqual([
            "this step can never run: the craft always stops before it",
        ]);
    });

    it("is reported after a branch whose arms both stop", () => {
        expect(
            messages([op("exalt"), iff(has(FIRE_RESIST.id), [stop()], [stop()]), op("exalt")]),
        ).toEqual(["this step can never run: the craft always stops before it"]);
    });

    it("is reported after a restart in a loop body", () => {
        expect(
            messages([until(has(FIRE_RESIST.id), [op("chaos"), restart(), op("exalt")])]),
        ).toEqual(["this step can never run: the loop always restarts before it"]);
    });

    it("names both ends after a branch that restarts on one arm and stops on the other", () => {
        expect(
            messages([
                until(has(FIRE_RESIST.id), [
                    op("chaos"),
                    iff(has(LIFE_T1.id), [restart()], [stop()]),
                    op("exalt"),
                ]),
            ]),
        ).toEqual([
            "this step can never run: the craft always stops or the loop restarts before it",
        ]);
    });

    it("says the craft stops for a restart outside every loop", () => {
        expect(messages([restart(), op("exalt")])).toEqual([
            "this step can never run: the craft always stops before it",
        ]);
    });
});
