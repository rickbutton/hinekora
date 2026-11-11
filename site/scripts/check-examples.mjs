#!/usr/bin/env node
/**
 * Runs the checker over every craft the site shows, so a page cannot print
 * one the tool would answer differently: the files under examples/ and each
 * `hinekora` code block of a hand-written page. A craft must check. One the
 * page shows being refused says so, a file by a name ending in `-refused`, a
 * block by `<!-- refused -->` above its fence, and must then be
 * refused. A block that is a piece of a craft, not a whole one, is marked
 * `<!-- fragment -->` and is not run.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { check } from "@hinekora/core";
import { loadDefaultPoe1, registryOf } from "@hinekora/data";
import { parse } from "@hinekora/parser";

const site = join(dirname(fileURLToPath(import.meta.url)), "..");
const registry = registryOf(loadDefaultPoe1());

/** The operation pages are generated, their examples files this script reads anyway. */
const SKIP = new Set(["node_modules", "public", "operations", ".vitepress", "scripts"]);

function walk(dir, ext, out = []) {
    for (const name of readdirSync(dir)) {
        if (SKIP.has(name)) continue;
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p, ext, out);
        else if (p.endsWith(ext)) out.push(p);
    }
    return out;
}

const problems = [];
let run = 0;
let fragments = 0;

function verdict(where, source, refused) {
    run++;
    const parsed = parse(source);
    if (!parsed.ok) {
        problems.push(`${where}: does not parse: ${parsed.error.message}`);
        return;
    }
    const result = check(parsed.craft, { registry });
    if (refused && result.ok) problems.push(`${where}: shown as refused, but it checks`);
    if (!refused && !result.ok) {
        const first = result.diagnostics[0];
        problems.push(
            `${where}: line ${first.span.start.line}: ${first.message.replace(/\n/g, " / ")}`,
        );
    }
}

for (const file of walk(join(site, "examples"), ".craft")) {
    verdict(relative(site, file), readFileSync(file, "utf8"), /-refused\.craft$/.test(file));
}

for (const file of walk(site, ".md")) {
    const lines = readFileSync(file, "utf8").replace(/\r/g, "").split("\n");
    for (let i = 0; i < lines.length; i++) {
        if (!/^```hinekora\b/.test(lines[i])) continue;
        const end = lines.findIndex((line, at) => at > i && /^\s*```\s*$/.test(line));
        const where = `${relative(site, file)}:${i + 1}`;
        if (end < 0) {
            problems.push(`${where}: the code block is never closed`);
            break;
        }
        // The formatter sets a blank line between the mark and the fence.
        const above = lines.slice(0, i).findLast((line) => line.trim() !== "") ?? "";
        const mark = /^<!-- (refused|fragment) -->$/.exec(above)?.[1];
        if (mark === "fragment") fragments++;
        else verdict(where, lines.slice(i + 1, end).join("\n"), mark === "refused");
        i = end;
    }
}

for (const p of problems) console.error(p);
console.log(`site examples: ${run} run, ${fragments} fragments not run, ${problems.length} wrong`);
process.exit(problems.length > 0 ? 1 : 0);
