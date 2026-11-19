/**
 * Ingest the names the game shows for modifier category tags
 * (`tag_names.json`) from its own `Tags` table: tag id → the `Name` column,
 * for the tags that have one. The game shows a modifier's tags by their
 * `Name` and does not show a tag whose `Name` is empty ("resource"). An item
 * copied before 3.21.1 shows fewer: that patch fixed armour, energy shield
 * and evasion tags not being displayed (Version 3.21.1).
 *
 * The table is read from the compiled `.datc64` (`dat.mjs`), at the column
 * offsets of the poe-tool-dev dat-schema for `Tags` (`Id` at 0, `Name` at 20,
 * a row 28 bytes wide).
 *
 * Run `node packages/data/scripts/ingest-tag-names.mjs`. Env overrides:
 *   TAGS_DAT_URL / TAGS_DAT_FILE   the table's URL, or a local copy
 *   TAGS_GAME_VERSION              the patch the table was taken at
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { datTable, readStringColumns } from "./dat.mjs";

const OUT_DIR = fileURLToPath(new URL("../data/poe1", import.meta.url));
const DAT_URL = process.env.TAGS_DAT_URL ?? "https://ggpk.exposed/poe1/data/tags.datc64";

/** The table's rows as { id, name }. */
export function readTags(buf) {
    return readStringColumns(buf, { id: 0, name: 20 });
}

/** Tag id → the name the game shows, sorted by id; nameless tags left out. */
export function projectTagNames(rows) {
    const out = {};
    for (const row of [...rows].sort((a, b) => a.id.localeCompare(b.id))) {
        if (row.name === "") continue;
        if (row.id in out) throw new Error(`tag ${row.id} is listed twice`);
        out[row.id] = row.name;
    }
    return out;
}

async function main() {
    const names = projectTagNames(readTags(await datTable(DAT_URL, "TAGS_DAT_FILE")));
    const text = JSON.stringify(names);
    writeFileSync(`${OUT_DIR}/tag_names.json`, text);
    const manifestPath = `${OUT_DIR}/manifest.json`;
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    const count = Object.keys(names).length;
    manifest.files["tag_names.json"] = {
        sha256: createHash("sha256").update(text).digest("hex"),
        count,
        origin: {
            table: "Tags",
            url: DAT_URL,
            gameVersion: process.env.TAGS_GAME_VERSION ?? "unknown",
        },
    };
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 4) + "\n");
    console.log(`tag_names.json: ${count} named tags`);
}

// Importable for its projection; runs only as a script.
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) await main();
