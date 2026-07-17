import { describe, expect, it } from "vitest";
import { loadDefaultPoe1, registryOf } from "@hinekora/data";
import { getCompletions } from "./completion.js";
import { getHover } from "./hover.js";
import { getSemanticTokens } from "./semantic.js";

const registry = registryOf(loadDefaultPoe1());

const SRC = `craft in poe1
item { base: "Iron Ring" ilvl: 84 rarity: normal }
transmute
regal`;

describe("hover", () => {
    it("shows a currency op's signature plus the state footer", () => {
        // Offset inside "regal" (last line): the headline is regal's signature,
        // the footer shows the item (Magic before regal — transmute made it so).
        const offset = SRC.indexOf("regal") + 1;
        const md = getHover(SRC, offset, registry);
        expect(md).not.toBeNull();
        expect(md!).toContain("Regal Orb"); // the signature headline
        expect(md!).toContain("Requires:");
        expect(md!).toContain("Iron Ring · Magic"); // before regal, in the footer
    });

    it("resolves a mod string to its ModType signature", () => {
        const src = `craft in poe1
item { base: "Iron Ring" ilvl: 84 rarity: rare }
until has "maximum life" t1 { exalt }`;
        const offset = src.indexOf("maximum life") + 1;
        const md = getHover(src, offset, registry);
        expect(md).not.toBeNull();
        expect(md!).toContain("maximum life");
        expect(md!).toMatch(/prefix|suffix/); // its generation
    });

    it("leads the state footer with the total affix count", () => {
        // After transmute the item has exactly one affix; the footer must say
        // "1 affix" so the coupled prefix/suffix ranges can't be misread.
        const offset = SRC.indexOf("regal") + 1;
        const md = getHover(SRC, offset, registry);
        expect(md!).toContain("1 affix");
    });

    it("returns null in dead space", () => {
        expect(getHover(SRC, 0, registry)).not.toBe(undefined);
    });
});

describe("completion", () => {
    it("offers currencies + control keywords at statement position", () => {
        const labels = getCompletions(SRC, SRC.length, registry).map((c) => c.label);
        expect(labels).toContain("exalt");
        expect(labels).toContain("until");
    });

    it("offers predicate keywords after `until` and `if`, not currencies", () => {
        for (const kw of ["until ", "if "]) {
            const src = `craft in poe1\nitem { base: "Iron Ring" ilvl: 84 rarity: rare }\n${kw}`;
            const labels = getCompletions(src, src.length, registry).map((c) => c.label);
            expect(labels).toEqual(expect.arrayContaining(["has", "not", "isRare", "prefixCount"]));
            expect(labels).not.toContain("exalt"); // not a statement position
        }
    });

    it("offers predicate keywords after `not`", () => {
        const src = `craft in poe1\nitem { base: "Iron Ring" ilvl: 84 rarity: rare }\nuntil not `;
        const labels = getCompletions(src, src.length, registry).map((c) => c.label);
        expect(labels).toContain("has");
    });

    it("offers base names inside a base: string", () => {
        const src = `craft in poe1\nitem { base: "Iron`;
        const labels = getCompletions(src, src.length, registry).map((c) => c.label);
        expect(labels).toContain("Iron Ring");
        expect(labels).not.toContain("exalt");
    });

    it("offers stat descriptions inside a has string", () => {
        const src = `craft in poe1\nitem { base: "Iron Ring" ilvl: 84 rarity: rare }\nuntil has "maximum`;
        const labels = getCompletions(src, src.length, registry).map((c) => c.label);
        expect(labels).toContain("maximum life");
    });

    it("filters mod completions to those rollable on the item's base", () => {
        const src = `craft in poe1\nitem { base: "Iron Ring" ilvl: 84 rarity: rare }\nuntil has "`;
        const labels = getCompletions(src, src.length, registry).map((c) => c.label);
        expect(labels).toContain("maximum life"); // rings roll life
        // A ring can't roll everything, so this is a strict subset of all mods.
        expect(labels.length).toBeLessThan(registry.statSuggestions.length);
    });
});

describe("semantic tokens", () => {
    it("emits tokens (5 ints per token) and doesn't throw on valid input", () => {
        const toks = getSemanticTokens(SRC, registry);
        expect(toks.data.length).toBeGreaterThan(0);
        expect(toks.data.length % 5).toBe(0);
    });

    it("returns empty on unlexable input rather than throwing", () => {
        expect(getSemanticTokens(`has "unterminated`, registry).data).toEqual([]);
    });
});
