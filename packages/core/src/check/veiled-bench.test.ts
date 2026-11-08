import { describe, expect, it } from "vitest";
import { check, type CheckContext } from "./check.js";
import { buildRegistry } from "../resolve/registry.js";
import { bench, craft, item, unveil, veiled } from "../__fixtures__/ast.js";
import {
    BENCH_LIFE_ROW,
    CATALOG,
    CLASS_RING,
    PROTECT_SUFFIXES_CARRIER,
    RING_BASE,
    VEILED_CATALOG,
} from "../__fixtures__/mods.js";

// The guide's order is lock, veiled orb, bench a blocker, unveil: the blocker
// may replace the lock, a crafted modifier, and must leave the veiled one alone.
const registry = buildRegistry({
    bases: [RING_BASE],
    mods: [...CATALOG, ...VEILED_CATALOG, BENCH_LIFE_ROW, PROTECT_SUFFIXES_CARRIER],
    baseAliases: { "Iron Ring": "IronRing" },
    benchCrafts: [
        { mod: BENCH_LIFE_ROW.id, tier: 1, itemClasses: new Set([CLASS_RING]) },
        { mod: PROTECT_SUFFIXES_CARRIER.id, tier: 1, itemClasses: new Set([CLASS_RING]) },
    ],
});
const ctx: CheckContext = { registry };
const ring = () =>
    item({
        base: "Iron Ring",
        ilvl: 100,
        rarity: "rare",
        prefixes: ["IncreasedMana1"],
        suffixes: ["FireResist1", "ColdResist1", "LightningResist1"],
    });

describe("a bench craft between the veiled orb and the unveil", () => {
    it("replaces the lock and keeps the veiled modifier", () => {
        const c = craft(ring(), [
            bench("suffixes cannot be changed"),
            veiled("exalt"),
            bench("maximum life"),
            unveil(),
        ]);
        expect(check(c, ctx).diagnostics).toEqual([]);
    });
});
