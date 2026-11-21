/**
 * The economy snapshot (`data/poe1/economy.json`): what poe.ninja listed each
 * currency, essence, fossil, resonator and beast at, in Chaos Orbs, for one
 * league on one day, read by `ninja.ts`. Adapted into an
 * `EconomySnapshot`, the shape a cost report prices with; the provenance stays
 * on the raw file.
 */

export interface RawEconomy {
    readonly source: {
        readonly name: string;
        readonly endpoint: string;
        readonly types: readonly string[];
        readonly itemEndpoint?: string;
        readonly itemTypes?: readonly string[];
    };
    readonly league: string;
    /** When the snapshot was taken, an ISO date-time. */
    readonly fetchedAt: string;
    readonly chaosPerDivine: number;
    /** Item name → price in Chaos Orbs. */
    readonly prices: Readonly<Record<string, number>>;
}

/** The snapshot as a consumer reads it: each item's price in Chaos Orbs. */
export interface EconomySnapshot {
    readonly league: string;
    /** When the snapshot was taken, an ISO date-time. */
    readonly fetchedAt: string;
    readonly chaosPerDivine: number;
    /** Item name → price in Chaos Orbs. */
    readonly chaos: ReadonlyMap<string, number>;
}

function isRecord(x: unknown): x is Record<string, unknown> {
    return typeof x === "object" && x !== null && !Array.isArray(x);
}

/** `data` as a snapshot, or undefined when it does not have the snapshot's shape. */
export function rawEconomyOf(data: unknown): RawEconomy | undefined {
    if (!isRecord(data)) return undefined;
    const { league, fetchedAt, chaosPerDivine, prices, source } = data;
    if (typeof league !== "string" || typeof fetchedAt !== "string") return undefined;
    if (Number.isNaN(Date.parse(fetchedAt))) return undefined;
    if (typeof chaosPerDivine !== "number" || !isRecord(prices) || !isRecord(source)) {
        return undefined;
    }
    if (!Object.values(prices).every((p) => typeof p === "number")) return undefined;
    return data as unknown as RawEconomy;
}

export function adaptEconomy(raw: RawEconomy): EconomySnapshot {
    return {
        league: raw.league,
        fetchedAt: raw.fetchedAt,
        chaosPerDivine: raw.chaosPerDivine,
        chaos: new Map(Object.entries(raw.prices)),
    };
}
