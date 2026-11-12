import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { loadDefaultEconomy, loadDefaultPoe1, registryOf } from "@hinekora/data";
import { checkSource, costSource } from "./check.js";

vi.setConfig({ testTimeout: 30_000 });

// A site page that shows a craft and, right below it, a `txt` block prints what
// the tool says of that craft: `hinekora cost`'s whole output, or lines of
// `hinekora check`'s. The block must be the tool's own words.
const registry = registryOf(loadDefaultPoe1());
const prices = loadDefaultEconomy();
const site = join(import.meta.dirname, "../../../site");
const SKIP = new Set(["node_modules", "public", ".vitepress", "dist", "scripts", "operations"]);

function pages(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
        if (SKIP.has(name)) continue;
        const p = join(dir, name);
        if (statSync(p).isDirectory()) pages(p, out);
        else if (p.endsWith(".md")) out.push(p);
    }
    return out;
}

/** Each craft block with the `txt` block that follows it, blank lines apart. */
function pairs(text: string): { line: number; craft: string; shown: string }[] {
    const lines = text.replace(/\r/g, "").split("\n");
    const out: { line: number; craft: string; shown: string }[] = [];
    const close = (from: number): number =>
        lines.findIndex((l, at) => at > from && /^\s*```\s*$/.test(l));
    for (let i = 0; i < lines.length; i++) {
        if (!/^```hinekora\b/.test(lines[i]!)) continue;
        const end = close(i);
        // A piece of a craft, not a whole one, is not run (site/scripts/check-examples.mjs).
        const above = lines.slice(0, i).findLast((l) => l.trim() !== "") ?? "";
        if (above.trim() === "<!-- fragment -->") {
            i = end;
            continue;
        }
        let next = end + 1;
        while (next < lines.length && lines[next]!.trim() === "") next++;
        if (/^```txt\b/.test(lines[next] ?? "")) {
            const shownEnd = close(next);
            out.push({
                line: i + 1,
                craft: lines.slice(i + 1, end).join("\n") + "\n",
                shown: lines.slice(next + 1, shownEnd).join("\n"),
            });
        }
        i = end;
    }
    return out;
}

describe("the site's tool output", () => {
    it("is what the tool prints for the craft above it", () => {
        let costs = 0;
        for (const page of pages(site)) {
            for (const p of pairs(readFileSync(page, "utf8"))) {
                const where = `${relative(site, page)}:${p.line}`;
                if (p.shown.includes("Expected spend:")) {
                    costs++;
                    const { output } = costSource(p.craft, "craft", registry, prices);
                    expect(p.shown, where).toBe(output.trimEnd());
                    continue;
                }
                const { output } = checkSource(p.craft, "craft", registry);
                for (const line of p.shown.split("\n").filter((l) => l.trim() !== "")) {
                    expect(output, where).toContain(line.trim());
                }
            }
        }
        expect(costs).toBeGreaterThan(0);
    });
});
