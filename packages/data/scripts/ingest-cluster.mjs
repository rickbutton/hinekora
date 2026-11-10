/**
 * Ingest the cluster jewel enchantments (`cluster_enchants.json`) from the
 * RePoE-fork `cluster_jewels` export: for each size, the spawn tags of the
 * enchantments a jewel of that size can have. The file carries its own
 * provenance in `manifest.json`, since it is taken from the current export
 * rather than the dump the rest came from.
 *
 * Env: REPOE_CLUSTER_URL / REPOE_CLUSTER_FILE the source;
 *      REPOE_COMMIT / REPOE_COMMIT_DATE / REPOE_PUBLISHED_AT provenance overrides.
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolveGameVersion } from "./game-version.mjs";

const OUT_DIR = fileURLToPath(new URL("../data/poe1", import.meta.url));
const CLUSTER_URL =
    process.env.REPOE_CLUSTER_URL ?? "https://repoe-fork.github.io/cluster_jewels.min.json";

export function projectClusterEnchants(raw) {
    const out = {};
    for (const jewel of Object.values(raw)) {
        const tags = [...new Set(jewel.passive_skills.map((p) => p.tag))].sort();
        out[jewel.size.toLowerCase()] = tags;
    }
    return out;
}

async function getSource() {
    const localPath = process.env.REPOE_CLUSTER_FILE;
    if (localPath) {
        return { json: JSON.parse(readFileSync(localPath, "utf8")), lastModified: undefined };
    }
    const res = await fetch(CLUSTER_URL);
    if (!res.ok) throw new Error(`fetch ${CLUSTER_URL} failed: ${res.status}`);
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
    const source = await getSource();
    const commit = await resolveCommit();
    const projected = projectClusterEnchants(source.json);
    const text = JSON.stringify(projected);
    writeFileSync(`${OUT_DIR}/cluster_enchants.json`, text);

    const manifestPath = `${OUT_DIR}/manifest.json`;
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    const count = Object.values(projected).reduce((n, tags) => n + tags.length, 0);
    manifest.files["cluster_enchants.json"] = {
        sha256: createHash("sha256").update(text).digest("hex"),
        count,
        provenance: {
            commit: commit.sha,
            commitDate: commit.date,
            publishedAt: process.env.REPOE_PUBLISHED_AT ?? source.lastModified ?? "unknown",
            gameVersion: await resolveGameVersion(),
        },
    };
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 4) + "\n");
    console.log(
        `cluster_enchants.json: ${count} enchantments over ${Object.keys(projected).length} sizes`,
    );
}

// Importable for its projection; runs only as a script.
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) await main();
