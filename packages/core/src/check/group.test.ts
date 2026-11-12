import { describe, expect, it } from "vitest";
import { check, type CheckContext } from "./check.js";
import { disjunctiveGuarantees, isExcluded } from "./views.js";
import { buildRegistry } from "../resolve/registry.js";
import { bench, craft, has, iff, item, notp, op, until } from "../__fixtures__/ast.js";
import {
    BENCH_LIFE_ROW,
    CATALOG,
    CLASS_RING,
    FIRE_CHAOS_RESIST,
    FIRE_RESIST,
    LIFE_T1,
    RING_BASE,
} from "../__fixtures__/mods.js";

const registry = buildRegistry({
    bases: [RING_BASE],
    mods: [...CATALOG, BENCH_LIFE_ROW],
    modAliases: { "T1 Life": "IncreasedLife1" },
    baseAliases: { "Iron Ring": "IronRing" },
    benchCrafts: [{ mod: BENCH_LIFE_ROW.id, tier: 1, itemClasses: new Set([CLASS_RING]) }],
});
const ctx: CheckContext = { registry };
const ring = (prefixes: string[] = [], suffixes: string[] = []) =>
    item({ base: "Iron Ring", ilvl: 100, rarity: "rare", prefixes, suffixes });
const group = (mod: string) => ({ ...has(mod), group: true as const });

describe("has group", () => {
    it("names the types that share a modifier group", () => {
        expect(registry.groupOf(FIRE_RESIST.type)).toEqual(
            new Set([FIRE_RESIST.type, FIRE_CHAOS_RESIST.type]),
        );
    });

    it("rules the whole group out, so the bench craft of it is let through", () => {
        // A random prefix may be the life; `not has "maximum life"` alone would
        // leave the group's other wordings possible, `not has group` clears them.
        const c = craft(ring(["random"], [FIRE_RESIST.id]), [
            iff(notp(group("maximum life")), [bench("maximum life")]),
        ]);
        const r = check(c, ctx);
        expect(r.diagnostics).toEqual([]);
    });

    it("is true for any member of the group, as a disjunction when several may be there", () => {
        const c = craft(ring([LIFE_T1.id], ["random"]), [
            iff(group(FIRE_RESIST.id), [op("exalt")], [op("annul")]),
        ]);
        const r = check(c, ctx);
        expect(r.diagnostics).toEqual([]);
        const inside = check(
            craft(ring([LIFE_T1.id], ["random"]), [until(group(FIRE_RESIST.id), [op("chaos")])]),
            ctx,
        );
        expect(inside.diagnostics).toEqual([]);
        const clause = disjunctiveGuarantees(inside.finalState!).find((c) =>
            c.includes(FIRE_RESIST.type),
        );
        expect(new Set(clause)).toEqual(new Set([FIRE_RESIST.type, FIRE_CHAOS_RESIST.type]));
    });

    it("is impossible when no member of the group can be on the item", () => {
        const r = check(
            craft(ring([LIFE_T1.id]), [iff(group(FIRE_RESIST.id), [op("exalt")])]),
            ctx,
        );
        expect(r.diagnostics.map((d) => d.message)).toEqual([
            expect.stringContaining("can never run"),
        ]);
    });

    it("excludes every member after the negative branch", () => {
        const r = check(
            craft(ring([LIFE_T1.id], ["random"]), [iff(group(FIRE_RESIST.id), [op("annul")])]),
            ctx,
        );
        expect(r.diagnostics).toEqual([]);
        const after = check(
            craft(ring([LIFE_T1.id], ["random"]), [
                until(notp(group(FIRE_RESIST.id)), [op("annul")]),
            ]),
            ctx,
        ).finalState!;
        expect(isExcluded(after, FIRE_RESIST.type)).toBe(true);
        expect(isExcluded(after, FIRE_CHAOS_RESIST.type)).toBe(true);
    });
});
