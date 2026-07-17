import { describe, expect, it } from "vitest";
import { check, type CheckContext } from "./check.js";
import { buildRegistry } from "../resolve/registry.js";
import {
    andp,
    craft,
    cmp,
    has,
    iff,
    isRarity,
    item,
    notp,
    op,
    orp,
    until,
    withOmen,
} from "../__fixtures__/ast.js";
import { AMULET_BASE, CATALOG, FIRE_RESIST, LIFE_T1, RING_BASE } from "../__fixtures__/mods.js";

const registry = buildRegistry({
    bases: [RING_BASE, AMULET_BASE],
    mods: CATALOG,
    modAliases: { "T1 Life": "IncreasedLife1" },
    baseAliases: { "Iron Ring": "IronRing" },
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
        expect(r.finalState?.guaranteed.size).toBe(0);
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
        expect(r.finalState?.guaranteed.has(LIFE_T1.type)).toBe(true);
    });

    it("an unforced annul risks every mod; nothing stays guaranteed", () => {
        const c = craft("poe1", rareRing(["IncreasedLife1"], ["FireResist1"]), [op("annul")]);
        const r = check(c, ctx);
        expect(r.finalState?.guaranteed.size).toBe(0);
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
        expect(r.finalState?.excluded.has(FIRE_RESIST.type)).toBe(true);
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

    it("`not (X or Y)` drains both: the loop proves both absent on exit", () => {
        // De Morgan: exiting when `not (has life or has fire)` proves neither is
        // present. The draining annul keeps the loop sound.
        const c = craft("poe1", rareRing(["IncreasedLife1"], ["FireResist1"]), [
            until(notp(orp(has("IncreasedLife1"), has("FireResist1"))), [op("annul")]),
        ]);
        const r = check(c, ctx);
        expect(r.diagnostics).toEqual([]);
        expect(r.finalState?.excluded.has(LIFE_T1.type)).toBe(true);
        expect(r.finalState?.excluded.has(FIRE_RESIST.type)).toBe(true);
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
        expect(r.finalState?.guaranteed.has(FIRE_RESIST.type)).toBe(true);
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
        expect(r.finalState?.guaranteed.has(LIFE_T1.type)).toBe(true);
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
