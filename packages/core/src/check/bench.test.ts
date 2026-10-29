import { describe, expect, it } from "vitest";
import { check, type CheckContext } from "./check.js";
import { guaranteedTypes, isExcluded } from "./astate.js";
import { buildRegistry } from "../resolve/registry.js";
import { bench, benchRemove, craft, item, op } from "../__fixtures__/ast.js";
import {
    BENCH_LIFE_ROW,
    CATALOG,
    CLASS_RING,
    INCREASED_ARMOUR,
    INCREASED_MANA,
    MULTIMOD_CARRIER,
    PROTECT_PREFIXES_CARRIER,
    RING_BASE,
} from "../__fixtures__/mods.js";
import type { BenchCraft } from "../model/sources.js";
import { type ModId, TypeId } from "../model/ids.js";

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

describe("bench remove", () => {
    it("clears the crafted modifier and nothing else", () => {
        const c = craft(rareRing([BENCH_LIFE_ROW.id, INCREASED_MANA.id], ["FireResist1"]), [
            benchRemove(),
        ]);
        const r = check(c, ctx);
        expect(r.diagnostics).toEqual([]);
        const s = r.finalState!;
        expect(s.crafted).toEqual([0, 0]);
        expect(s.counts.total).toEqual([2, 2]);
        expect(s.counts.prefix).toEqual([1, 1]);
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
        expect(r.finalState!.crafted).toEqual([0, 0]);
    });
});

describe("a bench craft on an item with a crafted modifier", () => {
    it("replaces it, freeing the slot it held", () => {
        const full = rareRing([BENCH_LIFE_ROW.id, INCREASED_MANA.id, INCREASED_ARMOUR.id]);
        const r = check(craft(full, [bench("maximum life")]), ctx);
        expect(r.diagnostics).toEqual([]);
        expect(r.finalState!.crafted).toEqual([1, 1]);
        expect(r.finalState!.counts.prefix).toEqual([3, 3]);
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

    it("is refused while the multimod may be on the item, since it would then add instead", () => {
        // The annul may have taken the rolled prefix or the multimod; on one path
        // the craft replaces the crafted life, on the other it adds beside it.
        const c = craft(rareRing(["random"]), [
            bench("can have up to 3 crafted modifiers"),
            op("annul"),
            bench("maximum life"),
        ]);
        expect(check(c, ctx).diagnostics[0]!.message).toContain("can have up to 3");
    });

    it("cannot replace when more than one crafted modifier may be present", () => {
        const declared = rareRing([BENCH_LIFE_ROW.id], [PROTECT_PREFIXES_CARRIER.id]);
        const r = check(craft(declared, [bench("maximum life")]), ctx);
        expect(r.diagnostics[0]!.message).toContain("more than one crafted");
        // Two benched under the multimod, then an annul that may have taken the
        // multimod itself: one or two crafted remain beside the carrier.
        const c = craft(rareRing(["random"]), [
            bench("can have up to 3 crafted modifiers"),
            bench("maximum life"),
            op("annul"),
            bench("prefixes cannot be changed"),
        ]);
        expect(check(c, ctx).diagnostics[0]!.message).toContain("more than one crafted");
    });

    it("adds beside the crafted modifiers under the multimod", () => {
        const c = craft(rareRing([BENCH_LIFE_ROW.id], [MULTIMOD_CARRIER.id]), [
            bench("prefixes cannot be changed"),
        ]);
        const r = check(c, ctx);
        expect(r.diagnostics).toEqual([]);
        expect(r.finalState!.crafted).toEqual([3, 3]);
        expect(guaranteedTypes(r.finalState!).has(LIFE)).toBe(true);
    });
});
