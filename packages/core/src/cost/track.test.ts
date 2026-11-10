import { describe, expect, it } from "vitest";
import { check } from "../check/check.js";
import type { RPred } from "../check/astate.js";
import { buildRegistry } from "../resolve/registry.js";
import { craft, has, iff, item, op, stop } from "../__fixtures__/ast.js";
import {
    BOOTS_BASE,
    CATALOG,
    ELEVATED_BOOTS_PREFIX,
    ELEVATED_BOOTS_SUFFIX,
    HUNTER_BOOTS_PREFIX,
    HUNTER_BOOTS_SUFFIX,
    FIRE_RESIST,
    LIFE_T1,
    LIFE_T2,
    RING_BASE,
} from "../__fixtures__/mods.js";
import { GroupId, ModId, TypeId } from "../model/ids.js";
import type { Mod } from "../model/mod.js";
import { costOf } from "./report.js";
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
        tracker.transition(entry.before, built, "estimate")!(start!.state);
        expect(tracker.misses).toBe(1);
    });
});

describe("the average group an unnamed modifier closes", () => {
    // Five prefix groups no condition names, of very different weights, beside
    // the named life; three suffix groups. A Rare holding two random prefixes
    // and one suffix takes an Exalted Orb.
    const row = (base: Mod, id: string, weight: number): Mod => ({
        ...base,
        id: ModId(id),
        type: TypeId(id),
        families: new Set([GroupId(id)]),
        spawn: [{ tag: base.spawn[0]!.tag, weight }],
        implicitTags: new Set(),
    });
    const prefixes = [100, 300, 600, 1500, 3000].map((w, i) => row(LIFE_T1, `P${i}`, w));
    const suffixes = [800, 400, 200].map((w, i) => row(FIRE_RESIST, `S${i}`, w));
    const life = { ...LIFE_T1, minLevel: 1 };
    const reg = buildRegistry({
        bases: [RING_BASE],
        mods: [life, ...prefixes, ...suffixes],
        baseAliases: { "Iron Ring": "IronRing" },
    });
    const weight = (m: Mod): number => m.spawn[0]!.weight;

    it("is within two and a half per cent of drawing which groups they close", () => {
        const c = craft(
            item({
                base: "Iron Ring",
                ilvl: 84,
                rarity: "rare",
                prefixes: ["random", "random"],
                suffixes: ["S0"],
            }),
            [op("exalt"), iff(has("IncreasedLife1"), [stop()])],
        );
        const walked = costOf(c, check(c, { registry: reg }), reg).steps.find(
            (s) => s.kind === "if",
        )!.branch!;

        // Exactly: the two random prefixes are two draws by weight without
        // replacement among the prefix groups (Q75), the life's among them; the
        // exalt then draws from every group still open on either side.
        const groups = [life, ...prefixes];
        const total = groups.reduce((sum, g) => sum + weight(g), 0);
        const suffixOpen = suffixes.slice(1).reduce((sum, g) => sum + weight(g), 0);
        let exact = 0;
        for (const a of groups) {
            for (const b of groups) {
                if (a === b) continue;
                const pair = (weight(a) / total) * (weight(b) / (total - weight(a)));
                if (a === life || b === life) {
                    exact += pair;
                    continue;
                }
                const open = total - weight(a) - weight(b) + suffixOpen;
                exact += pair * (weight(life) / open);
            }
        }
        // Measured at +1.9%; a group of average weight was -12% here, since
        // the heavy groups are the likely ones.
        expect(Math.abs(walked - exact) / exact).toBeLessThan(0.025);
    });
});
