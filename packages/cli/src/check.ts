/**
 * The end-to-end check, pure (no I/O): source → parse → check → the text to
 * print plus whether it passed. The `cli` shell adds file reading, data
 * loading, and exit codes.
 */
import {
    check,
    costOf,
    flowchart,
    figure,
    inChaos,
    itemView,
    percentage,
    priceText,
    type Prices,
    type Registry,
    renderItemText,
    type Bounds,
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
    else out.push(`Expected spend: ${priceText(report.total)}.`);
    if (prices !== undefined && report.total.length > 0) {
        const date = prices.fetchedAt.slice(0, 10);
        if (report.chaos !== undefined && report.divine !== undefined) {
            const spread =
                report.chaosRange === undefined
                    ? ""
                    : `, ${figure(report.chaosRange.low)} to ${figure(report.chaosRange.high)} by what the item may hold,`;
            out.push(
                `About ${figure(report.chaos)} Chaos Orbs (${figure(report.divine)} Divine Orbs)${spread} at ${prices.league} prices of ${date}.`,
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
        out.push(`The craft ends on a stop ${percentage(report.stopped)} of the time.`);
    }
    return { ok: parsed.ok, output: out.join("\n") };
}

/** The statement's first source line, with its line number. */
function stepText(lines: readonly string[], s: StepCost): string {
    const line = lines[s.span.start.line - 1] ?? "";
    return `${String(s.span.start.line).padStart(3)}  ${line.trim()}`;
}

/**
 * A step's figures. Where what the item may hold (its unnamed modifiers, its
 * memory strands) leaves a figure open, the spread over the two ends follows
 * it in brackets.
 */
function stepFigure(s: StepCost, prices: Prices | undefined): string {
    const parts: string[] = [];
    const spread = (b: Bounds | undefined, show: (n: number) => string): string =>
        b === undefined ? "" : ` [${show(b.low)} to ${show(b.high)}]`;
    if (s.attempts !== undefined) {
        parts.push(
            `${figure(s.attempts.expected)} rounds${spread(s.attemptsRange, figure)} (${percentage(s.attempts.chance)} per round)`,
        );
    }
    if (s.branch !== undefined) {
        parts.push(`taken ${percentage(s.branch)}${spread(s.branchRange, percentage)}`);
    }
    if (s.kind === "restart" || s.kind === "stop") parts.push(`reached ${percentage(s.reached)}`);
    if (s.kind === "operation") {
        const runs = `×${figure(s.runs)}${spread(s.runsRange, figure)}`;
        if (s.expected !== undefined && s.expected.length > 0) {
            parts.push(`${runs}: ${priceText(s.expected)}`);
            const chaos = prices === undefined ? undefined : inChaos(s.expected, prices);
            if (chaos !== undefined) parts.push(`(${figure(chaos)} chaos)`);
        } else if (s.expected !== undefined) {
            parts.push(`${runs}: free`);
        } else if (s.runs !== 1 || s.runsRange !== undefined) {
            parts.push(runs);
        }
    }
    return parts.join("  ");
}
