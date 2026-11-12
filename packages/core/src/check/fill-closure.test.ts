import { describe, expect, it } from "vitest";
import type { PoolSpec } from "./ops/types.js";
import { type Gen, TagId, type TypeId } from "../model/ids.js";
import type { ItemFacts } from "../model/item.js";
import { influenceOfTag } from "../model/marks.js";
import type { Mod } from "../model/mod.js";
import { foulbornKept } from "../model/strands.js";
import { effectsOf } from "../model/effects.js";
import { lookupWeight, pool, slotOpen } from "../pool/pool.js";
import { influenceTagsOfKey } from "./influence.js";
import { reforgeImage, type ReforgeMode } from "./ops/fill.js";
import { drawCtxOf, poolHoldsStill } from "./ops/pools.js";
import type { FillOp } from "./ops/steps.js";
import { type CatalogOptions, generateCatalog } from "./reference/catalog.js";
import { harnessStates, harnessUniverse, pickRows, someInfluences } from "./reference/harness.js";
import { type CItem, itemKey, rowOf } from "./reference/item.js";
import { eligible } from "./reference/ops/pools.js";
import { allItems } from "./reference/sets.js";
import { rulesOf } from "./rules.js";
import { fromItems } from "./state.js";

type Cat = ReturnType<typeof generateCatalog>;

const chaos: FillOp & { count: { kind: "reforge"; n: readonly [number, number] } } = {
    kind: "fill",
    pool: { kind: "natural" },
    count: { kind: "reforge", n: [4, 6] },
};

/** The states of a catalogue holding its flagged rows, as diagrams. */
function statesOf(seed: number, opts: CatalogOptions) {
    const cat = generateCatalog(seed, opts);
    const u = harnessUniverse(cat);
    const include = cat.mods.filter((m) => m.id === "Adder1" || m.id === "Both1").map((m) => m.id);
    const sets = harnessStates(u, cat.ctx, seed, {
        bounds: { rows: pickRows(u, seed, 3, include), rarities: ["rare"] },
        random: 6,
        maxSize: 10,
    });
    return { cat, u, states: sets.map((s) => fromItems(u, s)!.dd) };
}

/** Per state: whether the pool holds still on it, and the reforge's image
 *  by each mode, over one universe. */
function images(seed: number, opts: CatalogOptions, kept: Gen[]) {
    const { u, states } = statesOf(seed, opts);
    const rules = {
        ...rulesOf([], [chaos]),
        protected: { sides: new Set(kept), types: new Set<TypeId>(), partial: new Map() },
    };
    return states.map((start) => {
        const ctx = { u, rules, start };
        const by = (mode: ReforgeMode) => reforgeImage(chaos, [], start, ctx, mode);
        return {
            still: poolHoldsStill(start, chaos.pool, drawCtxOf(ctx)),
            loop: by("loop"),
            closure: by("closure"),
            auto: by("auto"),
        };
    });
}

describe("a reforge laid at once", () => {
    it("is the loop's diagram where the pool holds still", () => {
        let still = 0;
        for (let seed = 9300; seed < 9304; seed++) {
            for (const kept of [[], ["prefix"]] as Gen[][]) {
                for (const r of images(seed, { types: 4 }, kept)) {
                    expect(r.auto).toBe(r.loop);
                    if (r.still) {
                        still++;
                        expect(r.closure).toBe(r.loop);
                    }
                }
            }
        }
        expect(still).toBeGreaterThan(0);
    });

    it("is not, where a row laid adds a tag that turns another on or off; there the loop runs", () => {
        let differs = 0;
        for (let seed = 9400; seed < 9404; seed++) {
            for (const opts of [
                { types: 3, addsTag: true },
                { types: 3, twoSided: true },
            ]) {
                for (const r of images(seed, opts, [])) {
                    expect(r.auto).toBe(r.loop);
                    if (r.closure !== r.loop) {
                        expect(r.still).toBe(false);
                        differs++;
                    }
                }
            }
        }
        // The tag-adding row turns the gated rows on and off between draws.
        expect(differs).toBeGreaterThan(0);
    });
});

// --- the pools against pool/pool.ts --------------------------------------------

function factsOf(cat: Cat, x: CItem): ItemFacts {
    const mods = x.mods.map((m) => rowOf(cat.ctx, m));
    return {
        base: cat.base,
        ilvl: cat.ilvl,
        rarity: x.rarity,
        prefixCount: mods.filter((m) => m.gen === "prefix").length,
        suffixCount: mods.filter((m) => m.gen === "suffix").length,
        types: new Set(mods.map((m) => m.type)),
        families: new Set(mods.flatMap((m) => [...m.families])),
        tags: new Set([
            ...cat.base.tags,
            ...influenceTagsOfKey(cat.registry, cat.base, x.influences),
            ...mods.flatMap((m) => [...m.addsTags]),
        ]),
        effects: mods.flatMap((m) => [...effectsOf(m)]),
    };
}

/** A row of no pool fits the item as `pool` judges it. */
const fitsBy = (f: ItemFacts, m: Mod): boolean =>
    !f.types.has(m.type) && ![...m.families].some((g) => f.families.has(g)) && slotOpen(f, m.gen);

const ids = (rows: readonly Mod[]): string[] => rows.map((m) => m.id).sort();

describe("the pools", () => {
    it("are composed over pool/pool.ts as the rules state them", () => {
        for (let seed = 9500; seed < 9510; seed++) {
            const opts: CatalogOptions = {
                types: 4,
                influence: seed % 2 === 0,
                fossil: true,
                essenceOnly: true,
                metamods: ["cannotRollAttack"],
            };
            const cat = generateCatalog(seed, opts);
            const u = harnessUniverse(cat);
            const rows = pickRows(
                u,
                seed,
                4,
                cat.metamods.map((m) => m.id),
            );
            const items = allItems(cat.ctx, {
                rows,
                rarities: ["magic", "rare"],
                influences: someInfluences(u),
            });
            const named = cat.natural.filter((m) => u.rows.has(m)).slice(0, 3);
            for (const x of items) {
                const f = factsOf(cat, x);
                const natural = pool(cat.registry.catalog, f).map((c) => c.mod);
                const fromInfluence = influenceTagsOfKey(cat.registry, cat.base, x.influences);
                const own = new Set([...f.tags].filter((t) => !fromInfluence.has(t)));
                const expect_ = (spec: PoolSpec, rows: readonly Mod[]): void => {
                    expect(
                        ids(eligible(spec, x, cat.ctx, false)),
                        `${spec.kind} ${itemKey(x)}`,
                    ).toEqual(ids(rows));
                };
                for (const tag of ["attack", "caster"].map(TagId)) {
                    expect_(
                        { kind: "tagged", tag },
                        natural.filter((m) => m.implicitTags.has(tag)),
                    );
                }
                expect_(
                    { kind: "influence" },
                    natural.filter(
                        (m) =>
                            (lookupWeight(m, own) ?? 0) <= 0 &&
                            m.spawn.some((e) => influenceOfTag(e.tag) !== undefined),
                    ),
                );
                const blocked = new Set([TagId("caster")]);
                expect_(
                    {
                        kind: "fossil",
                        blocked,
                        noTagless: true,
                        added: cat.fossilRows,
                        essence: cat.essence ? [cat.essence] : [],
                        fossils: [],
                    },
                    [
                        ...natural.filter(
                            (m) =>
                                m.implicitTags.size > 0 &&
                                ![...m.implicitTags].some((t) => blocked.has(t)),
                        ),
                        ...cat.fossilRows.filter(
                            (m) =>
                                m.minLevel <= cat.ilvl &&
                                (lookupWeight(m, cat.base.tags) ?? 0) > 0 &&
                                fitsBy(f, m),
                        ),
                        ...(cat.essence && fitsBy(f, cat.essence) ? [cat.essence] : []),
                    ],
                );
                expect_(
                    { kind: "rows", mods: named },
                    named.filter((m) => fitsBy(f, m)),
                );
                // Foulborn currency § Mechanics: each type's top tiers, by rank.
                expect_(
                    { kind: "natural", topTiers: true },
                    natural.filter((m) => {
                        const of = natural.filter((r) => r.type === m.type);
                        const rank = 1 + of.filter((r) => r.minLevel > m.minLevel).length;
                        return rank <= foulbornKept(of.length);
                    }),
                );
            }
        }
    });
});
