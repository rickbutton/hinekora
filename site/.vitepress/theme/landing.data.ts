/**
 * The home page's two examples, run when the site is built: for the craft the
 * checker accepts, what each step is expected to spend and the item it ends
 * with; for the one it refuses, the step, what the checker says of it and the
 * item at that step. The page shows the tool's own output on the crafts it prints, so the
 * two cannot drift apart.
 */
import { readFileSync } from "node:fs";
import {
    approx,
    check,
    costOf,
    figure,
    inChaos,
    itemView,
    oddsText,
    priceText,
    type Registry,
    type Step,
    walkthrough,
} from "@hinekora/core";
import { loadDefaultEconomy, loadDefaultPoe1, registryOf } from "@hinekora/data";
import { itemCardHtml } from "@hinekora/item-card";
import { parse } from "@hinekora/parser";
import { defineLoader } from "vitepress";

export interface Finding {
    readonly line: number;
    /** The refused step as written. */
    readonly step: string;
    readonly message: string;
    /** The item entering the step, as the item card's markup. */
    readonly card: string;
}

export interface CostRow {
    readonly line: number;
    /** The statement's first line as written. */
    readonly text: string;
    /** A loop's chance per round, or how often a step runs. */
    readonly times: string;
    readonly spend: string;
    readonly chaos: string;
}

export interface Cost {
    readonly rows: readonly CostRow[];
    readonly total: string;
    /** The league and day of the prices behind the chaos figures. */
    readonly prices: string;
    /** The item the craft ends with, as the item card's markup. */
    readonly card: string;
}

export interface Landing {
    readonly finding: Finding;
    readonly cost: Cost;
}

declare const data: Landing;
export { data };

const ACCEPTED = "../../examples/landing.craft";
const REFUSED = "../../examples/landing-refused.craft";

const read = (rel: string): string => readFileSync(new URL(rel, import.meta.url), "utf8");

function firstRefused(steps: readonly Step[]): Step | undefined {
    for (const s of steps) {
        if (s.problems.length > 0) return s;
        const inner =
            s.kind === "loop"
                ? firstRefused(s.body)
                : s.kind === "branch"
                  ? firstRefused([...s.then, ...(s.else ?? [])])
                  : undefined;
        if (inner !== undefined) return inner;
    }
    return undefined;
}

function finding(registry: Registry): Finding {
    const parsed = parse(read(REFUSED));
    if (!parsed.ok) throw new Error(`landing-refused.craft: ${parsed.error.message}`);
    const result = check(parsed.craft, { registry });
    const step = firstRefused(walkthrough(parsed.craft, result, registry).steps);
    if (step?.before === undefined || (step.kind !== "operation" && step.kind !== "call"))
        throw new Error("landing-refused.craft: the page expects the checker to refuse a step");
    return {
        line: step.span.start.line,
        step: step.text,
        // A finding opens with the item in a line of text; the card stands for that line.
        message: step.problems[0]!.split("\n").slice(1).join("\n"),
        card: itemCardHtml(itemView(step.before, registry)),
    };
}

function cost(registry: Registry): Cost {
    const source = read(ACCEPTED);
    const parsed = parse(source);
    if (!parsed.ok) throw new Error(`landing.craft: ${parsed.error.message}`);
    const result = check(parsed.craft, { registry });
    if (!result.ok || result.finalState === undefined)
        throw new Error("landing.craft: the page expects this craft to check");
    const prices = loadDefaultEconomy();
    const report = costOf(parsed.craft, result, registry, prices);
    if (report.unknown || report.chaos === undefined || report.divine === undefined)
        throw new Error("landing.craft: the page expects a priced total");
    const lines = source.split(/\r?\n/);
    const rows = report.steps.map((s): CostRow => {
        const chaos = s.expected === undefined ? undefined : inChaos(s.expected, prices);
        return {
            line: s.span.start.line,
            text: (lines[s.span.start.line - 1] ?? "").trim().replace(/\s*\{$/, ""),
            times: s.attempts !== undefined ? oddsText(s.attempts.chance) : `×${figure(s.runs)}`,
            spend: s.expected === undefined ? "" : priceText(s.expected),
            chaos: chaos === undefined ? "" : figure(chaos),
        };
    });
    return {
        rows,
        total: `${approx(report.chaos)} chaos, ${approx(report.divine)} divine`,
        prices: `${prices.league} prices of ${prices.fetchedAt.slice(0, 10)}`,
        card: itemCardHtml(itemView(result.finalState, registry)),
    };
}

export default defineLoader({
    watch: [REFUSED, ACCEPTED],
    load(): Landing {
        const registry = registryOf(loadDefaultPoe1());
        return { finding: finding(registry), cost: cost(registry) };
    },
});
