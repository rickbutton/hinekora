import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type FetchLike, PriceCache } from "@hinekora/data";
import { type CliIo, runCli } from "./commands.js";

const CRAFT = `item {
    base:   "Titan Greaves"
    ilvl:   84
    rarity: normal
}
until has "fire resistance" t1 { essence "greed" t1 }
`;
const NOW = Date.parse("2026-11-19T12:00:00Z");

let dir: string;
let file: string;
beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "hinekora-cli-"));
    file = join(dir, "greaves.craft");
    writeFileSync(file, CRAFT);
});
afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
});

/** poe.ninja with one league and two prices; records every URL asked for. */
function ninja(): { fetch: FetchLike; urls: string[] } {
    const urls: string[] = [];
    const fetch: FetchLike = (url) => {
        urls.push(url);
        const type = new URL(url).searchParams.get("type");
        const body = url.includes("index-state")
            ? { economyLeagues: [{ name: "Covens" }, { name: "Standard" }] }
            : type === "Currency"
              ? {
                    core: { rates: { divine: 0.01 } },
                    items: [{ id: "chaos", name: "Chaos Orb" }],
                    lines: [{ id: "chaos", primaryValue: 1 }],
                }
              : type === "Essence"
                ? {
                      items: [{ id: "g", name: "Deafening Essence of Greed" }],
                      lines: [{ id: "g", primaryValue: 2 }],
                  }
                : { items: [], lines: [] };
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
    };
    return { fetch, urls };
}

function io(
    env: Record<string, string> = {},
    fetch?: FetchLike,
): CliIo & {
    stdout: string[];
    stderr: string[];
} {
    const stdout: string[] = [];
    const stderr: string[] = [];
    return {
        stdout,
        stderr,
        out: (t) => stdout.push(t),
        err: (t) => stderr.push(t),
        env,
        priceCache: () => {
            if (fetch === undefined) throw new Error("this command must not price");
            return new PriceCache(join(dir, "cache"), {
                fetch,
                pause: () => Promise.resolve(),
                now: () => NOW,
            });
        },
    };
}

describe("hinekora cost", () => {
    it("fetches the current league's prices once, then prices from the cache", async () => {
        const { fetch, urls } = ninja();
        const first = io({}, fetch);
        expect(await runCli(["cost", file], first)).toBe(0);
        expect(first.stderr).toEqual(["hinekora: fetching Covens prices from poe.ninja\n"]);
        expect(first.stdout.join("")).toContain("at Covens prices of 2026-11-19");
        expect(urls).toHaveLength(6);

        const second = io({}, fetch);
        expect(await runCli(["cost", file], second)).toBe(0);
        expect(second.stderr).toEqual([]);
        expect(second.stdout).toEqual(first.stdout);
        expect(urls).toHaveLength(6);
    });

    it("takes --league over HINEKORA_LEAGUE, with no request for the league list", async () => {
        const { fetch, urls } = ninja();
        const run = io({ HINEKORA_LEAGUE: "Covens" }, fetch);
        expect(await runCli(["cost", "--league", "Standard", file], run)).toBe(0);
        expect(run.stdout.join("")).toContain("at Standard prices of");
        expect(urls.every((u) => u.includes("league=Standard"))).toBe(true);
    });

    it("refuses a league poe.ninja does not price, naming the ones it does", async () => {
        const { fetch } = ninja();
        const refusing: FetchLike = (url, init) =>
            url.includes("index-state")
                ? fetch(url, init)
                : Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve(null) });
        const run = io({}, refusing);
        expect(await runCli(["cost", "--league", "Ancestor", file], run)).toBe(2);
        expect(run.stderr).toEqual([
            "hinekora: fetching Ancestor prices from poe.ninja\n",
            'hinekora: poe.ninja has no prices for the league "Ancestor"; it has Covens, Standard\n',
        ]);
        expect(run.stdout).toEqual([]);
    });

    it("costs in currency units, saying why, when poe.ninja cannot be reached", async () => {
        const run = io({}, () => Promise.reject(new Error("offline")));
        expect(await runCli(["cost", file], run)).toBe(0);
        expect(run.stderr).toEqual([
            "hinekora: poe.ninja could not be reached (leagues: offline) and no prices are saved, so costs stay in currency units\n",
        ]);
        expect(run.stdout.join("")).not.toContain("prices of");
    });

    it("reads a pinned prices file, or none, without a request", async () => {
        const pinned = join(dir, "pinned.json");
        writeFileSync(
            pinned,
            JSON.stringify({
                source: { name: "poe.ninja", endpoint: "x", types: [] },
                league: "Settlers",
                fetchedAt: "2024-08-01T00:00:00Z",
                chaosPerDivine: 200,
                prices: { "Chaos Orb": 1, "Deafening Essence of Greed": 3 },
            }),
        );
        const run = io({ HINEKORA_PRICES: pinned });
        expect(await runCli(["cost", file], run)).toBe(0);
        expect(run.stdout.join("")).toContain("at Settlers prices of 2024-08-01");
        expect(run.stderr).toEqual([]);

        const none = io({ HINEKORA_PRICES: "none" });
        expect(await runCli(["cost", file], none)).toBe(0);
        expect(none.stdout.join("")).not.toContain("prices of");

        const absent = io({ HINEKORA_PRICES: join(dir, "absent.json") });
        expect(await runCli(["cost", file], absent)).toBe(2);
        expect(absent.stderr.join("")).toContain("is not a prices file hinekora can read");
    });
});

describe("commands that price nothing", () => {
    it("never reach for prices", async () => {
        for (const argv of [
            ["check", file],
            ["chart", file],
            ["fmt", "--check", file],
        ]) {
            let asked = false;
            const run: CliIo = {
                ...io(),
                priceCache: () => {
                    asked = true;
                    throw new Error("unreachable");
                },
            };
            expect(await runCli(argv, run)).toBe(0);
            expect(asked).toBe(false);
        }
    });
});
