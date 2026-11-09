#!/usr/bin/env node
/**
 * The `hinekora` command. Usage:
 *
 *   hinekora check <file.craft>
 *   hinekora fmt [--check] <file.craft>
 *   hinekora chart <file.craft>
 *   hinekora cost <file.craft>
 *
 * `check` loads the bundled PoE1 catalog, prints its provenance, and checks
 * the file. `fmt` rewrites the file in the house style, or with `--check`
 * only reports whether it already is. `chart` prints the guide as a Mermaid
 * flowchart, for a README or a wiki page to embed. `cost` prints what each
 * step is expected to consume and the total at the bundled economy snapshot's
 * prices.
 * Exit codes: 0 = checks pass / formatted / charted / costed, 1 = craft has
 * errors / needs formatting / does not parse, 2 = usage / I/O error.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { loadDefaultEconomy, loadDefaultPoe1, registryOf } from "@hinekora/data";
import { formatCraft } from "@hinekora/parser";
import { chartSource, checkSource, costSource } from "./check.js";

const USAGE =
    "usage: hinekora check <file.craft> | hinekora fmt [--check] <file.craft> | hinekora chart <file.craft> | hinekora cost <file.craft>\n";

function tryRead(file: string): string | undefined {
    try {
        return readFileSync(file, "utf8");
    } catch {
        process.stderr.write(`hinekora: cannot read file: ${file}\n`);
        return undefined;
    }
}

function check(file: string): number {
    const source = tryRead(file);
    if (source === undefined) return 2;

    const data = loadDefaultPoe1();
    const m = data.manifest;
    process.stdout.write(
        `data: ${m.source.name} @ ${m.source.commit.slice(0, 10)} (${m.game}, game ${m.gameVersion})\n\n`,
    );

    const { output, ok } = checkSource(source, file, registryOf(data));
    process.stdout.write(`${output}\n`);
    return ok ? 0 : 1;
}

function fmt(file: string, checkOnly: boolean): number {
    const source = tryRead(file);
    if (source === undefined) return 2;
    const formatted = formatCraft(source);
    if (formatted === undefined) {
        process.stderr.write(
            `hinekora: ${file} does not parse; run 'hinekora check' for the error\n`,
        );
        return 1;
    }
    if (formatted === source) return 0;
    if (checkOnly) {
        process.stdout.write(`${file} needs formatting\n`);
        return 1;
    }
    writeFileSync(file, formatted);
    process.stdout.write(`formatted ${file}\n`);
    return 0;
}

function chart(file: string): number {
    const source = tryRead(file);
    if (source === undefined) return 2;
    const text = chartSource(source, registryOf(loadDefaultPoe1()));
    if (text === undefined) {
        process.stderr.write(
            `hinekora: ${file} does not parse; run 'hinekora check' for the error\n`,
        );
        return 1;
    }
    process.stdout.write(`${text}\n`);
    return 0;
}

function cost(file: string): number {
    const source = tryRead(file);
    if (source === undefined) return 2;
    const { output, ok } = costSource(
        source,
        file,
        registryOf(loadDefaultPoe1()),
        loadDefaultEconomy(),
    );
    process.stdout.write(`${output}\n`);
    return ok ? 0 : 1;
}

function main(argv: readonly string[]): number {
    const [cmd, ...rest] = argv.slice(2);
    if (cmd === "check" && rest.length === 1) return check(rest[0]!);
    if (cmd === "cost" && rest.length === 1) return cost(rest[0]!);
    if (cmd === "chart" && rest.length === 1) return chart(rest[0]!);
    if (cmd === "fmt") {
        const checkOnly = rest[0] === "--check";
        const file = checkOnly ? rest[1] : rest[0];
        if (file !== undefined && rest.length === (checkOnly ? 2 : 1)) return fmt(file, checkOnly);
    }
    process.stderr.write(USAGE);
    return 2;
}

// Set exitCode (rather than process.exit) so stdout flushes before exit.
process.exitCode = main(process.argv);
