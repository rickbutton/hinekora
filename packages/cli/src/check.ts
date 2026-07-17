/**
 * The end-to-end check: source text → parse → check → formatted output.
 *
 * This is the pure heart of the CLI (no file I/O, no process): given a craft's
 * source, a filename (for messages), and a resolved `Registry`, it runs the
 * whole pipeline and returns the text to print plus whether it passed. The
 * `cli` shell adds file reading, data loading, and exit codes.
 */
import { check, type Registry, renderState } from "@hinekora/core";
import { parse } from "@hinekora/parser";
import { formatDiagnostic } from "./format.js";

export interface CheckOutput {
    readonly ok: boolean;
    readonly output: string;
}

export function checkSource(source: string, file: string, registry: Registry): CheckOutput {
    const parsed = parse(source);
    if (!parsed.ok) {
        return {
            ok: false,
            output: formatDiagnostic(source, file, parsed.error.message, parsed.error.span),
        };
    }

    const result = check(parsed.craft, { registry });
    if (result.ok) {
        const state = result.finalState ? renderState(result.finalState) : "(diverged)";
        return { ok: true, output: `✓ ${file} checks.\n  final item: ${state}` };
    }

    const blocks = result.diagnostics.map((d) => formatDiagnostic(source, file, d.message, d.span));
    const n = result.diagnostics.length;
    return {
        ok: false,
        output: `${blocks.join("\n\n")}\n\n✗ ${n} error${n === 1 ? "" : "s"}`,
    };
}
