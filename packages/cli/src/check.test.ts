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
        // The advanced copy's headers, the fractured one flagged in its header, and the mark.
        expect(r.output).toContain('{ Prefix Modifier "Magister\'s" (Tier: 1) — Caster, Gem }');
        expect(r.output).toMatch(/\{ Fractured [^\n]*\}\n *[^\n]*to Damage over Time Multiplier\n/);
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

    it("gives a loop that drifts for thousands of rounds its figure, with no spread", () => {
        // example.craft's second loop drifts between items of two and three
        // modifiers for longer than its rounds are followed one by one.
        const src = readFileSync(
            fileURLToPath(new URL("../../../examples/example.craft", import.meta.url)),
            "utf8",
        );
        const r = costSource(src, "example.craft", registry, prices);
        const lines = r.output.split("\n");
        const at = lines.findIndex((l) => l.includes("until hasTwoEleRes()"));
        expect(lines[at]).toMatch(/1\/\d{4} chance$/);
        expect(lines[at + 1]).toMatch(/^\s*\d+\s+annul/);
        expect(r.output).not.toMatch(/by what the item may hold/);
    });

    it("asks the exit of a restart's item in a loop read round by round alike", () => {
        // The Tangled Fossil's roll is not followed, so the rounds are read as
        // independent; a restart is still at the loop's head with the item as
        // it is, so the loop ends on the life whether the fire came with it or
        // not, as it does without the branch.
        const rounds = (branch: string): string | undefined =>
            costSource(
                `item { base: "Vaal Regalia" ilvl: 86 rarity: rare }
until has "maximum life" {
    fossil "tangled"
    chaos${branch}
}`,
                "test.craft",
                registry,
                prices,
            ).output.match(/chaos\s+×(\d+(\.\d+)?)/)?.[1];
        const plain = rounds("");
        expect(plain).toBeDefined();
        // The loop's note gives the fossil as the cause, and no other.
        const loop = costSource(
            `item { base: "Vaal Regalia" ilvl: 86 rarity: rare }
until has "maximum life" {
    fossil "tangled"
}`,
            "test.craft",
            registry,
            prices,
        ).output.split("\n")[1];
        expect(loop).toMatch(/\(a Tangled Fossil makes .* every round of this loop is read alike/);
        expect(loop).not.toContain("more ways than could be followed");
        expect(
            rounds(`
    if has "fire resistance" {
        restart
    }`),
        ).toBe(plain);
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

    it("ends the craft where a Vaal Orb turns a jewel into a unique one", () => {
        const vaal = (base: string) =>
            costSource(
                `item { base: "${base}" ilvl: 84 rarity: rare }\nvaal`,
                "test.craft",
                registry,
                prices,
            ).output;
        const cobalt = vaal("Cobalt Jewel");
        expect(cobalt).toContain("25% of the time a Vaal Orb turns this jewel into a unique jewel");
        expect(cobalt).toContain("The craft ends short of a finished item 25% of the time.");
        // Only the three basic jewels have a unique to become (Vaal Orb § Jewels).
        expect(vaal("Ghastly Eye Jewel")).not.toContain("The craft ends");
    });

    it("names the currency the snapshot has no price for, on its step and under the total", () => {
        const chaos = new Map(prices.chaos);
        chaos.delete("Regal Orb");
        const r = costSource(
            `item { base: "Iron Ring" ilvl: 84 rarity: normal }\ntransmute\nregal`,
            "test.craft",
            registry,
            { ...prices, chaos },
        );
        expect(r.output).toMatch(/regal\s+×1: 1 Regal Orb {2}\(no price for Regal Orb\)/);
        expect(r.output).toContain("Expected spend: 1 Orb of Transmutation, 1 Regal Orb.");
        expect(r.output).toContain(
            `No total in Chaos Orbs: ${prices.league} prices of ${prices.fetchedAt.slice(0, 10)} lack Regal Orb.`,
        );
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

    it("gives no figure for a loop that can never exit, nor a total", () => {
        // A fossil pair that blocks the life it is rolled for.
        const r = costSource(
            `item { base: "Stygian Vise" ilvl: 84 rarity: normal }\nuntil has "maximum life" t1 {\n    fossil "pristine" "dense"\n}`,
            "test.craft",
            registry,
            prices,
        );
        expect(r.output).toContain("rounds not known");
        expect(r.output).toContain("the check finds this loop can never reach its exit");
        expect(r.output).toContain("uses not known");
        expect(r.output).not.toContain("a parameter stands");
        expect(r.output).toContain("Expected spend: not known, for a loop above has no figure.");
        expect(r.output).not.toContain("Chaos Orbs (");
    });

    it("reports a parse error as the check does", () => {
        const r = costSource(`item { base: "Iron Ring"`, "test.craft", registry);
        expect(r.ok).toBe(false);
        expect(r.output).toMatch(/test\.craft:\d+:\d+: error:/);
    });
});
