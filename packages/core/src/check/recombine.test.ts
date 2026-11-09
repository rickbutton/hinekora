import { describe, expect, it } from "vitest";
import { check, type CheckContext } from "./check.js";
import { cardinalityGuarantees, guaranteedTypes, isGuaranteed } from "./astate.js";
import { buildRegistry } from "../resolve/registry.js";
import { andp, craft, donor, has, item, recombine, until } from "../__fixtures__/ast.js";
import {
    AMULET_BASE,
    BENCH_LIFE_ROW,
    CATALOG,
    CLASS_RING,
    INCREASED_MANA,
    LIFE_T1,
    RING_BASE,
} from "../__fixtures__/mods.js";

const registry = buildRegistry({
    bases: [RING_BASE, AMULET_BASE],
    mods: [...CATALOG, BENCH_LIFE_ROW],
    baseAliases: { "Iron Ring": "IronRing", "Coral Amulet": "CoralAmulet" },
    benchCrafts: [{ mod: BENCH_LIFE_ROW.id, tier: 1, itemClasses: new Set([CLASS_RING]) }],
});
const ctx: CheckContext = { registry };
const ring = (
    prefixes: string[] = [],
    suffixes: string[] = [],
    rarity: "normal" | "magic" | "rare" = "magic",
    ilvl = 84,
) => item({ base: "Iron Ring", ilvl, rarity, prefixes, suffixes });

describe("recombine", () => {
    it("pools the two items' modifiers and keeps some of them", () => {
        // Two Magic rings, one prefix each: the result has one or two prefixes,
        // at least one of the two, no suffix, and may be Magic or Rare.
        const c = craft(
            ring([LIFE_T1.id]),
            [recombine("other")],
            [],
            [],
            [donor("other", ring([INCREASED_MANA.id]))],
        );
        const r = check(c, ctx);
        expect(r.diagnostics).toEqual([]);
        const s = r.finalState!;
        expect(s.counts.prefix).toEqual([1, 2]);
        expect(s.counts.suffix).toEqual([0, 0]);
        expect(guaranteedTypes(s).size).toBe(0);
        const [one, ...rest] = cardinalityGuarantees(s);
        expect(rest).toEqual([]);
        expect(one?.atLeast).toBe(1);
        expect(new Set(one?.types)).toEqual(new Set([LIFE_T1.type, INCREASED_MANA.type]));
        expect(s.rarities).toEqual(new Set(["magic", "rare"]));
        expect(s.tiers.get(LIFE_T1.type)).toEqual(new Set([LIFE_T1.id]));
    });

    it("is the step a guide repeats until both modifiers sit together", () => {
        const c = craft(
            ring([LIFE_T1.id]),
            [until(andp(has(LIFE_T1.id), has(INCREASED_MANA.id)), [recombine("other")])],
            [],
            [],
            [donor("other", ring([INCREASED_MANA.id]))],
        );
        const r = check(c, ctx);
        expect(r.diagnostics).toEqual([]);
        expect(isGuaranteed(r.finalState!, LIFE_T1.type)).toBe(true);
        expect(isGuaranteed(r.finalState!, INCREASED_MANA.type)).toBe(true);
    });

    it("takes the item level of the inputs' average plus two, capped at the higher", () => {
        const c = craft(
            ring([LIFE_T1.id], [], "magic", 84),
            [recombine("other")],
            [],
            [],
            [donor("other", ring([INCREASED_MANA.id], [], "magic", 79))],
        );
        expect(check(c, ctx).finalState!.ilvl).toBe(83);
    });

    it("refuses a Normal item, a corrupted one, another class or another base", () => {
        const messages = (c: ReturnType<typeof craft>): string =>
            check(c, ctx)
                .diagnostics.map((d) => d.message)
                .join("\n");
        expect(
            messages(craft(ring([], [], "normal"), [recombine("o")], [], [], [donor("o", ring())])),
        ).toContain("Requires two Magic or Rare items");
        expect(
            messages(
                craft(
                    ring([LIFE_T1.id]),
                    [recombine("o")],
                    [],
                    [],
                    [donor("o", item({ base: "Coral Amulet", ilvl: 84, rarity: "magic" }))],
                ),
            ),
        ).toContain("two items of one class");
        expect(messages(craft(ring([LIFE_T1.id]), [recombine("nobody")]))).toContain(
            'no second item is named "nobody"',
        );
    });

    it("lets at most one crafted modifier through, so a side may come out empty", () => {
        const c = craft(
            ring([BENCH_LIFE_ROW.id], [], "rare"),
            [recombine("other")],
            [],
            [],
            [donor("other", ring([INCREASED_MANA.id]))],
        );
        const s = check(c, ctx).finalState!;
        expect(s.counts.prefix).toEqual([0, 2]);
        expect(s.crafted).toEqual([0, 1]);
    });
});
