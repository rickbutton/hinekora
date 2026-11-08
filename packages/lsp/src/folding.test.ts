import { describe, expect, it } from "vitest";
import { getFoldingRanges } from "./folding.js";

describe("folding ranges", () => {
    it("folds the item block, bodies, block arguments, comment runs and multi-line defs", () => {
        const src = [
            "# A guide.", // 0
            "# Two lines of comment.", // 1
            "item {", // 2
            '    base: "Iron Ring"', // 3
            "    ilvl: 84 # a trailing comment, not part of a run", // 4
            "    rarity: rare", // 5
            "}", // 6
            "def anyEleRes(t) =", // 7
            '    has "fire resistance" t', // 8
            '    or has "cold resistance" t', // 9
            "def once(b) { b }", // 10
            "until anyEleRes(t1) {", // 11
            "    once({", // 12
            "        scour", // 13
            "        alchemy", // 14
            "    })", // 15
            "}", // 16
        ].join("\n");
        const ranges = getFoldingRanges(src).map((r) => [r.startLine, r.endLine, r.kind]);
        // A brace fold ends on the line before `}`, so the closing brace stays visible.
        expect(ranges).toEqual([
            [0, 1, "comment"],
            [2, 5, undefined],
            [7, 9, undefined],
            [11, 15, undefined],
            [12, 14, undefined],
        ]);
    });

    it("does not count a comment after code as the start of a comment run", () => {
        const src = "chaos # one\n# two\n# three\nexalt";
        expect(getFoldingRanges(src)).toEqual([{ startLine: 1, endLine: 2, kind: "comment" }]);
    });

    it("still folds closed braces while the guide does not parse", () => {
        const src = 'item {\n    base: "Iron Ring"\n}\nuntil {\n    chaos\n';
        expect(getFoldingRanges(src)).toEqual([{ startLine: 0, endLine: 1 }]);
    });

    it("returns nothing on unlexable input", () => {
        expect(getFoldingRanges('item { base: "unterminated')).toEqual([]);
    });
});
