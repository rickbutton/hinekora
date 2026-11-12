import { describe, expect, it } from "vitest";
import type { Cmp } from "../ast/ast.js";
import {
    andp,
    call,
    craft,
    def,
    hasValue,
    iff,
    item,
    notp,
    op,
    param,
    procDef,
    until,
} from "../__fixtures__/ast.js";
import type { HasPred } from "../ast/ast.js";
import { TypeId } from "../model/ids.js";
import { type Cell, cellCompare, cellHas, cellsOf, cellValues } from "./cells.js";
import { comparisonsOf, craftImprints, thresholdsOf } from "./craft.js";
import { HAND_REGISTRY } from "./reference/hand.js";
import { RING_BASE } from "../__fixtures__/mods.js";
import { compare } from "./reference/conditions.js";
import { beast, restore } from "../__fixtures__/ast.js";
import { buildUniverse } from "./universe.js";

const OPS: readonly Cmp[] = ["==", "!=", "<", "<=", ">", ">="];

const span = (cells: readonly Cell[]): [number, number][] => cells.map((c) => [c.lo, c.hi]);

/** Every comparison against every threshold is constant on each cell, by brute
 *  force over the whole values (or a fine grid for a span of fractions). */
function expectConstant(cells: readonly Cell[], thresholds: readonly number[]): void {
    for (const cell of cells) {
        const values = cell.whole
            ? cellValues(cell)
            : Array.from(
                  { length: 401 },
                  (_, i) => cell.lo + ((cell.hi - cell.lo) * i) / 400,
              ).filter((v) => cellHas(cell, v));
        expect(values.length).toBeGreaterThan(0);
        for (const t of thresholds) {
            for (const o of OPS) {
                const answers = new Set(values.map((v) => compare(v, o, t)));
                expect(answers.size).toBe(1);
                expect(cellCompare(cell, o, t)).toBe([...answers][0]);
            }
        }
    }
}

describe("value cells", () => {
    it("cut a whole span where some comparison changes its answer", () => {
        expect(span(cellsOf([10, 20], []))).toEqual([[10, 20]]);
        expect(span(cellsOf([10, 20], [15]))).toEqual([
            [10, 14],
            [15, 15],
            [16, 20],
        ]);
        expect(span(cellsOf([10, 20], [10, 20]))).toEqual([
            [10, 10],
            [11, 19],
            [20, 20],
        ]);
        expect(span(cellsOf([10, 20], [12.5, 30, 1]))).toEqual([
            [10, 12],
            [13, 20],
        ]);
        for (const ts of [[], [15], [10, 20], [12.5, 30, 1], [11, 12, 13, 19.5]]) {
            expectConstant(cellsOf([10, 20], ts), ts);
        }
    });

    it("cut a span of fractions into points and open intervals", () => {
        const cells = cellsOf([0.2, 0.4], [0.3]);
        expect(cells.map((c) => [c.lo, c.hi, c.loOpen, c.hiOpen])).toEqual([
            [0.2, 0.3, false, true],
            [0.3, 0.3, false, false],
            [0.3, 0.4, true, false],
        ]);
        expectConstant(cells, [0.3]);
        expectConstant(cellsOf([0.2, 0.4], [0.2, 0.4, 1]), [0.2, 0.4, 1]);
        expect(() => cellValues(cells[0]!)).toThrow(/fractions/);
    });

    it("cover the span exactly once", () => {
        for (const ts of [[], [3], [1, 9], [2.5, 7]]) {
            const cells = cellsOf([1, 9], ts);
            const values = cells.flatMap(cellValues);
            expect(values).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
        }
    });
});

describe("what the universe reads of a craft", () => {
    const ring = item({ base: "IronRing", ilvl: 84, rarity: "rare" });

    it("collects each compared modifier's thresholds", () => {
        const c = craft(ring, [
            until(hasValue("maximum life", ">=", 11), [op("chaos")]),
            iff(andp(notp(hasValue("fire resistance", "<", 9)), hasValue("Life2", "==", 21)), [
                op("exalt"),
            ]),
        ]);
        const cmp = comparisonsOf(c, HAND_REGISTRY, RING_BASE, 84);
        expect(thresholdsOf(cmp, TypeId("TypeLife"))).toEqual([11, 21]);
        expect(thresholdsOf(cmp, TypeId("TypeFire"))).toEqual([9]);
        expect(thresholdsOf(cmp, TypeId("TypeMana"))).toEqual([]);
        expect(cmp.everyType.size).toBe(0);

        const u = buildUniverse(HAND_REGISTRY, RING_BASE, 84, c);
        const life = u.modSlot(u.slotOfType(TypeId("TypeLife"))!)!;
        expect(life.compared).toBe(true);
        const cellsOfRow = (id: string): [number, number][] => [
            ...new Map(
                life.values
                    .filter((v) => v?.row.id === id)
                    .map((v) => [`${v!.cell!.lo}`, [v!.cell!.lo, v!.cell!.hi] as [number, number]]),
            ).values(),
        ];
        expect(cellsOfRow("Life1")).toEqual([
            [10, 10],
            [11, 11],
            [12, 12],
        ]);
        expect(cellsOfRow("Life2")).toEqual([
            [20, 20],
            [21, 21],
        ]);
        // An uncompared type keeps one cell per row.
        const mana = u.modSlot(u.slotOfType(TypeId("TypeMana"))!)!;
        expect(mana.compared).toBe(false);
        expect(
            mana.values.flatMap((v) => (v?.cell === undefined ? [] : [[v.cell.lo, v.cell.hi]])),
        ).toContainEqual([5, 6]);
        for (const s of u.modSlots()) {
            const slot = u.modSlot(s)!;
            const ts = thresholdsOf(cmp, slot.type);
            expectConstant(
                slot.values.flatMap((v) => (v?.cell === undefined ? [] : [v.cell])),
                ts,
            );
        }
    });

    it("reads a comparison through a def parameter as one of every modifier", () => {
        const byParam: HasPred = { ...hasValue("x", ">", 7), mod: param("m") };
        const c = craft(
            ring,
            [iff(call("big", ["maximum mana", 3]), [op("exalt")])],
            [def("big", ["m"], byParam)],
            [procDef("p", [], [iff(hasValue("cold resistance", "<=", 8), [])])],
        );
        const cmp = comparisonsOf(c, HAND_REGISTRY, RING_BASE, 84);
        expect([...cmp.everyType]).toEqual([7]);
        expect(thresholdsOf(cmp, TypeId("TypeCold"))).toEqual([7, 8]);
        expect(thresholdsOf(cmp, TypeId("TypeMana"))).toEqual([7]);
    });

    it("knows a craft that can hold an imprint", () => {
        expect(craftImprints(craft(ring, [op("chaos")]))).toBe(false);
        expect(craftImprints(craft(ring, [iff(hasValue("Life1", ">", 1), [restore()])]))).toBe(
            true,
        );
        expect(
            craftImprints(craft(ring, [], [], [procDef("p", [], [beast({ kind: "imprint" })])])),
        ).toBe(true);
    });
});
