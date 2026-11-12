import { describe, expect, it } from "vitest";
import * as L from "../../check/library.js";
import { rollRange } from "../../check/values.js";
import type { Check, InfluenceChange, Op, Transform } from "../../check/ops.js";
import { ASTROLABE_BASE, FLASK_BASE } from "../../__fixtures__/mods.js";
import type { Base } from "../../model/base.js";
import type { EldritchImplicitSpec } from "../../model/sources.js";
import { buildRegistry } from "../../resolve/registry.js";
import { ModId, type Rarity, TagId } from "../../model/ids.js";
import {
    type EldritchSide,
    INFLUENCES,
    type InfluenceKey,
    influenceKey,
    NO_INFLUENCE,
} from "../../model/marks.js";
import { runMethod } from "../method.js";
import { InternalError } from "./handler.js";
import { type BaseKind, type Catalog, generateCatalog } from "../reference/catalog.js";
import {
    compareMethodOn,
    harnessStates,
    harnessUniverse,
    pickRows,
    someInfluences,
} from "../reference/harness.js";
import { type CEldritch, type CItem, cItem, cMod, NO_IMPLICIT, refCtx } from "../reference/item.js";
import { listItems } from "../reference/listing.js";
import { refRunMethod } from "../reference/method.js";
import { violations } from "../reference/wellformed.js";
import type { Mod } from "../../model/mod.js";
import type { Bounds } from "../reference/sets.js";
import { ItemSet } from "../reference/sets.js";
import { fromItems } from "../state.js";
import type { Universe } from "../universe.js";

const req = (check: Check): Op => ({ kind: "require", check });
const rarity = (r: Rarity | "survivors" | "lowest"): Transform => ({ kind: "rarity", rarity: r });
const influence = (change: InfluenceChange): Transform => ({ kind: "influence", change });
const corrupt: Transform = { kind: "corrupt" };
const replaced = (count: 1 | 2): Transform => ({
    kind: "eldritch",
    change: { kind: "replaced", count },
});
const conflict: Transform = { kind: "eldritch", change: { kind: "conflict" } };
const either = (...branches: Transform[][]): Op => ({ kind: "either", branches });
const hunter = influenceKey(["hunter"]);

interface Setup {
    readonly cat: Catalog;
    readonly u: Universe;
    readonly rows: ModId[];
}

function setup(
    seed: number,
    base: BaseKind,
    flags: { influence?: boolean; eldritch?: boolean; ilvl?: number },
    types = 4,
    rows = 3,
): Setup {
    return withCatalog(generateCatalog(seed, { base, types, ...flags }), seed, rows);
}

function withCatalog(cat: Catalog, seed: number, rows = 3): Setup {
    const u = harnessUniverse(cat);
    return { cat, u, rows: pickRows(u, seed, rows, cat.influence ? [cat.influence.id] : []) };
}

/** The catalogue's rows on another base, or with other eldritch implicits. */
function rebuilt(cat: Catalog, base: Base, eldritch = cat.eldritch): Catalog {
    const registry = buildRegistry({ bases: [base], mods: cat.mods, eldritch });
    return { ...cat, registry, base, eldritch, ctx: refCtx(registry, base, cat.ilvl) };
}

/** A boots catalogue with two named implicits on each side, the first seed from
 *  `seed` that draws them. */
function twoTypesASide(seed: number): Catalog {
    for (let k = seed; ; k++) {
        const cat = generateCatalog(k, { base: "boots", types: 3, eldritch: true });
        const named = (side: EldritchSide) =>
            new Set(cat.eldritch.filter((e) => e.side === side).map((e) => e.type)).size;
        if (named("exarch") === 2 && named("eater") === 2) return cat;
    }
}

/** Every implicit of the side at every tier, and none. */
function everyImplicit(cat: Catalog, side: EldritchSide): CEldritch[] {
    return [
        NO_IMPLICIT,
        ...cat.eldritch.filter((e) => e.side === side).map((e) => ({ tier: e.tier, type: e.type })),
    ];
}

/** Lesser, Exceptional and Perfect of the side's first implicit, and none. */
function implicits(s: Setup, side: EldritchSide, top = 6): CEldritch[] {
    const type = s.cat.eldritch.find((e) => e.side === side)?.type;
    if (type === undefined) return [NO_IMPLICIT];
    return [NO_IMPLICIT, ...[1, 4, 6].filter((t) => t <= top).map((tier) => ({ tier, type }))];
}

function exact(s: Setup, seed: number, bounds: Omit<Bounds, "rows">, ops: readonly Op[]): void {
    const states = harnessStates(s.u, s.cat.ctx, seed, {
        bounds: { rows: s.rows, ...bounds },
        random: 12,
        maxSize: 30,
    });
    const d = compareMethodOn(s.u, s.cat.ctx, states, ops);
    expect(d, d).toBe("");
}

const CHECKS: readonly Check[] = [
    { kind: "rarity", rarity: "magic" },
    { kind: "notMagic" },
    { kind: "notNormal" },
    { kind: "canBeRare" },
    { kind: "notCorrupted" },
    { kind: "corruptedItem", what: "A Tainted Orb" },
    { kind: "noInfluence", what: "An orb" },
    { kind: "influenced", what: "The grove" },
    { kind: "influenced", what: "The Bestiary", influence: "hunter" },
    { kind: "influenceable", influence: "hunter", what: "An orb" },
    { kind: "noEldritch", what: "An orb" },
    { kind: "dominant", side: "exarch", what: "An Eldritch Chaos Orb" },
    { kind: "dominant", side: "eater", what: "An Eldritch Exalted Orb" },
    { kind: "bothEldritch" },
    { kind: "baseHasTag", tag: TagId("boots"), what: "boots" },
    { kind: "baseHasAnyTag", tags: [TagId("ring"), TagId("amulet")], what: "jewellery" },
    { kind: "minItemLevel", level: 75, what: "An Eldritch Ember" },
];

describe("the marks over tiny catalogues", () => {
    const configs: readonly [BaseKind, { influence?: boolean; eldritch?: boolean }][] = [
        ["ring", { influence: true }],
        ["boots", { influence: true, eldritch: true }],
        ["amulet", { eldritch: true }],
        ["jewel", {}],
        ["flask", {}],
        ["ratcheting", {}],
        ["simplex", {}],
    ];
    configs.forEach(([base, flags], i) => {
        const seed = 7000 + 10 * i;
        const s = setup(seed, base, flags);
        const influences = flags.influence ? someInfluences(s.u) : [NO_INFLUENCE];
        const amulet = base === "amulet";
        const eldritch = flags.eldritch
            ? {
                  exarch: implicits(s, "exarch", amulet ? 4 : 6),
                  eater: implicits(s, "eater", amulet ? 4 : 6),
              }
            : {};

        it(`${base}: a strip's rarity, by what is left`, () => {
            const bounds = { fractured: true, corrupted: [false, true] };
            exact(s, seed, bounds, [rarity("survivors")]);
            exact(s, seed + 1, bounds, [rarity("lowest")]);
            exact(s, seed + 2, bounds, [req({ kind: "notNormal" }), rarity("survivors")]);
        });

        it(`${base}: every check refuses the same items`, () => {
            const bounds = { influences, corrupted: [false, true], ...eldritch };
            for (const c of CHECKS) exact(s, seed + 3, bounds, [req(c), corrupt]);
        });

        it(`${base}: the corruption implicits`, () => {
            const bounds = { influences, ...eldritch };
            exact(s, seed + 4, bounds, [replaced(1)]);
            exact(s, seed + 5, bounds, [replaced(2)]);
            exact(s, seed + 6, bounds, [
                req({ kind: "notCorrupted" }),
                corrupt,
                either([], [replaced(2)], [{ kind: "end" }]),
            ]);
        });

        it(`${base}: randomise and anyOne`, () => {
            const bounds = { influences, fractured: true, ...eldritch };
            exact(s, seed + 7, bounds, [influence({ kind: "anyOne" })]);
            exact(s, seed + 8, bounds, [influence({ kind: "randomise" })]);
        });

        if (flags.influence) {
            it(`${base}: the influence changes`, () => {
                const bounds = { influences, fractured: true, ...eldritch };
                exact(s, seed + 7, bounds, [
                    req({ kind: "noInfluence", what: "An orb" }),
                    req({ kind: "noEldritch", what: "An orb" }),
                    influence({ kind: "anyOne" }),
                ]);
                const plain = { influences: [NO_INFLUENCE, hunter] };
                exact(s, seed + 7, plain, [influence({ kind: "add", influence: "elder" })]);
                exact(s, seed + 8, plain, [
                    influence({ kind: "set", key: influenceKey(["crusader"]) }),
                ]);
            });
        }

        if (flags.eldritch) {
            it(`${base}: the eldritch changes`, () => {
                const bounds = { ...eldritch, corrupted: [false, true] };
                exact(s, seed + 7, bounds, [req({ kind: "bothEldritch" }), conflict]);
                exact(s, seed + 8, bounds, L.CONFLICT);
                if (amulet) {
                    // An amulet holds one implicit (Ukatoa's Ducat � Mechanics):
                    // the Orb of Conflict refuses every one, and no ember takes
                    // an amulet, so its implicit is set as the ducat sets it.
                    for (const side of ["exarch", "eater"] as const) {
                        exact(s, seed + 9, bounds, [
                            req({ kind: "noEldritch", what: "Ukatoa's Ducat" }),
                            { kind: "eldritch", change: { kind: "set", side, tier: 3, types: [] } },
                        ]);
                    }
                }
                for (const side of ["exarch", "eater"] as const) {
                    for (const tier of [1, 4]) {
                        const types = s.cat.registry
                            .eldritchPool(s.cat.base, side, tier)
                            .map((e) => e.type);
                        exact(s, seed + 9, bounds, L.eldritchImplicitOps(side, tier, types));
                        // An empty pool: any implicit the tier can roll.
                        exact(s, seed + 9, bounds, L.eldritchImplicitOps(side, tier, []));
                    }
                }
            });
        }
    });

    it("the Astrolabe Amulet's influences stay all six", () => {
        const s = withCatalog(
            rebuilt(generateCatalog(7110, { base: "amulet" }), ASTROLABE_BASE),
            7110,
        );
        const all = influenceKey(INFLUENCES);
        expect(s.u.influenceKeys).toEqual([all]);
        const bounds = { influences: [all] };
        exact(s, 7111, bounds, [influence({ kind: "randomise" })]);
        exact(s, 7112, bounds, [influence({ kind: "anyOne" })]);
        expect(outcomes(s, cItem({ influences: all }), [influence({ kind: "anyOne" })])).toEqual([
            cItem({ influences: all }),
        ]);
    });

    it("every pair of tiers and two implicits a side under conflict", () => {
        const cat = twoTypesASide(7120);
        const s = withCatalog(cat, 7120, 2);
        const bounds = {
            exarch: everyImplicit(cat, "exarch"),
            eater: everyImplicit(cat, "eater"),
            rarities: ["rare"] as Rarity[],
        };
        exact(s, 7121, bounds, L.CONFLICT);
        exact(s, 7122, bounds, [replaced(2)]);
        for (const e of bounds.exarch.filter((x) => x.tier > 0)) {
            for (const f of bounds.eater.filter((x) => x.tier > 0)) {
                const out = outcomes(s, cItem({ exarch: e, eater: f }), L.CONFLICT);
                expect(out).toHaveLength(2);
                for (const x of out) {
                    if (x.exarch.tier > 0) expect(x.exarch.type).toBe(e.type);
                    if (x.eater.tier > 0) expect(x.eater.type).toBe(f.type);
                }
            }
        }
    });

    it("boots whose catalogue names no implicit carry unnamed ones", () => {
        const s = setup(7130, "boots", { ilvl: 84 });
        expect(s.u.eldritchTypes("exarch")).toEqual([undefined]);
        const some = [NO_IMPLICIT, { tier: 1, type: undefined }, { tier: 6, type: undefined }];
        const bounds = { exarch: some, eater: some };
        exact(s, 7131, bounds, L.CONFLICT);
        exact(s, 7132, bounds, L.eldritchImplicitOps("eater", 2, []));
        exact(s, 7133, bounds, [replaced(1)]);
        for (const c of CHECKS) exact(s, 7134, bounds, [req(c)]);
    });

    it("the library's corruptions on a base that cannot be Rare", () => {
        const s = setup(7100, "flask", {});
        expect(s.cat.base).toBe(FLASK_BASE);
        exact(s, 7101, { corrupted: [false, true] }, L.vaalOps(s.cat.base));
        exact(s, 7102, { corrupted: [false, true] }, L.locusOps(s.cat.base));
    });
});

// --- the documented decisions, item by item --------------------------------------

/** The items the method leaves on one item, symbolic and reference agreeing. */
function outcomes(s: Setup, item: CItem, ops: readonly Op[]): CItem[] {
    expect(violations(item, s.cat.ctx)).toEqual([]);
    const state = fromItems(s.u, [item])!;
    const r = runMethod(state, ops);
    const exact = listItems(s.u, r.state.dd, { lowest: true });
    const ref = refRunMethod(ItemSet.of([item]), ops, s.cat.ctx);
    expect(exact.keys()).toEqual(ref.state.keys());
    return exact.items();
}

const rarities = (xs: readonly CItem[]): Rarity[] => xs.map((x) => x.rarity).sort();

/** Natural rows: a prefix and two suffixes, of distinct families. */
function sides(s: Setup): { prefix: ModId; suffix: ModId; suffix2: ModId } {
    const rows = [...s.u.rows.keys()].filter((m) => m.source === undefined);
    const apart = (a: Mod, b: Mod) => ![...a.families].some((f) => b.families.has(f));
    const prefix = rows.find((m) => m.gen === "prefix");
    const suffix = rows.find((m) => m.gen === "suffix" && (!prefix || apart(m, prefix)))!;
    const suffix2 = rows.find(
        (m) =>
            m.gen === "suffix" &&
            m.type !== suffix.type &&
            apart(m, suffix) &&
            (!prefix || apart(m, prefix)),
    );
    return {
        prefix: prefix?.id ?? ModId(""),
        suffix: suffix.id,
        suffix2: suffix2?.id ?? ModId(""),
    };
}

describe("the rarity a strip leaves", () => {
    const s = setup(7200, "ring", {}, 8);
    const { prefix, suffix, suffix2 } = sides(s);
    const value = (id: ModId): number | undefined => {
        const m = [...s.u.rows.keys()].find((r) => r.id === id)!;
        return m.text === undefined ? undefined : rollRange(m.text)?.[0];
    };
    const f = (id: ModId) => cMod(id, value(id), { fractured: true });
    const rare = (...ids: ModId[]) => cItem({ rarity: "rare", mods: ids.map(f) });

    it("is Normal with none left, Magic with one, Rare with two (Orb of Scouring)", () => {
        expect(rarities(outcomes(s, rare(), [rarity("survivors")]))).toEqual(["normal"]);
        expect(rarities(outcomes(s, rare(prefix), [rarity("survivors")]))).toEqual(["magic"]);
        expect(rarities(outcomes(s, rare(prefix, suffix), [rarity("survivors")]))).toEqual([
            "rare",
        ]);
    });

    it("never rises above the rarity the item had", () => {
        const magic = cItem({ rarity: "magic", mods: [f(prefix), f(suffix)] });
        expect(rarities(outcomes(s, magic, [rarity("survivors")]))).toEqual(["magic"]);
    });

    it("with `lowest`, is Magic or Rare for one a side, Rare for two of a side", () => {
        expect(rarities(outcomes(s, rare(prefix, suffix), [rarity("lowest")]))).toEqual([
            "magic",
            "rare",
        ]);
        expect(rarities(outcomes(s, rare(suffix, suffix2), [rarity("lowest")]))).toEqual(["rare"]);
        expect(rarities(outcomes(s, rare(prefix), [rarity("lowest")]))).toEqual(["magic"]);
    });

    it("goes up to a rarity that holds what is left, where a base's delta closes a side", () => {
        // A Simplex Amulet's Magic holds no affix at all.
        const t = setup(7210, "simplex", {});
        const one = sides(t);
        const id = one.suffix;
        const item = cItem({
            rarity: "rare",
            mods: [cMod(id, valueIn(t, id), { fractured: true })],
        });
        expect(rarities(outcomes(t, item, [rarity("survivors")]))).toEqual(["rare"]);
        expect(rarities(outcomes(t, item, [rarity("lowest")]))).toEqual(["rare"]);
    });
});

function valueIn(s: Setup, id: ModId): number | undefined {
    const m = [...s.u.rows.keys()].find((r) => r.id === id)!;
    return m.text === undefined ? undefined : rollRange(m.text)?.[0];
}

describe("the influence changes", () => {
    const s = setup(7300, "boots", { influence: true, eldritch: true });
    const keys = (xs: readonly CItem[]): InfluenceKey[] => xs.map((x) => x.influences).sort();

    it("randomise keeps the count and may give any set of it, its own included", () => {
        const one = outcomes(s, cItem({ influences: hunter }), [influence({ kind: "randomise" })]);
        expect(keys(one)).toEqual(INFLUENCES.map((i) => influenceKey([i])).sort());
        const two = outcomes(s, cItem({ influences: influenceKey(["shaper", "elder"]) }), [
            influence({ kind: "randomise" }),
        ]);
        expect(two).toHaveLength(15);
        expect(keys(outcomes(s, cItem(), [influence({ kind: "randomise" })]))).toEqual([
            NO_INFLUENCE,
        ]);
    });

    it("anyOne gives any one influence or keeps the item's own set", () => {
        const pair = influenceKey(["shaper", "elder"]);
        const out = outcomes(s, cItem({ influences: pair }), [influence({ kind: "anyOne" })]);
        expect(keys(out)).toEqual([pair, ...INFLUENCES.map((i) => influenceKey([i]))].sort());
    });

    it("anyOne leaves an item with an eldritch implicit uninfluenced, as the game allows no both", () => {
        const type = s.cat.eldritch.find((e) => e.side === "exarch")!.type;
        const item = cItem({ exarch: { tier: 2, type } });
        expect(outcomes(s, item, [influence({ kind: "anyOne" })])).toEqual([item]);
    });

    it("leaves the modifiers as they are", () => {
        const id = s.cat.influence!.id;
        const item = cItem({
            rarity: "magic",
            influences: hunter,
            mods: [cMod(id, valueIn(s, id))],
        });
        const out = outcomes(s, item, [influence({ kind: "randomise" })]);
        expect(out.every((x) => x.mods.length === 1 && x.mods[0]!.row === id)).toBe(true);
    });

    it("refuses as an internal fault a mark the item cannot carry", () => {
        const type = s.cat.eldritch.find((e) => e.side === "eater")!.type;
        const state = fromItems(s.u, [cItem({ eater: { tier: 1, type } })])!;
        const set = influence({ kind: "set", key: hunter });
        expect(() => runMethod(state, [set])).toThrow(InternalError);
        expect(() => refRunMethod(listItems(s.u, state.dd), [set], s.cat.ctx)).toThrow(
            InternalError,
        );
    });
});

describe("the eldritch changes", () => {
    const s = setup(7400, "boots", { eldritch: true });
    const ex = s.cat.eldritch.find((e) => e.side === "exarch")!.type;
    const ea = s.cat.eldritch.find((e) => e.side === "eater")!.type;
    const item = (a: number, e: number) =>
        cItem({
            exarch: a === 0 ? NO_IMPLICIT : { tier: a, type: ex },
            eater: e === 0 ? NO_IMPLICIT : { tier: e, type: ea },
        });
    const pairs = (xs: readonly CItem[]): string[] =>
        xs.map((x) => `${x.exarch.tier}/${x.eater.tier}`).sort();

    it("conflict raises one and lowers the other, either way round", () => {
        expect(pairs(outcomes(s, item(3, 3), L.CONFLICT))).toEqual(["2/4", "4/2"]);
    });

    it("conflict removes a Lesser it lowers, and a Perfect raised stays Perfect", () => {
        const out = outcomes(s, item(6, 1), L.CONFLICT);
        expect(pairs(out)).toEqual(["5/2", "6/0"]);
        expect(out.find((x) => x.eater.tier === 0)!.eater).toEqual(NO_IMPLICIT);
    });

    it("conflict keeps each implicit's type", () => {
        const out = outcomes(s, item(2, 5), L.CONFLICT);
        expect(out.every((x) => x.exarch.type === ex && x.eater.type === ea)).toBe(true);
    });

    it("an ember sets its side's tier and gives one outcome per implicit of its pool", () => {
        const pool = s.cat.registry.eldritchPool(s.cat.base, "exarch", 2).map((e) => e.type);
        const out = outcomes(s, item(4, 1), L.eldritchImplicitOps("exarch", 2, pool));
        expect(pairs(out).every((p) => p === "2/1")).toBe(true);
        expect(out.map((x) => x.exarch.type).sort()).toEqual([...new Set(pool)].sort());
    });

    it("a corruption implicit may replace one eldritch implicit, the altar's two any", () => {
        expect(pairs(outcomes(s, item(3, 2), [replaced(1)]))).toEqual(["0/2", "3/0", "3/2"]);
        expect(pairs(outcomes(s, item(3, 2), [replaced(2)]))).toEqual(["0/0", "0/2", "3/0", "3/2"]);
    });

    it("dominance is the higher tier, none on equal tiers", () => {
        const dom = (side: EldritchSide, x: CItem) =>
            runMethod(fromItems(s.u, [x])!, [req({ kind: "dominant", side, what: "An orb" })]).ok;
        expect(dom("exarch", item(3, 2))).toBe(true);
        expect(dom("exarch", item(1, 0))).toBe(true);
        expect(dom("exarch", item(3, 3))).toBe(false);
        expect(dom("eater", item(3, 3))).toBe(false);
        expect(dom("eater", item(0, 0))).toBe(false);
    });
});

describe("the checks' words", () => {
    const s = setup(7500, "boots", { influence: true, eldritch: true });
    const type = s.cat.eldritch.find((e) => e.side === "exarch")!.type;
    const run = (items: CItem[], c: Check) => runMethod(fromItems(s.u, items)!, [req(c)]);

    it("say whether every item breaks the check", () => {
        const plain = cItem();
        const marked = cItem({ influences: hunter });
        const what = "An orb";
        expect(run([plain, marked], { kind: "noInfluence", what })).toMatchObject({
            ok: false,
            failure: { kind: "influenced", what, sure: false },
        });
        expect(run([marked], { kind: "noInfluence", what })).toMatchObject({
            failure: { kind: "influenced", what, sure: true },
        });
        expect(run([plain], { kind: "influenced", what, influence: "hunter" })).toMatchObject({
            failure: { kind: "notInfluenced", what, influence: "hunter", sure: true },
        });
        const implicit = cItem({ exarch: { tier: 1, type } });
        expect(run([plain, implicit], { kind: "noEldritch", what })).toMatchObject({
            failure: { kind: "eldritchPresent", what, sure: false },
        });
        expect(run([implicit], { kind: "bothEldritch" })).toMatchObject({
            failure: { kind: "notBothEldritch", sure: true },
        });
        expect(run([plain], { kind: "dominant", side: "eater", what })).toMatchObject({
            failure: { kind: "notDominant", side: "eater", what },
        });
    });

    it("judge the base and its level", () => {
        const plain = cItem();
        expect(run([plain], { kind: "baseHasTag", tag: TagId("boots"), what: "boots" }).ok).toBe(
            true,
        );
        expect(
            run([plain], { kind: "baseHasAnyTag", tags: [TagId("ring")], what: "a ring" }),
        ).toMatchObject({ failure: { kind: "wrongBase", needed: "a ring" } });
        expect(
            run([plain], { kind: "minItemLevel", level: s.cat.ilvl + 1, what: "An Ember" }),
        ).toMatchObject({
            failure: { kind: "itemLevelTooLow", level: s.cat.ilvl + 1, what: "An Ember" },
        });
        const flask = setup(7510, "flask", {});
        const r = runMethod(fromItems(flask.u, [cItem()])!, [
            req({ kind: "influenceable", influence: "hunter", what: "An orb" }),
        ]);
        expect(r).toMatchObject({
            failure: { kind: "notInfluenceable", influence: "hunter", what: "An orb" },
        });
    });
});

describe("an influence added where the game forbids one", () => {
    const s = setup(7600, "boots", { influence: true, eldritch: true });
    const add = influence({ kind: "add", influence: "shaper" });
    const refused = (item: CItem): void => {
        expect(violations(item, s.cat.ctx)).toEqual([]);
        expect(() => runMethod(fromItems(s.u, [item])!, [add])).toThrow(InternalError);
        expect(() => refRunMethod(ItemSet.of([item]), [add], s.cat.ctx)).toThrow(InternalError);
    };

    it("is an internal fault: a third influence, a fracture, an eldritch implicit", () => {
        refused(cItem({ influences: influenceKey(["elder", "hunter"]) }));
        const id = s.rows.find((r) => r !== s.cat.influence?.id)!;
        refused(cItem({ rarity: "magic", mods: [cMod(id, valueIn(s, id), { fractured: true })] }));
        const type = s.cat.eldritch.find((e) => e.side === "eater")!.type;
        refused(cItem({ eater: { tier: 2, type } }));
    });
});

describe("an ember with no pool named", () => {
    it("gives only the implicits its tier can roll", () => {
        const cat = twoTypesASide(7700);
        const [kept, lowered] = [
            ...new Set(cat.eldritch.filter((e) => e.side === "exarch").map((e) => e.type)),
        ];
        const eldritch: EldritchImplicitSpec[] = cat.eldritch.map((e) =>
            e.type === lowered && e.tier === 2 ? { ...e, unrollable: true } : e,
        );
        const s = withCatalog(rebuilt(cat, cat.base, eldritch), 7700);
        const out = outcomes(s, cItem(), L.eldritchImplicitOps("exarch", 2, []));
        expect(out.map((x) => x.exarch)).toEqual([{ tier: 2, type: kept }]);
        exact(
            s,
            7701,
            { exarch: everyImplicit(s.cat, "exarch") },
            L.eldritchImplicitOps("exarch", 2, []),
        );
    });
});

describe("the rarity and corruption checks' words", () => {
    const s = setup(7800, "ring", {});
    const run = (items: CItem[], c: Check) => runMethod(fromItems(s.u, items)!, [req(c)]);
    const magic = cItem({ rarity: "magic" });
    const normal = cItem();

    it("name the rarities the items have", () => {
        expect(run([magic, normal], { kind: "rarity", rarity: "rare" })).toMatchObject({
            ok: false,
            failure: { kind: "wrongRarity", needed: "rare", actual: new Set(["magic", "normal"]) },
        });
        expect(run([magic, normal], { kind: "notMagic" })).toMatchObject({
            failure: { kind: "magicRefused", actual: new Set(["magic", "normal"]) },
        });
        expect(run([magic, normal], { kind: "notNormal" })).toMatchObject({
            failure: { kind: "normalRefused", actual: new Set(["magic", "normal"]) },
        });
        const flask = setup(7810, "flask", {});
        expect(
            runMethod(fromItems(flask.u, [cItem()])!, [req({ kind: "canBeRare" })]),
        ).toMatchObject({ failure: { kind: "rarityUnsupported", rarity: "rare" } });
    });

    it("say whether every item is, or is not, corrupted", () => {
        const corrupted = cItem({ corrupted: true });
        expect(run([corrupted, normal], { kind: "notCorrupted" })).toMatchObject({
            failure: { kind: "corrupted", sure: false },
        });
        expect(run([corrupted], { kind: "notCorrupted" })).toMatchObject({
            failure: { kind: "corrupted", sure: true },
        });
        const what = "A Tainted Chaos Orb";
        expect(run([corrupted, normal], { kind: "corruptedItem", what })).toMatchObject({
            failure: { kind: "notCorruptedItem", what, sure: false },
        });
        expect(run([normal], { kind: "corruptedItem", what })).toMatchObject({
            failure: { kind: "notCorruptedItem", what, sure: true },
        });
    });
});
