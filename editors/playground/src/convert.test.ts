import { describe, expect, it } from "vitest";
import { CompletionItemKind, SymbolKind } from "vscode-languageserver-types";
import { byName, toMonacoPosition, toMonacoRange } from "./convert.js";

describe("LSP to Monaco", () => {
    it("shifts positions from 0-based to 1-based", () => {
        expect(toMonacoPosition({ line: 2, character: 4 })).toEqual({ lineNumber: 3, column: 5 });
        expect(
            toMonacoRange({ start: { line: 0, character: 0 }, end: { line: 1, character: 3 } }),
        ).toEqual({ startLineNumber: 1, startColumn: 1, endLineNumber: 2, endColumn: 4 });
    });

    it("translates an enumeration member by its name", () => {
        // Monaco's tables are numbered from 0; a stand-in with the same names.
        const monacoSymbols = { File: 0, Module: 1, Function: 11, Boolean: 16 };
        expect(byName(SymbolKind, monacoSymbols, SymbolKind.Function)).toBe(11);
        expect(byName(SymbolKind, monacoSymbols, SymbolKind.Boolean)).toBe(16);
        expect(byName(CompletionItemKind, monacoSymbols, CompletionItemKind.Keyword)).toBe(
            undefined,
        );
    });
});
