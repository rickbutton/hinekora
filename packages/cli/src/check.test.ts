import { describe, expect, it } from "vitest";
import { loadDefaultPoe1, registryOf } from "@hinekora/data";
import { checkSource } from "./check.js";

// Built once against the real bundled catalog — the CLI's actual data path.
const registry = registryOf(loadDefaultPoe1());
const run = (src: string) => checkSource(src, "test.craft", registry);

describe("checkSource — end to end against real data", () => {
    it("passes a valid craft and reports the final item", () => {
        const r = run(`craft in poe1
item { base: "Iron Ring" ilvl: 84 rarity: normal }
transmute
regal`);
        expect(r.ok).toBe(true);
        expect(r.output).toContain("checks");
        expect(r.output).toContain("Iron Ring · Rare");
    });

    it("rejects a precondition failure with a located, carated error", () => {
        const r = run(`craft in poe1
item { base: "Iron Ring" ilvl: 84 rarity: magic }
exalt`);
        expect(r.ok).toBe(false);
        expect(r.output).toContain("test.craft:3:1: error:");
        expect(r.output).toContain("Requires a Rare item");
        expect(r.output).toContain("^"); // source caret
        expect(r.output).toContain("✗ 1 error");
    });

    it("reports a parse error with location", () => {
        const r = run(`craft in poe1
item { base: "Iron Ring" ilvl: 84 rarity: rare
exalt`);
        expect(r.ok).toBe(false);
        expect(r.output).toMatch(/test\.craft:\d+:\d+: error:/);
    });

    it("resolves fuzzy stat names (with a declared tier) in a real craft", () => {
        const r = run(`craft in poe1
item { base: "Iron Ring" ilvl: 84 rarity: rare prefixes: [ "maximum life" t1 ] }
exalt`);
        expect(r.ok).toBe(true);
    });

    it("rejects a declared mod with no tier", () => {
        const r = run(`craft in poe1
item { base: "Iron Ring" ilvl: 84 rarity: rare prefixes: [ "maximum life" ] }
exalt`);
        expect(r.ok).toBe(false);
        expect(r.output).toContain("declare the tier");
    });
});
