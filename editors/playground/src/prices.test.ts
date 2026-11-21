import { describe, expect, it } from "vitest";
import { type JsonFetch, loadPrices } from "./prices.js";

const BUNDLED = "/bundled/economy.json";
const PUBLISHED = "../prices.json";

function snapshot(league: string, fetchedAt: string): unknown {
    return {
        source: { name: "poe.ninja", endpoint: "https://poe.ninja/", types: ["Currency"] },
        league,
        fetchedAt,
        chaosPerDivine: 80,
        prices: { "Chaos Orb": 1 },
    };
}

/** Answers each URL from `files`, a 404 for any other, as the browser's fetch would. */
function serve(files: Record<string, unknown>): JsonFetch {
    return (url) =>
        Promise.resolve({
            ok: url in files,
            json: () =>
                url in files ? Promise.resolve(files[url]) : Promise.reject(new Error("not JSON")),
        });
}

const bundled = snapshot("Covens", "2026-11-14T12:10:08.744Z");

describe("the playground's prices", () => {
    it("are the published ones when they are a snapshot at least as new as the bundled one", async () => {
        const fetch = serve({
            [BUNDLED]: bundled,
            [PUBLISHED]: snapshot("Covens", "2026-11-21T06:17:00.000Z"),
        });
        const prices = await loadPrices(fetch, BUNDLED, PUBLISHED);
        expect(prices?.fetchedAt).toBe("2026-11-21T06:17:00.000Z");
        expect(prices?.chaos.get("Chaos Orb")).toBe(1);
    });

    it("are the bundled ones when the published file is not a snapshot", async () => {
        // Newer than the bundled one, so only its shape can turn it away.
        const wrong = {
            ...(snapshot("Covens", "2026-11-21T06:17:00.000Z") as object),
            prices: { "Chaos Orb": "1" },
        };
        const fetch = serve({ [BUNDLED]: bundled, [PUBLISHED]: wrong });
        expect((await loadPrices(fetch, BUNDLED, PUBLISHED))?.fetchedAt).toBe(
            "2026-11-14T12:10:08.744Z",
        );
    });

    it("are the bundled ones when the published file is older than they are", async () => {
        const fetch = serve({
            [BUNDLED]: bundled,
            [PUBLISHED]: snapshot("Settlers", "2025-06-01T00:00:00.000Z"),
        });
        expect((await loadPrices(fetch, BUNDLED, PUBLISHED))?.league).toBe("Covens");
    });

    it("are the bundled ones when no file is published", async () => {
        const fetch = serve({ [BUNDLED]: bundled });
        expect((await loadPrices(fetch, BUNDLED, PUBLISHED))?.fetchedAt).toBe(
            "2026-11-14T12:10:08.744Z",
        );
    });

    it("are none, without throwing, when neither can be read", async () => {
        const failing: JsonFetch = () => Promise.reject(new TypeError("Failed to fetch"));
        expect(await loadPrices(failing, BUNDLED, PUBLISHED)).toBeUndefined();
        expect(await loadPrices(serve({}), BUNDLED, PUBLISHED)).toBeUndefined();
    });
});
