/**
 * Ingest the modifier types the grove's "Change a modifier that grants …"
 * crafts take (`harvest_change.json`) from the game's own table.
 *
 * Each `Change…` row of `HarvestCraftOptions` runs the command `convert_mod`
 * with the list of modifier types the craft accepts, then `CONVERT <from>
 * <to>`. The list depends on the kind (resistance or damage) and the element
 * changed from only, so the file is kind → element → types. Every name must
 * be a `type` of the committed `mods.json`.
 *
 * The table is read from the compiled `.datc64` (a row count, fixed-width
 * rows, then a data section opened by eight 0xBB bytes; a string column holds
 * an offset into that section, UTF-16). The column offsets are those of the
 * poe-tool-dev dat-schema for `HarvestCraftOptions`.
 *
 * Run `node packages/data/scripts/ingest-harvest-change.mjs`. Env overrides:
 *   HARVEST_DAT_URL / HARVEST_DAT_FILE   the table's URL, or a local copy
 *   HARVEST_GAME_VERSION                 the patch the table was taken at
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const OUT_DIR = fileURLToPath(new URL("../data/poe1", import.meta.url));
const DAT_URL =
    process.env.HARVEST_DAT_URL ?? "https://ggpk.exposed/poe1/data/harvestcraftoptions.datc64";

const ID_AT = 0;
const COMMAND_AT = 32;
const PARAMETERS_AT = 40;

async function table() {
    if (process.env.HARVEST_DAT_FILE) return readFileSync(process.env.HARVEST_DAT_FILE);
    const res = await fetch(DAT_URL);
    if (!res.ok) throw new Error(`fetch ${DAT_URL} failed: ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
}

/** The table's rows as { id, command, parameters }. */
export function readRows(buf) {
    const count = buf.readUInt32LE(0);
    const data = buf.indexOf(Buffer.alloc(8, 0xbb), 4);
    if (data < 0) throw new Error("no data section in the table");
    const width = (data - 4) / count;
    const text = (offset) => {
        const start = data + offset;
        let end = start;
        while (end + 1 < buf.length && !(buf[end] === 0 && buf[end + 1] === 0)) end += 2;
        return buf.toString("utf16le", start, end);
    };
    const column = (row, at) => text(Number(buf.readBigUInt64LE(4 + row * width + at)));
    return Array.from({ length: count }, (_unused, row) => ({
        id: column(row, ID_AT),
        command: column(row, COMMAND_AT),
        parameters: column(row, PARAMETERS_AT),
    }));
}

/** kind → element changed from → the modifier types the craft takes. */
export function projectHarvestChange(rows) {
    const out = { resistance: {}, damage: {} };
    for (const row of rows) {
        if (row.command !== "convert_mod") continue;
        const kind = /Resist$/.test(row.id) ? "resistance" : /Damage$/.test(row.id) ? "damage" : "";
        const m = row.parameters.match(/^(.*) CONVERT (\w+) (\w+)$/);
        if (!kind || !m) throw new Error(`unread convert_mod row ${row.id}`);
        const types = m[1].split(" ");
        const seen = out[kind][m[2]];
        if (seen && seen.join(" ") !== types.join(" ")) {
            throw new Error(`${row.id}: the ${m[2]} ${kind} list differs between targets`);
        }
        out[kind][m[2]] = types;
    }
    return out;
}

const lists = projectHarvestChange(readRows(await table()));
const mods = JSON.parse(readFileSync(`${OUT_DIR}/mods.json`, "utf8"));
const known = new Set(Object.values(mods).map((m) => m.type));
const names = Object.values(lists).flatMap((byElement) => Object.values(byElement).flat());
const unknown = names.filter((n) => !known.has(n));
if (unknown.length > 0) throw new Error(`not modifier types of mods.json: ${unknown.join(", ")}`);

const text = JSON.stringify(lists);
writeFileSync(`${OUT_DIR}/harvest_change.json`, text);
const manifestPath = `${OUT_DIR}/manifest.json`;
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
manifest.files["harvest_change.json"] = {
    sha256: createHash("sha256").update(text).digest("hex"),
    count: names.length,
    origin: {
        table: "HarvestCraftOptions",
        url: DAT_URL,
        gameVersion: process.env.HARVEST_GAME_VERSION ?? "unknown",
    },
};
writeFileSync(manifestPath, JSON.stringify(manifest, null, 4) + "\n");
console.log(`harvest_change.json: ${names.length} modifier types`);
