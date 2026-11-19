/**
 * The `hinekora` commands, with the process's streams passed in; `cli.ts` is
 * the executable that hands them over and sets the exit code.
 */
import { readFileSync, writeFileSync } from "node:fs";
import {
    defaultPriceCacheDir,
    type Env,
    loadDefaultPoe1,
    nodeNinjaClient,
    PriceCache,
    PriceSettingError,
    pricesFor,
    priceSetting,
    registryOf,
} from "@hinekora/data";
import { formatCraft } from "@hinekora/parser";
import { chartSource, checkSource, costSource, unjudgedText } from "./check.js";

/** What a command reads and writes beyond its file, so a test can stand in for it. */
export interface CliIo {
    readonly out: (text: string) => void;
    readonly err: (text: string) => void;
    readonly env: Env;
    /** Asked for only by a command that prices, so no other touches the network. */
    readonly priceCache: () => PriceCache;
}

export function processIo(): CliIo {
    return {
        out: (text) => process.stdout.write(text),
        err: (text) => process.stderr.write(text),
        env: process.env,
        priceCache: () => new PriceCache(defaultPriceCacheDir(), nodeNinjaClient()),
    };
}

export const USAGE =
    "usage: hinekora check <file.craft> | hinekora fmt [--check] <file.craft> | hinekora chart <file.craft> | hinekora cost [--league <name>] <file.craft>\n" +
    "cost reads prices from poe.ninja; HINEKORA_PRICES=none keeps it offline\n";

function tryRead(io: CliIo, file: string): string | undefined {
    try {
        return readFileSync(file, "utf8");
    } catch {
        io.err(`hinekora: cannot read file: ${file}\n`);
        return undefined;
    }
}

function check(io: CliIo, file: string): number {
    const source = tryRead(io, file);
    if (source === undefined) return 2;

    const data = loadDefaultPoe1();
    const m = data.manifest;
    io.out(
        `data: ${m.source.name} @ ${m.source.commit.slice(0, 10)} (${m.game}, game ${m.gameVersion})\n\n`,
    );

    const { output, ok, unjudged } = checkSource(source, file, registryOf(data));
    io.out(`${output}\n`);
    return ok ? 0 : unjudged === true ? 3 : 1;
}

function fmt(io: CliIo, file: string, checkOnly: boolean): number {
    const source = tryRead(io, file);
    if (source === undefined) return 2;
    const formatted = formatCraft(source);
    if (formatted === undefined) {
        io.err(`hinekora: ${file} does not parse; run 'hinekora check' for the error\n`);
        return 1;
    }
    if (formatted === source) return 0;
    if (checkOnly) {
        io.out(`${file} needs formatting\n`);
        return 1;
    }
    writeFileSync(file, formatted);
    io.out(`formatted ${file}\n`);
    return 0;
}

function chart(io: CliIo, file: string): number {
    const source = tryRead(io, file);
    if (source === undefined) return 2;
    const text = chartSource(source, registryOf(loadDefaultPoe1()));
    if (text === undefined) {
        io.err(`hinekora: ${file} does not parse; run 'hinekora check' for the error\n`);
        return 1;
    }
    io.out(`${text}\n`);
    return 0;
}

async function cost(io: CliIo, file: string, league: string | undefined): Promise<number> {
    const source = tryRead(io, file);
    if (source === undefined) return 2;
    let found;
    try {
        found = await pricesFor(priceSetting(io.env, league), io.priceCache, (name) => {
            io.err(`hinekora: fetching ${name} prices from poe.ninja\n`);
        });
    } catch (error) {
        if (!(error instanceof PriceSettingError)) throw error;
        io.err(`hinekora: ${error.message}\n`);
        return 2;
    }
    if (found.note !== undefined) io.err(`hinekora: ${found.note}\n`);
    const { output, ok, unjudged } = costSource(
        source,
        file,
        registryOf(loadDefaultPoe1()),
        found.prices,
    );
    io.out(`${output}\n`);
    return ok ? 0 : unjudged === true ? 3 : 1;
}

/** Every command: a fault of the tool's own ends it with the could-not-judge
 *  line and its exit code, not a stack trace. */
export async function runCli(argv: readonly string[], io: CliIo): Promise<number> {
    try {
        return await run(io, argv);
    } catch (error) {
        io.out(`${unjudgedText(argv[argv.length - 1] ?? "", error)}\n`);
        return 3;
    }
}

async function run(io: CliIo, argv: readonly string[]): Promise<number> {
    const [cmd, ...rest] = argv;
    if (cmd === "check" && rest.length === 1) return check(io, rest[0]!);
    if (cmd === "cost") {
        if (rest.length === 1) return cost(io, rest[0]!, undefined);
        if (rest.length === 3 && rest[0] === "--league") return cost(io, rest[2]!, rest[1]);
    }
    if (cmd === "chart" && rest.length === 1) return chart(io, rest[0]!);
    if (cmd === "fmt") {
        const checkOnly = rest[0] === "--check";
        const file = checkOnly ? rest[1] : rest[0];
        if (file !== undefined && rest.length === (checkOnly ? 2 : 1))
            return fmt(io, file, checkOnly);
    }
    io.err(USAGE);
    return 2;
}
