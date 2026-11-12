import { describe, expect, it } from "vitest";
import { check, type CheckContext } from "../exact/check.js";
import * as v from "../exact/views.js";
import { guaranteedTypes, isExcluded } from "../exact/views.js";
import { buildRegistry } from "../resolve/registry.js";
import { bench, benchRemove, craft, has, iff, item, op } from "../__fixtures__/ast.js";
import {
    BENCH_LIFE_ROW,
    CATALOG,
    FIRE_CHAOS_RESIST,
    FIRE_RESIST,
    CLASS_RING,
    COLD_RESIST,
    INCREASED_ARMOUR,
    INCREASED_MANA,
    MULTIMOD_CARRIER,
    PROTECT_PREFIXES_CARRIER,
    RING_BASE,
} from "../__fixtures__/mods.js";
import type { BenchCraft } from "../model/sources.js";
import type { Mod } from "../model/mod.js";
import { ModId, TypeId } from "../model/ids.js";

const benchOf = (mod: ModId): BenchCraft => ({ mod, tier: 1, itemClasses: new Set([CLASS_RING]) });

const registry = buildRegistry({
    bases: [RING_BASE],
    mods: [...CATALOG, BENCH_LIFE_ROW, MULTIMOD_CARRIER, PROTECT_PREFIXES_CARRIER],
    modAliases: { "T1 Life": "IncreasedLife1" },
    baseAliases: { "Iron Ring": "IronRing" },
    benchCrafts: [
        benchOf(BENCH_LIFE_ROW.id),
        benchOf(MULTIMOD_CARRIER.id),
        benchOf(PROTECT_PREFIXES_CARRIER.id),
    ],
});
const ctx: CheckContext = { registry };

type Affix = string | { mod: string; fractured?: true };
const rareRing = (prefixes: Affix[] = [], suffixes: Affix[] = []) =>
    item({ base: "Iron Ring", ilvl: 100, rarity: "rare", prefixes, suffixes });

const LIFE = TypeId("IncreasedLife");

describe("a bench craft refused for want of a slot", () => {
    it("is reported once: the item stays as it was for the steps after it", () => {
        // The three suffixes are full, so the metamod (a suffix) has no slot.
        const c = craft(rareRing(["T1 Life"], ["FireResist1", "ColdResist1", "random"]), [
            bench("prefixes cannot be changed"),
            op("annul"),
            op("exalt"),
        ]);
        const r = check(c, ctx);
        expect(r.diagnostics.map((d) => d.message)).toEqual([
            expect.stringContaining("Requires an open suffix slot"),
        ]);
        expect(v.counts(r.finalState!).total).toEqual([4, 4]);
    });
});

describe("bench remove", () => {
    it("clears the crafted modifier and nothing else", () => {
        const c = craft(rareRing([BENCH_LIFE_ROW.id, INCREASED_MANA.id], ["FireResist1"]), [
            benchRemove(),
        ]);
        const r = check(c, ctx);
        expect(r.diagnostics).toEqual([]);
        const s = r.finalState!;
        expect(v.craftedCount(s)).toEqual([0, 0]);
        expect(v.counts(s).total).toEqual([2, 2]);
        expect(v.counts(s).prefix).toEqual([1, 1]);
        expect(guaranteedTypes(s).has(INCREASED_MANA.type)).toBe(true);
        expect(isExcluded(s, LIFE)).toBe(true);
    });

    it("needs a crafted modifier the bench can reach", () => {
        const none = check(craft(rareRing(["T1 Life"]), [benchRemove()]), ctx);
        expect(none.diagnostics[0]!.message).toContain("No crafted modifier");
        const locked = check(
            craft(rareRing([{ mod: BENCH_LIFE_ROW.id, fractured: true }]), [benchRemove()]),
            ctx,
        );
        expect(locked.diagnostics[0]!.message).toContain("No crafted modifier");
    });

    it("a rolled modifier of the crafted row's type survives, pinned to its own tier", () => {
        const c = craft(rareRing(["T1 Life"], [PROTECT_PREFIXES_CARRIER.id]), [benchRemove()]);
        const r = check(c, ctx);
        expect(r.diagnostics).toEqual([]);
        expect(guaranteedTypes(r.finalState!).has(LIFE)).toBe(true);
        expect(v.craftedCount(r.finalState!)).toEqual([0, 0]);
    });
});

describe("bench remove reaches the crafted types only", () => {
    it("removes a metamod a branch has proven present, whatever the count knew", () => {
        // The annul may have taken the metamod or the resistance; where the
        // metamod is still there, it is a crafted modifier for sure.
        const c = craft(
            rareRing([BENCH_LIFE_ROW.id], [PROTECT_PREFIXES_CARRIER.id, FIRE_RESIST.id]),
            [op("annul"), iff(has(PROTECT_PREFIXES_CARRIER.id), [benchRemove()])],
        );
        expect(check(c, ctx).diagnostics).toEqual([]);
    });

    it("cannot cost a suffix for a crafted prefix", () => {
        const c = craft(rareRing([BENCH_LIFE_ROW.id], [FIRE_RESIST.id, COLD_RESIST.id]), [
            benchRemove(),
        ]);
        const r = check(c, ctx);
        expect(r.diagnostics).toEqual([]);
        expect(v.counts(r.finalState!).prefix).toEqual([0, 0]);
        expect(v.counts(r.finalState!).suffix).toEqual([2, 2]);
    });
});

describe("bench remove under an unproven fracture", () => {
    it("is refused when the only crafted modifier may be the fractured one", () => {
        const c = craft(
            rareRing([BENCH_LIFE_ROW.id, INCREASED_MANA.id], ["FireResist1", "random"]),
            [op("fracture"), benchRemove()],
        );
        expect(check(c, ctx).diagnostics[0]!.message).toContain("No crafted modifier");
    });

    it("removes one or both of two crafted modifiers, whichever the fracture spared", () => {
        // Four modifiers, two of them crafted: the lock may sit on a rolled one
        // (both crafted go) or on a crafted one (the other goes).
        const c = craft(
            rareRing([BENCH_LIFE_ROW.id, INCREASED_MANA.id], [MULTIMOD_CARRIER.id, "random"]),
            [op("fracture"), benchRemove()],
        );
        const r = check(c, ctx);
        expect(r.diagnostics).toEqual([]);
        expect(v.craftedCount(r.finalState!)).toEqual([0, 1]);
        expect(v.counts(r.finalState!).total).toEqual([2, 3]);
        expect(guaranteedTypes(r.finalState!).has(LIFE)).toBe(false);
    });
});

describe("bench remove with a fractured crafted modifier", () => {
    it("keeps it crafted, so the next bench craft would replace it, and cannot", () => {
        const c = craft(
            rareRing(
                [{ mod: BENCH_LIFE_ROW.id, fractured: true }, INCREASED_MANA.id],
                [MULTIMOD_CARRIER.id],
            ),
            [benchRemove(), bench("prefixes cannot be changed")],
        );
        const r = check(c, ctx);
        expect(r.diagnostics.map((d) => d.message)).toEqual([
            expect.stringContaining("may be fractured"),
        ]);
    });
});

describe("a bench craft on an item with a crafted modifier", () => {
    it("replaces it, freeing the slot it held", () => {
        const full = rareRing([BENCH_LIFE_ROW.id, INCREASED_MANA.id, INCREASED_ARMOUR.id]);
        const r = check(craft(full, [bench("maximum life")]), ctx);
        expect(r.diagnostics).toEqual([]);
        expect(v.craftedCount(r.finalState!)).toEqual([1, 1]);
        expect(v.counts(r.finalState!).prefix).toEqual([3, 3]);
        expect(guaranteedTypes(r.finalState!).has(LIFE)).toBe(true);
        // The same prefixes rolled, not crafted, leave no slot to take.
        const rolled = rareRing(["T1 Life", INCREASED_MANA.id, INCREASED_ARMOUR.id]);
        const refused = check(craft(rolled, [bench("maximum life")]), ctx);
        expect(refused.diagnostics[0]!.message).toContain("open prefix slot");
    });

    it("cannot replace a fractured crafted modifier", () => {
        const c = craft(rareRing([{ mod: BENCH_LIFE_ROW.id, fractured: true }]), [
            bench("maximum life"),
        ]);
        expect(check(c, ctx).diagnostics[0]!.message).toContain("may be fractured");
    });

    it("may not be able to replace one an unproven fracture may have locked", () => {
        const c = craft(
            rareRing([BENCH_LIFE_ROW.id, INCREASED_MANA.id], ["FireResist1", "random"]),
            [op("fracture"), bench("maximum life")],
        );
        expect(check(c, ctx).diagnostics[0]!.message).toContain("may be fractured");
    });

    it("replaces the crafted life where the annul took the multimod, and adds beside it elsewhere", () => {
        const c = craft(rareRing([BENCH_LIFE_ROW.id], [MULTIMOD_CARRIER.id, COLD_RESIST.id]), [
            op("annul"),
            bench("prefixes cannot be changed"),
        ]);
        const r = check(c, ctx);
        expect(r.diagnostics).toEqual([]);
        expect(v.craftedCount(r.finalState!)).toEqual([1, 3]);
        expect(guaranteedTypes(r.finalState!).has(LIFE)).toBe(false);
        expect(isExcluded(r.finalState!, LIFE)).toBe(false);
    });

    it("cannot replace when more than one crafted modifier may be present", () => {
        const declared = rareRing([BENCH_LIFE_ROW.id], [PROTECT_PREFIXES_CARRIER.id]);
        const r = check(craft(declared, [bench("maximum life")]), ctx);
        expect(r.diagnostics[0]!.message).toContain("more than one crafted");
        // The annul may take the multimod, leaving two crafted modifiers it
        // no longer allows; the prefixes are safe from it.
        const benchFire: Mod = {
            ...FIRE_RESIST,
            id: ModId("BenchFire1"),
            source: "bench",
            text: "+(10-20)% to Fire Resistance",
        };
        const withFire = buildRegistry({
            bases: [RING_BASE],
            mods: [
                ...CATALOG,
                BENCH_LIFE_ROW,
                MULTIMOD_CARRIER,
                PROTECT_PREFIXES_CARRIER,
                benchFire,
            ],
            baseAliases: { "Iron Ring": "IronRing" },
            benchCrafts: [
                benchOf(BENCH_LIFE_ROW.id),
                benchOf(MULTIMOD_CARRIER.id),
                benchOf(PROTECT_PREFIXES_CARRIER.id),
                benchOf(benchFire.id),
            ],
        });
        const c = craft(
            rareRing([BENCH_LIFE_ROW.id], [PROTECT_PREFIXES_CARRIER.id, MULTIMOD_CARRIER.id]),
            [op("annul"), bench("fire resistance")],
        );
        expect(check(c, { registry: withFire }).diagnostics[0]!.message).toContain(
            "more than one crafted",
        );
    });

    it("adds beside the crafted modifiers under the multimod", () => {
        const c = craft(rareRing([BENCH_LIFE_ROW.id], [MULTIMOD_CARRIER.id]), [
            bench("prefixes cannot be changed"),
        ]);
        const r = check(c, ctx);
        expect(r.diagnostics).toEqual([]);
        expect(v.craftedCount(r.finalState!)).toEqual([3, 3]);
        expect(guaranteedTypes(r.finalState!).has(LIFE)).toBe(true);
    });
});

describe("a bench craft's group clash names the modifiers that may clash", () => {
    // The bench's fire resistance: a bench row of the natural type, as the game's is.
    const benchFire: Mod = {
        ...FIRE_RESIST,
        id: ModId("BenchFire1"),
        source: "bench",
        text: "+(10-20)% to Fire Resistance",
    };
    const fireBench = buildRegistry({
        bases: [RING_BASE],
        mods: [...CATALOG, BENCH_LIFE_ROW, benchFire],
        baseAliases: { "Iron Ring": "IronRing" },
        benchCrafts: [benchOf(benchFire.id)],
    });
    const message = (c: ReturnType<typeof craft>): string =>
        check(c, { registry: fireBench })
            .diagnostics.map((d) => d.message)
            .join("\n");
    const hybrid = fireBench.typeLabel(FIRE_CHAOS_RESIST.type);

    it("names a guaranteed modifier of another wording", () => {
        const m = message(craft(rareRing([], [FIRE_CHAOS_RESIST.id]), [bench("fire resistance")]));
        expect(m).toContain(`or one of its group ("${hybrid}")`);
    });

    it("names nothing else when the clashing modifier is the craft's own", () => {
        const m = message(craft(rareRing([], [FIRE_RESIST.id]), [bench("fire resistance")]));
        expect(m).toContain("at most one per group");
        expect(m).not.toContain("or one of its group");
    });

    it("names the group's modifiers an anonymous suffix may be", () => {
        const m = message(craft(rareRing([], ["random"]), [bench("fire resistance")]));
        expect(m).toContain(`or one of its group ("${hybrid}")`);
    });
});

describe("a bench craft named the way a guide writes it", () => {
    // The game's wording is "+(16-20)% to Fire and Chaos Resistances"; a guide
    // says "fire and chaos resistance" or "fire chaos res".
    const hybridRow = {
        ...FIRE_CHAOS_RESIST,
        id: FIRE_CHAOS_RESIST.id.replace("1", "Bench1") as typeof FIRE_CHAOS_RESIST.id,
        source: "bench" as const,
        text: "+(16-20)% to Fire and Chaos Resistances",
    };
    const named = buildRegistry({
        bases: [RING_BASE],
        mods: [...CATALOG, hybridRow],
        baseAliases: { "Iron Ring": "IronRing" },
        benchCrafts: [benchOf(hybridRow.id)],
    });

    it("says a Normal item has no slot rather than that none is guaranteed", () => {
        const normal = item({ base: "Iron Ring", ilvl: 100, rarity: "normal" });
        expect(
            check(craft(normal, [bench("maximum life")]), ctx).diagnostics[0]!.message,
        ).toContain("Requires an open prefix slot — a Normal item has none.");
    });

    it("tolerates a singular and an abbreviation", () => {
        for (const name of ["fire and chaos resistance", "fire chaos res"]) {
            const r = check(craft(rareRing(), [bench(name)]), { registry: named });
            expect(r.diagnostics).toEqual([]);
            expect(guaranteedTypes(r.finalState!).has(FIRE_CHAOS_RESIST.type)).toBe(true);
        }
    });
});
