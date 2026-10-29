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
        expect(check(kept, ctx).diagnostics[0]!.message).toContain("No defences modifier");
        // Nothing kept: the reforge clears the armour, so the pool is whole.
        const cleared = craft(rareRing(), [op("chaos"), harvest("reforge", "defence")]);
        expect(check(cleared, ctx).diagnostics).toEqual([]);
    });

    it("rejects a side-only tag when that side may be full after the strip", () => {
        // Three anonymous prefixes kept by the metamod: no life modifier, a
        // prefix, can land, however the anonymous ones resolve.
        const locked = craft(
            rareRing(["random", "random", "random"], [PROTECT_PREFIXES_CARRIER.id]),
            [harvest("reforge", "life")],
        );
        expect(check(locked, ctx).diagnostics[0]!.message).toContain(
            "life modifier has no slot on some path",
        );
        // The augment: the removal may take a suffix and leave the prefixes full.
        const full = craft(
            rareRing(
                ["T1 Life", "random", "random"],
                ["FireResist1", "ColdResist1", "LightningResist1"],
            ),
            [harvest("augment", "defence")],
        );
        expect(check(full, ctx).diagnostics[0]!.message).toContain(
            "defences modifier has no slot on some path",
        );
        // A tag with rows on both sides fits whichever side the removal opened.
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
        expect(check(c, ctx).diagnostics[0]!.message).toContain("No defences modifier");
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
