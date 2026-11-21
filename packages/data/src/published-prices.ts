/**
 * The prices file the site publishes beside the playground, which cannot read
 * poe.ninja itself (poe.ninja allows no other site's page to). The site's
 * deploy fetches it from poe.ninja; when poe.ninja cannot be read, it publishes
 * again the file the live site serves, and failing that, none. The deploy
 * never fails for prices: the playground falls back to the bundled snapshot.
 */
import { type RawEconomy, rawEconomyOf } from "./economy.js";
import { fetchEconomy, fetchLeagues, NINJA_TIMEOUT_MS, type NinjaClient } from "./ninja.js";

export type PricesToPublish =
    | { readonly kind: "fresh"; readonly raw: RawEconomy }
    | { readonly kind: "republished"; readonly raw: RawEconomy; readonly why: string }
    | { readonly kind: "none"; readonly why: string };

function reasonOf(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

/** A file that lists nothing would hide the bundled snapshot's prices. */
function listed(raw: RawEconomy, from: string): RawEconomy {
    if (Object.keys(raw.prices).length === 0) throw new Error(`${from}: no prices listed`);
    return raw;
}

async function fromNinja(client: NinjaClient): Promise<RawEconomy> {
    const league = (await fetchLeagues(client))[0]!;
    return listed(await fetchEconomy(client, league), league);
}

async function fromLiveSite(client: NinjaClient, url: string): Promise<RawEconomy> {
    const res = await client.fetch(url, {
        headers: {},
        signal: AbortSignal.timeout(NINJA_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    const raw = rawEconomyOf(await res.json());
    if (raw === undefined) throw new Error(`${url} is not a prices file`);
    return listed(raw, url);
}

/**
 * The prices to publish: poe.ninja's current league, else the file the live
 * site serves at `previousUrl`, else none. Never throws.
 */
export async function pricesToPublish(
    client: NinjaClient,
    previousUrl: string | undefined,
): Promise<PricesToPublish> {
    let why: string;
    try {
        return { kind: "fresh", raw: await fromNinja(client) };
    } catch (error) {
        why = `poe.ninja could not be read (${reasonOf(error)})`;
    }
    if (previousUrl === undefined || previousUrl === "") {
        return { kind: "none", why: `${why}; no live site to take prices from` };
    }
    try {
        return { kind: "republished", raw: await fromLiveSite(client, previousUrl), why };
    } catch (error) {
        return { kind: "none", why: `${why}; nor the live site's (${reasonOf(error)})` };
    }
}

/** The one line the deploy's log shows for what was published. */
export function publishedLine(result: PricesToPublish, path: string): string {
    const what = (raw: RawEconomy): string =>
        `${Object.keys(raw.prices).length} ${raw.league} prices of ${raw.fetchedAt.slice(0, 10)}`;
    switch (result.kind) {
        case "fresh":
            return `published ${what(result.raw)} from poe.ninja to ${path}`;
        case "republished":
            return `${result.why}; published the live site's ${what(result.raw)} again to ${path}`;
        case "none":
            return `${result.why}; published no prices file, so the playground uses its bundled snapshot`;
    }
}
