/**
 * Ingest the corruption implicit catalog (`corruption.json`) from the
 * RePoE-fork mods export: the rows a Vaal Orb's implicit outcome, a
 * Bloodstained Fossil or the Corruption Altar draws from, on equipment, jewels
 * and abyss jewels, projected to what the checker reads (domain, type, groups,
 * level, the ordered spawn table, tags, text). The file carries its own
 * provenance in `manifest.json`, as `eldritch.json` does.
 *
 * Env: REPOE_MODS_URL / REPOE_MODS_FILE and REPOE_GEMS_URL / REPOE_GEMS_FILE as
 *      for the main ingest; REPOE_COMMIT / REPOE_COMMIT_DATE /
 *      REPOE_PUBLISHED_AT / REPOE_GAME_VERSION provenance overrides.
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolveGameVersion } from "./game-version.mjs";
import { modText } from "./mod-text.mjs";

const OUT_DIR = fileURLToPath(new URL("../data/poe1", import.meta.url));
const MODS_URL = process.env.REPOE_MODS_URL ?? "https://repoe-fork.github.io/mods.min.json";
const GEMS_URL = process.env.REPOE_GEMS_URL ?? "https://repoe-fork.github.io/gems.min.json";

/** Equipment, jewels (cluster jewels among them) and abyss jewels: the item
 *  lists of List of item / jewel / abyss jewel corruption implicit modifiers.
 *  Maps, relics, grafts and the rest take no craft the checker models. */
const DOMAINS = new Set(["item", "jewel", "abyss_jewel"]);

/**
 * A row no tag gives a weight is legacy: List of item corruption implicit
 * modifiers lists only the `V2` rows, and its legacy section is the rows whose
 * weights are all zero. The spawn table is kept whole and in order, zeros
 * included, since the first tag an item carries decides (Modifier § Spawn
 * weight tag). A granted support's line is built from the gems export, as the
 * main ingest's is: the export gives those rows no text.
 */
export function projectCorruption(raw, gems = {}) {
    const out = {};
    for (const [id, m] of Object.entries(raw)) {
        if (m.generation_type !== "corrupted" || !DOMAINS.has(m.domain)) continue;
        if (!m.spawn_weights.some((w) => w.weight > 0)) continue;
        out[id] = {
            domain: m.domain,
            type: m.type,
            groups: m.groups,
            level: m.required_level,
            spawn: m.spawn_weights.map((w) => [w.tag, w.weight]),
            tags: m.implicit_tags ?? [],
            text: modText(m, gems),
        };
    }
    // An export that renames a domain would otherwise drop its rows unseen.
    const empty = [...DOMAINS].filter((d) => !Object.values(out).some((c) => c.domain === d));
    if (empty.length > 0) throw new Error(`no corruption implicits in domain ${empty.join(", ")}`);
    return out;
}

async function getSource(url, fileEnv) {
    const localPath = process.env[fileEnv];
    if (localPath) {
        return { json: JSON.parse(readFileSync(localPath, "utf8")), lastModified: undefined };
    }
    const res = await fetch(url);
    if (!res.ok) throw new Error(`fetch ${url} failed: ${res.status}`);
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
    const mods = await getSource(MODS_URL, "REPOE_MODS_FILE");
    const gems = await getSource(GEMS_URL, "REPOE_GEMS_FILE");
    const commit = await resolveCommit();
    const projected = projectCorruption(mods.json, gems.json);
    const text = JSON.stringify(projected);
    writeFileSync(`${OUT_DIR}/corruption.json`, text);

    const manifestPath = `${OUT_DIR}/manifest.json`;
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    const count = Object.keys(projected).length;
    manifest.extent.corruption = count;
    manifest.files["corruption.json"] = {
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
    console.log(`corruption.json: ${count} rows`);
}

// Importable for its projection; runs only as a script.
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) await main();
