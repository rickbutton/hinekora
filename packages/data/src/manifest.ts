/**
 * The data manifest — provenance for an ingested data set.
 *
 * This is the critical artifact for reproducibility: it records exactly
 * WHICH RePoE dump the catalog came from (commit + publish date) and WHICH game
 * version it targets, so a checked craft can always be traced to a concrete data
 * snapshot. (`gameVersion` is the patch the export's `version.txt` states,
 * "unknown" where it could not be read; the commit + `publishedAt` are the
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
    /** Set when the file was taken from a later dump than the manifest's source. */
    readonly provenance?: {
        readonly commit: string;
        readonly commitDate: string;
        readonly publishedAt: string;
        /** The patch that dump was exported from. */
        readonly gameVersion?: string;
    };
    /** Set when the file does not come from the RePoE dump: the game table it
     *  was read from, where, and at which patch. */
    readonly origin?: {
        readonly table: string;
        readonly url: string;
        readonly gameVersion: string;
    };
}

export interface ManifestExtent {
    readonly description: string;
    readonly bases: number;
    readonly mods: number;
    readonly essences?: number;
    readonly benchCrafts?: number;
    readonly fossils?: number;
    readonly eldritch?: number;
}

export interface DataManifest {
    readonly game: "poe1";
    readonly source: ManifestSource;
    /** The Path of Exile patch this data targets, or "unknown" if not recorded. */
    readonly gameVersion: string;
    readonly gameVersionNote?: string;
    readonly retrievedAt: string;
    /** What the data set covers (full catalog vs a partial slice) + counts. */
    readonly extent: ManifestExtent;
    readonly files: Readonly<Record<string, ManifestFile>>;
}
