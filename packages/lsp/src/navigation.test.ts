import { describe, expect, it } from "vitest";
import { DocumentHighlightKind, SymbolKind } from "vscode-languageserver-types";
import {
    getDefinition,
    getDocumentHighlights,
    getDocumentSymbols,
    getReferences,
    getRenameEdits,
    prepareRename,
} from "./navigation.js";

const SRC = `item { base: "Iron Ring" ilvl: 84 rarity: rare }
def anyEleRes(t) = has "fire resistance" t or has "cold resistance" t
def roll(m, chaos) { until has m { chaos } }
roll("maximum life", chaos)
until anyEleRes(t1) { chaos }
`;

/** The source text each range covers, so assertions read like the guide. */
const textOf = (range: {
    start: { line: number; character: number };
    end: { character: number };
}) => SRC.split("\n")[range.start.line]!.slice(range.start.character, range.end.character);

describe("document highlights", () => {
    it("highlights a def's declaration and its calls", () => {
        const hs = getDocumentHighlights(SRC, SRC.indexOf("anyEleRes") + 2);
        expect(hs.map((h) => [textOf(h.range), h.kind])).toEqual([
            ["anyEleRes", DocumentHighlightKind.Write],
            ["anyEleRes", DocumentHighlightKind.Read],
        ]);
        expect(hs[1]!.range.start.line).toBe(4);
    });

    it("highlights a parameter's declaration and uses, from any of them", () => {
        const fromDecl = getDocumentHighlights(SRC, SRC.indexOf("anyEleRes(t") + 10);
        const fromUse = getDocumentHighlights(SRC, SRC.indexOf('"fire resistance" t') + 18);
        expect(fromDecl).toEqual(fromUse);
        expect(fromUse.map((h) => textOf(h.range))).toEqual(["t", "t", "t"]);
        expect(fromUse.map((h) => h.range.start.line)).toEqual([1, 1, 1]);
    });

    it("tells a parameter that shadows a method word from the method", () => {
        // `chaos` is roll's step parameter inside roll; the two later `chaos`
        // are the Chaos Orb and highlight nothing.
        const inside = getDocumentHighlights(SRC, SRC.indexOf("{ chaos }") + 2);
        expect(inside.map((h) => [h.range.start.line, textOf(h.range)])).toEqual([
            [2, "chaos"],
            [2, "chaos"],
        ]);
        expect(getDocumentHighlights(SRC, SRC.indexOf('", chaos)') + 3)).toEqual([]);
        expect(getDocumentHighlights(SRC, SRC.lastIndexOf("chaos"))).toEqual([]);
    });

    it("binds a parameter used inside a block argument to the def it is written in", () => {
        const src = `item { base: "Iron Ring" ilvl: 84 rarity: rare }
def once(m) { m }
def want(m) { once({ until has m { chaos } }) }
want("maximum life")`;
        const hs = getDocumentHighlights(src, src.indexOf("has m") + 4);
        const lines = hs.map((h) => h.range.start.line);
        expect(lines).toEqual([2, 2]); // want's m: declaration and the use in the block
    });

    it("finds a parameter in every slot it can fill", () => {
        const src = `item { base: "Iron Ring" ilvl: 84 rarity: rare }
def few(n) = prefixCount < n and not fractured "maximum life"
def locked(m) = fractured m
def viaFew(n) = few(n)
def add(e, k) { if few(2) { essence e k } else { bench e } }
add("Deafening Essence of Greed", t1)`;
        const uses = (needle: string) =>
            getDocumentHighlights(src, src.indexOf(needle) + needle.length - 1).length;
        expect(uses("few(n")).toBe(2); // n: declaration + `< n`
        expect(uses("locked(m")).toBe(2); // m: declaration + `fractured m`
        expect(uses("viaFew(n")).toBe(2); // n: declaration + forwarded `few(n)`
        expect(uses("add(e")).toBe(3); // e: declaration, `essence e`, `bench e` in the else
        expect(uses("add(e, k")).toBe(2); // k: declaration + the tier slot
        expect(uses("def few")).toBe(3); // few: declaration + two calls
    });

    it("highlights nothing on a method word or when the guide does not parse", () => {
        expect(getDocumentHighlights(SRC, SRC.indexOf("until"))).toEqual([]);
        expect(getDocumentHighlights(`item { base: "Iron Ring"`, 10)).toEqual([]);
    });
});

describe("definition and references", () => {
    it("jumps from a call to the def's name and lists every reference", () => {
        const def = getDefinition(SRC, SRC.lastIndexOf("anyEleRes") + 1)!;
        expect(def.start.line).toBe(1);
        expect(textOf(def)).toBe("anyEleRes");
        const refs = getReferences(SRC, SRC.lastIndexOf("anyEleRes") + 1, false);
        expect(refs.map((r) => r.start.line)).toEqual([4]);
        const withDecl = getReferences(SRC, SRC.lastIndexOf("anyEleRes") + 1, true);
        expect(withDecl.map((r) => r.start.line)).toEqual([1, 4]);
    });

    it("jumps from a step parameter to its declaration", () => {
        const def = getDefinition(SRC, SRC.indexOf("{ chaos }") + 2)!;
        expect(textOf(def)).toBe("chaos");
        expect(def.start.character).toBe(SRC.split("\n")[2]!.indexOf("chaos"));
    });
});

describe("rename", () => {
    it("prepares the rename with the symbol's range and current name", () => {
        const prep = prepareRename(SRC, SRC.indexOf("roll(") + 1)!;
        expect(prep.placeholder).toBe("roll");
        expect(textOf(prep.range)).toBe("roll");
        expect(prepareRename(SRC, SRC.indexOf("until"))).toBeNull();
    });

    it("renames a def at its declaration and every call", () => {
        const r = getRenameEdits(SRC, SRC.lastIndexOf("anyEleRes") + 1, "anyRes");
        if ("error" in r) throw new Error(r.error);
        expect(r.edits.map((e) => [e.range.start.line, textOf(e.range), e.newText])).toEqual([
            [1, "anyEleRes", "anyRes"],
            [4, "anyEleRes", "anyRes"],
        ]);
    });

    it("renames a parameter inside its def only", () => {
        const r = getRenameEdits(SRC, SRC.indexOf("{ chaos }") + 2, "step");
        if ("error" in r) throw new Error(r.error);
        expect(r.edits.map((e) => e.range.start.line)).toEqual([2, 2]);
    });

    it("refuses a name the language owns, a taken def name, or a taken parameter name", () => {
        expect(getRenameEdits(SRC, SRC.indexOf("roll(") + 1, "until")).toEqual({
            error: '"until" is a word of the language',
        });
        expect(getRenameEdits(SRC, SRC.indexOf("roll(") + 1, "exalt")).toEqual({
            error: '"exalt" is a word of the language',
        });
        expect(getRenameEdits(SRC, SRC.indexOf("roll(") + 1, "anyEleRes")).toEqual({
            error: 'a def named "anyEleRes" already exists',
        });
        expect(getRenameEdits(SRC, SRC.indexOf("{ chaos }") + 2, "m")).toEqual({
            error: '"roll" already has a parameter named "m"',
        });
        expect(getRenameEdits(SRC, SRC.indexOf("roll(") + 1, "1x")).toEqual({
            error: '"1x" is not a valid name',
        });
    });

    it("refuses a tier shorthand as a name, which the parser would read as a tier", () => {
        const t = SRC.indexOf("anyEleRes(t") + 10;
        expect(getRenameEdits(SRC, t, "t1")).toEqual({ error: '"t1" is how a tier is written' });
        expect(getRenameEdits(SRC, t, "T3")).toEqual({ error: '"T3" is how a tier is written' });
    });

    it("refuses to rename while the guide does not parse", () => {
        expect(getRenameEdits(`item { base: "Iron Ring"`, 10, "x")).toEqual({
            error: "the guide does not parse",
        });
    });
});

describe("document symbols", () => {
    it("outlines the item and each def with its parameters", () => {
        const syms = getDocumentSymbols(SRC);
        expect(syms.map((s) => [s.name, s.kind])).toEqual([
            ["Iron Ring", SymbolKind.Object],
            ["anyEleRes(t)", SymbolKind.Boolean],
            ["roll(m, chaos)", SymbolKind.Function],
        ]);
        expect(syms[2]!.children!.map((c) => c.name)).toEqual(["m", "chaos"]);
        expect(textOf(syms[1]!.selectionRange)).toBe("anyEleRes");
    });

    it("returns nothing while the guide does not parse", () => {
        expect(getDocumentSymbols(`item {`)).toEqual([]);
    });
});
