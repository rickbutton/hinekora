import { describe, expect, it } from "vitest";
import { tokenize } from "./lexer.js";
import type { TokenKind } from "./token.js";

const kinds = (src: string): TokenKind[] => tokenize(src).map((t) => t.kind);

describe("lexer — whitespace is insignificant", () => {
    it("produces the same tokens regardless of newlines and indentation", () => {
        const spread = tokenize("until isRare {\n    exalt\n}\n").map((t) => t.kind);
        const oneLine = tokenize("until isRare { exalt }").map((t) => t.kind);
        expect(spread).toEqual(oneLine);
        expect(spread).toEqual([
            "ident", // until
            "ident", // isRare
            "lbrace",
            "ident", // exalt
            "rbrace",
            "eof",
        ]);
    });

    it("does not emit any layout tokens", () => {
        const src = "a {\n\n  b\n    c\n}\n";
        // Only real tokens + eof; no newline/indent/dedent exist in the alphabet.
        expect(kinds(src)).toEqual(["ident", "lbrace", "ident", "ident", "rbrace", "eof"]);
    });

    it("skips blank lines and comments", () => {
        const src = "a\n\n   # a comment\nb\n";
        expect(kinds(src)).toEqual(["ident", "ident", "eof"]);
    });

    it("treats tabs as ordinary whitespace", () => {
        expect(kinds("a\t{\tb\t}")).toEqual(["ident", "lbrace", "ident", "rbrace", "eof"]);
    });
});

describe("lexer — tokens", () => {
    it("lexes strings with escapes, ints, and comparison operators", () => {
        const toks = tokenize('has "a\\"b" prefixCount >= 3');
        expect(toks[0]).toMatchObject({ kind: "ident", text: "has" });
        expect(toks[1]).toMatchObject({ kind: "string", text: 'a"b' });
        expect(toks[2]).toMatchObject({ kind: "ident", text: "prefixCount" });
        expect(toks[3]).toMatchObject({ kind: "ge", text: ">=" });
        expect(toks[4]).toMatchObject({ kind: "int", text: "3" });
    });

    it("distinguishes all six comparison operators", () => {
        expect(kinds("== != < <= > >=")).toEqual(["eq", "neq", "lt", "le", "gt", "ge", "eof"]);
    });

    it("lexes all the bracket and punctuation kinds", () => {
        expect(kinds("{ } [ ] ( ) : ,")).toEqual([
            "lbrace",
            "rbrace",
            "lbracket",
            "rbracket",
            "lparen",
            "rparen",
            "colon",
            "comma",
            "eof",
        ]);
    });

    it("throws on an unterminated string", () => {
        expect(() => tokenize('has "oops\n')).toThrow(/unterminated string/);
    });

    it("throws on an unexpected character", () => {
        expect(() => tokenize("a $ b")).toThrow(/unexpected character/);
    });

    it("tracks line/column in spans", () => {
        const toks = tokenize("ab\n  cd\n");
        expect(toks[0]?.span.start).toEqual({ offset: 0, line: 1, column: 1 });
        // "cd" starts on line 2, column 3 (after two spaces).
        const cd = toks.find((t) => t.kind === "ident" && t.text === "cd");
        expect(cd?.span.start).toMatchObject({ line: 2, column: 3 });
    });
});
