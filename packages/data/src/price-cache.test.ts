import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { RawEconomy } from "./economy.js";
import { fakeNinja } from "./ninja-fake.js";
import type { FetchLike, NinjaClient } from "./ninja.js";
import {
    loadPricesFile,
    PriceCache,
    priceCacheDir,
    pricesFor,
    priceSetting,
    PRICES_FRESH_MS,
    UnknownLeague,
    writeAtomic,
} from "./price-cache.js";

const NOW = Date.parse("2026-11-19T12:00:00Z");
const MINUTE = 60 * 1000;

let dir: string;
beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "hinekora-prices-"));
});
afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
});

function client(fetch: FetchLike, now = NOW): NinjaClient {
    return { fetch, pause: () => Promise.resolve(), now: () => now };
}

const offline: FetchLike = () => Promise.reject(new Error("getaddrinfo ENOTFOUND poe.ninja"));

function snapshot(league: string, fetchedAt: number, chaosPerDivine = 70): RawEconomy {
    return {
        source: { name: "poe.ninja", endpoint: "x", types: [] },
        league,
        fetchedAt: new Date(fetchedAt).toISOString(),
        chaosPerDivine,
        prices: { "Chaos Orb": 1, "Divine Orb": chaosPerDivine },
    };
}

function save(cache: PriceCache, raw: RawEconomy): void {
    writeFileSync(cache.fileOf(raw.league), JSON.stringify(raw));
}

function saveLeagues(fetchedAt: number, leagues = ["Covens", "Standard"]): void {
    writeFileSync(
        join(dir, "leagues.json"),
        JSON.stringify({ fetchedAt: new Date(fetchedAt).toISOString(), leagues }),
    );
}

describe("the price cache", () => {
    it("uses prices under the hour old without a request", async () => {
        const { fetch, urls } = fakeNinja();
        const cache = new PriceCache(dir, client(fetch));
        save(cache, snapshot("Standard", NOW - 59 * MINUTE));
        const result = await cache.current("Standard");
        expect(urls).toEqual([]);
        expect(result.note).toBeUndefined();
        expect(result.prices?.chaosPerDivine).toBe(70);
    });

    it("needs no request for the default league either, while its list is fresh", async () => {
        const { fetch, urls } = fakeNinja();
        const cache = new PriceCache(dir, client(fetch));
        saveLeagues(NOW - 10 * MINUTE);
        save(cache, snapshot("Covens", NOW - 10 * MINUTE));
        expect((await cache.current(undefined)).prices?.league).toBe("Covens");
        expect(urls).toEqual([]);
    });

    it("fetches and saves when there is no saved file", async () => {
        const { fetch, urls } = fakeNinja();
        const cache = new PriceCache(dir, client(fetch));
        const fetching: string[] = [];
        const result = await cache.current("Standard", (l) => fetching.push(l));
        expect(fetching).toEqual(["Standard"]);
        expect(urls).toHaveLength(5);
        expect(result.prices?.chaosPerDivine).toBe(80);
        const saved = JSON.parse(readFileSync(cache.fileOf("Standard"), "utf8")) as RawEconomy;
        expect(saved.league).toBe("Standard");
        expect(saved.fetchedAt).toBe(new Date(NOW).toISOString());
        expect(saved.prices["Divine Orb"]).toBe(80);
    });

    it("refetches and rewrites prices an hour old", async () => {
        const { fetch, urls } = fakeNinja();
        const cache = new PriceCache(dir, client(fetch));
        save(cache, snapshot("Standard", NOW - PRICES_FRESH_MS));
        const result = await cache.current("Standard");
        expect(urls).toHaveLength(5);
        expect(result.prices?.chaosPerDivine).toBe(80);
        expect(loadPricesFile(cache.fileOf("Standard")).fetchedAt).toBe(
            new Date(NOW).toISOString(),
        );
    });

    it("refetches prices and the league list dated in the future", async () => {
        const { fetch, urls } = fakeNinja();
        const cache = new PriceCache(dir, client(fetch));
        saveLeagues(NOW + 10 * MINUTE);
        save(cache, snapshot("Covens", NOW + 10 * MINUTE));
        const result = await cache.current(undefined);
        expect(urls[0]).toBe("https://poe.ninja/poe1/api/data/index-state");
        expect(urls).toHaveLength(6);
        expect(result.prices?.fetchedAt).toBe(new Date(NOW).toISOString());
    });

    it("takes the default league from poe.ninja's first, and saves the list", async () => {
        const { fetch, urls } = fakeNinja();
        const cache = new PriceCache(dir, client(fetch));
        const result = await cache.current(undefined);
        expect(urls[0]).toBe("https://poe.ninja/poe1/api/data/index-state");
        expect(urls[1]).toContain("league=Covens&type=Currency");
        expect(result.prices?.league).toBe("Covens");
        expect(cache.saved(undefined)?.league).toBe("Covens");
    });

    it("asks for the list again when it is stale, but not the prices when they are fresh", async () => {
        const { fetch, urls } = fakeNinja();
        const cache = new PriceCache(dir, client(fetch));
        saveLeagues(NOW - 2 * PRICES_FRESH_MS);
        save(cache, snapshot("Covens", NOW - 10 * MINUTE));
        await cache.current(undefined);
        expect(urls).toEqual(["https://poe.ninja/poe1/api/data/index-state"]);
    });

    it("uses old prices and says so when poe.ninja cannot be reached", async () => {
        const cache = new PriceCache(dir, client(offline));
        save(cache, snapshot("Standard", Date.parse("2026-11-12T08:00:00Z")));
        const result = await cache.current("Standard");
        expect(result.prices?.league).toBe("Standard");
        expect(result.note).toBe(
            "poe.ninja could not be reached (Currency: getaddrinfo ENOTFOUND poe.ninja); using Standard prices of 2026-11-12",
        );
    });

    it("uses the default league's old prices when poe.ninja cannot be reached", async () => {
        const cache = new PriceCache(dir, client(offline));
        saveLeagues(NOW - 3 * PRICES_FRESH_MS);
        save(cache, snapshot("Covens", NOW - 3 * PRICES_FRESH_MS));
        const result = await cache.current(undefined);
        expect(result.prices?.league).toBe("Covens");
        expect(result.note).toContain("using Covens prices of 2026-11-19");
    });

    it("gives no prices, and says why, when poe.ninja cannot be reached and none are saved", async () => {
        const refused = fakeNinja(undefined, 503).fetch;
        const result = await new PriceCache(dir, client(refused)).current(undefined);
        expect(result.prices).toBeUndefined();
        expect(result.note).toBe(
            "poe.ninja could not be reached (leagues: HTTP 503) and no prices are saved, so costs stay in currency units",
        );
    });

    it("names the leagues poe.ninja has when asked for one it does not price", async () => {
        const { fetch } = fakeNinja({ index: fakeIndex() });
        const cache = new PriceCache(dir, client(fetch));
        const failed = cache.current("Necropolis");
        await expect(failed).rejects.toThrow(UnknownLeague);
        await expect(failed).rejects.toThrow(
            'poe.ninja has no prices for the league "Necropolis"; it has Covens, Hardcore Covens, Standard',
        );
    });

    it("treats a cut-short or foreign file as no saved prices", async () => {
        const cache = new PriceCache(dir, client(offline));
        writeFileSync(cache.fileOf("Standard"), '{"league": "Standard", "fetchedAt": "2026-');
        expect(cache.saved("Standard")).toBeUndefined();
        expect((await cache.current("Standard")).prices).toBeUndefined();
        writeFileSync(cache.fileOf("Standard"), JSON.stringify({ league: "Standard", prices: 3 }));
        expect(cache.saved("Standard")).toBeUndefined();
        writeFileSync(join(dir, "leagues.json"), "not json");
        expect(cache.saved(undefined)).toBeUndefined();
        const { fetch } = fakeNinja();
        const healed = await new PriceCache(dir, client(fetch)).current("Standard");
        expect(healed.prices?.chaosPerDivine).toBe(80);
        expect(new PriceCache(dir, client(offline)).saved("Standard")).toBeDefined();
    });

    it("runs one refresh at a time however many ask", async () => {
        const { fetch, urls } = fakeNinja();
        const cache = new PriceCache(dir, client(fetch));
        const [a, b] = await Promise.all([cache.current("Standard"), cache.current("Standard")]);
        expect(a).toBe(b);
        expect(urls).toHaveLength(5);
    });
});

function fakeIndex(): unknown {
    return {
        economyLeagues: [{ name: "Covens" }, { name: "Hardcore Covens" }, { name: "Standard" }],
    };
}

describe("writing a cache file", () => {
    it("writes through a temporary file, leaving only the finished one", () => {
        const path = join(dir, "nested", "prices-Standard.json");
        writeAtomic(path, "first");
        writeAtomic(path, "second");
        expect(readFileSync(path, "utf8")).toBe("second");
        expect(readdirSync(join(dir, "nested"))).toEqual(["prices-Standard.json"]);
    });

    it("leaves the old file whole when the write fails", () => {
        const path = join(dir, "prices-Standard.json");
        writeAtomic(path, "whole");
        // A directory where the temporary file's parent should be makes the write fail.
        expect(() => {
            writeAtomic(join(path, "inside.json"), "never");
        }).toThrow();
        expect(readFileSync(path, "utf8")).toBe("whole");
        expect(statSync(path).isFile()).toBe(true);
    });
});

describe("where prices come from", () => {
    it("reads HINEKORA_PRICES as a pinned file, or as none", async () => {
        const file = join(dir, "pinned.json");
        writeFileSync(file, JSON.stringify(snapshot("Settlers", NOW - 900 * PRICES_FRESH_MS)));
        const noCache = (): PriceCache => {
            throw new Error("the cache is not consulted");
        };
        const pinned = await pricesFor(priceSetting({ HINEKORA_PRICES: file }), noCache);
        expect(pinned.prices?.league).toBe("Settlers");
        const none = await pricesFor(priceSetting({ HINEKORA_PRICES: "none" }), noCache);
        expect(none.prices).toBeUndefined();
        await expect(
            pricesFor(priceSetting({ HINEKORA_PRICES: join(dir, "absent.json") }), noCache),
        ).rejects.toThrow("is not a prices file hinekora can read");
    });

    it("takes the league from --league over HINEKORA_LEAGUE, else poe.ninja's first", () => {
        expect(priceSetting({})).toEqual({ kind: "poe.ninja", league: undefined });
        expect(priceSetting({ HINEKORA_LEAGUE: "Standard" })).toEqual({
            kind: "poe.ninja",
            league: "Standard",
        });
        expect(priceSetting({ HINEKORA_LEAGUE: "Standard" }, "Hardcore")).toEqual({
            kind: "poe.ninja",
            league: "Hardcore",
        });
    });

    it("a named league makes no request for the league list", async () => {
        const { fetch, urls } = fakeNinja();
        await pricesFor(
            priceSetting({ HINEKORA_LEAGUE: "Standard" }),
            () => new PriceCache(dir, client(fetch)),
        );
        expect(urls.some((u) => u.includes("index-state"))).toBe(false);
    });

    it("keeps the cache in each platform's place", () => {
        expect(priceCacheDir("linux", {}, "/home/exile")).toBe("/home/exile/.cache/hinekora");
        expect(priceCacheDir("linux", { XDG_CACHE_HOME: "/var/cache/me" }, "/home/exile")).toBe(
            "/var/cache/me/hinekora",
        );
        expect(priceCacheDir("linux", { XDG_CACHE_HOME: "relative" }, "/home/exile")).toBe(
            "/home/exile/.cache/hinekora",
        );
        expect(priceCacheDir("darwin", { XDG_CACHE_HOME: "/x" }, "/Users/exile")).toBe(
            "/Users/exile/Library/Caches/hinekora",
        );
        expect(
            priceCacheDir(
                "win32",
                { LOCALAPPDATA: "C:\\Users\\exile\\AppData\\Local" },
                "C:\\Users\\exile",
            ),
        ).toBe("C:\\Users\\exile\\AppData\\Local\\hinekora\\Cache");
        expect(priceCacheDir("win32", {}, "C:\\Users\\exile")).toBe(
            "C:\\Users\\exile\\AppData\\Local\\hinekora\\Cache",
        );
    });
});
