import { describe, expect, it } from "vitest";
import { itemDelta, itemView, stepDelta, walkthrough } from "@hinekora/core";
import { loadDefaultPoe1, registryOf } from "@hinekora/data";
import { checkCached, parseCached } from "./analysis.js";

const registry = registryOf(loadDefaultPoe1());

/** The walkthrough of a guide, which must parse. */
const walk = (source: string) => {
    const parsed = parseCached(source);
    if (!parsed.ok) throw new Error(parsed.error.message);
    return walkthrough(parsed.craft, checkCached(source, registry)!, registry);
};

describe("the walkthrough", () => {
    it("starts with the declared item and lists one step per statement with its states", () => {
        const w = walk(`item { base: "Iron Ring" ilvl: 84 rarity: normal }\ntransmute\nregal`);
        expect(itemView(w.start.item!, registry).rarities).toEqual(["normal"]);
        expect(w.steps.map((s) => s.kind)).toEqual(["operation", "operation"]);
        const regal = w.steps[1]!;
        if (regal.kind !== "operation") throw new Error("expected an operation");
        expect(regal.title).toBe("Regal Orb");
        expect(regal.text).toBe("regal");
        expect(regal.detail).toMatch(/^Upgrades a magic item/);
        expect(regal.key).toBe("regal");
        expect(itemView(regal.before!, registry).rarities).toEqual(["magic"]);
        expect(itemView(regal.after!, registry).rarities).toEqual(["rare"]);
        expect(regal.problems).toEqual([]);
    });

    it("nests a loop's body and words its exit, and a branch's arms", () => {
        const w = walk(`item { base: "Iron Ring" ilvl: 84 rarity: rare }
until has "maximum life" t1 or has "fire resistance" t1 {
    chaos
    if not has "maximum life" { annul } else { restart }
}`);
        const loop = w.steps[0]!;
        if (loop.kind !== "loop") throw new Error("expected a loop");
        expect(loop.condition).toBe('(has "maximum life" t1 or has "fire resistance" t1)');
        expect(loop.body.map((s) => s.kind)).toEqual(["operation", "branch"]);
        const branch = loop.body[1]!;
        if (branch.kind !== "branch") throw new Error("expected a branch");
        expect(branch.condition).toBe('not has "maximum life"');
        expect(branch.then.map((s) => s.kind)).toEqual(["operation"]);
        expect(branch.else?.map((s) => s.kind)).toEqual(["restart"]);
        // The loop's after-state is the proven exit; the restart has none.
        expect(loop.after).toBeDefined();
        expect(branch.else![0]!.after).toBeUndefined();
    });

    it("gives a finding to the innermost statement that contains it", () => {
        const w = walk(`item { base: "Iron Ring" ilvl: 84 rarity: rare }
until has "maximum life" {
    chaos
    exalt
}`);
        const loop = w.steps[0]!;
        if (loop.kind !== "loop") throw new Error("expected a loop");
        expect(loop.problems).toEqual([]);
        expect(loop.body[1]!.problems.some((m) => m.includes("open affix slot"))).toBe(true);
    });

    it("words a call and a method with arguments as written", () => {
        const w = walk(`item { base: "Iron Ring" ilvl: 84 rarity: rare }
def spam(m) { until has m { chaos } }
spam("maximum life")
bench "cold resistance"`);
        const call = w.steps[0]!;
        expect(call.kind === "call" && call.text).toBe('spam("maximum life")');
        const bench = w.steps[1]!;
        if (bench.kind !== "operation") throw new Error("expected an operation");
        expect(bench.text).toBe('bench "cold resistance"');
        expect(bench.title).toBe("bench");
        expect(bench.detail).toContain("craft a modifier at the bench");
    });

    it("tells what a step added and removed", () => {
        const w = walk(`item { base: "Iron Ring" ilvl: 84 rarity: normal }\ntransmute\nregal`);
        const d = stepDelta(w.steps[1]!, registry)!;
        expect(d.added).toContain("Rare");
        expect(d.removed).toContain("Magic");
        const v = itemView(w.start.item!, registry);
        expect(itemDelta(v, v)).toEqual({ added: [], removed: [] });
    });
});
