import { describe, expect, it } from "vitest";
import { check, type CheckContext } from "./check.js";
import { buildRegistry } from "../resolve/registry.js";
import { narrowRange, rollRange } from "./values.js";
import {
    bench,
    craft,
    essence,
    has,
    hasValue,
    iff,
    item,
    notp,
    op,
    stop,
    until,
} from "../__fixtures__/ast.js";
import {
    AMULET_ES_ROW,
    BENCH_MAXLIFE_ROW,
    CLASS_RING,
    MAXLIFE_ARMOUR_ONLY,
    MAXLIFE_BLANK,
    MAXLIFE_T1,
    MAXLIFE_T2,
    MAXLIFE_T3,
    PROTECT_PREFIXES_CARRIER,
    RING_BASE,
    TIERED_CATALOG,
} from "../__fixtures__/mods.js";
import type { Rarity } from "../model/ids.js";
import type { EssenceSpec } from "../model/sources.js";

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

    it("compares a benched modifier by the bench row's own span", () => {
        const benched = buildRegistry({
            bases: [RING_BASE],
            mods: [...TIERED_CATALOG, BENCH_MAXLIFE_ROW],
            benchCrafts: [
                { mod: BENCH_MAXLIFE_ROW.id, tier: 1, itemClasses: new Set([CLASS_RING]) },
            ],
        });
        const c = craft(ring(), [
            bench("maximum life"),
            until(hasValue("maximum life", ">=", 20), [op("divine")]),
        ]);
        const r = check(c, { registry: benched });
        expect(r.diagnostics).toEqual([]);
        expect(r.finalState!.values.get(LIFE)).toEqual([20, 25]);
    });

    it("neither rules a row without a number in nor out", () => {
        const blank = buildRegistry({
            bases: [RING_BASE],
            mods: [...TIERED_CATALOG, MAXLIFE_BLANK],
        });
        const guarded = (pred: Parameters<typeof iff>[0]) =>
            check(craft(ring(), [until(has("maximum life"), [op("chaos")]), iff(pred, [stop()])]), {
                registry: blank,
            });
        // What continues past `if has >= 115 { stop }` is the negative branch.
        const below = guarded(hasValue("maximum life", ">=", 115));
        expect(below.diagnostics).toEqual([]);
        const lower = below.finalState!.tiers.get(LIFE);
        expect(lower?.has(MAXLIFE_BLANK.id)).toBe(true);
        expect(lower?.has(MAXLIFE_T1.id)).toBe(false);
        expect(below.finalState!.values.get(LIFE)).toBeUndefined();
        // And past `if not has >= 115 { stop }`, the positive one.
        const above = guarded(notp(hasValue("maximum life", ">=", 115)));
        expect(above.diagnostics).toEqual([]);
        const upper = above.finalState!.tiers.get(LIFE);
        expect(upper?.has(MAXLIFE_BLANK.id)).toBe(true);
        expect(upper?.has(MAXLIFE_T1.id)).toBe(true);
        expect(upper?.has(MAXLIFE_T2.id)).toBe(false);
        expect(above.finalState!.values.get(LIFE)).toBeUndefined();
    });

    it("reads the row an essence places even where it never rolls", () => {
        // The grove's and the bench's rows aside, an essence puts its row on the
        // item whatever the row's weight on the base.
        const woe: EssenceSpec = {
            id: "TestWoeShrieking",
            name: "Shrieking Essence of Woe",
            tier: 6,
            grants: new Map([[CLASS_RING, AMULET_ES_ROW.id]]),
        };
        const placed = buildRegistry({
            bases: [RING_BASE],
            mods: [...TIERED_CATALOG, AMULET_ES_ROW],
            essences: [woe],
        });
        const c = craft(ring(), [
            essence("Shrieking Essence of Woe"),
            iff(hasValue("energy shield", ">=", 35), [op("divine")]),
        ]);
        expect(check(c, { registry: placed }).diagnostics).toEqual([]);
    });

    it("reads only the rows the item may carry, so another base's row is out of reach", () => {
        const armour = buildRegistry({
            bases: [RING_BASE],
            mods: [...TIERED_CATALOG, MAXLIFE_ARMOUR_ONLY],
        });
        const c = craft(ring([{ mod: "maximum life", tier: 1 }]), [
            iff(hasValue("maximum life", ">=", 200), [op("exalt")]),
        ]);
        expect(check(c, { registry: armour }).diagnostics.map((d) => d.message)).toEqual([
            expect.stringContaining("can never run"),
        ]);
    });

    it("the Divine Orb leaves the values of a side that cannot be changed", () => {
        const locked = buildRegistry({
            bases: [RING_BASE],
            mods: [...TIERED_CATALOG, PROTECT_PREFIXES_CARRIER],
        });
        const inRange = (suffixes: string[]) =>
            check(
                craft(
                    item({
                        base: "IronRing",
                        ilvl: 100,
                        rarity: "rare",
                        prefixes: [{ mod: "maximum life", tier: 1 }],
                        suffixes,
                    }),
                    [iff(notp(hasValue("maximum life", ">=", 125)), [stop()]), op("divine")],
                ),
                { registry: locked },
            );
        expect(inRange([PROTECT_PREFIXES_CARRIER.id]).finalState!.values.get(LIFE)).toEqual([
            125, 129,
        ]);
        expect(inRange([]).finalState!.values.get(LIFE)).toBeUndefined();
    });

    it("the Divine Orb is refused on a Normal item", () => {
        const r = check(craft(ring([], "normal"), [op("divine")]), ctx);
        expect(r.diagnostics[0]?.message).toContain("Requires a Magic or Rare item");
    });
});
