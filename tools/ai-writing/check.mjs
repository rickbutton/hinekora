#!/usr/bin/env node
/**
 * AI-writing check: run the vendored detector over a file (arg) or stdin.
 * Prints flagged spans; exits non-zero only when the score clears a hard
 * threshold (AIW_THRESHOLD, default 40) — em-dash-only flags warn but don't block.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const AIDetector = require(join(dirname(fileURLToPath(import.meta.url)), "patterns.js"));

const THRESHOLD = Number(process.env.AIW_THRESHOLD ?? 40);
const arg = process.argv[2];
const text = arg ? readFileSync(arg, "utf8") : readFileSync(0, "utf8");
const label = arg ?? "stdin";

const r = AIDetector.analyzeText(text, { contextMode: "technical" });
if (!r.issues.length) {
    process.exit(0);
}

const em = r.issues.filter((i) => i.type === "em-dash").length;
const other = r.issues.filter((i) => i.type !== "em-dash");
console.error(`ai-writing: ${label} — score ${r.score} (${r.label})`);
for (const i of other) {
    const snip = (i.text || "").replace(/\s+/g, " ").slice(0, 80);
    console.error(`  [${i.severity ?? "?"}] ${i.type}: ${JSON.stringify(snip)}`);
}
if (em) console.error(`  em-dash density flagged (${em})`);

process.exit(r.score >= THRESHOLD ? 1 : 0);
