import { describe, expect, it } from "vitest";
import { isWf, maxPre, maxSuf, slotCap, slotOpen, wfViolations, type WfViolation } from "./wf.js";
import {
    AMULET_ONLY,
    COLD_RESIST,
    FIRE_CHAOS_RESIST,
    FIRE_RESIST,
    FLASK_MOD,
    INCREASED_ARMOUR,
    INCREASED_MANA,
    LIFE_T1,
    LIFE_T2,
    LIGHTNING_RESIST,
    mkItem,
} from "../__fixtures__/mods.js";

const kinds = (vs: readonly WfViolation[]): string[] => vs.map((v) => v.kind);

describe("slot caps", () => {
    it("are 0/0 Normal, 1/1 Magic, 3/3 Rare with no effects", () => {
        expect(slotCap(mkItem({ rarity: "normal" }), "prefix")).toBe(0);
        expect(slotCap(mkItem({ rarity: "normal" }), "suffix")).toBe(0);
        expect(maxPre(mkItem({ rarity: "magic" }))).toBe(1);
        expect(maxSuf(mkItem({ rarity: "magic" }))).toBe(1);
        expect(maxPre(mkItem({ rarity: "rare" }))).toBe(3);
        expect(maxSuf(mkItem({ rarity: "rare" }))).toBe(3);
    });
});

describe("slotOpen", () => {
    it("is true when below cap and false at cap", () => {
        const emptyRare = mkItem({ rarity: "rare" });
        expect(slotOpen(emptyRare, "prefix")).toBe(true);

        const threePre = mkItem({
            rarity: "rare",
            prefixes: [LIFE_T2, INCREASED_MANA, INCREASED_ARMOUR],
        });
        expect(slotOpen(threePre, "prefix")).toBe(false);
        expect(slotOpen(threePre, "suffix")).toBe(true);
    });

    it("is always false on a Normal item", () => {
        const normal = mkItem({ rarity: "normal" });
        expect(slotOpen(normal, "prefix")).toBe(false);
        expect(slotOpen(normal, "suffix")).toBe(false);
    });
});

describe("wf — a well-formed item has no violations", () => {
    it("accepts a clean 2-prefix / 2-suffix rare", () => {
        const clean = mkItem({
            rarity: "rare",
            ilvl: 100,
            prefixes: [LIFE_T1, INCREASED_MANA],
            suffixes: [FIRE_RESIST, COLD_RESIST],
        });
        expect(wfViolations(clean)).toEqual([]);
        expect(isWf(clean)).toBe(true);
    });
});

describe("wf — slot caps", () => {
    it("flags prefixes over cap", () => {
        const overPre = mkItem({
            rarity: "rare",
            prefixes: [LIFE_T1, INCREASED_MANA, INCREASED_ARMOUR, AMULET_ONLY],
        });
        expect(kinds(wfViolations(overPre))).toContain("prefixOverCap");
    });

    it("flags suffixes over cap", () => {
        const overSuf = mkItem({
            rarity: "rare",
            suffixes: [FIRE_RESIST, COLD_RESIST, LIGHTNING_RESIST, AMULET_ONLY].map((m) => ({
                ...m,
                gen: "suffix" as const,
            })),
        });
        expect(kinds(wfViolations(overSuf))).toContain("suffixOverCap");
    });
});

describe("wf — coexistence rules", () => {
    it("flags a duplicate ModType", () => {
        // Two IncreasedLife tiers share a ModType.
        const dup = mkItem({ rarity: "rare", prefixes: [LIFE_T1, LIFE_T2] });
        expect(kinds(wfViolations(dup))).toContain("duplicateType");
    });

    it("flags a family collision independently of ModType", () => {
        // Different ModTypes, shared family ResistFire → ONLY a family collision.
        const famClash = mkItem({ rarity: "rare", suffixes: [FIRE_RESIST, FIRE_CHAOS_RESIST] });
        const vs = wfViolations(famClash);
        expect(kinds(vs)).toEqual(["familyCollision"]);
    });
});

describe("wf — tier gate and domain", () => {
    it("flags an affix whose minLevel exceeds ilvl", () => {
        const gated = mkItem({ rarity: "rare", ilvl: 50, prefixes: [LIFE_T1] }); // min 60
        const vs = wfViolations(gated);
        expect(kinds(vs)).toContain("ilvlGate");
    });

    it("flags a domain mismatch", () => {
        // FLASK_MOD is flask-domain on an item-domain (ring) base.
        const wrongDomain = mkItem({ rarity: "rare", prefixes: [FLASK_MOD] });
        expect(kinds(wfViolations(wrongDomain))).toContain("domainMismatch");
    });
});
