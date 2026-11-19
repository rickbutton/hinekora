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
 * only reports whether it already is. `chart` prints the craft as a Mermaid
 * flowchart, for a README or a wiki page to embed. `cost` prints what each
 * step is expected to consume and the total at the bundled economy snapshot's
 * prices.
 * Exit codes: 0 = checks pass / formatted / charted / costed, 1 = craft has
 * errors / needs formatting / does not parse, 2 = usage / I/O error, 3 = the
 * tool could not judge the craft (a fault of its own), under any command. `cost`
 * exits 0 whenever the craft parses and the tool judges it: a craft with check
 * errors is still costed, as written, and the report's first line says so.
 */
import { runCli } from "./commands.js";

// Set exitCode (rather than process.exit) so stdout flushes before exit.
process.exitCode = runCli(process.argv.slice(2), {
    out: (text) => process.stdout.write(text),
    err: (text) => process.stderr.write(text),
});
