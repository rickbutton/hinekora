import { describe, expect, it } from "vitest";
import { check, type CheckContext } from "./check.js";
import {
    canBeRare,
    cardinalityGuarantees,
    disjunctiveGuarantees,
    disjunctiveTier,
    excludedTypes,
    guaranteedTypes,
    suffixRange,
} from "./astate.js";
import { buildRegistry } from "../resolve/registry.js";
import {
    andp,
    bench,
    blockArg,
    call,
    callStmt,
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
    paramStep,
    procDef,
    restart,
    stop,
    tierArg,
    until,
} from "../__fixtures__/ast.js";
import {
    AMULET_BASE,
    BENCH_LIFE_ROW,
    CATALOG,
    CLASS_RING,
    COLD_RESIST,
    DUAL_SIDE_AMULET_SUFFIX,
    DUAL_SIDE_RING_PREFIX,
    FIRE_RES_TIERED,
    FIRE_RESIST,
    FLASK_BASE,
    LIFE_T1,
    LIGHTNING_RESIST,
    RATCHETING_BASE,
    RING_BASE,
    SIMPLEX_BASE,
    SPECIFIC_WEAPON_A,
    SPECIFIC_WEAPON_B,
    STAFFY_ADDER,
    STAFFY_ENABLED,
    PROTECT_SUFFIXES_CARRIER,
    AMULET_ONLY,
} from "../__fixtures__/mods.js";
import { ClassId } from "../model/ids.js";
import type { BenchCraft, EssenceSpec } from "../model/sources.js";

// A fixture bench craft that adds T1 life (a prefix) on a Ring.
const BENCH_LIFE: BenchCraft = {
    mod: BENCH_LIFE_ROW.id,
    tier: 1,
    itemClasses: new Set([CLASS_RING]),
};

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
    bases: [RING_BASE, AMULET_BASE, SIMPLEX_BASE, RATCHETING_BASE, FLASK_BASE],
    mods: [...CATALOG, BENCH_LIFE_ROW],
    modAliases: { "T1 Life": "IncreasedLife1" },
    baseAliases: {
        "Iron Ring": "IronRing",
        "Simplex Amulet": "SimplexAmulet",
        "Ratcheting Ring": "RatchetingRing",
        "Life Flask": "LifeFlask",
    },
    essences: [ESS_DEAFENING, ESS_MUTTERING],
    benchCrafts: [BENCH_LIFE],
});
const ctx: CheckContext = { registry };

/** Convenience: a rare Iron Ring item block with the given affix name lists. */
const rareRing = (prefixes: string[] = [], suffixes: string[] = []) =>
    item({ base: "Iron Ring", ilvl: 100, rarity: "rare", prefixes, suffixes });

describe("checker — a valid craft type-checks", () => {
    it("transmute → regal → exalt on a Normal item is clean", () => {
        const c = craft(item({ base: "Iron Ring", ilvl: 100, rarity: "normal" }), [
            op("transmute"),
            op("regal"),
            op("exalt"),
        ]);
        const r = check(c, ctx);
        expect(r.diagnostics).toEqual([]);
        expect(r.ok).toBe(true);
        expect(r.finalState?.rarities).toEqual(new Set(["rare"]));
    });
});

describe("checker — the wider currency set", () => {
    it("alchemy takes a Normal item to a Rare with 4–6 mods", () => {
        const c = craft(item({ base: "Iron Ring", ilvl: 100, rarity: "normal" }), [op("alchemy")]);
        const r = check(c, ctx);
        expect(r.ok).toBe(true);
        expect(r.finalState?.rarities).toEqual(new Set(["rare"]));
        expect(r.finalState?.counts.total).toEqual([4, 6]);
    });

    it("chaos reforges a Rare — no prior mod stays guaranteed", () => {
        const c = craft(rareRing(["IncreasedLife1"]), [op("chaos")]);
        const r = check(c, ctx);
        expect(r.ok).toBe(true);
        expect(r.finalState?.rarities).toEqual(new Set(["rare"]));
        expect(guaranteedTypes(r.finalState!).size).toBe(0);
    });

    it("`until has X { chaos }` checks clean — a reforge never gets stuck full", () => {
        // The contrast with exalt: chaos resets the count each iteration, so it
        // can't fill to 6 and strand the next op. This is the payoff of modelling
        // reforge as a bounded range rather than an unbounded add.
        const c = craft(rareRing(), [until(has("IncreasedLife1"), [op("chaos")])]);
        expect(check(c, ctx).diagnostics).toEqual([]);
    });

    it("scour strips a Rare back to Normal with no mods", () => {
        const c = craft(rareRing(["IncreasedLife1"], ["FireResist1"]), [op("scour")]);
        const r = check(c, ctx);
        expect(r.ok).toBe(true);
        expect(r.finalState?.rarities).toEqual(new Set(["normal"]));
        expect(r.finalState?.counts.total).toEqual([0, 0]);
    });

    it("rejects scouring an item that has no mods (wasted currency)", () => {
        const c = craft(item({ base: "Iron Ring", ilvl: 100, rarity: "normal" }), [op("scour")]);
        expect(check(c, ctx).diagnostics[0]?.message).toContain("removable affix");
    });

    it("augment fills the open slot of a Magic item once a prefix is proven absent, then rejects a second", () => {
        // A transmute lays down one or two modifiers, so an augment is only safe
        // once a side is proven open; afterwards the item is full on every path.
        const c = craft(item({ base: "Iron Ring", ilvl: 100, rarity: "normal" }), [
            op("transmute"), // → Magic, 1–2 affixes
            iff(cmp("prefixCount", "==", 0), [op("augment")], []), // → 2 (full)
            op("augment"), // → no open slot
        ]);
        const r = check(c, ctx);
        expect(r.ok).toBe(false);
        expect(r.diagnostics.some((d) => d.message.includes("open affix slot"))).toBe(true);
    });

    it("annul works on a Magic item (not just Rare)", () => {
        const c = craft(
            item({ base: "Iron Ring", ilvl: 100, rarity: "magic", prefixes: ["IncreasedLife1"] }),
            [op("annul")],
        );
        const r = check(c, ctx);
        expect(r.ok).toBe(true);
        expect(r.finalState?.rarities).toEqual(new Set(["magic"]));
    });

    it("rejects alchemy on a Magic item (wrong rarity)", () => {
        const c = craft(item({ base: "Iron Ring", ilvl: 100, rarity: "magic" }), [op("alchemy")]);
        expect(check(c, ctx).diagnostics[0]?.message).toContain("Requires a Normal item");
    });
});

describe("checker — essences", () => {
    const normalRing = () => item({ base: "Iron Ring", ilvl: 100, rarity: "normal" });

    it("guarantees its mod, reforging a Normal item to Rare", () => {
        const r = check(craft(normalRing(), [essence("Deafening Essence of Greed")]), ctx);
        expect(r.ok).toBe(true);
        expect(r.finalState?.rarities).toEqual(new Set(["rare"]));
        expect(guaranteedTypes(r.finalState!).has(LIFE_T1.type)).toBe(true);
    });

    it("resolves the `type + t1` shorthand (t1 = Deafening = best)", () => {
        const r = check(craft(normalRing(), [essence("greed", 1)]), ctx);
        expect(guaranteedTypes(r.finalState!).has(LIFE_T1.type)).toBe(true);
    });

    it("a high-tier essence reforges a Rare item too", () => {
        const r = check(craft(rareRing(["random"]), [essence("Deafening Essence of Greed")]), ctx);
        expect(r.ok).toBe(true);
        expect(guaranteedTypes(r.finalState!).has(LIFE_T1.type)).toBe(true);
    });

    it("rejects a low-tier essence on a Rare item", () => {
        const c = craft(rareRing(), [essence("Muttering Essence of Greed")]);
        expect(check(c, ctx).diagnostics[0]?.message).toContain("Requires a Normal item");
    });

    it("rejects any essence on a Magic item", () => {
        const c = craft(item({ base: "Iron Ring", ilvl: 100, rarity: "magic" }), [
            essence("Deafening Essence of Greed"),
        ]);
        expect(check(c, ctx).diagnostics[0]?.message).toContain("Magic item");
    });

    it("rejects an essence that grants nothing for the item's class", () => {
        // The fixture essences only grant on Ring; a Coral Amulet has no grant.
        const c = craft(item({ base: "CoralAmulet", ilvl: 100, rarity: "normal" }), [
            essence("Deafening Essence of Greed"),
        ]);
        expect(check(c, ctx).diagnostics[0]?.message).toContain("grants no mod");
    });

    it("reports an unknown essence", () => {
        const c = craft(normalRing(), [essence("Bogus Essence of Nothing")]);
        expect(check(c, ctx).diagnostics[0]?.message).toContain("Unknown essence");
    });
});

describe("checker — bench crafts", () => {
    it("adds a guaranteed mod into its open slot", () => {
        const r = check(craft(rareRing(), [bench("maximum life")]), ctx);
        expect(r.ok).toBe(true);
        expect(guaranteedTypes(r.finalState!).has(LIFE_T1.type)).toBe(true);
    });

    it("is not blocked by a modifier of its group that is proven absent", () => {
        // The annul may have removed the life, so it is only possible; a branch
        // that proves it gone may bench it beside the remaining prefix.
        const c = craft(rareRing(["T1 Life", "random"]), [
            op("annul"),
            iff(notp(has("maximum life")), [bench("maximum life")]),
        ]);
        expect(check(c, ctx).diagnostics).toEqual([]);
    });

    it("rejects a bench craft when its generation is full", () => {
        // Life is a prefix; a 3-prefix Rare has no open prefix.
        const c = craft(rareRing(["random", "random", "random"]), [bench("maximum life")]);
        expect(check(c, ctx).diagnostics[0]?.message).toContain("open prefix slot");
    });

    it("reports an unresolvable bench mod", () => {
        const c = craft(rareRing(), [bench("nonexistent")]);
        expect(check(c, ctx).diagnostics[0]?.message).toContain("bench craft");
    });

    it("rejects a bench craft whose group is already present (one mod per group)", () => {
        // The ring already carries a life prefix; benching another life mod would
        // be a second mod of the same group — impossible in-game.
        const c = craft(rareRing(["IncreasedLife1"]), [bench("maximum life")]);
        const message = check(c, ctx).diagnostics[0]?.message;
        expect(message).toContain("at most one per group");
        // The item block declares the modifier, so it is not a "may".
        expect(message).toContain("The item already carries a ");
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
        const c = craft(rareRing(), [until(call("anyEle", [tierArg(1)]), [op("chaos")])], [d]);
        expect(check(c, ctx).diagnostics).toEqual([]);
    });

    it("a def-driven until guarantees the mod, exactly like the inlined predicate", () => {
        const d = def("hasLife", ["t"], hasP("IncreasedLife1", param("t")));
        const c = craft(rareRing(), [until(call("hasLife", [tierArg(1)]), [op("chaos")])], [d]);
        expect(guaranteedTypes(check(c, ctx).finalState!).has(LIFE_T1.type)).toBe(true);
    });

    it("passes a parameter through to a nested def call", () => {
        // def hasLife(t) = has life t;  def viaLife(t) = hasLife(t)
        const inner = def("hasLife", ["t"], hasP("IncreasedLife1", param("t")));
        const outer = def("viaLife", ["t"], call("hasLife", [param("t")]));
        const c = craft(
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
        const c = craft(rareRing(), [until(call("viaLife", ["x"]), [op("chaos")])], [inner, outer]);
        expect(check(c, ctx).diagnostics[0]?.message).toContain("should be a tier");
    });

    it("flags a parameter that is never used", () => {
        const d = def("f", ["t", "unused"], hasP("IncreasedLife1", param("t")));
        const c = craft(
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
            rareRing(),
            [until(call("viaLife", [tierArg(1)]), [op("chaos")])],
            [inner, outer],
        );
        expect(check(c, ctx).diagnostics.some((x) => x.message.includes("never used"))).toBe(false);
    });

    it("reports an unknown def", () => {
        const c = craft(rareRing(), [until(call("nope", [tierArg(1)]), [op("chaos")])]);
        expect(check(c, ctx).diagnostics[0]?.message).toContain(`unknown def "nope"`);
    });

    it("collapses the pairwise clauses of `≥2 of 3` into one cardinality", () => {
        // (fire∨cold) ∧ (fire∨lightning) ∧ (cold∨lightning) is exactly "≥2 of 3";
        // disjunctiveGuarantees yields the three pairs, cardinality folds them.
        const twoOfThree = andp(
            andp(
                orp(has("FireResist1"), has("ColdResist1")),
                orp(has("FireResist1"), has("LightningResist1")),
            ),
            orp(has("ColdResist1"), has("LightningResist1")),
        );
        const c = craft(rareRing(), [until(twoOfThree, [op("chaos")])]);
        const r = check(c, ctx);
        expect(disjunctiveGuarantees(r.finalState!)).toHaveLength(3); // the pairs
        const cards = cardinalityGuarantees(r.finalState!);
        expect(cards).toHaveLength(1);
        expect(cards[0]!.atLeast).toBe(2);
        expect(new Set(cards[0]!.types)).toEqual(
            new Set([FIRE_RESIST.type, COLD_RESIST.type, LIGHTNING_RESIST.type]),
        );
    });

    it("tracks a disjunctive guarantee after `until has X or has Y`", () => {
        // On exit, at least one of {life, fire-res} is present — neither alone is
        // guaranteed, but their disjunction is (the presence BDD keeps the OR).
        const c = craft(rareRing(), [
            until(orp(has("IncreasedLife1"), has("FireResist1")), [op("chaos")]),
        ]);
        const r = check(c, ctx);
        expect(guaranteedTypes(r.finalState!).size).toBe(0); // neither individually
        const disj = disjunctiveGuarantees(r.finalState!);
        expect(disj).toHaveLength(1);
        expect(new Set(disj[0])).toEqual(new Set([LIFE_T1.type, FIRE_RESIST.type]));
    });

    it("keeps each member's tier through a disjunctive join (`has X t1 or has Y t1`)", () => {
        // On exit the guarantee is (life@t1 ∨ fire-res@t1); the tier of each member
        // must survive the branch join, so a later hover/predicate sees t1 — not
        // the full roll span. This is the fact the flat `tiers` overlay dropped.
        const c = craft(rareRing(), [
            until(orp(has("IncreasedLife1", 1), has("FireResist1", 1)), [op("chaos")]),
        ]);
        const st = check(c, ctx).finalState!;
        const disj = disjunctiveGuarantees(st);
        expect(disj).toHaveLength(1);
        expect(disjunctiveTier(st, disj[0]!)).toEqual(
            new Map([
                [LIFE_T1.type, LIFE_T1.id],
                [FIRE_RESIST.type, FIRE_RESIST.id],
            ]),
        );
    });

    it("a tier-negating branch after a tier-qualified disjunction is dead", () => {
        // `until has X t1 or has Y t1 { chaos }` proves (X@t1 ∨ Y@t1) on exit; the
        // following `if not X t1 and not Y t1` can therefore never run. Only works
        // if the tier survives the join into the after-state.
        const c = craft(rareRing(), [
            until(orp(has("IncreasedLife1", 1), has("FireResist1", 1)), [op("chaos")]),
            iff(andp(notp(has("IncreasedLife1", 1)), notp(has("FireResist1", 1))), [op("annul")]),
        ]);
        const diags = check(c, ctx).diagnostics;
        expect(diags.some((d) => d.message.includes("'if' branch can never run"))).toBe(true);
    });

    it("reports an arity mismatch", () => {
        const d = def("f", ["t"], hasP("IncreasedLife1", param("t")));
        const c = craft(
            rareRing(),
            [until(call("f", [tierArg(1), tierArg(2)]), [op("chaos")])],
            [d],
        );
        expect(check(c, ctx).diagnostics[0]?.message).toContain("expects 1 argument");
    });

    it("rejects a bare-int count where a tier (t1) is expected", () => {
        const d = def("f", ["t"], hasP("IncreasedLife1", param("t")));
        const c = craft(rareRing(), [until(call("f", [1]), [op("chaos")])], [d]);
        expect(check(c, ctx).diagnostics[0]?.message).toContain("should be a tier (t1)");
    });

    it("reports an argument type mismatch (a string for a tier param)", () => {
        const d = def("f", ["t"], hasP("IncreasedLife1", param("t")));
        const c = craft(rareRing(), [until(call("f", ["oops"]), [op("chaos")])], [d]);
        expect(check(c, ctx).diagnostics[0]?.message).toContain("should be a tier");
    });

    it("flags a parameter used at conflicting sorts (tier vs mod), without cascading", () => {
        const d = def("weird", ["x"], orp(hasP(param("x")), hasP("IncreasedLife1", param("x"))));
        const c = craft(rareRing(), [until(call("weird", ["life"]), [op("chaos")])], [d]);
        const msgs = check(c, ctx).diagnostics.map((x) => x.message);
        expect(msgs.some((m) => m.includes("used in conflicting ways"))).toBe(true);
        expect(msgs.some((m) => m.includes("never given a value"))).toBe(false);
    });
});

describe("checker — operation functions", () => {
    const normalRing = () => item({ base: "Iron Ring", ilvl: 100, rarity: "normal" });

    it("inlines a proc body, threading item state through the call", () => {
        // def prep() { transmute regal } — a Normal item ends up Rare afterwards.
        const p = procDef("prep", [], [op("transmute"), op("regal")]);
        const c = craft(normalRing(), [callStmt("prep")], [], [p]);
        const r = check(c, ctx);
        expect(r.ok).toBe(true);
        expect(r.finalState!.rarities).toEqual(new Set(["rare"]));
    });

    it("expands a mod-name param used in a loop guard, proving the exit clean", () => {
        // def spam(m) { until has m { chaos } } — chaos reforges, exit reachable;
        // afterwards the named mod is guaranteed, exactly like the inlined form.
        const p = procDef("spam", ["m"], [until(hasP(param("m")), [op("chaos")])]);
        const c = craft(rareRing(), [callStmt("spam", ["maximum life"])], [], [p]);
        const r = check(c, ctx);
        expect(r.diagnostics).toEqual([]);
        expect(guaranteedTypes(r.finalState!).has(LIFE_T1.type)).toBe(true);
    });

    it("expands a mod-name param in a bench statement", () => {
        const p = procDef("add", ["m"], [bench(param("m"))]);
        const c = craft(rareRing(), [callStmt("add", ["maximum life"])], [], [p]);
        const r = check(c, ctx);
        expect(r.ok).toBe(true);
        expect(guaranteedTypes(r.finalState!).has(LIFE_T1.type)).toBe(true);
    });

    it("reports a precondition failure inside the inlined body", () => {
        // exalt inside the proc fails on a full 3+3 Rare, just as if written inline.
        const p = procDef("go", [], [op("exalt")]);
        const full = rareRing(["random", "random", "random"], ["random", "random", "random"]);
        const c = craft(full, [callStmt("go")], [], [p]);
        const r = check(c, ctx);
        expect(r.ok).toBe(false);
        expect(r.diagnostics.some((d) => d.message.includes("open affix slot"))).toBe(true);
    });

    it("a `restart` inside a proc re-enters the caller's loop (fill-up is flagged)", () => {
        // The proc-inlined `exalt; if not X { restart }` is the same fill-up danger
        // as writing it directly in the loop body — the restart back-edge must reach
        // the caller's loop invariant across the call boundary.
        const step = procDef(
            "step",
            [],
            [op("exalt"), iff(notp(has("IncreasedLife1")), [restart()])],
        );
        const c = craft(rareRing(), [until(has("IncreasedLife1"), [callStmt("step")])], [], [step]);
        const r = check(c, ctx);
        expect(r.ok).toBe(false);
        expect(r.diagnostics.some((d) => d.message.includes("open affix slot"))).toBe(true);
    });

    it("reports an arity mismatch on a call", () => {
        const p = procDef("add", ["m"], [bench(param("m"))]);
        const c = craft(rareRing(), [callStmt("add")], [], [p]);
        expect(check(c, ctx).diagnostics[0]?.message).toContain("expects 1 argument");
    });

    it("reports an argument sort mismatch (a tier where a mod name is expected)", () => {
        const p = procDef("add", ["m"], [bench(param("m"))]);
        const c = craft(rareRing(), [callStmt("add", [tierArg(1)])], [], [p]);
        expect(check(c, ctx).diagnostics[0]?.message).toContain("should be a quoted mod name");
    });

    it("reports an unknown operation function", () => {
        const c = craft(rareRing(), [callStmt("nope")]);
        expect(check(c, ctx).diagnostics[0]?.message).toContain(`unknown def "nope"`);
    });

    it("rejects calling a predicate def as a step", () => {
        const d = def("hasLife", ["t"], hasP("IncreasedLife1", param("t")));
        const c = craft(rareRing(), [callStmt("hasLife", [tierArg(1)])], [d]);
        expect(check(c, ctx).diagnostics[0]?.message).toContain("is a condition");
    });

    it("rejects calling a proc inside a condition", () => {
        const p = procDef("go", [], [op("exalt")]);
        const c = craft(rareRing(), [until(call("go"), [op("chaos")])], [], [p]);
        expect(check(c, ctx).diagnostics[0]?.message).toContain("runs operations");
    });

    it("rejects a recursive proc", () => {
        const p = procDef("loop", [], [op("scour"), callStmt("loop")]);
        const c = craft(rareRing(), [callStmt("loop")], [], [p]);
        expect(check(c, ctx).diagnostics.some((d) => d.message.includes("recursive"))).toBe(true);
    });

    it("flags a proc parameter that is never used", () => {
        const p = procDef("f", ["m", "unused"], [bench(param("m"))]);
        const c = craft(rareRing(), [callStmt("f", ["maximum life", "x"])], [], [p]);
        expect(check(c, ctx).diagnostics.some((d) => d.message.includes(`"unused"`))).toBe(true);
    });

    it("flags a proc name that collides with a predicate def", () => {
        const d = def("dup", ["t"], hasP("IncreasedLife1", param("t")));
        const p = procDef("dup", [], [op("scour")]);
        const c = craft(rareRing(), [], [d], [p]);
        expect(check(c, ctx).diagnostics.some((d) => d.message.includes("duplicate def"))).toBe(
            true,
        );
    });

    it("records a single trace entry for the call, not the inlined body", () => {
        const p = procDef("prep", [], [op("transmute"), op("regal")]);
        const c = craft(normalRing(), [callStmt("prep")], [], [p]);
        const trace = check(c, ctx).trace;
        const calls = trace.filter((e) => e.kind === "call");
        expect(calls).toHaveLength(1);
        // The inlined transmute/regal are a black box — no op entries leak into the trace.
        expect(trace.some((e) => e.kind === "operation")).toBe(false);
    });
});

describe("checker — step parameters", () => {
    const normalRing = () => item({ base: "Iron Ring", ilvl: 100, rarity: "normal" });

    it("runs a single step bound to a step parameter", () => {
        // def roll(m, c) { until has m { c } }   roll("maximum life", chaos)
        const p = procDef("roll", ["m", "c"], [until(hasP(param("m")), [paramStep("c")])]);
        const c = craft(
            rareRing(),
            [callStmt("roll", ["maximum life", blockArg([op("chaos")])])],
            [],
            [p],
        );
        const r = check(c, ctx);
        expect(r.diagnostics).toEqual([]);
        expect(guaranteedTypes(r.finalState!).has(LIFE_T1.type)).toBe(true);
    });

    it("runs a block of steps bound to a step parameter", () => {
        // def retry(b) { until has "life" { b } }   retry({ scour alchemy })
        const p = procDef("retry", ["b"], [until(has("IncreasedLife1"), [paramStep("b")])]);
        const c = craft(
            rareRing(),
            [callStmt("retry", [blockArg([op("scour"), op("alchemy")])])],
            [],
            [p],
        );
        const r = check(c, ctx);
        expect(r.diagnostics).toEqual([]);
        expect(guaranteedTypes(r.finalState!).has(LIFE_T1.type)).toBe(true);
    });

    it("threads state through the bound steps, so a refused step is reported", () => {
        // def once(b) { b }   once(regal) on a Normal item: regal needs a Magic item.
        const p = procDef("once", ["b"], [paramStep("b")]);
        const c = craft(normalRing(), [callStmt("once", [blockArg([op("regal")])])], [], [p]);
        expect(check(c, ctx).ok).toBe(false);
    });

    it("lets a step argument call the proc it is passed to", () => {
        // def twice(b) { b b }   twice(twice(chaos)) runs four chaos orbs, not recursion.
        const p = procDef("twice", ["b"], [paramStep("b"), paramStep("b")]);
        const inner = callStmt("twice", [blockArg([op("chaos")])]);
        const c = craft(rareRing(), [callStmt("twice", [blockArg([inner])])], [], [p]);
        const r = check(c, ctx);
        expect(r.diagnostics).toEqual([]);
        expect(r.ok).toBe(true);
    });

    it("rejects a proc that reaches itself through the steps it passes along", () => {
        // def twice(b) { b b }   def g() { twice(g()) }
        const twice = procDef("twice", ["b"], [paramStep("b"), paramStep("b")]);
        const g = procDef("g", [], [callStmt("twice", [blockArg([callStmt("g")])])]);
        const c = craft(rareRing(), [callStmt("g")], [], [twice, g]);
        const msgs = check(c, ctx).diagnostics.map((d) => d.message);
        expect(msgs).toContain(`recursive def "g" is not allowed`);
        expect(msgs).not.toContain(`recursive def "twice" is not allowed`);
    });

    it("reports a recursive proc at its definition even when never called", () => {
        const p = procDef("loop", [], [op("scour"), callStmt("loop")]);
        const c = craft(rareRing(), [op("chaos")], [], [p]);
        const r = check(c, ctx);
        expect(r.diagnostics.map((d) => d.message)).toContain(
            `recursive def "loop" is not allowed`,
        );
        expect(r.diagnostics[0]!.span).toEqual(p.span);
    });

    it("still rejects mutual recursion between procs", () => {
        const a = procDef("a", [], [op("scour"), callStmt("b")]);
        const b = procDef("b", [], [callStmt("a")]);
        const c = craft(rareRing(), [callStmt("a")], [], [a, b]);
        const msgs = check(c, ctx).diagnostics.map((d) => d.message);
        expect(msgs).toContain(`recursive def "a" is not allowed`);
        expect(msgs).toContain(`recursive def "b" is not allowed`);
    });

    it("substitutes the enclosing proc's params inside a step argument", () => {
        // def once(b) { b }   def want(m) { once(until has m { chaos }) }   want("maximum life")
        const once = procDef("once", ["b"], [paramStep("b")]);
        const want = procDef(
            "want",
            ["m"],
            [callStmt("once", [blockArg([until(hasP(param("m")), [op("chaos")])])])],
        );
        const c = craft(rareRing(), [callStmt("want", ["maximum life"])], [], [once, want]);
        const r = check(c, ctx);
        expect(r.diagnostics).toEqual([]);
        expect(guaranteedTypes(r.finalState!).has(LIFE_T1.type)).toBe(true);
    });

    it("keeps a callee parameter from capturing a name inside the bound steps", () => {
        // Both procs call their parameter `m`: a mod name in `want`, steps in `once`.
        const once = procDef("once", ["m"], [paramStep("m")]);
        const want = procDef(
            "want",
            ["m"],
            [callStmt("once", [blockArg([until(hasP(param("m")), [op("chaos")])])])],
        );
        const c = craft(rareRing(), [callStmt("want", ["maximum life"])], [], [once, want]);
        const r = check(c, ctx);
        expect(r.diagnostics).toEqual([]);
        expect(guaranteedTypes(r.finalState!).has(LIFE_T1.type)).toBe(true);
    });

    it("a restart inside the bound steps re-enters the caller's loop", () => {
        const once = procDef("once", ["b"], [paramStep("b")]);
        const body = blockArg([op("exalt"), iff(notp(has("IncreasedLife1")), [restart()])]);
        const c = craft(
            rareRing(),
            [until(has("IncreasedLife1"), [callStmt("once", [body])])],
            [],
            [once],
        );
        const r = check(c, ctx);
        expect(r.ok).toBe(false);
        expect(r.diagnostics.some((d) => d.message.includes("open affix slot"))).toBe(true);
    });

    it("reports a value where steps are expected, and steps where a value is", () => {
        const once = procDef("once", ["b"], [paramStep("b")]);
        const add = procDef("add", ["m"], [bench(param("m"))]);
        const c1 = craft(rareRing(), [callStmt("once", ["maximum life"])], [], [once]);
        expect(check(c1, ctx).diagnostics[0]?.message).toContain(
            "should be a step or a { … } block of steps",
        );
        const c2 = craft(rareRing(), [callStmt("add", [blockArg([op("chaos")])])], [], [add]);
        expect(check(c2, ctx).diagnostics[0]?.message).toContain("should be a quoted mod name");
    });

    it("reports a parameter used both as steps and as a mod name", () => {
        const p = procDef("f", ["x"], [paramStep("x"), bench(param("x"))]);
        const c = craft(rareRing(), [callStmt("f", [blockArg([op("chaos")])])], [], [p]);
        const msg = check(c, ctx).diagnostics[0]?.message ?? "";
        expect(msg).toContain("conflicting ways");
        expect(msg).toContain("a step");
    });

    it("forwards a step parameter to a nested proc", () => {
        const once = procDef("once", ["b"], [paramStep("b")]);
        const via = procDef("via", ["b"], [callStmt("once", [param("b")])]);
        const c = craft(rareRing(), [callStmt("via", [blockArg([op("chaos")])])], [], [once, via]);
        expect(check(c, ctx).diagnostics).toEqual([]);
    });
});

describe("checker — the rarity seam (surface §6 errors)", () => {
    it("keeps both rarities where paths meet, refusing what needs one of them", () => {
        const c = craft(
            item({ base: "Iron Ring", ilvl: 100, rarity: "magic", prefixes: ["T1 Life"] }),
            [op("augment"), iff(has("FireResist1"), [op("regal")]), op("regal")],
        );
        const r = check(c, ctx);
        expect(r.diagnostics[0]!.message).toContain("may be Magic or Rare");
        // After the refused regal the item is judged as the guide meant it: Rare.
        expect(r.finalState!.rarities).toEqual(new Set(["rare"]));
    });

    it("reports a refused step once and judges the rest as the guide meant", () => {
        // The regal is refused where the ring may still be Magic; the exalt after
        // it is judged on the Rare the regal would have made, not refused again.
        const c = craft(
            item({ base: "Iron Ring", ilvl: 100, rarity: "magic", prefixes: ["T1 Life"] }),
            [op("augment"), iff(has("FireResist1"), [op("regal")]), op("regal"), op("exalt")],
        );
        const r = check(c, ctx);
        expect(r.diagnostics).toHaveLength(1);
        expect(r.diagnostics[0]!.message).toContain("may be Magic or Rare");
        expect(r.finalState!.counts.total).toEqual([4, 5]);
    });

    it("judges the steps after a reforge refused for its rarity on the reforged item", () => {
        // A Chaos Orb requires a Rare and sets no rarity of its own: run on the
        // Normal ring it would leave no modifier for the annul to remove.
        const c = craft(item({ base: "Iron Ring", ilvl: 100, rarity: "normal" }), [
            op("chaos"),
            op("annul"),
        ]);
        const r = check(c, ctx);
        expect(r.diagnostics).toHaveLength(1);
        expect(r.diagnostics[0]!.message).toContain("Requires a Rare item");
        expect(r.finalState!.rarities).toEqual(new Set(["rare"]));
        expect(r.finalState!.counts.total).toEqual([3, 5]);
    });

    it("keeps a refused item's modifiers where the needed rarity could not hold them", () => {
        // A Rare ring of four modifiers cannot be the Magic item the augment
        // needs, so the exalt after it is judged on the Rare ring.
        const full = item({
            base: "Iron Ring",
            ilvl: 100,
            rarity: "rare",
            prefixes: ["T1 Life", "random"],
            suffixes: ["random", "random"],
        });
        const r = check(craft(full, [op("augment"), op("exalt")]), ctx);
        expect(r.diagnostics).toHaveLength(1);
        expect(r.diagnostics[0]!.message).toContain("Requires a Magic item");
        expect(r.finalState!.rarities).toEqual(new Set(["rare"]));
        expect(r.finalState!.counts.total).toEqual([6, 6]);
    });

    it("judges a scour and an essence over every rarity the item may have", () => {
        // A scour in one arm leaves the ring Normal or Magic where the arms meet:
        // a second scour may be wasted, a low essence may land on a Magic.
        const magicRing = item({
            base: "Iron Ring",
            ilvl: 100,
            rarity: "magic",
            prefixes: ["T1 Life"],
        });
        const meet = [op("augment"), iff(has("FireResist1"), [op("scour")])];
        const scoured = check(craft(magicRing, [...meet, op("scour")]), ctx);
        expect(scoured.diagnostics[0]!.message).toContain("removable affix");
        const essenced = check(
            craft(magicRing, [...meet, essence("Muttering Essence of Greed")]),
            ctx,
        );
        expect(essenced.diagnostics[0]!.message).toContain("may be Normal or Magic");
        // Normal or Rare: a scour in one arm of a Rare, then the low essence
        // may land on the Rare path.
        const rare = item({ base: "Iron Ring", ilvl: 100, rarity: "rare", prefixes: ["T1 Life"] });
        const scouredOrNot = check(
            craft(rare, [
                op("exalt"),
                iff(has("FireResist1"), [op("scour")]),
                essence("Muttering Essence of Greed"),
            ]),
            ctx,
        );
        expect(scouredOrNot.diagnostics[0]!.message).toContain("may be Normal or Rare");
    });

    it("rejects exalt on a Magic item and renders the state", () => {
        const c = craft(item({ base: "Iron Ring", ilvl: 100, rarity: "magic" }), [op("exalt")]);
        const r = check(c, ctx);
        expect(r.ok).toBe(false);
        expect(r.diagnostics[0]?.message).toContain("this item is Magic");
        expect(r.diagnostics[0]?.message).toContain("at this point the item is: IronRing · Magic");
    });

    it("rejects transmute on a Rare item", () => {
        const c = craft(rareRing(), [op("transmute")]);
        expect(check(c, ctx).diagnostics[0]?.message).toContain("Requires a Normal item");
    });

    it("rejects exalt on a full 3+3 Rare (no open slot)", () => {
        const c = craft(rareRing(["random", "random", "random"], ["random", "random", "random"]), [
            op("exalt"),
        ]);
        expect(check(c, ctx).diagnostics[0]?.message).toContain("open affix slot");
    });

    it("rejects annul on an empty Rare (nothing removable)", () => {
        const c = craft(rareRing(), [op("annul")]);
        expect(check(c, ctx).diagnostics[0]?.message).toContain("removable affix");
    });
});

describe("checker — guarantee tracking (additive vs risky)", () => {
    it("exalt preserves a present mod; the final state still guarantees it", () => {
        const c = craft(rareRing(["IncreasedLife1"]), [op("exalt")]);
        const r = check(c, ctx);
        expect(r.ok).toBe(true);
        expect(guaranteedTypes(r.finalState!).has(LIFE_T1.type)).toBe(true);
    });

    it("an unforced annul risks every mod; nothing stays guaranteed", () => {
        const c = craft(rareRing(["IncreasedLife1"], ["FireResist1"]), [op("annul")]);
        const r = check(c, ctx);
        expect(guaranteedTypes(r.finalState!).size).toBe(0);
    });
});

describe("checker — loops (loop-exit-as-proof)", () => {
    it("`until not has X { annul }` proves X absent afterwards", () => {
        // A draining loop: annul keeps removing until Fire Resist is gone. The
        // affix count only shrinks, so the loop is sound, and on exit X is proven
        // absent.
        const c = craft(rareRing(["IncreasedLife1"], ["FireResist1"]), [
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
        const c = craft(rareRing(), [until(has("IncreasedLife1"), [op("exalt")])]);
        const r = check(c, ctx);
        expect(r.ok).toBe(false);
        expect(r.diagnostics.some((d) => d.message.includes("open affix slot"))).toBe(true);
    });

    it("count coupling: a prefixCount-guarded exalt/annul loop checks clean", () => {
        // Exalt only when a prefix slot is open, else annul — so exalt can never
        // hit a full item and annul can never hit an empty one. This only checks
        // clean if refining prefixCount also tightens the total range.
        const c = craft(rareRing(), [
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
        const c = craft(rareRing(), [until(has("JewelOnly1"), [op("exalt")])]);
        const r = check(c, ctx);
        expect(r.ok).toBe(false);
        expect(r.diagnostics[0]?.message).toContain("can never exit");
    });
});

describe("checker — restart is a loop back-edge", () => {
    it("flags fill-up through a restart: `until has X { exalt; if not X { restart } }`", () => {
        // The restart re-enters the loop head with the item having gained a mod
        // but never lost one, so exalt can fill it to 6 before X rolls — the same
        // danger as `until has X { exalt }`. Only caught if the restart state joins
        // into the loop invariant.
        const c = craft(rareRing(), [
            until(has("IncreasedLife1"), [
                op("exalt"),
                iff(notp(has("IncreasedLife1")), [restart()]),
            ]),
        ]);
        const r = check(c, ctx);
        expect(r.ok).toBe(false);
        expect(r.diagnostics.some((d) => d.message.includes("open affix slot"))).toBe(true);
    });

    it("a draining recovery loop with restart stays clean (counts only shrink)", () => {
        // annul removes a mod, restart re-drains — bounded below by 0, so no
        // precondition ever fails. The restart back-edge must not manufacture a
        // spurious fill-up here.
        const c = craft(rareRing(["IncreasedLife1"], ["FireResist1"]), [
            until(notp(has("FireResist1")), [op("annul"), iff(has("FireResist1"), [restart()])]),
        ]);
        expect(check(c, ctx).diagnostics).toEqual([]);
    });
});

describe("checker — paths that leave different items stay apart", () => {
    const life = has("IncreasedLife1");
    const undo = iff(notp(life), [op("annul")]);
    const five = () => rareRing(["random", "random", "random"], ["random", "random"]);

    it("sorts the arms of a loop's last branch by the loop's condition", () => {
        // The arm that kept the new modifier has the life and leaves; the arm
        // that removed it is back at the count it started the round with. As
        // one summary, "one more modifier" and "no life" would go round together.
        const c = craft(rareRing(), [until(life, [op("exalt"), undo])]);
        const r = check(c, ctx);
        expect(r.diagnostics).toEqual([]);
        expect(r.finalState?.counts.total).toEqual([1, 1]);
    });

    it("does so through a nested branch, a def's steps and a restart on one arm", () => {
        const clean = (
            body: Parameters<typeof until>[1],
            procs: ReturnType<typeof procDef>[] = [],
        ): void => {
            const r = check(craft(rareRing(), [until(life, body)], [], procs), ctx);
            expect(r.diagnostics).toEqual([]);
            expect(r.finalState?.counts.total).toEqual([1, 1]);
        };
        clean([op("exalt"), iff(has("FireResist1"), [op("annul")], [undo])]);
        clean([callStmt("round")], [procDef("round", [], [op("exalt"), undo])]);
        clean([op("exalt"), iff(has("FireResist1"), [op("annul"), restart()], [undo])]);
    });

    it("keeps them apart through the steps after the branch", () => {
        const c = craft(rareRing([], ["random"]), [
            until(life, [op("exalt"), undo, iff(has("FireResist1"), [stop()])]),
        ]);
        expect(check(c, ctx).diagnostics).toEqual([]);
    });

    it("lets a later branch pick the path whose count has room, outside a loop too", () => {
        // Six modifiers with the life, five without it.
        const filled = [op("exalt"), undo];
        expect(
            check(craft(five(), [...filled, iff(notp(life), [op("exalt")])]), ctx).diagnostics,
        ).toEqual([]);
        const full = check(craft(five(), [...filled, iff(life, [op("exalt")])]), ctx);
        expect(full.diagnostics.map((d) => d.message).join()).toContain("open affix slot");
    });

    it("still refuses a round that some arm leaves one modifier fuller", () => {
        const c = craft(rareRing(), [
            until(life, [op("exalt"), iff(has("FireResist1"), [op("annul")])]),
        ]);
        const r = check(c, ctx);
        expect(r.diagnostics.some((d) => d.message.includes("open affix slot"))).toBe(true);
    });

    it("shows one item for a step, covering every path that reaches it", () => {
        const c = craft(five(), [op("exalt"), undo, op("annul")]);
        const r = check(c, ctx);
        const last = r.trace.filter((e) => e.kind === "operation").at(-1)!;
        expect(last.before.counts.total).toEqual([5, 6]);
    });

    it("judges a loop inside a loop on the passes that settle the outer one", () => {
        // The outer loop's exit rests on the inner loop's exits as the quiet
        // passes found them: a reforged item with the fire resistance.
        const fire = has("FireResist1");
        const c = craft(rareRing(), [until(life, [until(fire, [op("chaos")])])]);
        const r = check(c, ctx);
        expect(r.diagnostics).toEqual([]);
        expect(r.finalState?.counts.total).toEqual([4, 6]);
        expect(guaranteedTypes(r.finalState!).has(FIRE_RESIST.type)).toBe(true);
    });

    it("judges an inner loop met again with the same items as it did the first time", () => {
        // The outer loop comes round to the inner one with the items it entered
        // it with before; in place or in a def, the verdict and the item agree.
        const fire = has("FireResist1");
        const inner = until(fire, [op("chaos")]);
        const fills = [inner, op("exalt"), iff(notp(life), [op("exalt")])];
        const inPlace = check(craft(rareRing(), [until(life, fills)]), ctx);
        const inDef = check(
            craft(
                rareRing(),
                [until(life, [callStmt("round")])],
                [],
                [procDef("round", [], fills)],
            ),
            ctx,
        );
        const messages = (r: typeof inPlace) => r.diagnostics.map((d) => d.message);
        expect(messages(inPlace).join()).toContain("open affix slot");
        expect(messages(inDef)).toEqual(messages(inPlace));
        expect(inDef.finalState?.counts).toEqual(inPlace.finalState?.counts);
    });

    it("reports a step that fails on one path once, for the item over every path", () => {
        const r = check(craft(five(), [op("exalt"), undo, op("exalt")]), ctx);
        expect(r.diagnostics).toHaveLength(1);
        expect(r.diagnostics[0]!.message).toContain("5–6 affixes");
        expect(r.diagnostics[0]!.message).toContain("the item may be full");
    });

    it("refuses a craft whose paths outnumber those it keeps apart, once for a step", () => {
        const loop = craft(rareRing(), [until(life, [op("exalt"), undo])]);
        expect(check(loop, ctx, { maxParts: 2 }).diagnostics).toEqual([]);
        const one = check(loop, ctx, { maxParts: 1 }).diagnostics.map((d) => d.message);
        const tooMany = one.filter((m) => m.startsWith("Too many different items reach this step"));
        // The branch and the loop each meet two paths, on every pass over them.
        expect(tooMany).toHaveLength(2);
        expect(tooMany[0]).toContain("more than 1 combinations");
    });

    it("refuses a loop that fills the item whatever the number kept apart", () => {
        // Each round leaves more counts at the head than a small number holds,
        // so the last of them are joined; the full item is still among them.
        const fills = craft(rareRing(), [
            until(life, [op("exalt"), iff(has("FireResist1"), [op("annul")], [undo, op("exalt")])]),
        ]);
        for (const maxParts of [1, 2, 3, 12]) {
            const r = check(fills, ctx, { maxParts });
            expect(r.diagnostics.some((d) => d.message.includes("open affix slot"))).toBe(true);
        }
    });

    it("judges a loop the same once its parts have become one widened summary", () => {
        const round = (last: Parameters<typeof until>[1][number]) =>
            craft(rareRing(), [until(life, [op("exalt"), last])]);
        const wide = { widenRangesAfter: 0 };
        expect(check(round(undo), ctx, wide).diagnostics).toEqual([]);
        const fills = check(round(iff(has("FireResist1"), [op("annul")])), ctx, wide);
        expect(fills.diagnostics.some((d) => d.message.includes("open affix slot"))).toBe(true);
    });

    const fireOrBoth = orp(has("FireResist1"), andp(has("ColdResist1"), has("LightningResist1")));

    it("keeps a path whose one suffix may meet the condition alone", () => {
        // Three prefixes and the fire resistance: the branch runs, and the
        // third Exalted Orb in it finds the item full.
        const c = craft(rareRing(["random", "random"], ["random"]), [
            op("exalt"),
            iff(cmp("prefixCount", "==", 2), [
                op("annul"),
                iff(cmp("suffixCount", "<=", 1), [stop()]),
            ]),
            iff(fireOrBoth, [op("exalt"), op("exalt"), op("exalt")]),
        ]);
        const r = check(c, ctx);
        expect(r.diagnostics.some((d) => d.message.includes("open affix slot"))).toBe(true);
        const open = craft(rareRing(["random", "random", "random"], ["random"]), [
            iff(fireOrBoth, [op("annul")]),
        ]);
        expect(check(open, ctx).diagnostics).toEqual([]);
    });
});

describe("checker — narrowing (if / else) and dead arms", () => {
    it("flags a dead 'if' branch (predicate impossible)", () => {
        const c = craft(rareRing(), [iff(isRarity("magic"), [op("exalt")])]);
        const r = check(c, ctx);
        expect(r.diagnostics[0]?.message).toContain("'if' branch can never run");
    });

    it("flags a dead 'else' branch (predicate always holds)", () => {
        const c = craft(rareRing(), [iff(isRarity("rare"), [], [op("annul")])]);
        const r = check(c, ctx);
        expect(r.diagnostics[0]?.message).toContain("'else' branch can never run");
    });

    it("accepts a genuine two-way narrow with no dead arm", () => {
        // Two affixes: an unforced annul may remove Life or Fire Resist, so
        // afterwards Life is possible-but-not-guaranteed — both `has` and
        // `not has` arms are inhabited.
        const c = craft(rareRing(["IncreasedLife1"], ["FireResist1"]), [
            op("annul"),
            iff(has("IncreasedLife1"), [], []),
        ]);
        expect(check(c, ctx).diagnostics).toEqual([]);
    });

    it("narrows counts with a comparison predicate", () => {
        const c = craft(rareRing(["random"]), [
            op("exalt"), // prefix ∈ [1,2] afterwards
            iff(cmp("prefixCount", "==", 2), [], []),
        ]);
        expect(check(c, ctx).diagnostics).toEqual([]);
    });
});

describe("checker — boolean predicates (and / or)", () => {
    it("`or`: a disjunction that always holds makes the else arm dead", () => {
        // Life is guaranteed, so `has life or has fire` is always true.
        const c = craft(rareRing(["IncreasedLife1"]), [
            iff(orp(has("IncreasedLife1"), has("FireResist1")), [], [op("annul")]),
        ]);
        expect(check(c, ctx).diagnostics[0]?.message).toContain("'else' branch can never run");
    });

    it("`and`: an impossible conjunct makes the if arm dead", () => {
        // isMagic is false on a Rare item, so the whole conjunction is impossible.
        const c = craft(rareRing(), [
            iff(andp(isRarity("magic"), has("IncreasedLife1")), [op("exalt")]),
        ]);
        expect(check(c, ctx).diagnostics[0]?.message).toContain("'if' branch can never run");
    });

    it("`or`: a genuine two-way narrow has no dead arm", () => {
        // After one exalt the added mod might be life, fire, or neither — so both
        // arms of `has life or has fire` are inhabited.
        const c = craft(rareRing(), [
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
        const c = craft(rareRing(), [
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
        const c = craft(rareRing(["IncreasedLife1"], ["FireResist1"]), [
            until(notp(orp(has("IncreasedLife1"), has("FireResist1"))), [op("annul")]),
        ]);
        const r = check(c, ctx);
        expect(r.diagnostics).toEqual([]);
        expect(excludedTypes(r.finalState!).has(LIFE_T1.type)).toBe(true);
        expect(excludedTypes(r.finalState!).has(FIRE_RESIST.type)).toBe(true);
    });
});

describe("checker — resolve-time errors", () => {
    it("reports an unknown currency", () => {
        const c = craft(rareRing(), [op("bogus")]);
        expect(check(c, ctx).diagnostics[0]?.message).toContain('Unknown currency "bogus"');
    });

    it("reports an unknown base", () => {
        const c = craft(item({ base: "Nonexistent", ilvl: 1, rarity: "normal" }), [
            op("transmute"),
        ]);
        expect(check(c, ctx).diagnostics[0]?.message).toContain('Unknown base "Nonexistent"');
    });

    it("reports an unknown mod in a predicate", () => {
        const c = craft(rareRing(), [until(has("Nope"), [op("exalt")])]);
        expect(
            check(c, ctx).diagnostics.some((d) => d.message.includes('Unknown mod "Nope"')),
        ).toBe(true);
    });

    it("resolves mods and bases via aliases", () => {
        const c = craft(rareRing(["T1 Life"]), [op("exalt")]);
        const r = check(c, ctx);
        expect(r.ok).toBe(true);
        expect(guaranteedTypes(r.finalState!).has(LIFE_T1.type)).toBe(true);
    });
});

describe("checker — item-block well-formedness", () => {
    it("flags too many prefixes for the rarity", () => {
        const c = craft(rareRing(["random", "random", "random", "random"]), []);
        expect(check(c, ctx).diagnostics[0]?.message).toContain("too many prefixes");
    });

    it("flags a mod listed under the wrong generation", () => {
        // FireResist1 is a suffix; listing it under prefixes is a mistake.
        const c = craft(rareRing(["FireResist1"]), []);
        expect(check(c, ctx).diagnostics[0]?.message).toContain("is a suffix");
    });
});

describe("checker — per-base affix caps (experimented bases)", () => {
    const normal = (base: string) => item({ base, ilvl: 100, rarity: "normal" });

    it("a reforge on a reduced-cap base fills to its exact split (rare Simplex: 1p / 2s)", () => {
        // alchemy wants 4–6 mods but the Simplex holds only 3 (1 prefix + 2
        // suffixes), so the count clamps and the split is forced.
        const st = check(craft(normal("Simplex Amulet"), [op("alchemy")]), ctx).finalState!;
        expect(st.rarities).toEqual(new Set(["rare"]));
        expect(st.counts.total).toEqual([3, 3]);
        expect(st.counts.prefix).toEqual([1, 1]);
        expect(suffixRange(st)).toEqual([2, 2]);
    });

    it("transmute on a 0-cap magic base adds no modifiers; augment then has no slot", () => {
        const r = check(craft(normal("Simplex Amulet"), [op("transmute"), op("augment")]), ctx);
        expect(r.finalState!.rarities).toEqual(new Set(["magic"]));
        expect(r.finalState!.counts.total).toEqual([0, 0]); // blue base, no explicit mods
        expect(r.diagnostics.some((d) => d.message.toLowerCase().includes("open"))).toBe(true);
    });

    it("a magic +suffix base is held to the hard total of 2 (Ratcheting: 0p / 2s max)", () => {
        // The +3 suffix would raw-cap at 4, but the magic hard total is 2. A
        // transmute lays down one or two suffixes and an augment fills the second
        // when one is proven open; prefixes never appear.
        const r = check(
            craft(normal("Ratcheting Ring"), [
                op("transmute"),
                iff(cmp("suffixCount", "<", 2), [op("augment")], []),
            ]),
            ctx,
        );
        expect(r.finalState!.counts.total).toEqual([2, 2]);
        expect(r.finalState!.counts.prefix).toEqual([0, 0]);
        expect(suffixRange(r.finalState!)).toEqual([2, 2]);
    });

    it("a modifier's side is read from the rows that roll on this base", () => {
        // The type has a prefix row on rings and a suffix row on amulets; the amulet
        // item lists it under suffixes correctly, the ring one does not.
        const dual = buildRegistry({
            bases: [RING_BASE, AMULET_BASE],
            mods: [...CATALOG, DUAL_SIDE_RING_PREFIX, DUAL_SIDE_AMULET_SUFFIX],
            baseAliases: { "Iron Ring": "IronRing", "Coral Amulet": "CoralAmulet" },
        });
        const onAmulet = item({
            base: "Coral Amulet",
            ilvl: 100,
            rarity: "rare",
            suffixes: [{ mod: "dual side", tier: 1 }],
        });
        expect(check(craft(onAmulet, []), { registry: dual }).diagnostics).toEqual([]);
        const onRing = item({
            base: "Iron Ring",
            ilvl: 100,
            rarity: "rare",
            suffixes: [{ mod: "dual side", tier: 1 }],
        });
        expect(check(craft(onRing, []), { registry: dual }).diagnostics[0]?.message).toContain(
            "is a prefix",
        );
    });

    it("the add-pool and a removal place a dual-side modifier on the base's side", () => {
        const dual = buildRegistry({
            bases: [RING_BASE, AMULET_BASE],
            mods: [
                ...CATALOG,
                DUAL_SIDE_RING_PREFIX,
                DUAL_SIDE_AMULET_SUFFIX,
                PROTECT_SUFFIXES_CARRIER,
            ],
            baseAliases: { "Iron Ring": "IronRing", "Coral Amulet": "CoralAmulet" },
        });
        // On an amulet the type is a suffix: with two more suffixes the side is full,
        // so an exalt can add no suffix (fire resistance stays impossible).
        const fullSuffixes = item({
            base: "Coral Amulet",
            ilvl: 100,
            rarity: "rare",
            suffixes: [{ mod: "dual side", tier: 1 }, "ColdResist1", "LightningResist1"],
        });
        const added = check(craft(fullSuffixes, [op("exalt")]), { registry: dual });
        expect(added.diagnostics).toEqual([]);
        expect(added.finalState!.possible.has(FIRE_RESIST.type)).toBe(false);
        // With the suffixes protected, an annul cannot reach the suffix side, so
        // the dual-side modifier's guarantee survives on the amulet.
        const withPrefix = item({
            base: "Coral Amulet",
            ilvl: 100,
            rarity: "rare",
            prefixes: ["IncreasedLife1", PROTECT_SUFFIXES_CARRIER.id],
            suffixes: [{ mod: "dual side", tier: 1 }],
        });
        const removed = check(craft(withPrefix, [op("annul")]), { registry: dual });
        expect(removed.diagnostics).toEqual([]);
        expect(guaranteedTypes(removed.finalState!).has(DUAL_SIDE_AMULET_SUFFIX.type)).toBe(true);
    });

    it("a present modifier's added tag keeps a blocked modifier out of the add-pool", () => {
        // Alpha adds a tag on which beta has a zero weight: with alpha guaranteed, no
        // exalt can ever add beta, so a loop waiting for it can never exit.
        const tagged = buildRegistry({
            bases: [RING_BASE],
            mods: [...CATALOG, SPECIFIC_WEAPON_A, SPECIFIC_WEAPON_B],
            baseAliases: { "Iron Ring": "IronRing" },
        });
        const withAlpha = item({
            base: "Iron Ring",
            ilvl: 100,
            rarity: "rare",
            prefixes: ["SpecificWeaponA1"],
        });
        const r = check(craft(withAlpha, [until(has("specific weapon beta"), [op("exalt")])]), {
            registry: tagged,
        });
        expect(r.diagnostics[0]?.message).toContain("can never exit");
    });

    it("a reforge's own rolls may enable a row for its later rolls", () => {
        // A chaos can lay down the adder and then the row its tag enables, so a
        // loop waiting for the enabled row is not one that can never exit.
        const staffy = buildRegistry({
            bases: [RING_BASE],
            mods: [...CATALOG, STAFFY_ADDER, STAFFY_ENABLED],
            baseAliases: { "Iron Ring": "IronRing" },
        });
        const ring = item({ base: "Iron Ring", ilvl: 100, rarity: "rare" });
        const r = check(craft(ring, [op("chaos")]), { registry: staffy });
        expect(r.finalState!.possible.has(STAFFY_ENABLED.type)).toBe(true);
        const loop = check(craft(ring, [until(has("staffy enabled"), [op("chaos")])]), {
            registry: staffy,
        });
        expect(loop.diagnostics).toEqual([]);
    });

    it("a possibly present modifier's added tag admits the row it would enable", () => {
        // After a chaos the adder is possible but not guaranteed; the enabled row
        // must then be possible after the next add, or a later bench conflict could
        // be missed.
        const staffy = buildRegistry({
            bases: [RING_BASE],
            mods: [...CATALOG, STAFFY_ADDER, STAFFY_ENABLED],
            baseAliases: { "Iron Ring": "IronRing" },
        });
        const ring = item({ base: "Iron Ring", ilvl: 100, rarity: "rare" });
        // The annul reopens a slot, since a chaos may fill the item.
        const r = check(craft(ring, [op("chaos"), op("annul"), op("exalt")]), {
            registry: staffy,
        });
        expect(r.finalState!.possible.has(STAFFY_ADDER.type)).toBe(true);
        expect(r.finalState!.possible.has(STAFFY_ENABLED.type)).toBe(true);
    });

    it("the item block rejects a count over the combined cap (three suffixes on a magic Ratcheting)", () => {
        // Each side fits its own cap (suffix cap four) but the magic total is two;
        // the declared item is reported and the state starts within the cap rather
        // than silently emptying at the first normalize.
        const over = item({
            base: "Ratcheting Ring",
            ilvl: 100,
            rarity: "magic",
            suffixes: ["random", "random", "random"],
        });
        const r = check(craft(over, []), ctx);
        expect(r.diagnostics[0]?.message).toContain("too many modifiers");
        expect(r.finalState!.counts.total).toEqual([2, 2]);
    });

    it("a named side also needs the total under its cap (bench a suffix on a full magic Ratcheting)", () => {
        // Two suffixes fill the magic total of 2 although the suffix side cap is 4,
        // so a benched suffix has no slot: the open-slot check on a named side
        // must read the total cap as well as the side cap.
        const suffixBench = buildRegistry({
            bases: [RATCHETING_BASE],
            mods: [...CATALOG, FIRE_RES_TIERED],
            baseAliases: { "Ratcheting Ring": "RatchetingRing" },
            benchCrafts: [{ mod: FIRE_RES_TIERED.id, tier: 1, itemClasses: new Set([CLASS_RING]) }],
        });
        const full = item({
            base: "Ratcheting Ring",
            ilvl: 100,
            rarity: "magic",
            suffixes: ["random", "random"],
        });
        const r = check(craft(full, [bench("fire resistance")]), { registry: suffixBench });
        expect(r.diagnostics[0]?.message).toContain("open suffix slot");
    });

    it("rare Simplex is full after a reforge: exalt fails, but works after an annul reopens a slot", () => {
        const full = check(craft(normal("Simplex Amulet"), [op("alchemy"), op("exalt")]), ctx);
        expect(full.diagnostics.some((d) => d.message.toLowerCase().includes("open"))).toBe(true);

        const reopened = check(
            craft(normal("Simplex Amulet"), [op("alchemy"), op("annul"), op("exalt")]),
            ctx,
        );
        expect(reopened.diagnostics).toEqual([]);
    });

    it("scour on a 0-cap magic base is not wasted currency (blue → white)", () => {
        const r = check(craft(normal("Simplex Amulet"), [op("transmute"), op("scour")]), ctx);
        expect(r.diagnostics).toEqual([]); // scour still drops the rarity
        expect(r.finalState!.rarities).toEqual(new Set(["normal"]));
    });
});

describe("checker — flasks cap at Magic (no Rare flasks)", () => {
    const flask = (rarity: "normal" | "magic" | "rare") =>
        item({ base: "Life Flask", ilvl: 100, rarity });

    it("transmute → augment on a flask is fine (Magic is allowed)", () => {
        const r = check(craft(flask("normal"), [op("transmute")]), ctx);
        expect(r.diagnostics).toEqual([]);
        expect(r.finalState!.rarities).toEqual(new Set(["magic"]));
    });

    it("alchemy on a flask is rejected — it cannot be made Rare", () => {
        const r = check(craft(flask("normal"), [op("alchemy")]), ctx);
        expect(r.diagnostics[0]?.message).toContain("cannot be made Rare");
    });

    it("regal on a magic flask is rejected", () => {
        const r = check(craft(flask("normal"), [op("transmute"), op("regal")]), ctx);
        expect(r.diagnostics.some((d) => d.message.includes("cannot be made Rare"))).toBe(true);
    });

    it("relics, charms, tinctures and critical utility flasks are never Rare either", () => {
        for (const cls of [
            "UtilityFlaskCritical",
            "Tincture",
            "Relic",
            "AtlasRelic",
            "AnimalCharm",
        ]) {
            expect(canBeRare({ ...FLASK_BASE, itemClass: ClassId(cls) })).toBe(false);
        }
        expect(canBeRare(RING_BASE)).toBe(true);
    });

    it("declaring a Rare flask in the item block is flagged", () => {
        const r = check(craft(flask("rare"), []), ctx);
        expect(r.diagnostics.some((d) => d.message.includes("cannot be Rare"))).toBe(true);
    });
});

describe("checker — count refinement through disjunctions", () => {
    // Mirrors example.craft: a 2-mod Rare proven to hold ≥2 resistances (all
    // suffixes) must have 0 prefixes — so benching a life PREFIX is safe.
    const twoEleRes = orp(
        orp(
            andp(has("FireResist1", 1), has("ColdResist1", 1)),
            andp(has("FireResist1", 1), has("LightningResist1", 1)),
        ),
        andp(has("ColdResist1", 1), has("LightningResist1", 1)),
    );

    it("pushes a `≥2 of {suffixes}` disjunction into the suffix count (⇒ 0 prefixes)", () => {
        const c = craft(rareRing(["random"], ["random"]), [
            until(twoEleRes, [op("annul"), op("exalt")]),
        ]);
        const st = check(c, ctx).finalState!;
        expect(st.counts.total).toEqual([2, 2]);
        expect(st.counts.prefix).toEqual([0, 0]); // both affixes are the proven suffixes
        expect(suffixRange(st)).toEqual([2, 2]);
    });

    it("counts one suffix for groups that one modifier can meet", () => {
        // "Fire, or cold and lightning" holds with the fire resistance alone, so
        // the item may still be three prefixes and that one suffix.
        const fireOrBoth = orp(
            has("FireResist1"),
            andp(has("ColdResist1"), has("LightningResist1")),
        );
        const c = craft(rareRing(["random", "random", "random"], ["random", "random"]), [
            op("annul"),
            iff(fireOrBoth, [op("annul")]),
        ]);
        const r = check(c, ctx);
        expect(r.diagnostics).toEqual([]);
        const inside = r.trace.filter((e) => e.kind === "operation").at(-1)!;
        expect(inside.before.counts.prefix).toEqual([2, 3]);
    });

    it("allows benching a life prefix afterwards — the group is provably absent", () => {
        const c = craft(rareRing(["random"], ["random"]), [
            until(twoEleRes, [op("annul"), op("exalt")]),
            bench("maximum life"),
        ]);
        const r = check(c, ctx);
        expect(r.diagnostics).toEqual([]);
        expect(r.finalState!.counts.prefix).toEqual([1, 1]); // the benched life prefix
    });

    it("a branch's narrowed count keeps the proven suffix disjunction's floor", () => {
        // 4–6 mods with ≥2 resistance suffixes proven: inside `prefixCount == 3`
        // the total must be 5–6, not 4–6 (three prefixes and two suffixes at least).
        const c = craft(rareRing(["random"]), [
            op("chaos"),
            until(twoEleRes, [op("annul"), op("exalt")]),
            iff(cmp("prefixCount", "==", 3), [op("exalt")], []),
        ]);
        const r = check(c, ctx);
        const inside = r.trace.find(
            (e) =>
                e.kind === "operation" &&
                e.before.counts.prefix[0] === 3 &&
                e.before.counts.prefix[1] === 3,
        );
        expect(inside?.before.counts.total).toEqual([5, 6]);
    });

    it("keeps a disjunctive guarantee through an additive op (exalt)", () => {
        // `A or B` is proven on loop exit; an exalt only ADDS a mod, so it must
        // survive — a following `not A and not B` is then provably dead.
        const c = craft(rareRing(["random"], ["random"]), [
            until(orp(has("IncreasedLife1"), has("FireResist1")), [op("annul"), op("exalt")]),
            op("exalt"), // additive; must not forget "A or B"
            iff(andp(notp(has("IncreasedLife1")), notp(has("FireResist1"))), [op("annul")]),
        ]);
        expect(check(c, ctx).diagnostics.some((d) => d.message.includes("can never run"))).toBe(
            true,
        );
    });
});

describe("checker — the one-crafted-mod limit", () => {
    it("a second bench craft replaces the crafted mod, so one stays", () => {
        const c = craft(rareRing(), [bench("maximum life"), bench("maximum life")]);
        const r = check(c, ctx);
        expect(r.diagnostics).toEqual([]);
        expect(r.finalState!.crafted).toEqual([1, 1]);
        expect(r.finalState!.counts.total).toEqual([1, 1]);
    });

    it("tracks the crafted-mod count; a reforge clears it", () => {
        const benched = check(craft(rareRing(), [bench("maximum life")]), ctx).finalState!;
        expect(benched.crafted).toEqual([1, 1]);
        const reforged = check(
            craft(rareRing(), [bench("maximum life"), op("chaos")]),
            ctx,
        ).finalState!;
        expect(reforged.crafted).toEqual([0, 0]); // chaos discards the crafted mod
    });

    it("an annul may or may not remove the crafted mod; a re-bench adds or replaces", () => {
        const c = craft(rareRing(["IncreasedMana1"]), [
            bench("maximum life"),
            op("annul"),
            bench("maximum life"),
        ]);
        const r = check(c, ctx);
        expect(r.diagnostics).toEqual([]);
        expect(r.finalState!.crafted).toEqual([1, 1]);
    });
});

describe("checker — the item block rejects modifiers that cannot share an item", () => {
    it("the same modifier declared twice", () => {
        const r = check(craft(rareRing(["IncreasedLife1", "IncreasedLife2"]), []), ctx);
        expect(r.diagnostics[0]?.message).toContain("tiers of one modifier");
    });

    it("two modifiers of one group", () => {
        const r = check(craft(rareRing([], ["FireResist1", "FireChaosResist1"]), []), ctx);
        expect(r.diagnostics[0]?.message).toContain("same group");
    });

    it("a row of another domain, named by id", () => {
        const r = check(craft(rareRing(["FlaskRecovery1"]), []), ctx);
        expect(r.diagnostics[0]?.message).toContain("cannot roll on");
    });
});

describe("checker — exclusions through a strip and a forced row", () => {
    it("a reforge keeps an exclusion on a type its pool cannot add and lifts one it can", () => {
        // Inside the branch neither type is present; the chaos may add fire
        // resistance again but never the amulet-only modifier on a ring.
        const c = craft(rareRing(["random"]), [
            iff(andp(notp(has(AMULET_ONLY.id)), notp(has("FireResist1"))), [op("chaos")]),
        ]);
        const r = check(c, ctx);
        const after = r.trace.find((e) => e.kind === "operation")!.after!;
        expect(excludedTypes(after).has(AMULET_ONLY.type)).toBe(true);
        expect(excludedTypes(after).has(FIRE_RESIST.type)).toBe(false);
    });

    it("an essence forces its row onto an item that had excluded it", () => {
        // The grant's type is excluded inside the branch; the essence lifts the
        // exclusion before guaranteeing the row, so the state stays consistent.
        const c = craft(rareRing(["random"]), [
            iff(notp(has("IncreasedLife1")), [essence("Deafening Essence of Greed")]),
        ]);
        const r = check(c, ctx);
        expect(r.diagnostics).toEqual([]);
        const after = r.trace.find((e) => e.kind === "operation")!.after!;
        expect(after.presence).not.toBe(after.bdd.FALSE);
        expect(guaranteedTypes(after).has(LIFE_T1.type)).toBe(true);
    });
});

describe("checker — a transmute lays down one or two modifiers", () => {
    it("leaves one or two affixes, so an augment straight after has no proven slot", () => {
        const c = craft(item({ base: "Iron Ring", ilvl: 100, rarity: "normal" }), [
            op("transmute"),
            op("augment"),
        ]);
        const r = check(c, ctx);
        expect(r.trace.find((e) => e.kind === "operation")!.after!.counts.total).toEqual([1, 2]);
        expect(r.diagnostics[0]?.message).toContain("open affix slot");
    });
});
