/**
 * The shape of the RePoE (repoe-fork) JSON exports we consume.
 *
 * These mirror the real `mods.json` / `base_items.json` entries (each file is a
 * JSON object keyed by id). Only the fields the core model needs are typed;
 * RePoE carries much more (stat rolls, granted effects, gold values, …) which we
 * intentionally ignore. Grounded in the dat-schema fields the item model cites:
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
    /** The tags that drive tag-directed crafting (fossils, harvest): a mod's
     * category membership (fire, caster, life, defences, …). Optional because
     * older projections omitted it. */
    readonly implicit_tags?: readonly string[];
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
    /** Projected at ingest from the base's affix-count implicit stats
     * (`local_maximum_{prefixes,suffixes}_allowed_+`); absent ⇒ no delta. */
    readonly capDelta?: { readonly prefix: number; readonly suffix: number };
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

/** `fossils.json` entry (projected): a fossil's effects on which modifiers a
 *  resonator can roll. */
export interface RepoeFossil {
    readonly name: string;
    /** Category tags whose modifiers cannot roll ("No X modifiers"). */
    readonly blocked_tags: readonly string[];
    /** Fossil-only rows that join the pool. */
    readonly added_mods: readonly string[];
    /** Rows one of which is guaranteed. */
    readonly forced_mods: readonly string[];
    /** Base tags one of which the item must carry, when the fossil limits its targets. */
    readonly allowed_tags?: readonly string[];
    /** Percent chance that one rolled modifier is a corrupted essence's. */
    readonly corrupted_essence_chance: number;
    /** Fractures one of the modifiers it rolls. */
    readonly fractures: boolean;
    /** Corrupts the item. */
    readonly corrupts: boolean;
}
export type RepoeFossils = Readonly<Record<string, RepoeFossil>>;

/** `eldritch.json` entry (projected): one eldritch implicit row. */
export interface RepoeEldritch {
    readonly side: "exarch" | "eater";
    /** 1 (Lesser) to 6 (Perfect). */
    readonly tier: number;
    readonly type: string;
    /** The class tags the row rolls on (`gloves`, `body_armour`, …). */
    readonly classes: readonly string[];
    readonly implicit_tags: readonly string[];
    readonly text: string;
}
export type RepoeEldritchRows = Readonly<Record<string, RepoeEldritch>>;

/** `bench.json` entry (projected): a mod-adding crafting-bench option. */
export interface RepoeBench {
    readonly mod: string;
    readonly tier: number;
    readonly item_classes: readonly string[];
    readonly master: string;
}
export type RepoeBenches = readonly RepoeBench[];
