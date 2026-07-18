import { describe, expect, it } from "vitest";
import { check, type CheckContext } from "./check.js";
import { excludedTypes, guaranteedTypes } from "./astate.js";
import { buildRegistry } from "../resolve/registry.js";
import {
    andp,
    bench,
    call,
    craft,
    cmp,
    def,
    essence,
    has,
    hasP,
    iff,
    isRarity,
    item,
    notp,
    op,
    orp,
    param,
    tierArg,
    until,
    withOmen,
} from "../__fixtures__/ast.js";
import {
    AMULET_BASE,
    CATALOG,
    CLASS_RING,
    FIRE_RESIST,
    LIFE_T1,
    RING_BASE,
} from "../__fixtures__/mods.js";
import type { BenchCraft, EssenceSpec } from "../model/sources.js";

// A fixture bench craft that adds T1 life (a prefix) on a Ring.
const BENCH_LIFE: BenchCraft = { mod: LIFE_T1.id, tier: 1, itemClasses: new Set([CLASS_RING]) };

// Two fixture essences, both granting T1 life on a Ring: Deafening (ladder 7, so
// it reforges Rare too) and Muttering (ladder 2, Normal-only).
const ESS_DEAFENING: EssenceSpec = {
    id: "TestGreedDeafening",
    name: "Deafening Essence of Greed",
    tier: 7,
    grants: new Map([[CLASS_RING, LIFE_T1.id]]),
};
const ESS_MUTTERING: EssenceSpec = {
    id: "TestGreedMuttering",
    name: "Muttering Essence of Greed",
    tier: 2,
    grants: new Map([[CLASS_RING, LIFE_T1.id]]),
};

const registry = buildRegistry({
    bases: [RING_BASE, AMULET_BASE],
    mods: CATALOG,
    modAliases: { "T1 Life": "IncreasedLife1" },
    baseAliases: { "Iron Ring": "IronRing" },
    essences: [ESS_DEAFENING, ESS_MUTTERING],
    benchCrafts: [BENCH_LIFE],
});
const ctx: CheckContext = { registry };

/** Convenience: a rare Iron Ring item block with the given affix name lists. */
const rareRing = (prefixes: string[] = [], suffixes: string[] = []) =>
    item({ base: "Iron Ring", ilvl: 100, rarity: "rare", prefixes, suffixes });

describe("checker — a valid craft type-checks", () => {
    it("transmute → regal → exalt on a Normal item is clean", () => {
        const c = craft("poe1", item({ base: "Iron Ring", ilvl: 100, rarity: "normal" }), [
            op("transmute"),
            op("regal"),
            op("exalt"),
        ]);
        const r = check(c, ctx);
        expect(r.diagnostics).toEqual([]);
        expect(r.ok).toBe(true);
        expect(r.finalState?.rarity).toBe("rare");
    });
});

describe("checker — the wider currency set", () => {
    it("alchemy takes a Normal item to a Rare with 4–6 mods", () => {
        const c = craft("poe1", item({ base: "Iron Ring", ilvl: 100, rarity: "normal" }), [
            op("alchemy"),
        ]);
        const r = check(c, ctx);
        expect(r.ok).toBe(true);
        expect(r.finalState?.rarity).toBe("rare");
        expect(r.finalState?.total).toEqual([4, 6]);
    });

    it("chaos reforges a Rare — no prior mod stays guaranteed", () => {
        const c = craft("poe1", rareRing(["IncreasedLife1"]), [op("chaos")]);
        const r = check(c, ctx);
        expect(r.ok).toBe(true);
        expect(r.finalState?.rarity).toBe("rare");
        expect(guaranteedTypes(r.finalState!).size).toBe(0);
    });

    it("`until has X { chaos }` checks clean — a reforge never gets stuck full", () => {
        // The contrast with exalt: chaos resets the count each iteration, so it
        // can't fill to 6 and strand the next op. This is the payoff of modelling
        // reforge as a bounded range rather than an unbounded add.
        const c = craft("poe1", rareRing(), [until(has("IncreasedLife1"), [op("chaos")])]);
        expect(check(c, ctx).diagnostics).toEqual([]);
    });

    it("scour strips a Rare back to Normal with no mods", () => {
        const c = craft("poe1", rareRing(["IncreasedLife1"], ["FireResist1"]), [op("scour")]);
        const r = check(c, ctx);
        expect(r.ok).toBe(true);
        expect(r.finalState?.rarity).toBe("normal");
        expect(r.finalState?.total).toEqual([0, 0]);
    });

    it("rejects scouring an item that has no mods (wasted currency)", () => {
        const c = craft("poe1", item({ base: "Iron Ring", ilvl: 100, rarity: "normal" }), [
            op("scour"),
        ]);
        expect(check(c, ctx).diagnostics[0]?.message).toContain("removable affix");
    });

    it("augment fills the open slot on a 1-mod Magic item, then rejects a second", () => {
        const c = craft("poe1", item({ base: "Iron Ring", ilvl: 100, rarity: "normal" }), [
            op("transmute"), // → Magic, 1 affix
            op("augment"), // → fills to 2 (full)
            op("augment"), // → no open slot
        ]);
        const r = check(c, ctx);
        expect(r.ok).toBe(false);
        expect(r.diagnostics.some((d) => d.message.includes("open affix slot"))).toBe(true);
    });

    it("annul works on a Magic item (not just Rare)", () => {
        const c = craft(
            "poe1",
            item({ base: "Iron Ring", ilvl: 100, rarity: "magic", prefixes: ["IncreasedLife1"] }),
            [op("annul")],
        );
        const r = check(c, ctx);
        expect(r.ok).toBe(true);
        expect(r.finalState?.rarity).toBe("magic");
    });

    it("rejects alchemy on a Magic item (wrong rarity)", () => {
        const c = craft("poe1", item({ base: "Iron Ring", ilvl: 100, rarity: "magic" }), [
            op("alchemy"),
        ]);
        expect(check(c, ctx).diagnostics[0]?.message).toContain("Requires a Normal item");
    });
});

describe("checker — essences", () => {
    const normalRing = () => item({ base: "Iron Ring", ilvl: 100, rarity: "normal" });

    it("guarantees its mod, reforging a Normal item to Rare", () => {
        const r = check(craft("poe1", normalRing(), [essence("Deafening Essence of Greed")]), ctx);
        expect(r.ok).toBe(true);
        expect(r.finalState?.rarity).toBe("rare");
        expect(guaranteedTypes(r.finalState!).has(LIFE_T1.type)).toBe(true);
    });

    it("resolves the `type + t1` shorthand (t1 = Deafening = best)", () => {
        const r = check(craft("poe1", normalRing(), [essence("greed", 1)]), ctx);
        expect(guaranteedTypes(r.finalState!).has(LIFE_T1.type)).toBe(true);
    });

    it("a high-tier essence reforges a Rare item too", () => {
        const r = check(
            craft("poe1", rareRing(["random"]), [essence("Deafening Essence of Greed")]),
            ctx,
        );
        expect(r.ok).toBe(true);
        expect(guaranteedTypes(r.finalState!).has(LIFE_T1.type)).toBe(true);
    });

    it("rejects a low-tier essence on a Rare item", () => {
        const c = craft("poe1", rareRing(), [essence("Muttering Essence of Greed")]);
        expect(check(c, ctx).diagnostics[0]?.message).toContain("Requires a Normal item");
    });

    it("rejects any essence on a Magic item", () => {
        const c = craft("poe1", item({ base: "Iron Ring", ilvl: 100, rarity: "magic" }), [
            essence("Deafening Essence of Greed"),
        ]);
        expect(check(c, ctx).diagnostics[0]?.message).toContain("Magic item");
    });

    it("rejects an essence that grants nothing for the item's class", () => {
        // The fixture essences only grant on Ring; a Coral Amulet has no grant.
        const c = craft("poe1", item({ base: "CoralAmulet", ilvl: 100, rarity: "normal" }), [
            essence("Deafening Essence of Greed"),
        ]);
        expect(check(c, ctx).diagnostics[0]?.message).toContain("grants no mod");
    });

    it("reports an unknown essence", () => {
        const c = craft("poe1", normalRing(), [essence("Bogus Essence of Nothing")]);
        expect(check(c, ctx).diagnostics[0]?.message).toContain("Unknown essence");
    });
});

describe("checker — bench crafts", () => {
    it("adds a guaranteed mod into its open slot", () => {
        const r = check(craft("poe1", rareRing(), [bench("maximum life")]), ctx);
        expect(r.ok).toBe(true);
        expect(guaranteedTypes(r.finalState!).has(LIFE_T1.type)).toBe(true);
    });

    it("rejects a bench craft when its generation is full", () => {
        // Life is a prefix; a 3-prefix Rare has no open prefix.
        const c = craft("poe1", rareRing(["random", "random", "random"]), [bench("maximum life")]);
        expect(check(c, ctx).diagnostics[0]?.message).toContain("open prefix slot");
    });

    it("reports an unresolvable bench mod", () => {
        const c = craft("poe1", rareRing(), [bench("nonexistent")]);
        expect(check(c, ctx).diagnostics[0]?.message).toContain("bench craft");
    });

    it("rejects a bench craft whose group is already present (one mod per group)", () => {
        // The ring already carries a life prefix; benching another life mod would
        // be a second mod of the same group — impossible in-game.
        const c = craft("poe1", rareRing(["IncreasedLife1"]), [bench("maximum life")]);
        expect(check(c, ctx).diagnostics[0]?.message).toContain("at most one per group");
    });
});

describe("checker — predicate defs", () => {
    it("expands a def call in an until and proves its exit clean", () => {
        // def anyEle(t) = has life t or has fire-res t; `until anyEle(1) { chaos }`
        // — chaos reforges, so the exit is always reachable (like the inlined form).
        const d = def(
            "anyEle",
            ["t"],
            orp(hasP("IncreasedLife1", param("t")), hasP("FireResist1", param("t"))),
        );
        const c = craft(
            "poe1",
            rareRing(),
            [until(call("anyEle", [tierArg(1)]), [op("chaos")])],
            [d],
        );
        expect(check(c, ctx).diagnostics).toEqual([]);
    });

    it("a def-driven until guarantees the mod, exactly like the inlined predicate", () => {
        const d = def("hasLife", ["t"], hasP("IncreasedLife1", param("t")));
        const c = craft(
            "poe1",
            rareRing(),
            [until(call("hasLife", [tierArg(1)]), [op("chaos")])],
            [d],
        );
        expect(guaranteedTypes(check(c, ctx).finalState!).has(LIFE_T1.type)).toBe(true);
    });

    it("passes a parameter through to a nested def call", () => {
        // def hasLife(t) = has life t;  def viaLife(t) = hasLife(t)
        const inner = def("hasLife", ["t"], hasP("IncreasedLife1", param("t")));
        const outer = def("viaLife", ["t"], call("hasLife", [param("t")]));
        const c = craft(
            "poe1",
            rareRing(),
            [until(call("viaLife", [tierArg(1)]), [op("chaos")])],
            [inner, outer],
        );
        expect(check(c, ctx).diagnostics).toEqual([]);
    });

    it("catches a passthrough type error at the nested call", () => {
        // viaLife forwards its arg to hasLife's tier param; a string is wrong.
        const inner = def("hasLife", ["t"], hasP("IncreasedLife1", param("t")));
        const outer = def("viaLife", ["t"], call("hasLife", [param("t")]));
        const c = craft(
            "poe1",
            rareRing(),
            [until(call("viaLife", ["x"]), [op("chaos")])],
            [inner, outer],
        );
        expect(check(c, ctx).diagnostics[0]?.message).toContain("should be a tier");
    });

    it("flags a parameter that is never used", () => {
        const d = def("f", ["t", "unused"], hasP("IncreasedLife1", param("t")));
        const c = craft(
            "poe1",
            rareRing(),
            [until(call("f", [tierArg(1), tierArg(1)]), [op("chaos")])],
            [d],
        );
        expect(check(c, ctx).diagnostics[0]?.message).toContain(`parameter "unused"`);
    });

    it("does not flag a param that is only passed through to a nested call", () => {
        const inner = def("hasLife", ["t"], hasP("IncreasedLife1", param("t")));
        const outer = def("viaLife", ["t"], call("hasLife", [param("t")]));
        const c = craft(
            "poe1",
            rareRing(),
            [until(call("viaLife", [tierArg(1)]), [op("chaos")])],
            [inner, outer],
        );
        expect(check(c, ctx).diagnostics.some((x) => x.message.includes("never used"))).toBe(false);
    });

    it("reports an unknown def", () => {
        const c = craft("poe1", rareRing(), [until(call("nope", [tierArg(1)]), [op("chaos")])]);
        expect(check(c, ctx).diagnostics[0]?.message).toContain(`unknown def "nope"`);
    });

    it("reports an arity mismatch", () => {
        const d = def("f", ["t"], hasP("IncreasedLife1", param("t")));
        const c = craft(
            "poe1",
            rareRing(),
            [until(call("f", [tierArg(1), tierArg(2)]), [op("chaos")])],
            [d],
        );
        expect(check(c, ctx).diagnostics[0]?.message).toContain("expects 1 argument");
    });

    it("rejects a bare-int count where a tier (t1) is expected", () => {
        const d = def("f", ["t"], hasP("IncreasedLife1", param("t")));
        const c = craft("poe1", rareRing(), [until(call("f", [1]), [op("chaos")])], [d]);
        expect(check(c, ctx).diagnostics[0]?.message).toContain("should be a tier (t1)");
    });

    it("reports an argument type mismatch (a string for a tier param)", () => {
        const d = def("f", ["t"], hasP("IncreasedLife1", param("t")));
        const c = craft("poe1", rareRing(), [until(call("f", ["oops"]), [op("chaos")])], [d]);
        expect(check(c, ctx).diagnostics[0]?.message).toContain("should be a tier");
    });

    it("flags a parameter used at conflicting sorts (tier vs mod), without cascading", () => {
        const d = def("weird", ["x"], orp(hasP(param("x")), hasP("IncreasedLife1", param("x"))));
        const c = craft("poe1", rareRing(), [until(call("weird", ["life"]), [op("chaos")])], [d]);
        const msgs = check(c, ctx).diagnostics.map((x) => x.message);
        expect(msgs.some((m) => m.includes("conflicting sorts"))).toBe(true);
        expect(msgs.some((m) => m.includes("unbound parameter"))).toBe(false);
    });
});

describe("checker — the rarity seam (surface §6 errors)", () => {
    it("rejects exalt on a Magic item and renders the state", () => {
        const c = craft("poe1", item({ base: "Iron Ring", ilvl: 100, rarity: "magic" }), [
            op("exalt"),
        ]);
        const r = check(c, ctx);
        expect(r.ok).toBe(false);
        expect(r.diagnostics[0]?.message).toContain("this item is Magic");
        expect(r.diagnostics[0]?.message).toContain("at this point the item is: IronRing · Magic");
    });

    it("rejects transmute on a Rare item", () => {
        const c = craft("poe1", rareRing(), [op("transmute")]);
        expect(check(c, ctx).diagnostics[0]?.message).toContain("Requires a Normal item");
    });

    it("rejects exalt on a full 3+3 Rare (no open slot)", () => {
        const c = craft(
            "poe1",
            rareRing(["random", "random", "random"], ["random", "random", "random"]),
            [op("exalt")],
        );
        expect(check(c, ctx).diagnostics[0]?.message).toContain("open affix slot");
    });

    it("rejects annul on an empty Rare (nothing removable)", () => {
        const c = craft("poe1", rareRing(), [op("annul")]);
        expect(check(c, ctx).diagnostics[0]?.message).toContain("removable affix");
    });
});

describe("checker — guarantee tracking (additive vs risky)", () => {
    it("exalt preserves a present mod; the final state still guarantees it", () => {
        const c = craft("poe1", rareRing(["IncreasedLife1"]), [op("exalt")]);
        const r = check(c, ctx);
        expect(r.ok).toBe(true);
        expect(guaranteedTypes(r.finalState!).has(LIFE_T1.type)).toBe(true);
    });

    it("an unforced annul risks every mod; nothing stays guaranteed", () => {
        const c = craft("poe1", rareRing(["IncreasedLife1"], ["FireResist1"]), [op("annul")]);
        const r = check(c, ctx);
        expect(guaranteedTypes(r.finalState!).size).toBe(0);
    });
});

describe("checker — loops (loop-exit-as-proof)", () => {
    it("`until not has X { annul }` proves X absent afterwards", () => {
        // A draining loop: annul keeps removing until Fire Resist is gone. The
        // affix count only shrinks, so the loop is sound, and on exit X is proven
        // absent.
        const c = craft("poe1", rareRing(["IncreasedLife1"], ["FireResist1"]), [
            until(notp(has("FireResist1")), [op("annul")]),
        ]);
        const r = check(c, ctx);
        expect(r.diagnostics).toEqual([]);
        expect(excludedTypes(r.finalState!).has(FIRE_RESIST.type)).toBe(true);
    });

    it("rejects `until has X { exalt }` — exalt may fail once the item fills up", () => {
        // The soundness fix: exalt is additive, so across iterations the item can
        // fill to 6 affixes without X ever rolling, and the next exalt has no open
        // slot. The loop-invariant pass catches this.
        const c = craft("poe1", rareRing(), [until(has("IncreasedLife1"), [op("exalt")])]);
        const r = check(c, ctx);
        expect(r.ok).toBe(false);
        expect(r.diagnostics.some((d) => d.message.includes("open affix slot"))).toBe(true);
    });

    it("count coupling: a prefixCount-guarded exalt/annul loop checks clean", () => {
        // Exalt only when a prefix slot is open, else annul — so exalt can never
        // hit a full item and annul can never hit an empty one. This only checks
        // clean if refining prefixCount also tightens the total range.
        const c = craft("poe1", rareRing(), [
            until(has("IncreasedLife1"), [
                iff(cmp("prefixCount", "<", 3), [op("exalt")], [op("annul")]),
            ]),
        ]);
        expect(check(c, ctx).diagnostics).toEqual([]);
    });

    it("flags an unreachable exit (the mod can't roll on this base)", () => {
        // JewelOnly1 has a jewel-only spawn tag; it cannot roll on a ring, so the
        // exit predicate is unsatisfiable — the reachability check reports that
        // before the fill-up symptom.
        const c = craft("poe1", rareRing(), [until(has("JewelOnly1"), [op("exalt")])]);
        const r = check(c, ctx);
        expect(r.ok).toBe(false);
        expect(r.diagnostics[0]?.message).toContain("can never exit");
    });
});

describe("checker — narrowing (if / else) and dead arms", () => {
    it("flags a dead 'if' branch (predicate impossible)", () => {
        const c = craft("poe1", rareRing(), [iff(isRarity("magic"), [op("exalt")])]);
        const r = check(c, ctx);
        expect(r.diagnostics[0]?.message).toContain("'if' branch can never run");
    });

    it("flags a dead 'else' branch (predicate always holds)", () => {
        const c = craft("poe1", rareRing(), [iff(isRarity("rare"), [], [op("annul")])]);
        const r = check(c, ctx);
        expect(r.diagnostics[0]?.message).toContain("'else' branch can never run");
    });

    it("accepts a genuine two-way narrow with no dead arm", () => {
        // Two affixes: an unforced annul may remove Life or Fire Resist, so
        // afterwards Life is possible-but-not-guaranteed — both `has` and
        // `not has` arms are inhabited.
        const c = craft("poe1", rareRing(["IncreasedLife1"], ["FireResist1"]), [
            op("annul"),
            iff(has("IncreasedLife1"), [], []),
        ]);
        expect(check(c, ctx).diagnostics).toEqual([]);
    });

    it("narrows counts with a comparison predicate", () => {
        const c = craft("poe1", rareRing(["random"]), [
            op("exalt"), // prefix ∈ [1,2] afterwards
            iff(cmp("prefixCount", "==", 2), [], []),
        ]);
        expect(check(c, ctx).diagnostics).toEqual([]);
    });
});

describe("checker — boolean predicates (and / or)", () => {
    it("`or`: a disjunction that always holds makes the else arm dead", () => {
        // Life is guaranteed, so `has life or has fire` is always true.
        const c = craft("poe1", rareRing(["IncreasedLife1"]), [
            iff(orp(has("IncreasedLife1"), has("FireResist1")), [], [op("annul")]),
        ]);
        expect(check(c, ctx).diagnostics[0]?.message).toContain("'else' branch can never run");
    });

    it("`and`: an impossible conjunct makes the if arm dead", () => {
        // isMagic is false on a Rare item, so the whole conjunction is impossible.
        const c = craft("poe1", rareRing(), [
            iff(andp(isRarity("magic"), has("IncreasedLife1")), [op("exalt")]),
        ]);
        expect(check(c, ctx).diagnostics[0]?.message).toContain("'if' branch can never run");
    });

    it("`or`: a genuine two-way narrow has no dead arm", () => {
        // After one exalt the added mod might be life, fire, or neither — so both
        // arms of `has life or has fire` are inhabited.
        const c = craft("poe1", rareRing(), [
            op("exalt"),
            iff(orp(has("IncreasedLife1"), has("FireResist1")), [], []),
        ]);
        expect(check(c, ctx).diagnostics).toEqual([]);
    });

    it("keeps a disjunction across a loop join: `not(X) and not(Y)` after is dead", () => {
        // After `until has X or has Y { chaos }`, at least one of X/Y is present.
        // A later `if not X and not Y` is therefore unreachable — the presence BDD
        // preserves the disjunction through the loop-exit join, which the old
        // per-type sets (intersecting to ∅) could not. This is the whole point of
        // the relational domain.
        const c = craft("poe1", rareRing(), [
            until(orp(has("IncreasedLife1"), has("FireResist1")), [op("chaos")]),
            iff(andp(notp(has("IncreasedLife1")), notp(has("FireResist1"))), [op("annul")]),
        ]);
        expect(check(c, ctx).diagnostics.some((d) => d.message.includes("can never run"))).toBe(
            true,
        );
    });

    it("`not (X or Y)` drains both: the loop proves both absent on exit", () => {
        // De Morgan: exiting when `not (has life or has fire)` proves neither is
        // present. The draining annul keeps the loop sound.
        const c = craft("poe1", rareRing(["IncreasedLife1"], ["FireResist1"]), [
            until(notp(orp(has("IncreasedLife1"), has("FireResist1"))), [op("annul")]),
        ]);
        const r = check(c, ctx);
        expect(r.diagnostics).toEqual([]);
        expect(excludedTypes(r.finalState!).has(LIFE_T1.type)).toBe(true);
        expect(excludedTypes(r.finalState!).has(FIRE_RESIST.type)).toBe(true);
    });
});

describe("checker — omens direct operations (typing rules §10)", () => {
    it("Dextral Exaltation forces the added mod to a suffix", () => {
        // 3 prefixes (full), 1 suffix open → an unforced exalt is fine, but a
        // Dextral (suffix-forced) one is what we assert lands cleanly.
        const c = craft("poe1", rareRing(["random", "random", "random"], ["random"]), [
            withOmen("Dextral Exaltation", [op("exalt")]),
        ]);
        expect(check(c, ctx).diagnostics).toEqual([]);
    });

    it("errors when the omen's forced generation has no open slot", () => {
        // 3 suffixes (full) under Dextral Exaltation (suffix-forced) → no target.
        const c = craft("poe1", rareRing([], ["random", "random", "random"]), [
            withOmen("Dextral Exaltation", [op("exalt")]),
        ]);
        expect(check(c, ctx).diagnostics[0]?.message).toContain("open suffix slot");
    });

    it("a Sinistral Annulment preserves a guaranteed suffix", () => {
        const c = craft("poe1", rareRing(["random"], ["FireResist1"]), [
            withOmen("Sinistral Annulment", [op("annul")]),
        ]);
        const r = check(c, ctx);
        expect(r.ok).toBe(true);
        // Removal forced to a prefix, so the suffix Fire Resist survives.
        expect(guaranteedTypes(r.finalState!).has(FIRE_RESIST.type)).toBe(true);
    });

    it("flags contradictory omens on one operation", () => {
        const c = craft("poe1", rareRing([], ["random"]), [
            withOmen("Dextral Exaltation", [withOmen("Sinistral Exaltation", [op("exalt")])]),
        ]);
        expect(check(c, ctx).diagnostics[0]?.message).toContain("contradictory omens");
    });
});

describe("checker — resolve-time errors", () => {
    it("reports an unknown currency", () => {
        const c = craft("poe1", rareRing(), [op("bogus")]);
        expect(check(c, ctx).diagnostics[0]?.message).toContain('Unknown currency "bogus"');
    });

    it("reports an unknown base", () => {
        const c = craft("poe1", item({ base: "Nonexistent", ilvl: 1, rarity: "normal" }), [
            op("transmute"),
        ]);
        expect(check(c, ctx).diagnostics[0]?.message).toContain('Unknown base "Nonexistent"');
    });

    it("reports an unknown mod in a predicate", () => {
        const c = craft("poe1", rareRing(), [until(has("Nope"), [op("exalt")])]);
        expect(
            check(c, ctx).diagnostics.some((d) => d.message.includes('Unknown mod "Nope"')),
        ).toBe(true);
    });

    it("resolves mods and bases via aliases", () => {
        const c = craft("poe1", rareRing(["T1 Life"]), [op("exalt")]);
        const r = check(c, ctx);
        expect(r.ok).toBe(true);
        expect(guaranteedTypes(r.finalState!).has(LIFE_T1.type)).toBe(true);
    });
});

describe("checker — item-block well-formedness", () => {
    it("flags too many prefixes for the rarity", () => {
        const c = craft("poe1", rareRing(["random", "random", "random", "random"]), []);
        expect(check(c, ctx).diagnostics[0]?.message).toContain("too many prefixes");
    });

    it("flags a mod listed under the wrong generation", () => {
        // FireResist1 is a suffix; listing it under prefixes is a mistake.
        const c = craft("poe1", rareRing(["FireResist1"]), []);
        expect(check(c, ctx).diagnostics[0]?.message).toContain("is a suffix");
    });
});
