import { describe, expect, it } from "vitest";
import { check, type CheckContext } from "./check.js";
import { suffixRange } from "./astate.js";
import { buildRegistry } from "../resolve/registry.js";
import { andp, cmp, craft, item, op, until } from "../__fixtures__/ast.js";
import { RING_BASE, TIERED_CATALOG } from "../__fixtures__/mods.js";

// The "make room" step of a guide: annul a full rare down to open slots, then
// use them. Both sides are ranges afterwards, so the suffix bound has to be
// kept on its own and the loop has to be allowed several iterations.
const registry = buildRegistry({ bases: [RING_BASE], mods: TIERED_CATALOG });
const ctx: CheckContext = { registry };
const fullRing = () =>
    item({
        base: "IronRing",
        ilvl: 100,
        rarity: "rare",
        prefixes: ["random", "random", "random"],
        suffixes: ["random", "random", "random"],
    });

describe("checker — annulling down to open slots", () => {
    it("keeps the suffix bound when the prefix count is still a range", () => {
        // "Two open prefixes and one open suffix": p ≤ 1 and s ≤ 2 leave at most
        // three affixes, so three exalts fit; the third would be refused if the
        // suffix bound were lost in the join.
        const c = craft(fullRing(), [
            until(andp(cmp("prefixCount", "<=", 1), cmp("suffixCount", "<=", 2)), [op("annul")]),
            op("exalt"),
            op("exalt"),
            op("exalt"),
        ]);
        const r = check(c, ctx);
        expect(r.diagnostics).toEqual([]);
    });

    it("reads the suffix range from the state after a suffix-only refinement", () => {
        // Annulling one at a time from three suffixes, the loop leaves at the first
        // state with one suffix, so exactly one: the bound is kept and exact.
        const c = craft(fullRing(), [until(cmp("suffixCount", "<=", 1), [op("annul")])]);
        const r = check(c, ctx);
        expect(r.diagnostics).toEqual([]);
        expect(suffixRange(r.finalState!)).toEqual([1, 1]);
    });
});
