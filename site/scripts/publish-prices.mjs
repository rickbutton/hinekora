#!/usr/bin/env node
/**
 * Writes the prices file the playground prefers to its bundled snapshot
 * (`pricesToPublish` in @hinekora/data decides which), for the site's deploy.
 * Always exits 0: a deploy is never held back by prices. Needs the workspace
 * built (`pnpm build`).
 *
 * Usage: node site/scripts/publish-prices.mjs [out]
 *   out                 the file to write (default: public/playground/prices.json,
 *                       where the site build publishes it beside the playground)
 *   HINEKORA_SITE_URL   the live site's address (actions/configure-pages'
 *                       base_url), whose prices file serves when poe.ninja cannot
 */
import { rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { nodeNinjaClient, pricesToPublish, publishedLine, writeAtomic } from "@hinekora/data";

const site = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = process.argv[2] ?? join(site, "public", "playground", "prices.json");

const siteUrl = process.env["HINEKORA_SITE_URL"]?.replace(/\/+$/, "");
const live = siteUrl ? `${siteUrl}/playground/prices.json` : undefined;

const result = await pricesToPublish(nodeNinjaClient(), live);
try {
    if (result.kind === "none") rmSync(out, { force: true });
    else writeAtomic(out, JSON.stringify(result.raw, null, 4) + "\n");
    console.log(publishedLine(result, out));
} catch (error) {
    console.log(`published no prices file, for ${out} could not be written (${error})`);
}
