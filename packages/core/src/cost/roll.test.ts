import { describe, expect, it } from "vitest";
import {
    CATALOG,
    FIRE_RES_TIERED,
    MAXLIFE_T1,
    MAXLIFE_T2,
    MAXLIFE_T3,
    RING_BASE,
} from "../__fixtures__/mods.js";
import { craft, item } from "../__fixtures__/ast.js";
import { check } from "../check/check.js";
import { currencyOps, harvestLikelyOps } from "../check/library.js";
import { buildRegistry } from "../resolve/registry.js";
import { foulbornRows, rollOf } from "./roll.js";

const registry = buildRegistry({
    bases: [RING_BASE],
    mods: [...CATALOG],
    modAliases: { "T1 Life": "IncreasedLife1" },
    baseAliases: { "Iron Ring": "IronRing" },
});

/** The group weight of a type on the prefix side of a draw's single variant. */
function prefixWeight(roll: ReturnType<typeof rollOf>, type: string): number {
    if (roll.kind !== "draw") throw new Error("not a draw");
    return roll.variants[0]!.prefix.find((g) => g.type === type)?.weight ?? 0;
}

describe("the grove's more and less likely reforges", () => {
    it("tilt the rows sharing a harvest type with the item's modifiers by ten", () => {
        const c = craft(
            item({ base: "Iron Ring", ilvl: 84, rarity: "rare", prefixes: ["T1 Life"] }),
            [],
        );
        const a = check(c, { registry }).finalState!;
        const plain = prefixWeight(rollOf(a, currencyOps("chaos"), registry), "IncreasedLife");
        const more = prefixWeight(rollOf(a, harvestLikelyOps("more"), registry), "IncreasedLife");
        const less = prefixWeight(rollOf(a, harvestLikelyOps("less"), registry), "IncreasedLife");
        expect(plain).toBeGreaterThan(0);
        expect(more).toBeCloseTo(plain * 10, 9);
        expect(less).toBeCloseTo(plain / 10, 9);
        // A row of another type is left alone.
        const mana = (r: ReturnType<typeof rollOf>) => prefixWeight(r, "IncreasedMana");
        expect(mana(rollOf(a, harvestLikelyOps("more"), registry))).toBe(
            mana(rollOf(a, currencyOps("chaos"), registry)),
        );
    });
});

describe("the Foulborn cull", () => {
    it("keeps a type's top tiers at the weight of all of them", () => {
        // Three life tiers at 800/400/200: the top two stay, scaled by 3/2 so
        // the type's share against a one-tier type is unchanged.
        const rows = [
            { mod: MAXLIFE_T3, weight: 800 },
            { mod: MAXLIFE_T2, weight: 400 },
            { mod: MAXLIFE_T1, weight: 200 },
            { mod: FIRE_RES_TIERED, weight: 500 },
        ];
        const kept = foulbornRows(rows);
        const life = kept.filter((r) => r.mod.type === MAXLIFE_T1.type);
        expect(life.map((r) => r.mod.id)).toEqual([MAXLIFE_T1.id, MAXLIFE_T2.id]);
        expect(life.reduce((s, r) => s + r.weight, 0)).toBeCloseTo((200 + 400) * 1.5, 9);
        expect(kept.find((r) => r.mod.id === FIRE_RES_TIERED.id)?.weight).toBe(500);
    });
});
