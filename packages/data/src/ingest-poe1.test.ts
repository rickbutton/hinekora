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

describe("the exporter commit an ingest records", () => {
    it("is what the committed manifest's note says of it", async () => {
        const { COMMIT_NOTE } = (await import(/* @vite-ignore */ url)) as {
            readonly COMMIT_NOTE: string;
        };
        const { loadDefaultPoe1 } = await import("./load.js");
        expect(loadDefaultPoe1().manifest.source.commitNote).toBe(COMMIT_NOTE);
    });
});

interface Projected {
    readonly projectBases: (
        raw: Readonly<Record<string, object>>,
        mods: Readonly<Record<string, object>>,
    ) => Readonly<Record<string, { readonly implicits?: readonly string[] }>>;
    readonly projectImplicits: (
        bases: Readonly<Record<string, { readonly implicits?: readonly string[] }>>,
        mods: Readonly<Record<string, object>>,
        gems: Readonly<Record<string, object>>,
    ) => Readonly<
        Record<
            string,
            {
                readonly type: string;
                readonly groups: readonly string[];
                readonly tags: readonly string[];
                readonly text: string;
                readonly locked?: true;
            }
        >
    >;
}
const { projectBases, projectImplicits } = (await import(/* @vite-ignore */ url)) as Projected;

describe("the implicits the main ingest keeps", () => {
    const ring = (implicits?: readonly string[]) => ({
        name: "Ring",
        item_class: "Ring",
        domain: "item",
        tags: ["ring", "default"],
        release_state: "released",
        ...(implicits && { implicits }),
    });
    const mods = {
        Life: {
            type: "MaximumLifeIncreasePercent",
            groups: ["MaximumLifeIncreasePercent"],
            implicit_tags: ["resource", "life"],
            stats: [{ id: "maximum_life_+%", min: 5, max: 7 }],
            text: "(5-7)% increased maximum Life",
        },
        Dash: {
            type: "FlameDash",
            groups: ["FlameDash"],
            implicit_tags: [],
            stats: [],
            text: "Trigger Level 10 [FlameDash::10|Flame Dash] when you use a Socketed Skill",
        },
        Locked: {
            type: "HasEveryInfluenceType",
            groups: ["HasEveryInfluenceType"],
            implicit_tags: [],
            stats: [
                { id: "local_item_can_roll_all_influences", min: 1, max: 1 },
                { id: "local_implicit_mod_cannot_be_changed", min: 1, max: 1 },
            ],
            text: "Has Elder, Shaper and all Conqueror Influences\nImplicit Modifiers Cannot Be Changed",
        },
    };
    const bases = projectBases(
        {
            Vermillion: ring(["Life"]),
            Plain: ring(),
            Dashing: ring(["Dash"]),
            Astrolabe: ring(["Locked"]),
        },
        mods,
    );
    const implicits = projectImplicits(bases, mods, {});

    it("keeps a base's implicit ids, and none where it has none", () => {
        expect(bases["Vermillion"]?.implicits).toEqual(["Life"]);
        expect(bases["Plain"]).not.toHaveProperty("implicits");
    });

    it("writes each named row with its type, groups, tags and text", () => {
        expect(implicits["Life"]).toEqual({
            type: "MaximumLifeIncreasePercent",
            groups: ["MaximumLifeIncreasePercent"],
            tags: ["resource", "life"],
            text: "(5-7)% increased maximum Life",
        });
        expect(Object.keys(implicits).sort()).toEqual(["Dash", "Life", "Locked"]);
    });

    it("strips the tooltip markup from a row's text", () => {
        expect(implicits["Dash"]?.text).toBe(
            "Trigger Level 10 Flame Dash when you use a Socketed Skill",
        );
    });

    it("marks the row that cannot be changed, and no other", () => {
        expect(implicits["Locked"]?.locked).toBe(true);
        expect(implicits["Life"]).not.toHaveProperty("locked");
    });

    it("drops Affliction's tinctures, which have no mana burn, and keeps the ones beside them", () => {
        const tincture = (properties: object) => ({
            ...ring(),
            name: "Rosethorn Tincture",
            item_class: "Tincture",
            properties,
        });
        const kept = projectBases(
            {
                Old: tincture({ mana_burn_ms: null, cooldown_ms: null }),
                New: tincture({ mana_burn_ms: 700, cooldown_ms: 8000 }),
            },
            mods,
        );
        expect(Object.keys(kept)).toEqual(["New"]);
    });

    it("writes a row two bases name once, and none for a row the export lacks", () => {
        const twice = projectImplicits(
            { A: { implicits: ["Life"] }, B: { implicits: ["Life", "Missing"] } },
            mods,
            {},
        );
        expect(Object.keys(twice)).toEqual(["Life"]);
        expect(twice["Life"]).toEqual(implicits["Life"]);
    });
});
