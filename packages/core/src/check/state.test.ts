import { describe, expect, it } from "vitest";
import type { RPred } from "./pred.js";
import { holds } from "./reference/conditions.js";
import { type CatalogOptions, generateCatalog, rng } from "./reference/catalog.js";
import {
    atCells,
    comparisonsOf,
    harnessUniverse,
    pickRows,
    predSpace,
    randomPred,
    someInfluences,
} from "./reference/harness.js";
import { HAND_REGISTRY, LIFE1, LIFE2, FIRE, COLD } from "./reference/hand.js";
import { type CEldritch, cItem, cMod } from "./reference/item.js";
import { canBeRare } from "../model/capacity.js";
import { listItems } from "./reference/listing.js";
import { allItems, diffSets, ItemSet } from "./reference/sets.js";
import { BOOTS_BASE, RING_BASE } from "../__fixtures__/mods.js";
import type { Base } from "../model/base.js";
import { ModId, TypeId } from "../model/ids.js";
import { buildRegistry, type Registry } from "../resolve/registry.js";
import { type Comparisons, NO_COMPARISONS } from "./craft.js";
import { modRow } from "./reference/catalog.js";
import { type CItem, type RefCtx, refCtx } from "./reference/item.js";
import { candidateRows } from "./rows.js";
import { conditionOf, fromItems, narrow, predKey } from "./state.js";
import { buildUniverse, RARITIES, Universe } from "./universe.js";

const PLANS: CatalogOptions[] = [
    { types: 3 },
    { types: 3, bench: true },
    { types: 3, influence: true },
    { types: 3, base: "boots", eldritch: true },
    { types: 3, base: "amulet", eldritch: true },
    { types: 3, metamods: ["multimod"] },
    { types: 4, sharedFamily: true },
    { types: 3, veiled: true },
];

describe("narrowing by a condition", () => {
    PLANS.forEach((opts, i) => {
        const seed = 4100 + i;
        it(`is the reference's filter on catalogue ${seed} ${JSON.stringify(opts)}`, () => {
            const cat = generateCatalog(seed, opts);
            const r = rng(seed);
            const space = predSpace(
                cat,
                candidateRows(cat.registry, cat.base, cat.ilvl, undefined).keys(),
            );
            const preds: RPred[] = Array.from({ length: 30 }, () => randomPred(space, r));
            const u = harnessUniverse(cat, { comparisons: comparisonsOf(preds) });
            const rows = pickRows(u, seed, 3);
            const eldritch = opts.eldritch === true;
            const implicits = (side: "exarch" | "eater"): CEldritch[] =>
                eldritch
                    ? [0, 1, 3].flatMap((tier) =>
                          u.eldritchTypes(side).map((type) => ({ tier, type })),
                      )
                    : [{ tier: 0, type: undefined }];
            const pool = atCells(
                u,
                allItems(cat.ctx, {
                    rows,
                    rarities: RARITIES.filter((x) => x !== "rare" || canBeRare(cat.base)),
                    influences: eldritch ? [u.influenceKeys[0]!] : someInfluences(u).slice(0, 3),
                    corrupted: [false, true],
                    exarch: implicits("exarch"),
                    eater: implicits("eater"),
                    values: true,
                    fractured: true,
                }),
            ).items();
            expect(pool.length).toBeGreaterThan(10);
            let split = 0;
            for (let k = 0; k < 6; k++) {
                const items = ItemSet.of(r.sample(pool, r.int(1, Math.min(40, pool.length))));
                const state = fromItems(u, items)!;
                for (const pred of preds) {
                    for (const positive of [true, false]) {
                        const got = narrow(state, pred, positive);
                        const want = items.filter((x) => holds(pred, x, cat.ctx) === positive);
                        if (want.size > 0 && want.size < items.size) split++;
                        const listed =
                            got === null ? ItemSet.empty : listItems(u, got.dd, { lowest: true });
                        const d = diffSets(want, listed);
                        expect(d, `${positive ? "" : "not "}${predKey(pred)}\n${d}`).toBe("");
                    }
                }
            }
            // Most conditions cut the states, so both sides are exercised.
            expect(split).toBeGreaterThan(60);
        });
    });
});

describe("conditions", () => {
    const u = buildUniverse(HAND_REGISTRY, RING_BASE, 84, undefined);
    it("are cached per universe by their meaning", () => {
        const a: RPred = { kind: "has", type: LIFE1.type, gen: "prefix" };
        const b: RPred = { kind: "has", type: LIFE1.type, gen: "suffix" };
        expect(conditionOf(u, a)).toBe(conditionOf(u, b));
    });

    it("hold nowhere for a type the universe has no slot for", () => {
        const s = fromItems(u, [cItem({ rarity: "magic", mods: [cMod(LIFE2.id, 20)] })])!;
        const none: RPred = { kind: "fractured", type: COLD.type };
        expect(narrow(s, none)).toBeNull();
        expect(narrow(s, none, false)).toEqual(s);
    });

    it("read a state built from items at their cells", () => {
        const item = cItem({ rarity: "rare", mods: [cMod(LIFE1.id, 11), cMod(FIRE.id, 8)] });
        const s = fromItems(u, [item])!;
        // No comparison cuts the spans, so every value of the rows is one cell.
        expect(listItems(u, s.dd).size).toBe(9);
        expect(atCells(u, [item]).items()).toEqual(listItems(u, s.dd, { lowest: true }).items());
        expect(u.dd.implies(s.dd, u.wf)).toBe(true);
    });
});

describe("hand-written conditions", () => {
    const universe = (
        registry: Registry,
        base: Base,
        comparisons: Comparisons = NO_COMPARISONS,
    ): Universe =>
        new Universe(
            registry,
            base,
            84,
            candidateRows(registry, base, 84, undefined),
            comparisons,
            false,
        );
    const expectNarrow = (u: Universe, ctx: RefCtx, items: readonly CItem[], pred: RPred): void => {
        const state = fromItems(u, items)!;
        const set = atCells(u, items);
        for (const positive of [true, false]) {
            const got = narrow(state, pred, positive);
            const want = set.filter((x) => holds(pred, x, ctx) === positive);
            const d = diffSets(
                want,
                got === null ? ItemSet.empty : listItems(u, got.dd, { lowest: true }),
            );
            expect(
                d,
                `${positive ? "" : "not "}${predKey(pred)}
${d}`,
            ).toBe("");
        }
    };

    it("read an eldritch implicit's tier and wording", () => {
        const u = universe(HAND_REGISTRY, BOOTS_BASE);
        const ctx = refCtx(HAND_REGISTRY, BOOTS_BASE, 84);
        const speed = TypeId("ImplicitMoveSpeed");
        const regen = TypeId("ImplicitLifeRegen");
        const items = [
            cItem({ exarch: { tier: 3, type: speed } }),
            cItem({
                exarch: { tier: 2, type: regen },
                eater: { tier: 2, type: TypeId("ImplicitChaosRes") },
            }),
            cItem({
                exarch: { tier: 5, type: regen },
                eater: { tier: 6, type: TypeId("ImplicitChaosRes") },
            }),
            cItem(),
        ];
        expectNarrow(u, ctx, items, { kind: "eldritch", side: "exarch", tier: 2 });
        expectNarrow(u, ctx, items, { kind: "eldritch", side: "exarch", types: new Set([regen]) });
        expectNarrow(u, ctx, items, {
            kind: "eldritch",
            side: "exarch",
            tier: 3,
            types: new Set([speed]),
        });
        expectNarrow(u, ctx, items, { kind: "dominant", side: "eater" });
        expect(
            narrow(fromItems(u, items)!, { kind: "eldritch", side: "eater", tier: 2 })!.dd,
        ).not.toBe(u.dd.EMPTY);
    });

    it("compare a value at the named tier only", () => {
        const comparisons: Comparisons = {
            byType: new Map([[LIFE1.type, new Set([11, 20])]]),
            everyType: new Set(),
        };
        const u = universe(HAND_REGISTRY, RING_BASE, comparisons);
        const ctx = refCtx(HAND_REGISTRY, RING_BASE, 84);
        const items = [10, 11, 12].map((v) =>
            cItem({ rarity: "magic", mods: [cMod(LIFE1.id, v)] }),
        );
        items.push(
            cItem({ rarity: "magic", mods: [cMod(LIFE2.id, 20)] }),
            cItem({ rarity: "magic" }),
        );
        const rows = new Map<ModId, readonly [number, number]>([[LIFE2.id, [20, 21]]]);
        const value = (op: "<" | ">=", v: number, oneTier: boolean): RPred => ({
            kind: "hasValue",
            type: LIFE1.type,
            gen: "prefix",
            op,
            value: v,
            rows,
            unnumbered: new Set(),
            ...(oneTier && { oneTier: true as const }),
        });
        expectNarrow(u, ctx, items, value(">=", 11, false));
        expectNarrow(u, ctx, items, value(">=", 20, true));
        expectNarrow(u, ctx, items, value("<", 11, true));
        expect(narrow(fromItems(u, items)!, value(">=", 20, true))!.dd).not.toBe(u.dd.EMPTY);
    });

    it("count a modifier on the side of its own row where a type has rows of both", () => {
        const both = [
            modRow({ id: "Both1", type: "TypeBoth", gen: "suffix", text: "+(1-2) to Both" }),
            modRow({
                id: "Both2",
                type: "TypeBoth",
                gen: "prefix",
                minLevel: 50,
                text: "+(3-4) to Both",
            }),
            modRow({ id: "Pre1", type: "TypePre", gen: "prefix", text: "+(1-2) to Pre" }),
        ];
        const registry = buildRegistry({ bases: [RING_BASE], mods: both });
        const u = universe(registry, RING_BASE);
        const ctx = refCtx(registry, RING_BASE, 84);
        const items = [
            cItem({ rarity: "rare", mods: [cMod(ModId("Both1"), 1), cMod(ModId("Pre1"), 1)] }),
            cItem({ rarity: "rare", mods: [cMod(ModId("Both2"), 3), cMod(ModId("Pre1"), 1)] }),
            cItem({ rarity: "rare", mods: [cMod(ModId("Both2"), 3)] }),
        ];
        for (const value of [0, 1, 2]) {
            expectNarrow(u, ctx, items, {
                kind: "compare",
                projection: "prefixCount",
                op: "==",
                value,
            });
            expectNarrow(u, ctx, items, {
                kind: "compare",
                projection: "suffixCount",
                op: ">=",
                value,
            });
        }
    });
});
