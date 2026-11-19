#!/usr/bin/env node
/**
 * Refresh the economy snapshot (`data/poe1/economy.json`), the fixture the
 * tests, the site and the playground price with, from poe.ninja. The reading
 * itself is `src/ninja.ts`, the same code the CLI and the language server
 * fetch with; this script imports its build, so run `pnpm build` first.
 *
 * Usage: node packages/data/scripts/fetch-economy.mjs [league]
 *   league   poe.ninja's league name (default: the first league poe.ninja
 *            lists, the current challenge league)
 */
import { writeFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const OUT = fileURLToPath(new URL("../data/poe1/economy.json", import.meta.url));
const NINJA = new URL("../dist/ninja.js", import.meta.url);

async function loadNinja() {
    try {
        return await import(NINJA.href);
    } catch (error) {
        if (error?.code !== "ERR_MODULE_NOT_FOUND") throw error;
        console.error(`${fileURLToPath(NINJA)} is not built: run \`pnpm build\` first`);
        process.exit(1);
    }
}

async function main() {
    const { fetchEconomy, fetchLeagues } = await loadNinja();
    const client = { fetch: (url, init) => fetch(url, init), pause: sleep, now: Date.now };
    const league = process.argv[2] ?? (await fetchLeagues(client))[0];
    const snapshot = await fetchEconomy(client, league);
    writeFileSync(OUT, JSON.stringify(snapshot, null, 4) + "\n");
    console.log(
        `wrote ${Object.keys(snapshot.prices).length} prices for ${league} (${snapshot.chaosPerDivine} chaos per divine) to ${OUT}`,
    );
}

await main();
