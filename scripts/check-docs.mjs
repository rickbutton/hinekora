/**
 * Keep the docs honest against the code. Fails (exit 1) when a doc under docs/ or
 * the root CLAUDE.md:
 *
 *   - names a repo path in backticks that does not exist;
 *   - names a code symbol in backticks (camelCase / PascalCase, optionally dotted or
 *     called) that no source file defines or mentions;
 *   - omits a piece of the language's surface vocabulary: every keyword the parser
 *     accepts, every currency name, every harvest tag, and every field of the
 *     checker's abstract state must be named where the docs describe them, and the
 *     keywords must also be coloured by the VSCode grammar;
 *   - links a poewiki.net page or section that the local wiki cache does not hold
 *     (skipped with a notice when the cache is absent, e.g. in CI).
 *
 * Run as `pnpm docs:check`; part of the gate.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const problems = [];
let wikiLinks = 0;
const notes = [];
const fail = (file, line, msg) => problems.push(`${file}:${line}: ${msg}`);

// --- the corpus ------------------------------------------------------------

const DOCS = ["CLAUDE.md", ...readdirSync(join(root, "docs")).map((f) => `docs/${f}`)].filter((f) =>
    f.endsWith(".md"),
);
/** Docs whose backticked identifiers must exist in the code. The design docs and the
 *  item model use their own spec vocabulary on purpose and are exempt. */
const SYMBOL_DOCS = new Set([
    "CLAUDE.md",
    "docs/REFERENCE.md",
    "docs/ARCHITECTURE.md",
    "docs/ROADMAP.md",
]);

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
const sourceText = sourceFiles.map((p) => readFileSync(p, "utf8")).join("\n");
let catalogText = null;
const inCatalog = (word) => {
    catalogText ??= walk(join(root, "packages/data/data"), (p) => p.endsWith(".json"))
        .map((p) => readFileSync(p, "utf8"))
        .join("\n");
    return catalogText.includes(word);
};

const read = (rel) => readFileSync(join(root, rel), "utf8");
const lines = (rel) => read(rel).split(/\r?\n/);

// --- 1. paths and symbols in backticks ---------------------------------------

const PATH_RE =
    /^(?:\.\/)?(?:packages|docs|examples|scripts|tools|editors|\.claude|\.github)\/[\w./-]+$|^[\w-]+\.(?:md|mjs|json|ts|craft|yaml)$/;
const IDENT = /^[A-Za-z_$][\w$]*$/;
const isCodeLike = (s) => IDENT.test(s) && /[A-Z]/.test(s) && s.length >= 3;

function wordExists(word) {
    const re = new RegExp(`(?<![\\w$])${word.replace(/\$/g, "\\$")}(?![\\w$])`);
    return re.test(sourceText) || inCatalog(word);
}

/** Does a backticked path refer to something on disk? Bare file names resolve by
 *  basename anywhere under the source roots. */
function pathExists(p) {
    if (existsSync(join(root, p))) return true;
    const base = p.split("/").pop();
    return sourceFiles.some((f) => f.endsWith(`${"/"}${base}`) || f.endsWith(`\\${base}`));
}

for (const doc of DOCS) {
    lines(doc).forEach((text, i) => {
        for (const m of text.matchAll(/`([^`\n]+)`/g)) {
            const tok = m[1].trim();
            if (PATH_RE.test(tok) && tok.includes("/")) {
                if (!pathExists(tok)) fail(doc, i + 1, `path does not exist: \`${tok}\``);
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

// --- 2. the surface vocabulary ----------------------------------------------

const parser = read("packages/parser/src/parser.ts");
const keywords = new Set(
    [...parser.matchAll(/(?:atKeyword|expectKeyword)\("([a-zA-Z]+)"\)/g)].map((m) => m[1]),
);
const registry = read("packages/core/src/resolve/registry.ts");
const currencyBlock = registry.slice(registry.indexOf("STANDARD_CURRENCIES"));
const currencies = new Set(
    [...currencyBlock.slice(0, currencyBlock.indexOf("];")).matchAll(/name: "([a-z]+)"/g)].map(
        (m) => m[1],
    ),
);
const harvestBlock = registry.slice(registry.indexOf("HARVEST_TAG_LABELS"));
const harvestTags = new Set(
    [...harvestBlock.slice(0, harvestBlock.indexOf("];")).matchAll(/"([a-z]+)"/g)].map((m) => m[1]),
);
const astate = read("packages/core/src/check/astate.ts");
const aitemBlock = astate.slice(astate.indexOf("export interface AItem {"));
const aitemFields = [
    ...aitemBlock.slice(0, aitemBlock.indexOf("\n}")).matchAll(/readonly (\w+):/g),
].map((m) => m[1]);

const mentions = (doc, word) =>
    new RegExp(`(?<![\\w"])${word}(?![\\w"])`).test(read(doc)) ||
    read(doc).includes(`\`${word}`) ||
    read(doc).includes(`"${word}"`);

const SURFACE = "docs/crafting-lang-surface-v0.md";
const REFERENCE = "docs/REFERENCE.md";
const GRAMMAR = "editors/vscode/syntaxes/hinekora.tmLanguage.json";
const grammar = read(GRAMMAR);
for (const k of keywords) {
    if (!mentions(SURFACE, k)) fail(SURFACE, 1, `parser keyword \`${k}\` is not described`);
    if (!new RegExp(`[|(]${k}[|)]`).test(grammar))
        fail(GRAMMAR, 1, `keyword \`${k}\` is not highlighted`);
}
for (const c of currencies) {
    if (!mentions(SURFACE, c) && !mentions(REFERENCE, c))
        fail(
            REFERENCE,
            1,
            `currency \`${c}\` is not described in the surface doc or the reference`,
        );
}
for (const t of harvestTags) {
    if (!mentions(SURFACE, t)) fail(SURFACE, 1, `harvest tag \`${t}\` is not listed`);
}
for (const f of aitemFields) {
    if (!mentions(REFERENCE, f)) fail(REFERENCE, 1, `AItem field \`${f}\` is not described in §4`);
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

// --- report --------------------------------------------------------------------

for (const n of notes) console.log(`note: ${n}`);
if (problems.length > 0) {
    for (const p of problems) console.log(p.replace(/\\/g, "/"));
    console.log(
        `\n${problems.length} doc problem(s); see ${relative(root, fileURLToPath(import.meta.url))}`,
    );
    process.exit(1);
}
console.log(
    `docs ok: ${DOCS.length} files, ${keywords.size} keywords, ${currencies.size} currencies, ${wikiLinks} wiki links`,
);
