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

    it("catches the reduced affix cap on a real Simplex Amulet (full after a reforge)", () => {
        // A rare Simplex holds only 3 mods, so it is full after an alchemy —
        // the exalt has no open slot. This exercises the real base's capDelta.
        const full = getDiagnostics(
            `craft in poe1
item { base: "Simplex Amulet" ilvl: 84 rarity: normal }
alchemy
exalt`,
            registry,
        );
        expect(full.some((d) => d.message.toLowerCase().includes("open"))).toBe(true);

        // Annulling first reopens a slot, so the exalt is fine.
        const reopened = getDiagnostics(
            `craft in poe1
item { base: "Simplex Amulet" ilvl: 84 rarity: normal }
alchemy
annul
exalt`,
            registry,
        );
        expect(reopened).toEqual([]);
    });

    it("rejects making a real flask Rare, but allows Magic crafting", () => {
        const rare = getDiagnostics(
            `craft in poe1
item { base: "Quicksilver Flask" ilvl: 84 rarity: normal }
alchemy`,
            registry,
        );
        expect(rare.some((d) => d.message.includes("cannot be made Rare"))).toBe(true);

        const magic = getDiagnostics(
            `craft in poe1
item { base: "Quicksilver Flask" ilvl: 84 rarity: normal }
transmute
augment`,
            registry,
        );
        expect(magic).toEqual([]);
    });
});
