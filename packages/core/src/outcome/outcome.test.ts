import { describe, expect, it } from "vitest";
import {
    addOne,
    armCount,
    arms,
    certain,
    guaranteedPresent,
    guarantees,
    isInhabited,
    mayHave,
    outcomeRarity,
    possiblePresent,
    prefixCountRange,
    removeOne,
    suffixCountRange,
} from "./outcome.js";
import { known } from "../model/weight.js";
import type { PoolCandidate } from "../pool/pool.js";
import {
    COLD_RESIST,
    FIRE_RESIST,
    INCREASED_ARMOUR,
    INCREASED_MANA,
    LIFE_T1,
    mkItem,
} from "../__fixtures__/mods.js";

const cand = (m: PoolCandidate["mod"]): PoolCandidate => ({ mod: m, weight: known(100) });

describe("addOne — symbolic add", () => {
    // A rare with one prefix (Life); pretend the pool offers a prefix and a suffix.
    const base = mkItem({ rarity: "rare", prefixes: [LIFE_T1] });
    const o = addOne(base, [cand(INCREASED_MANA), cand(FIRE_RESIST)]);

    it("does not enumerate: it stores base + candidates", () => {
        expect(o.kind).toBe("addOne");
        expect(o.candidates).toHaveLength(2);
        expect(armCount(o)).toBe(2);
    });

    it("arms() materializes on demand, each adding exactly one candidate", () => {
        const materialized = arms(o);
        expect(materialized).toHaveLength(2);
        // Every arm keeps the original Life prefix (additive) + one new mod.
        for (const arm of materialized) {
            expect([...arm.prefixes, ...arm.suffixes]).toContain(LIFE_T1);
            expect(arm.prefixes.length + arm.suffixes.length).toBe(2);
        }
    });

    it("floor = base's present set (added mod varies, so it is not guaranteed)", () => {
        expect(guaranteedPresent(o)).toEqual(new Set([LIFE_T1.type]));
        expect(guarantees(o, LIFE_T1.type)).toBe(true); // additive: Life survives
        expect(guarantees(o, INCREASED_MANA.type)).toBe(false); // only in one arm
    });

    it("possibility = base present ∪ every candidate type", () => {
        expect(possiblePresent(o)).toEqual(
            new Set([LIFE_T1.type, INCREASED_MANA.type, FIRE_RESIST.type]),
        );
        expect(mayHave(o, INCREASED_MANA.type)).toBe(true);
    });

    it("count ranges reflect which generation each candidate touches", () => {
        // base is 1 prefix / 0 suffix; candidates are one prefix + one suffix.
        expect(prefixCountRange(o)).toEqual([1, 2]); // +1 only in the prefix arm
        expect(suffixCountRange(o)).toEqual([0, 1]); // +1 only in the suffix arm
    });

    it("rarity is fixed by the (already-promoted) base", () => {
        expect(outcomeRarity(o)).toBe("rare");
    });
});

describe("addOne — all-prefix candidates pin the prefix count", () => {
    const base = mkItem({ rarity: "rare" });
    const o = addOne(base, [cand(LIFE_T1), cand(INCREASED_MANA)]); // both prefixes

    it("every arm adds a prefix, so prefixCount is exactly +1", () => {
        expect(prefixCountRange(o)).toEqual([1, 1]);
        expect(suffixCountRange(o)).toEqual([0, 0]);
    });
});

describe("removeOne — symbolic remove", () => {
    // Rare, 1 prefix (Life) + 2 suffixes (Fire, Cold). All removable.
    const base = mkItem({
        rarity: "rare",
        prefixes: [LIFE_T1],
        suffixes: [FIRE_RESIST, COLD_RESIST],
    });
    const o = removeOne(base, [LIFE_T1, FIRE_RESIST, COLD_RESIST]);

    it("stores base + removables, one arm each", () => {
        expect(armCount(o)).toBe(3);
        expect(arms(o).every((arm) => arm.prefixes.length + arm.suffixes.length === 2)).toBe(true);
    });

    it("floor excludes every removable type (each dies in one arm)", () => {
        // With everything removable, nothing is guaranteed to survive.
        expect(guaranteedPresent(o)).toEqual(new Set());
        expect(guarantees(o, LIFE_T1.type)).toBe(false);
    });

    it("possibility keeps every type when there are ≥2 removables", () => {
        expect(possiblePresent(o)).toEqual(
            new Set([LIFE_T1.type, FIRE_RESIST.type, COLD_RESIST.type]),
        );
    });
});

describe("removeOne — a sole removable is removed in the only arm", () => {
    const base = mkItem({ rarity: "rare", prefixes: [LIFE_T1], suffixes: [FIRE_RESIST] });
    // Only Life is removable (e.g. the suffix is protected).
    const o = removeOne(base, [LIFE_T1]);

    it("the sole removable type is neither guaranteed nor even possible", () => {
        expect(guarantees(o, LIFE_T1.type)).toBe(false);
        expect(mayHave(o, LIFE_T1.type)).toBe(false);
        // The untouched suffix, however, survives in the single arm.
        expect(guarantees(o, FIRE_RESIST.type)).toBe(true);
    });
});

describe("certain — the degenerate one-arm outcome", () => {
    const item = mkItem({ rarity: "rare", prefixes: [LIFE_T1, INCREASED_ARMOUR] });
    const o = certain(item);

    it("has one inhabited arm equal to the item", () => {
        expect(isInhabited(o)).toBe(true);
        expect(armCount(o)).toBe(1);
        expect(arms(o)).toEqual([item]);
        expect(guaranteedPresent(o)).toEqual(possiblePresent(o));
    });
});

describe("uninhabited outcomes", () => {
    it("an add with no candidates is not inhabited", () => {
        expect(isInhabited(addOne(mkItem({ rarity: "rare" }), []))).toBe(false);
    });
});
