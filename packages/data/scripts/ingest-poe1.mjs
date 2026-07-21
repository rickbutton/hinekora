/**
 * Ingest PoE1 data from repoe-fork into the committed catalog.
 *
 * Downloads (or reads local) the RePoE `mods` / `base_items` exports, PROJECTS
 * them to just the fields the core model needs — dropping stat rolls, granted
 * effects, text, gold values, etc., which shrinks the mod data ~5x — filters to
 * affix mods + released named bases, and writes minified, still-RePoE-shaped
 * JSON plus a provenance `manifest.json` (source commit, publish date, sha256s).
 *
 * Reproducible: run `node packages/data/scripts/ingest-poe1.mjs`. Env overrides:
 *   REPOE_MODS_URL / REPOE_BASES_URL   source URLs (default: the .min exports)
 *   REPOE_MODS_FILE / REPOE_BASES_FILE local files to use instead of fetching
 *   REPOE_COMMIT / REPOE_COMMIT_DATE / REPOE_PUBLISHED_AT   provenance overrides
 *   REPOE_GAME_VERSION                 the PoE patch, if known (default "unknown")
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const OUT_DIR = fileURLToPath(new URL("../data/poe1", import.meta.url));
const MODS_URL = process.env.REPOE_MODS_URL ?? "https://repoe-fork.github.io/mods.min.json";
const BASES_URL = process.env.REPOE_BASES_URL ?? "https://repoe-fork.github.io/base_items.min.json";
const ESSENCES_URL =
    process.env.REPOE_ESSENCES_URL ?? "https://repoe-fork.github.io/essences.min.json";
const BENCH_URL =
    process.env.REPOE_BENCH_URL ?? "https://repoe-fork.github.io/crafting_bench_options.min.json";

const AFFIX_GENS = new Set(["prefix", "suffix"]);

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

function projectMods(raw) {
    const out = {};
    for (const [id, m] of Object.entries(raw)) {
        if (!AFFIX_GENS.has(m.generation_type)) continue;
        out[id] = {
            domain: m.domain,
            generation_type: m.generation_type,
            groups: m.groups,
            required_level: m.required_level,
            spawn_weights: m.spawn_weights,
            adds_tags: m.adds_tags,
            implicit_tags: m.implicit_tags ?? [], // tag-directed crafting (fossils, harvest)
            type: m.type,
            is_essence_only: m.is_essence_only ?? false, // for source classification
            // Human-readable fields, kept for fuzzy name resolution.
            name: m.name ?? "",
            text: m.text ?? "",
        };
    }
    return out;
}

// The two implicit stats that shift an "experimented base"'s affix limits
// (Simplex Amulet, Ratcheting Ring, …). Signed integer deltas per generation.
const CAP_PREFIX_STAT = "local_maximum_prefixes_allowed_+";
const CAP_SUFFIX_STAT = "local_maximum_suffixes_allowed_+";

/** Sum a base's implicit affix-slot deltas, or `undefined` if it has none. */
function capDeltaOf(base, mods) {
    let prefix = 0;
    let suffix = 0;
    for (const id of base.implicits ?? []) {
        for (const s of mods[id]?.stats ?? []) {
            if (s.id === CAP_PREFIX_STAT) prefix += s.min;
            else if (s.id === CAP_SUFFIX_STAT) suffix += s.min;
        }
    }
    return prefix || suffix ? { prefix, suffix } : undefined;
}

function projectBases(raw, mods) {
    const out = {};
    for (const [key, b] of Object.entries(raw)) {
        if (b.release_state !== "released" || !b.name) continue; // skip unreleased / nameless internals
        const capDelta = capDeltaOf(b, mods);
        out[key] = {
            name: b.name,
            item_class: b.item_class,
            domain: b.domain,
            tags: b.tags,
            release_state: b.release_state,
            ...(capDelta && { capDelta }),
        };
    }
    return out;
}

function projectEssences(raw) {
    const out = {};
    for (const [id, e] of Object.entries(raw)) {
        // Skip essences that grant no mod — the retired "Remnant of Corruption"
        // is the only one; it isn't a mod-adding currency we model.
        if (!e.mods || Object.keys(e.mods).length === 0) continue;
        out[id] = {
            name: e.name,
            // `e.level` is the ladder tier (1 = Whispering … 7 = Deafening, 8 =
            // corrupted). NOT `e.type.tier`, which is a mod-category number. The
            // ladder is what gates usage: level >= 5 may reforge a Rare item.
            tier: e.level ?? 0,
            // `item_level_restriction` caps the RANDOM fill mods' level (absent =
            // no cap). It is NOT an item-level requirement — essences work on any
            // item level; the guaranteed mod is forced at its fixed tier.
            ...(e.item_level_restriction != null && {
                maxRandomModLevel: e.item_level_restriction,
            }),
            grants: e.mods, // item class → guaranteed mod id
        };
    }
    return out;
}

function projectBench(raw) {
    const out = [];
    for (const b of raw) {
        const mod = b.actions?.add_explicit_mod;
        if (!mod) continue; // only mod-adding bench options
        out.push({
            mod,
            tier: b.bench_tier ?? 0,
            item_classes: b.item_classes ?? [],
            master: b.master ?? "",
        });
    }
    return out;
}

function writeJson(name, value) {
    const text = JSON.stringify(value);
    writeFileSync(`${OUT_DIR}/${name}`, text);
    return {
        sha256: createHash("sha256").update(text).digest("hex"),
        count: Object.keys(value).length,
    };
}

async function main() {
    mkdirSync(OUT_DIR, { recursive: true });

    const commit = await resolveCommit();
    const mods = await getSource(MODS_URL, "REPOE_MODS_FILE");
    const bases = await getSource(BASES_URL, "REPOE_BASES_FILE");
    const essences = await getSource(ESSENCES_URL, "REPOE_ESSENCES_FILE");
    const bench = await getSource(BENCH_URL, "REPOE_BENCH_FILE");

    const modsFile = writeJson("mods.json", projectMods(mods.json));
    const basesFile = writeJson("base_items.json", projectBases(bases.json, mods.json));
    const essencesFile = writeJson("essences.json", projectEssences(essences.json));
    const benchFile = writeJson("bench.json", projectBench(bench.json));

    const manifest = {
        game: "poe1",
        source: {
            name: "repoe-fork/repoe",
            url: "https://repoe-fork.github.io/",
            repoUrl: "https://github.com/repoe-fork/repoe",
            commit: commit.sha,
            commitDate: commit.date,
            publishedAt:
                process.env.REPOE_PUBLISHED_AT ??
                mods.lastModified ??
                bases.lastModified ??
                "unknown",
        },
        gameVersion: process.env.REPOE_GAME_VERSION ?? "unknown",
        gameVersionNote:
            "repoe-fork does not stamp the Path of Exile patch in its exports (no version file, no release tags). Provenance rests on source.commit + publishedAt; set REPOE_GAME_VERSION when the patch is known.",
        retrievedAt: new Date().toISOString().slice(0, 10),
        extent: {
            description:
                "Full PoE1 catalog projected to the fields the core model uses: all prefix/suffix mods, all released named bases, plus the essence and bench (mod-adding) catalogs.",
            bases: basesFile.count,
            mods: modsFile.count,
            essences: essencesFile.count,
            benchCrafts: benchFile.count,
        },
        files: {
            "mods.json": modsFile,
            "base_items.json": basesFile,
            "essences.json": essencesFile,
            "bench.json": benchFile,
        },
    };
    writeFileSync(`${OUT_DIR}/manifest.json`, JSON.stringify(manifest, null, 4) + "\n");

    console.log(
        `wrote ${modsFile.count} mods, ${basesFile.count} bases, ${essencesFile.count} essences, ${benchFile.count} bench crafts to ${OUT_DIR}`,
    );
    console.log(`source commit ${commit.sha}, published ${manifest.source.publishedAt}`);
}

await main();
