import { describe, expect, it } from "vitest";
import { check, type CheckContext } from "./check.js";
import { buildRegistry } from "../resolve/registry.js";
import { narrowRange, rollRange } from "./values.js";
import { craft, hasValue, iff, item, notp, op, until } from "../__fixtures__/ast.js";
import {
    MAXLIFE_T1,
    MAXLIFE_T2,
    MAXLIFE_T3,
    RING_BASE,
    TIERED_CATALOG,
} from "../__fixtures__/mods.js";
import type { Rarity } from "../model/ids.js";

const registry = buildRegistry({ bases: [RING_BASE], mods: TIERED_CATALOG });
const ctx: CheckContext = { registry };
const LIFE = MAXLIFE_T1.type;
const ring = (
    prefixes: readonly (string | { mod: string; tier?: number })[] = [],
    rarity: Rarity = "rare",
) => item({ base: "IronRing", ilvl: 100, rarity, prefixes });

describe("a modifier's value", () => {
    it("is the first number of its text", () => {
        expect(rollRange("+(70-84) to maximum Life")).toEqual([70, 84]);
        expect(rollRange("+1 to Level of all Skill Gems")).toEqual([1, 1]);
        expect(rollRange("Adds (1-2) to (3-4) Damage")).toEqual([1, 2]);
        expect(rollRange("cannot roll Attack Modifiers")).toBeUndefined();
    });

    it("narrows a span by a comparison, exactly on whole numbers", () => {
        expect(narrowRange([70, 84], ">=", 75)).toEqual([75, 84]);
        expect(narrowRange([70, 84], "<", 75)).toEqual([70, 74]);
        expect(narrowRange([70, 84], ">", 84)).toBeNull();
        expect(narrowRange([70, 84], "==", 80)).toEqual([80, 80]);
        expect(narrowRange([70, 84], "!=", 80)).toEqual([70, 84]);
        expect(narrowRange([5.5, 7.5], "<", 6)).toEqual([5.5, 6]);
    });
});

describe("has <mod> <cmp> <n>", () => {
    it("divines until the roll is in range", () => {
        // T1 life rolls 115–129; the guide wants 120 or more.
        const c = craft(ring([{ mod: "maximum life", tier: 1 }]), [
            until(hasValue("maximum life", ">=", 120), [op("divine")]),
        ]);
        const r = check(c, ctx);
        expect(r.diagnostics).toEqual([]);
        expect(r.finalState!.values.get(LIFE)).toEqual([120, 129]);
    });

    it("is impossible when no roll of the tier reaches it", () => {
        const c = craft(ring([{ mod: "maximum life", tier: 3 }]), [
            iff(hasValue("maximum life", ">=", 50), [op("exalt")]),
        ]);
        expect(check(c, ctx).diagnostics.map((d) => d.message)).toEqual([
            expect.stringContaining("can never run"),
        ]);
    });

    it("pins the tiers whose rolls can reach it", () => {
        // Only the top tier (115–129) reaches 100; the others roll 70–84 and 10–24.
        const c = craft(ring(), [
            op("chaos"),
            until(hasValue("maximum life", ">=", 100), [op("chaos")]),
        ]);
        const r = check(c, ctx);
        expect(r.diagnostics).toEqual([]);
        expect(r.finalState!.tiers.get(LIFE)).toEqual(new Set([MAXLIFE_T1.id]));
        expect(r.finalState!.values.get(LIFE)).toEqual([115, 129]);
        expect(
            [MAXLIFE_T2.id, MAXLIFE_T3.id].some((id) => r.finalState!.tiers.get(LIFE)!.has(id)),
        ).toBe(false);
    });

    it("learns the other part of the span on the negative branch", () => {
        const c = craft(ring([{ mod: "maximum life", tier: 1 }]), [
            until(notp(hasValue("maximum life", ">=", 120)), [op("divine")]),
        ]);
        const r = check(c, ctx);
        expect(r.diagnostics).toEqual([]);
        expect(r.finalState!.values.get(LIFE)).toEqual([115, 119]);
    });

    it("forgets the value once the modifier is rolled again", () => {
        const c = craft(ring([{ mod: "maximum life", tier: 1 }]), [
            until(hasValue("maximum life", ">=", 120), [op("divine")]),
            op("chaos"),
        ]);
        const r = check(c, ctx);
        expect(r.diagnostics).toEqual([]);
        expect(r.finalState!.values.has(LIFE)).toBe(false);
    });

    it("the Divine Orb is refused on a Normal item", () => {
        const r = check(craft(ring([], "normal"), [op("divine")]), ctx);
        expect(r.diagnostics[0]?.message).toContain("Requires a Magic or Rare item");
    });
});
