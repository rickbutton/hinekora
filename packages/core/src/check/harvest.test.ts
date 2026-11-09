import { describe, expect, it } from "vitest";
import { check, type CheckContext } from "./check.js";
import { disjunctiveGuarantees, guaranteedTypes } from "./astate.js";
import { buildRegistry } from "../resolve/registry.js";
import { craft, harvest, item, op } from "../__fixtures__/ast.js";
import {
    AMULET_BASE,
    ATTACK_PREFIX,
    ATTACK_SPEED,
    CATALOG,
    INCREASED_ARMOUR,
    INCREASED_MANA,
    PROTECT_PREFIXES_CARRIER,
    FLASK_BASE,
    RATCHETING_BASE,
    RING_BASE,
    SIMPLEX_BASE,
    SPECIFIC_WEAPON_A,
    SPECIFIC_WEAPON_B,
} from "../__fixtures__/mods.js";
import { TypeId } from "../model/ids.js";

const registry = buildRegistry({
    bases: [RING_BASE, AMULET_BASE, SIMPLEX_BASE, RATCHETING_BASE, FLASK_BASE],
    mods: [...CATALOG, PROTECT_PREFIXES_CARRIER, ATTACK_PREFIX, ATTACK_SPEED],
    modAliases: { "T1 Life": "IncreasedLife1" },
    baseAliases: { "Iron Ring": "IronRing" },
});
const ctx: CheckContext = { registry };

/** A rare Iron Ring with the given declared affixes. */
const rareRing = (prefixes: string[] = [], suffixes: string[] = []) =>
    item({ base: "Iron Ring", ilvl: 100, rarity: "rare", prefixes, suffixes });

const guaranteed = (r: ReturnType<typeof check>): Set<string> =>
    new Set([...guaranteedTypes(r.finalState!)]);

describe("harvest augment against the modifiers the item may carry", () => {
    it("is blocked when the one unnamed modifier may add a tag that zeroes every tagged row", () => {
        // The augment removes one modifier first, so of two unnamed prefixes one
        // remains, and it may be alpha, which adds the tag beta is zero on; beta is
        // the only attack-tagged row, so on that path the augment has nothing.
        const tagged = buildRegistry({
            bases: [RING_BASE],
            mods: [...CATALOG, SPECIFIC_WEAPON_A, SPECIFIC_WEAPON_B],
            modAliases: { "T1 Life": "IncreasedLife1" },
            baseAliases: { "Iron Ring": "IronRing" },
        });
        const blocked = check(
            craft(rareRing(["random", "random"]), [harvest("augment", "attack")]),
            { registry: tagged },
        );
        expect(blocked.diagnostics.length).toBe(1);
        expect(blocked.diagnostics[0]!.message).toContain("block");
        // With both prefixes named, nothing left on the item can add the tag.
        const named = check(
            craft(rareRing(["T1 Life", INCREASED_MANA.id]), [harvest("augment", "attack")]),
            { registry: tagged },
        );
        expect(named.diagnostics).toEqual([]);
    });

    it("is not blocked by one unknown suffix when its candidates span more groups", () => {
        // The one unnamed suffix may be any resistance, but it is one modifier:
        // of fire, cold and lightning two stay open on every path.
        const c = craft(rareRing(["T1 Life"], ["random"]), [harvest("augment", "elemental")]);
        expect(check(c, ctx).diagnostics).toEqual([]);
    });

    it("is blocked when one unknown suffix can cover every candidate's group", () => {
        // Every fire-tagged suffix shares the fire resistance family, which the
        // unnamed suffix may be.
        const c = craft(rareRing(["T1 Life"], ["random"]), [harvest("augment", "fire")]);
        expect(
            check(c, ctx)
                .diagnostics.map((d) => d.message)
                .join("\n"),
        ).toContain("may be blocked");
    });
});

describe("harvest reforge", () => {
    it("guarantees a single-type tag as a plain guarantee", () => {
        // "life" resolves to exactly the IncreasedLife type here, so the
        // disjunction collapses to a guarantee.
        const c = craft(rareRing(), [harvest("reforge", "life")]);
        const r = check(c, ctx);
        expect(r.diagnostics).toEqual([]);
        expect(guaranteed(r)).toContain("IncreasedLife");
        // A reforge lays a fresh 4–6 mod Rare.
        expect(r.finalState!.counts.total).toEqual([4, 6]);
    });

    it("guarantees a multi-type tag as a disjunction", () => {
        // "fire" spans two types (FireResist, FireChaosResist): neither is
        // guaranteed alone, but at least one is present.
        const c = craft(rareRing(), [harvest("reforge", "fire")]);
        const r = check(c, ctx);
        expect(r.diagnostics).toEqual([]);
        expect(guaranteed(r)).not.toContain("FireResist");
        const clauses = disjunctiveGuarantees(r.finalState!).map((c) => new Set(c));
        expect(clauses).toContainEqual(new Set([TypeId("FireResist"), TypeId("FireChaosResist")]));
    });

    it("rejects a tag whose only modifier a possibly kept one may block", () => {
        // The exalt may have added the armour, the only defence modifier; a
        // reforge that keeps the prefixes then has no defence modifier to add on
        // that path, so the craft may be greyed out.
        const kept = craft(rareRing([], [PROTECT_PREFIXES_CARRIER.id]), [
            op("exalt"),
            harvest("reforge", "defence"),
        ]);
        expect(check(kept, ctx).diagnostics[0]!.message).toContain(
            "Every defences modifier may be blocked",
        );
        // Nothing kept: the reforge clears the armour, so the pool is whole.
        const cleared = craft(rareRing(), [op("chaos"), harvest("reforge", "defence")]);
        expect(check(cleared, ctx).diagnostics).toEqual([]);
    });

    it("rejects a side-only tag when that side may be full after the strip", () => {
        // Three prefixes of other groups kept by the metamod: no life modifier,
        // a prefix, can land.
        const locked = craft(
            rareRing(
                ["IncreasedMana1", "IncreasedArmour1", ATTACK_PREFIX.id],
                [PROTECT_PREFIXES_CARRIER.id],
            ),
            [harvest("reforge", "life")],
        );
        expect(check(locked, ctx).diagnostics[0]!.message).toContain(
            "life modifier has no slot on some path",
        );
        // Anonymous prefixes instead: one of them may already be the life.
        const anonymous = craft(
            rareRing(["random", "random", "random"], [PROTECT_PREFIXES_CARRIER.id]),
            [harvest("reforge", "life")],
        );
        expect(check(anonymous, ctx).diagnostics[0]!.message).toContain(
            "life modifier has no slot on some path",
        );
        // The augment: the removal may take a suffix and leave the prefixes full.
        const full = craft(
            rareRing(
                ["T1 Life", "IncreasedMana1", ATTACK_PREFIX.id],
                ["FireResist1", "ColdResist1", "LightningResist1"],
            ),
            [harvest("augment", "defence")],
        );
        expect(check(full, ctx).diagnostics[0]!.message).toContain(
            "defences modifier has no slot on some path",
        );
    });

    it("a tag with rows on both sides fits whichever side the removal opened", () => {
        const either = craft(
            rareRing(
                ["T1 Life", INCREASED_MANA.id, INCREASED_ARMOUR.id],
                ["FireResist1", "ColdResist1", "LightningResist1"],
            ),
            [harvest("augment", "attack")],
        );
        expect(check(either, ctx).diagnostics).toEqual([]);
    });

    it("rejects a tag no mod can roll here (the grayed-out case)", () => {
        const c = craft(rareRing(), [harvest("reforge", "minion")]);
        const r = check(c, ctx);
        expect(r.diagnostics).toHaveLength(1);
        expect(r.diagnostics[0]!.message).toContain("minion");
    });

    it("requires a Rare item", () => {
        const magic = item({ base: "Iron Ring", ilvl: 100, rarity: "magic" });
        const r = check(craft(magic, [harvest("reforge", "fire")]), ctx);
        expect(r.diagnostics).toHaveLength(1);
        expect(r.diagnostics[0]!.message).toContain("Requires a Rare item");
    });

    it("rejects an unknown tag", () => {
        const r = check(craft(rareRing(), [harvest("reforge", "blaze")]), ctx);
        expect(r.diagnostics).toHaveLength(1);
        expect(r.diagnostics[0]!.message).toContain("harvest modifier type");
    });
});

describe("harvest augment (add tagged, remove a random other)", () => {
    it("adds the tag and drops a prior guarantee, keeping the affix count", () => {
        // Start with a guaranteed life prefix; augmenting fire removes a random
        // other mod (here the life mod), so life is no longer guaranteed and the
        // total count is unchanged.
        const c = craft(rareRing(["T1 Life"]), [harvest("augment", "fire")]);
        const r = check(c, ctx);
        expect(r.diagnostics).toEqual([]);
        expect(guaranteed(r)).not.toContain("IncreasedLife");
        expect(r.finalState!.counts.total).toEqual([1, 1]);
        const clauses = disjunctiveGuarantees(r.finalState!).map((c) => new Set(c));
        expect(clauses).toContainEqual(new Set([TypeId("FireResist"), TypeId("FireChaosResist")]));
    });

    it("rejects a tag whose only modifier may already be on the item", () => {
        const c = craft(rareRing(), [op("chaos"), harvest("augment", "defence")]);
        expect(check(c, ctx).diagnostics[0]!.message).toContain(
            "Every defences modifier may be blocked",
        );
    });

    it("requires a mod to remove", () => {
        const r = check(craft(rareRing(), [harvest("augment", "fire")]), ctx);
        expect(r.diagnostics).toHaveLength(1);
        expect(r.diagnostics[0]!.message).toContain("removable affix");
    });

    it("rejects a tag no mod can roll here", () => {
        const c = craft(rareRing(["T1 Life"]), [harvest("augment", "minion")]);
        const r = check(c, ctx);
        expect(r.diagnostics).toHaveLength(1);
        expect(r.diagnostics[0]!.message).toContain("minion");
    });
});

describe("the grove's more and less likely reforges", () => {
    it("read as a plain reforge: a kept prefix stays, the rest is a fresh 4-6 mod Rare", () => {
        const kept = craft(rareRing(["T1 Life"], [PROTECT_PREFIXES_CARRIER.id]), [
            harvest("reforge", "more likely"),
        ]);
        const r = check(kept, ctx);
        expect(r.diagnostics).toEqual([]);
        expect(guaranteed(r)).toContain("IncreasedLife");
        const less = check(craft(rareRing(), [harvest("reforge", "less likely")]), ctx);
        expect(less.diagnostics).toEqual([]);
        expect(less.finalState!.counts.total).toEqual([4, 6]);
    });
});
