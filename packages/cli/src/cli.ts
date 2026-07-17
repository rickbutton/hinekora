#!/usr/bin/env node
/**
 * The `hinekora` command. Usage:
 *
 *   hinekora check <file.craft>
 *
 * Loads the bundled PoE1 catalog, prints its provenance, and checks the file.
 * Exit codes: 0 = checks pass, 1 = craft has errors, 2 = usage / I/O error.
 */
import { readFileSync } from "node:fs";
import { loadDefaultPoe1, registryOf } from "@hinekora/data";
import { checkSource } from "./check.js";

function main(argv: readonly string[]): number {
    const [cmd, file] = argv.slice(2);
    if (cmd !== "check" || file === undefined) {
        process.stderr.write("usage: hinekora check <file.craft>\n");
        return 2;
    }

    let source: string;
    try {
        source = readFileSync(file, "utf8");
    } catch {
        process.stderr.write(`hinekora: cannot read file: ${file}\n`);
        return 2;
    }

    const data = loadDefaultPoe1();
    const m = data.manifest;
    process.stdout.write(
        `data: ${m.source.name} @ ${m.source.commit.slice(0, 10)} (${m.game}, game ${m.gameVersion})\n\n`,
    );

    const { output, ok } = checkSource(source, file, registryOf(data));
    process.stdout.write(`${output}\n`);
    return ok ? 0 : 1;
}

// Set exitCode (rather than process.exit) so stdout flushes before exit.
process.exitCode = main(process.argv);
