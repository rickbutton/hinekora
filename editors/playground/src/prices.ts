/**
 * The prices the playground's cost lines use: the snapshot bundled with the
 * game data.
 */
import { adaptEconomy, type EconomySnapshot, rawEconomyOf } from "@hinekora/data/browser";

/** The part of `fetch` the loading uses, so a test can stand in for it. */
export type JsonFetch = (
    url: string,
) => Promise<{ readonly ok: boolean; json(): Promise<unknown> }>;

async function snapshotAt(fetch: JsonFetch, url: string) {
    try {
        const response = await fetch(url);
        return response.ok ? rawEconomyOf(await response.json()) : undefined;
    } catch {
        return undefined;
    }
}

/** The prices to show, or undefined when there are none; never throws. */
export async function loadPrices(
    fetch: JsonFetch,
    bundledUrl: string,
): Promise<EconomySnapshot | undefined> {
    const bundled = await snapshotAt(fetch, bundledUrl);
    return bundled === undefined ? undefined : adaptEconomy(bundled);
}
