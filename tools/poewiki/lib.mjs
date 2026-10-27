/**
 * Shared plumbing for the poewiki tooling: the cache layout, a throttled HTTP
 * client that respects the wiki's rate limits, the XML page index, Cargo table
 * export, and the HTML-to-Markdown conversion used when rendering pages.
 *
 * The cache root is `POEWIKI_CACHE` or `<repo>/.cache/poewiki`:
 *   xml/ns<N>/batch-NNNN.xml   full snapshot, 500 pages per file (export.mjs)
 *   xml/updates/<pageid>.xml   pages re-exported since the snapshot (sync.mjs)
 *   xml/index.json             title -> { ns, id, file }
 *   cargo/<table>.jsonl        every Cargo table, one row per line
 *   md/<title>.md              rendered pages (render.mjs)
 *   state.json                 last sync timestamp
 *
 * Env: POEWIKI_CACHE (cache root), POEWIKI_DELAY_MS (gap between requests,
 * default 3000, never below 1000), POEWIKI_CONTACT (put in the user agent).
 */
import {
    appendFileSync,
    existsSync,
    mkdirSync,
    readdirSync,
    readFileSync,
    unlinkSync,
    writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";

export const WIKI = "https://www.poewiki.net";
export const API = `${WIKI}/w/api.php`;
const INDEX_PHP = `${WIKI}/index.php`;
const UA = `hinekora-research/0.1 (${process.env.POEWIKI_CONTACT ?? "no contact set"})`;

export const CACHE =
    process.env.POEWIKI_CACHE ?? fileURLToPath(new URL("../../.cache/poewiki", import.meta.url));
export const paths = {
    xml: join(CACHE, "xml"),
    updates: join(CACHE, "xml", "updates"),
    index: join(CACHE, "xml", "index.json"),
    cargo: join(CACHE, "cargo"),
    md: join(CACHE, "md"),
    state: join(CACHE, "state.json"),
};

// Content namespaces: main, project, Template, Help, Category, Module, and the
// custom data namespaces (Mastery, Passive Skill, Modifier, Monster, Stat,
// Skill, Area, Guide, Map).
export const CONTENT_NS = [
    0, 4, 10, 12, 14, 828, 10000, 10002, 10004, 10006, 10008, 10010, 10012, 10014, 10016,
];

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const log = (...m) => console.error(new Date().toISOString().slice(11, 19), ...m);

// ---------------------------------------------------------------------------
// HTTP. The wiki throttles aggressive clients; a 429 is waited out, never
// retried quickly, and the floor on the request gap is deliberate.
// ---------------------------------------------------------------------------

const DELAY_MS = Math.max(1000, Number(process.env.POEWIKI_DELAY_MS ?? 3000));
let requests = 0;

export const requestCount = () => requests;

async function get(base, params) {
    const url = new URL(base);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
    for (let attempt = 1; ; attempt++) {
        await sleep(DELAY_MS);
        requests++;
        const res = await fetch(url, { headers: { "User-Agent": UA } });
        if (res.status === 429) {
            const retryAfter = Number(res.headers.get("retry-after") ?? 0) * 1000;
            const wait = Math.max(retryAfter, 60_000 * Math.min(attempt, 5));
            log(`throttled (429), waiting ${wait / 1000}s`);
            await sleep(wait);
            continue;
        }
        if (res.status >= 500) {
            if (attempt >= 5) throw new Error(`HTTP ${res.status} from ${url.pathname}`);
            await sleep(5_000 * 2 ** attempt);
            continue;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
        return await res.text();
    }
}

export async function api(params) {
    const body = JSON.parse(await get(API, { format: "json", formatversion: "2", ...params }));
    if (body.error) throw new Error(`${body.error.code}: ${body.error.info}`);
    return body;
}

// ---------------------------------------------------------------------------
// Cargo tables. Special:CargoExport returns a plain JSON array and allows far
// more rows per request than the API's 500, but its output is cut off at 2 MiB
// and, for slow tables, sometimes well before that; a cut-off body fails to
// parse and the batch is halved. An HTML body is the wiki's error page.
// ---------------------------------------------------------------------------

const CARGO_BATCH = 1000;
const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', "#039": "'", "#39": "'" };
// CargoExport HTML-escapes every string value.
const decodeEntities = (_key, value) =>
    typeof value === "string"
        ? value.replace(/&(amp|lt|gt|quot|#0?39);/g, (_, e) => ENTITIES[e])
        : value;

async function cargoExport(params) {
    for (let attempt = 1; ; attempt++) {
        const text = await get(INDEX_PHP, {
            title: "Special:CargoExport",
            format: "json",
            ...params,
        });
        if (text.trimStart().startsWith("<")) {
            if (attempt >= 3) throw new Error("Special:CargoExport answered with an error page");
            await sleep(30_000 * attempt);
            continue;
        }
        try {
            return JSON.parse(text);
        } catch {
            return null;
        }
    }
}

const restoreKeys = (row) =>
    Object.fromEntries(Object.entries(row).map(([k, v]) => [k.replaceAll(" ", "_"), v]));

export async function listCargoTables() {
    return (await api({ action: "cargotables" })).cargotables;
}

/** Re-exports one Cargo table in full, replacing `cargo/<table>.jsonl`. */
export async function exportTable(table) {
    mkdirSync(paths.cargo, { recursive: true });
    const names = Object.keys((await api({ action: "cargofields", table })).cargofields ?? {});
    if (!names.length) return log(`${table}: no fields, skipped`);
    // Field names go unaliased to keep the URL short (a wide table with
    // aliases overflows it); Cargo answers with spaces for underscores, which
    // `restoreKeys` undoes. The meta fields (_pageName, _ID...) cannot be
    // selected on this wiki, though _ID still works in order_by.
    const fields = names.map((f) => `${table}.${f}`).join(",");
    const out = join(paths.cargo, `${table}.jsonl`);
    const tmp = `${out}.tmp`;
    writeFileSync(tmp, "");
    let offset = 0;
    let rows = 0;
    let limit = CARGO_BATCH;
    for (;;) {
        const page = await cargoExport({
            tables: table,
            fields,
            limit,
            offset,
            order_by: `${table}._ID`,
        });
        if (page === null) {
            if (limit <= 50) throw new Error(`${table}: rows too wide for Special:CargoExport`);
            limit = Math.floor(limit / 2);
            continue;
        }
        appendFileSync(
            tmp,
            page.map((r) => JSON.stringify(restoreKeys(r), decodeEntities)).join("\n") +
                (page.length ? "\n" : ""),
        );
        rows += page.length;
        if (page.length < limit) break;
        offset += limit;
    }
    writeFileSync(out, readFileSync(tmp));
    unlinkSync(tmp);
    log(`${table}: ${rows} rows`);
    return rows;
}

// ---------------------------------------------------------------------------
// XML pages. The snapshot is immutable; sync writes newer revisions to the
// updates overlay, and the index points each title at whichever file is
// current. Lookups never scan the snapshot.
// ---------------------------------------------------------------------------

const XML_ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", "#039": "'" };
export const decodeXml = (s) =>
    s
        .replace(/&(amp|lt|gt|quot|apos|#039);/g, (_, e) => XML_ENTITIES[e])
        .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
const encodeXml = (s) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const PAGE_HEAD = /<page>\s*<title>([^<]*)<\/title>\s*<ns>(\d+)<\/ns>\s*<id>(\d+)<\/id>/g;

/** Splits an export document into its `<page>` elements. */
export function splitPages(xml) {
    const pages = [];
    for (const m of xml.matchAll(PAGE_HEAD)) {
        const end = xml.indexOf("</page>", m.index);
        pages.push({
            title: decodeXml(m[1]),
            ns: Number(m[2]),
            id: Number(m[3]),
            xml: xml.slice(m.index, end + "</page>".length),
        });
    }
    return pages;
}

export function buildIndex() {
    const index = {};
    const add = (file) => {
        const rel = file.slice(paths.xml.length + 1).replaceAll("\\", "/");
        for (const p of splitPages(readFileSync(file, "utf8")))
            index[p.title] = { ns: p.ns, id: p.id, file: rel };
    };
    for (const dir of readdirSync(paths.xml).filter((d) => /^ns\d+$/.test(d))) {
        for (const f of readdirSync(join(paths.xml, dir)).filter((f) => f.endsWith(".xml")))
            add(join(paths.xml, dir, f));
    }
    // The overlay is read last so a re-exported page wins over the snapshot.
    if (existsSync(paths.updates)) {
        for (const f of readdirSync(paths.updates).filter((f) => f.endsWith(".xml")))
            add(join(paths.updates, f));
    }
    writeFileSync(paths.index, JSON.stringify(index));
    return index;
}

let indexCache;
export function loadIndex() {
    if (indexCache) return indexCache;
    if (!existsSync(paths.index)) {
        if (!existsSync(paths.xml))
            throw new Error(`no snapshot at ${paths.xml}; run tools/poewiki/export.mjs first`);
        return (indexCache = buildIndex());
    }
    return (indexCache = JSON.parse(readFileSync(paths.index, "utf8")));
}

export function saveIndex(index) {
    indexCache = index;
    writeFileSync(paths.index, JSON.stringify(index));
}

/** The cached page for a title: its wikitext and redirect target, or null. */
export function readPage(title) {
    const entry = loadIndex()[title];
    if (!entry) return null;
    const xml = readFileSync(join(paths.xml, entry.file), "utf8");
    const start = xml.indexOf(`<title>${encodeXml(title)}</title>`);
    if (start < 0) return null;
    const open = xml.lastIndexOf("<page>", start);
    const page = xml.slice(open, xml.indexOf("</page>", start));
    const text = page.match(/<text[^>]*>([\s\S]*?)<\/text>/);
    const redirect = page.match(/<redirect title="([^"]*)"/);
    return {
        title,
        ns: entry.ns,
        id: entry.id,
        redirect: redirect ? decodeXml(redirect[1]) : null,
        wikitext: text ? decodeXml(text[1]) : "",
    };
}

export function writeOverlayPage(page) {
    mkdirSync(paths.updates, { recursive: true });
    writeFileSync(join(paths.updates, `${page.id}.xml`), page.xml);
    return `updates/${page.id}.xml`;
}

// ---------------------------------------------------------------------------
// Rendering. The wiki's own parser expands templates and Cargo queries into
// HTML; turndown turns that into Markdown. Hidden hover boxes, the TOC, edit
// links and navboxes are dropped, images reduce to their alt text, and links
// become absolute.
// ---------------------------------------------------------------------------

const DROP_CLASSES = [
    "mw-editsection",
    "navbox",
    "hoverbox__display",
    "c-item-hoverbox__display",
    "c-tooltip__display",
    "mw-cite-backlink",
    "mwe-math-mathml-a11y",
    "noprint",
    "catlinks",
];

function converter() {
    const td = new TurndownService({
        headingStyle: "atx",
        codeBlockStyle: "fenced",
        bulletListMarker: "-",
    });
    td.use(gfm);
    td.remove(["style", "script", "noscript"]);
    td.remove((node) => node.id === "toc" || DROP_CLASSES.some((c) => node.classList?.contains(c)));
    td.addRule("image", {
        filter: "img",
        replacement: (_content, node) => node.getAttribute("alt") ?? "",
    });
    td.addRule("link", {
        filter: (node) => node.nodeName === "A" && node.getAttribute("href"),
        replacement: (content, node) => {
            const href = node.getAttribute("href");
            if (!content.trim() || href.startsWith("#")) return content;
            return `[${content}](${href.startsWith("/") ? WIKI + href : href})`;
        },
    });
    // A pipe table cannot hold a newline; cells with paragraphs or line breaks
    // collapse onto one line. Added after gfm, so it takes precedence.
    td.addRule("tableCell", {
        filter: ["th", "td"],
        replacement: (content, node) => {
            const flat = content
                .replace(/\s*\n\s*/g, " ")
                .replace(/\|/g, "\\|")
                .trim();
            const first = node.parentNode.firstElementChild === node;
            return `${first ? "| " : " "}${flat} |`;
        },
    });
    return td;
}

export function htmlToMarkdown(html) {
    return converter()
        .turndown(html)
        .replace(/\n{3,}/g, "\n\n")
        .trim();
}

export const titleToFile = (title) => `${title.replace(/[\\/:*?"<>|]/g, "_")}.md`;
export const mdPath = (title) => join(paths.md, titleToFile(title));

/**
 * Renders one page through the wiki's parser into `md/<title>.md`. Follows
 * redirects, so the file is named after the resolved title. Returns the path
 * and whether the cache already had it.
 */
export async function renderPage(title, { force = false } = {}) {
    mkdirSync(paths.md, { recursive: true });
    const local = readPage(title);
    const resolved = local?.redirect ?? title;
    const file = mdPath(resolved);
    if (!force && existsSync(file)) return { title: resolved, file, cached: true };
    const { parse } = await api({
        action: "parse",
        page: title,
        redirects: 1,
        prop: "text|categories|revid",
        disableeditsection: 1,
        disablelimitreport: 1,
        disabletoc: 1,
    });
    const out = mdPath(parse.title);
    const front = [
        "---",
        `title: ${JSON.stringify(parse.title)}`,
        `url: ${WIKI}/wiki/${encodeURIComponent(parse.title.replaceAll(" ", "_"))}`,
        `pageid: ${parse.pageid}`,
        `revid: ${parse.revid}`,
        `rendered: ${new Date().toISOString()}`,
        `categories: ${JSON.stringify(parse.categories.map((c) => c.category))}`,
        "---",
        "",
    ].join("\n");
    writeFileSync(out, `${front}# ${parse.title}\n\n${htmlToMarkdown(parse.text)}\n`);
    return { title: parse.title, file: out, cached: false };
}

export function invalidateRendered(title) {
    const file = mdPath(title);
    if (existsSync(file)) {
        unlinkSync(file);
        return true;
    }
    return false;
}

export function readState() {
    return existsSync(paths.state) ? JSON.parse(readFileSync(paths.state, "utf8")) : {};
}

export function writeState(state) {
    mkdirSync(CACHE, { recursive: true });
    writeFileSync(paths.state, JSON.stringify(state, null, 4) + "\n");
}

export function parseArgs(argv) {
    const flags = new Map();
    const positional = [];
    for (const a of argv) {
        if (a.startsWith("--")) {
            const [k, v] = a.slice(2).split("=");
            flags.set(k, v ?? true);
        } else {
            positional.push(a);
        }
    }
    return { flags, positional };
}
