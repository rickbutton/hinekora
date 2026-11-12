/**
 * How fast the checker and the cost layer are, and how much they keep, over
 * the repository's crafts and a few deliberately wide ones. A tool for
 * performance work, not a test: the numbers move with the machine, so compare
 * two builds on one machine, and read the least of several runs.
 *
 *   pnpm build && node --expose-gc scripts/bench.mjs [--passes 3] [--leak 1000]
 *
 * - cold: fresh processes, each loading the modules and the catalog, building
 *   the registry and checking and costing one craft; and the command line's
 *   wall time on one craft.
 * - warm, by class of craft: the first check of a craft the process has not
 *   checked (the registry warm, the craft's universe new), a re-check after a
 *   one-step edit (a step line duplicated: the editor's path, which keeps the
 *   universe), and `costOf`; each the least over the passes, every pass on a
 *   registry of its own; and the nodes the craft's universe holds after it.
 * - memory: the heap after a collection, with the registry loaded and after
 *   the warm passes, and every 250 checks over the crafts and their edits
 *   checked in turn (a long-lived editor's session).
 */
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const pkg = (name) => import(pathToFileURL(join(root, "packages", name, "dist/index.js")).href);
const args = process.argv.slice(2);
const option = (name, fallback) => {
    const i = args.indexOf(name);
    return i < 0 ? fallback : args[i + 1];
};
const now = () => performance.now();
const ms = (x) => (Number.isFinite(x) ? x.toFixed(1) : "-");
const MB = (b) => (b / 1e6).toFixed(1);

/** Crafts that make the checker hold many items at once. */
const WIDE = {
    "wide: random and corrupted": `item {
    base: "Titan Greaves"
    ilvl: 86
    rarity: rare
    prefixes: [ "random", "random", "random" ]
    suffixes: [ "random", "random", "random" ]
}
vaal
if has "maximum life" {
    tainted divine
} else {
    tainted chaos
}`,
    "wide: strands": `item {
    base: "Vermillion Ring"
    ilvl: 84
    rarity: magic
    strands: 100
}
until has "maximum life" t1 {
    alteration
}
regal
until prefixCount >= 2 {
    exalt
}`,
    "wide: nested loops": `item {
    base: "Vermillion Ring"
    ilvl: 84
    rarity: rare
}
until has "maximum life" t1 and suffixCount >= 2 {
    until prefixCount <= 1 {
        annul
    }
    exalt
    if suffixCount == 3 {
        annul
    }
}`,
    "wide: chaos and exalt loops": `item {
    base: "Onyx Amulet"
    ilvl: 86
    rarity: rare
}
until has "level of all skill gems" {
    chaos
}
until prefixCount == 3 or suffixCount == 3 {
    exalt
}`,
    "wide: imprint loop": `item {
    base: "Crimson Jewel"
    ilvl: 84
    rarity: magic
}
until has "increased maximum life" {
    alteration
}
beast imprint
augment
until has "increased attack speed" {
    restore
    beast imprint
    augment
}`,
};

function crafts() {
    const out = [];
    const walk = (dir) => {
        for (const name of readdirSync(dir)) {
            const p = join(dir, name);
            if (statSync(p).isDirectory()) walk(p);
            else if (p.endsWith(".craft")) {
                const rel = relative(root, p).replaceAll("\\", "/");
                const cls = rel.startsWith("site/") ? "site" : "examples";
                out.push({ name: rel, cls, source: readFileSync(p, "utf8") });
            }
        }
    };
    walk(join(root, "examples"));
    walk(join(root, "site", "examples"));
    for (const [name, source] of Object.entries(WIDE)) out.push({ name, cls: "wide", source });
    return out;
}

/** The craft with its last step line written twice: an edit that keeps the universe. */
function edited(source) {
    const lines = source.split(/\r?\n/);
    const i = lines.findLastIndex(
        (l) => /^\s*[a-z]/.test(l) && !/^\s*(if|until|else|def|item)\b/.test(l) && !l.includes("{"),
    );
    if (i < 0) return undefined;
    lines.splice(i, 0, lines[i]);
    return lines.join("\n");
}

async function cold(file) {
    const t0 = now();
    const core = await pkg("core");
    const { parse } = await pkg("parser");
    const data = await pkg("data");
    const t1 = now();
    const raw = data.loadDefaultPoe1();
    const t2 = now();
    const registry = data.registryOf(raw);
    const t3 = now();
    const craft = parse(readFileSync(file, "utf8")).craft;
    const r = core.check(craft, { registry });
    const t4 = now();
    core.costOf(craft, r, registry);
    const t5 = now();
    const out = {
        modules: t1 - t0,
        catalog: t2 - t1,
        registry: t3 - t2,
        check: t4 - t3,
        cost: t5 - t4,
        sinceStart: t5,
    };
    process.stdout.write(JSON.stringify(out));
}

function coldRuns() {
    const files = [
        "site/examples/ops/chaos.craft",
        "examples/metamod-harvest-loop.craft",
        "examples/essence-minion-wand.craft",
    ];
    console.log(
        "cold (least of 3 fresh processes, ms): modules  catalog  registry  check  cost  since start | command line",
    );
    for (const f of files) {
        const runs = [];
        for (let i = 0; i < 3; i++) {
            const p = spawnSync(
                process.execPath,
                [fileURLToPath(import.meta.url), "--cold", join(root, f)],
                { encoding: "utf8" },
            );
            runs.push(JSON.parse(p.stdout));
        }
        const least = (k) => Math.min(...runs.map((r) => r[k]));
        const cli = [];
        for (let i = 0; i < 3; i++) {
            const t = now();
            spawnSync(
                process.execPath,
                [join(root, "packages/cli/dist/cli.js"), "check", join(root, f)],
                { stdio: "ignore" },
            );
            cli.push(now() - t);
        }
        const cols = ["modules", "catalog", "registry", "check", "cost", "sinceStart"].map((k) =>
            ms(least(k)).padStart(8),
        );
        console.log(`  ${f.padEnd(40)}${cols.join("")} | ${ms(Math.min(...cli))}`);
    }
}

async function warm(passes, leakChecks) {
    const gc = globalThis.gc ?? (() => {});
    const heap = () => {
        gc();
        return process.memoryUsage().heapUsed;
    };
    const core = await pkg("core");
    const { parse } = await pkg("parser");
    const data = await pkg("data");
    const raw = data.loadDefaultPoe1();
    const all = crafts()
        .map((c) => {
            const p = parse(c.source);
            const e = edited(c.source);
            const pe = e === undefined ? undefined : parse(e);
            return p.ok ? { ...c, craft: p.craft, edit: pe?.ok ? pe.craft : undefined } : undefined;
        })
        .filter((c) => c !== undefined);
    const best = new Map(
        all.map((c) => [c.name, { first: Infinity, re: Infinity, cost: Infinity, nodes: 0 }]),
    );
    let afterRegistry = 0;
    for (let pass = 0; pass < passes; pass++) {
        const registry = data.registryOf(raw);
        if (pass === 0) afterRegistry = heap();
        for (const c of all) {
            const b = best.get(c.name);
            let t = now();
            const r = core.check(c.craft, { registry });
            b.first = Math.min(b.first, now() - t);
            b.nodes = r.trace[0]?.before.u.dd.nodeCount ?? 0;
            if (c.edit !== undefined) {
                t = now();
                core.check(c.edit, { registry });
                b.re = Math.min(b.re, now() - t);
            }
            t = now();
            core.costOf(c.craft, r, registry);
            b.cost = Math.min(b.cost, now() - t);
        }
    }
    const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
    console.log(
        `\nwarm (ms; the least of ${passes} passes; median / greatest over the class): first check | re-check after an edit | cost | nodes`,
    );
    for (const cls of ["examples", "site", "wide"]) {
        const rows = all.filter((c) => c.cls === cls).map((c) => best.get(c.name));
        const col = (k) => {
            const xs = rows.map((r) => r[k]).filter(Number.isFinite);
            return `${ms(median(xs)).padStart(7)} / ${ms(Math.max(...xs)).padStart(7)}`;
        };
        const nodes = rows.map((r) => r.nodes);
        console.log(
            `  ${cls.padEnd(9)} ${String(rows.length).padStart(3)} crafts  ${col("first")} | ${col("re")} | ${col("cost")} | ${median(nodes)} / ${Math.max(...nodes)}`,
        );
    }
    for (const c of all.filter((x) => x.cls === "wide")) {
        const b = best.get(c.name);
        console.log(
            `  ${c.name.padEnd(30)} ${ms(b.first).padStart(7)} | ${ms(b.re).padStart(7)} | ${ms(b.cost).padStart(7)} | ${b.nodes}`,
        );
    }
    const total = (k) =>
        [...best.values()].reduce((a, b) => a + (Number.isFinite(b[k]) ? b[k] : 0), 0);
    console.log(
        `  sum over all: first ${ms(total("first"))}, re-check ${ms(total("re"))}, cost ${ms(total("cost"))}`,
    );
    console.log(
        `\nmemory (MB after a collection): registry loaded ${MB(afterRegistry)}, after the warm passes ${MB(heap())}`,
    );
    // A long session: each craft and its edit in turn, on one registry.
    const registry = data.registryOf(raw);
    const session = all.flatMap((c) => (c.edit === undefined ? [c.craft] : [c.craft, c.edit]));
    const start = heap();
    const marks = [];
    const t = now();
    for (let i = 1; i <= leakChecks; i++) {
        core.check(session[i % session.length], { registry });
        if (i % 250 === 0) marks.push(`${i}: +${MB(heap() - start)}`);
    }
    console.log(
        `  ${leakChecks} checks in ${ms(now() - t)} ms; heap over the session's start: ${marks.join(", ")}`,
    );
}

if (args[0] === "--cold") await cold(args[1]);
else {
    if (globalThis.gc === undefined) console.log("(run with --expose-gc for the heap figures)");
    coldRuns();
    await warm(Number(option("--passes", 3)), Number(option("--leak", 1000)));
}
