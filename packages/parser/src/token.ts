/**
 * Tokens — the lexer's output alphabet. No layout tokens (whitespace is
 * trivia) and no keyword kind: every word lexes as `ident` and the parser
 * decides by text, keeping all vocabulary knowledge in one place.
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
