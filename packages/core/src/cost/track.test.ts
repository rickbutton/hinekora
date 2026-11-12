import { describe, expect, it } from "vitest";
import { check } from "../exact/check.js";
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
import { methodItemOf } from "../exact/build.js";
import type { ChainState } from "./chain.js";
import { pruned, Tracker } from "./track.js";

// A third life tier, so the rows a condition naming the top one leaves
// together are more than one.
const LIFE_T3 = { ...LIFE_T2, id: ModId("IncreasedLife3"), minLevel: 1 };
const registry = buildRegistry({
    bases: [RING_BASE],
    mods: [...CATALOG, LIFE_T3],
    baseAliases: { "Iron Ring": "IronRing" },
});

describe("the tracked state", () => {
    it("a method whose every outcome ends the craft ends it", () => {
        const c = craft(item({ base: "Iron Ring", ilvl: 84, rarity: "rare" }), []);
        const before = check(c, { registry }).finalState!;
        const tracker = new Tracker(registry, before, [before], [], []);
        const ends = tracker.transition(
            before,
            [{ kind: "either", branches: [[{ kind: "end" }], [{ kind: "end" }]] }],
            "estimate",
        )!;
        const state = { prefix: 0, suffix: 0, rows: tracker.atoms.map(() => null) };
        expect(ends(state)).toEqual([{ state, prob: 1, ends: true }]);
        expect(tracker.misses).toBe(0);
    });

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
        const built = findMethod(["chaos"])!.build([], methodItemOf(entry.before), registry);
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

    it("a modifier no condition names that the catalogue makes one type is closed for certain", () => {
        // Mana and fire resistance, and a prefix no one names: with life
        // absent, the catalogue's one other prefix, the armour. An Exalted Orb
        // then draws among life (5000 over its three tiers), cold and
        // lightning resistance (500 each): life five times in six. Read as
        // any prefix, the armour's group would stay open to the side split.
        const c = craft(
            item({
                base: "Iron Ring",
                ilvl: 84,
                rarity: "rare",
                prefixes: ["IncreasedMana1", "random"],
                suffixes: ["FireResist1"],
            }),
            [op("exalt")],
        );
        const entry = check(c, { registry }).trace.at(-1)!;
        const life: RPred = { kind: "has", type: LIFE_T1.type, gen: "prefix" };
        const tracker = new Tracker(registry, entry.before, [entry.before], [life], []);
        const built = findMethod(["exalt"])!.build([], methodItemOf(entry.before), registry);
        if ("refused" in built) throw new Error(built.refused);
        const at = tracker.index.get(LIFE_T1.type)!;
        const start: ChainState = {
            prefix: 2,
            suffix: 1,
            rows: tracker.atoms.map((_a, i) => (i === at ? null : tracker.atoms[i]!.rows[0]!.id)),
        };
        const out = tracker.transition(entry.before, built, "estimate")!(start);
        const drawn = out
            .filter((o) => o.state.rows[at] !== null)
            .reduce((sum, o) => sum + o.prob, 0);
        expect(drawn).toBeCloseTo(5 / 6, 12);
    });

    it("an Orb of Dominance that elevates a modifier into a type of its own leaves that type in its place", () => {
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
        // An elevated row shares its family with the row it was made of, so an
        // item holds one of the two.
        const c = craft(
            item({
                base: "Iron Greaves",
                ilvl: 100,
                rarity: "rare",
                prefixes: [HUNTER_BOOTS_PREFIX.id],
                suffixes: [HUNTER_BOOTS_SUFFIX.id, "FireResist1"],
                influences: ["hunter"],
            }),
            [op("dominance")],
        );
        const entry = check(c, { registry: boots }).trace.at(-1)!;
        const tracker = new Tracker(boots, entry.before, [entry.before, entry.after!], [], []);
        const built = findMethod(["dominance"])!.build([], methodItemOf(entry.before), boots);
        if ("refused" in built) throw new Error(built.refused);
        const [start] = tracker.statesIn(entry.before)!;
        const out = tracker.transition(entry.before, built, "estimate")!(start!.state);
        // One influenced modifier goes and the other is elevated, each alike:
        // the suffix into a row of its own type, the prefix into a type of its
        // own, which takes the prefix's place.
        const prefixAt = tracker.index.get(HUNTER_BOOTS_PREFIX.type)!;
        const suffixAt = tracker.index.get(HUNTER_BOOTS_SUFFIX.type)!;
        const elevatedAt = tracker.index.get(ELEVATED_BOOTS_PREFIX.type)!;
        expect(tracker.misses).toBe(0);
        expect(out).toHaveLength(2);
        const suffixUp = out.find((o) => o.state.prefix === 0)!;
        expect(suffixUp.prob).toBeCloseTo(0.5, 12);
        expect(suffixUp.state.rows[prefixAt]).toBeNull();
        // No condition names a tier, so the elevated row is in its type's one class.
        expect(suffixUp.state.rows[suffixAt]).toBe(
            tracker.classesOf(suffixAt, ELEVATED_BOOTS_SUFFIX.id)[0]!.id,
        );
        const prefixUp = out.find((o) => o.state.prefix === 1)!;
        expect(prefixUp.prob).toBeCloseTo(0.5, 12);
        expect(prefixUp.state.suffix).toBe(1);
        expect(prefixUp.state.rows[prefixAt]).toBeNull();
        expect(prefixUp.state.rows[elevatedAt]).toBe(ELEVATED_BOOTS_PREFIX.id);
    });
});

describe("a step's outcomes", () => {
    const at = (prefix: number): ChainState => ({ prefix, suffix: 0, rows: [] });

    it("drop the specks of mass no draw could give, and sum to one again", () => {
        const out = pruned([
            { state: at(1), prob: 0.75 },
            { state: at(2), prob: 0.25 - 1e-14 },
            { state: at(3), prob: 1e-14 },
        ]);
        expect(out.map((o) => o.state.prefix)).toEqual([1, 2]);
        expect(out.reduce((sum, o) => sum + o.prob, 0)).toBeCloseTo(1, 15);
        // Nothing to drop: the outcomes come back as they were.
        const whole = [{ state: at(1), prob: 1 }];
        expect(pruned(whole)).toBe(whole);
    });

    it("count a state the item at the step cannot be as one the step could not follow", () => {
        // The check's item holds the life for certain; a state without it has
        // no item to be read on.
        const c = craft(
            item({ base: "Iron Ring", ilvl: 84, rarity: "rare", prefixes: ["IncreasedLife1"] }),
            [op("annul")],
        );
        const entry = check(c, { registry }).trace.at(-1)!;
        const tracker = new Tracker(registry, entry.before, [entry.before], [], []);
        const built = findMethod(["annul"])!.build([], methodItemOf(entry.before), registry);
        if ("refused" in built) throw new Error(built.refused);
        const next = tracker.transition(entry.before, built, "estimate")!;
        const [start] = tracker.statesIn(entry.before)!;
        const absent: ChainState = {
            ...start!.state,
            prefix: 0,
            rows: start!.state.rows.map(() => null),
        };
        expect(next(absent)).toEqual([{ state: absent, prob: 1 }]);
        expect(tracker.misses).toBe(1);
        next(start!.state);
        expect(tracker.misses).toBe(1);
    });
});

describe("the groups an unnamed modifier closes", () => {
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
        // replacement among the prefix groups, the life's among them; the
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
