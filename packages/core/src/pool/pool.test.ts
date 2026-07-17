import { describe, expect, it } from "vitest";
import { pool, lookupWeight } from "./pool.js";
import { known } from "../model/weight.js";
import {
    AMULET_BASE,
    AMULET_ONLY,
    APPROX_ZERO_MOD,
    CATALOG,
    COLD_RESIST,
    FIRE_CHAOS_RESIST,
    FIRE_RESIST,
    FLASK_BASE,
    FLASK_MOD,
    idsOf,
    INCREASED_ARMOUR,
    INCREASED_MANA,
    JEWEL_ONLY_SPAWN,
    LIFE_T1,
    LIFE_T2,
    LIGHTNING_RESIST,
    mkItem,
    RING_BASE,
    RING_DISABLED,
    UNKNOWN_WEIGHT_MOD,
} from "../__fixtures__/mods.js";

describe("pool — the full comprehension on an empty rare ring", () => {
    const it0 = mkItem({ rarity: "rare", base: RING_BASE, ilvl: 100 });

    it("returns exactly the eligible candidates, excluding every gated mod", () => {
        const ids = idsOf(pool(CATALOG, it0));
        expect(ids).toEqual(
            new Set([
                LIFE_T1.id,
                LIFE_T2.id,
                INCREASED_MANA.id,
                INCREASED_ARMOUR.id,
                FIRE_RESIST.id,
                FIRE_CHAOS_RESIST.id,
                COLD_RESIST.id,
                LIGHTNING_RESIST.id,
                UNKNOWN_WEIGHT_MOD.id,
            ]),
        );
    });

    it("excludes the wrong-domain mod, wrong-class mod, and no-spawn-tag mod", () => {
        const ids = idsOf(pool(CATALOG, it0));
        expect(ids.has(FLASK_MOD.id)).toBe(false); // domain: flask
        expect(ids.has(AMULET_ONLY.id)).toBe(false); // class: amulet-only
        expect(ids.has(JEWEL_ONLY_SPAWN.id)).toBe(false); // no matching spawn tag
    });

    it("treats an Unknown weight as eligible but a zero weight as not", () => {
        const ids = idsOf(pool(CATALOG, it0));
        expect(ids.has(UNKNOWN_WEIGHT_MOD.id)).toBe(true);
        expect(ids.has(APPROX_ZERO_MOD.id)).toBe(false);
    });
});

describe("pool — domain gating", () => {
    it("excludes item-domain mods on a flask base and includes the flask mod", () => {
        const flask = mkItem({ rarity: "rare", base: FLASK_BASE, ilvl: 100 });
        const ids = idsOf(pool(CATALOG, flask));
        // Only the flask-domain mod survives; every item-domain mod is gated out.
        expect(ids).toEqual(new Set([FLASK_MOD.id]));
    });

    it("excludes the flask mod on an item-domain base", () => {
        const ring = mkItem({ rarity: "rare", base: RING_BASE, ilvl: 100 });
        expect(idsOf(pool(CATALOG, ring)).has(FLASK_MOD.id)).toBe(false);
    });
});

describe("pool — ilvl gating", () => {
    it("gates out a high tier below its minLevel, keeps the low tier", () => {
        const it50 = mkItem({ rarity: "rare", ilvl: 50 });
        const ids = idsOf(pool(CATALOG, it50));
        expect(ids.has(LIFE_T1.id)).toBe(false); // minLevel 60 > 50
        expect(ids.has(LIFE_T2.id)).toBe(true); // minLevel 30 <= 50
    });

    it("gates out both tiers well below either minLevel", () => {
        const it25 = mkItem({ rarity: "rare", ilvl: 25 });
        const ids = idsOf(pool(CATALOG, it25));
        expect(ids.has(LIFE_T1.id)).toBe(false);
        expect(ids.has(LIFE_T2.id)).toBe(false);
    });

    it("is inclusive at the boundary (minLevel == ilvl)", () => {
        const it60 = mkItem({ rarity: "rare", ilvl: 60 });
        expect(idsOf(pool(CATALOG, it60)).has(LIFE_T1.id)).toBe(true);
    });
});

describe("pool — ModType collision (rule 1: no duplicate type)", () => {
    it("excludes every tier sharing a present affix's ModType", () => {
        // LIFE_T2 present; LIFE_T1 shares its ModType (IncreasedLife).
        const withLife = mkItem({ rarity: "rare", prefixes: [LIFE_T2] });
        const ids = idsOf(pool(CATALOG, withLife));
        expect(ids.has(LIFE_T1.id)).toBe(false);
        expect(ids.has(LIFE_T2.id)).toBe(false);
        // An unrelated prefix type is still offered.
        expect(ids.has(INCREASED_MANA.id)).toBe(true);
    });
});

describe("pool — Family collision (rule 2: mutual exclusion)", () => {
    it("excludes a DIFFERENT ModType that shares a family with a present affix", () => {
        // FIRE_RESIST present; FIRE_CHAOS_RESIST has a different ModType but
        // shares family ResistFire — so its exclusion is purely the family rule.
        const withFire = mkItem({ rarity: "rare", suffixes: [FIRE_RESIST] });
        const ids = idsOf(pool(CATALOG, withFire));
        expect(ids.has(FIRE_CHAOS_RESIST.id)).toBe(false);
        // Unrelated-family suffixes remain available.
        expect(ids.has(COLD_RESIST.id)).toBe(true);
        expect(ids.has(LIGHTNING_RESIST.id)).toBe(true);
    });
});

describe("pool — slot cardinality (rule 3)", () => {
    it("offers nothing on a Normal item (0/0 caps)", () => {
        const normal = mkItem({ rarity: "normal" });
        expect(pool(CATALOG, normal)).toHaveLength(0);
    });

    it("Magic (1/1): a present prefix closes the prefix slot but not suffixes", () => {
        const magic = mkItem({ rarity: "magic", prefixes: [INCREASED_MANA] });
        const cands = pool(CATALOG, magic);
        expect(cands.every((c) => c.mod.gen === "suffix")).toBe(true);
        expect(cands.length).toBeGreaterThan(0);
    });

    it("Magic (1/1): one prefix + one suffix leaves no room at all", () => {
        const full = mkItem({
            rarity: "magic",
            prefixes: [INCREASED_MANA],
            suffixes: [COLD_RESIST],
        });
        expect(pool(CATALOG, full)).toHaveLength(0);
    });

    it("Rare (3/3): three prefixes close the prefix slots, suffixes still open", () => {
        const threePre = mkItem({
            rarity: "rare",
            prefixes: [LIFE_T2, INCREASED_MANA, INCREASED_ARMOUR],
        });
        const cands = pool(CATALOG, threePre);
        expect(cands.some((c) => c.mod.gen === "prefix")).toBe(false);
        expect(cands.some((c) => c.mod.gen === "suffix")).toBe(true);
    });

    it("Rare (3/3): a full 3+3 item has an empty pool", () => {
        const fullRare = mkItem({
            rarity: "rare",
            prefixes: [LIFE_T2, INCREASED_MANA, INCREASED_ARMOUR],
            suffixes: [FIRE_RESIST, COLD_RESIST, LIGHTNING_RESIST],
        });
        expect(pool(CATALOG, fullRare)).toHaveLength(0);
    });
});

describe("pool — class restriction and spawn ordering", () => {
    it("offers an amulet-only mod on an amulet but not a ring", () => {
        const ring = mkItem({ rarity: "rare", base: RING_BASE });
        const amulet = mkItem({ rarity: "rare", base: AMULET_BASE });
        expect(idsOf(pool(CATALOG, ring)).has(AMULET_ONLY.id)).toBe(false);
        expect(idsOf(pool(CATALOG, amulet)).has(AMULET_ONLY.id)).toBe(true);
    });

    it("respects first-match spawn ordering: zero on rings, allowed elsewhere", () => {
        const ring = mkItem({ rarity: "rare", base: RING_BASE });
        const amulet = mkItem({ rarity: "rare", base: AMULET_BASE });
        expect(idsOf(pool(CATALOG, ring)).has(RING_DISABLED.id)).toBe(false);
        expect(idsOf(pool(CATALOG, amulet)).has(RING_DISABLED.id)).toBe(true);
    });
});

describe("lookupWeight — spawn resolution", () => {
    it("first matching tag wins, so an earlier zero entry disables the mod", () => {
        expect(lookupWeight(RING_DISABLED, RING_BASE.tags)).toEqual(known(0));
    });

    it("falls through to a later default entry when the earlier tag is absent", () => {
        expect(lookupWeight(RING_DISABLED, AMULET_BASE.tags)).toEqual(known(100));
    });

    it("returns null when no spawn tag matches the base", () => {
        expect(lookupWeight(JEWEL_ONLY_SPAWN, RING_BASE.tags)).toBeNull();
    });
});

describe("pool — intensionality guard", () => {
    it("returns candidate descriptors, not enumerated item states (bounded by catalog size)", () => {
        // The pool is at most the catalog; it never materializes item states.
        const it0 = mkItem({ rarity: "rare" });
        expect(pool(CATALOG, it0).length).toBeLessThanOrEqual(CATALOG.length);
    });
});
