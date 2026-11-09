import { describe, expect, it } from "vitest";
import { TypeId } from "../model/ids.js";
import { INCREASED_MANA, LIFE_T1 } from "../__fixtures__/mods.js";
import { keptDistribution, pickSide, type PooledSide } from "./recombine.js";

const named = (type: string, weight: number, exclusive = false) => ({
    type: TypeId(type),
    rows: [{ mod: type === "life" ? LIFE_T1 : INCREASED_MANA, weight: 1 }],
    weight,
    exclusive,
});

describe("the Recombinator's pick", () => {
    it("takes the named modifiers by weight, the unnamed at the side's average", () => {
        // One kept of life (300), mana (100) and one unnamed (200).
        const side: PooledSide = {
            named: [named("life", 300), named("mana", 100)],
            unnamed: 1,
            unnamedWeight: 200,
            keeps: new Map([[1, 1]]),
        };
        const picks = pickSide(side, false);
        const life = picks.find((p) => p.mask === 1)!;
        const mana = picks.find((p) => p.mask === 2)!;
        const other = picks.find((p) => p.mask === 0)!;
        expect(life.prob).toBeCloseTo(0.5, 9);
        expect(mana.prob).toBeCloseTo(1 / 6, 9);
        expect(other.prob).toBeCloseTo(1 / 3, 9);
        expect(other.count).toBe(1);
    });

    it("lets one exclusive modifier through and drops the rest, the slot lost", () => {
        // Two exclusive prefixes, two kept: only one can be on the result.
        const side: PooledSide = {
            named: [named("life", 100, true), named("mana", 100, true)],
            unnamed: 0,
            unnamedWeight: 1,
            keeps: new Map([[2, 1]]),
        };
        const picks = pickSide(side, false);
        expect(picks.every((p) => p.count === 1 && p.exclusive)).toBe(true);
        expect(picks.reduce((s, p) => s + p.prob, 0)).toBeCloseTo(1, 9);
        // With an exclusive already taken on the other side, neither is eligible.
        const blocked = pickSide(side, true);
        expect(blocked).toEqual([{ mask: 0, count: 0, exclusive: false, prob: 1 }]);
    });

    it("reads the page's count table, capped by the side", () => {
        expect([...keptDistribution(2, 3)]).toEqual([
            [1, 0.667],
            [2, 0.333],
        ]);
        expect([...keptDistribution(6, 3)]).toEqual([
            [2, 0.3],
            [3, 0.7],
        ]);
        expect(keptDistribution(9, 3).get(3)).toBe(0.7);
        expect([...keptDistribution(1, 3)]).toEqual([
            [0, 0.41],
            [1, 0.59],
        ]);
    });
});
