#!/usr/bin/env node
/**
 * Writes the operations reference under docs/operations/ from the method
 * table the parser, completion, hover and the checker all read
 * (`METHODS` in @hinekora/core): each page's syntax, argument list and
 * description are the table's, its example the craft under examples/ops/
 * named for the method, its wiki link the one docs/operations.md gives the
 * method. What a page says of an operation comes from the table, so it
 * changes with it; only the grouping (FAMILIES, where a new first word lands
 * in "Other") and the wording around the table's text are kept here.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { METHODS } from "@hinekora/core";

const site = join(dirname(fileURLToPath(import.meta.url)), "..");
const repo = join(site, "..");
const out = join(site, "docs", "operations");
const icons = join(site, "public", "op-icons");
const GITHUB = "https://github.com/rickbutton/hinekora/blob/main";
const WIKI = "https://www.poewiki.net/wiki/";

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
    ["Corruption", ["vaal", "locus"]],
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
 * currency "<orb's name> — <description>"; a method written two ways has one
 * such form after the other. The sentences that say what the item needs are
 * pulled out of each description.
 */
function readDoc(m) {
    const words = m.words.join(" ");
    const starts = [0];
    for (const hit of m.doc.matchAll(new RegExp(`\\. (?=${words}[^.]*? — )`, "g")))
        starts.push(hit.index + 2);
    const forms = starts.map((start, i) => {
        const text = m.doc.slice(start, starts[i + 1]).trim();
        const cut = text.indexOf(" — ");
        const head = text.slice(0, cut);
        const sentences = text
            .slice(cut + 3)
            .split(/(?<=\.)\s+(?=[A-Z])/)
            // "needs one" leans on the clause before it, so the two stay together.
            .flatMap((s) => s.split(/; (?=needs (?!one\b))/))
            .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
            .map((s) => (/[.!]$/.test(s) ? s : `${s}.`));
        const needs = sentences.filter((s) => s.startsWith("Needs "));
        const own = head.startsWith(words);
        return {
            syntax: own ? head : words,
            title: own ? undefined : head,
            does: sentences.filter((s) => !needs.includes(s)),
            needs,
        };
    });
    return { forms, title: forms[0].title, summary: forms[0].does[0] ?? "" };
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

/**
 * The wiki pages docs/operations.md's table of built methods gives a row
 * cannot say per method where it lists several, so these go by name.
 */
const WIKI_PAGE = {
    "bench remove": "Crafting_Bench",
    ...Object.fromEntries(
        ["Shaper", "Elder", "Crusader", "Hunter", "Redeemer", "Warlord"].map((who) => [
            `exalt ${who.toLowerCase()}`,
            `${who}%27s_Exalted_Orb`,
        ]),
    ),
};

/** The wiki links of docs/operations.md's table of built methods, by surface. */
function wikiLinks() {
    const doc = readFileSync(join(repo, "docs", "operations.md"), "utf8");
    const links = new Map();
    for (const line of doc.split("\n")) {
        const cells = line.split("|").map((c) => c.trim());
        if (cells.length < 4) continue;
        const urls = [...cells[1].matchAll(/\]\((https:\/\/www\.poewiki\.net[^)]+)\)/g)];
        const surfaces = [...cells[2].matchAll(/`([^`]+)`/g)].map((s) =>
            s[1].replace(/<[^>]+>/g, "*").trim(),
        );
        if (urls.length === 0 || surfaces.length === 0) continue;
        surfaces.forEach((surface, i) => {
            const url = urls.length === surfaces.length ? urls[i] : urls[0];
            if (!links.has(surface)) links.set(surface, url[1]);
        });
    }
    return links;
}

/** The link under its page's own title, which a table cell's wording is not. */
function wikiLink(m, links) {
    const name = m.words.join(" ");
    const href =
        name in WIKI_PAGE
            ? WIKI + WIKI_PAGE[name]
            : (links.get(name) ?? links.get(`${m.words[0]} *`));
    if (href === undefined) return undefined;
    const page = href.slice(WIKI.length).replace(/#.*$/, "");
    return { href, text: decodeURIComponent(page).replace(/_/g, " ") };
}

/** The craft under site/examples/ops/ named for the method. */
function exampleOf(m) {
    const file = join(site, "examples", "ops", `${slugOf(m)}.craft`);
    if (!existsSync(file))
        throw new Error(
            `no craft for "${m.words.join(" ")}": write examples/ops/${slugOf(m)}.craft`,
        );
    return readFileSync(file, "utf8").replace(/\r/g, "").trimEnd();
}

function page(m, links) {
    const slug = slugOf(m);
    const doc = readDoc(m);
    const name = m.words.join(" ");
    const link = wikiLink(m, links);
    const icon = existsSync(join(icons, `${slug}.png`)) ? `/op-icons/${slug}.png` : undefined;
    const needs = doc.forms.flatMap((f) => f.needs);
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
        ...doc.forms.map((f) => `<div class="op-signature">${escape(f.syntax)}</div>\n`),
        m.args.length === 0
            ? "It takes no arguments."
            : m.args.map((s, i) => `${i + 1}. ${slotText(s)}`).join("\n"),
        "",
        "## What it does",
        "",
        // A second way of writing the method opens its own paragraph.
        ...doc.forms.flatMap((f, i) =>
            f.does.map((s, j) => `${i > 0 && j === 0 ? `\`${f.syntax}\`: ` : ""}${escape(s)}\n`),
        ),
    ];
    if (needs.length > 0) {
        parts.push(
            "## What the item needs",
            "",
            needs
                .map(
                    (s) =>
                        `- ${escape(s.replace(/^Needs /, "").replace(/^./, (c) => c.toUpperCase()))}`,
                )
                .join("\n"),
            "",
        );
    }
    parts.push("## Example", "", "```hinekora", exampleOf(m), "```", "");
    if (link !== undefined) {
        parts.push(
            "## Reference",
            "",
            `[${link.text}](${link.href}) on the Path of Exile Wiki.`,
            "",
        );
    }
    parts.push(
        `<p class="op-generated">Generated from the method table in <a href="${GITHUB}/packages/core/src/check/methods.ts">methods.ts</a>, which is also the source of the editor's hover text.</p>`,
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
        "A statement of a craft is one operation on the item. Each operation's page gives its syntax,",
        "its effect, what it needs of the item and a craft that uses it.",
        "",
    ];
    for (const [family] of [...FAMILIES, ["Other"]]) {
        const members = METHODS.filter((m) => familyOf(m) === family);
        if (members.length === 0) continue;
        lines.push(`## ${family}`, "", "| Operation | What it does |", "| --- | --- |");
        for (const m of members) {
            const name = `\`${m.words.join(" ")}\``;
            lines.push(
                `| [${name}](./${slugOf(m)}) | ${escape(readDoc(m).summary).replace(/\|/g, "\\|")} |`,
            );
        }
        lines.push("");
    }
    return lines.join("\n");
}

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
mkdirSync(icons, { recursive: true });
const iconDir = join(repo, "editors", "playground", "src", "icons");
for (const m of METHODS) {
    const slug = slugOf(m);
    const from = [slug, m.words[0]].map((k) => join(iconDir, `${k}.png`)).find(existsSync);
    if (from !== undefined) copyFileSync(from, join(icons, `${slug}.png`));
}
const links = wikiLinks();
for (const m of METHODS) writeFileSync(join(out, `${slugOf(m)}.md`), page(m, links));
// One collapsed group per family, in the index's order.
const sidebar = [...FAMILIES, ["Other"]]
    .map(([family]) => ({
        text: family,
        collapsed: true,
        items: METHODS.filter((m) => familyOf(m) === family).map((m) => ({
            text: m.words.join(" "),
            link: `/docs/operations/${slugOf(m)}`,
        })),
    }))
    .filter((group) => group.items.length > 0);
writeFileSync(join(out, "index.md"), index());
writeFileSync(join(out, "sidebar.json"), JSON.stringify(sidebar, null, 4));
console.log(`operations reference: ${METHODS.length} pages`);
