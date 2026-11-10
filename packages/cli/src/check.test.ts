import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadDefaultEconomy, loadDefaultPoe1, registryOf } from "@hinekora/data";
import { chartSource, checkSource, costSource } from "./check.js";

// Built once against the real bundled catalog — the CLI's actual data path.
const registry = registryOf(loadDefaultPoe1());
const run = (src: string) => checkSource(src, "test.craft", registry);

describe("chartSource — the guide as Mermaid text", () => {
    it("prints a flowchart with a node per step", () => {
        const text = chartSource(
            `item { base: "Iron Ring" ilvl: 84 rarity: normal }\ntransmute\nregal`,
            registry,
        );
        expect(text).toMatch(/^flowchart TD\n/);
        expect(text).toContain("Orb of Transmutation");
        expect(text).toContain("Regal Orb");
        expect(text).toContain("--> finish");
    });

    it("has nothing for a guide that does not parse", () => {
        expect(chartSource("item {", registry)).toBeUndefined();
    });
});

describe("checkSource — end to end against real data", () => {
    it("passes a valid craft and reports the final item", () => {
        const r = run(`item { base: "Iron Ring" ilvl: 84 rarity: normal }
transmute
regal`);
        expect(r.ok).toBe(true);
        expect(r.output).toContain("checks");
        expect(r.output).toContain("  Item Class: Rings\n  Rarity: Rare\n  Iron Ring");
    });

    it("rejects a precondition failure with a located, carated error", () => {
        const r = run(`item { base: "Iron Ring" ilvl: 84 rarity: magic }
exalt`);
        expect(r.ok).toBe(false);
        expect(r.output).toContain("test.craft:2:1: error:");
        expect(r.output).toContain("Requires a Rare item");
        expect(r.output).toContain("^"); // source caret
        expect(r.output).toContain("✗ 1 error");
    });

    it("reports a parse error with location", () => {
        const r = run(`item { base: "Iron Ring" ilvl: 84 rarity: rare
exalt`);
        expect(r.ok).toBe(false);
        expect(r.output).toMatch(/test\.craft:\d+:\d+: error:/);
    });

    it("resolves fuzzy stat names (with a declared tier) in a real craft", () => {
        const r =
            run(`item { base: "Iron Ring" ilvl: 84 rarity: rare prefixes: [ "maximum life" t1 ] }
exalt`);
        expect(r.ok).toBe(true);
    });

    it("rejects a declared mod with no tier", () => {
        const r = run(`item { base: "Iron Ring" ilvl: 84 rarity: rare prefixes: [ "maximum life" ] }
exalt`);
        expect(r.ok).toBe(false);
        expect(r.output).toContain("declare the tier");
    });

    it("a corrupted essence reforges a Rare and guarantees its modifier", () => {
        const r = run(`item { base: "Iron Ring" ilvl: 84 rarity: rare }
essence "horror"
if not has "cold damage per frenzy charge" { exalt }`);
        expect(r.ok).toBe(false);
        expect(r.output).toContain("can never run");
    });

    it("a resonator's blocked tag keeps its modifiers out of the reforge", () => {
        const r = run(`item { base: "Iron Ring" ilvl: 84 rarity: rare }
fossil "pristine" "dense"
if has "maximum life" { exalt }`);
        expect(r.ok).toBe(false);
        expect(r.output).toContain("can never run");
    });

    it("checks the bundled example.craft clean (bench after a proven-suffix reforge)", () => {
        const src = readFileSync(
            fileURLToPath(new URL("../../../examples/example.craft", import.meta.url)),
            "utf8",
        );
        const r = run(src);
        expect(r.ok).toBe(true);
        // The final item in the game's layout, its unknown modifiers as one line.
        expect(r.output).toContain("  Item Class: Body Armours\n  Rarity: Rare\n  Vaal Regalia");
        expect(r.output).toContain("  --------\n  Item Level: 84\n  --------\n");
        expect(r.output).toMatch(/\{ \d-\d additional prefix or suffix modifiers \}/);
    });

    it("checks phys-dot-weapon.craft clean (fractured reforge keeps its count and clears crafted)", () => {
        const src = readFileSync(
            fileURLToPath(new URL("../../../examples/phys-dot-weapon.craft", import.meta.url)),
            "utf8",
        );
        const r = run(src);
        expect(r.ok).toBe(true);
        // The advanced tooltip's headers, the fractured flag on its line, and the mark.
        expect(r.output).toContain('{ Prefix Modifier "Magister\'s" (Tier: 1) — Caster, Gem }');
        expect(r.output).toContain("to Damage over Time Multiplier (fractured)");
        expect(r.output).toContain("  --------\n  Fractured Item");
    });
});

describe("costSource — what a guide is expected to spend", () => {
    const prices = loadDefaultEconomy();

    it("prices an essence loop by its rounds and the snapshot", () => {
        const src = readFileSync(
            fileURLToPath(new URL("../../../examples/essence-life-boots.craft", import.meta.url)),
            "utf8",
        );
        const r = costSource(src, "essence-life-boots.craft", registry, prices);
        expect(r.ok).toBe(true);
        expect(r.output).toMatch(/until anyEleRes\(t1\) \{\s+1\/\d+ chance/);
        expect(r.output).toMatch(/Deafening Essence of Greed/);
        expect(r.output).toMatch(/Expected spend: .* Deafening Essence of Greed\./);
        expect(r.output).toMatch(
            /~\d+(\.\d+)? Chaos Orbs \(~\d+(\.\d+)? Divine Orbs\) at \S+ prices of \d{4}-\d{2}-\d{2}\./,
        );
    });

    it("answers for a guide whose compared values are too many to follow one by one", () => {
        // Four values compared against thresholds: their rows and the pieces
        // the thresholds cut are more states than the walk follows, so it
        // reads the loop on the checker's item instead, and answers at once.
        const r = costSource(
            `item { base: "Amethyst Ring" ilvl: 84 rarity: rare }
until has "maximum life" >= 70 and has "fire resistance" >= 40 and has "cold resistance" >= 40 and has "lightning resistance" >= 40 {
    chaos
}`,
            "test.craft",
            registry,
            prices,
        );
        expect(r.ok).toBe(true);
        expect(r.output).toMatch(/1\/\d+ chance/);
    });

    it("gives a branch's chance but no figure for a restart", () => {
        const r = costSource(
            `item { base: "Iron Ring" ilvl: 84 rarity: rare }
until has "maximum life" {
    chaos
    if not has "maximum life" {
        restart
    }
}`,
            "test.craft",
            registry,
            prices,
        );
        expect(r.output).toMatch(/if not has "maximum life" \{\s+taken \d+(\.\d+)?%/);
        const restart = r.output.split("\n").find((l) => l.includes("restart"));
        expect(restart).toBeDefined();
        expect(restart).not.toMatch(/%/);
    });

    it("places a Harvest reforge's tagged modifier whatever the item may hold", () => {
        // The suffixes are kept, so the life lands among the prefixes the
        // reforge has not yet drawn: no reading of the item finds that side
        // full, and the branch has one figure, about one life row in eight.
        const r = costSource(
            `item {
    base: "Vermillion Ring"
    ilvl: 84
    rarity: rare
    prefixes: [ "maximum mana" t5 ]
    suffixes: [ "fire resistance" t1, "cold resistance" t1, "chaos resistance" t2 ]
}
bench "suffixes cannot be changed"
harvest reforge "life"
if has "maximum life" t1 {
    stop
}`,
            "test.craft",
            registry,
            prices,
        );
        const branch = r.output.split("\n").find((l) => l.includes("if has"));
        expect(branch).toMatch(/taken 1[23]%$/);
    });

    it("a loop at the head of a loop body reads what the round before left", () => {
        // The ring enters with one prefix, but a later round starts from the
        // reforge's item, which holds three prefixes now and then: the inner
        // loop annuls those to make room for the metamod.
        const r = costSource(
            `item {
    base: "Vermillion Ring"
    ilvl: 84
    rarity: rare
    prefixes: [ "maximum mana" t5 ]
    suffixes: [ "fire resistance" t1, "cold resistance" t1, "chaos resistance" t2 ]
}
until has "maximum life" t1 and prefixCount <= 2 {
    until prefixCount <= 2 {
        annul
    }
    bench "suffixes cannot be changed"
    harvest reforge "life"
}`,
            "test.craft",
            registry,
            prices,
        );
        const annul = r.output.split("\n").find((l) => /^\s*\d+\s+annul/.test(l));
        expect(annul).toBeDefined();
        expect(annul).not.toMatch(/×0[:\s]/);
    });

    it("notes a loop whose rounds are estimated past those followed, and gives it no spread", () => {
        // example.craft's second loop drifts between items of two and three
        // modifiers for thousands of rounds.
        const src = readFileSync(
            fileURLToPath(new URL("../../../examples/example.craft", import.meta.url)),
            "utf8",
        );
        const r = costSource(src, "example.craft", registry, prices);
        const lines = r.output.split("\n");
        const at = lines.findIndex((l) => l.includes("until hasTwoEleRes()"));
        expect(lines[at]).not.toMatch(/\[/);
        expect(lines[at + 1]).toMatch(/estimated/);
        expect(r.output).not.toMatch(/by what the item may hold/);
    });

    it("names what the snapshot cannot price and still sums the rest", () => {
        const r = costSource(
            `item { base: "Iron Ring" ilvl: 84 rarity: rare prefixes: [ "maximum life" t1 ] }\nlocus`,
            "test.craft",
            registry,
            prices,
        );
        expect(r.ok).toBe(true);
        expect(r.output).toContain("no price is known for this step");
        expect(r.output).toContain("Expected spend: nothing this report can count.");
    });

    it("costs a guide with errors as written, and says so", () => {
        const r = costSource(
            `item { base: "Iron Ring" ilvl: 84 rarity: magic }\nexalt`,
            "test.craft",
            registry,
        );
        expect(r.output).toMatch(/^test\.craft: 1 error; the costs take the steps as written\./);
        expect(r.output).toContain("Exalted Orb");
    });

    it("reports a parse error as the check does", () => {
        const r = costSource(`item { base: "Iron Ring"`, "test.craft", registry);
        expect(r.ok).toBe(false);
        expect(r.output).toMatch(/test\.craft:\d+:\d+: error:/);
    });
});
