#!/usr/bin/env node
/**
 * Writes the operations reference under docs/operations/ from the method
 * table the parser, completion, hover and the checker all read
 * (`METHODS` in @hinekora/core): each page's syntax, argument list and
 * description are the table's, its example a line of a guide in examples/,
 * its wiki link the one docs/operations.md gives the method. What a page
 * says of an operation comes from the table, so it changes with it; only the
 * grouping (FAMILIES, where a new first word lands in "Other") and the
 * wording around the table's text are kept here.
 *
 * Only the operations in PAGES get a page of their own for now; the index
 * lists them all.
 */
import {
    copyFileSync,
    existsSync,
    mkdirSync,
    readdirSync,
    readFileSync,
    writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { METHODS } from "@hinekora/core";

const site = join(dirname(fileURLToPath(import.meta.url)), "..");
const repo = join(site, "..");
const out = join(site, "docs", "operations");
const icons = join(site, "public", "op-icons");
const GITHUB = "https://github.com/rickbutton/hinekora/blob/main";

const PAGES = new Set(["essence", "harvest-reforge", "bench"]);

/** The families the index groups operations under, by their first word. */
const FAMILIES = [
    [
        "Orbs",
        [
            "transmute",
            "augment",
            "alteration",
            "regal",
            "alchemy",
            "chaos",
            "exalt",
            "annul",
            "divine",
            "scour",
            "fracture",
            "foulborn",
        ],
    ],
    ["Influence and the Eldritch", ["ember", "ichor", "eldritch", "dominance", "conflict"]],
    ["Corruption", ["vaal", "locus", "tainted"]],
    ["Crafting bench", ["bench"]],
    ["Essences and fossils", ["essence", "fossil"]],
    ["Harvest", ["harvest"]],
    ["Veiled modifiers", ["veiled", "unveil"]],
    ["Bestiary", ["beast", "restore"]],
];

const slugOf = (m) => m.words.join("-");
const escape = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function familyOf(m) {
    // An influenced exalt reads as the influence's own orb.
    if (m.words[0] === "exalt" && m.words.length > 1) return "Influence and the Eldritch";
    return FAMILIES.find(([, firsts]) => firsts.includes(m.words[0]))?.[0] ?? "Other";
}

/**
 * A method's help line is "<syntax> — <description>", or for a plain
 * currency "<orb's name> — <description>". The sentences that say what the
 * item needs are pulled out of the description.
 */
function readDoc(m) {
    const cut = m.doc.indexOf(" — ");
    const head = m.doc.slice(0, cut);
    const body = m.doc.slice(cut + 3);
    const own = head.startsWith(m.words.join(" "));
    const sentences = body
        .split(/(?<=\.)\s+(?=[A-Z])/)
        .flatMap((s) => s.split(/; (?=needs )/))
        .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
        .map((s) => (/[.!]$/.test(s) ? s : `${s}.`));
    const needs = sentences.filter((s) => s.startsWith("Needs "));
    return {
        syntax: own ? head : m.words.join(" "),
        title: own ? undefined : head,
        does: sentences.filter((s) => !needs.includes(s)),
        needs,
        summary: sentences[0] ?? "",
    };
}

const SLOT_NOUN = {
    mod: "a modifier name",
    essence: "an essence name",
    bench: "a bench craft's name",
    fossil: "a fossil name",
    aspect: "an Aspect's animal",
    tag: "a harvest tag",
};

function slotText(slot) {
    switch (slot.kind) {
        case "name":
            return `${SLOT_NOUN[slot.of]}, quoted${slot.optional ? " (optional)" : ""}`;
        case "names":
            return `one to ${slot.max} of ${SLOT_NOUN[slot.of].replace(/^an? /, "")}s, each quoted`;
        case "word":
            return `one of ${slot.oneOf.map((w) => `\`${w}\``).join(", ")}`;
        case "int":
            return `a number${slot.optional ? " (optional)" : ""}`;
        case "tier":
            return `a tier, \`t1\` the best${slot.optional ? " (optional)" : ""}`;
    }
    return "";
}

/** The wiki links of docs/operations.md's table of built methods, by surface. */
function wikiLinks() {
    const doc = readFileSync(join(repo, "docs", "operations.md"), "utf8");
    const links = new Map();
    for (const line of doc.split("\n")) {
        const cells = line.split("|").map((c) => c.trim());
        if (cells.length < 4) continue;
        const urls = [...cells[1].matchAll(/\[([^\]]+)\]\((https:\/\/www\.poewiki\.net[^)]+)\)/g)];
        const surfaces = [...cells[2].matchAll(/`([^`]+)`/g)].map((s) =>
            s[1].replace(/<[^>]+>/g, "*").trim(),
        );
        if (urls.length === 0 || surfaces.length === 0) continue;
        surfaces.forEach((surface, i) => {
            const url = urls.length === surfaces.length ? urls[i] : urls[0];
            if (!links.has(surface)) links.set(surface, { text: url[1], href: url[2] });
        });
    }
    return links;
}

/** A guide in examples/ with a statement that opens with the method's words. */
function exampleOf(m) {
    const dir = join(repo, "examples");
    const longest = (words) =>
        METHODS.filter((o) => o.words.every((w, i) => words[i] === w)).sort(
            (a, b) => b.words.length - a.words.length,
        )[0];
    const found = [];
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".craft"))) {
        const lines = readFileSync(join(dir, file), "utf8").replace(/\r/g, "").split("\n");
        let start = 0;
        while (start < lines.length && /^\s*(#.*)?$/.test(lines[start])) start++;
        const kept = lines.slice(start);
        const hits = [];
        kept.forEach((line, i) => {
            const words = line
                .replace(/#.*$/, "")
                .trim()
                .split(/[\s"]+/);
            if (longest(words) === m) hits.push(i + 1);
        });
        if (hits.length > 0) found.push({ file, text: kept.join("\n").trimEnd(), hits });
    }
    // A guide named for the method shows it best; among the rest, the shortest.
    const named = (f) => (f.file.includes(m.words[0]) ? 0 : 1);
    return found.sort((a, b) => named(a) - named(b) || a.text.length - b.text.length)[0];
}

function page(m, links) {
    const slug = slugOf(m);
    const doc = readDoc(m);
    const name = m.words.join(" ");
    const link = links.get(name) ?? links.get(`${m.words[0]} *`);
    const example = exampleOf(m);
    const icon = existsSync(join(icons, `${slug}.png`)) ? `/op-icons/${slug}.png` : undefined;
    const parts = [
        "---",
        `title: ${name}`,
        `description: ${JSON.stringify(doc.summary)}`,
        "---",
        "",
        '<div class="op-head">',
        icon ? `<img :src="$withBase('${icon}')" alt="" />` : "",
        `<h1 id="${slug}">${name}</h1>`,
        "</div>",
        "",
        doc.title ? `${doc.title}.\n` : "",
        "## Syntax",
        "",
        `<div class="op-signature">${escape(doc.syntax)}</div>`,
        "",
        m.args.length === 0
            ? "It takes no arguments."
            : m.args.map((s, i) => `${i + 1}. ${slotText(s)}`).join("\n"),
        "",
        "## What it does",
        "",
        ...doc.does.map((s) => `${escape(s)}\n`),
        "## What the item needs",
        "",
        doc.needs.length > 0
            ? doc.needs
                  .map(
                      (s) =>
                          `- ${escape(s.replace(/^Needs /, "").replace(/^./, (c) => c.toUpperCase()))}`,
                  )
                  .join("\n")
            : "What the description above names: the item must be so on every path the craft can take, or the step is flagged.",
        "",
    ];
    if (example !== undefined) {
        parts.push(
            "## Example",
            "",
            "```hinekora {" + example.hits.join(",") + "}",
            example.text,
            "```",
            "",
            `From [examples/${example.file}](${GITHUB}/examples/${example.file}); open it in the [playground](/playground/).`,
            "",
        );
    }
    if (link !== undefined) {
        parts.push(
            "## In the game",
            "",
            `[${link.text}](${link.href}) on the Path of Exile Wiki.`,
            "",
        );
    }
    parts.push(
        `<p class="op-generated">Generated from the method table, <a href="${GITHUB}/packages/core/src/check/methods.ts">methods.ts</a>; hover the step in an editor for the same text.</p>`,
        "",
    );
    return parts.filter((p, i, all) => !(p === "" && all[i - 1] === "")).join("\n");
}

function index() {
    const lines = [
        "---",
        "title: All operations",
        "---",
        "",
        "# Operations",
        "",
        "Every statement of a guide is one operation on the item. Each page shows the operation's",
        "syntax, what it does, what the item needs for it, and a guide that uses it.",
        "",
    ];
    for (const [family] of [...FAMILIES, ["Other"]]) {
        const members = METHODS.filter((m) => familyOf(m) === family);
        if (members.length === 0) continue;
        lines.push(`## ${family}`, "", "| Operation | What it does |", "| --- | --- |");
        for (const m of members) {
            const name = `\`${m.words.join(" ")}\``;
            const cell = PAGES.has(slugOf(m)) ? `[${name}](./${slugOf(m)})` : name;
            lines.push(`| ${cell} | ${escape(readDoc(m).summary).replace(/\|/g, "\\|")} |`);
        }
        lines.push("");
    }
    return lines.join("\n");
}

mkdirSync(out, { recursive: true });
mkdirSync(icons, { recursive: true });
const iconDir = join(repo, "editors", "playground", "src", "icons");
for (const m of METHODS) {
    const slug = slugOf(m);
    const from = [slug, m.words[0]].map((k) => join(iconDir, `${k}.png`)).find(existsSync);
    if (from !== undefined) copyFileSync(from, join(icons, `${slug}.png`));
}
const links = wikiLinks();
const sidebar = [];
for (const m of METHODS.filter((m) => PAGES.has(slugOf(m)))) {
    writeFileSync(join(out, `${slugOf(m)}.md`), page(m, links));
    sidebar.push({ text: m.words.join(" "), link: `/docs/operations/${slugOf(m)}` });
}
writeFileSync(join(out, "index.md"), index());
writeFileSync(join(out, "sidebar.json"), JSON.stringify(sidebar, null, 4));
console.log(`operations reference: ${sidebar.length} pages, ${METHODS.length} operations indexed`);
