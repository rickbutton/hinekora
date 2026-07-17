/**
 * The transport-free language service — the reusable intelligence.
 *
 * Pure functions over `(source, registry)`; no LSP connection, no Node, no DOM.
 * This is what the Node entry (VSCode) and, later, the browser-worker entry
 * (Monaco playground) both wrap. Diagnostics fall out almost directly: the
 * parser and checker already return `{ message, span }`; we only convert our
 * 1-based spans to LSP's 0-based ranges.
 */
import { type Diagnostic, DiagnosticSeverity, type Range } from "vscode-languageserver-types";
import { check, type Registry, type SourceSpan } from "@hinekora/core";
import { parse } from "@hinekora/parser";

/** Our spans are 1-based line/column; LSP ranges are 0-based line/character. */
function toRange(span: SourceSpan): Range {
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
export function getDiagnostics(source: string, registry: Registry): Diagnostic[] {
    const parsed = parse(source);
    if (!parsed.ok) {
        return [toDiagnostic(parsed.error.message, parsed.error.span)];
    }
    const result = check(parsed.craft, { registry });
    return result.diagnostics.map((d) => toDiagnostic(d.message, d.span));
}
