/**
 * @hinekora/parser — hand-written lexer + recursive-descent parser for the
 * Hinekora surface language. Depends on @hinekora/core for the AST (the
 * one-way arrow: parser → core, never the reverse).
 */
import { CraftSyntaxError, type ParseResult } from "./errors.js";
import { tokenize } from "./lexer.js";
import { parseTokens } from "./parser.js";

export type { Token, TokenKind } from "./token.js";
export type { ParseResult, SyntaxDiagnostic } from "./errors.js";
export { CraftSyntaxError } from "./errors.js";
export { tokenize } from "./lexer.js";
export { parseTokens } from "./parser.js";

/**
 * Parse a craft source string into a `Craft` AST. Returns a data result rather
 * than throwing: `{ ok: true, craft }` or `{ ok: false, error }` with a
 * message and source span.
 */
export function parse(source: string): ParseResult {
    try {
        const craft = parseTokens(tokenize(source));
        return { ok: true, craft };
    } catch (e) {
        if (e instanceof CraftSyntaxError) {
            return { ok: false, error: { message: e.message, span: e.span } };
        }
        throw e;
    }
}
