/**
 * Keep the docs honest against the code. Fails (exit 1) when a doc under docs/ or
 * the root CLAUDE.md:
 *
 *   - names a repo path in backticks that does not exist (bare file names and
 *     paths relative to a package's src resolve by suffix);
 *   - names a code symbol in backticks (camelCase / PascalCase, optionally dotted or
 *     called) that no source file defines or mentions outside a comment;
 *   - names, in language.md, a lowercase word in backticks that is not a word of the
 *     language (the parser's vocabulary, a method table word, a currency, a harvest tag);
 *   - omits a word of the language: every word of the parser's vocabulary and every
 *     harvest tag must be documented in language.md (a method or currency carries its
 *     own help in the code, which its type requires), the vocabulary and the method
 *     words must be coloured by the VSCode grammar, and every field of the checker's
 *     abstract state must be named in REFERENCE.md §4;
 *   - lets operations.md §2's primitives table drift from the `Op` union: each first
 *     column names a kind of `Op`, and every kind has a row;
 *   - links a poewiki.net page or section that the local wiki cache does not hold
 *     (skipped with a notice when the cache is absent, e.g. in CI);
 *   - outgrows its word budget, or is a file under docs/ that has no budget;
 *   - cites a question that QUESTIONS.md no longer holds (so does a source file);
 *   - keeps a question in QUESTIONS.md that is neither open nor answered, one longer
 *     than an entry's budget, or two under one number.
 *
 * Every doc is read by agents whose context it fills, and prose that restates the
 * code drifts from it; the budgets make growth a decision someone sees in a diff.
 *
 * Run as `pnpm docs:check`; part of the gate.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const problems = [];
const notes = [];
let wikiLinks = 0;
const fail = (file, line, msg) => problems.push(`${file}:${line}: ${msg}`);

// --- the corpus ------------------------------------------------------------

/** The word budget of every doc (whitespace-separated words, as `wc -w` counts). A new
 *  doc, or a raised budget, is a change to this table. */
const BUDGETS = {
    "CLAUDE.md": 1100,
    "docs/ARCHITECTURE.md": 2200,
    "docs/QUESTIONS.md": 4500,
    "docs/REFERENCE.md": 1300,
    "docs/ROADMAP.md": 600,
    "docs/cost.md": 1900,
    "docs/item-model.md": 1900,
    "docs/language.md": 2500,
    "docs/operations.md": 1400,
    "site/docs/index.md": 300,
    "site/docs/language/until.md": 500,
    "site/docs/syntax.md": 800,
    "site/how-it-works.md": 900,
    "site/index.md": 300,
    "site/playground/index.md": 50,
};
/** Generated from the method table on each build, so held to no budget. */
const SITE_GENERATED = "site/docs/operations/";
const QUESTION_BUDGET = 150;
const QUESTIONS = "docs/QUESTIONS.md";

const DOCS = ["CLAUDE.md", ...readdirSync(join(root, "docs")).map((f) => `docs/${f}`)].filter((f) =>
    f.endsWith(".md"),
);
/** Docs whose backticked identifiers must exist in the code. The item model uses its own
 *  spec vocabulary on purpose and is exempt; language.md is held to the language's
 *  vocabulary instead. */
const SYMBOL_DOCS = new Set([
    "CLAUDE.md",
    "docs/REFERENCE.md",
    "docs/ARCHITECTURE.md",
    "docs/ROADMAP.md",
    "docs/operations.md",
    "docs/cost.md",
]);
const LANGUAGE = "docs/language.md";
const REFERENCE = "docs/REFERENCE.md";
const GRAMMAR = "editors/vscode/syntaxes/hinekora.tmLanguage.json";
const VOCABULARY_FILE = "packages/parser/src/vocabulary.ts";
const METHODS_FILE = "packages/core/src/check/methods.ts";
const OPERATIONS = "docs/operations.md";
const OPS_FILE = "packages/core/src/check/ops.ts";

function walk(dir, pred, out = []) {
    for (const name of readdirSync(dir)) {
        if (
            name === "node_modules" ||
            name === "dist" ||
            name === "coverage" ||
            name.startsWith(".")
        )
            continue;
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p, pred, out);
        else if (pred(p)) out.push(p);
    }
    return out;
}

const sourceFiles = [
    ...readdirSync(root)
        .filter((f) => /\.(json|mjs|ts|yaml)$/.test(f))
        .map((f) => join(root, f)),
    ...walk(
        root,
        (p) =>
            /\.(ts|mjs|json|craft)$/.test(p) &&
            /[\\/](packages|scripts|tools|editors|examples)[\\/]/.test(p) &&
            !/[\\/]packages[\\/]data[\\/]data[\\/]/.test(p), // the ingested catalog; searched on demand below
    ),
];
/** Source text with comments removed, so a symbol that survives only in a comment
 *  does not count as existing. */
const stripComments = (text) =>
    text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:\\])\/\/[^\n]*/g, "$1");
const sourceText = sourceFiles.map((p) => stripComments(readFileSync(p, "utf8"))).join("\n");
let catalogText = null;
const inCatalog = (word) => {
    catalogText ??= walk(join(root, "packages/data/data"), (p) => p.endsWith(".json"))
        .map((p) => readFileSync(p, "utf8"))
        .join("\n");
    return catalogText.includes(word);
};

const read = (rel) => readFileSync(join(root, rel), "utf8");
const lines = (rel) => read(rel).split(/\r?\n/);
const block = (text, from, to) => {
    const start = text.indexOf(from);
    return text.slice(start, text.indexOf(to, start));
};

// --- the language's vocabulary, from the code ---------------------------------

const literals = (text) => [...text.matchAll(/"([A-Za-z][\w?]*)"/g)].map((m) => m[1]);
const vocabularySource = read(VOCABULARY_FILE);
const vocabulary = new Set([
    ...literals(vocabularySource),
    // The influence names and the eldritch tiers, which the vocabulary takes from the model.
    ...literals(block(read("packages/core/src/model/marks.ts"), "export const INFLUENCES", "]")),
    ...literals(
        block(read("packages/core/src/model/marks.ts"), "export const ELDRITCH_TIERS", "]"),
    ),
]);
/** The method table's words: each entry's `words: [...]` and each word slot's `oneOf`. */
const methodWords = new Set(
    [...read(METHODS_FILE).matchAll(/\b(?:words|oneOf): \[([^\]]*)\]/g)].flatMap((m) =>
        literals(m[1]),
    ),
);
const registry = read("packages/core/src/resolve/registry.ts");
const currencies = new Set(
    [...block(registry, "STANDARD_CURRENCIES", "];").matchAll(/name: "([a-z]+)"/g)].map(
        (m) => m[1],
    ),
);
const harvestTags = new Set(
    [...block(registry, "HARVEST_TAGS", "];").matchAll(/\["([a-z]+)", "[a-z]+"\]/g)].map(
        (m) => m[1],
    ),
);
const astate = read("packages/core/src/check/astate.ts");
const aitemFields = [
    ...block(astate, "export interface AItem {", "\n}").matchAll(/readonly (\w+):/g),
].map((m) => m[1]);
const languageWords = new Set([...vocabulary, ...methodWords, ...currencies, ...harvestTags]);

// --- 1. backticked tokens: paths, symbols, language words ------------------------

const PATH_RE =
    /^(?:\.\/)?(?:packages|docs|examples|scripts|tools|editors|\.claude|\.github)\/[\w./-]+$|^[\w-]+(?:\/[\w.-]+)*\.(?:md|mjs|json|ts|craft|yaml)$/;
const IDENT = /^[A-Za-z_$][\w$]*$/;
const isCodeLike = (s) => IDENT.test(s) && /[A-Z]/.test(s) && s.length >= 3;

function wordExists(word) {
    const re = new RegExp(`(?<![\\w$])${word.replace(/\$/g, "\\$")}(?![\\w$])`);
    return re.test(sourceText) || inCatalog(word);
}

/** Does a backticked path refer to something on disk? A bare name or a path relative
 *  to a package's src (`check/ops.ts`) resolves by suffix. */
function pathExists(p) {
    if (existsSync(join(root, p)) || existsSync(join(root, "docs", p))) return true;
    const rel = p.replace(/^\.\//, "");
    const suffix = rel.replaceAll("/", "\\");
    return sourceFiles.some((f) => f.endsWith(`\\${suffix}`) || f.endsWith(`/${rel}`));
}

for (const doc of DOCS) {
    let inFence = false;
    lines(doc).forEach((text, i) => {
        if (text.startsWith("```")) inFence = !inFence;
        if (inFence) return;
        for (const m of text.matchAll(/`([^`\n]+)`/g)) {
            const tok = m[1].trim();
            if (PATH_RE.test(tok)) {
                if (!pathExists(tok)) fail(doc, i + 1, `path does not exist: \`${tok}\``);
                continue;
            }
            if (doc === LANGUAGE) {
                if (/^[a-z][a-zA-Z]*$/.test(tok) && !languageWords.has(tok))
                    fail(doc, i + 1, `\`${tok}\` is not a word of the language`);
                continue;
            }
            if (!SYMBOL_DOCS.has(doc)) continue;
            // `Foo.bar`, `foo()`, `Foo[gen]` → the identifiers inside.
            const parts = tok
                .replace(/\(.*\)$/, "")
                .split(/[.[\]]/)
                .filter(Boolean);
            if (parts.length === 0 || parts.some((p) => !IDENT.test(p))) continue;
            for (const part of parts) {
                if (!isCodeLike(part)) continue;
                if (!wordExists(part))
                    fail(doc, i + 1, `no source file mentions \`${part}\` (from \`${tok}\`)`);
            }
        }
    });
}

// --- 2. the language is fully documented and highlighted ---------------------------

const language = read(LANGUAGE);
/** Is `word` written inside backticks (inline code or a fence) somewhere in language.md? */
const documented = (word) => new RegExp(`\`[^\`]*(?<![\w])${word}(?![\w])[^\`]*\``).test(language);
for (const w of vocabulary) {
    if (!documented(w)) fail(LANGUAGE, 1, `the word \`${w}\` is not documented`);
}
for (const t of harvestTags) {
    if (!documented(t)) fail(LANGUAGE, 1, `the harvest tag \`${t}\` is not documented`);
}
const grammar = read(GRAMMAR);
for (const w of [...vocabulary, ...methodWords]) {
    if (currencies.has(w)) continue; // currency names are coloured by semantic tokens
    if (!new RegExp(`[|(]${w}[|)]`).test(grammar))
        fail(GRAMMAR, 1, `the word \`${w}\` is not highlighted`);
}
const checkerSection = block(read(REFERENCE), "\n## 4.", "\n## 5.");
for (const f of aitemFields) {
    if (!new RegExp(`\`[^\`]*(?<![\w])${f}(?![\w])[^\`]*\``).test(checkerSection))
        fail(REFERENCE, 1, `AItem field \`${f}\` is not described in §4`);
}

// The primitives table of operations.md §2 names exactly the kinds of the `Op` union.
const opKinds = new Set(
    [...block(read(OPS_FILE), "export type Op =", ";\n").matchAll(/kind: "(\w+)"/g)].map(
        (m) => m[1],
    ),
);
const primitivesLines = lines(OPERATIONS);
const primitivesStart = primitivesLines.findIndex((l) => l.startsWith("## 2."));
const primitivesEnd = primitivesLines.findIndex(
    (l, i) => i > primitivesStart && l.startsWith("## "),
);
const tabled = new Set();
primitivesLines.slice(primitivesStart, primitivesEnd).forEach((text, i) => {
    const first = /^\|\s*`([a-z]\w*)`\s*\|/.exec(text);
    if (!first) return;
    tabled.add(first[1]);
    if (!opKinds.has(first[1]))
        fail(OPERATIONS, primitivesStart + i + 1, `\`${first[1]}\` is not a kind of \`Op\``);
});
for (const k of opKinds) {
    if (!tabled.has(k)) fail(OPERATIONS, primitivesStart + 1, `the op \`${k}\` is not in §2`);
}

// --- 3. wiki links resolve in the local cache ----------------------------------

const cacheDir = join(root, ".cache/poewiki/xml/index.json");
if (!existsSync(cacheDir)) {
    notes.push("wiki cache absent; wiki links not checked (see the poewiki-sync skill)");
} else {
    const { readPage } = await import("../tools/poewiki/lib.mjs");
    const pageCache = new Map();
    const page = (title) => {
        if (!pageCache.has(title)) {
            let p = readPage(title);
            if (p?.redirect) p = readPage(p.redirect);
            pageCache.set(title, p);
        }
        return pageCache.get(title);
    };
    const decodeAnchor = (a) =>
        decodeURIComponent(a.replace(/\.([0-9A-F]{2})/g, "%$1"))
            .replaceAll("_", " ")
            .replace(/\s+/g, " ")
            .trim();
    const headings = (wikitext) =>
        new Set(
            [...wikitext.matchAll(/^(=+)\s*(.*?)\s*\1\s*$/gm)].map((m) =>
                m[2]
                    .replace(/\[\[[^\]|]*\|([^\]]*)\]\]/g, "$1")
                    .replace(/\[\[([^\]]*)\]\]/g, "$1")
                    .replace(/\{\{[^}]*\}\}/g, "")
                    .replace(/'''?/g, "")
                    .replace(/<[^>]+>/g, "")
                    .replace(/\s+/g, " ")
                    .trim(),
            ),
        );
    for (const doc of DOCS) {
        lines(doc).forEach((text, i) => {
            for (const m of text.matchAll(
                /https:\/\/www\.poewiki\.net\/wiki\/([^#\s)>]+)(?:#([^\s)>]+))?/g,
            )) {
                wikiLinks++;
                const title = decodeURIComponent(m[1]).replaceAll("_", " ");
                const p = page(title);
                if (!p) {
                    fail(doc, i + 1, `wiki page not in the cache: ${title}`);
                    continue;
                }
                if (m[2] === undefined) continue;
                const anchor = decodeAnchor(m[2]);
                if (!headings(p.wikitext).has(anchor))
                    fail(doc, i + 1, `no section "${anchor}" on wiki page ${p.title}`);
            }
        });
    }
}

// --- 4. size: the doc budgets and the questions ledger --------------------------

const wordCount = (text) => text.split(/\s+/).filter(Boolean).length;
const sizes = [];
for (const p of walk(join(root, "docs"), () => true)) {
    const rel = relative(root, p).replaceAll("\\", "/");
    if (!(rel in BUDGETS))
        fail(rel, 1, "no word budget for this file; docs/ holds only the docs in BUDGETS");
}
for (const p of walk(join(root, "site"), (f) => f.endsWith(".md"))) {
    const rel = relative(root, p).replaceAll("\\", "/");
    if (!(rel in BUDGETS) && !rel.startsWith(SITE_GENERATED))
        fail(rel, 1, "no word budget for this page; a site page is brief by decision");
}
for (const [doc, budget] of Object.entries(BUDGETS)) {
    if (!existsSync(join(root, doc))) {
        fail(doc, 1, "has a budget but does not exist");
        continue;
    }
    const words = wordCount(read(doc));
    sizes.push(`${doc.replace(/^docs\//, "")} ${words}/${budget}`);
    if (words > budget)
        fail(doc, 1, `${words} words, over its budget of ${budget}: cut before adding`);
}
// An entry runs from its heading to the next heading of any level.
const questionLines = lines(QUESTIONS);
const questionAt = new Map();
questionLines.forEach((text, i) => {
    const m = /^### (Q\d+) · \w+ · (\w+)/.exec(text);
    if (m === null) return;
    const first = questionAt.get(m[1]);
    if (first !== undefined)
        fail(QUESTIONS, i + 1, `${m[1]} is also the number of the entry at line ${first}`);
    else questionAt.set(m[1], i + 1);
    if (m[2] !== "open" && m[2] !== "answered")
        fail(QUESTIONS, i + 1, `${m[1]} is ${m[2]}; an applied answer is deleted, not kept`);
    const end = questionLines.findIndex((t, j) => j > i && /^#{1,3} /.test(t));
    const words = wordCount(questionLines.slice(i + 1, end === -1 ? undefined : end).join(" "));
    if (words > QUESTION_BUDGET)
        fail(QUESTIONS, i + 1, `${m[1]} is ${words} words, over ${QUESTION_BUDGET}`);
});
// A question cited anywhere must still be in the ledger: a deleted one leaves the
// citation pointing at nothing, so the citing text should state the rule instead.
const citing = [
    ...DOCS.map((d) => join(root, d)),
    ...sourceFiles.filter((p) => /\.(ts|mjs|craft)$/.test(p)),
];
for (const p of citing) {
    const rel = relative(root, p).replaceAll("\\", "/");
    readFileSync(p, "utf8")
        .split(/\r?\n/)
        .forEach((text, i) => {
            if (rel === QUESTIONS && /^### Q\d+|continue from Q\d+/.test(text)) return;
            for (const m of text.matchAll(/\bQ(\d{1,3})\b/g)) {
                if (!questionAt.has(`Q${m[1]}`))
                    fail(rel, i + 1, `cites Q${m[1]}, which QUESTIONS.md no longer holds`);
            }
        });
}

// --- report --------------------------------------------------------------------

for (const n of notes) console.log(`note: ${n}`);
console.log(`doc words: ${sizes.join(", ")}`);
if (problems.length > 0) {
    for (const p of problems) console.log(p.replace(/\\/g, "/"));
    console.log(
        `\n${problems.length} doc problem(s); see ${relative(root, fileURLToPath(import.meta.url))}`,
    );
    process.exit(1);
}
console.log(
    `docs ok: ${DOCS.length} files, ${vocabulary.size + methodWords.size} words, ${currencies.size} currencies, ${wikiLinks} wiki links`,
);
