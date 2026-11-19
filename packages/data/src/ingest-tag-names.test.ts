import { describe, expect, it } from "vitest";
import { TagId } from "@hinekora/core";
import { POE1_FILES, registryOf } from "./bundle.js";
import { loadDefaultPoe1 } from "./load.js";

interface Row {
    readonly id: string;
    readonly name: string;
}
interface Script {
    readonly readTags: (buf: Buffer) => Row[];
    readonly projectTagNames: (rows: readonly Row[]) => Record<string, string>;
}
// The ingest script is plain JavaScript outside the package's sources.
const url = new URL("../scripts/ingest-tag-names.mjs", import.meta.url).href;
const { readTags, projectTagNames } = (await import(/* @vite-ignore */ url)) as Script;

/** A compiled table of `Tags`' layout: Id at 0, a hash at 8, DisplayString at
 *  12, Name at 20, 28 bytes a row. */
function tagsTable(rows: readonly (readonly [string, string])[]): Buffer {
    const width = 28;
    const data: Buffer[] = [Buffer.alloc(8, 0xbb)];
    let at = 8;
    const place = (s: string): number => {
        const bytes = Buffer.from(`${s}\0`, "utf16le");
        data.push(bytes);
        at += bytes.length;
        return at - bytes.length;
    };
    const fixed = Buffer.alloc(4 + rows.length * width);
    fixed.writeUInt32LE(rows.length, 0);
    rows.forEach(([id, name], r) => {
        fixed.writeBigUInt64LE(BigInt(place(id)), 4 + r * width);
        fixed.writeBigUInt64LE(BigInt(place("")), 4 + r * width + 12);
        fixed.writeBigUInt64LE(BigInt(place(name)), 4 + r * width + 20);
    });
    return Buffer.concat([fixed, ...data]);
}

describe("the names the game shows for category tags", () => {
    it("are the Name column of the Tags table, read by row", () => {
        const table = tagsTable([
            ["life", "Life"],
            ["resource", ""],
            ["energy_shield", "Energy Shield"],
        ]);
        expect(readTags(table)).toEqual([
            { id: "life", name: "Life" },
            { id: "resource", name: "" },
            { id: "energy_shield", name: "Energy Shield" },
        ]);
    });

    it("leave out a tag with no name, sorted by id", () => {
        const names = projectTagNames([
            { id: "life", name: "Life" },
            { id: "resource", name: "" },
            { id: "energy_shield", name: "Energy Shield" },
        ]);
        expect(names).toEqual({ energy_shield: "Energy Shield", life: "Life" });
        expect(Object.keys(names)).toEqual(["energy_shield", "life"]);
    });

    it("refuse a tag listed twice", () => {
        expect(() =>
            projectTagNames([
                { id: "life", name: "Life" },
                { id: "life", name: "Vitality" },
            ]),
        ).toThrow(/life is listed twice/);
    });
});

describe("the committed tag names", () => {
    const data = loadDefaultPoe1();
    const registry = registryOf(data);

    it("match the manifest, from the game's table", () => {
        const entry = data.manifest.files[POE1_FILES.tagNames]!;
        expect(Object.keys(data.tagNames)).toHaveLength(entry.count);
        expect(entry.origin?.table).toBe("Tags");
    });

    it("name what a tooltip shows, and nothing for an internal tag", () => {
        expect(registry.tagName(TagId("life"))).toBe("Life");
        expect(registry.tagName(TagId("energy_shield"))).toBe("Energy Shield");
        expect(registry.tagName(TagId("resource"))).toBeUndefined();
        expect(registry.tagName(TagId("endurance_charge"))).toBeUndefined();
        expect(registry.tagName(TagId("toString"))).toBeUndefined();
    });
});
