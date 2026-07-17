import { describe, expect, it } from "vitest";
import { annul, exalt, regal, transmute } from "./base.js";
import type { OpContext, OpError, OpResult } from "./result.js";
import {
    armCount,
    arms,
    guaranteedPresent,
    guarantees,
    outcomeRarity,
    type Outcome,
} from "../outcome/outcome.js";
import {
    CATALOG,
    COLD_RESIST,
    FIRE_RESIST,
    INCREASED_ARMOUR,
    INCREASED_MANA,
    LIFE_T1,
    LIGHTNING_RESIST,
    mkItem,
    PROTECT_PREFIXES_CARRIER,
} from "../__fixtures__/mods.js";

const ctx: OpContext = { catalog: CATALOG };

/** Assert success and return the outcome. */
function expectOk(r: OpResult): Outcome {
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("expected ok");
    return r.outcome;
}

/** Assert failure and return the error. */
function expectErr(r: OpResult): OpError {
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("expected err");
    return r.error;
}

describe("transmute — Normal → Magic, add one", () => {
    it("rejects a non-Normal item (the rarity seam)", () => {
        const magic = expectErr(transmute(ctx, mkItem({ rarity: "magic" })));
        expect(magic).toMatchObject({ kind: "wrongRarity", needed: "normal", actual: "magic" });
        const rare = expectErr(transmute(ctx, mkItem({ rarity: "rare" })));
        expect(rare).toMatchObject({ kind: "wrongRarity", needed: "normal", actual: "rare" });
    });

    it("promotes to Magic and yields a symbolic add-union of 1-mod items", () => {
        const o = expectOk(transmute(ctx, mkItem({ rarity: "normal" })));
        expect(o.kind).toBe("addOne");
        expect(outcomeRarity(o)).toBe("magic");
        expect(armCount(o)).toBeGreaterThan(0);
        for (const arm of arms(o)) {
            expect(arm.rarity).toBe("magic");
            expect(arm.prefixes.length + arm.suffixes.length).toBe(1);
        }
    });
});

describe("regal — Magic → Rare, add one (additive)", () => {
    it("rejects a non-Magic item", () => {
        expect(expectErr(regal(ctx, mkItem({ rarity: "normal" }))).kind).toBe("wrongRarity");
        expect(expectErr(regal(ctx, mkItem({ rarity: "rare" }))).kind).toBe("wrongRarity");
    });

    it("preserves the existing mod in every arm and becomes Rare", () => {
        const magic = mkItem({ rarity: "magic", prefixes: [LIFE_T1] });
        const o = expectOk(regal(ctx, magic));
        expect(outcomeRarity(o)).toBe("rare");
        // Additive: Life is in the floor (guaranteed across all arms).
        expect(guarantees(o, LIFE_T1.type)).toBe(true);
    });
});

describe("exalt — the headline seam: can't exalt a Magic item", () => {
    it("rejects a Magic item with wrongRarity(needed rare)", () => {
        const e = expectErr(exalt(ctx, mkItem({ rarity: "magic", prefixes: [LIFE_T1] })));
        expect(e).toMatchObject({ kind: "wrongRarity", needed: "rare", actual: "magic" });
    });

    it("rejects a Normal item too", () => {
        expect(expectErr(exalt(ctx, mkItem({ rarity: "normal" }))).kind).toBe("wrongRarity");
    });

    it("rejects a full 6-affix Rare with noOpenSlot", () => {
        const full = mkItem({
            rarity: "rare",
            prefixes: [LIFE_T1, INCREASED_MANA, INCREASED_ARMOUR],
            suffixes: [FIRE_RESIST, COLD_RESIST, LIGHTNING_RESIST],
        });
        expect(expectErr(exalt(ctx, full))).toMatchObject({ kind: "noOpenSlot" });
    });

    it("adds one mod additively, preserving present mods (Exalt preserves X)", () => {
        const rare = mkItem({ rarity: "rare", prefixes: [LIFE_T1], suffixes: [FIRE_RESIST] });
        const o = expectOk(exalt(ctx, rare));
        expect(o.kind).toBe("addOne");
        expect(outcomeRarity(o)).toBe("rare");
        expect(guaranteedPresent(o)).toEqual(new Set([LIFE_T1.type, FIRE_RESIST.type]));
    });

    it("stores candidates symbolically rather than enumerating item states", () => {
        const rare = mkItem({ rarity: "rare", prefixes: [LIFE_T1] });
        const o = expectOk(exalt(ctx, rare));
        // The union is at most as wide as the catalog — a pool, not a product.
        expect(armCount(o)).toBeLessThanOrEqual(CATALOG.length);
    });
});

describe("annul — Rare, remove one at random (risks X)", () => {
    it("rejects a non-Rare item", () => {
        expect(expectErr(annul(ctx, mkItem({ rarity: "magic", prefixes: [LIFE_T1] }))).kind).toBe(
            "wrongRarity",
        );
    });

    it("rejects when there is nothing removable", () => {
        // A Rare with no affixes is well-formed but has nothing to annul.
        expect(expectErr(annul(ctx, mkItem({ rarity: "rare" }))).kind).toBe("nothingToRemove");
    });

    it("drops each present type from the floor (any could be the one removed)", () => {
        const rare = mkItem({ rarity: "rare", prefixes: [LIFE_T1], suffixes: [FIRE_RESIST] });
        const o = expectOk(annul(ctx, rare));
        expect(o.kind).toBe("removeOne");
        // Neither is guaranteed: each dies in its own arm.
        expect(guaranteedPresent(o)).toEqual(new Set());
        expect(armCount(o)).toBe(2);
    });
});

describe("annul under protection — a Protect effect makes it safe", () => {
    it("excludes protected prefixes from removal, so the forced mod survives", () => {
        // "prefixes cannot be changed" carrier (suffix) protects the Life prefix.
        const rare = mkItem({
            rarity: "rare",
            prefixes: [LIFE_T1],
            suffixes: [PROTECT_PREFIXES_CARRIER],
        });
        const o = expectOk(annul(ctx, rare));
        expect(o.kind).toBe("removeOne");
        // Only the carrier is removable; the protected Life prefix survives every
        // (single) arm — so it is guaranteed present. Protection turns a risky
        // Annul into a safe one (typing rules §4.4 / §9.6).
        expect(guarantees(o, LIFE_T1.type)).toBe(true);
        expect(armCount(o)).toBe(1);
    });
});

describe("all ops require a well-formed input", () => {
    it("rejects an ill-formed item with notWellFormed", () => {
        // Two Life tiers share a ModType (and family) → not wf.
        const illFormed = mkItem({
            rarity: "rare",
            prefixes: [LIFE_T1, { ...LIFE_T1, id: LIFE_T1.id }],
        });
        expect(expectErr(exalt(ctx, illFormed)).kind).toBe("notWellFormed");
    });
});
