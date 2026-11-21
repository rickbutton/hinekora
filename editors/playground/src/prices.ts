/**
 * The prices the playground's cost lines use. The site's deploy publishes
 * poe.ninja's current prices beside the playground (`site/scripts/
 * publish-prices.mjs`), since a page on another site may not read poe.ninja;
 * without that file (local development, a preview build) the snapshot bundled
 * with the game data serves.
 */
import {
    adaptEconomy,
    type EconomySnapshot,
    type RawEconomy,
    rawEconomyOf,
} from "@hinekora/data/browser";

/** Where the deploy publishes the prices, relative to the playground's page. */
export const PUBLISHED_PRICES_URL = "../prices.json";

/** The part of `fetch` the loading uses, so a test can stand in for it. */
export type JsonFetch = (
    url: string,
) => Promise<{ readonly ok: boolean; json(): Promise<unknown> }>;

async function snapshotAt(fetch: JsonFetch, url: string): Promise<RawEconomy | undefined> {
    try {
        const response = await fetch(url);
        return response.ok ? rawEconomyOf(await response.json()) : undefined;
    } catch {
        return undefined;
    }
}

/**
 * The published prices when they are a snapshot no older than the bundled
 * one, else the bundled one, else undefined; never throws.
 */
export async function loadPrices(
    fetch: JsonFetch,
    bundledUrl: string,
    publishedUrl: string = PUBLISHED_PRICES_URL,
): Promise<EconomySnapshot | undefined> {
    const [published, bundled] = await Promise.all([
        snapshotAt(fetch, publishedUrl),
        snapshotAt(fetch, bundledUrl),
    ]);
    const current =
        published !== undefined &&
        (bundled === undefined || Date.parse(published.fetchedAt) >= Date.parse(bundled.fetchedAt));
    const chosen = current ? published : bundled;
    return chosen === undefined ? undefined : adaptEconomy(chosen);
}
