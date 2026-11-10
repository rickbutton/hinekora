import { describe, expect, it } from "vitest";

interface Row {
    readonly id: string;
    readonly command: string;
    readonly parameters: string;
}
type Lists = Record<string, Record<string, string[]>>;
type Pair = { from: string; to: Record<string, [string | null, string]> };
interface Script {
    readonly readRows: (buf: Buffer) => Row[];
    readonly projectHarvestChange: (rows: readonly Row[]) => Lists;
    readonly pairHarvestChange: (
        lists: Lists,
        critical?: ReadonlySet<string>,
        seen?: Record<string, Record<string, string | null>>,
        unpaired?: Record<string, string[]>,
    ) => Record<string, Record<string, Pair[]>>;
    readonly renderHarvestChange: (pairs: Record<string, Record<string, Pair[]>>) => string;
}
// The ingest script is plain JavaScript outside the package's sources.
const url = new URL("../scripts/ingest-harvest-change.mjs", import.meta.url).href;
const { readRows, projectHarvestChange, pairHarvestChange, renderHarvestChange } = (await import(
    /* @vite-ignore */ url
)) as Script;

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

    const damage = (fire: string[], cold: string[], lightning: string[]): Lists => ({
        damage: lightning.length > 0 ? { fire, cold, lightning } : { fire, cold },
    });

    it("pairs each type by name, by ailment, or as seen in game, and refuses what is so decided", () => {
        const lists = damage(
            ["FireDamage", "FireDamageAndChanceToIgnite", "FireCrit", "FireDot", "FireOnly"],
            ["ColdDamage", "ColdDamageAndBaseChanceToFreeze", "ColdCrit", "ColdDot"],
            ["LightningDamage", "LightningDamageAndChanceToShock", "LightningCrit"],
        );
        const pairs = pairHarvestChange(
            lists,
            new Set(["FireCrit", "ColdCrit", "LightningCrit"]),
            { FireDot: { cold: "ColdDot", lightning: null } },
            { FireOnly: ["cold", "lightning"], ColdDot: ["lightning"] },
        );
        expect(pairs["damage"]!["fire"]).toEqual([
            {
                from: "FireDamage",
                to: { cold: ["ColdDamage", "name"], lightning: ["LightningDamage", "name"] },
            },
            {
                from: "FireDamageAndChanceToIgnite",
                to: {
                    cold: ["ColdDamageAndBaseChanceToFreeze", "ailment"],
                    lightning: ["LightningDamageAndChanceToShock", "ailment"],
                },
            },
            {
                from: "FireCrit",
                to: {
                    cold: [null, "refused since 3.28.0"],
                    lightning: [null, "refused since 3.28.0"],
                },
            },
            {
                from: "FireDot",
                to: { cold: ["ColdDot", "seen in game"], lightning: [null, "seen in game"] },
            },
            {
                from: "FireOnly",
                to: { cold: [null, "no counterpart"], lightning: [null, "no counterpart"] },
            },
        ]);
        expect(pairs["damage"]!["cold"]![3]).toEqual({
            from: "ColdDot",
            to: { fire: ["FireDot", "name"], lightning: [null, "no counterpart"] },
        });
        // One row a line, so a refresh shows as the rows that changed.
        expect(renderHarvestChange(pairs).split("\n")).toContain(
            '{"from":"FireDamage","to":{"cold":["ColdDamage","name"],"lightning":["LightningDamage","name"]}},',
        );
    });

    it("fails on a type left undecided for an element, and on two bases that disagree", () => {
        const lone = damage(["FireDamage", "FireNew"], ["ColdDamage"], []);
        expect(() => pairHarvestChange(lone, new Set(), {}, {})).toThrow(
            "no decision for FireNew to cold",
        );
        const both = damage(["FireDamage"], ["ColdDamage", "ColdOther"], []);
        expect(() =>
            pairHarvestChange(
                both,
                new Set(),
                { FireDamage: { cold: "ColdOther" } },
                {
                    FireDamage: ["lightning"],
                },
            ),
        ).toThrow(
            'the bases disagree for FireDamage to cold: ColdDamage by "name", ColdOther by "seen in game"',
        );
        // A type decided to have no counterpart that a refresh gives one.
        expect(() =>
            pairHarvestChange(
                damage(["FireDamage"], ["ColdDamage"], []),
                new Set(),
                {},
                {
                    FireDamage: ["cold", "lightning"],
                },
            ),
        ).toThrow("the bases disagree for FireDamage to cold");
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
