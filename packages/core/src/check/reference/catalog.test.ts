import { describe, expect, it } from "vitest";
import { craft, item, op } from "../../__fixtures__/ast.js";
import { check } from "../check.js";
import { rollRange } from "../values.js";
import { effectsOf } from "../../model/effects.js";
import type { Mod } from "../../model/mod.js";
import { type Catalog, type CatalogOptions, generateCatalog, rng } from "./catalog.js";

const SEEDS = Array.from({ length: 30 }, (_, i) => i + 1);
const EVERYTHING: CatalogOptions = {
    bench: true,
    essenceOnly: true,
    influence: true,
    veiled: true,
    metamods: ["multimod", "prefixesCannotChange", "cannotRollAttack"],
};

/** The rows as plain data, to compare two catalogues. */
const shape = (c: Catalog): string =>
    JSON.stringify(
        c.mods.map((m) => ({ ...m, families: [...m.families], effects: effectsOf(m).length })),
        (_, v: unknown) => (v instanceof Set ? [...(v as Set<unknown>)] : v),
    ) + `@${c.ilvl}`;

describe("rng", () => {
    it("is the seed's", () => {
        const a = rng(42);
        const b = rng(42);
        const draws = Array.from({ length: 20 }, () => [a.next(), b.next()]);
        expect(draws.every(([x, y]) => x === y)).toBe(true);
        expect(rng(1).next()).not.toBe(rng(2).next());
    });
    it("draws whole numbers in range and distinct samples", () => {
        const r = rng(3);
        for (let i = 0; i < 200; i++) {
            const n = r.int(2, 4);
            expect(n >= 2 && n <= 4 && Number.isInteger(n)).toBe(true);
        }
        const s = r.sample([1, 2, 3, 4, 5], 3);
        expect(new Set(s).size).toBe(3);
        expect([...s].sort()).toEqual(s);
    });
});

describe("generateCatalog", () => {
    it("is the seed's", () => {
        expect(shape(generateCatalog(5, EVERYTHING))).toBe(shape(generateCatalog(5, EVERYTHING)));
        expect(shape(generateCatalog(5))).not.toBe(shape(generateCatalog(6)));
    });

    it.each(SEEDS)("seed %i: the shape the model expects", (seed) => {
        const c = generateCatalog(seed);
        const byType = new Map<string, Mod[]>();
        for (const m of c.natural) byType.set(m.type, [...(byType.get(m.type) ?? []), m]);
        expect(byType.size).toBeGreaterThanOrEqual(4);
        expect(byType.size).toBeLessThanOrEqual(8);
        expect(new Set(c.natural.map((m) => m.gen))).toEqual(new Set(["prefix", "suffix"]));
        for (const rows of byType.values()) {
            expect(rows.length).toBeGreaterThanOrEqual(1);
            expect(rows.length).toBeLessThanOrEqual(3);
            expect(new Set(rows.map((m) => m.minLevel)).size).toBe(rows.length);
            // A ladder shares its groups (item-model.md §9) and its side.
            const groups = rows.map((m) => [...m.families].sort().join());
            expect(new Set(groups).size).toBe(1);
            expect(new Set(rows.map((m) => m.gen)).size).toBe(1);
            for (const m of rows) {
                const span = rollRange(m.text ?? "");
                if (span !== undefined) expect(span[1] - span[0]).toBeLessThanOrEqual(2);
            }
        }
        // Some two types share a group.
        const owners = new Map<string, Set<string>>();
        for (const m of c.natural) {
            for (const f of m.families) owners.set(f, (owners.get(f) ?? new Set()).add(m.type));
        }
        expect([...owners.values()].some((types) => types.size > 1)).toBe(true);
        expect(c.bench).toBeUndefined();
        expect(c.mods.length).toBe(c.natural.length);
        // Some row the item's level rolls and some it stops short of; some row
        // with no number.
        expect(c.natural.some((m) => m.minLevel <= c.ilvl)).toBe(true);
        expect(c.natural.some((m) => m.minLevel > c.ilvl)).toBe(true);
        expect(c.natural.some((m) => rollRange(m.text ?? "") === undefined)).toBe(true);
    });

    it.each(SEEDS)("seed %i: every row numbered when asked", (seed) => {
        const c = generateCatalog(seed, { unnumbered: false, ilvl: 100 });
        expect(c.natural.every((m) => rollRange(m.text ?? "") !== undefined)).toBe(true);
        expect(c.natural.some((m) => m.minLevel > 100)).toBe(true);
    });

    it("one row the base's own tag gives no weight", () => {
        const c = generateCatalog(2, { zeroWeight: true });
        const zeroed = c.natural.filter((m) => m.spawn[0]?.weight === 0);
        expect(zeroed.length).toBe(1);
        expect(c.base.tags.has(zeroed[0]!.spawn[0]!.tag)).toBe(true);
    });

    it("an essence row above the top of a natural ladder", () => {
        const c = generateCatalog(3, { essenceOnly: "ladder" });
        const ladder = c.natural.filter((m) => m.type === c.essence?.type);
        expect(ladder.length).toBeGreaterThan(0);
        expect(c.essence!.minLevel).toBeGreaterThan(Math.max(...ladder.map((m) => m.minLevel)));
        expect(c.essence!.families).toEqual(ladder[0]!.families);
        expect(c.essence!.source).toBe("essence");
    });

    it("bases of every cap shape, natural rows of the base's domain", () => {
        for (const base of ["flask", "ratcheting", "simplex", "jewel"] as const) {
            const c = generateCatalog(1, { base });
            expect(c.natural.every((m) => m.domain === c.base.domain)).toBe(true);
        }
        expect(generateCatalog(1, { base: "flask" }).base.domain).toBe("flask");
        expect(generateCatalog(1, { base: "simplex" }).base.capDelta).toBeDefined();
    });

    it("adds each optional feature on request", () => {
        const c = generateCatalog(9, EVERYTHING);
        expect(c.bench?.source).toBe("bench");
        expect(c.natural.some((m) => m.type === c.bench?.type)).toBe(true);
        expect(c.registry.benchTypesFor(c.base.itemClass).has(c.bench!.type)).toBe(true);
        expect(c.essence?.source).toBe("essence");
        expect(c.essence?.spawn.every((s) => s.weight === 0)).toBe(true);
        expect(c.registry.essences[0]?.grants.get(c.base.itemClass)).toBe(c.essence?.id);
        expect(c.influence?.spawn[0]?.tag).toBe("ring_basilisk");
        expect(c.veiled.map((m) => m.type)).toEqual([
            "VeiledPrefix",
            "VeiledSuffix",
            "TypeUnveiledPrefix",
            "TypeUnveiledSuffix",
        ]);
        expect(c.veiled.slice(2).map((m) => m.gen)).toEqual(["prefix", "suffix"]);
        // The registry gives each metamod its effect.
        expect(c.metamods.map((m) => effectsOf(m)[0]?.kind)).toEqual([
            "craftedCap",
            "protect",
            "poolRestrict",
        ]);
    });

    it("eldritch rows of both sides at every tier on a base that takes them", () => {
        const c = generateCatalog(4, { base: "boots", eldritch: true });
        for (const side of ["exarch", "eater"] as const) {
            for (let tier = 1; tier <= 6; tier++) {
                expect(c.registry.eldritchRows(c.base, side, tier).length).toBeGreaterThan(0);
            }
        }
        expect(() => generateCatalog(4, { base: "ring", eldritch: true })).toThrow();
    });

    it.each(SEEDS)("seed %i: the checker takes its registry", (seed) => {
        const c = generateCatalog(seed, EVERYTHING);
        const block = (rarity: "normal" | "rare") =>
            item({ base: c.base.id, ilvl: c.ilvl, rarity });
        for (const [rarity, steps] of [
            ["normal", ["transmute"]],
            ["normal", ["alchemy"]],
            ["rare", ["chaos"]],
        ] as const) {
            const r = check(craft(block(rarity), steps.map(op)), { registry: c.registry });
            expect(r.diagnostics.map((d) => d.message)).toEqual([]);
            expect(r.finalState).toBeDefined();
        }
    });

    it.each(["flask", "ratcheting", "simplex", "jewel", "boots", "amulet"] as const)(
        "a %s's registry the checker takes",
        (base) => {
            for (const seed of SEEDS.slice(0, 5)) {
                const c = generateCatalog(seed, { base, bench: true, essenceOnly: "ladder" });
                const steps = base === "flask" ? ["transmute"] : ["alchemy", "chaos"];
                const block = item({ base: c.base.id, ilvl: c.ilvl, rarity: "normal" });
                const r = check(craft(block, steps.map(op)), { registry: c.registry });
                expect(r.diagnostics.map((d) => d.message)).toEqual([]);
            }
        },
    );
});
