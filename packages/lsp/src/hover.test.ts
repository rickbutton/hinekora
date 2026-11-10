import { describe, expect, it } from "vitest";
import { loadDefaultEconomy, loadDefaultPoe1, registryOf } from "@hinekora/data";
import { getHover } from "./hover.js";

const registry = registryOf(loadDefaultPoe1());
const snapshot = loadDefaultEconomy();

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
