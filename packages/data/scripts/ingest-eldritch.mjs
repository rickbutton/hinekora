/**
 * Ingest the eldritch implicit catalog (`eldritch.json`) from the RePoE-fork
 * mods export: the Searing Exarch and Eater of Worlds implicit rows, projected
 * to what the checker reads (side, tier, type, the classes it rolls on, its
 * text). The file carries its own provenance in `manifest.json`, since it is
 * taken from the current export rather than the dump the rest came from.
 *
 * Env: REPOE_MODS_URL / REPOE_MODS_FILE as for the main ingest;
 *      REPOE_COMMIT / REPOE_COMMIT_DATE / REPOE_PUBLISHED_AT provenance overrides.
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolveGameVersion } from "./game-version.mjs";

const OUT_DIR = fileURLToPath(new URL("../data/poe1", import.meta.url));
const MODS_URL = process.env.REPOE_MODS_URL ?? "https://repoe-fork.github.io/mods.min.json";

const SIDE_OF = {
    searing_exarch_implicit: "exarch",
    eater_of_worlds_implicit: "eater",
};

/**
 * The tier a row is, Lesser = 1 up to Perfect = 6 as the model counts (a higher
 * tier is the stronger ember, Eldritch Chaos Orb § Mechanics, "Dominant"). The export's
 * `no_tier_<n>_eldritch_implicit` tag that excludes the row counts the other
 * way, Perfect = 1 down to Lesser = 6: on List of Searing Exarch implicit
 * modifiers the gloves' 8% attack speed row carries `no_tier_6` and the 13%
 * row `no_tier_1`.
 */
function tierOf(m) {
    for (const w of m.spawn_weights) {
        const hit = /^no_tier_(\d)_eldritch_implicit$/.exec(w.tag);
        if (hit) return 7 - Number(hit[1]);
    }
    return 0;
}

/**
 * The export's text of a "presence" row omits the condition the game prints
 * first; List of Searing Exarch implicit modifiers words it "While a Unique
 * Enemy is in your Presence, 13% increased Attack Speed" and "While a Pinnacle
 * Atlas Boss is in your Presence, 18% …".
 */
export function presenceText(id, text) {
    if (id.includes("UniquePresence")) return `While a Unique Enemy is in your Presence, ${text}`;
    if (id.includes("PinnaclePresence")) {
        return `While a Pinnacle Atlas Boss is in your Presence, ${text}`;
    }
    return text;
}

/** The spawn tags that name no item class. */
const NOT_A_CLASS = /^(default|no_tier_\d_eldritch_implicit)$/;

export function projectEldritch(raw) {
    const out = {};
    for (const [id, m] of Object.entries(raw)) {
        const side = SIDE_OF[m.generation_type];
        if (side === undefined) continue;
        const tier = tierOf(m);
        if (tier === 0) continue;
        const admitted = m.spawn_weights.filter((w) => w.weight > 0);
        // A row no class rolls is still a tier of its implicit: the presence
        // implicits have no weight at their lowest tiers, which an Orb of
        // Conflict reaches by lowering one. It keeps the classes it names.
        const unrollable = admitted.length === 0;
        const classes = (
            unrollable ? m.spawn_weights.filter((w) => !NOT_A_CLASS.test(w.tag)) : admitted
        ).map((w) => w.tag);
        if (classes.length === 0) continue;
        const weights = {};
        for (const w of admitted) weights[w.tag] = w.weight;
        out[id] = {
            side,
            tier,
            type: m.type,
            classes,
            weights,
            ...(unrollable && { unrollable: true }),
            implicit_tags: m.implicit_tags ?? [],
            text: presenceText(id, m.text ?? ""),
        };
    }
    // An implicit with no rollable tier at all is on no item, whatever is lowered.
    const rollable = new Set(
        Object.values(out)
            .filter((e) => !e.unrollable)
            .map((e) => e.type),
    );
    for (const [id, e] of Object.entries(out)) if (!rollable.has(e.type)) delete out[id];
    return out;
}

async function getSource() {
    const localPath = process.env.REPOE_MODS_FILE;
    if (localPath) {
        return { json: JSON.parse(readFileSync(localPath, "utf8")), lastModified: undefined };
    }
    const res = await fetch(MODS_URL);
    if (!res.ok) throw new Error(`fetch ${MODS_URL} failed: ${res.status}`);
    return { json: await res.json(), lastModified: res.headers.get("last-modified") ?? undefined };
}

async function resolveCommit() {
    if (process.env.REPOE_COMMIT) {
        return { sha: process.env.REPOE_COMMIT, date: process.env.REPOE_COMMIT_DATE ?? "unknown" };
    }
    try {
        const res = await fetch("https://api.github.com/repos/repoe-fork/repoe/commits/master");
        const c = await res.json();
        return { sha: c.sha, date: c.commit.committer.date };
    } catch {
        return { sha: "unknown", date: "unknown" };
    }
}

async function main() {
    const mods = await getSource();
    const commit = await resolveCommit();
    const projected = projectEldritch(mods.json);
    const text = JSON.stringify(projected);
    writeFileSync(`${OUT_DIR}/eldritch.json`, text);

    const manifestPath = `${OUT_DIR}/manifest.json`;
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    const count = Object.keys(projected).length;
    manifest.extent.eldritch = count;
    manifest.files["eldritch.json"] = {
        sha256: createHash("sha256").update(text).digest("hex"),
        count,
        provenance: {
            commit: commit.sha,
            commitDate: commit.date,
            publishedAt: process.env.REPOE_PUBLISHED_AT ?? mods.lastModified ?? "unknown",
            gameVersion: await resolveGameVersion(),
        },
    };
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 4) + "\n");
    console.log(`eldritch.json: ${count} rows`);
}

// Importable for its projection; runs only as a script.
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) await main();
