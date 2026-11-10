/**
 * The pure half of loading: the shape of a PoE1 data directory once its files
 * are parsed, the adapter run over it, and the registry built from the result.
 * No I/O, so a browser can feed it fetched JSON; `load.ts` adds the disk.
 */
import {
    type Base,
    type BenchCraft,
    buildRegistry,
    type EldritchImplicitSpec,
    type EssenceSpec,
    type FossilSpec,
    type HarvestChangeLists,
    type Mod,
    type Registry,
} from "@hinekora/core";
import {
    adaptBase,
    adaptBench,
    adaptEldritch,
    adaptEssence,
    adaptFossil,
    adaptHarvestChange,
    adaptMod,
} from "./adapter.js";
import type { DataManifest } from "./manifest.js";
import { COMMUNITY_ALIASES } from "./aliases.js";
import type {
    RawClusterEnchants,
    RepoeBases,
    RepoeBenches,
    RepoeEldritchRows,
    RepoeEssences,
    RawHarvestChange,
    RepoeFossils,
    RepoeMods,
} from "./repoe/schema.js";

export interface LoadedData {
    readonly mods: readonly Mod[];
    readonly bases: readonly Base[];
    readonly essences: readonly EssenceSpec[];
    readonly benchCrafts: readonly BenchCraft[];
    readonly fossils: readonly FossilSpec[];
    readonly eldritch: readonly EldritchImplicitSpec[];
    readonly harvestChange: HarvestChangeLists;
    readonly clusterEnchants: RawClusterEnchants;
    readonly manifest: DataManifest;
}

/** The nine files of a PoE1 data directory, parsed but not yet adapted. */
export interface RawPoe1 {
    readonly manifest: DataManifest;
    readonly mods: RepoeMods;
    readonly bases: RepoeBases;
    readonly essences: RepoeEssences;
    readonly bench: RepoeBenches;
    readonly fossils: RepoeFossils;
    readonly eldritch: RepoeEldritchRows;
    readonly harvestChange: RawHarvestChange;
    readonly clusterEnchants: RawClusterEnchants;
}

/** The names of the nine files, by `RawPoe1` field. */
export const POE1_FILES: Readonly<Record<keyof RawPoe1, string>> = {
    manifest: "manifest.json",
    mods: "mods.json",
    bases: "base_items.json",
    essences: "essences.json",
    bench: "bench.json",
    fossils: "fossils.json",
    eldritch: "eldritch.json",
    harvestChange: "harvest_change.json",
    clusterEnchants: "cluster_enchants.json",
};

/** Normalize raw PoE1 (RePoE-shaped) data. */
export function adaptPoe1(raw: RawPoe1): LoadedData {
    const mods = Object.entries(raw.mods)
        .map(([id, m]) => adaptMod(id, m))
        .filter((m): m is Mod => m !== null);
    const bases = Object.entries(raw.bases).map(([key, b]) => adaptBase(key, b));
    const essences = Object.entries(raw.essences).map(([id, e]) => adaptEssence(id, e));
    const benchCrafts = raw.bench.map(adaptBench);
    const fossils = Object.entries(raw.fossils).map(([id, f]) => adaptFossil(id, f));
    const eldritch = Object.entries(raw.eldritch).map(([id, e]) => adaptEldritch(id, e));
    const harvestChange = adaptHarvestChange(raw.harvestChange);
    return {
        mods,
        bases,
        essences,
        benchCrafts,
        fossils,
        eldritch,
        harvestChange,
        clusterEnchants: raw.clusterEnchants,
        manifest: raw.manifest,
    };
}

/** Build a core `Registry` (with the standard currencies and the community
 *  wordings) from loaded data. */
export function registryOf(data: LoadedData): Registry {
    return buildRegistry({
        bases: data.bases,
        mods: data.mods,
        wordingAliases: COMMUNITY_ALIASES,
        essences: data.essences,
        benchCrafts: data.benchCrafts,
        fossils: data.fossils,
        eldritch: data.eldritch,
        harvestChange: data.harvestChange,
        clusterEnchants: data.clusterEnchants,
    });
}
