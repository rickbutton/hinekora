import { describe, expect, it } from "vitest";
import { fakeNinja, NINJA_ANSWERS } from "./ninja-fake.js";
import { type FetchLike, NINJA_USER_AGENT, type NinjaClient } from "./ninja.js";
import { pricesToPublish, publishedLine } from "./published-prices.js";

const LIVE = "https://example.github.io/hinekora/playground/prices.json";
const LIVE_FILE = {
    source: { name: "poe.ninja", endpoint: "https://poe.ninja/", types: ["Currency"] },
    league: "Covens",
    fetchedAt: "2026-11-20T06:17:00.000Z",
    chaosPerDivine: 81,
    prices: { "Chaos Orb": 1, "Divine Orb": 81 },
};

function client(fetch: FetchLike): NinjaClient {
    return { fetch, pause: () => Promise.resolve(), now: () => Date.parse("2026-11-21T00:17:00Z") };
}

/** poe.ninja as `fakeNinja` answers it, the live site as `live` does, and every URL asked. */
function world(
    ninjaStatus: number,
    live: { status: number; body: unknown },
): { fetch: FetchLike; urls: string[]; agents: (string | undefined)[] } {
    const ninja = fakeNinja(undefined, ninjaStatus);
    const urls: string[] = [];
    const agents: (string | undefined)[] = [];
    const fetch: FetchLike = (url, init) => {
        urls.push(url);
        agents.push(init.headers["user-agent"]);
        if (url !== LIVE) return ninja.fetch(url, init);
        return Promise.resolve({
            ok: live.status === 200,
            status: live.status,
            json: () => Promise.resolve(live.body),
        });
    };
    return { fetch, urls, agents };
}

describe("the prices the site publishes", () => {
    it("are poe.ninja's current league when poe.ninja answers, and the live site is not asked", async () => {
        const w = world(200, { status: 200, body: LIVE_FILE });
        const result = await pricesToPublish(client(w.fetch), LIVE);
        expect(result.kind).toBe("fresh");
        if (result.kind !== "fresh") return;
        expect(result.raw.league).toBe("Covens");
        expect(result.raw.fetchedAt).toBe("2026-11-21T00:17:00.000Z");
        expect(w.urls).not.toContain(LIVE);
        expect(w.agents.every((a) => a === NINJA_USER_AGENT)).toBe(true);
        expect(publishedLine(result, "out/prices.json")).toBe(
            "published 6 Covens prices of 2026-11-21 from poe.ninja to out/prices.json",
        );
    });

    it("are the live site's again when poe.ninja cannot be read", async () => {
        const w = world(403, { status: 200, body: LIVE_FILE });
        const result = await pricesToPublish(client(w.fetch), LIVE);
        expect(result).toEqual({
            kind: "republished",
            raw: LIVE_FILE,
            why: "poe.ninja could not be read (leagues: HTTP 403)",
        });
        // One request to poe.ninja, then one to the live site: nothing is retried.
        expect(w.urls).toHaveLength(2);
        expect(publishedLine(result, "out/prices.json")).toBe(
            "poe.ninja could not be read (leagues: HTTP 403); published the live site's 2 Covens prices of 2026-11-20 again to out/prices.json",
        );
    });

    it("are the live site's again when poe.ninja's answer is unusable", async () => {
        const ninja = fakeNinja({ index: { economyLeagues: [] } });
        const w = world(200, { status: 200, body: LIVE_FILE });
        const fetch: FetchLike = (url, init) =>
            url === LIVE ? w.fetch(url, init) : ninja.fetch(url, init);
        const result = await pricesToPublish(client(fetch), LIVE);
        expect(result.kind).toBe("republished");
    });

    it("are never a file that lists nothing, from poe.ninja or from the live site", async () => {
        const empty = { items: [], lines: [] };
        const ninja = fakeNinja({
            index: NINJA_ANSWERS["index"],
            Currency: { core: { rates: { divine: 0.0125 } }, ...empty },
            Essence: empty,
            Fossil: empty,
            Resonator: empty,
            Beast: { lines: [] },
        });
        const answering = (live: unknown): FetchLike => {
            const w = world(200, { status: 200, body: live });
            return (url, init) => (url === LIVE ? w.fetch(url, init) : ninja.fetch(url, init));
        };
        expect(await pricesToPublish(client(answering(LIVE_FILE)), LIVE)).toEqual({
            kind: "republished",
            raw: LIVE_FILE,
            why: "poe.ninja could not be read (Covens: no prices listed)",
        });
        const none = await pricesToPublish(client(answering({ ...LIVE_FILE, prices: {} })), LIVE);
        expect(none).toEqual({
            kind: "none",
            why: `poe.ninja could not be read (Covens: no prices listed); nor the live site's (${LIVE}: no prices listed)`,
        });
    });

    it("are none when neither poe.ninja nor the live site gives a prices file", async () => {
        const missing = await pricesToPublish(
            client(world(403, { status: 404, body: undefined }).fetch),
            LIVE,
        );
        expect(missing.kind).toBe("none");
        const wrong = await pricesToPublish(
            client(world(403, { status: 200, body: { league: "Covens" } }).fetch),
            LIVE,
        );
        expect(wrong).toEqual({
            kind: "none",
            why: `poe.ninja could not be read (leagues: HTTP 403); nor the live site's (${LIVE} is not a prices file)`,
        });
        expect(publishedLine(wrong, "out/prices.json")).toMatch(
            /; published no prices file, so the playground uses its bundled snapshot$/,
        );
    });

    it("are none when there is no live site to ask", async () => {
        const w = world(403, { status: 200, body: LIVE_FILE });
        const result = await pricesToPublish(client(w.fetch), undefined);
        expect(result.kind).toBe("none");
        expect(w.urls).not.toContain(LIVE);
    });

    it("never throw, even when the fetch itself does", async () => {
        const fetch: FetchLike = () => Promise.reject(new Error("socket hang up"));
        const result = await pricesToPublish(client(fetch), LIVE);
        expect(result.kind).toBe("none");
    });
});
