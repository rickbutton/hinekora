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
    type Mod,
    type Registry,
} from "@hinekora/core";
import {
    adaptBase,
    adaptBench,
    adaptEldritch,
    adaptEssence,
    adaptFossil,
    adaptMod,
} from "./adapter.js";
import type { DataManifest } from "./manifest.js";
import type {
    RepoeBases,
    RepoeBenches,
    RepoeEldritchRows,
    RepoeEssences,
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
    readonly manifest: DataManifest;
}

/** The seven files of a PoE1 data directory, parsed but not yet adapted. */
export interface RawPoe1 {
    readonly manifest: DataManifest;
    readonly mods: RepoeMods;
    readonly bases: RepoeBases;
    readonly essences: RepoeEssences;
    readonly bench: RepoeBenches;
    readonly fossils: RepoeFossils;
    readonly eldritch: RepoeEldritchRows;
}

/** The names of the seven files, by `RawPoe1` field. */
export const POE1_FILES: Readonly<Record<keyof RawPoe1, string>> = {
    manifest: "manifest.json",
    mods: "mods.json",
    bases: "base_items.json",
    essences: "essences.json",
    bench: "bench.json",
    fossils: "fossils.json",
    eldritch: "eldritch.json",
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
    return { mods, bases, essences, benchCrafts, fossils, eldritch, manifest: raw.manifest };
}

/** Build a core `Registry` (with the standard currencies) from loaded data. */
export function registryOf(data: LoadedData): Registry {
    return buildRegistry({
        bases: data.bases,
        mods: data.mods,
        essences: data.essences,
        benchCrafts: data.benchCrafts,
        fossils: data.fossils,
        eldritch: data.eldritch,
    });
}
