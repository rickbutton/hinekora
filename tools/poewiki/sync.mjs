/**
 * Brings the local poewiki.net cache up to date without re-downloading it.
 *
 * MediaWiki's recentchanges feed lists every edit, creation, deletion and move
 * since a timestamp. Those pages (and only those) are re-exported into the
 * updates overlay, the title index is repointed at the new revisions, and any
 * Markdown rendered from them is deleted so the next render fetches fresh.
 * Cargo tables have no change feed; they are re-exported whole, which is cheap
 * (a few requests per table), for the tables fed by the namespaces that saw
 * changes, or for whatever `--cargo` names.
 *
 *   node tools/poewiki/sync.mjs                    # pages since the last sync, Cargo tables by namespace
 *   node tools/poewiki/sync.mjs --cargo=none       # pages only
 *   node tools/poewiki/sync.mjs --cargo=all        # pages, then every Cargo table
 *   node tools/poewiki/sync.mjs --cargo=mods,mod_stats
 *   node tools/poewiki/sync.mjs --since=2026-10-24T19:10:00Z   # first run, or to widen the window
 *   node tools/poewiki/sync.mjs --dry-run          # list what would change, fetch nothing else
 */
import { existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import {
    api,
    CONTENT_NS,
    exportTable,
    invalidateRendered,
    listCargoTables,
    loadIndex,
    log,
    parseArgs,
    paths,
    readState,
    requestCount,
    saveIndex,
    splitPages,
    writeOverlayPage,
    writeState,
} from "./lib.mjs";

// Which Cargo tables are declared by pages in which namespace. Item pages live
// in the main namespace; the Modifier namespace holds one page per mod row.
const TABLES_BY_NS = {
    0: [
        "items",
        "item_stats",
        "item_buffs",
        "item_purchase_costs",
        "item_sell_prices",
        "legacy_variants",
        "stackables",
        "flasks",
        "shields",
        "tinctures",
        "essences",
        "fossils",
        "fossil_weights",
        "crafting_bench_options",
        "maps",
        "map_series",
        "spawn_weights",
    ],
    10004: ["mods", "mod_stats", "mod_spawn_weights", "mod_generation_weights", "mod_sell_prices"],
    10008: ["item_stats", "mod_stats"],
};

const EXPORT_BATCH = 50;

const { flags } = parseArgs(process.argv.slice(2));
const dryRun = flags.has("dry-run");
const state = readState();
const since = flags.get("since") ?? state.lastSync;
if (!since) {
    console.error("no previous sync recorded; pass --since=<ISO timestamp of the snapshot>");
    process.exit(2);
}

// 1. Everything that changed since `since`, newest revision per title.
const changed = new Map();
const deleted = new Set();
let serverNow;
let rccontinue;
do {
    const body = await api({
        action: "query",
        list: "recentchanges",
        rcstart: since,
        rcdir: "newer",
        rcnamespace: CONTENT_NS.join("|"),
        rcprop: "title|ids|timestamp|loginfo",
        rctype: "edit|new|log",
        rclimit: 500,
        curtimestamp: 1,
        ...(rccontinue ? { rccontinue } : {}),
    });
    serverNow ??= body.curtimestamp;
    for (const rc of body.query.recentchanges) {
        if (rc.type === "log") {
            if (rc.logtype === "delete") deleted.add(rc.title);
            if (rc.logtype === "move") {
                changed.set(rc.title, rc.ns);
                if (rc.logparams?.target_title)
                    changed.set(rc.logparams.target_title, rc.logparams.target_ns ?? rc.ns);
            }
            continue;
        }
        changed.set(rc.title, rc.ns);
    }
    rccontinue = body.continue?.rccontinue;
} while (rccontinue);
for (const t of deleted) changed.delete(t);

const byNs = {};
for (const ns of changed.values()) byNs[ns] = (byNs[ns] ?? 0) + 1;
log(
    `since ${since}: ${changed.size} changed page(s), ${deleted.size} deleted`,
    JSON.stringify(byNs),
);
if (dryRun) {
    for (const [title, ns] of changed) console.log(`${ns}\t${title}`);
    for (const title of deleted) console.log(`deleted\t${title}`);
    process.exit(0);
}

// 2. Re-export the changed pages into the overlay and repoint the index.
const index = loadIndex();
const titles = [...changed.keys()];
let exported = 0;
for (let i = 0; i < titles.length; i += EXPORT_BATCH) {
    const batch = titles.slice(i, i + EXPORT_BATCH);
    const body = await api({
        action: "query",
        titles: batch.join("|"),
        export: 1,
        exportnowrap: 0,
    });
    const seen = new Set();
    for (const page of splitPages(body.query.export)) {
        index[page.title] = { ns: page.ns, id: page.id, file: writeOverlayPage(page) };
        invalidateRendered(page.title);
        seen.add(page.title);
        exported++;
    }
    // A title the export did not return no longer exists under that name.
    for (const title of batch) if (!seen.has(title)) deleted.add(title);
}
for (const title of deleted) {
    const entry = index[title];
    if (entry?.file.startsWith("updates/")) {
        const f = join(paths.xml, entry.file);
        if (existsSync(f)) unlinkSync(f);
    }
    delete index[title];
    invalidateRendered(title);
}
saveIndex(index);
log(`re-exported ${exported} page(s), dropped ${deleted.size}`);

// 3. Cargo tables.
const cargoArg = flags.get("cargo") ?? "auto";
let tables = [];
if (cargoArg === "all") tables = await listCargoTables();
else if (cargoArg !== "none" && cargoArg !== "auto") tables = cargoArg.split(",");
else if (cargoArg === "auto") {
    tables = [...new Set(Object.keys(byNs).flatMap((ns) => TABLES_BY_NS[ns] ?? []))];
}
for (const table of tables) {
    try {
        await exportTable(table);
    } catch (err) {
        log(`${table}: FAILED ${err.message}`);
    }
}

writeState({
    ...state,
    lastSync: serverNow,
    lastRun: new Date().toISOString(),
    lastChanged: changed.size,
});
log(`done: lastSync=${serverNow}, ${requestCount()} request(s)`);
