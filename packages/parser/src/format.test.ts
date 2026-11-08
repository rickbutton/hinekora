import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { formatCraft, parse } from "./index.js";

/** The tree with every span removed, so two parses compare by meaning. */
const shape = (source: string): unknown => {
    const r = parse(source);
    if (!r.ok) throw new Error(r.error.message);
    return JSON.parse(
        JSON.stringify(r.craft, (key, value: unknown) =>
            key === "span" || key === "nameSpan" || key === "paramSpans" ? undefined : value,
        ),
    );
};

const fmt = (source: string): string => {
    const out = formatCraft(source);
    if (out === undefined) throw new Error("did not parse");
    return out;
};

describe("formatter — the example guides", () => {
    const dir = join(import.meta.dirname, "../../../examples");
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".craft"))) {
        it(`${file}: keeps its meaning and is stable`, () => {
            const src = readFileSync(join(dir, file), "utf8");
            const once = fmt(src);
            expect(shape(once)).toEqual(shape(src));
            expect(fmt(once)).toBe(once);
        });
    }
});

describe("formatter — layout", () => {
    it("aligns the item block's fields and keeps the affix lists on one line", () => {
        const src = `item{base:"Iron Ring" ilvl:84 rarity:rare
prefixes:["maximum life" t2] suffixes:["fire resistance" t3,fractured "lightning resistance" t3,"random"] influences: hunter shaper corrupted exarch: grand "wording"}
chaos`;
        expect(fmt(src)).toBe(`item {
    base:       "Iron Ring"
    ilvl:       84
    rarity:     rare
    prefixes:   [ "maximum life" t2 ]
    suffixes:   [ "fire resistance" t3, fractured "lightning resistance" t3, "random" ]
    influences: hunter shaper
    exarch:     grand "wording"
    corrupted
}
chaos
`);
    });

    it("indents bodies, keeps a one-line block inline, and keeps the blank-line grouping", () => {
        const src = `item { base: "Iron Ring" ilvl: 84 rarity: rare }
transmute
regal


until has "fire resistance" t1 {
chaos
if not has "maximum life" { restart }
}`;
        expect(fmt(src)).toBe(`item {
    base:   "Iron Ring"
    ilvl:   84
    rarity: rare
}
transmute
regal

until has "fire resistance" t1 {
    chaos
    if not has "maximum life" { restart }
}
`);
    });

    it("keeps comments where they were: before code at its depth, after code on its line", () => {
        const src = `# A guide.
item { base: "Iron Ring" ilvl: 84 # high enough
rarity: rare }

# Roll it.
until has "fire resistance" t1 { # the loop
    # try again
    chaos # one orb
}
# done`;
        expect(fmt(src)).toBe(`# A guide.
item {
    base:   "Iron Ring"
    ilvl:   84 # high enough
    rarity: rare
}

# Roll it.
until has "fire resistance" t1 { # the loop
    # try again
    chaos # one orb
}
# done
`);
    });

    it("prints parentheses only where the reader or the grammar needs them", () => {
        const src = `item { base: "Iron Ring" ilvl: 84 rarity: rare }
until ((has "a" and has "b") or has "c") and not (has "d" or has "e") { chaos }
until has "a" or has "b" or has "c" { chaos }
until has "a" and has "b" and has "c" or has "d" { chaos }
until has "a" or (has "b" or has "c") { chaos }`;
        const out = fmt(src);
        expect(out).toContain(
            'until ((has "a" and has "b") or has "c") and not (has "d" or has "e") { chaos }',
        );
        expect(out).toContain('until has "a" or has "b" or has "c" { chaos }');
        expect(out).toContain('until (has "a" and has "b" and has "c") or has "d" { chaos }');
        expect(out).toContain('until has "a" or (has "b" or has "c") { chaos }');
    });

    it("breaks a long predicate def one operand per line, the connective leading", () => {
        const src = `item { base: "Iron Ring" ilvl: 84 rarity: rare }
def anyEleRes(t) = has "fire resistance" t or has "cold resistance" t or has "lightning resistance" t or has "chaos resistance" t
until anyEleRes(t1) { chaos }`;
        expect(fmt(src)).toContain(`def anyEleRes(t) =
    has "fire resistance" t
    or has "cold resistance" t
    or has "lightning resistance" t
    or has "chaos resistance" t
`);
    });

    it("prints calls, block arguments as written, and an if with an else", () => {
        const src = `item { base: "Iron Ring" ilvl: 84 rarity: rare }
def roll(m, step) { until has m { step } }
roll("maximum life", chaos)
roll("maximum life", { scour alchemy })
if has "maximum life" {
    exalt
} else {
    roll("maximum life", chaos)
}`;
        expect(fmt(src)).toBe(`item {
    base:   "Iron Ring"
    ilvl:   84
    rarity: rare
}
def roll(m, step) { until has m { step } }
roll("maximum life", chaos)
roll("maximum life", { scour alchemy })
if has "maximum life" {
    exalt
} else {
    roll("maximum life", chaos)
}
`);
    });

    it("escapes quotes and backslashes in strings", () => {
        const src = `item { base: "Iron Ring" ilvl: 84 rarity: rare }\nbench "a \\"quoted\\" \\\\ name"`;
        expect(fmt(src)).toContain('bench "a \\"quoted\\" \\\\ name"');
    });

    it("returns nothing for a guide that does not parse", () => {
        expect(formatCraft("item {")).toBeUndefined();
    });
});
