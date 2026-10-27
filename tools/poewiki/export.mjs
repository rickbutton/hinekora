/**
 * Takes a full snapshot of poewiki.net into the local cache: every content
 * namespace as MediaWiki XML (current revisions) and every Cargo table as
 * JSONL. Only needed once per machine; afterwards sync.mjs keeps it current.
 * Resumable: finished namespaces and tables are skipped on rerun.
 *
 *   POEWIKI_DELAY_MS=5000 node tools/poewiki/export.mjs --xml --cargo
 *   node tools/poewiki/export.mjs --xml --ns=0,10004
 *   node tools/poewiki/export.mjs --cargo --tables=mods,mod_spawn_weights
 *
 * About 280 XML requests and 200 Cargo requests in all; at a conservative
 * pace that is a couple of hours. Records the start time in state.json so the
 * first sync knows where to pick up.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
    api,
    buildIndex,
    CONTENT_NS,
    exportTable,
    listCargoTables,
    log,
    parseArgs,
    paths,
    readState,
    requestCount,
    writeState,
} from "./lib.mjs";

const BATCH = 500;
const { flags } = parseArgs(process.argv.slice(2));

async function exportNamespace(ns) {
    const dir = join(paths.xml, `ns${ns}`);
    const done = join(paths.xml, `ns${ns}.done`);
    const stateFile = join(paths.xml, `ns${ns}.state.json`);
    if (existsSync(done)) return log(`ns${ns}: already done`);
    mkdirSync(dir, { recursive: true });
    let { batch, gapcontinue } = existsSync(stateFile)
        ? JSON.parse(readFileSync(stateFile, "utf8"))
        : { batch: 0 };
    for (;;) {
        const body = await api({
            action: "query",
            generator: "allpages",
            gapnamespace: ns,
            gaplimit: BATCH,
            gapfilterredir: "all",
            export: 1,
            ...(gapcontinue ? { gapcontinue } : {}),
        });
        const pages = body.query?.pages ?? [];
        if (pages.length) {
            batch++;
            writeFileSync(
                join(dir, `batch-${String(batch).padStart(4, "0")}.xml`),
                body.query.export,
            );
            log(`ns${ns}: batch ${batch}, ${pages.length} pages, through "${pages.at(-1).title}"`);
        }
        gapcontinue = body.continue?.gapcontinue;
        writeFileSync(stateFile, JSON.stringify({ batch, gapcontinue }));
        if (!gapcontinue) break;
    }
    writeFileSync(done, new Date().toISOString());
}

const state = readState();
if (!state.snapshotStarted) writeState({ ...state, snapshotStarted: new Date().toISOString() });

if (flags.has("xml")) {
    mkdirSync(paths.xml, { recursive: true });
    const namespaces =
        typeof flags.get("ns") === "string" ? flags.get("ns").split(",").map(Number) : CONTENT_NS;
    for (const ns of namespaces) await exportNamespace(ns);
    buildIndex();
    log("index rebuilt");
}

if (flags.has("cargo")) {
    mkdirSync(paths.cargo, { recursive: true });
    const tables =
        typeof flags.get("tables") === "string"
            ? flags.get("tables").split(",")
            : await listCargoTables();
    for (const table of tables) {
        if (!flags.has("force") && existsSync(join(paths.cargo, `${table}.jsonl`))) {
            log(`${table}: already exported`);
            continue;
        }
        try {
            await exportTable(table);
        } catch (err) {
            log(`${table}: FAILED ${err.message}`);
        }
    }
}

const after = readState();
if (!after.lastSync) writeState({ ...after, lastSync: after.snapshotStarted });
log(`finished, ${requestCount()} request(s)`);
