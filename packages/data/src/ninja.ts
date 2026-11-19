/**
 * Reading poe.ninja: the leagues it prices and one league's prices, in the
 * economy snapshot's shape. The endpoints are the ones the site's own pages
 * read (docs/cost.md §7); they are not documented and may move, in which case
 * this file is what changes. The fetch is passed in, so nothing here touches
 * the disk or the network on its own, and `scripts/fetch-economy.mjs` reads
 * through the same code (from `dist/`) as the tool.
 */
import type { RawEconomy } from "./economy.js";

export const NINJA_INDEX_STATE = "https://poe.ninja/poe1/api/data/index-state";
export const NINJA_EXCHANGE = "https://poe.ninja/poe1/api/economy/exchange/current/overview";
export const NINJA_ITEMS = "https://poe.ninja/poe1/api/economy/stash/current/item/overview";
export const NINJA_EXCHANGE_TYPES: readonly string[] = [
    "Currency",
    "Essence",
    "Fossil",
    "Resonator",
];
/** The beasts are listed by the stash-item overview, priced per line in chaos. */
export const NINJA_ITEM_TYPES: readonly string[] = ["Beast"];
export const NINJA_USER_AGENT = "hinekora (https://github.com/rickbutton/hinekora)";
/** The site throttles eager clients. */
export const NINJA_PAUSE_MS = 1500;
export const NINJA_TIMEOUT_MS = 15_000;

/** The part of `fetch` this reading uses, so a test can stand in for it. */
export type FetchLike = (
    url: string,
    init: { readonly headers: Record<string, string>; readonly signal: AbortSignal },
) => Promise<{ readonly ok: boolean; readonly status: number; json(): Promise<unknown> }>;

export interface NinjaClient {
    readonly fetch: FetchLike;
    readonly pause: (ms: number) => Promise<void>;
    readonly now: () => number;
}

/** poe.ninja did not answer, or answered in a shape this reading does not know. */
export class NinjaError extends Error {
    override readonly name = "NinjaError";

    /** `answered` is true when poe.ninja replied, but not with what this reading needs. */
    constructor(
        message: string,
        readonly answered = true,
    ) {
        super(message);
    }
}

async function getJson(client: NinjaClient, url: string, what: string): Promise<unknown> {
    let res;
    try {
        res = await client.fetch(url, {
            headers: { "user-agent": NINJA_USER_AGENT },
            signal: AbortSignal.timeout(NINJA_TIMEOUT_MS),
        });
    } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        throw new NinjaError(`${what}: ${reason}`, false);
    }
    if (!res.ok) throw new NinjaError(`${what}: HTTP ${res.status}`, false);
    try {
        return await res.json();
    } catch {
        throw new NinjaError(`${what}: the answer is not JSON`);
    }
}

function isRecord(x: unknown): x is Record<string, unknown> {
    return typeof x === "object" && x !== null && !Array.isArray(x);
}

function listOf(x: unknown, key: string, what: string): readonly unknown[] {
    const list = isRecord(x) ? x[key] : undefined;
    if (!Array.isArray(list)) throw new NinjaError(`${what}: the answer has no ${key} list`);
    return list;
}

/** The leagues poe.ninja prices, the current challenge league first. */
export async function fetchLeagues(client: NinjaClient): Promise<string[]> {
    const data = await getJson(client, NINJA_INDEX_STATE, "leagues");
    const names = listOf(data, "economyLeagues", "leagues")
        .map((l) => (isRecord(l) ? l["name"] : undefined))
        .filter((n): n is string => typeof n === "string");
    if (names.length === 0) throw new NinjaError("leagues: the answer names no league");
    return names;
}

function overviewUrl(endpoint: string, league: string, type: string): string {
    return `${endpoint}?league=${encodeURIComponent(league)}&type=${type}`;
}

/**
 * One league's prices: every currency, essence, fossil, resonator and beast in
 * Chaos Orbs, and the Divine Orb's rate, with a pause between the requests.
 */
export async function fetchEconomy(client: NinjaClient, league: string): Promise<RawEconomy> {
    const prices = new Map<string, number>();
    let chaosPerDivine: number | undefined;
    let first = true;
    const next = async (): Promise<void> => {
        if (!first) await client.pause(NINJA_PAUSE_MS);
        first = false;
    };
    for (const type of NINJA_EXCHANGE_TYPES) {
        await next();
        const data = await getJson(client, overviewUrl(NINJA_EXCHANGE, league, type), type);
        const names = new Map<unknown, string>();
        for (const item of listOf(data, "items", type)) {
            if (isRecord(item) && typeof item["name"] === "string") {
                names.set(item["id"], item["name"]);
            }
        }
        for (const line of listOf(data, "lines", type)) {
            if (!isRecord(line)) continue;
            const name = names.get(line["id"]);
            const value = line["primaryValue"];
            if (name !== undefined && typeof value === "number") prices.set(name, value);
        }
        const core = isRecord(data) ? data["core"] : undefined;
        const rates = isRecord(core) ? core["rates"] : undefined;
        const divine = isRecord(rates) ? rates["divine"] : undefined;
        if (typeof divine === "number" && divine > 0) chaosPerDivine = 1 / divine;
    }
    for (const type of NINJA_ITEM_TYPES) {
        await next();
        const data = await getJson(client, overviewUrl(NINJA_ITEMS, league, type), type);
        for (const line of listOf(data, "lines", type)) {
            if (!isRecord(line)) continue;
            const name = line["name"];
            const value = line["chaosValue"];
            if (typeof name === "string" && typeof value === "number") prices.set(name, value);
        }
    }
    if (chaosPerDivine === undefined) {
        throw new NinjaError(`${league}: the answer has no Divine Orb rate`);
    }
    return {
        source: {
            name: "poe.ninja",
            endpoint: NINJA_EXCHANGE,
            types: NINJA_EXCHANGE_TYPES,
            itemEndpoint: NINJA_ITEMS,
            itemTypes: NINJA_ITEM_TYPES,
        },
        league,
        fetchedAt: new Date(client.now()).toISOString(),
        chaosPerDivine: Number(chaosPerDivine.toFixed(2)),
        prices: Object.fromEntries([...prices].sort(([a], [b]) => a.localeCompare(b))),
    };
}
