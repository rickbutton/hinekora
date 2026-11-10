import { describe, expect, it } from "vitest";
import { priceText } from "@hinekora/core";
import { loadDefaultEconomy, loadDefaultPoe1, registryOf } from "@hinekora/data";
import { getHover } from "./hover.js";

const registry = registryOf(loadDefaultPoe1());
const snapshot = loadDefaultEconomy();

describe("hover: a Tangled Fossil", () => {
    it("says its two modifier types are not known beforehand, in the game's words", () => {
        const src = `item { base: "Iron Ring" ilvl: 84 rarity: normal }\nfossil "tangled"`;
        const h = getHover(src, src.indexOf("tangled") + 1, registry)!;
        expect(h).toContain("which two is not known beforehand, so the roll may land any modifier");
        expect(h).not.toContain("read as possible");
    });
});

describe("hover: the cost line where a figure is missing", () => {
    it("names the currency the snapshot has no price for", () => {
        const chaos = new Map(snapshot.chaos);
        chaos.delete("Regal Orb");
        const src = `item { base: "Iron Ring" ilvl: 84 rarity: normal }\ntransmute\nregal`;
        const total = getHover(src, src.indexOf("item") + 1, registry, { ...snapshot, chaos });
        expect(total).toContain(
            `_Expected spend for the guide:_ 1 Orb of Transmutation, 1 Regal Orb (no ${snapshot.league} price for Regal Orb).`,
        );
    });

    it("says a loop with no figure is not known, and so the guide's spend", () => {
        // A fossil pair that blocks the life it is rolled for.
        const src = `item { base: "Stygian Vise" ilvl: 84 rarity: normal }
until has "maximum life" t1 {
    fossil "pristine" "dense"
}`;
        const loop = getHover(src, src.indexOf("until") + 1, registry, snapshot);
        expect(loop).toContain(
            "_Cost:_ the check finds this loop can never reach its exit, so its rounds and the guide's total are not known.",
        );
        expect(loop).not.toMatch(/chance/);
        const total = getHover(src, src.indexOf("item") + 1, registry, snapshot);
        expect(total).toContain(
            "_Expected spend for the guide:_ not known, for a loop in it has no figure.",
        );
    });
});

describe("hover: what a call is expected to spend where it is written", () => {
    /** The cost line of the hover on the `nth` place `needle` is written. */
    const costAt = (src: string, needle: string, nth = 0): string | undefined => {
        let at = -1;
        for (let i = 0; i <= nth; i++) at = src.indexOf(needle, at + 1);
        const blocks = getHover(src, at + 1, registry, snapshot)?.split("\n\n---\n\n") ?? [];
        return blocks.find((b) => b.startsWith("_Cost:_"));
    };
    const ring = (rarity: string): string =>
        `item { base: "Iron Ring" ilvl: 84 rarity: ${rarity} }\n`;
    const one = (item: string): string => priceText([{ item, amount: 1 }], snapshot);
    /** What a step's own cost line says it is expected to spend. */
    const spend = (line: string | undefined): string =>
        line!.replace(/^_Cost:_ expected (.*)\.$/, "$1");

    it("shows a call of one step as that step's spend, and nothing inside the body", () => {
        const src = `${ring("normal")}def start() {
    transmute
}
start()
regal`;
        expect(costAt(src, "start()", 1)).toBe(`_Cost:_ expected ${one("Orb of Transmutation")}.`);
        // A body may run at many sites: its steps carry no figure of their own.
        expect(costAt(src, "transmute")).toBeUndefined();
        expect(costAt(src, "start()")).toBeUndefined();
    });

    it("sums a call of several steps, each priced step listed under the total", () => {
        const src = `${ring("normal")}def rare() {
    transmute
    regal
    exalt
}
rare()`;
        const total = priceText(
            ["Orb of Transmutation", "Regal Orb", "Exalted Orb"].map((item) => ({
                item,
                amount: 1,
            })),
            snapshot,
        );
        expect(costAt(src, "rare()", 1)).toBe(
            [
                `_Cost:_ expected ${total}.`,
                "",
                `- \`transmute\`: ${one("Orb of Transmutation")}`,
                `- \`regal\`: ${one("Regal Orb")}`,
                `- \`exalt\`: ${one("Exalted Orb")}`,
            ].join("\n"),
        );
    });

    const reroll = `def reroll(m, step) {
    until has m {
        step
    }
}
`;

    it("counts every round of a loop inside the call, as the loop written there would", () => {
        const called = `${ring("magic")}${reroll}reroll("maximum life", alteration)`;
        const written = `${ring("magic")}until has "maximum life" {
    alteration
}`;
        const line = costAt(called, "reroll(", 1);
        expect(line).toMatch(/^_Cost:_ expected [\d.]+ Orb of Alteration \(~[\d.]+ chaos\)\.$/);
        expect(line).toBe(costAt(written, "alteration"));
        expect(line).not.toBe(`_Cost:_ expected ${one("Orb of Alteration")}.`);
    });

    it("gives each of two calls of one procedure the figure of its own site", () => {
        const src = `${ring("magic")}${reroll}reroll("maximum life", alteration)
regal
reroll("fire resistance", {
    scour
    alchemy
})`;
        const written = `${ring("magic")}until has "maximum life" {
    alteration
}
regal
until has "fire resistance" {
    scour
    alchemy
}`;
        expect(costAt(src, "reroll(", 1)).toBe(costAt(written, "alteration"));
        // The second call runs its two steps on the Rare item the first left.
        const [head, , ...lines] = costAt(src, "reroll(", 2)!.split("\n");
        expect(lines).toEqual([
            `- \`scour\`: ${spend(costAt(written, "scour"))}`,
            `- \`alchemy\`: ${spend(costAt(written, "alchemy"))}`,
        ]);
        expect(head).toMatch(
            /^_Cost:_ expected [\d.]+ Orb of Scouring, [\d.]+ Orb of Alchemy \(~[\d.]+ chaos\)\.$/,
        );
        // The steps passed to the call run inside it: no figure of their own.
        expect(costAt(src, "scour")).toBeUndefined();
    });

    it("says a call is not known where a loop inside it has no figure", () => {
        // A fossil pair that blocks the life it is rolled for.
        const src = `item { base: "Stygian Vise" ilvl: 84 rarity: normal }
def life() {
    transmute
    until has "maximum life" t1 {
        fossil "pristine" "dense"
    }
}
life()`;
        const line = costAt(src, "life()", 1)!;
        expect(line).toMatch(/^_Cost:_ not known, for a loop in this call has no figure; /);
        expect(line).toContain("its rounds and the guide's total are not known");
        expect(line).not.toContain("expected");
    });
});
