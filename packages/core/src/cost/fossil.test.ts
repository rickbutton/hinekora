import { describe, expect, it } from "vitest";
import { CATALOG, RING_BASE } from "../__fixtures__/mods.js";
import { craft, item } from "../__fixtures__/ast.js";
import { check } from "../check/check.js";
import { currencyOps, resonatorOps } from "../check/library.js";
import { generateCatalog } from "../check/reference/catalog.js";
import { harnessUniverse } from "../check/reference/harness.js";
import { cItem } from "../check/reference/item.js";
import { fromItems } from "../check/state.js";
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

    it("leave out a fossil's row the base's implicit bars while it is held", () => {
        // The test fossil adds a plain row and a fire one; a Glyphic-like
        // fossil instead lays one of them before the draws.
        const cat = generateCatalog(8600, { types: 3, fossil: true, implicit: "nonColdDamage" });
        const [plain, fire] = cat.fossilRows;
        expect([...fire!.implicitTags]).toEqual(["fire"]);
        const u = harnessUniverse(cat);
        const glyphic = { ...cat.fossil!, addedMods: [], corruptedEssenceChance: 100 };
        const added = resonatorOps({
            fossils: [cat.fossil!],
            added: cat.fossilRows,
            forced: [],
            corrupted: [],
        });
        const essence = resonatorOps({
            fossils: [glyphic],
            added: [],
            forced: [],
            corrupted: cat.fossilRows,
        });
        const draw = (held: boolean, ops: ReturnType<typeof resonatorOps>) => {
            const roll = rollOf(fromItems(u, [cItem({ baseImplicit: held })])!, ops, cat.registry);
            if (roll.kind !== "draw") throw new Error("not a draw");
            return roll.variants.map((v) => ({
                prob: v.prob,
                laid: v.present.map((p) => p.type),
                drawn: [...v.prefix, ...v.suffix].flatMap((g) => g.members.map((m) => m.type)),
            }));
        };
        for (const held of [true, false]) {
            const drawn = draw(held, added).flatMap((v) => v.drawn);
            expect([drawn.includes(plain!.type), drawn.includes(fire!.type)]).toEqual([
                true,
                !held,
            ]);
            const laid = draw(held, essence).map((v) => [v.prob, v.laid]);
            expect(laid).toEqual(
                held
                    ? [[1, [plain!.type]]]
                    : [
                          [0.5, [plain!.type]],
                          [0.5, [fire!.type]],
                      ],
            );
        }
    });

    it("are not read under a Tangled Fossil, whose two tags are picked at random", () => {
        const ops = resonator(fossil("Tangled Fossil", {}));
        expect(rollOf(blank, ops, registry).kind).toBe("none");
        expect(unmodelled(ops)).toMatch(/Tangled Fossil/);
        expect(unmodelled(currencyOps("chaos"))).toBeUndefined();
    });
});
