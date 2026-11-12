import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { check, itemView, renderItemText, type TraceEntry } from "@hinekora/core";
import { loadDefaultPoe1, registryOf } from "@hinekora/data";
import { parse } from "@hinekora/parser";

// Every state of every craft the repository shows, drawn: seconds on a loaded machine.
vi.setConfig({ testTimeout: 120_000 });

const registry = registryOf(loadDefaultPoe1());
const root = fileURLToPath(new URL("../../../", import.meta.url));

function walk(dir: string, ext: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
        if (name === "node_modules" || name === "public" || name.startsWith(".")) continue;
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p, ext, out);
        else if (p.endsWith(ext)) out.push(p);
    }
    return out;
}

/** The crafts the repository shows: its examples, the site's, each page's blocks. */
function crafts(): { name: string; source: string }[] {
    const out: { name: string; source: string }[] = [];
    for (const f of [
        ...walk(join(root, "examples"), ".craft"),
        ...walk(join(root, "site", "examples"), ".craft"),
    ]) {
        out.push({ name: relative(root, f), source: readFileSync(f, "utf8") });
    }
    for (const f of walk(join(root, "site"), ".md")) {
        const text = readFileSync(f, "utf8").replace(/\r/g, "");
        for (const m of text.matchAll(/(<!-- fragment -->\n\n)?```hinekora\n([\s\S]*?)```/g)) {
            if (m[1] === undefined) out.push({ name: relative(root, f), source: m[2]! });
        }
    }
    return out;
}

/** A word only an id is: two capitalised parts run together ("VeiledPrefix"),
 *  a word with a number on its end ("Life1"), or a trailing underscore. */
const ID = /\b(?:[A-Z][a-z]+){2,}\d*\b|\b[A-Z][a-z]+\d+\b|\b\w+_(?![\w])/;

describe("an item as the tool draws it", () => {
    it.each(crafts())("holds no id at any step of $name", ({ source }) => {
        const parsed = parse(source);
        if (!parsed.ok) return;
        const result = check(parsed.craft, { registry });
        const each = (trace: readonly TraceEntry[]): void => {
            for (const e of trace) {
                for (const s of [e.before, e.after]) {
                    if (s === undefined) continue;
                    const text = renderItemText(itemView(s, registry, parsed.craft));
                    expect(text.match(ID)?.[0]).toBeUndefined();
                }
                if (e.inlined !== undefined) each(e.inlined.trace);
            }
        };
        each(result.trace);
    });
});
