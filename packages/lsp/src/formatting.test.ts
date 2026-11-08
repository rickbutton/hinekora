import { describe, expect, it } from "vitest";
import { getFormattingEdits } from "./formatting.js";

describe("document formatting", () => {
    it("replaces the whole guide with its formatted text", () => {
        const src = `item { base: "Iron Ring" ilvl: 84 rarity: rare }\nuntil has "x" {\nchaos\n}`;
        const edits = getFormattingEdits(src);
        expect(edits).toHaveLength(1);
        expect(edits[0]!.range).toEqual({
            start: { line: 0, character: 0 },
            end: { line: 3, character: 1 },
        });
        expect(edits[0]!.newText).toContain("    chaos\n}");
    });

    it("makes no edit for a formatted guide or one that does not parse", () => {
        const formatted = `item {\n    base:   "Iron Ring"\n    ilvl:   84\n    rarity: rare\n}\nchaos\n`;
        expect(getFormattingEdits(formatted)).toEqual([]);
        expect(getFormattingEdits("item {")).toEqual([]);
    });
});
