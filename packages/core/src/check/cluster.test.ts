import { describe, expect, it } from "vitest";
import { check, type CheckContext } from "./check.js";
import { buildRegistry } from "../resolve/registry.js";
import { cmp, craft, has, iff, item, op, until } from "../__fixtures__/ast.js";
import {
    CATALOG,
    CLUSTER_BASE,
    CLUSTER_EFFECT,
    MEDIUM_CLUSTER_BASE,
    NOTABLE_OVERSHOCK,
    NOTABLE_SADIST,
    RING_BASE,
    SMALL_CLUSTER_BASE,
} from "../__fixtures__/mods.js";

const registry = buildRegistry({
    bases: [RING_BASE, CLUSTER_BASE, MEDIUM_CLUSTER_BASE, SMALL_CLUSTER_BASE],
    mods: [...CATALOG, NOTABLE_SADIST, NOTABLE_OVERSHOCK, CLUSTER_EFFECT],
    baseAliases: { "Iron Ring": "IronRing" },
});
const ctx: CheckContext = { registry };
const jewel = (
    enchant?: { passives: number; text: string },
    prefixes: string[] = [],
    base = "Large Cluster Jewel",
) =>
    item({
        base,
        ilvl: 84,
        rarity: "rare",
        prefixes,
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

describe("a rare reforge on a jewel", () => {
    const lightning = { passives: 8, text: "lightning damage" };

    it("leaves three or four modifiers, so an exalt fits where it left three", () => {
        const r = check(craft(jewel(lightning), [op("chaos")]), ctx);
        expect(r.diagnostics).toEqual([]);
        expect(r.finalState!.counts.total).toEqual([3, 4]);
        expect(r.finalState!.counts.prefix).toEqual([1, 2]);
        const refused = check(craft(jewel(lightning), [op("chaos"), op("exalt")]), ctx);
        expect(refused.diagnostics[0]?.message).toContain("the item may be full");
        const narrowed = craft(jewel(lightning), [
            op("chaos"),
            iff(cmp("prefixCount", "==", 1), [op("exalt")]),
        ]);
        expect(check(narrowed, ctx).diagnostics).toEqual([]);
    });

    it("holds for an alchemy", () => {
        const normal = item({
            base: "Large Cluster Jewel",
            ilvl: 84,
            rarity: "normal",
            enchant: lightning,
        });
        const alchemy = check(craft(normal, [op("alchemy")]), ctx);
        expect(alchemy.diagnostics).toEqual([]);
        expect(alchemy.finalState!.counts.total).toEqual([3, 4]);
    });

    it("a ring still takes four to six", () => {
        const ring = item({ base: "Iron Ring", ilvl: 84, rarity: "rare" });
        expect(check(craft(ring, [op("chaos")]), ctx).finalState!.counts.total).toEqual([4, 6]);
    });
});

describe("a cluster jewel's notables", () => {
    it("are one at most on a Small jewel, two on a Medium or a Large", () => {
        // Every notable adds a tag on which its generation table is zero below
        // Medium, so with one on a Small jewel no exalt can add another.
        const lightning = { passives: 2, text: "lightning damage" };
        const small = check(
            craft(jewel(lightning, ["sadist"], "Small Cluster Jewel"), [op("exalt")]),
            ctx,
        );
        expect(small.diagnostics).toEqual([]);
        expect(small.finalState!.possible.has(NOTABLE_OVERSHOCK.type)).toBe(false);
        const medium = check(
            craft(
                jewel(
                    { passives: 4, text: "lightning damage" },
                    ["sadist"],
                    "Medium Cluster Jewel",
                ),
                [op("exalt")],
            ),
            ctx,
        );
        expect(medium.diagnostics).toEqual([]);
        expect(medium.finalState!.possible.has(NOTABLE_OVERSHOCK.type)).toBe(true);
        const large = check(
            craft(jewel({ passives: 8, text: "lightning damage" }, ["sadist"]), [op("exalt")]),
            ctx,
        );
        expect(large.diagnostics).toEqual([]);
        expect(large.finalState!.possible.has(NOTABLE_OVERSHOCK.type)).toBe(true);
    });

    it("a Small jewel's loop for a second notable can never exit", () => {
        const c = craft(
            jewel({ passives: 2, text: "lightning damage" }, ["sadist"], "Small Cluster Jewel"),
            [until(has("overshock"), [op("exalt")])],
        );
        expect(check(c, ctx).diagnostics.length).toBeGreaterThan(0);
    });
});
