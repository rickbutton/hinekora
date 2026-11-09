/**
 * The end-to-end check, pure (no I/O): source → parse → check → the text to
 * print plus whether it passed. The `cli` shell adds file reading, data
 * loading, and exit codes.
 */
import {
    check,
    costOf,
    flowchart,
    inChaos,
    itemView,
    type Price,
    type Prices,
    type Registry,
    renderItemText,
    type StepCost,
    walkthrough,
} from "@hinekora/core";
import { parse } from "@hinekora/parser";
import { formatDiagnostic } from "./format.js";

/** The guide as Mermaid flowchart text; absent when it does not parse. */
export function chartSource(source: string, registry: Registry): string | undefined {
    const parsed = parse(source);
    if (!parsed.ok) return undefined;
    const result = check(parsed.craft, { registry });
    return flowchart(walkthrough(parsed.craft, result, registry)).text;
}

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
        // The final item in the game's copy-to-clipboard layout, indented under the verdict.
        const item = result.finalState
            ? renderItemText(itemView(result.finalState, registry))
                  .split("\n")
                  .map((l) => `  ${l}`)
                  .join("\n")
            : "  (every path ends the craft before this point)";
        return { ok: true, output: `✓ ${file} checks.\n\n${item}` };
    }

    const blocks = result.diagnostics.map((d) => formatDiagnostic(source, file, d.message, d.span));
    const n = result.diagnostics.length;
    return {
        ok: false,
        output: `${blocks.join("\n\n")}\n\n✗ ${n} error${n === 1 ? "" : "s"}`,
    };
}

/**
 * The guide's expected cost, step by step: for each statement what it is
 * expected to consume, for a loop its attempts and the chance of each, for a
 * branch how often it is taken; then the total in each currency and, under the
 * economy snapshot, in Chaos and Divine Orbs. A guide with errors is still
 * costed, as written, after a line saying so.
 */
export function costSource(
    source: string,
    file: string,
    registry: Registry,
    prices?: Prices,
): CheckOutput {
    const parsed = parse(source);
    if (!parsed.ok) {
        return {
            ok: false,
            output: formatDiagnostic(source, file, parsed.error.message, parsed.error.span),
        };
    }
    const result = check(parsed.craft, { registry });
    const report = costOf(parsed.craft, result, registry, prices);
    const lines = source.split(/\r?\n/);
    const out: string[] = [];
    if (!result.ok) {
        const n = result.diagnostics.length;
        out.push(
            `${file}: ${n} error${n === 1 ? "" : "s"}; the costs take the steps as written.`,
            "",
        );
    }
    const width = Math.max(...report.steps.map((s) => stepText(lines, s).length), 10);
    for (const s of report.steps) {
        const text = stepText(lines, s);
        out.push(`  ${text.padEnd(width)}  ${stepFigure(s, prices)}`);
        if (s.note !== undefined) out.push(`  ${"".padEnd(width)}  (${s.note})`);
    }
    out.push("");
    if (report.total.length === 0) out.push("Expected spend: nothing this report can count.");
    else out.push(`Expected spend: ${priceList(report.total)}.`);
    if (prices !== undefined && report.total.length > 0) {
        const date = prices.fetchedAt.slice(0, 10);
        if (report.chaos !== undefined && report.divine !== undefined) {
            out.push(
                `About ${amount(report.chaos)} Chaos Orbs (${amount(report.divine)} Divine Orbs) at ${prices.league} prices of ${date}.`,
            );
        } else {
            out.push(
                `No total in Chaos Orbs: ${prices.league} prices of ${date} lack ${report.unpriced.join(", ")}.`,
            );
        }
    } else if (report.unpriced.length > 0) {
        out.push(`Not counted: ${report.unpriced.join(", ")}.`);
    }
    if (report.stopped > 0) {
        out.push(`The craft ends on a stop ${percent(report.stopped)} of the time.`);
    }
    return { ok: parsed.ok, output: out.join("\n") };
}

/** The statement's first source line, with its line number. */
function stepText(lines: readonly string[], s: StepCost): string {
    const line = lines[s.span.start.line - 1] ?? "";
    return `${String(s.span.start.line).padStart(3)}  ${line.trim()}`;
}

function stepFigure(s: StepCost, prices: Prices | undefined): string {
    const parts: string[] = [];
    if (s.attempts !== undefined) {
        parts.push(
            `${amount(s.attempts.expected)} rounds (${percent(s.attempts.chance)} per round)`,
        );
    }
    if (s.branch !== undefined) parts.push(`taken ${percent(s.branch)}`);
    if (s.kind === "restart" || s.kind === "stop") parts.push(`reached ${percent(s.reached)}`);
    if (s.kind === "operation") {
        if (s.expected !== undefined && s.expected.length > 0) {
            parts.push(`×${amount(s.runs)}: ${priceList(s.expected)}`);
            const chaos = prices === undefined ? undefined : inChaos(s.expected, prices);
            if (chaos !== undefined) parts.push(`(${amount(chaos)} chaos)`);
        } else if (s.expected !== undefined) {
            parts.push(`×${amount(s.runs)}: free`);
        } else if (s.runs !== 1) {
            parts.push(`×${amount(s.runs)}`);
        }
    }
    return parts.join("  ");
}

function priceList(prices: readonly Price[]): string {
    return prices.map((p) => `${amount(p.amount)} ${p.item}`).join(", ");
}

function amount(n: number): string {
    if (!Number.isFinite(n)) return "∞";
    if (n >= 100) return String(Math.round(n));
    if (n >= 10) return n.toFixed(1).replace(/\.0$/, "");
    return n.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

function percent(p: number): string {
    const v = p * 100;
    if (v >= 10) return `${Math.round(v)}%`;
    if (v >= 1) return `${v.toFixed(1)}%`;
    return `${v.toFixed(2)}%`;
}
