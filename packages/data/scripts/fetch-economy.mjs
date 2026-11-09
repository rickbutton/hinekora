#!/usr/bin/env node
/**
 * Refresh the economy snapshot (`data/poe1/economy.json`) from poe.ninja: the
 * price of every currency, essence, fossil and resonator in Chaos Orbs, and the
 * Divine Orb's, for one league on one day. Four requests, one per type, with a
 * user agent that says who is asking; nothing is crawled. The endpoint is the
 * one the site's own pages read (docs/research/cost-model.md §3); it is not
 * documented and may move, in which case this script is what changes.
 *
 * Usage: node packages/data/scripts/fetch-economy.mjs [league]
 *   league   poe.ninja's league name (default "Allflame"; see
 *            https://poe.ninja/poe1/api/data/index-state, `economyLeagues[].name`)
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const OUT = fileURLToPath(new URL("../data/poe1/economy.json", import.meta.url));
const TYPES = ["Currency", "Essence", "Fossil", "Resonator"];
const USER_AGENT = "hinekora economy snapshot (https://github.com/rickbutton/hinekora)";

async function fetchType(league, type) {
    const url = `https://poe.ninja/poe1/api/economy/exchange/current/overview?league=${encodeURIComponent(league)}&type=${type}`;
    const res = await fetch(url, { headers: { "user-agent": USER_AGENT } });
    if (!res.ok) throw new Error(`${type}: ${res.status} from poe.ninja`);
    return res.json();
}

async function main() {
    const league = process.argv[2] ?? "Allflame";
    const prices = {};
    let chaosPerDivine;
    for (const type of TYPES) {
        const data = await fetchType(league, type);
        const names = new Map(data.items.map((i) => [i.id, i.name]));
        for (const line of data.lines) {
            const name = names.get(line.id);
            if (name !== undefined && typeof line.primaryValue === "number") {
                prices[name] = line.primaryValue;
            }
        }
        const divine = data.core?.rates?.divine;
        if (typeof divine === "number" && divine > 0) chaosPerDivine = 1 / divine;
        // The site throttles eager clients; a pause between the four requests.
        await new Promise((r) => setTimeout(r, 1500));
    }
    if (chaosPerDivine === undefined) throw new Error("no divine rate in the answer");
    const snapshot = {
        source: {
            name: "poe.ninja",
            endpoint: "https://poe.ninja/poe1/api/economy/exchange/current/overview",
            types: TYPES,
        },
        league,
        fetchedAt: new Date().toISOString(),
        chaosPerDivine: Number(chaosPerDivine.toFixed(2)),
        prices: Object.fromEntries(Object.entries(prices).sort(([a], [b]) => a.localeCompare(b))),
    };
    writeFileSync(OUT, JSON.stringify(snapshot, null, 4) + "\n");
    console.log(
        `wrote ${Object.keys(prices).length} prices for ${league} (${snapshot.chaosPerDivine} chaos per divine) to ${OUT}`,
    );
}

await main();
