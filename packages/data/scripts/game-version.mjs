/**
 * The Path of Exile patch a repoe-fork export was built from. The export
 * states it in `version.txt`, which is read when an ingest runs: it is the
 * patch of the dump fetched in the same run. `REPOE_GAME_VERSION` overrides it
 * when a script is fed an older dump from a local file.
 */
const VERSION_URL = process.env.REPOE_VERSION_URL ?? "https://repoe-fork.github.io/version.txt";

/** What a manifest says of the version it records. */
export const GAME_VERSION_NOTE =
    "The repoe-fork export's version.txt when this was ingested, or REPOE_GAME_VERSION where an older dump was given; source.commit is the exporter's code, not the game data.";

/** A version as the export writes it: "3.29.3.5". */
export function parseGameVersion(text) {
    const trimmed = text.trim();
    return /^\d+(\.\d+)+$/.test(trimmed) ? trimmed : "unknown";
}

export async function resolveGameVersion() {
    if (process.env.REPOE_GAME_VERSION) return process.env.REPOE_GAME_VERSION;
    try {
        const res = await fetch(VERSION_URL);
        return res.ok ? parseGameVersion(await res.text()) : "unknown";
    } catch {
        return "unknown";
    }
}
