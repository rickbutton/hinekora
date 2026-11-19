import { describe, expect, it } from "vitest";
import { fakeNinja, NINJA_ANSWERS } from "./ninja-fake.js";
import {
    type FetchLike,
    fetchEconomy,
    fetchLeagues,
    NINJA_EXCHANGE,
    NINJA_ITEMS,
    NINJA_USER_AGENT,
    NinjaError,
    type NinjaClient,
} from "./ninja.js";

function client(fetch: FetchLike, pauses: number[] = []): NinjaClient {
    return {
        fetch,
        pause: (ms) => {
            pauses.push(ms);
            return Promise.resolve();
        },
        now: () => Date.parse("2026-11-19T10:00:00Z"),
    };
}

describe("reading poe.ninja", () => {
    it("lists the leagues, the challenge league first", async () => {
        const { fetch } = fakeNinja();
        expect(await fetchLeagues(client(fetch))).toEqual([
            "Covens",
            "Hardcore Covens",
            "Standard",
        ]);
    });

    it("reads a league's prices into the snapshot's shape, pausing between requests", async () => {
        const { fetch, urls } = fakeNinja();
        const pauses: number[] = [];
        const raw = await fetchEconomy(client(fetch, pauses), "Hardcore Covens");
        expect(urls).toEqual([
            `${NINJA_EXCHANGE}?league=Hardcore%20Covens&type=Currency`,
            `${NINJA_EXCHANGE}?league=Hardcore%20Covens&type=Essence`,
            `${NINJA_EXCHANGE}?league=Hardcore%20Covens&type=Fossil`,
            `${NINJA_EXCHANGE}?league=Hardcore%20Covens&type=Resonator`,
            `${NINJA_ITEMS}?league=Hardcore%20Covens&type=Beast`,
        ]);
        expect(pauses).toHaveLength(4);
        expect(raw.league).toBe("Hardcore Covens");
        expect(raw.fetchedAt).toBe("2026-11-19T10:00:00.000Z");
        expect(raw.chaosPerDivine).toBe(80);
        expect(raw.prices).toEqual({
            "Black Mórrigan": 200,
            "Chaos Orb": 1,
            "Deafening Essence of Greed": 3,
            "Divine Orb": 80,
            "Orb of Alteration": 0.1,
            "Pristine Fossil": 2,
        });
    });

    it("names itself to the site", async () => {
        const seen: string[] = [];
        const { fetch } = fakeNinja();
        await fetchLeagues(
            client((url, init) => {
                seen.push(init.headers["user-agent"] ?? "");
                return fetch(url, init);
            }),
        );
        expect(seen).toEqual([NINJA_USER_AGENT]);
    });

    it("fails plainly on a refusal, an unknown shape or no answer", async () => {
        await expect(fetchLeagues(client(fakeNinja(NINJA_ANSWERS, 503).fetch))).rejects.toThrow(
            "leagues: HTTP 503",
        );
        await expect(fetchLeagues(client(fakeNinja({ index: {} }).fetch))).rejects.toThrow(
            NinjaError,
        );
        await expect(
            fetchEconomy(
                client(fakeNinja({ ...NINJA_ANSWERS, Currency: { lines: [] } }).fetch),
                "X",
            ),
        ).rejects.toThrow("Currency: the answer has no items list");
        const offline: FetchLike = () => Promise.reject(new Error("getaddrinfo ENOTFOUND"));
        await expect(fetchLeagues(client(offline))).rejects.toThrow("leagues: getaddrinfo");
    });

    it("refuses an answer with no Divine Orb rate", async () => {
        const answers = {
            ...NINJA_ANSWERS,
            Currency: { items: [], lines: [] },
            Essence: { items: [], lines: [] },
        };
        await expect(fetchEconomy(client(fakeNinja(answers).fetch), "Covens")).rejects.toThrow(
            "no Divine Orb rate",
        );
    });
});
