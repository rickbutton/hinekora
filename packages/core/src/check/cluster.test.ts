import { describe, expect, it } from "vitest";
import { check, type CheckContext } from "./check.js";
import { buildRegistry } from "../resolve/registry.js";
import { craft, has, item, op, until } from "../__fixtures__/ast.js";
import { CATALOG, CLUSTER_BASE, NOTABLE_SADIST, RING_BASE } from "../__fixtures__/mods.js";

const registry = buildRegistry({
    bases: [RING_BASE, CLUSTER_BASE],
    mods: [...CATALOG, NOTABLE_SADIST],
    baseAliases: { "Iron Ring": "IronRing" },
});
const ctx: CheckContext = { registry };
const jewel = (enchant?: { passives: number; text: string }) =>
    item({
        base: "Large Cluster Jewel",
        ilvl: 84,
        rarity: "rare",
        ...(enchant !== undefined && { enchant }),
    });

describe("a cluster jewel's enchant", () => {
    it("names the enchantment by the words of its stat", () => {
        expect(registry.resolveClusterEnchant("lightning damage")).toMatchObject({
            ok: true,
            value: "affliction_lightning_damage",
        });
        expect(registry.resolveClusterEnchant("minion life").ok).toBe(false);
        expect(registry.clusterEnchants().map((e) => e.words)).toEqual(["lightning damage"]);
    });

    it("lets the notables of the enchantment roll, so a loop on one can exit", () => {
        const c = craft(jewel({ passives: 8, text: "lightning damage" }), [
            until(has("sadist"), [op("chaos")]),
        ]);
        expect(check(c, ctx).diagnostics).toEqual([]);
    });

    it("is required, and its passive count must fit the size", () => {
        expect(check(craft(jewel(), [op("chaos")]), ctx).diagnostics[0]?.message).toContain(
            "depend on its enchant",
        );
        const few = check(craft(jewel({ passives: 3, text: "lightning damage" }), []), ctx);
        expect(few.diagnostics[0]?.message).toContain("adds 8 to 12 passive skills");
        const ring = item({
            base: "Iron Ring",
            ilvl: 84,
            rarity: "rare",
            enchant: { passives: 8, text: "x" },
        });
        expect(check(craft(ring, []), ctx).diagnostics[0]?.message).toContain(
            "Only a cluster jewel",
        );
    });
});
