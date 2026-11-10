import { describe, expect, it } from "vitest";
import { check, type CheckContext } from "./check.js";
import { join, stateEqual, widenRanges } from "./astate.js";
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

describe("widening the numeric ranges of a loop's invariant", () => {
    // One round of a loop whose body is an Exalted Orb: the item before it,
    // and the two joined, as the fixpoint iteration sees them.
    const step = check(craft(ring, [op("exalt")]), ctx).trace.find((e) => e.kind === "operation")!;
    const before = step.before;
    const round = join(before, step.after!);

    it("sends a bound that moved to the end of its domain and keeps one that held", () => {
        expect(round.counts.total).toEqual([1, 2]);
        expect(round.strands[0]).toBeLessThan(100);
        const wide = widenRanges(before, round);
        expect(wide.counts.total).toEqual([1, 6]);
        expect(wide.counts.prefix).toEqual([1, 3]);
        expect(wide.counts.suffix).toEqual([0, 3]);
        expect(wide.strands).toEqual([0, 100]);
        expect(wide.crafted).toEqual([0, 0]);
        expect(wide.fractures).toEqual([0, 0]);
    });

    it("is a fixpoint of the round it widened", () => {
        const wide = widenRanges(before, round);
        const again = widenRanges(wide, join(wide, step.after!));
        expect(stateEqual(again, wide)).toBe(true);
    });

    it("driven from the first round, ends, and allows every item the exact invariant does", () => {
        const loop = craft(ring, [until(cmp("prefixCount", ">=", 3), [op("exalt")])]);
        const exact = check(loop, ctx);
        const wide = check(loop, ctx, { widenRangesAfter: 0 });
        const [e, w] = [exact.finalState!, wide.finalState!];
        const pairs = [
            [e.counts.total, w.counts.total],
            [e.counts.prefix, w.counts.prefix],
            [e.counts.suffix, w.counts.suffix],
            [e.strands, w.strands],
            [e.crafted, w.crafted],
        ] as const;
        for (const [narrow, broad] of pairs) {
            expect(broad[0]).toBeLessThanOrEqual(narrow[0]);
            expect(broad[1]).toBeGreaterThanOrEqual(narrow[1]);
        }
        for (const t of e.possible) expect(w.possible.has(t)).toBe(true);
        expect(wide.diagnostics.map((d) => d.message)).toEqual(
            exact.diagnostics.map((d) => d.message),
        );
    });

    it("driven from the first round, still refuses the step a later round refuses", () => {
        const fills = craft(ring, [until(cmp("prefixCount", ">=", 4), [op("exalt")])]);
        const messages = check(fills, ctx, { widenRangesAfter: 0 }).diagnostics.map(
            (d) => d.message,
        );
        expect(messages.length).toBeGreaterThan(0);
    });

    it("leaves a loop that converges on its own exact", () => {
        const r = check(craft(ring, [until(cmp("prefixCount", ">=", 3), [op("exalt")])]), ctx);
        expect(r.finalState!.counts.prefix).toEqual([3, 3]);
        expect(r.finalState!.strands[1]).toBe(100);
    });
});
