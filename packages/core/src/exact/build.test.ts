import { describe, expect, it, vi } from "vitest";
import { RING_BASE, TAG_DEFAULT } from "../__fixtures__/mods.js";
import { eldritchChaosOps } from "../check/library.js";
import { rollRange } from "../check/values.js";
import { findMethod, type Literal, METHODS, type Method, type Refusal } from "../check/methods.js";
import type { Op } from "../check/ops.js";
import { ModId, TagId, TypeId } from "../model/ids.js";
import { influenceKey, type InfluenceKey, NO_INFLUENCE } from "../model/marks.js";
import type { Mod } from "../model/mod.js";
import { buildRegistry } from "../resolve/registry.js";
import { buildMethod } from "./build.js";
import { runMethod } from "./method.js";
import { buildFor } from "./reference/build.js";
import { generateCatalog, modRow } from "./reference/catalog.js";
import {
    atCells,
    compareMethod,
    harnessStates,
    harnessUniverse,
    pickRows,
} from "./reference/harness.js";
import { type CItem, cItem, cMod, type RefCtx, refCtx } from "./reference/item.js";
import { listItems } from "./reference/listing.js";
import { refRunMethod } from "./reference/method.js";
import { rng } from "./reference/rng.js";
import { diffSets, ItemSet } from "./reference/sets.js";
import { fromItems } from "./state.js";
import { buildUniverse, type Universe } from "./universe.js";

// Every method of the table is built on every item of a few dozen states and
// run on each part: slower than the default limit on a loaded machine.
vi.setConfig({ testTimeout: 60_000 });

/** What a builder gave, by what it is: the operations' rows by id. */
function builtKey(b: readonly Op[] | Refusal): string {
    if ("refused" in b) return `refused: ${b.refused}`;
    return JSON.stringify(b, (_k, v: unknown) => {
        if (v instanceof Set) return [...(v as Set<unknown>)].map(String).sort();
        if (v instanceof Map) {
            return [...(v as Map<unknown, unknown>).entries()].sort(([a], [b]) =>
                String(a) < String(b) ? -1 : 1,
            );
        }
        if (typeof v === "object" && v !== null && "id" in v && "type" in v && "gen" in v) {
            return (v as Mod).id;
        }
        return typeof v === "function" ? undefined : v;
    });
}

const str = (value: string): Literal => ({ kind: "string", value });

/** Each part's items each built alone get the part's operations. */
function expectPartsAlike(
    u: Universe,
    ctx: RefCtx,
    items: ItemSet,
    method: Method,
    literals: readonly Literal[],
): number {
    const parts = buildMethod(fromItems(u, items)!, method, literals);
    let seen = 0;
    for (const p of parts) {
        const key = builtKey(p.built);
        for (const x of listItems(u, p.state.dd, { lowest: true })) {
            expect(builtKey(buildFor(ctx, x, method, literals)), method.words.join(" ")).toBe(key);
            seen++;
        }
    }
    expect(seen).toBe(atCells(u, items).size);
    return parts.length;
}

/** The parts run and united, against each item run alone with what it builds. */
function expectRuns(
    u: Universe,
    ctx: RefCtx,
    items: readonly CItem[],
    method: Method,
    literals: readonly Literal[],
): void {
    const state = fromItems(u, items)!;
    let exact = ItemSet.empty;
    for (const p of buildMethod(state, method, literals)) {
        if ("refused" in p.built) throw new Error(`a part is refused: ${p.built.refused}`);
        const r = runMethod(p.state, p.built);
        expect(r.ok).toBe(true);
        exact = exact.union(listItems(u, r.state.dd, { lowest: true }));
    }
    let reference = ItemSet.empty;
    for (const x of atCells(u, items)) {
        const built = buildFor(ctx, x, method, literals);
        if ("refused" in built) throw new Error(`an item is refused: ${built.refused}`);
        const r = refRunMethod(ItemSet.of([x]), built, ctx);
        expect(r.ok).toBe(true);
        reference = reference.union(r.state);
    }
    expect(diffSets(atCells(u, reference), exact)).toBe("");
}

// --- a Harvest change under an influence -------------------------------------------

const resist = (element: string, id: string, minLevel: number, hunter = false): Mod =>
    modRow({
        id,
        type: `Type${element}Res`,
        gen: "suffix",
        minLevel,
        text: `+(${minLevel}-${minLevel + 1})% to ${element} Resistance`,
        spawn: hunter
            ? [
                  { tag: TagId("ring_basilisk"), weight: 300 },
                  { tag: TAG_DEFAULT, weight: 0 },
              ]
            : [{ tag: TAG_DEFAULT, weight: 500 }],
    });
const FIRE = [resist("Fire", "Fire1", 1), resist("Fire", "Fire2", 45)];
const COLD = [resist("Cold", "Cold1", 1), resist("Cold", "Cold2", 45)];
const FIRE_H = resist("Fire", "FireH", 60, true);
const COLD_H = resist("Cold", "ColdH", 60, true);
const pair = (from: string, to: "fire" | "cold", type: string) => ({
    from: TypeId(`Type${from}Res`),
    to: { [to]: { type: TypeId(`Type${type}Res`), basis: "test" } },
});
const GROVE = buildRegistry({
    bases: [RING_BASE],
    mods: [...FIRE, ...COLD, FIRE_H, COLD_H],
    harvestChange: {
        resistance: { fire: [pair("Fire", "cold", "Cold")], cold: [pair("Cold", "fire", "Fire")] },
        damage: {},
    },
});

describe("a method built on the exact state", () => {
    const u = buildUniverse(GROVE, RING_BASE, 84, undefined);
    const ctx = refCtx(GROVE, RING_BASE, 84);
    const change = findMethod(["harvest", "change"])!;
    const args = [str("fire resistance"), str("cold resistance")];
    const hunter = influenceKey(["hunter"]);
    const rare = (row: Mod, influences: InfluenceKey = NO_INFLUENCE): CItem =>
        cItem({ rarity: "rare", mods: [cMod(row.id, row.minLevel)], influences });

    it("changes each row of the modifier into its own counterpart", () => {
        const items = ItemSet.of([rare(FIRE[0]!), rare(FIRE[1]!), rare(FIRE_H, hunter)]);
        const parts = buildMethod(fromItems(u, items)!, change, args);
        expect(parts.length).toBe(3);
        for (const p of parts) {
            const ops = p.built as readonly Op[];
            const fill = ops.find((o) => o.kind === "fill" && o.pool.kind === "rows")!;
            const pool = (fill as Extract<Op, { kind: "fill" }>).pool as Extract<
                Extract<Op, { kind: "fill" }>["pool"],
                { kind: "rows" }
            >;
            // A part holds one row of the changed modifier, and the change says
            // what that row becomes.
            expect(pool.bySource!.size).toBe(1);
        }
        expectPartsAlike(u, ctx, items, change, args);
        expectRuns(u, ctx, items.items(), change, args);
    });

    it("reads the changed modifier's ladders under the item's own influence", () => {
        // Under the Hunter, FireH is its ladder's top and becomes ColdH; without
        // the influence it rolls on no ladder of the item and the grove refuses.
        const items = ItemSet.of([rare(FIRE_H, hunter), rare(FIRE_H)]);
        const parts = buildMethod(fromItems(u, items)!, change, args);
        expect(parts.map((p) => "refused" in p.built).sort()).toEqual([false, true]);
        expect(parts.flatMap((p) => ("refused" in p.built ? [p.built.refused] : []))).toEqual([
            '"cold resistance" cannot roll on this item.',
        ]);
        expectPartsAlike(u, ctx, items, change, args);
        expectRuns(u, ctx, [rare(FIRE_H, hunter)], change, args);
    });

    it("acts on each item's dominant implicit", () => {
        const cat = generateCatalog(5101, { base: "boots", eldritch: true, types: 3 });
        const bu = harnessUniverse(cat);
        const chaos = findMethod(["eldritch", "chaos"])!;
        const row = cat.natural.find((m) => m.gen === "prefix")!;
        const named = (side: "exarch" | "eater", tier: number) => ({
            tier,
            type: cat.eldritch.find((e) => e.side === side && e.tier === tier)!.type,
        });
        const at = (exarch: number, eater: number): CItem =>
            cItem({
                rarity: "rare",
                mods: [cMod(row.id, row.text === undefined ? undefined : rollRange(row.text)?.[0])],
                exarch: named("exarch", exarch),
                eater: named("eater", eater),
            });
        const items = [at(3, 1), at(1, 2), at(2, 2)].map((x) => bu.decodeOne(bu.encode(x)));
        const parts = buildMethod(fromItems(bu, items)!, chaos, []);
        expect(parts.map((p) => builtKey(p.built)).sort()).toEqual(
            [
                builtKey(eldritchChaosOps("exarch")),
                builtKey(eldritchChaosOps("eater")),
                "refused: An Eldritch Chaos Orb needs an item where the Searing Exarch or the Eater of Worlds is dominant — this item has Greater Exarch and Greater Eater.",
            ].sort(),
        );
        expectPartsAlike(bu, cat.ctx, ItemSet.of(items), chaos, []);
        expectRuns(bu, cat.ctx, items.slice(0, 2), chaos, []);
    });

    it("builds once where the builder reads nothing of the item", () => {
        const items = ItemSet.of([rare(FIRE[0]!), rare(COLD_H, hunter)]);
        expect(expectPartsAlike(u, ctx, items, findMethod(["chaos"])!, [])).toBe(1);
        expect(expectPartsAlike(u, ctx, items, findMethod(["unveil"])!, [])).toBe(1);
        expect(
            expectPartsAlike(u, ctx, items, findMethod(["unveil"])!, [str("fire resistance")]),
        ).toBe(2);
    });
});

// --- every method of the table ---------------------------------------------------------

/** Stand-in arguments for each slot, from the catalogue. */
function argsFor(method: Method, names: Readonly<Record<string, string>>): Literal[] {
    return method.args.flatMap((s, i): Literal[] => {
        switch (s.kind) {
            case "int":
            case "tier":
                return s.optional ? [] : [{ kind: s.kind, value: 1 }];
            case "word":
                return [{ kind: "word", value: s.oneOf[0]! }];
            case "name":
                return s.optional && i > 0 ? [] : [str(names[s.of] ?? "fire resistance")];
            case "names":
                return [str(names[s.of] ?? "x")];
        }
    });
}

describe("every method of the table, built on the exact state", () => {
    it("gives each item the operations it gets alone", () => {
        const catalogues = [
            generateCatalog(5201, { types: 3, influence: true, harvest: true, bench: true }),
            generateCatalog(5202, { base: "boots", eldritch: true, types: 3, veiled: true }),
        ];
        let parts = 0;
        for (const cat of catalogues) {
            const cu = harnessUniverse(cat);
            const r = rng(cat.seed);
            const names = {
                mod: "fire resistance",
                bench: cat.bench?.id ?? "x",
                tag: "attack",
                aspect: "cat",
            };
            const include = cat.mods
                .filter(
                    (m) => m.id === "FireRes1" || m.id === "FireRes3" || m.id === "BenchFireRes",
                )
                .map((m) => m.id);
            const states = harnessStates(cu, cat.ctx, cat.seed, {
                bounds: {
                    rows: pickRows(cu, cat.seed, 3, include.slice(0, 2).map(ModId)),
                    rarities: ["rare"],
                    influences: cu.influenceKeys.filter(
                        (k) => k === NO_INFLUENCE || k === influenceKey(["hunter"]),
                    ),
                    ...(cat.eldritch.length > 0 && {
                        exarch: [
                            { tier: 0, type: undefined },
                            ...[1, 3].map((t) => ({
                                tier: t,
                                type: cat.eldritch.find((e) => e.side === "exarch" && e.tier === t)!
                                    .type,
                            })),
                        ],
                        eater: [
                            { tier: 0, type: undefined },
                            ...[2].map((t) => ({
                                tier: t,
                                type: cat.eldritch.find((e) => e.side === "eater" && e.tier === t)!
                                    .type,
                            })),
                        ],
                    }),
                },
                random: 4,
            });
            for (const m of METHODS) {
                const literals = argsFor(m, names);
                for (const s of r.sample(states, 3)) {
                    parts += expectPartsAlike(cu, cat.ctx, s, m, literals);
                }
            }
        }
        expect(parts).toBeGreaterThan(METHODS.length);
    });

    it("runs each part exactly", () => {
        const cat = generateCatalog(5301, { types: 3, harvest: true, bench: true });
        const cu = harnessUniverse(cat);
        const change = findMethod(["harvest", "change"])!;
        const args = [str("fire resistance"), str("cold resistance")];
        const states = harnessStates(cu, cat.ctx, cat.seed, {
            bounds: {
                rows: pickRows(cu, cat.seed, 3, ["FireRes1", "BenchFireRes"].map(ModId)),
                rarities: ["rare"],
                crafted: true,
            },
            random: 8,
        });
        for (const s of states) {
            for (const p of buildMethod(fromItems(cu, s)!, change, args)) {
                if ("refused" in p.built) continue;
                const items = listItems(cu, p.state.dd, { lowest: true });
                expect(compareMethod(cu, cat.ctx, items, p.built)).toBe("");
            }
        }
    });
});
