/**
 * The loader: read a data directory (`mods.json`, `base_items.json`,
 * `manifest.json`), run the adapter, and return normalized core data plus its
 * provenance manifest. A convenience builds a ready-to-use core `Registry`.
 *
 * This package IS allowed I/O (it is the data boundary, outside the pure core),
 * so it reads from disk with `node:fs`.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
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

function readJson<T>(path: string): T {
    return JSON.parse(readFileSync(path, "utf8")) as T;
}

/** Load a PoE1 (RePoE-shaped) data directory. */
export function loadPoe1(dir: string): LoadedData {
    const manifest = readJson<DataManifest>(`${dir}/manifest.json`);
    const rawMods = readJson<RepoeMods>(`${dir}/mods.json`);
    const rawBases = readJson<RepoeBases>(`${dir}/base_items.json`);

    const rawEssences = readJson<RepoeEssences>(`${dir}/essences.json`);
    const rawBench = readJson<RepoeBenches>(`${dir}/bench.json`);
    const rawFossils = readJson<RepoeFossils>(`${dir}/fossils.json`);
    const rawEldritch = readJson<RepoeEldritchRows>(`${dir}/eldritch.json`);

    const mods = Object.entries(rawMods)
        .map(([id, m]) => adaptMod(id, m))
        .filter((m): m is Mod => m !== null);
    const bases = Object.entries(rawBases).map(([key, b]) => adaptBase(key, b));
    const essences = Object.entries(rawEssences).map(([id, e]) => adaptEssence(id, e));
    const benchCrafts = rawBench.map(adaptBench);
    const fossils = Object.entries(rawFossils).map(([id, f]) => adaptFossil(id, f));
    const eldritch = Object.entries(rawEldritch).map(([id, e]) => adaptEldritch(id, e));

    return { mods, bases, essences, benchCrafts, fossils, eldritch, manifest };
}

/** Absolute path to the bundled PoE1 catalog committed in this package. */
export function defaultPoe1Dir(): string {
    return fileURLToPath(new URL("../data/poe1", import.meta.url));
}

/** Load the bundled PoE1 catalog. */
export function loadDefaultPoe1(): LoadedData {
    return loadPoe1(defaultPoe1Dir());
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
