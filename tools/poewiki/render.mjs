/**
 * Renders poewiki.net pages to Markdown, tables included, through the local
 * cache. A page already in `md/` is served from disk; otherwise the wiki's
 * parser renders it (one request per page) and the result is cached.
 *
 *   node tools/poewiki/render.mjs "Modifier" "Item level"   # prints one path per page
 *   node tools/poewiki/render.mjs --force "Modifier"        # re-render even if cached
 *   node tools/poewiki/render.mjs --stdout "Modifier"       # print the Markdown instead
 *   node tools/poewiki/render.mjs --wikitext "Modifier"     # local wikitext, no network
 *   node tools/poewiki/render.mjs --exists "Affix"          # is it in the snapshot? (follows redirects)
 */
import { readFileSync } from "node:fs";
import { log, parseArgs, readPage, renderPage, requestCount } from "./lib.mjs";

const { flags, positional } = parseArgs(process.argv.slice(2));
if (!positional.length) {
    console.error("usage: render.mjs [--force|--stdout|--wikitext|--exists] <title>...");
    process.exit(2);
}

for (const title of positional) {
    if (flags.has("exists") || flags.has("wikitext")) {
        let page = readPage(title);
        if (page?.redirect) {
            console.log(`${title} -> ${page.redirect}`);
            page = readPage(page.redirect);
        }
        if (!page) {
            console.log(`${title}: not in the local snapshot`);
            continue;
        }
        if (flags.has("exists")) console.log(`${page.title}: ns ${page.ns}, page ${page.id}`);
        else console.log(page.wikitext);
        continue;
    }
    const r = await renderPage(title, { force: flags.has("force") });
    if (flags.has("stdout")) {
        console.log(readFileSync(r.file, "utf8"));
    } else {
        console.log(
            `${title === r.title ? title : `${title} -> ${r.title}`}: ${r.file}${r.cached ? " (cached)" : ""}`,
        );
    }
}
log(`${requestCount()} request(s)`);
