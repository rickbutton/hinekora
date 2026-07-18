/**
 * Tokens — the lexer's output alphabet.
 *
 * The surface language is brace-delimited and whitespace-insignificant (C-style
 * blocks), so there are NO layout tokens: newlines, tabs, and spaces are trivia
 * the lexer discards. Blocks are delimited by `{ }` and statements are
 * self-delimiting, so nothing structural rides on whitespace.
 *
 * There is also no separate "keyword" token kind: every word lexes as `ident`
 * and the PARSER decides, by text, whether it is a keyword (`until`, `has`,
 * `isRare`, …) or a currency name (`exalt`). This keeps the lexer tiny and puts
 * all vocabulary knowledge in one place.
 */
import type { SourceSpan } from "@hinekora/core";

export type TokenKind =
    // literals & words
    | "ident" // a bare word: keyword or currency/field name (parser decides)
    | "string" // "..." — `text` holds the unescaped contents
    | "int" // 82 — `text` holds the digits
    // punctuation
    | "colon"
    | "comma"
    | "lparen"
    | "rparen"
    | "lbracket"
    | "rbracket"
    | "lbrace"
    | "rbrace"
    | "assign" // = (def binding)
    // comparison operators
    | "eq" // ==
    | "neq" // !=
    | "lt" // <
    | "le" // <=
    | "gt" // >
    | "ge" // >=
    | "eof";

export interface Token {
    readonly kind: TokenKind;
    /** The lexeme (for idents/ints) or unescaped value (for strings). Empty for eof. */
    readonly text: string;
    readonly span: SourceSpan;
}
