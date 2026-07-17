/**
 * Render `coverage/coverage-summary.json` as GitHub-flavoured Markdown on stdout.
 * CI redirects this into `$GITHUB_STEP_SUMMARY`, so the coverage report is viewable
 * directly on each commit's Actions run page — no artifact download needed.
 */
import { readFileSync } from "node:fs";
import { relative } from "node:path";

const data = JSON.parse(readFileSync("coverage/coverage-summary.json", "utf8"));

const pct = (m) => `${m.pct}%`;
const cov = (m) => `${m.covered}/${m.total}`;
const out = [];

out.push("## Coverage", "");
out.push("| metric | % | covered / total |", "| --- | --- | --- |");
for (const k of ["lines", "statements", "functions", "branches"]) {
    out.push(`| ${k} | ${pct(data.total[k])} | ${cov(data.total[k])} |`);
}

const files = Object.keys(data)
    .filter((k) => k !== "total")
    .map((k) => ({ file: relative(process.cwd(), k).replaceAll("\\", "/"), m: data[k] }))
    .sort((a, b) => a.file.localeCompare(b.file));

out.push("", "<details><summary>Per-file coverage</summary>", "");
out.push("| file | lines | branches | funcs |", "| --- | --- | --- | --- |");
for (const { file, m } of files) {
    out.push(`| ${file} | ${pct(m.lines)} | ${pct(m.branches)} | ${pct(m.functions)} |`);
}
out.push("", "</details>");

process.stdout.write(out.join("\n") + "\n");
