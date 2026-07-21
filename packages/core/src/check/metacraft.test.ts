import { describe, expect, it } from "vitest";
import { check, type CheckContext } from "./check.js";
import { disjunctiveGuarantees, guaranteedTypes } from "./astate.js";
import { buildRegistry } from "../resolve/registry.js";
import { bench, craft, essence, harvest, item, op } from "../__fixtures__/ast.js";
import {
    ATTACK_PREFIX,
    CANNOT_ROLL_ATTACK_CARRIER,
    CATALOG,
    CLASS_RING,
    LIFE_T1,
    MULTIMOD_CARRIER,
    PROTECT_PREFIXES_CARRIER,
    PROTECT_SUFFIXES_CARRIER,
    RING_BASE,
} from "../__fixtures__/mods.js";
import type { BenchCraft, EssenceSpec } from "../model/sources.js";
import { type ModId, TypeId } from "../model/ids.js";

const benchOf = (mod: ModId): BenchCraft => ({
    mod,
    tier: 1,
    itemClasses: new Set([CLASS_RING]),
});

// A Deafening-tier essence (ladder 7) that reforges a Rare, granting T1 life on a Ring.
const ESS_DEAFENING: EssenceSpec = {
    id: "TestGreedDeafening",
    name: "Deafening Essence of Greed",
    tier: 7,
    grants: new Map([[CLASS_RING, LIFE_T1.id]]),
};

const registry = buildRegistry({
    bases: [RING_BASE],
    mods: [
        ...CATALOG,
        ATTACK_PREFIX,
        PROTECT_PREFIXES_CARRIER,
        PROTECT_SUFFIXES_CARRIER,
        CANNOT_ROLL_ATTACK_CARRIER,
        MULTIMOD_CARRIER,
    ],
    modAliases: { "T1 Life": "IncreasedLife1" },
    baseAliases: { "Iron Ring": "IronRing" },
    essences: [ESS_DEAFENING],
    benchCrafts: [
        benchOf(PROTECT_PREFIXES_CARRIER.id),
        benchOf(PROTECT_SUFFIXES_CARRIER.id),
        benchOf(CANNOT_ROLL_ATTACK_CARRIER.id),
        benchOf(MULTIMOD_CARRIER.id),
    ],
});
const ctx: CheckContext = { registry };

const rareRing = (prefixes: string[] = [], suffixes: string[] = []) =>
    item({ base: "Iron Ring", ilvl: 100, rarity: "rare", prefixes, suffixes });

const guaranteed = (r: ReturnType<typeof check>): Set<string> =>
    new Set([...guaranteedTypes(r.finalState!)]);

describe("metamod effects are carried on the catalog", () => {
    it("attaches the fixture carriers' effects to their types", () => {
        expect(registry.effectsOfType(TypeId("MetaPrefixesCannotChange"))).toEqual([
            { kind: "protect", target: { by: "gen", gen: "prefix" } },
        ]);
        expect(registry.effectsOfType(TypeId("MetaMultimod"))).toEqual([
            { kind: "craftedCap", cap: 3 },
        ]);
        expect(registry.effectsOfType(TypeId("IncreasedLife"))).toEqual([]);
    });
});

describe("protection (prefixes cannot be changed)", () => {
    it("spares the protected side from annul", () => {
        const c = craft("poe1", rareRing(["T1 Life"]), [
            bench("prefixes cannot be changed"),
            op("annul"),
        ]);
        const r = check(c, ctx);
        expect(r.diagnostics).toEqual([]);
        // The life prefix is protected, so annul removes the suffix carrier instead
        // and the life guarantee survives.
        expect(guaranteed(r)).toContain("IncreasedLife");
    });

    it("without the metamod, an unforced annul drops the guarantee", () => {
        const c = craft("poe1", rareRing(["T1 Life"]), [op("annul")]);
        const r = check(c, ctx);
        expect(guaranteed(r)).not.toContain("IncreasedLife");
    });

    it("spares the protected side from a harvest augment's random remove", () => {
        const c = craft("poe1", rareRing(["T1 Life"]), [
            bench("prefixes cannot be changed"),
            harvest("augment", "fire"),
        ]);
        const r = check(c, ctx);
        expect(r.diagnostics).toEqual([]);
        expect(guaranteed(r)).toContain("IncreasedLife");
    });
});

describe("scour respects protection", () => {
    it("keeps the protected side, dropping to the min rarity for what survives", () => {
        const c = craft("poe1", rareRing(["T1 Life"]), [
            bench("prefixes cannot be changed"),
            op("scour"),
        ]);
        const r = check(c, ctx);
        expect(r.diagnostics).toEqual([]);
        // One prefix survives (suffixes + the metamod are gone) → a 1-mod Magic.
        expect(r.finalState!.rarity).toBe("magic");
        expect(guaranteed(r)).toContain("IncreasedLife");
        expect(r.finalState!.counts.prefix).toEqual([1, 1]);
        expect(r.finalState!.crafted).toEqual([0, 0]);
    });

    it("without a metamod, scour strips to Normal", () => {
        const c = craft("poe1", rareRing(["T1 Life"]), [op("scour")]);
        const r = check(c, ctx);
        expect(r.finalState!.rarity).toBe("normal");
        expect(r.finalState!.counts.total).toEqual([0, 0]);
    });
});

describe("essence is blocked by a metamod", () => {
    it("fails while a protection metamod is present", () => {
        const c = craft("poe1", rareRing(["T1 Life"]), [
            bench("prefixes cannot be changed"),
            essence("greed", 1),
        ]);
        const r = check(c, ctx);
        expect(r.diagnostics).toHaveLength(1);
        expect(r.diagnostics[0]!.message).toContain("metacraft modifier");
    });

    it("is allowed under multimod alone (it does not affect mod outcomes)", () => {
        const c = craft("poe1", rareRing(["T1 Life"]), [
            bench("can have up to 3 crafted modifiers"),
            essence("greed", 1),
        ]);
        const r = check(c, ctx);
        expect(r.diagnostics).toEqual([]);
    });
});

describe("multimod raises the crafted-mod limit", () => {
    it("blocks a second bench craft at the default limit of one", () => {
        const c = craft("poe1", rareRing(), [
            bench("prefixes cannot be changed"),
            bench("suffixes cannot be changed"),
        ]);
        const r = check(c, ctx);
        expect(r.diagnostics).toHaveLength(1);
        expect(r.diagnostics[0]!.message).toContain("crafted modifier");
    });

    it("allows three crafted mods once multimod is placed", () => {
        const c = craft("poe1", rareRing(), [
            bench("can have up to 3 crafted modifiers"),
            bench("prefixes cannot be changed"),
            bench("suffixes cannot be changed"),
        ]);
        const r = check(c, ctx);
        expect(r.diagnostics).toEqual([]);
        expect(r.finalState!.crafted).toEqual([3, 3]);
    });
});

describe("reforge respects protection (Stage B)", () => {
    it("chaos keeps the protected side's guarantees", () => {
        const c = craft("poe1", rareRing(["T1 Life"]), [
            bench("prefixes cannot be changed"),
            op("chaos"),
        ]);
        const r = check(c, ctx);
        expect(r.diagnostics).toEqual([]);
        expect(r.finalState!.rarity).toBe("rare");
        expect(guaranteed(r)).toContain("IncreasedLife"); // the protected prefix survives
        expect(r.finalState!.crafted).toEqual([0, 0]); // the metamod was rerolled away
    });

    it("without a metamod, chaos drops all guarantees", () => {
        const c = craft("poe1", rareRing(["T1 Life"]), [op("chaos")]);
        const r = check(c, ctx);
        expect(guaranteed(r)).not.toContain("IncreasedLife");
    });

    it("harvest reforge keeps the protected side and still guarantees the tag", () => {
        const c = craft("poe1", rareRing(["T1 Life"]), [
            bench("prefixes cannot be changed"),
            harvest("reforge", "fire"),
        ]);
        const r = check(c, ctx);
        expect(r.diagnostics).toEqual([]);
        expect(guaranteed(r)).toContain("IncreasedLife");
        const clauses = disjunctiveGuarantees(r.finalState!).map((cl) => new Set(cl));
        expect(clauses).toContainEqual(new Set([TypeId("FireResist"), TypeId("FireChaosResist")]));
    });
});

describe("cannot roll attack modifiers", () => {
    it("excludes attack-tagged types from a later exalt's pool", () => {
        const c = craft("poe1", rareRing(), [bench("cannot roll attack modifiers"), op("exalt")]);
        const r = check(c, ctx);
        expect(r.diagnostics).toEqual([]);
        expect(r.finalState!.possible.has(TypeId("AddedAttackDamage"))).toBe(false);
        // A non-attack mod is still addable.
        expect(r.finalState!.possible.has(TypeId("IncreasedLife"))).toBe(true);
    });
});
