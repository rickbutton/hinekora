/**
 * The language server's prices: what the cache holds when it starts, however
 * old, then poe.ninja's, fetched in the background when the saved ones are
 * over the hour. A request never waits on the network; it prices with what is
 * at hand and the next one sees the refresh.
 */
import type { Prices } from "@hinekora/core";
import {
    loadPricesFile,
    PRICES_FRESH_MS,
    type PriceCache,
    type PriceSetting,
} from "@hinekora/data";

export interface LivePrices {
    /** The prices to use now; starts a refresh when it is due. */
    readonly get: () => Prices | undefined;
    /** The refresh under way, if any, for a test to await. */
    readonly settled: () => Promise<void>;
}

export function livePrices(
    setting: PriceSetting,
    cache: () => PriceCache,
    now: () => number,
    log: (line: string) => void,
): LivePrices {
    if (setting.kind === "none") return { get: () => undefined, settled: () => Promise.resolve() };
    if (setting.kind === "file") {
        let pinned: Prices | undefined;
        try {
            pinned = loadPricesFile(setting.path);
        } catch (error) {
            log(`hinekora: ${error instanceof Error ? error.message : String(error)}`);
        }
        return { get: () => pinned, settled: () => Promise.resolve() };
    }

    const store = cache();
    const league = setting.league;
    let current: Prices | undefined = store.saved(league);
    let lastTry: number | undefined;
    let running: Promise<void> | undefined;
    let failing = false;

    const refresh = (): void => {
        lastTry = now();
        running = store
            .current(league)
            .then((result) => {
                if (result.prices !== undefined) current = result.prices;
                if (result.note === undefined) failing = false;
                else if (!failing) {
                    failing = true;
                    log(`hinekora: ${result.note}`);
                }
            })
            .catch((error: unknown) => {
                if (!failing) {
                    failing = true;
                    log(`hinekora: ${error instanceof Error ? error.message : String(error)}`);
                }
            })
            .finally(() => {
                running = undefined;
            });
    };

    const stale = (): boolean =>
        current === undefined || now() - Date.parse(current.fetchedAt) >= PRICES_FRESH_MS;
    // A failed refresh is tried again an hour later, so a server offline for a
    // day asks poe.ninja once an hour, not once per hover.
    const get = (): Prices | undefined => {
        const due = lastTry === undefined || now() - lastTry >= PRICES_FRESH_MS;
        if (running === undefined && due && stale()) refresh();
        return current;
    };
    get();
    return { get, settled: () => running ?? Promise.resolve() };
}
