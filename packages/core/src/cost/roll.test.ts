import { describe, expect, it } from "vitest";
import { MAXLIFE_T1, MAXLIFE_T2, MAXLIFE_T3, FIRE_RES_TIERED } from "../__fixtures__/mods.js";
import { foulbornRows } from "./roll.js";

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
