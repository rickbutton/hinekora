import { describe, expect, it } from "vitest";
import { check, type CheckContext } from "./check.js";
import * as v from "./views.js";
import { buildRegistry } from "../resolve/registry.js";
import { cmp, craft, item, op, until } from "../__fixtures__/ast.js";
import { CATALOG, RING_BASE } from "../__fixtures__/mods.js";

const registry = buildRegistry({ bases: [RING_BASE], mods: CATALOG });
const ctx: CheckContext = { registry };
const ring = item({
    base: "IronRing",
    ilvl: 100,
    rarity: "rare",
    strands: 100,
    prefixes: ["IncreasedLife1"],
});

describe("a loop that settles", () => {
    it("leaves the items its exit allows", () => {
        const r = check(craft(ring, [until(cmp("prefixCount", ">=", 3), [op("exalt")])]), ctx);
        expect(v.counts(r.finalState!).prefix).toEqual([3, 3]);
        expect(v.strandsRange(r.finalState!)[1]).toBe(100);
    });
});
