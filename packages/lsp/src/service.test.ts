import { describe, expect, it } from "vitest";
import { loadDefaultPoe1, registryOf } from "@hinekora/data";
import { getDiagnostics } from "./service.js";

const registry = registryOf(loadDefaultPoe1());

describe("getDiagnostics — LSP diagnostics from the real pipeline", () => {
    it("returns no diagnostics for a valid craft", () => {
        const diags = getDiagnostics(
            `craft in poe1
item { base: "Iron Ring" ilvl: 84 rarity: normal }
transmute
regal`,
            registry,
        );
        expect(diags).toEqual([]);
    });

    it("reports a precondition failure with a 0-based range and message", () => {
        const diags = getDiagnostics(
            `craft in poe1
item { base: "Iron Ring" ilvl: 84 rarity: magic }
exalt`,
            registry,
        );
        expect(diags).toHaveLength(1);
        const d = diags[0]!;
        // "exalt" is on source line 3 → 0-based line 2, character 0.
        expect(d.range.start).toEqual({ line: 2, character: 0 });
        expect(d.message).toContain("Requires a Rare item");
        expect(d.severity).toBe(1); // Error
        expect(d.source).toBe("hinekora");
    });

    it("reports a parse error as a diagnostic", () => {
        const diags = getDiagnostics(
            `craft in poe1
item { base: "Iron Ring" ilvl: 84 rarity: rare
exalt`,
            registry,
        );
        expect(diags.length).toBeGreaterThan(0);
        expect(diags[0]!.range.end.character).toBeGreaterThan(diags[0]!.range.start.character);
    });

    it("surfaces fuzzy-resolution ambiguity as a diagnostic", () => {
        const diags = getDiagnostics(
            `craft in poe1
item { base: "Iron Ring" ilvl: 84 rarity: rare prefixes: [ "resistance" ] }
exalt`,
            registry,
        );
        expect(diags.some((d) => d.message.includes("Ambiguous"))).toBe(true);
    });
});
