/**
 * The end-to-end check, pure (no I/O): source → parse → check → the text to
 * print plus whether it passed. The `cli` shell adds file reading, data
 * loading, and exit codes.
 */
import {
    check,
    type CheckDiagnostic,
    costOf,
    EXAMPLE_LEAD,
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
    plural,
    approx,
    oddsFigure,
    oddsText,
    spreadText,
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
            ? indented(renderItemText(itemView(result.finalState, registry, parsed.craft)), 2)
            : "  (every path ends the craft before this point)";
        return { ok: true, output: `✓ ${file} checks.\n\n${item}` };
    }

    const blocks = result.diagnostics.map((d) => errorText(source, file, d));
    const n = result.diagnostics.length;
    return {
        ok: false,
        output: `${blocks.join("\n\n")}\n\n✗ ${n} ${plural(n, "error")}`,
    };
}

const indented = (text: string, by: number): string =>
    text
        .split("\n")
        .map((l) => `${" ".repeat(by)}${l}`)
        .join("\n");

/** An error, and under it the item that breaks the step where it names one. */
function errorText(source: string, file: string, d: CheckDiagnostic): string {
    const head = formatDiagnostic(source, file, d.message, d.span);
    if (d.example === undefined) return head;
    return `${head}\n  ${EXAMPLE_LEAD}\n${indented(renderItemText(d.example), 4)}`;
}

/**
 * The guide's expected cost, step by step: for each statement what it is
 * expected to consume, for a loop the chance a round ends it, for a branch how
 * often it is taken; then the total in each currency and, under the
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
        out.push(`${file}: ${n} ${plural(n, "error")}; the costs take the steps as written.`, "");
    }
    const width = Math.max(...report.steps.map((s) => stepText(lines, s).length), 10);
    for (const s of report.steps) {
        const text = stepText(lines, s);
        out.push(`  ${text.padEnd(width)}  ${stepFigure(s, prices)}`.trimEnd());
        if (s.note !== undefined) out.push(`  ${"".padEnd(width)}  (${s.note})`);
    }
    out.push("");
    if (report.unknown) {
        const rest =
            report.total.length === 0
                ? ""
                : ` The steps outside it come to ${priceText(report.total)}.`;
        out.push(`Expected spend: not known, for a loop above has no figure.${rest}`);
    } else if (report.total.length === 0) {
        out.push("Expected spend: nothing this report can count.");
    } else out.push(`Expected spend: ${priceText(report.total)}.`);
    if (report.unknown) {
        // No total in Chaos Orbs stands for a guide with a loop left open.
    } else if (prices !== undefined && report.total.length > 0) {
        const date = prices.fetchedAt.slice(0, 10);
        if (report.chaos !== undefined && report.divine !== undefined) {
            const ends = spreadText(report.chaosRange, figure);
            const spread = ends === undefined ? "" : `, ${ends} by what the item may hold,`;
            out.push(
                `${approx(report.chaos)} Chaos Orbs (${approx(report.divine)} Divine Orbs)${spread} at ${prices.league} prices of ${date}.`,
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
        out.push(
            `The craft ends short of a finished item ${percentage(report.stopped)} of the time.`,
        );
    }
    return { ok: parsed.ok, output: out.join("\n") };
}

/** The statement's first source line, with its line number; a statement
 *  written after another on the line is its own text alone. */
function stepText(lines: readonly string[], s: StepCost): string {
    const { start, end } = s.span;
    const line = lines[start.line - 1] ?? "";
    const before = line.slice(0, start.column - 1);
    const own = line.slice(start.column - 1, end.line === start.line ? end.column - 1 : undefined);
    const text = before.trim() === "" ? line.trim() : own.trim();
    return `${String(start.line).padStart(3)}  ${text}`;
}

/**
 * A step's figures. Where what the item may hold (its unnamed modifiers, its
 * memory strands) leaves a figure open, the spread over the two ends follows
 * it in brackets.
 */
function stepFigure(s: StepCost, prices: Prices | undefined): string {
    const parts: string[] = [];
    const spread = (b: Bounds | undefined, show: (n: number) => string): string => {
        const ends = spreadText(b, show);
        return ends === undefined ? "" : ` [${ends}]`;
    };
    if (s.attempts !== undefined) {
        parts.push(`${oddsText(s.attempts.chance)}${spread(s.chanceRange, oddsFigure)}`);
    }
    if (s.branch !== undefined) {
        parts.push(`taken ${percentage(s.branch)}${spread(s.branchRange, percentage)}`);
    }
    if (s.unknown) {
        if (s.kind === "until") parts.push("rounds not known");
        else if (s.kind === "operation") parts.push("uses not known");
    } else if (s.kind === "operation") {
        const runs = `×${figure(s.runs)}${spread(s.runsRange, figure)}`;
        if (s.expected !== undefined && s.expected.length > 0) {
            parts.push(`${runs}: ${priceText(s.expected)}`);
            const chaos = prices === undefined ? undefined : inChaos(s.expected, prices);
            if (chaos !== undefined) parts.push(`(${figure(chaos)} chaos)`);
            else if (prices !== undefined) {
                const lacking = s.expected.filter((p) => inChaos([p], prices) === undefined);
                parts.push(`(no price for ${lacking.map((p) => p.item).join(", ")})`);
            }
        } else if (s.expected !== undefined) {
            parts.push(`${runs}: free`);
        } else if (s.runs !== 1 || s.runsRange !== undefined) {
            parts.push(runs);
        }
    }
    return parts.join("  ");
}
