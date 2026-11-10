import { describe, expect, it } from "vitest";
import { check, type CheckContext } from "./check.js";
import { buildRegistry } from "../resolve/registry.js";
import { beast, craft, harvest, item, op, restore } from "../__fixtures__/ast.js";
import { CATALOG, RING_BASE } from "../__fixtures__/mods.js";
import { TypeId } from "../model/ids.js";

const registry = buildRegistry({
    bases: [RING_BASE],
    mods: [...CATALOG],
    baseAliases: { "Iron Ring": "IronRing" },
});
const ctx: CheckContext = { registry };

const ring = (strands?: number, rarity: "magic" | "rare" = "rare", prefixes: string[] = []) =>
    item({
        base: "Iron Ring",
        ilvl: 100,
        rarity,
        prefixes,
        ...(strands !== undefined && { strands }),
    });

const lifeRows = (r: ReturnType<typeof check>): Set<string> =>
    new Set(r.finalState!.tiers.get(TypeId("IncreasedLife")) ?? []);

describe("memory strands", () => {
    it("let only the top tiers roll while the item holds some", () => {
        // Two life tiers roll on the ring; at 82 strands one does.
        const r = check(craft(ring(82), [op("chaos")]), ctx);
        expect(r.diagnostics).toEqual([]);
        expect(lifeRows(r)).toEqual(new Set(["IncreasedLife1"]));
        expect(lifeRows(check(craft(ring(), [op("chaos")]), ctx))).toEqual(
            new Set(["IncreasedLife1", "IncreasedLife2"]),
        );
    });

    it("are used up by the currencies that roll modifiers, the floor falling", () => {
        // A Chaos Orb takes up to fifty: two leave the floor at zero, so the
        // third roll reads every tier again.
        const one = check(craft(ring(82), [op("chaos")]), ctx);
        expect(one.finalState!.strands).toEqual([32, 82]);
        const three = check(craft(ring(82), [op("chaos"), op("chaos"), op("chaos")]), ctx);
        expect(three.finalState!.strands).toEqual([0, 82]);
        expect(lifeRows(three)).toEqual(new Set(["IncreasedLife1", "IncreasedLife2"]));
        // An Exalted Orb's take depends on how many modifiers the item holds.
        const exalt = check(craft(ring(82), [op("chaos"), op("exalt")]), ctx);
        expect(exalt.finalState!.strands).toEqual([0, 82]);
        // A removal and the bench take none.
        const annul = check(craft(ring(82), [op("chaos"), op("annul")]), ctx);
        expect(annul.finalState!.strands).toEqual([32, 82]);
        // An Exalted Orb on a one-modifier Rare takes up to twenty-two.
        const exalted = check(craft(ring(82, "rare", ["IncreasedLife1"]), [op("exalt")]), ctx);
        expect(exalted.finalState!.strands).toEqual([60, 82]);
    });

    it("leave a Harvest reforge's tiers alone, since the page names the currency orbs", () => {
        const r = check(craft(ring(82), [harvest("reforge", "life")]), ctx);
        expect(r.diagnostics).toEqual([]);
        expect(lifeRows(r)).toEqual(new Set(["IncreasedLife1", "IncreasedLife2"]));
    });

    it("come back with an imprint", () => {
        const r = check(
            craft(ring(82, "magic", ["IncreasedLife1"]), [
                beast({ kind: "imprint" }),
                op("alteration"),
                restore(),
            ]),
            ctx,
        );
        expect(r.diagnostics).toEqual([]);
        expect(r.finalState!.strands).toEqual([82, 82]);
    });

    it("rejects a count outside the item's range", () => {
        const r = check(craft(ring(120), []), ctx);
        expect(r.diagnostics[0]!.message).toContain("0 to 100 memory strands");
    });
});
