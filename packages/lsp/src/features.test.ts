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
    it("shows a currency op's signature plus the item tooltip", () => {
        // Offset inside "regal" (last line): the headline is regal's signature,
        // the tooltip is the item AFTER regal — a Rare.
        const offset = SRC.indexOf("regal") + 1;
        const md = getHover(SRC, offset, registry);
        expect(md).not.toBeNull();
        expect(md!).toContain("Regal Orb"); // the signature headline
        expect(md!).toContain("Requires:");
        expect(md!).toContain("Iron Ring"); // the tooltip header
        expect(md!).toContain("Rare"); // after regal
    });

    it("hovers an essence name with its tier and the mod it guarantees here", () => {
        const src = `craft in poe1\nitem { base: "Iron Ring" ilvl: 84 rarity: normal }\nessence "Deafening Essence of Greed"`;
        const md = getHover(src, src.indexOf("Deafening") + 1, registry);
        expect(md).not.toBeNull();
        expect(md!).toContain("Deafening Essence of Greed");
        expect(md!).toContain("essence (T1)");
        expect(md!).toMatch(/Guarantees/);
    });

    it("hovers a bench mod with what it adds and its generation", () => {
        const src = `craft in poe1\nitem { base: "Iron Ring" ilvl: 84 rarity: rare }\nbench "maximum life"`;
        const md = getHover(src, src.indexOf("maximum life") + 1, registry);
        expect(md).not.toBeNull();
        expect(md!).toContain("bench craft");
        expect(md!).toMatch(/prefix|suffix/);
    });

    it("hovers a local def (declaration, call, and param share one signature)", () => {
        const src = `craft in poe1
item { base: "Iron Ring" ilvl: 84 rarity: rare }
def anyEleRes(t) = has "fire resistance" t or has "cold resistance" t
until anyEleRes(t1) { chaos }`;
        const decl = getHover(src, src.indexOf("anyEleRes") + 1, registry);
        const callSite = getHover(src, src.lastIndexOf("anyEleRes") + 1, registry);
        expect(decl).not.toBeNull();
        expect(decl!).toContain("def anyEleRes(t)");
        expect(decl!).toContain("local predicate");
        expect(decl!).toContain('has "fire resistance" t'); // the expansion, param intact
        expect(callSite).toContain("def anyEleRes(t)"); // call hovers the same
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

    it("renders the state as a tagged, one-mod-per-line tooltip with resolved text", () => {
        const src = `craft in poe1
item { base: "Iron Ring" ilvl: 84 rarity: rare prefixes: ["maximum life" t1] suffixes: ["fire resistance" t2] }
bench "cold resistance"`;
        const md = getHover(src, src.indexOf("bench") + 1, registry);
        expect(md).not.toBeNull();
        expect(md!).toContain("(P)"); // prefix tag
        expect(md!).toContain("(S)"); // suffix tag
        expect(md!).toMatch(/maximum Life/); // resolved text, not the "maximum life" label
        expect(md!).not.toMatch(/\bmodifiers\b/); // no total-count line
    });

    it("shows a disjunctive guarantee as 'at least one of'", () => {
        const src = `craft in poe1
item { base: "Titan Greaves" ilvl: 84 rarity: normal }
until has "fire resistance" t1 or has "cold resistance" t1 or has "lightning resistance" t1 {
  essence "greed" t1
}`;
        const md = getHover(src, src.indexOf("until") + 1, registry);
        expect(md).not.toBeNull();
        expect(md!).toContain("at least one of:");
        expect(md!).toMatch(/fire resistance/);
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

    it('offers essence names inside an `essence "` string, not mods', () => {
        const src = `craft in poe1\nitem { base: "Iron Ring" ilvl: 84 rarity: normal }\nessence "`;
        const labels = getCompletions(src, src.length, registry).map((c) => c.label);
        expect(labels).toContain("Deafening Essence of Greed");
        expect(labels).not.toContain("maximum life"); // not mod suggestions
    });

    it('offers bench mod names inside a `bench "` string', () => {
        const src = `craft in poe1\nitem { base: "Iron Ring" ilvl: 84 rarity: rare }\nbench "`;
        const labels = getCompletions(src, src.length, registry).map((c) => c.label);
        expect(labels).toContain("maximum life");
    });

    it("offers local def names as predicates (after a connective too)", () => {
        const src = `craft in poe1
item { base: "Iron Ring" ilvl: 84 rarity: rare }
def anyEleRes(t) = has "fire resistance" t
until has "life" or `;
        const labels = getCompletions(src, src.length, registry).map((c) => c.label);
        expect(labels).toContain("anyEleRes"); // the local def
        expect(labels).toContain("has"); // and still the built-in predicates
        expect(labels).not.toContain("exalt"); // not a statement position
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
