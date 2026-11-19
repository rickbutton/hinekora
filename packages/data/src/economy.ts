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

export function adaptEconomy(raw: RawEconomy): EconomySnapshot {
    return {
        league: raw.league,
        fetchedAt: raw.fetchedAt,
        chaosPerDivine: raw.chaosPerDivine,
        chaos: new Map(Object.entries(raw.prices)),
    };
}
