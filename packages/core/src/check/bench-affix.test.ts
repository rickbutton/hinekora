import { describe, expect, it } from "vitest";
import { check, type CheckContext } from "../exact/check.js";
import * as v from "../exact/views.js";
import { guaranteedTypes } from "../exact/views.js";
import { ModId } from "../model/ids.js";
import type { Mod } from "../model/mod.js";
import { buildRegistry } from "../resolve/registry.js";
import { benchRemove, craft, has, iff, item, notp, op } from "../__fixtures__/ast.js";
import {
    BENCH_LIFE_ROW,
    CATALOG,
    CLASS_RING,
    COLD_RESIST,
    INCREASED_MANA,
    LIFE_T1,
    RING_BASE,
} from "../__fixtures__/mods.js";

// A `bench` affix in the item block is the bench's row: it counts toward the
// crafted limit, named or not.
const registry = buildRegistry({
    bases: [RING_BASE],
    mods: [...CATALOG, BENCH_LIFE_ROW],
    baseAliases: { "Iron Ring": "IronRing" },
    benchCrafts: [{ mod: BENCH_LIFE_ROW.id, tier: 1, itemClasses: new Set([CLASS_RING]) }],
});
const ctx: CheckContext = { registry };

describe("a bench affix in the item block", () => {
    it("named, is the bench's row and counts as crafted", () => {
        const c = craft(
            item({
                base: "Iron Ring",
                ilvl: 100,
                rarity: "rare",
                prefixes: [{ mod: "maximum life", tier: 1, bench: true }],
            }),
            [],
        );
        const r = check(c, ctx);
        expect(r.diagnostics).toEqual([]);
        expect(v.craftedCount(r.finalState!)).toEqual([1, 1]);
        expect(guaranteedTypes(r.finalState!).has(BENCH_LIFE_ROW.type)).toBe(true);
    });

    it("anonymous, is a crafted modifier the bench's removal can take", () => {
        const start = item({
            base: "Iron Ring",
            ilvl: 100,
            rarity: "rare",
            prefixes: [{ mod: "random", bench: true }],
            suffixes: ["FireResist1"],
        });
        const r = check(craft(start, [benchRemove()]), ctx);
        expect(r.diagnostics).toEqual([]);
        expect(v.counts(r.finalState!).total).toEqual([1, 1]);
        expect(v.craftedCount(r.finalState!)).toEqual([0, 0]);
        // A natural random prefix gives the removal nothing it is sure of.
        const natural = item({
            base: "Iron Ring",
            ilvl: 100,
            rarity: "rare",
            prefixes: ["random"],
            suffixes: ["FireResist1"],
        });
        expect(check(craft(natural, [benchRemove()]), ctx).diagnostics[0]!.message).toContain(
            "No crafted modifier is guaranteed",
        );
    });

    it("anonymous, may still be the bench's row after an add drew its type's natural rows", () => {
        // The crafted prefix may be the bench's life; an Exalted Orb may add a
        // natural life only where it is not, so a life that is neither natural
        // tier is the bench's and the innermost branch runs.
        const start = item({
            base: "Iron Ring",
            ilvl: 100,
            rarity: "rare",
            prefixes: [{ mod: "random", bench: true }],
        });
        const c = craft(start, [
            op("exalt"),
            iff(has("maximum life"), [
                iff(notp(has("maximum life", 1)), [iff(notp(has("maximum life", 2)), [])]),
            ]),
        ]);
        expect(check(c, ctx).diagnostics).toEqual([]);
    });

    it("anonymous, may still be the bench's row after an add that could draw one row only", () => {
        // The crafted prefix is the bench's life or the bench's mana. The one
        // natural life row the Exalted Orb can add is the top tier, and only
        // beside the mana, so a life that is not that tier is the bench's.
        const benchMana: Mod = {
            ...BENCH_LIFE_ROW,
            id: ModId("BenchMana1"),
            type: INCREASED_MANA.type,
            families: INCREASED_MANA.families,
        };
        const narrow = buildRegistry({
            bases: [RING_BASE],
            mods: [LIFE_T1, COLD_RESIST, BENCH_LIFE_ROW, benchMana],
            baseAliases: { "Iron Ring": "IronRing" },
            benchCrafts: [
                { mod: BENCH_LIFE_ROW.id, tier: 1, itemClasses: new Set([CLASS_RING]) },
                { mod: benchMana.id, tier: 1, itemClasses: new Set([CLASS_RING]) },
            ],
        });
        const start = item({
            base: "Iron Ring",
            ilvl: 100,
            rarity: "rare",
            prefixes: [{ mod: "random", bench: true }],
        });
        const c = craft(start, [
            op("exalt"),
            iff(has("maximum life"), [iff(notp(has("maximum life", 1)), [])]),
        ]);
        expect(check(c, { registry: narrow }).diagnostics).toEqual([]);
    });
});
