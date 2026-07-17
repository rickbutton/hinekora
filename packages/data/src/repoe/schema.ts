/**
 * The shape of the RePoE (repoe-fork) JSON exports we consume.
 *
 * These mirror the real `mods.json` / `base_items.json` entries (each file is a
 * JSON object keyed by id). Only the fields the core model needs are typed;
 * RePoE carries much more (stat rolls, granted effects, gold values, …) which we
 * intentionally ignore. Grounded in the dat-schema fields the typing rules cite:
 * `type` is `Mods.ModType`, `groups` is `Mods.Families`, `spawn_weights` is
 * `SpawnWeight_TagsKeys ‖ _Values`, etc.
 */

export interface RepoeSpawnWeight {
    readonly tag: string;
    readonly weight: number;
}

export interface RepoeMod {
    readonly domain: string;
    /** "prefix" | "suffix" | "unique" | "corrupted" | … — only affix kinds are modelled. */
    readonly generation_type: string;
    readonly groups: readonly string[];
    readonly required_level: number;
    /** Ordered; first entry whose tag the base has wins (see core `lookupWeight`). */
    readonly spawn_weights: readonly RepoeSpawnWeight[];
    readonly adds_tags: readonly string[];
    readonly type: string;
    // The following are present in raw RePoE exports but dropped by the ingest
    // projection (the core model doesn't use them), so they are optional here.
    /** The affix name, e.g. "Healthy". */
    readonly name?: string;
    /** Human-readable stat text, e.g. "+(10-24) to maximum Life". */
    readonly text?: string;
    readonly is_essence_only?: boolean;
}

/** `mods.json`: id → mod. */
export type RepoeMods = Readonly<Record<string, RepoeMod>>;

export interface RepoeBase {
    readonly name: string;
    readonly item_class: string;
    readonly domain: string;
    readonly tags: readonly string[];
    readonly release_state?: string;
}

/** `base_items.json`: metadata-path key → base. */
export type RepoeBases = Readonly<Record<string, RepoeBase>>;

/** `essences.json` entry (projected): an essence and its per-class guaranteed mods. */
export interface RepoeEssence {
    readonly name: string;
    readonly tier: number;
    /** Cap on random fill-mod level; absent = no cap. See `EssenceSpec`. */
    readonly maxRandomModLevel?: number;
    /** Item class name → guaranteed mod id. */
    readonly grants: Readonly<Record<string, string>>;
}
export type RepoeEssences = Readonly<Record<string, RepoeEssence>>;

/** `bench.json` entry (projected): a mod-adding crafting-bench option. */
export interface RepoeBench {
    readonly mod: string;
    readonly tier: number;
    readonly item_classes: readonly string[];
    readonly master: string;
}
export type RepoeBenches = readonly RepoeBench[];
