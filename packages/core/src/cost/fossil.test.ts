import { describe, expect, it } from "vitest";
import { CATALOG, RING_BASE } from "../__fixtures__/mods.js";
import { craft, item } from "../__fixtures__/ast.js";
import { check } from "../exact/check.js";
import { currencyOps, resonatorOps } from "../check/library.js";
import { TagId } from "../model/ids.js";
import type { FossilSpec } from "../model/sources.js";
import { buildRegistry } from "../resolve/registry.js";
import { rollOf, unmodelled } from "./roll.js";

const registry = buildRegistry({
    bases: [RING_BASE],
    mods: [...CATALOG],
    baseAliases: { "Iron Ring": "IronRing" },
});

const fossil = (name: string, weights: Record<string, number>): FossilSpec => ({
    id: name,
    name,
    blockedTags: new Set(),
    weights: new Map(Object.entries(weights).map(([tag, w]) => [TagId(tag), w])),
    addedMods: [],
    forcedMods: [],
    corruptedEssenceChance: 0,
    fractures: false,
    corrupts: false,
});

const blank = check(craft(item({ base: "Iron Ring", ilvl: 84, rarity: "normal" }), []), {
    registry,
}).finalState!;

const resonator = (...fossils: FossilSpec[]) =>
    resonatorOps({ fossils, added: [], forced: [], corrupted: [] });

/** Each row's weight under the fossils, by row id. */
function weights(...fossils: FossilSpec[]): Map<string, number> {
    const roll = rollOf(blank, resonator(...fossils), registry);
    if (roll.kind !== "draw") throw new Error("not a draw");
    const v = roll.variants[0]!;
    const rows = [...v.prefix, ...v.suffix].flatMap((g) => g.members.flatMap((m) => m.rows));
    return new Map(rows.map((r) => [r.mod.id, r.weight]));
}

describe("a resonator's weights", () => {
    const plain = weights();
    const row = "FireResist1";

    it("add two fossils' more multipliers", () => {
        const fire = fossil("Scorched Fossil", { fire: 1000 });
        const resistance = fossil("Resisting Fossil", { resistance: 1000 });
        expect(weights(fire).get(row)).toBeCloseTo(plain.get(row)! * 10, 9);
        expect(weights(fire, resistance).get(row)).toBeCloseTo(plain.get(row)! * 20, 9);
    });

    it("multiply a fewer multiplier into what the more ones leave", () => {
        // Ten times and a tenth is the plain weight, not ten and a tenth times.
        const fire = fossil("Scorched Fossil", { fire: 1000 });
        const fewer = fossil("Dull Fossil", { elemental: 10 });
        expect(weights(fire, fewer).get(row)).toBeCloseTo(plain.get(row)!, 9);
        expect(weights(fire, fewer).get("ColdResist1")).toBeCloseTo(
            plain.get("ColdResist1")! / 10,
            9,
        );
        // Both of one fossil's tags on a row: the more once, the fewer into it.
        const both = fossil("Aetheric Fossil", { fire: 1000, elemental: 15 });
        expect(weights(both).get(row)).toBeCloseTo(plain.get(row)! * 1.5, 9);
    });

    it("scale by required level under a Sanctified Fossil", () => {
        // A hundredth a level from forty: the life tiers require 60 and 30.
        const w = weights(fossil("Sanctified Fossil", {}));
        expect(w.get("IncreasedLife1")).toBeCloseTo(plain.get("IncreasedLife1")! * 1.2, 9);
        expect(w.get("IncreasedLife2")).toBeCloseTo(plain.get("IncreasedLife2")! * 0.9, 9);
    });

    it("are not read under a Tangled Fossil, whose two tags are picked at random", () => {
        const ops = resonator(fossil("Tangled Fossil", {}));
        expect(rollOf(blank, ops, registry).kind).toBe("none");
        expect(unmodelled(ops)).toMatch(/Tangled Fossil/);
        expect(unmodelled(currencyOps("chaos"))).toBeUndefined();
    });
});
