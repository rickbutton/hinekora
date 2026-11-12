import { describe, expect, it } from "vitest";
import {
    ATTACK_PREFIX,
    BENCH_LIFE_ROW,
    CANNOT_ROLL_ATTACK_CARRIER,
    CATALOG,
    FIRE_RES_TIERED,
    MAXLIFE_T1,
    MAXLIFE_T2,
    MAXLIFE_T3,
    PROTECT_ONE_PREFIX_CARRIER,
    PROTECT_PREFIXES_CARRIER,
    RING_BASE,
    VEILED_CATALOG,
} from "../__fixtures__/mods.js";
import { craft, item, op, unveil } from "../__fixtures__/ast.js";
import { check } from "../check/check.js";
import { currencyOps, unveilOps } from "../check/library.js";
import { rollRange } from "../check/values.js";
import type { CItem } from "../check/item.js";
import { fromItems } from "../check/state.js";
import { ModId, TypeId } from "../model/ids.js";
import { NO_INFLUENCE } from "../model/marks.js";
import type { Mod } from "../model/mod.js";
import { buildRegistry } from "../resolve/registry.js";
import { foulbornRows, rollOf, unmodelled } from "./roll.js";

const registry = buildRegistry({
    bases: [RING_BASE],
    mods: [...CATALOG],
    modAliases: { "T1 Life": "IncreasedLife1" },
    baseAliases: { "Iron Ring": "IronRing" },
});
const protecting = buildRegistry({
    bases: [RING_BASE],
    mods: [...CATALOG, PROTECT_PREFIXES_CARRIER],
    baseAliases: { "Iron Ring": "IronRing" },
});

describe("a random removal's reach", () => {
    it("is limited to one side by a protecting metamod, not by a side that is empty", () => {
        // No prefixes now, but the Orb of Annulment reaches both sides: a loop
        // that exalts a prefix back on can annul it again.
        const open = craft(
            item({
                base: "Iron Ring",
                ilvl: 84,
                rarity: "rare",
                suffixes: ["FireResist1", "ColdResist1"],
            }),
            [],
        );
        const a = check(open, { registry }).finalState!;
        for (const reading of ["estimate", "floors", "ceilings"] as const) {
            const roll = rollOf(a, currencyOps("annul"), registry, reading);
            if (roll.kind !== "removal") throw new Error("not a removal");
            expect(roll.gen).toBeUndefined();
        }
        // "Prefixes Cannot Be Changed" leaves the suffixes alone in reach.
        const kept = craft(
            item({
                base: "Iron Ring",
                ilvl: 84,
                rarity: "rare",
                prefixes: ["IncreasedLife1"],
                suffixes: ["FireResist1", PROTECT_PREFIXES_CARRIER.id],
            }),
            [],
        );
        const b = check(kept, { registry: protecting }).finalState!;
        const roll = rollOf(b, currencyOps("annul"), protecting);
        if (roll.kind !== "removal") throw new Error("not a removal");
        expect(roll.gen).toBe("suffix");
    });
});

describe("a random removal's odds", () => {
    it("never take a fractured modifier", () => {
        // Two prefixes and a fractured suffix: the Orb of Annulment takes one
        // of the two prefixes, each half the time, and the suffix never.
        const c = craft(
            item({
                base: "Iron Ring",
                ilvl: 84,
                rarity: "rare",
                prefixes: ["IncreasedLife1", "IncreasedMana1"],
                suffixes: [{ mod: "FireResist1", fractured: true }],
            }),
            [],
        );
        const a = check(c, { registry }).finalState!;
        const roll = rollOf(a, currencyOps("annul"), registry);
        if (roll.kind !== "removal") throw new Error("not a removal");
        expect(roll.sides.suffix.unnamed).toBe(0);
        expect(roll.candidates.map((x) => x.prob)).toEqual([0.5, 0.5]);
    });

    it("take a modifier a cannot-roll metamod bars as likely as the metamod", () => {
        // Version 3.30.0 (Item Changes): the metamod keeps no Orb of Annulment
        // off the attack modifier.
        const barring = buildRegistry({
            bases: [RING_BASE],
            mods: [...CATALOG, ATTACK_PREFIX, CANNOT_ROLL_ATTACK_CARRIER],
            baseAliases: { "Iron Ring": "IronRing" },
        });
        const c = craft(
            item({
                base: "Iron Ring",
                ilvl: 84,
                rarity: "rare",
                prefixes: [ATTACK_PREFIX.id],
                suffixes: [CANNOT_ROLL_ATTACK_CARRIER.id],
            }),
            [],
        );
        const a = check(c, { registry: barring }).finalState!;
        const roll = rollOf(a, currencyOps("annul"), barring);
        if (roll.kind !== "removal") throw new Error("not a removal");
        expect(roll.candidates.map((x) => [x.type, x.prob])).toEqual([
            [ATTACK_PREFIX.type, 0.5],
            [CANNOT_ROLL_ATTACK_CARRIER.type, 0.5],
        ]);
    });
});

describe("a random removal beside a partial protection", () => {
    // "1 Prefix Modifier cannot be changed" keeps one prefix, each as likely
    // (QUESTIONS.md Q128): of three, two are in reach on a use.
    const partial = buildRegistry({
        bases: [RING_BASE],
        mods: [...CATALOG, PROTECT_ONE_PREFIX_CARRIER],
        baseAliases: { "Iron Ring": "IronRing" },
    });
    const c = craft(
        item({
            base: "Iron Ring",
            ilvl: 84,
            rarity: "rare",
            prefixes: ["IncreasedLife1", "IncreasedMana1", "IncreasedArmour1"],
            suffixes: [PROTECT_ONE_PREFIX_CARRIER.id],
        }),
        [],
    );

    it("takes each prefix two times in nine, the metamod three", () => {
        const r = check(c, { registry: partial });
        expect(r.diagnostics).toEqual([]);
        const a = r.finalState!;
        const roll = rollOf(a, currencyOps("annul"), partial);
        if (roll.kind !== "removal") throw new Error("not a removal");
        const probs = new Map(roll.candidates.map((x) => [x.type as string, x.prob]));
        expect(probs.size).toBe(4);
        expect(probs.get(PROTECT_ONE_PREFIX_CARRIER.type)).toBeCloseTo(1 / 3, 9);
        for (const [t, p] of probs)
            if (t !== PROTECT_ONE_PREFIX_CARRIER.type) {
                expect(p).toBeCloseTo(2 / 9, 9);
            }
    });

    it("leaves a reforge's chances unknown", () => {
        const a = check(c, { registry: partial }).finalState!;
        expect(unmodelled(currencyOps("chaos"), a, partial)).toMatch(/chosen at random each use/);
        expect(unmodelled(currencyOps("annul"), a, partial)).toBeUndefined();
    });

    it("leaves a removal's chances unknown where two keep some of one side", () => {
        const twoPrefixes: Mod = {
            ...PROTECT_ONE_PREFIX_CARRIER,
            id: ModId("MetaTwoPrefixesCannotChange"),
            type: TypeId("MetaTwoPrefixesCannotChange"),
            gen: "prefix",
            effects: [{ kind: "protectSome", gen: "prefix", count: 2 }],
            text: "2 prefix modifiers cannot be changed",
        };
        const both = buildRegistry({
            bases: [RING_BASE],
            mods: [...CATALOG, PROTECT_ONE_PREFIX_CARRIER, twoPrefixes],
            baseAliases: { "Iron Ring": "IronRing" },
        });
        const two = craft(
            item({
                base: "Iron Ring",
                ilvl: 84,
                rarity: "rare",
                prefixes: ["IncreasedLife1", "IncreasedMana1", twoPrefixes.id],
                suffixes: [PROTECT_ONE_PREFIX_CARRIER.id],
            }),
            [],
        );
        const a = check(two, { registry: both }).finalState!;
        expect(unmodelled(currencyOps("annul"), a, both)).toMatch(/how many they keep together/);
        expect(unmodelled(currencyOps("exalt"), a, both)).toBeUndefined();
    });
});

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

describe("memory strands in the pool", () => {
    it("cull the lower tiers at the strands the item surely has, the ceiling under that reading", () => {
        const c = craft(item({ base: "Iron Ring", ilvl: 84, rarity: "rare", strands: 82 }), [
            op("chaos"),
            op("chaos"),
            op("chaos"),
        ]);
        // Three Chaos Orbs may have used every strand: the estimate reads none
        // left and both life tiers roll; the ceilings reading keeps the 82.
        const a = check(c, { registry }).finalState!;
        const rowsOf = (roll: ReturnType<typeof rollOf>): string[] => {
            if (roll.kind !== "draw") throw new Error("not a draw");
            const members = roll.variants[0]!.prefix.flatMap((g) => g.members);
            const life = members.find((m) => m.type === "IncreasedLife");
            return (life?.rows ?? []).map((r) => r.mod.id).sort();
        };
        expect(rowsOf(rollOf(a, currencyOps("chaos"), registry))).toEqual([
            "IncreasedLife1",
            "IncreasedLife2",
        ]);
        expect(rowsOf(rollOf(a, currencyOps("chaos"), registry, "ceilings"))).toEqual([
            "IncreasedLife1",
        ]);
    });
});

describe("a modifier the item keeps through a roll", () => {
    it("may be a bench row beside a row of its ladder", () => {
        // Where a path that benched the modifier meets one that rolled it,
        // the item may hold either.
        const benched = buildRegistry({
            bases: [RING_BASE],
            mods: [...CATALOG, BENCH_LIFE_ROW],
            baseAliases: { "Iron Ring": "IronRing" },
        });
        // The block names the bench row, so the check's items may hold it.
        const c = craft(
            item({ base: "Iron Ring", ilvl: 40, rarity: "rare", prefixes: [BENCH_LIFE_ROW.id] }),
            [],
        );
        const { u } = check(c, { registry: benched }).finalState!;
        const holding = (row: Mod): CItem => ({
            rarity: "rare",
            mods: [
                {
                    row: row.id,
                    value: row.text === undefined ? undefined : rollRange(row.text)?.[0],
                    fractured: false,
                    crafted: row.source === "bench",
                },
            ],
            influences: NO_INFLUENCE,
            corrupted: false,
            exarch: { tier: 0, type: undefined },
            eater: { tier: 0, type: undefined },
            strands: 0,
            imprint: undefined,
        });
        const ladder = benched.resolveMod(ModId("IncreasedLife2"));
        if (!ladder.ok) throw new Error("no IncreasedLife2");
        const a = fromItems(u, [holding(ladder.value), holding(BENCH_LIFE_ROW)])!;
        const roll = rollOf(a, currencyOps("exalt"), benched);
        if (roll.kind !== "draw") throw new Error("not a draw");
        const life = roll.variants[0]!.present.find((p) => p.type === "IncreasedLife")!;
        // The ladder's row by its spawn weight, the bench's, which never spawns, at one.
        expect(Object.fromEntries(life.rows.map((r) => [r.mod.id, r.weight]))).toEqual({
            IncreasedLife2: 2000,
            BenchLife1: 1,
        });
    });
});

describe("an unveil", () => {
    it("offers the modifiers of the veiled modifier's own side", () => {
        const veiled = buildRegistry({
            bases: [RING_BASE],
            mods: [...CATALOG, ...VEILED_CATALOG],
            baseAliases: { "Iron Ring": "IronRing" },
        });
        const c = craft(
            item({
                base: "Iron Ring",
                ilvl: 84,
                rarity: "rare",
                prefixes: ["IncreasedMana1"],
                suffixes: ["VeiledSuffix", "FireResist1"],
            }),
            [unveil()],
        );
        const a = check(c, { registry: veiled }).trace[0]!.before;
        const roll = rollOf(a, unveilOps(undefined), veiled);
        if (roll.kind !== "unveil") throw new Error("not an unveil");
        expect(roll.options.map((m) => m.rows[0]!.mod.gen)).toEqual(["suffix", "suffix"]);
    });
});
