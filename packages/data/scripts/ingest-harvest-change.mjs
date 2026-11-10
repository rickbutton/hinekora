/**
 * Ingest the modifier types the grove's "Change a modifier that grants …"
 * crafts take (`harvest_change.json`) from the game's own table.
 *
 * Each `Change…` row of `HarvestCraftOptions` runs the command `convert_mod`
 * with the list of modifier types the craft accepts, then `CONVERT <from>
 * <to>`. The list depends on the kind (resistance or damage) and the element
 * changed from only. The file pairs each listed type with what it becomes for
 * each other element (`pairHarvestChange`), kind → element → rows. Every name
 * must be a `type` of the committed `mods.json`.
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
import { fileURLToPath, pathToFileURL } from "node:url";

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

const ELEMENTS = ["fire", "cold", "lightning"];
const AILMENT = { fire: "Ignite", cold: "Freeze", lightning: "Shock" };
const capital = (element) => element[0].toUpperCase() + element.slice(1);
// The game spells one modifier's types "…Resist" for an element and
// "…Resistance" for another, and a chance to freeze "BaseChanceToFreeze".
const alike = (type) =>
    type.replaceAll("Resistance", "Resist").replaceAll("BaseChanceTo", "ChanceTo");

/** The pairs observed in the game itself (patch 3.29): what a modifier became,
 *  or null where the grove refused the change. They override no other basis:
 *  one that disagrees fails the ingest. */
export const SEEN_IN_GAME = {
    FireDamageAndChanceToIgnite: { cold: "ColdDamageAndBaseChanceToFreeze" },
    FireDamageOverTimeMultiplier: { cold: "ColdDamageOverTimeMultiplier", lightning: null },
};

/** The listed types decided to have no counterpart for an element: the
 *  other element's list has no modifier of their name. */
export const NO_COUNTERPART = {
    FireDamageWithBowsJewel: ["cold", "lightning"],
    AddedColdDamageWithBows: ["fire"],
    AddedLightningDamageWithBows: ["fire"],
    ColdDamageOverTimeMultiplier: ["lightning"],
    ColdDamageAvoidance: ["fire"],
    LightningDamageAvoidance: ["fire"],
};

/**
 * The pairing table: kind → element changed from → one row per listed type,
 * `{ from, to: { element: [counterpart | null, basis] } }`, null where the
 * craft is refused. The lists name what each craft takes, not what a modifier
 * becomes, and do not align by position, so a counterpart is found by name
 * (the element's word exchanged) or by ailment (ignite, freeze and shock
 * exchanged with it), unless the pair was seen in game. A critical strike
 * multiplier is listed but refused by the damage change since 3.28.0 (Harvest
 * crafting § Version history, Hotfix 8). Every pair must be decided, and two
 * bases that disagree fail.
 */
export function pairHarvestChange(
    lists,
    critical = new Set(),
    seen = SEEN_IN_GAME,
    unpaired = NO_COUNTERPART,
) {
    const out = {};
    for (const [kind, byElement] of Object.entries(lists)) {
        out[kind] = {};
        for (const from of ELEMENTS) {
            if (byElement[from] === undefined) continue;
            out[kind][from] = byElement[from].map((type) => {
                const to = {};
                for (const element of ELEMENTS) {
                    if (element === from || byElement[element] === undefined) continue;
                    const named = (wanted) =>
                        byElement[element].find((t) => alike(t) === alike(wanted));
                    const exchanged = type.replaceAll(capital(from), capital(element));
                    const byName = named(exchanged);
                    const byAilment = type.includes(AILMENT[from])
                        ? named(exchanged.replaceAll(AILMENT[from], AILMENT[element]))
                        : undefined;
                    const observed = seen[type]?.[element];
                    const none = unpaired[type]?.includes(element) ? null : undefined;
                    const decisions = [
                        [byName, "name"],
                        [byAilment, "ailment"],
                        [observed, "seen in game"],
                        [none, "no counterpart"],
                    ].filter(([decided]) => decided !== undefined);
                    const pair = `${type} to ${element}`;
                    if (decisions.length === 0) throw new Error(`no decision for ${pair}`);
                    if (decisions.some(([decided]) => decided !== decisions[0][0])) {
                        const each = decisions.map(([t, basis]) => `${t} by "${basis}"`);
                        throw new Error(`the bases disagree for ${pair}: ${each.join(", ")}`);
                    }
                    to[element] =
                        kind === "damage" && critical.has(type)
                            ? [null, "refused since 3.28.0"]
                            : decisions[decisions.length - 1];
                }
                return { from: type, to };
            });
        }
    }
    return out;
}

/** The table as the file's text: one row a line, in the game's list order. */
export function renderHarvestChange(pairs) {
    const kinds = Object.entries(pairs).map(([kind, byElement]) => {
        const elements = Object.entries(byElement).map(
            ([element, rows]) =>
                `${JSON.stringify(element)}:[\n${rows.map((r) => JSON.stringify(r)).join(",\n")}\n]`,
        );
        return `${JSON.stringify(kind)}:{\n${elements.join(",\n")}\n}`;
    });
    return `{\n${kinds.join(",\n")}\n}\n`;
}

async function main() {
    const lists = projectHarvestChange(readRows(await table()));
    const mods = JSON.parse(readFileSync(`${OUT_DIR}/mods.json`, "utf8"));
    const known = new Set(Object.values(mods).map((m) => m.type));
    const names = Object.values(lists).flatMap((byElement) => Object.values(byElement).flat());
    const unknown = names.filter((n) => !known.has(n));
    if (unknown.length > 0) {
        throw new Error(`not modifier types of mods.json: ${unknown.join(", ")}`);
    }
    const critical = new Set(
        Object.values(mods)
            .filter((m) => m.implicit_tags.includes("critical"))
            .map((m) => m.type),
    );

    const text = renderHarvestChange(pairHarvestChange(lists, critical));
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
}

// Importable for its projection; runs only as a script.
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) await main();
