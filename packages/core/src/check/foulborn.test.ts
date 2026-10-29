import { describe, expect, it } from "vitest";
import { check, type CheckContext } from "./check.js";
import { buildRegistry } from "../resolve/registry.js";
import { craft, foulborn, item, op } from "../__fixtures__/ast.js";
import {
    CATALOG,
    RING_BASE,
    SEVEN_TIER_ROWS,
    STAFFY_ADDER,
    STAFFY_TIER_HIGH,
    STAFFY_TIER_SURE,
    TIERED_CATALOG,
} from "../__fixtures__/mods.js";
import { TypeId } from "../model/ids.js";

const registry = buildRegistry({
    bases: [RING_BASE],
    mods: [
        ...CATALOG,
        ...TIERED_CATALOG,
        ...SEVEN_TIER_ROWS,
        STAFFY_ADDER,
        STAFFY_TIER_SURE,
        STAFFY_TIER_HIGH,
    ],
    baseAliases: { "Iron Ring": "IronRing" },
});
const ctx: CheckContext = { registry };

const ring = (rarity: "magic" | "rare", ilvl = 100) => item({ base: "Iron Ring", ilvl, rarity });

/** The rows the final state allows for a type. */
const rowsOf = (r: ReturnType<typeof check>, type: string): Set<string> =>
    new Set(r.finalState!.tiers.get(TypeId(type)) ?? []);

describe("foulborn orbs", () => {
    it("a foulborn exalt draws only the top half of each type's tiers", () => {
        // MaxLife has three eligible tiers at ilvl 100, so two can roll; the
        // plain exalt allows all three.
        const r = check(craft(ring("rare"), [foulborn("exalt")]), ctx);
        expect(r.diagnostics).toEqual([]);
        expect(rowsOf(r, "MaxLife")).toEqual(new Set(["MaxLifeHigh", "MaxLifeMid"]));
        const plain = check(craft(ring("rare"), [op("exalt")]), ctx);
        expect(rowsOf(plain, "MaxLife")).toEqual(
            new Set(["MaxLifeHigh", "MaxLifeMid", "MaxLifeLow"]),
        );
    });

    it("keeps one more than half above six tiers", () => {
        // Seven eligible tiers keep four, eight would keep five (Foulborn
        // currency § Mechanics); at ilvl 55 only five are eligible, keeping three.
        const r = check(craft(ring("rare"), [foulborn("exalt")]), ctx);
        expect(rowsOf(r, "SevenTier")).toEqual(
            new Set(["SevenTier7", "SevenTier6", "SevenTier5", "SevenTier4"]),
        );
        const low = check(craft(ring("rare", 55), [foulborn("exalt")]), ctx);
        expect(rowsOf(low, "SevenTier")).toEqual(
            new Set(["SevenTier5", "SevenTier4", "SevenTier3"]),
        );
    });

    it("counts only the tiers eligible at the item's level", () => {
        // At ilvl 20 only the lowest tier is eligible, so it is the one that rolls.
        const r = check(craft(ring("rare", 20), [foulborn("exalt")]), ctx);
        expect(rowsOf(r, "MaxLife")).toEqual(new Set(["MaxLifeLow"]));
    });

    it("keeps a sure row that a possibly enabled higher row would otherwise cull", () => {
        // After a chaos the tag adder may be on the ring, so StaffyTier has one
        // or two eligible tiers: with one, the sure row rolls; with two, only the
        // high one. The cull must keep both.
        const r = check(craft(ring("rare"), [op("chaos"), foulborn("exalt")]), ctx);
        expect(rowsOf(r, "StaffyTier")).toEqual(new Set(["StaffyTierSure1", "StaffyTierHigh1"]));
    });

    it("has the plain orb's needs and counts", () => {
        const r = check(craft(ring("magic"), [foulborn("regal")]), ctx);
        expect(r.diagnostics).toEqual([]);
        expect(r.finalState!.rarity).toBe("rare");
        expect(r.finalState!.counts.total).toEqual([1, 1]);
        const refused = check(craft(ring("rare"), [foulborn("augment")]), ctx);
        expect(refused.diagnostics[0]!.message).toContain("Requires a Magic item");
    });
});
