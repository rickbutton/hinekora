/**
 * Syntax errors and the parse result type.
 *
 * Both the lexer and the parser signal problems by throwing `CraftSyntaxError`
 * (which carries a source span). The public `parse` entry point catches these
 * and returns a plain `ParseResult` — the pure core communicates in data, not
 * exceptions, so callers pattern-match rather than try/catch.
 */
import type { Craft, SourceSpan } from "@hinekora/core";

/** A syntax diagnostic: a human-readable message plus where it occurred. */
export interface SyntaxDiagnostic {
    readonly message: string;
    readonly span: SourceSpan;
}

/** Thrown internally by the lexer/parser; never escapes the `parse` boundary. */
export class CraftSyntaxError extends Error {
    readonly span: SourceSpan;

    constructor(message: string, span: SourceSpan) {
        super(message);
        this.name = "CraftSyntaxError";
        this.span = span;
    }
}

export type ParseResult =
    | { readonly ok: true; readonly craft: Craft }
    | { readonly ok: false; readonly error: SyntaxDiagnostic };
