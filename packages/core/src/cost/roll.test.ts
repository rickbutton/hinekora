import { describe, expect, it } from "vitest";
import {
    CATALOG,
    FIRE_RES_TIERED,
    MAXLIFE_T1,
    MAXLIFE_T2,
    MAXLIFE_T3,
    PROTECT_PREFIXES_CARRIER,
    RING_BASE,
} from "../__fixtures__/mods.js";
import { craft, item, op } from "../__fixtures__/ast.js";
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
const protecting = buildRegistry({
    bases: [RING_BASE],
    mods: [...CATALOG, PROTECT_PREFIXES_CARRIER],
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

describe("a random removal's reach", () => {
    it("is limited to one side by a protecting metamod, not by a side that is empty", () => {
        // No prefixes now, but the Orb of Annulment reaches both sides: a loop
        // that exalts a prefix back on can annul it again.
        const open = craft(
            item({
                base: "Iron Ring",
                ilvl: 84,
                rarity: "rare",
                suffixes: ["FireResist1", "ColdResist1"],
            }),
            [],
        );
        const a = check(open, { registry }).finalState!;
        for (const reading of ["estimate", "floors", "ceilings"] as const) {
            const roll = rollOf(a, currencyOps("annul"), registry, reading);
            if (roll.kind !== "removal") throw new Error("not a removal");
            expect(roll.gen).toBeUndefined();
        }
        // "Prefixes Cannot Be Changed" leaves the suffixes alone in reach.
        const kept = craft(
            item({
                base: "Iron Ring",
                ilvl: 84,
                rarity: "rare",
                prefixes: ["IncreasedLife1"],
                suffixes: ["FireResist1", PROTECT_PREFIXES_CARRIER.id],
            }),
            [],
        );
        const b = check(kept, { registry: protecting }).finalState!;
        const roll = rollOf(b, currencyOps("annul"), protecting);
        if (roll.kind !== "removal") throw new Error("not a removal");
        expect(roll.gen).toBe("suffix");
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

describe("memory strands in the pool", () => {
    it("cull the lower tiers at the strands the item surely has, the ceiling under that reading", () => {
        const c = craft(item({ base: "Iron Ring", ilvl: 84, rarity: "rare", strands: 82 }), [
            op("chaos"),
            op("chaos"),
            op("chaos"),
        ]);
        // Three Chaos Orbs may have used every strand: the estimate reads none
        // left and both life tiers roll; the ceilings reading keeps the 82.
        const a = check(c, { registry }).finalState!;
        const rowsOf = (roll: ReturnType<typeof rollOf>): string[] => {
            if (roll.kind !== "draw") throw new Error("not a draw");
            const life = roll.variants[0]!.prefix.find((g) => g.type === "IncreasedLife");
            return (life?.rows ?? []).map((r) => r.mod.id).sort();
        };
        expect(rowsOf(rollOf(a, currencyOps("chaos"), registry))).toEqual([
            "IncreasedLife1",
            "IncreasedLife2",
        ]);
        expect(rowsOf(rollOf(a, currencyOps("chaos"), registry, "ceilings"))).toEqual([
            "IncreasedLife1",
        ]);
    });
});
