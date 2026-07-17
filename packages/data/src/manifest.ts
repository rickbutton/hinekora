/**
 * The data manifest — provenance for an ingested data set.
 *
 * This is the load-bearing artifact for reproducibility: it records exactly
 * WHICH RePoE dump the catalog came from (commit + publish date) and WHICH game
 * version it targets, so a checked craft can always be traced to a concrete data
 * snapshot. (repoe-fork does not stamp the PoE patch anywhere, so `gameVersion`
 * is recorded manually and may be "unknown"; the commit + `publishedAt` are the
 * hard identity.)
 */

export interface ManifestSource {
    readonly name: string;
    readonly url: string;
    readonly repoUrl: string;
    /** The repoe-fork commit that produced this dump — the precise dump identity. */
    readonly commit: string;
    readonly commitDate: string;
    /** When the dump was published (the exports' Last-Modified). */
    readonly publishedAt: string;
}

export interface ManifestFile {
    readonly sha256: string;
    readonly count: number;
}

export interface ManifestExtent {
    readonly description: string;
    readonly bases: number;
    readonly mods: number;
    readonly essences?: number;
    readonly benchCrafts?: number;
}

export interface DataManifest {
    readonly game: "poe1" | "poe2";
    readonly source: ManifestSource;
    /** The Path of Exile patch this data targets, or "unknown" if not recorded. */
    readonly gameVersion: string;
    readonly gameVersionNote?: string;
    readonly retrievedAt: string;
    /** What the data set covers (full catalog vs a partial slice) + counts. */
    readonly extent: ManifestExtent;
    readonly files: Readonly<Record<string, ManifestFile>>;
}
