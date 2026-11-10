import { describe, expect, it } from "vitest";

interface Row {
    readonly id: string;
    readonly command: string;
    readonly parameters: string;
}
interface Script {
    readonly readRows: (buf: Buffer) => Row[];
    readonly projectHarvestChange: (
        rows: readonly Row[],
    ) => Record<string, Record<string, string[]>>;
}
// The ingest script is plain JavaScript outside the package's sources.
const url = new URL("../scripts/ingest-harvest-change.mjs", import.meta.url).href;
const { readRows, projectHarvestChange } = (await import(/* @vite-ignore */ url)) as Script;

const row = (id: string, command: string, parameters: string): Row => ({ id, command, parameters });

describe("the Harvest change lists read from the game's table", () => {
    it("are the types before CONVERT, by kind and the element changed from", () => {
        const lists = projectHarvestChange([
            row(
                "ChangeFireToColdResist",
                "convert_mod",
                "FireResistance MaximumFireResist CONVERT fire cold",
            ),
            row(
                "ChangeFireToLightningResist",
                "convert_mod",
                "FireResistance MaximumFireResist CONVERT fire lightning",
            ),
            row("ChangeColdToFireDamage", "convert_mod", "ColdDamage CONVERT cold fire"),
            row("ReforgeFire", "reforge", "fire"),
        ]);
        expect(lists).toEqual({
            resistance: { fire: ["FireResistance", "MaximumFireResist"] },
            damage: { cold: ["ColdDamage"] },
        });
    });

    it("refuse a row they cannot read, and a list that differs between targets", () => {
        expect(() =>
            projectHarvestChange([row("ChangeFireToColdSpeed", "convert_mod", "x")]),
        ).toThrow("unread convert_mod row");
        expect(() =>
            projectHarvestChange([
                row("ChangeFireToColdResist", "convert_mod", "FireResistance CONVERT fire cold"),
                row(
                    "ChangeFireToLightningResist",
                    "convert_mod",
                    "MaximumFireResist CONVERT fire lightning",
                ),
            ]),
        ).toThrow("differs between targets");
    });

    it("reads the rows of a compiled table: fixed-width rows, then the strings", () => {
        const width = 48;
        const strings = [
            "ChangeFireToColdResist",
            "convert_mod",
            "FireResistance CONVERT fire cold",
        ];
        const data: Buffer[] = [Buffer.alloc(8, 0xbb)];
        const offsets: number[] = [];
        let at = 8;
        for (const s of strings) {
            const bytes = Buffer.from(`${s}\0`, "utf16le");
            offsets.push(at);
            data.push(bytes);
            at += bytes.length;
        }
        const fixed = Buffer.alloc(4 + width);
        fixed.writeUInt32LE(1, 0);
        fixed.writeBigUInt64LE(BigInt(offsets[0]!), 4);
        fixed.writeBigUInt64LE(BigInt(offsets[1]!), 4 + 32);
        fixed.writeBigUInt64LE(BigInt(offsets[2]!), 4 + 40);
        expect(readRows(Buffer.concat([fixed, ...data]))).toEqual([
            row("ChangeFireToColdResist", "convert_mod", "FireResistance CONVERT fire cold"),
        ]);
    });
});
