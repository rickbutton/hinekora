import { describe, expect, it } from "vitest";
import { check, type CheckContext } from "./check.js";
import { buildRegistry } from "../resolve/registry.js";
import { bench, craft, has, iff, item, op } from "../__fixtures__/ast.js";
import { BENCH_LIFE_ROW, CATALOG, CLASS_RING, RING_BASE } from "../__fixtures__/mods.js";

// A declared `"random"` affix is some modifier of its side the item could
// roll: the checker must neither rule it out nor let a clashing craft through.
const registry = buildRegistry({
    bases: [RING_BASE],
    mods: [...CATALOG, BENCH_LIFE_ROW],
    baseAliases: { "Iron Ring": "IronRing" },
    benchCrafts: [{ mod: BENCH_LIFE_ROW.id, tier: 1, itemClasses: new Set([CLASS_RING]) }],
});
const ctx: CheckContext = { registry };
const ring = (prefixes: string[], suffixes: string[] = []) =>
    item({ base: "Iron Ring", ilvl: 100, rarity: "rare", prefixes, suffixes });
const messages = (c: ReturnType<typeof craft>): string[] =>
    check(c, ctx).diagnostics.map((d) => d.message);

describe("a declared random affix", () => {
    it("may be the modifier a branch asks about", () => {
        expect(
            messages(craft(ring(["random"]), [iff(has("maximum life"), [op("exalt")])])),
        ).toEqual([]);
    });

    it("may clash with a bench craft of its group", () => {
        expect(messages(craft(ring(["random"]), [bench("maximum life")]))).toEqual([
            expect.stringContaining("may already carry"),
        ]);
    });

    it("is a modifier of its own side only", () => {
        // Life is a prefix; a lone random suffix cannot be it.
        expect(
            messages(craft(ring([], ["random"]), [iff(has("maximum life"), [op("exalt")])])),
        ).toEqual([expect.stringContaining("can never run")]);
    });
});
