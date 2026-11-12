/**
 * The transport-free language service: pure functions over (source, registry),
 * wrapped by the Node server and bound to Monaco by the browser playground.
 * The parser and checker already return `{ message, span }`; this only
 * converts spans.
 */
import { type Diagnostic, DiagnosticSeverity, type Range } from "vscode-languageserver-types";
import type { Registry, SourceSpan } from "@hinekora/core";
import { checkCached, parseCached } from "./analysis.js";
import { guarded, messageOf } from "./guard.js";

/** Our spans are 1-based line/column; LSP ranges are 0-based line/character. */
export function toRange(span: SourceSpan): Range {
    const start = { line: span.start.line - 1, character: span.start.column - 1 };
    let end = { line: span.end.line - 1, character: span.end.column - 1 };
    // Widen an empty range to one character so the squiggle is visible.
    if (end.line === start.line && end.character === start.character) {
        end = { line: end.line, character: end.character + 1 };
    }
    return { start, end };
}

function toDiagnostic(message: string, span: SourceSpan): Diagnostic {
    return {
        range: toRange(span),
        message,
        severity: DiagnosticSeverity.Error,
        source: "hinekora",
    };
}

/** Parse + check `source`, returning LSP diagnostics (empty ⇒ the craft is clean). */
function diagnosticsOf(source: string, registry: Registry): Diagnostic[] {
    const parsed = parseCached(source);
    if (!parsed.ok) {
        return [toDiagnostic(parsed.error.message, parsed.error.span)];
    }
    const result = checkCached(source, registry)!;
    return result.diagnostics.map((d) => toDiagnostic(d.message, d.span));
}

/** Parse + check `source`, returning LSP diagnostics (empty ⇒ the craft is clean). */
/** The words of a craft whose check failed in the tool itself. */
const UNCHECKED =
    "The craft could not be checked: the tool does not handle something about it. Please report it";

export const getDiagnostics = guarded("diagnostics", diagnosticsOf, (error) => [
    toDiagnostic(`${UNCHECKED} — ${messageOf(error)}`, {
        start: { line: 1, column: 1, offset: 0 },
        end: { line: 1, column: 1, offset: 0 },
    }),
]);
