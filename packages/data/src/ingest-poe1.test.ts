import { describe, expect, it } from "vitest";

interface Manifest {
    readonly gameVersion: string;
    readonly extent: Readonly<Record<string, number>>;
    readonly files: Readonly<Record<string, { readonly sha256: string; readonly count: number }>>;
}
interface Script {
    readonly keepingOtherFiles: (manifest: Manifest, previous: Manifest | undefined) => Manifest;
}
// The ingest script is plain JavaScript outside the package's sources.
const url = new URL("../scripts/ingest-poe1.mjs", import.meta.url).href;
const { keepingOtherFiles } = (await import(/* @vite-ignore */ url)) as Script;

describe("the manifest the main ingest writes", () => {
    const written: Manifest = {
        gameVersion: "3.30.0",
        extent: { bases: 2, mods: 3 },
        files: { "mods.json": { sha256: "new", count: 3 } },
    };
    const previous: Manifest = {
        gameVersion: "3.29.0",
        extent: { bases: 1, mods: 1, eldritch: 7 },
        files: {
            "mods.json": { sha256: "old", count: 1 },
            "eldritch.json": { sha256: "e", count: 7 },
        },
    };

    it("keeps the files and extents the other ingest scripts recorded", () => {
        const merged = keepingOtherFiles(written, previous);
        expect(merged.files["eldritch.json"]).toEqual({ sha256: "e", count: 7 });
        expect(merged.extent).toMatchObject({ eldritch: 7 });
    });

    it("replaces what it writes itself", () => {
        const merged = keepingOtherFiles(written, previous);
        expect(merged.files["mods.json"]).toEqual({ sha256: "new", count: 3 });
        expect(merged.extent).toMatchObject({ bases: 2, mods: 3 });
        expect(merged.gameVersion).toBe("3.30.0");
    });

    it("is the written manifest where there was none before", () => {
        expect(keepingOtherFiles(written, undefined)).toEqual(written);
    });
});

describe("the game version an ingest records", () => {
    it("is the export's version.txt, or unknown where that is not a version", async () => {
        const helper = new URL("../scripts/game-version.mjs", import.meta.url).href;
        const { parseGameVersion } = (await import(/* @vite-ignore */ helper)) as {
            readonly parseGameVersion: (text: string) => string;
        };
        expect(parseGameVersion("3.29.3.5\n")).toBe("3.29.3.5");
        expect(parseGameVersion("Internal Server Error")).toBe("unknown");
    });

    it("is what the committed manifest's note says of it", async () => {
        const helper = new URL("../scripts/game-version.mjs", import.meta.url).href;
        const { GAME_VERSION_NOTE } = (await import(/* @vite-ignore */ helper)) as {
            readonly GAME_VERSION_NOTE: string;
        };
        const { loadDefaultPoe1 } = await import("./load.js");
        expect(loadDefaultPoe1().manifest.gameVersionNote).toBe(GAME_VERSION_NOTE);
    });
});
