import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import * as v8 from "node:v8";
import * as vm from "node:vm";
import { describe, expect, it, vi } from "vitest";
import { check, type Craft } from "@hinekora/core";
import { loadDefaultPoe1, registryOf } from "@hinekora/data";
import { parse } from "@hinekora/parser";

// The checker runs over every craft the repository shows, again and again:
// seconds each on a loaded machine. Coverage leaves this file out (it
// measures the heap, which instrumentation inflates); CI runs it plain.
vi.setConfig({ testTimeout: 120_000 });

const registry = registryOf(loadDefaultPoe1());
const root = join(import.meta.dirname, "../../..");

function parsed(source: string): Craft {
    const r = parse(source);
    if (!r.ok) throw new Error(r.error.message);
    return r.craft;
}

/** The site's pages and their generated parts, which hold no craft of their own. */
const SKIP = new Set(["node_modules", "public", "operations", ".vitepress", "scripts", "dist"]);

function walk(dir: string, ext: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
        if (SKIP.has(name)) continue;
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p, ext, out);
        else if (p.endsWith(ext)) out.push(p);
    }
    return out;
}

/** Every craft the repository shows: the examples, the site's craft files and
 *  the `hinekora` blocks of its pages that are whole crafts, read as
 *  site/scripts/check-examples.mjs reads them. */
function corpus(): { name: string; source: string }[] {
    const out: { name: string; source: string }[] = [];
    const name = (p: string): string => relative(root, p).replace(/\\/g, "/");
    const examples = join(root, "examples");
    for (const f of readdirSync(examples).filter((f) => f.endsWith(".craft"))) {
        out.push({ name: `examples/${f}`, source: readFileSync(join(examples, f), "utf8") });
    }
    const site = join(root, "site");
    for (const f of walk(join(site, "examples"), ".craft")) {
        out.push({ name: name(f), source: readFileSync(f, "utf8") });
    }
    for (const f of walk(site, ".md")) {
        const lines = readFileSync(f, "utf8").replace(/\r/g, "").split("\n");
        for (let i = 0; i < lines.length; i++) {
            if (!/^```hinekora\b/.test(lines[i]!)) continue;
            const end = lines.findIndex((l, at) => at > i && /^\s*```\s*$/.test(l));
            const above = lines.slice(0, i).findLast((l) => l.trim() !== "") ?? "";
            if (above !== "<!-- fragment -->") {
                out.push({
                    name: `${name(f)}:${i + 1}`,
                    source: lines.slice(i + 1, end).join("\n"),
                });
            }
            i = end;
        }
    }
    return out;
}

describe("the exact checker's memory", () => {
    it("settles over hundreds of checks run back to back, with no yield between them", () => {
        v8.setFlagsFromString("--expose-gc");
        const gc = vm.runInNewContext("gc") as () => void;
        const crafts = corpus().map(({ source }) => parsed(source));
        const batch = (): number => {
            for (const craft of crafts) check(craft, { registry });
            gc();
            return process.memoryUsage().heapUsed;
        };
        // The first batch fills what is kept per base and per registry.
        const settled = batch();
        for (let i = 0; i < 3; i++) {
            expect(batch() - settled).toBeLessThan(40e6);
        }
    });
});
