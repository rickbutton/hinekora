#!/usr/bin/env node
/**
 * Copies the currency icons the storyboard shows from the wiki into
 * `src/icons/<key>.png`, one per method the language has, keyed by the
 * method's words joined with dashes (the page falls back to the first word).
 * The game's CDN serves only the classic orbs under a public path, so the
 * wiki's copies are the one complete source. Icons already present are kept;
 * delete one to refresh it. Run it again when a method is added; the files
 * are committed.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "icons");

/**
 * Icon key → the wiki's item name; the file is `<name> inventory icon.png`.
 * `locus` (the Corruption Altar) has no inventory art on the wiki and keeps
 * the page's lettered glyph. The lifeforce colours follow the Horticrafting
 * bench: Wild reforges, Vivid augments and removes, Primal randomises and
 * changes.
 */
const ICONS = {
    transmute: "Orb of Transmutation",
    augment: "Orb of Augmentation",
    alteration: "Orb of Alteration",
    regal: "Regal Orb",
    alchemy: "Orb of Alchemy",
    chaos: "Chaos Orb",
    exalt: "Exalted Orb",
    annul: "Orb of Annulment",
    scour: "Orb of Scouring",
    fracture: "Fracturing Orb",
    "exalt-crusader": "Crusader's Exalted Orb",
    "exalt-hunter": "Hunter's Exalted Orb",
    "exalt-redeemer": "Redeemer's Exalted Orb",
    "exalt-warlord": "Warlord's Exalted Orb",
    "exalt-shaper": "Shaper's Exalted Orb",
    "exalt-elder": "Elder's Exalted Orb",
    ember: "Grand Eldritch Ember",
    ichor: "Grand Eldritch Ichor",
    "eldritch-chaos": "Eldritch Chaos Orb",
    "eldritch-exalt": "Eldritch Exalted Orb",
    "eldritch-annul": "Eldritch Orb of Annulment",
    dominance: "Orb of Dominance",
    conflict: "Orb of Conflict",
    vaal: "Vaal Orb",
    "tainted-chaos": "Tainted Chaos Orb",
    "tainted-exalt": "Tainted Exalted Orb",
    "tainted-divine": "Tainted Divine Teardrop",
    essence: "Deafening Essence of Greed",
    bench: "Crafting Bench",
    "harvest-reforge": "Wild Crystallised Lifeforce",
    "harvest-augment": "Vivid Crystallised Lifeforce",
    "harvest-randomise": "Primal Crystallised Lifeforce",
    "harvest-change": "Primal Crystallised Lifeforce",
    "veiled-chaos": "Veiled Chaos Orb",
    "veiled-exalt": "Veiled Exalted Orb",
    unveil: "Veiled Chaos Orb",
    "foulborn-augment": "Foulborn Orb of Augmentation",
    "foulborn-regal": "Foulborn Regal Orb",
    "foulborn-exalt": "Foulborn Exalted Orb",
    fossil: "Potent Chaotic Resonator",
    beast: "Bestiary Orb",
    restore: "Imprinted Bestiary Orb",
    aisling: "Veiled Exalted Orb",
};

const UA = "hinekora-playground/0.1 (crafting-guide checker; github.com/rickbutton/hinekora)";

/** One download, waiting out the wiki's rate limit when it answers 429. */
async function download(url) {
    for (let attempt = 0; attempt < 6; attempt++) {
        const response = await fetch(url, { headers: { "user-agent": UA }, redirect: "follow" });
        if (response.status !== 429) return response;
        await sleep(5000 * (attempt + 1));
    }
    return fetch(url, { headers: { "user-agent": UA }, redirect: "follow" });
}

mkdirSync(OUT, { recursive: true });
let failed = 0;
for (const [key, name] of Object.entries(ICONS)) {
    const target = join(OUT, `${key}.png`);
    if (existsSync(target)) continue;
    const file = `${name.replace(/ /g, "_")}_inventory_icon.png`;
    const url = `https://www.poewiki.net/wiki/Special:FilePath/${encodeURIComponent(file)}`;
    const response = await download(url);
    if (!response.ok) {
        failed++;
        console.error(`${key}: ${response.status} for ${name}`);
        continue;
    }
    writeFileSync(target, Buffer.from(await response.arrayBuffer()));
    console.log(`${key} ← ${name}`);
    await sleep(1500);
}
process.exitCode = failed === 0 ? 0 : 1;
