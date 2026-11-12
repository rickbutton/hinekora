import { describe, expect, it } from "vitest";
import { type CheckContext } from "./check.js";
import { check } from "../exact/check.js";
import * as v from "../exact/views.js";
import { buildRegistry } from "../resolve/registry.js";
import { cmp, craft, harvest, has, iff, item, op, until } from "../__fixtures__/ast.js";
import {
    CATALOG,
    CLUSTER_BASE,
    CLUSTER_EFFECT,
    MEDIUM_CLUSTER_BASE,
    NOTABLE_OVERSHOCK,
    NOTABLE_SADIST,
    RING_BASE,
    SMALL_CLUSTER_BASE,
    TAG_ENCHANT_LIGHTNING,
} from "../__fixtures__/mods.js";
import { GroupId, ModId, TypeId } from "../model/ids.js";
import type { Mod } from "../model/mod.js";

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

    it("makes one base of the jewel and its enchantment, shared between checks", () => {
        // What is cached by the base (its pool) is then found again.
        const once = check(craft(jewel({ passives: 8, text: "lightning damage" }), []), ctx);
        const again = check(craft(jewel({ passives: 9, text: "lightning damage" }), []), ctx);
        expect(once.finalState!.u.base).toBe(again.finalState!.u.base);
        expect(once.finalState!.u.base.tags.has(TAG_ENCHANT_LIGHTNING)).toBe(true);
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

describe("a cluster jewel's enchant and its size", () => {
    const sized = buildRegistry({
        bases: [CLUSTER_BASE, SMALL_CLUSTER_BASE],
        mods: [...CATALOG, NOTABLE_SADIST, NOTABLE_OVERSHOCK, CLUSTER_EFFECT],
        clusterEnchants: { large: ["affliction_lightning_damage"] },
    });

    it("refuses an enchantment of another size's jewels", () => {
        const small = jewel({ passives: 2, text: "lightning damage" }, [], "Small Cluster Jewel");
        expect(check(craft(small, []), { registry: sized }).diagnostics[0]?.message).toContain(
            'A small cluster jewel cannot have the "lightning damage" enchant — it is a large cluster jewel\'s',
        );
        const large = jewel({ passives: 8, text: "lightning damage" });
        expect(check(craft(large, []), { registry: sized }).diagnostics).toEqual([]);
    });
});

describe("a rare reforge on a jewel", () => {
    const lightning = { passives: 8, text: "lightning damage" };
    // Two suffixes beside the three prefixes, so the pool can fill a jewel's four slots.
    const suffix = (name: string): Mod => ({
        ...CLUSTER_EFFECT,
        id: ModId(name),
        type: TypeId(name),
        gen: "suffix",
        families: new Set([GroupId(name)]),
    });
    const suffixed: CheckContext = {
        registry: buildRegistry({
            bases: [RING_BASE, CLUSTER_BASE],
            mods: [
                ...CATALOG,
                NOTABLE_SADIST,
                NOTABLE_OVERSHOCK,
                CLUSTER_EFFECT,
                suffix("ClusterSuffixA"),
                suffix("ClusterSuffixB"),
            ],
            baseAliases: { "Iron Ring": "IronRing" },
        }),
    };

    it("leaves three or four modifiers, so an exalt fits where it left three", () => {
        const r = check(craft(jewel(lightning), [op("chaos")]), suffixed);
        expect(r.diagnostics).toEqual([]);
        expect(v.counts(r.finalState!).total).toEqual([3, 4]);
        expect(v.counts(r.finalState!).prefix).toEqual([1, 2]);
        const refused = check(craft(jewel(lightning), [op("chaos"), op("exalt")]), suffixed);
        expect(refused.diagnostics[0]?.message).toContain("the item may be full");
        const narrowed = craft(jewel(lightning), [
            op("chaos"),
            iff(cmp("prefixCount", "==", 1), [op("exalt")]),
        ]);
        expect(check(narrowed, suffixed).diagnostics).toEqual([]);
    });

    it("holds for an alchemy", () => {
        const normal = item({
            base: "Large Cluster Jewel",
            ilvl: 84,
            rarity: "normal",
            enchant: lightning,
        });
        const alchemy = check(craft(normal, [op("alchemy")]), suffixed);
        expect(alchemy.diagnostics).toEqual([]);
        expect(v.counts(alchemy.finalState!).total).toEqual([3, 4]);
    });

    it("holds for a Harvest reforge", () => {
        const r = check(craft(jewel(lightning), [harvest("reforge", "lightning")]), suffixed);
        expect(r.diagnostics).toEqual([]);
        expect(v.counts(r.finalState!).total).toEqual([3, 4]);
    });

    it("a ring still takes four to six", () => {
        const ring = item({ base: "Iron Ring", ilvl: 84, rarity: "rare" });
        expect(v.counts(check(craft(ring, [op("chaos")]), suffixed).finalState!).total).toEqual([
            4, 6,
        ]);
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
        expect(v.possibleTypes(small.finalState!).has(NOTABLE_OVERSHOCK.type)).toBe(false);
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
        expect(v.possibleTypes(medium.finalState!).has(NOTABLE_OVERSHOCK.type)).toBe(true);
        const large = check(
            craft(jewel({ passives: 8, text: "lightning damage" }, ["sadist"]), [op("exalt")]),
            ctx,
        );
        expect(large.diagnostics).toEqual([]);
        expect(v.possibleTypes(large.finalState!).has(NOTABLE_OVERSHOCK.type)).toBe(true);
    });

    it("a Small jewel's loop for a second notable can never exit", () => {
        const c = craft(
            jewel({ passives: 2, text: "lightning damage" }, ["sadist"], "Small Cluster Jewel"),
            [until(has("overshock"), [op("exalt")])],
        );
        expect(check(c, ctx).diagnostics.length).toBeGreaterThan(0);
    });
});
