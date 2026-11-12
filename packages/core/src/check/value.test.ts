import { describe, expect, it } from "vitest";
import { check, type CheckContext } from "./check.js";
import * as v from "./views.js";
import { rowIds } from "../__fixtures__/views.js";
import { buildRegistry } from "../resolve/registry.js";
import { narrowRange, rollRange } from "./values.js";
import {
    andp,
    bench,
    cmp,
    craft,
    essence,
    has,
    hasValue,
    iff,
    item,
    notp,
    op,
    orp,
    stop,
    until,
} from "../__fixtures__/ast.js";
import {
    AMULET_ES_ROW,
    BENCH_MAXLIFE_ROW,
    CLASS_RING,
    FILLERS,
    MAXLIFE_ARMOUR_ONLY,
    MAXLIFE_BLANK,
    MAXLIFE_T1,
    MAXLIFE_T2,
    MAXLIFE_T3,
    PROTECT_PREFIXES_CARRIER,
    RING_BASE,
    SIMPLEX_BASE,
    STAFFY_ADDER,
    STAFFY_VALUE,
    TIERED_CATALOG,
} from "../__fixtures__/mods.js";
import type { OperationStmt } from "../ast/ast.js";
import type { Rarity } from "../model/ids.js";
import type { EssenceSpec } from "../model/sources.js";

const registry = buildRegistry({ bases: [RING_BASE], mods: TIERED_CATALOG });
const ctx: CheckContext = { registry };
const LIFE = MAXLIFE_T1.type;
const ring = (
    prefixes: readonly (string | { mod: string; tier?: number })[] = [],
    rarity: Rarity = "rare",
) => item({ base: "IronRing", ilvl: 100, rarity, prefixes });

describe("a value condition where paths left different items", () => {
    it("is read against each of them", () => {
        // One path kept the life the Exalted Orb rolled, the other removed
        // what it rolled; only the first can meet the condition.
        const c = craft(ring(), [
            op("exalt"),
            iff(notp(has("maximum life")), [op("annul")]),
            iff(hasValue("maximum life", ">=", 100), [op("annul")]),
        ]);
        const r = check(c, ctx);
        expect(r.diagnostics).toEqual([]);
        const inside = r.trace.filter((e) => e.kind === "operation").at(-1)!;
        expect(v.counts(inside.before).total).toEqual([1, 1]);
        expect(v.counts(r.finalState!).total).toEqual([0, 1]);
    });
});

describe("a modifier's value", () => {
    it("is the first number of its text", () => {
        expect(rollRange("+(70-84) to maximum Life")).toEqual([70, 84]);
        expect(rollRange("+1 to Level of all Skill Gems")).toEqual([1, 1]);
        expect(rollRange("Adds (1-2) to (3-4) Damage")).toEqual([1, 2]);
        expect(rollRange("cannot roll Attack Modifiers")).toBeUndefined();
    });

    it("is a fixed first number even where a rolled one follows", () => {
        expect(rollRange("Adds 3 to (46-53) Lightning Damage")).toEqual([3, 3]);
        expect(rollRange("30% increased Movement Speed\n(6-9)% chance to Avoid Bleeding")).toEqual([
            30, 30,
        ]);
    });

    it("reads a span written high to low in order, so a comparison can hold", () => {
        const span = rollRange(
            "Instant Recovery when on Low Life\n(30-27)% reduced Amount Recovered",
        );
        expect(span).toEqual([27, 30]);
        expect(narrowRange(span!, "<=", 28)).toEqual([27, 28]);
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

describe("has <mod> t<n> <cmp> <n>, on a modifier at another tier", () => {
    it("fails, so the else branch runs", () => {
        // The item's life is the second tier: "the first tier at 120 or more"
        // is false of it, not both impossible and always true.
        const c = craft(ring([{ mod: "maximum life", tier: 2 }]), [
            iff(hasValue("maximum life", ">=", 120, 1), [op("annul")], [op("exalt")]),
        ]);
        expect(check(c, ctx).diagnostics.map((d) => d.message)).toEqual([
            `the 'if' branch can never run: has "maximum life" t1 >= 120 is impossible here`,
        ]);
    });

    it("says nothing of the tier or the value where the comparison fails", () => {
        // Life of an unknown tier: without the first tier at 120 or more it
        // may be the first below 120, or any other tier at any value.
        const c = craft(ring(), [
            until(has("maximum life"), [op("chaos")]),
            iff(
                hasValue("maximum life", ">=", 120, 1),
                [],
                [iff(has("maximum life", 2), [op("annul")])],
            ),
        ]);
        expect(check(c, ctx).diagnostics).toEqual([]);
    });

    it("leaves the tiers it does not name where the item may be at several", () => {
        const c = craft(ring(), [
            until(orp(has("maximum life", 1), has("maximum life", 2)), [op("chaos")]),
            iff(hasValue("maximum life", ">=", 120, 1), [stop()]),
        ]);
        const r = check(c, ctx);
        expect(r.diagnostics).toEqual([]);
        expect(rowIds(r.finalState!, LIFE)).toEqual(new Set(["MaxLifeHigh", "MaxLifeMid"]));
        // The first tier is held below 120; the second keeps its whole span.
        expect(v.valueSpan(r.finalState!, LIFE, MAXLIFE_T1.id)).toEqual([115, 119]);
        expect(v.valueSpan(r.finalState!, LIFE, MAXLIFE_T2.id)).toEqual([70, 84]);
    });
});

describe("has <mod> <cmp> <n>", () => {
    it("divines until the roll is in range", () => {
        // T1 life rolls 115–129; the craft wants 120 or more.
        const c = craft(ring([{ mod: "maximum life", tier: 1 }]), [
            until(hasValue("maximum life", ">=", 120), [op("divine")]),
        ]);
        const r = check(c, ctx);
        expect(r.diagnostics).toEqual([]);
        expect(v.valueSpan(r.finalState!, LIFE)).toEqual([120, 129]);
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
        expect(rowIds(r.finalState!, LIFE)).toEqual(new Set([MAXLIFE_T1.id]));
        expect(v.valueSpan(r.finalState!, LIFE)).toEqual([115, 129]);
        expect(
            [MAXLIFE_T2.id, MAXLIFE_T3.id].some((id) => rowIds(r.finalState!, LIFE).has(id)),
        ).toBe(false);
    });

    it("learns the other part of the span on the negative branch", () => {
        const c = craft(ring([{ mod: "maximum life", tier: 1 }]), [
            until(notp(hasValue("maximum life", ">=", 120)), [op("divine")]),
        ]);
        const r = check(c, ctx);
        expect(r.diagnostics).toEqual([]);
        expect(v.valueSpan(r.finalState!, LIFE)).toEqual([115, 119]);
    });

    it("forgets the value once the modifier is rolled again", () => {
        const c = craft(ring([{ mod: "maximum life", tier: 1 }]), [
            until(hasValue("maximum life", ">=", 120), [op("divine")]),
            op("chaos"),
        ]);
        const r = check(c, ctx);
        expect(r.diagnostics).toEqual([]);
        expect(v.valueSpan(r.finalState!, LIFE, MAXLIFE_T1.id)).toEqual([115, 129]);
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
        expect(v.valueSpan(r.finalState!, LIFE)).toEqual([20, 25]);
    });

    it("fails every comparison at a row without a number", () => {
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
        const lower = rowIds(below.finalState!, LIFE);
        expect(lower.has(MAXLIFE_BLANK.id)).toBe(true);
        expect(lower.has(MAXLIFE_T1.id)).toBe(false);
        expect(v.valueSpan(below.finalState!, LIFE)).toEqual([10, 84]);
        expect(v.valueSpan(below.finalState!, LIFE, MAXLIFE_BLANK.id)).toBeUndefined();
        // And past `if not has >= 115 { stop }`, the positive one, which a row
        // with no value to compare never meets.
        const above = guarded(notp(hasValue("maximum life", ">=", 115)));
        expect(above.diagnostics).toEqual([]);
        const upper = rowIds(above.finalState!, LIFE);
        expect(upper.has(MAXLIFE_BLANK.id)).toBe(false);
        expect(upper.has(MAXLIFE_T1.id)).toBe(true);
        expect(upper.has(MAXLIFE_T2.id)).toBe(false);
        expect(v.valueSpan(above.finalState!, LIFE)).toEqual([115, 129]);
    });

    it("compares a row's own span on an experimented base, its magnitude implicit unread", () => {
        // A Simplex Amulet's "increased Explicit Modifier magnitudes" is not applied
        // yet, so its top life row compares as 115 to 129, as on any amulet.
        const simplex = buildRegistry({ bases: [SIMPLEX_BASE], mods: TIERED_CATALOG });
        const amulet = item({
            base: "SimplexAmulet",
            ilvl: 100,
            rarity: "rare",
            prefixes: [{ mod: "maximum life", tier: 1 }],
        });
        const r = check(craft(amulet, [iff(notp(hasValue("maximum life", ">=", 120)), [stop()])]), {
            registry: simplex,
        });
        expect(r.diagnostics).toEqual([]);
        expect(v.valueSpan(r.finalState!, LIFE)).toEqual([120, 129]);
        // What the item shows (twice the row) is beyond the row's span: the implicit is not applied.
        const shown = check(
            craft(amulet, [iff(hasValue("maximum life", ">=", 240), [op("divine")])]),
            { registry: simplex },
        );
        expect(shown.diagnostics.map((d) => d.message)).toEqual([
            expect.stringContaining("can never run"),
        ]);
    });

    it("is clipped to the tier a later check names", () => {
        const reached = craft(ring(), [
            until(has("maximum life"), [op("chaos")]),
            iff(notp(hasValue("maximum life", ">=", 80)), [stop()]),
            iff(notp(has("maximum life", 1)), [stop()]),
        ]);
        const r = check(reached, ctx);
        expect(r.diagnostics).toEqual([]);
        expect(v.valueSpan(r.finalState!, LIFE)).toEqual([115, 129]);
    });

    it("keeps an essence's row through a repeat entered on an item with no modifiers", () => {
        // The Normal item the repeat starts on holds nothing, so the energy
        // shield the exit finds can only be the row the essence placed. The
        // fillers give the item suffixes enough to go round again.
        const woe: EssenceSpec = {
            id: "TestWoeShrieking",
            name: "Shrieking Essence of Woe",
            tier: 6,
            grants: new Map([[CLASS_RING, AMULET_ES_ROW.id]]),
        };
        const placed = buildRegistry({
            bases: [RING_BASE],
            mods: [...TIERED_CATALOG, ...FILLERS, AMULET_ES_ROW],
            essences: [woe],
        });
        const c = craft(item({ base: "IronRing", ilvl: 100, rarity: "normal" }), [
            until(andp(has("energy shield"), cmp("suffixCount", "<=", 1)), [
                iff(has("energy shield"), [op("annul")], [essence("Shrieking Essence of Woe")]),
            ]),
        ]);
        const r = check(c, { registry: placed });
        expect(r.diagnostics).toEqual([]);
        expect([...rowIds(r.finalState!, AMULET_ES_ROW.type)]).toEqual([AMULET_ES_ROW.id]);
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

    it("reads a row that rolls only under a tag an unnamed modifier may add", () => {
        // The unnamed prefix may be the adder, under whose tag the gated suffix
        // rolls, so the unnamed suffix may be that row and its span compares.
        const gated = buildRegistry({
            bases: [RING_BASE],
            mods: [...TIERED_CATALOG, STAFFY_ADDER, STAFFY_VALUE],
        });
        const anonymous = item({
            base: "IronRing",
            ilvl: 100,
            rarity: "rare",
            prefixes: ["random"],
            suffixes: ["random"],
        });
        const c = craft(anonymous, [iff(hasValue(STAFFY_VALUE.id, ">=", 15), [stop()])]);
        expect(check(c, { registry: gated }).diagnostics).toEqual([]);
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
        expect(v.valueSpan(inRange([PROTECT_PREFIXES_CARRIER.id]).finalState!, LIFE)).toEqual([
            125, 129,
        ]);
        // Unprotected, the Divine Orb rolls the life anew over its tier's whole span.
        expect(v.valueSpan(inRange([]).finalState!, LIFE)).toEqual([115, 129]);
    });

    it("the Divine Orb is refused on a Normal item", () => {
        const r = check(craft(ring([], "normal"), [op("divine")]), ctx);
        expect(r.diagnostics[0]?.message).toContain("Requires a Magic or Rare item");
    });
});

describe("a Tainted Divine Teardrop on a low item level", () => {
    it("may raise a value past the tiers the item level rolls", () => {
        // The Teardrop is bounded by the base, not the item level (Tainted
        // Divine Teardrop § Mechanics), so a value no tier at item level 20
        // reaches becomes possible.
        const teardrop: OperationStmt = {
            kind: "operation",
            words: ["tainted", "divine"],
            args: [],
            span: {
                start: { offset: 0, line: 1, column: 1 },
                end: { offset: 0, line: 1, column: 1 },
            },
        };
        const low = item({
            base: "IronRing",
            ilvl: 20,
            rarity: "rare",
            prefixes: [MAXLIFE_T3.id],
            corrupted: true,
        });
        const branch = iff(hasValue("maximum life", ">=", 70), [stop()]);
        const before = check(craft(low, [branch]), ctx).diagnostics.map((d) => d.message);
        expect(before).toEqual([expect.stringContaining("can never run")]);
        const after = check(craft(low, [teardrop, branch]), ctx).diagnostics;
        expect(after).toEqual([]);
    });
});
