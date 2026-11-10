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
import { GroupId, ModId, TagId, TypeId } from "../model/ids.js";
import type { Mod } from "../model/mod.js";

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

/** A bench row that is the craftable version of a veiled modifier. */
const CRAFTED_VEILED: Mod = {
    ...BENCH_LIFE_ROW,
    id: ModId("JunMasterRecoup1"),
    type: TypeId("VeiledRecoupCrafted"),
    families: new Set([GroupId("Recoup")]),
    implicitTags: new Set([TagId("unveiled_mod"), TagId("life")]),
    text: "(7-8)% of Damage taken Recouped as Life",
};
const withCraftable = buildRegistry({
    bases: [RING_BASE],
    mods: [...CATALOG, ...VEILED_CATALOG, BENCH_LIFE_ROW, CRAFTED_VEILED],
    baseAliases: { "Iron Ring": "IronRing" },
    benchCrafts: [
        { mod: BENCH_LIFE_ROW.id, tier: 1, itemClasses: new Set([CLASS_RING]) },
        { mod: CRAFTED_VEILED.id, tier: 1, itemClasses: new Set([CLASS_RING]) },
    ],
});
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

describe("a bench-crafted version of a veiled modifier", () => {
    const run = (steps: Parameters<typeof craft>[1]) =>
        check(craft(ring(), steps), { registry: withCraftable }).diagnostics.map((d) => d.message);

    it("keeps a Veiled Exalted Orb off the item", () => {
        expect(run([bench("damage taken recouped as life"), veiled("exalt")])).toEqual([
            expect.stringContaining("veiled or unveiled modifier"),
        ]);
    });

    it("so does a declared bench affix that may be one", () => {
        const bought = item({
            base: "Iron Ring",
            ilvl: 100,
            rarity: "rare",
            prefixes: [{ mod: "random", bench: true }],
            suffixes: ["random"],
        });
        const messages = check(craft(bought, [veiled("exalt")]), {
            registry: withCraftable,
        }).diagnostics.map((d) => d.message);
        expect(messages).toEqual([expect.stringContaining("veiled or unveiled modifier")]);
    });

    it("an ordinary bench craft does not", () => {
        expect(run([bench("maximum life"), veiled("exalt")])).toEqual([]);
    });

    it("a Veiled Chaos Orb reforges it away", () => {
        expect(run([bench("damage taken recouped as life"), veiled("chaos")])).toEqual([]);
    });
});
