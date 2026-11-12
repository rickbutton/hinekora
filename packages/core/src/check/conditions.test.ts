import { describe, expect, it, vi } from "vitest";
import {
    andp,
    call,
    cmp,
    corruptedP,
    craft,
    def,
    fracturedP,
    has,
    hasP,
    hasValue,
    iff,
    influencedP,
    isRarity,
    item,
    notp,
    orp,
    param,
    tierArg,
} from "../__fixtures__/ast.js";
import { RING_BASE, TAG_DEFAULT } from "../__fixtures__/mods.js";
import type { Cmp, Def, Pred } from "../ast/ast.js";
import { rollRange } from "./values.js";
import { collectDefs, type PredDefs } from "./defs.js";
import { ModId, TagId } from "../model/ids.js";
import { influenceKey, type InfluenceKey, NO_INFLUENCE } from "../model/marks.js";
import type { Mod } from "../model/mod.js";
import { resolvePred } from "./resolve-pred.js";
import { buildRegistry } from "../resolve/registry.js";
import { conditionOfPred, levelReasonsOn, narrowBy, readCondition } from "./conditions.js";
import { influenceTagsOfKey } from "./influence.js";
import { generateCatalog, modRow } from "./reference/catalog.js";
import { atCells, harnessStates, pickRows } from "./reference/harness.js";
import { cItem, cMod, refCtx } from "./reference/item.js";
import { listItems } from "./reference/listing.js";
import { holdsPred } from "./reference/pred.js";
import { rng, type Rng } from "./reference/rng.js";
import { diffSets, ItemSet } from "./reference/sets.js";
import { fromItems, narrow, type XItem } from "./state.js";
import { buildUniverse, type Universe } from "./universe.js";

// Each catalogue resolves every condition under every influence set and lists
// a few hundred states: slower than the default limit on a loaded machine.
vi.setConfig({ testTimeout: 60_000 });

const NO_PROCS = new Set<string>();
const defsOf = (defs: readonly Def[]): PredDefs => ({
    defs: collectDefs(defs, () => {}),
    procs: NO_PROCS,
});

/** A ring type whose rows roll under two influences: the Hunter's X1 and X2,
 *  the Shaper's XS at X1's level. */
const ringTag = (stem: string): TagId => TagId(`ring_${stem}`);
const influenceRow = (id: string, stem: string, minLevel: number, text: string): Mod =>
    modRow({
        id,
        type: "TypeX",
        gen: "prefix",
        minLevel,
        text,
        spawn: [
            { tag: ringTag(stem), weight: 500 },
            { tag: TAG_DEFAULT, weight: 0 },
        ],
    });
const X1 = influenceRow("X1", "basilisk", 1, "+(1-2) to Xstat");
const XS = influenceRow("XS", "shaper", 1, "+(3-4) to Xstat");
const X2 = influenceRow("X2", "basilisk", 50, "+(5-6) to Xstat");
const LIFE = modRow({ id: "Life1", type: "TypeLife", gen: "suffix", text: "+(7-8) to Life" });

describe("a condition read item by item", () => {
    const registry = buildRegistry({ bases: [RING_BASE], mods: [X1, XS, X2, LIFE] });
    const ctx = refCtx(registry, RING_BASE, 84);
    const t1 = has("xstat", 1);
    const u = buildUniverse(
        registry,
        RING_BASE,
        84,
        craft(item({ base: "IronRing", ilvl: 84, rarity: "rare" }), [iff(t1, [])]),
    );
    const at = (influences: InfluenceKey, row: Mod) =>
        cItem({ rarity: "rare", mods: [cMod(row.id, rollRange(row.text!)![0])], influences });
    const hunter = influenceKey(["hunter"]);
    const shaper = influenceKey(["shaper"]);
    const both = influenceKey(["hunter", "shaper"]);
    const items = [
        at(hunter, X2),
        at(shaper, X2),
        at(shaper, XS),
        at(both, XS),
        at(NO_INFLUENCE, X2),
    ];
    const state = fromItems(u, items)!;
    const defs = defsOf([]);

    it("reads a tier under the item's own influences", () => {
        // Hunter's tier 1 is X2, the Shaper's XS; both are tier 1 on an item of the two.
        const narrowed = narrowBy(state, t1, true, defs)!;
        expect(listItems(u, narrowed.dd, { lowest: true })).toEqual(
            ItemSet.of([at(hunter, X2), at(shaper, XS), at(both, XS)]),
        );
        expect(listItems(u, narrowBy(state, t1, false, defs)!.dd, { lowest: true }).keys()).toEqual(
            ItemSet.of([at(shaper, X2), at(NO_INFLUENCE, X2)]).keys(),
        );
        for (const x of items)
            expect(holdsPred(t1, x, ctx, defs)).toBe(
                narrowed.u.dd.contains(narrowed.dd, u.encode(x)),
            );
    });

    it("differs from one reading over the whole state", () => {
        // Read once under both influences together, tier 1 is X2 or XS on
        // every item.
        const once = resolvePred(
            t1,
            {
                base: RING_BASE,
                ilvl: 84,
                tags: influenceTagsOfKey(registry, RING_BASE, both),
                mayCarry: () => true,
            },
            { ...defs, registry, diag: () => {} },
        )!;
        expect(listItems(u, narrow(state, once.pred)!.dd).has(at(shaper, X2))).toBe(true);
        expect(listItems(u, narrowBy(state, t1, true, defs)!.dd).has(at(shaper, X2))).toBe(false);
    });

    it("reports a tier no influence set of the state reaches, in the first set's words", () => {
        const said: string[] = [];
        const bad = has("xstat", 4);
        expect(readCondition(state, bad, defs, (m) => said.push(m))).toBeNull();
        // The first set is the item with none, on which the modifier has no ladder.
        expect(said).toEqual(['tier 4 is out of range for "xstat" (it has 0 tiers on this base)']);
        expect(narrowBy(state, bad, true, defs)).toBeNull();
    });

    it("says nothing of a tier some influence set reaches, and the rest never hold it", () => {
        // Only the Hunter's ladder has a tier 2, X1.
        const t2 = has("xstat", 2);
        const said: string[] = [];
        expect(readCondition(state, t2, defs, (m) => said.push(m))).not.toBeNull();
        expect(said).toEqual([]);
        const s = fromItems(u, [at(hunter, X1), at(shaper, X1), at(both, X1)])!;
        expect(listItems(u, narrowBy(s, t2, true, defs)!.dd, { lowest: true })).toEqual(
            atCells(u, [at(hunter, X1), at(both, X1)]),
        );
    });

    it("reports a fault of the condition's structure once", () => {
        const said: string[] = [];
        expect(readCondition(state, call("nothing"), defs, (m) => said.push(m))).toBeNull();
        expect(said).toEqual(['unknown def "nothing"']);
        expect(conditionOfPred(u, call("nothing"), defs)).toBeNull();
    });

    it("says when the item's level is why a tier is never met", () => {
        const low = buildUniverse(registry, RING_BASE, 30, undefined);
        const s = fromItems(low, [
            cItem({ rarity: "rare", mods: [cMod(LIFE.id, 7)], influences: hunter }),
        ])!;
        const r = readCondition(s, has("xstat", 1), defs, () => {});
        expect(levelReasonsOn(s, r)).toBe(
            ' — Tier 1 "xstat" needs item level 50; this item is level 30',
        );
    });
});

// --- random conditions -------------------------------------------------------------------

const CMPS: readonly Cmp[] = ["==", "!=", "<", "<=", ">", ">="];

/** Names that resolve to a type of the universe: a row's id, and a natural
 *  row's stat word. */
function namesOf(u: Universe): string[] {
    const out = new Set<string>();
    for (const m of u.rows.keys()) {
        out.add(m.id);
        const word = /to ([A-Z][a-z]+)$/.exec(m.text ?? "")?.[1];
        if (word !== undefined && m.source === undefined) out.add(word.toLowerCase());
    }
    return [...out].sort();
}

const DEFS: readonly Def[] = [
    def("tierOrFractured", ["m", "t"], orp(hasP(param("m"), param("t")), fracturedP(param("m")))),
    def("atLeastSeven", ["m"], {
        kind: "has",
        mod: param("m"),
        value: { op: ">=", value: 7 },
        span: has("x").span,
    }),
    def(
        "fewPrefixes",
        ["n"],
        andp({ ...cmp("prefixCount", "<=", 0), value: param("n") }, notp(influencedP())),
    ),
];

function randomPred(r: Rng, names: readonly string[], depth = 2): Pred {
    const name = r.pick(names);
    const kinds = [
        "rarity",
        "has",
        "tier",
        "value",
        "group",
        "fractured",
        "influenced",
        "corrupted",
        "count",
        "call",
        ...(depth > 0 ? ["not", "and", "or"] : []),
    ] as const;
    switch (r.pick(kinds)) {
        case "rarity":
            return isRarity(r.pick(["normal", "magic", "rare"] as const));
        case "has":
            return has(name);
        case "tier":
            return has(name, r.int(1, 3));
        case "value":
            return hasValue(
                name,
                r.pick(CMPS),
                r.int(0, 20),
                r.chance(0.4) ? r.int(1, 2) : undefined,
            );
        case "group":
            return { ...has(name), group: true };
        case "fractured":
            return fracturedP(name);
        case "influenced":
            return influencedP(r.chance(0.5) ? r.pick(["hunter", "shaper"] as const) : undefined);
        case "corrupted":
            return corruptedP();
        case "count":
            return cmp(r.pick(["prefixCount", "suffixCount"] as const), r.pick(CMPS), r.int(0, 3));
        case "call": {
            const which = r.int(0, 2);
            return which === 0
                ? call("tierOrFractured", [name, tierArg(r.int(1, 2))])
                : which === 1
                  ? call("atLeastSeven", [name])
                  : call("fewPrefixes", [r.int(0, 2)]);
        }
        case "not":
            return notp(randomPred(r, names, depth - 1));
        case "and":
            return andp(randomPred(r, names, depth - 1), randomPred(r, names, depth - 1));
        case "or":
            return orp(randomPred(r, names, depth - 1), randomPred(r, names, depth - 1));
    }
    throw new Error("no such kind of condition");
}

/** Every condition on every state, narrowed both ways, against the reference. */
function expectExact(
    seed: number,
    options: Parameters<typeof generateCatalog>[1],
    include: string[],
) {
    const cat = generateCatalog(seed, options);
    const r = rng(seed);
    const plain = buildUniverse(cat.registry, cat.base, cat.ilvl, undefined);
    const preds = Array.from({ length: 12 }, () => randomPred(r, namesOf(plain)));
    const block = item({ base: "IronRing", ilvl: cat.ilvl, rarity: "rare" });
    const u = buildUniverse(
        cat.registry,
        cat.base,
        cat.ilvl,
        craft(
            block,
            preds.map((p) => iff(p, [])),
            DEFS,
        ),
    );
    const defs = defsOf(DEFS);
    const keys = [[], ["hunter"], ["shaper"], ["hunter", "shaper"]]
        .map((k) => influenceKey(k as ("hunter" | "shaper")[]))
        .filter((k) => u.influenceKeys.includes(k));
    const present = include.filter((id) => [...u.rows.keys()].some((m) => m.id === id));
    const states = harnessStates(u, cat.ctx, seed, {
        bounds: {
            rows: pickRows(u, seed, Math.max(4, present.length + 1), present.map(ModId)),
            influences: keys,
            fractured: true,
        },
        random: 6,
    });
    for (const p of preds) {
        for (const s of states) {
            const x: XItem = fromItems(u, s)!;
            for (const positive of [true, false]) {
                const exact = narrowBy(x, p, positive, defs);
                const listed =
                    exact === null ? ItemSet.empty : listItems(u, exact.dd, { lowest: true });
                const expected = atCells(
                    u,
                    s.filter((i) => holdsPred(p, i, cat.ctx, defs) === positive),
                );
                const d = diffSets(expected, listed);
                expect(
                    d,
                    `${JSON.stringify(p, (k, v: unknown) => (k === "span" ? undefined : v))} ${positive}`,
                ).toBe("");
            }
        }
    }
}

describe("a condition read exactly", () => {
    it("tiers names under each item's influences", () => {
        for (const seed of [3101, 3102, 3103]) {
            expectExact(seed, { types: 3, influence: true, elevated: true }, [
                "HunterA1",
                "ShaperA1",
                "HunterA2",
            ]);
        }
    });

    it("compares values, with tiers and in defs", () => {
        for (const seed of [3301, 3302]) {
            expectExact(seed, { types: 4, twoSided: true, unnumbered: true }, []);
        }
    });
});

// --- the tags a modifier adds -------------------------------------------------------------

describe("a condition beside a modifier that adds a tag", () => {
    const gate = TagId("gate");
    const A1 = modRow({
        id: "A1",
        type: "TypeA",
        gen: "suffix",
        text: "+(1-2) to Xstat and Ystat",
    });
    const B1 = modRow({
        id: "B1",
        type: "TypeB",
        gen: "suffix",
        text: "+(3-4) to Xstat",
        spawn: [
            { tag: gate, weight: 1000 },
            { tag: TAG_DEFAULT, weight: 0 },
        ],
    });
    const ADDER = modRow({
        id: "Adder1",
        type: "TypeAdder",
        gen: "prefix",
        text: "+(5-6) to Zstat",
        addsTags: ["gate"],
    });
    /** A row whose own added tag zeroes its weight. */
    const zeta = (id: string, minLevel: number, text: string): Mod =>
        modRow({
            id,
            type: "TypeZeta",
            gen: "prefix",
            minLevel,
            text,
            addsTags: ["selfzero"],
            spawn: [
                { tag: TagId("selfzero"), weight: 0 },
                { tag: TAG_DEFAULT, weight: 1000 },
            ],
        });
    const Z1 = zeta("Z1", 1, "+(1-2) to Zeta");
    const Z2 = zeta("Z2", 50, "+(3-4) to Zeta");
    const registry = buildRegistry({ bases: [RING_BASE], mods: [A1, B1, ADDER, Z1, Z2] });
    const ctx = refCtx(registry, RING_BASE, 84);
    const defs = defsOf([]);
    const rare = (...rows: Mod[]) =>
        cItem({ rarity: "rare", mods: rows.map((m) => cMod(m.id, rollRange(m.text!)![0])) });

    /** The condition narrowed both ways over the items, against the reference. */
    const expectAgrees = (preds: readonly Pred[], items: readonly ReturnType<typeof rare>[]) => {
        const block = item({ base: "IronRing", ilvl: 84, rarity: "rare" });
        const u = buildUniverse(
            registry,
            RING_BASE,
            84,
            craft(
                block,
                preds.map((p) => iff(p, [])),
            ),
        );
        const state = fromItems(u, items)!;
        for (const p of preds) {
            for (const positive of [true, false]) {
                const exact = narrowBy(state, p, positive, defs);
                const listed =
                    exact === null ? ItemSet.empty : listItems(u, exact.dd, { lowest: true });
                const expected = atCells(
                    u,
                    items.filter((x) => holdsPred(p, x, ctx, defs) === positive),
                );
                expect(diffSets(expected, listed)).toBe("");
            }
        }
    };

    it("reads a name as the base and the influences do, whatever the tag", () => {
        // B1 rolls only under the tag the adder adds; the name is A1's either way.
        expectAgrees(
            [has("xstat"), hasValue("xstat", ">=", 2), hasValue("xstat", "<", 4)],
            [rare(A1, ADDER), rare(B1, ADDER), rare(A1), rare(B1)],
        );
        const u = buildUniverse(registry, RING_BASE, 84, undefined);
        const s = fromItems(u, [rare(B1, ADDER)])!;
        expect(narrowBy(s, has("xstat"), true, defs)).toBeNull();
    });

    it("keeps the tier of a row whose own tag zeroes it", () => {
        expectAgrees([has("zeta", 1), has("zeta", 2)], [rare(Z2), rare(Z1), rare(A1)]);
        const u = buildUniverse(registry, RING_BASE, 84, undefined);
        expect(narrowBy(fromItems(u, [rare(Z2)])!, has("zeta", 1), true, defs)).not.toBeNull();
    });
});
