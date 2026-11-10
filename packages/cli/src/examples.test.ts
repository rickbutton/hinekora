import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { check, costOf } from "@hinekora/core";
import { parse } from "@hinekora/parser";
import { loadDefaultPoe1, registryOf } from "@hinekora/data";
import { checkSource } from "./check.js";

// Every guide under examples/ checks clean against the bundled catalog. The
// crafts under examples/future/ wait on a feature and are deliberately left out.
const registry = registryOf(loadDefaultPoe1());
const dir = join(import.meta.dirname, "../../../examples");

describe("the example guides", () => {
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".craft"))) {
        it(`${file} checks clean`, () => {
            const r = checkSource(readFileSync(join(dir, file), "utf8"), file, registry);
            expect(r.output).not.toContain("error:");
            expect(r.ok).toBe(true);
        });
    }
});

const reports = new Map<string, ReturnType<typeof costOf>>();

/** The expected runs of the step on `line` of an example guide. */
function runsAt(file: string, line: number): number {
    let report = reports.get(file);
    if (report === undefined) {
        const parsed = parse(readFileSync(join(dir, file), "utf8"));
        if (!parsed.ok) throw new Error(parsed.error.message);
        report = costOf(parsed.craft, check(parsed.craft, { registry }), registry);
        reports.set(file, report);
    }
    return report.steps.find((s) => s.span.start.line === line)!.runs;
}

// Regression pins on the walk's own figures, held to a few per cent so a change
// to the cost model that moves them shows. They are not validation: the
// simulator's figures for these guides are in docs/research/cost-model.md §6.2.
describe("the example guides' costs", () => {
    it("metamod-harvest-loop.craft: about nine reforges and one and a third annuls", () => {
        expect(runsAt("metamod-harvest-loop.craft", 23)).toBeGreaterThan(8.5);
        expect(runsAt("metamod-harvest-loop.craft", 23)).toBeLessThan(9.1);
        expect(runsAt("metamod-harvest-loop.craft", 20)).toBeGreaterThan(1.25);
        expect(runsAt("metamod-harvest-loop.craft", 20)).toBeLessThan(1.37);
    });

    it("example.craft: the first loop annuls about thirty-six times", () => {
        expect(runsAt("example.craft", 11)).toBeGreaterThan(35.5);
        expect(runsAt("example.craft", 11)).toBeLessThan(37.5);
    });
});
