import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
    type FetchLike,
    loadDefaultPoe1,
    PriceCache,
    PRICES_FRESH_MS,
    priceSetting,
    registryOf,
} from "@hinekora/data";
import { getHover } from "./hover.js";
import { livePrices } from "./live-prices.js";

const registry = registryOf(loadDefaultPoe1());
const START = Date.parse("2026-11-19T12:00:00Z");

let dir: string;
beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "hinekora-lsp-prices-"));
});
afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
});

/** poe.ninja, held until `release`: every overview empty but the Divine Orb's rate. */
function heldNinja(): { fetch: FetchLike; release: () => void; requests: () => number } {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let requests = 0;
    const fetch: FetchLike = async (url) => {
        requests++;
        await gate;
        const type = new URL(url).searchParams.get("type");
        const body =
            type === "Currency"
                ? {
                      core: { rates: { divine: 0.01 } },
                      items: [{ id: "chaos", name: "Chaos Orb" }],
                      lines: [{ id: "chaos", primaryValue: 1 }],
                  }
                : { items: [], lines: [] };
        return { ok: true, status: 200, json: () => Promise.resolve(body) };
    };
    return { fetch, release, requests: () => requests };
}

function saveOld(cache: PriceCache): void {
    writeFileSync(
        cache.fileOf("Standard"),
        JSON.stringify({
            source: { name: "poe.ninja", endpoint: "x", types: [] },
            league: "Standard",
            fetchedAt: new Date(START - 5 * PRICES_FRESH_MS).toISOString(),
            chaosPerDivine: 50,
            prices: { "Chaos Orb": 1 },
        }),
    );
}

const SRC = `item { base: "Titan Greaves" ilvl: 84 rarity: normal }
until has "fire resistance" t1 { essence "greed" t1 }`;

describe("the language server's prices", () => {
    it("starts with the saved prices without waiting, and serves poe.ninja's once fetched", async () => {
        const ninja = heldNinja();
        let now = START;
        const cache = new PriceCache(dir, {
            fetch: ninja.fetch,
            pause: () => Promise.resolve(),
            now: () => now,
        });
        saveOld(cache);
        const logged: string[] = [];
        const prices = livePrices(
            priceSetting({ HINEKORA_LEAGUE: "Standard" }),
            () => cache,
            () => now,
            (l) => logged.push(l),
        );

        const before = prices.get();
        expect(before?.chaosPerDivine).toBe(50);
        await new Promise((resolve) => setImmediate(resolve));
        expect(ninja.requests()).toBe(1);
        prices.get();
        expect(ninja.requests()).toBe(1);
        const hoverBefore = getHover(SRC, SRC.indexOf("until") + 1, registry, before);

        ninja.release();
        await prices.settled();
        const after = prices.get();
        expect(after?.chaosPerDivine).toBe(100);
        expect(after).not.toBe(before);
        expect(logged).toEqual([]);
        expect(getHover(SRC, SRC.indexOf("until") + 1, registry, after)).toBeDefined();
        expect(hoverBefore).toBeDefined();

        // Fresh now: within the hour, no further request.
        now += PRICES_FRESH_MS - 1;
        prices.get();
        expect(ninja.requests()).toBe(5);
    });

    it("logs a failed refresh once, not per request, and keeps the saved prices", async () => {
        let now = START;
        // A named league's failed fetch also asks for the league list, to tell
        // an unknown league from an unreachable site; count the attempts.
        let requests = 0;
        const cache = new PriceCache(dir, {
            fetch: (url) => {
                if (url.includes("type=Currency")) requests++;
                return Promise.reject(new Error("offline"));
            },
            pause: () => Promise.resolve(),
            now: () => now,
        });
        saveOld(cache);
        const logged: string[] = [];
        const prices = livePrices(
            priceSetting({ HINEKORA_LEAGUE: "Standard" }),
            () => cache,
            () => now,
            (l) => logged.push(l),
        );
        await prices.settled();
        for (let i = 0; i < 10; i++) expect(prices.get()?.chaosPerDivine).toBe(50);
        await prices.settled();
        expect(requests).toBe(1);
        now += PRICES_FRESH_MS;
        prices.get();
        await prices.settled();
        expect(requests).toBe(2);
        expect(logged).toEqual([
            "hinekora: poe.ninja could not be reached (Currency: offline); using Standard prices of 2026-11-19",
        ]);
    });

    it("makes no request with HINEKORA_PRICES set to none", () => {
        const prices = livePrices(
            priceSetting({ HINEKORA_PRICES: "none" }),
            () => {
                throw new Error("the cache is not consulted");
            },
            () => START,
            () => undefined,
        );
        expect(prices.get()).toBeUndefined();
    });
});
