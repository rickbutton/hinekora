/**
 * Format a diagnostic against its source: a `file:line:col` header, the message,
 * and a snippet of the offending line with a caret under the span. Both parse
 * errors (from the parser) and check diagnostics (from the checker) carry a
 * `SourceSpan`, so this one formatter serves both.
 */
import type { SourceSpan } from "@hinekora/core";

export function formatDiagnostic(
    source: string,
    file: string,
    message: string,
    span: SourceSpan,
): string {
    const lines = source.split(/\r?\n/);
    const lineNo = span.start.line;
    const col = span.start.column;
    const srcLine = lines[lineNo - 1] ?? "";

    const [head, ...rest] = message.split("\n");
    const gutter = String(lineNo);
    const pad = " ".repeat(gutter.length);

    return [
        `${file}:${lineNo}:${col}: error: ${head ?? ""}`,
        ...rest.map((l) => `  ${l}`),
        `  ${gutter} | ${srcLine}`,
        `  ${pad} | ${" ".repeat(Math.max(0, col - 1))}^`,
    ].join("\n");
}
