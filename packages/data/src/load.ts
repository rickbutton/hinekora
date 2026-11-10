/**
 * The loader: read a data directory (`mods.json`, `base_items.json`,
 * `manifest.json`, …) and run the adapter over it (`bundle.ts`). This package
 * IS allowed I/O (it is the data boundary, outside the pure core), so it reads
 * from disk with `node:fs`; a browser uses `./browser` and fetches the files.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { adaptPoe1, type LoadedData, POE1_FILES, type RawPoe1 } from "./bundle.js";
import { adaptEconomy, type EconomySnapshot, type RawEconomy } from "./economy.js";
import type { DataManifest } from "./manifest.js";
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

function readJson<T>(path: string): T {
    return JSON.parse(readFileSync(path, "utf8")) as T;
}

/** Load a PoE1 (RePoE-shaped) data directory. */
export function loadPoe1(dir: string): LoadedData {
    const raw: RawPoe1 = {
        manifest: readJson<DataManifest>(`${dir}/${POE1_FILES.manifest}`),
        mods: readJson<RepoeMods>(`${dir}/${POE1_FILES.mods}`),
        bases: readJson<RepoeBases>(`${dir}/${POE1_FILES.bases}`),
        essences: readJson<RepoeEssences>(`${dir}/${POE1_FILES.essences}`),
        bench: readJson<RepoeBenches>(`${dir}/${POE1_FILES.bench}`),
        fossils: readJson<RepoeFossils>(`${dir}/${POE1_FILES.fossils}`),
        eldritch: readJson<RepoeEldritchRows>(`${dir}/${POE1_FILES.eldritch}`),
        harvestChange: readJson<RawHarvestChange>(`${dir}/${POE1_FILES.harvestChange}`),
        clusterEnchants: readJson<RawClusterEnchants>(`${dir}/${POE1_FILES.clusterEnchants}`),
    };
    return adaptPoe1(raw);
}

/** Absolute path to the bundled PoE1 catalog committed in this package. */
export function defaultPoe1Dir(): string {
    return fileURLToPath(new URL("../data/poe1", import.meta.url));
}

/** Load the bundled PoE1 catalog. */
export function loadDefaultPoe1(): LoadedData {
    return loadPoe1(defaultPoe1Dir());
}

/** The file the economy snapshot is kept in, beside the catalog. */
export const ECONOMY_FILE = "economy.json";

/** Load the economy snapshot of a PoE1 data directory. */
export function loadEconomy(dir: string): EconomySnapshot {
    return adaptEconomy(readJson<RawEconomy>(`${dir}/${ECONOMY_FILE}`));
}

/** Load the bundled economy snapshot. */
export function loadDefaultEconomy(): EconomySnapshot {
    return loadEconomy(defaultPoe1Dir());
}
