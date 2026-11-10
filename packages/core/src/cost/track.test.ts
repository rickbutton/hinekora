import { describe, expect, it } from "vitest";
import { check } from "../check/check.js";
import type { RPred } from "../check/astate.js";
import { buildRegistry } from "../resolve/registry.js";
import { craft, item, op } from "../__fixtures__/ast.js";
import {
    BOOTS_BASE,
    CATALOG,
    ELEVATED_BOOTS_PREFIX,
    ELEVATED_BOOTS_SUFFIX,
    HUNTER_BOOTS_PREFIX,
    HUNTER_BOOTS_SUFFIX,
    LIFE_T1,
    LIFE_T2,
    RING_BASE,
} from "../__fixtures__/mods.js";
import { ModId } from "../model/ids.js";
import { findMethod } from "../check/methods.js";
import { Tracker } from "./track.js";

// A third life tier, so the rows a condition naming the top one leaves
// together are more than one.
const LIFE_T3 = { ...LIFE_T2, id: ModId("IncreasedLife3"), minLevel: 1 };
const registry = buildRegistry({
    bases: [RING_BASE],
    mods: [...CATALOG, LIFE_T3],
    baseAliases: { "Iron Ring": "IronRing" },
});

describe("the tracked state", () => {
    it("a modifier held at a tier no condition names is not read back at a named one", () => {
        const c = craft(item({ base: "Iron Ring", ilvl: 84, rarity: "rare" }), [op("chaos")]);
        const after = check(c, { registry }).trace.at(-1)!.after!;
        const top: RPred = { kind: "has", type: LIFE_T1.type, gen: "prefix", tierMod: LIFE_T1.id };
        const tracker = new Tracker(registry, after, [after], [top], []);
        const i = tracker.index.get(LIFE_T1.type)!;
        const rest = tracker.classes[i]!.find((cl) => cl.members.length > 1)!;
        expect(rest).toBeDefined();
        const narrowed = tracker.narrow(after, {
            prefix: 1,
            suffix: 3,
            rows: tracker.atoms.map((_a, j) => (j === i ? rest.rep : null)),
        })!;
        expect(narrowed).not.toBeNull();
        expect(tracker.rowsOn(i, narrowed).map((r) => r.id)).toEqual([rest.rep]);
    });

    it("an item the checker settles is one state, its declared modifier at its row", () => {
        const c = craft(
            item({
                base: "Iron Ring",
                ilvl: 84,
                rarity: "rare",
                prefixes: ["IncreasedLife1"],
                suffixes: ["FireResist1", "ColdResist1"],
            }),
            [op("chaos")],
        );
        const first = check(c, { registry }).trace.at(-1)!.before;
        const tracker = new Tracker(registry, first, [first], [], []);
        const states = tracker.statesIn(first)!;
        expect(states).toHaveLength(1);
        const [only] = states;
        expect(only!.prob).toBeCloseTo(1, 12);
        expect(only!.state.prefix).toBe(1);
        expect(only!.state.suffix).toBe(2);
        expect(only!.state.rows[tracker.index.get(LIFE_T1.type)!]).toBe(LIFE_T1.id);
    });

    it("a reforge's outcomes from a state sum to one", () => {
        const c = craft(item({ base: "Iron Ring", ilvl: 84, rarity: "rare" }), [op("chaos")]);
        const entry = check(c, { registry }).trace.at(-1)!;
        const top: RPred = { kind: "has", type: LIFE_T1.type, gen: "prefix", tierMod: LIFE_T1.id };
        const tracker = new Tracker(registry, entry.before, [entry.after!], [top], []);
        const built = findMethod(["chaos"])!.build([], entry.before, registry);
        if ("refused" in built) throw new Error(built.refused);
        const next = tracker.transition(entry.before, built, "estimate")!;
        const [start] = tracker.statesIn(entry.before)!;
        const out = next(start!.state);
        expect(out.reduce((sum, o) => sum + o.prob, 0)).toBeCloseTo(1, 9);
        const lifeAt = tracker.index.get(LIFE_T1.type)!;
        const top1 = out
            .filter((o) => o.state.rows[lifeAt] === LIFE_T1.id)
            .reduce((sum, o) => sum + o.prob, 0);
        expect(top1).toBeGreaterThan(0);
        expect(top1).toBeLessThan(1);
        expect(tracker.misses).toBe(0);
    });

    it("an Orb of Dominance's random pick among the influenced modifiers is not taken as sure", () => {
        const boots = buildRegistry({
            bases: [BOOTS_BASE],
            mods: [
                ...CATALOG,
                HUNTER_BOOTS_PREFIX,
                HUNTER_BOOTS_SUFFIX,
                ELEVATED_BOOTS_PREFIX,
                ELEVATED_BOOTS_SUFFIX,
            ],
        });
        const c = craft(
            item({
                base: "Iron Greaves",
                ilvl: 100,
                rarity: "rare",
                // Both influenced modifiers on one side, so the counts after
                // are the same whichever goes.
                prefixes: [HUNTER_BOOTS_PREFIX.id, ELEVATED_BOOTS_PREFIX.id],
                suffixes: ["FireResist1"],
                influences: ["hunter"],
            }),
            [op("dominance")],
        );
        const entry = check(c, { registry: boots }).trace.at(-1)!;
        const tracker = new Tracker(boots, entry.before, [entry.before], [], []);
        const built = findMethod(["dominance"])!.build([], entry.before, boots);
        if ("refused" in built) throw new Error(built.refused);
        const [start] = tracker.statesIn(entry.before)!;
        const outx = tracker.transition(entry.before, built, "estimate")!(start!.state);
        console.log("DBGD", JSON.stringify(start), JSON.stringify(outx), tracker.types);
        expect(tracker.misses).toBe(1);
    });
});
