import { describe, expect, it } from "vitest";
import { check, type CheckContext } from "./check.js";
import { disjunctiveGuarantees, guaranteedTypes } from "./astate.js";
import { buildRegistry } from "../resolve/registry.js";
import { craft, harvest, item } from "../__fixtures__/ast.js";
import {
    AMULET_BASE,
    CATALOG,
    FLASK_BASE,
    RATCHETING_BASE,
    RING_BASE,
    SIMPLEX_BASE,
} from "../__fixtures__/mods.js";
import { TypeId } from "../model/ids.js";

const registry = buildRegistry({
    bases: [RING_BASE, AMULET_BASE, SIMPLEX_BASE, RATCHETING_BASE, FLASK_BASE],
    mods: CATALOG,
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
        const c = craft("poe1", rareRing(), [harvest("reforge", "life")]);
        const r = check(c, ctx);
        expect(r.diagnostics).toEqual([]);
        expect(guaranteed(r)).toContain("IncreasedLife");
        // A reforge lays a fresh 4–6 mod Rare.
        expect(r.finalState!.counts.total).toEqual([4, 6]);
    });

    it("guarantees a multi-type tag as a disjunction", () => {
        // "fire" spans two types (FireResist, FireChaosResist): neither is
        // guaranteed alone, but at least one is present.
        const c = craft("poe1", rareRing(), [harvest("reforge", "fire")]);
        const r = check(c, ctx);
        expect(r.diagnostics).toEqual([]);
        expect(guaranteed(r)).not.toContain("FireResist");
        const clauses = disjunctiveGuarantees(r.finalState!).map((c) => new Set(c));
        expect(clauses).toContainEqual(new Set([TypeId("FireResist"), TypeId("FireChaosResist")]));
    });

    it("rejects a tag no mod can roll here (the grayed-out case)", () => {
        const c = craft("poe1", rareRing(), [harvest("reforge", "minion")]);
        const r = check(c, ctx);
        expect(r.diagnostics).toHaveLength(1);
        expect(r.diagnostics[0]!.message).toContain("minion");
    });

    it("requires a Rare item", () => {
        const magic = item({ base: "Iron Ring", ilvl: 100, rarity: "magic" });
        const r = check(craft("poe1", magic, [harvest("reforge", "fire")]), ctx);
        expect(r.diagnostics).toHaveLength(1);
        expect(r.diagnostics[0]!.message).toContain("Requires a Rare item");
    });

    it("rejects an unknown tag", () => {
        const r = check(craft("poe1", rareRing(), [harvest("reforge", "blaze")]), ctx);
        expect(r.diagnostics).toHaveLength(1);
        expect(r.diagnostics[0]!.message).toContain("harvest modifier type");
    });
});

describe("harvest augment (add tagged, remove a random other)", () => {
    it("adds the tag and drops a prior guarantee, keeping the affix count", () => {
        // Start with a guaranteed life prefix; augmenting fire removes a random
        // other mod (here the life mod), so life is no longer guaranteed and the
        // total count is unchanged.
        const c = craft("poe1", rareRing(["T1 Life"]), [harvest("augment", "fire")]);
        const r = check(c, ctx);
        expect(r.diagnostics).toEqual([]);
        expect(guaranteed(r)).not.toContain("IncreasedLife");
        expect(r.finalState!.counts.total).toEqual([1, 1]);
        const clauses = disjunctiveGuarantees(r.finalState!).map((c) => new Set(c));
        expect(clauses).toContainEqual(new Set([TypeId("FireResist"), TypeId("FireChaosResist")]));
    });

    it("requires a mod to remove", () => {
        const r = check(craft("poe1", rareRing(), [harvest("augment", "fire")]), ctx);
        expect(r.diagnostics).toHaveLength(1);
        expect(r.diagnostics[0]!.message).toContain("removable affix");
    });

    it("rejects a tag no mod can roll here", () => {
        const c = craft("poe1", rareRing(["T1 Life"]), [harvest("augment", "minion")]);
        const r = check(c, ctx);
        expect(r.diagnostics).toHaveLength(1);
        expect(r.diagnostics[0]!.message).toContain("minion");
    });
});
