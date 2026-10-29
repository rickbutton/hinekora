import { describe, expect, it } from "vitest";
import { check, type CheckContext } from "./check.js";
import { fracturedTypes, guaranteedTypes, hasFracture } from "./astate.js";
import { buildRegistry } from "../resolve/registry.js";
import { craft, essence, fracturedP, iff, item, notp, op } from "../__fixtures__/ast.js";
import { CATALOG, CLASS_RING, INCREASED_MANA, RING_BASE } from "../__fixtures__/mods.js";
import type { EssenceSpec } from "../model/sources.js";

// A Deafening-tier essence granting a mana prefix on a Ring, so it reforges a Rare.
const ESS_MANA: EssenceSpec = {
    id: "TestMana",
    name: "Deafening Essence of Mana",
    tier: 7,
    grants: new Map([[CLASS_RING, INCREASED_MANA.id]]),
};

const registry = buildRegistry({
    bases: [RING_BASE],
    mods: CATALOG,
    essences: [ESS_MANA],
    modAliases: {
        "T1 Life": "IncreasedLife1",
        life: "IncreasedLife1",
        mana: "IncreasedMana1",
        armour: "IncreasedArmour1",
        cold: "ColdResist1",
    },
    baseAliases: { "Iron Ring": "IronRing" },
});
const ctx: CheckContext = { registry };

/** A rare Iron Ring with four named (guaranteed) mods, for the Fracturing Orb. */
const fourModRing = () =>
    item({
        base: "Iron Ring",
        ilvl: 100,
        rarity: "rare",
        prefixes: ["life", "mana", "armour"],
        suffixes: ["cold"],
    });

/** A rare Iron Ring with a fractured life prefix plus `fillers` anonymous suffixes. */
const fracturedRing = (fillers: number) =>
    item({
        base: "Iron Ring",
        ilvl: 100,
        rarity: "rare",
        prefixes: [{ mod: "T1 Life", fractured: true }],
        suffixes: Array.from({ length: fillers }, () => "random"),
    });

const guaranteed = (r: ReturnType<typeof check>): Set<string> =>
    new Set([...guaranteedTypes(r.finalState!)]);

describe("a fractured anonymous affix", () => {
    const anonymousLock = () =>
        item({
            base: "Iron Ring",
            ilvl: 100,
            rarity: "rare",
            prefixes: [{ mod: "random", fractured: true }],
            suffixes: ["random", "random", "random"],
        });

    it("still marks the item fractured, so a Fracturing Orb is refused", () => {
        const r = check(craft(anonymousLock(), [op("fracture")]), ctx);
        expect(hasFracture(r.trace[0]!.after!)).toBe(true);
        expect(r.diagnostics[0]?.message).toContain("fractured");
    });

    it("keeps the lock through a chaos reforge", () => {
        const r = check(craft(anonymousLock(), [op("chaos")]), ctx);
        expect(r.diagnostics).toEqual([]);
        expect(hasFracture(r.finalState!)).toBe(true);
        expect(fracturedTypes(r.finalState!).size).toBe(0);
    });
});

describe("declared fractured mod is locked", () => {
    it("survives a chaos reforge, which still lays down its full 4–6 mods", () => {
        const r = check(craft(fracturedRing(2), [op("chaos")]), ctx);
        expect(r.diagnostics).toEqual([]);
        expect(r.finalState!.rarities).toEqual(new Set(["rare"]));
        expect(guaranteed(r)).toContain("IncreasedLife");
        // The fractured mod is one of the reforged 4–6, not a lone survivor.
        expect(r.finalState!.counts.total).toEqual([4, 6]);
    });

    it("survives an alteration after a scour, so a second Fracturing Orb is refused", () => {
        // Scour leaves a 1-mod Magic item with the fractured life; alteration
        // rerolls the rest but never the lock, so the item stays fractured and the
        // orb, which refuses fractured items, is rejected after regal and exalts.
        const r = check(
            craft(fracturedRing(2), [
                op("scour"),
                op("alteration"),
                op("regal"),
                op("exalt"),
                op("exalt"),
                op("fracture"),
            ]),
            ctx,
        );
        expect(r.diagnostics.map((d) => d.message).join("\n")).toContain("fractured");
        const afterAlteration = r.trace.find(
            (t) => t.kind === "op" && t.after?.rarities.has("magic"),
        );
        expect(afterAlteration?.after && hasFracture(afterAlteration.after)).toBe(true);
    });

    it("survives an essence reforge, which still forces its own mod", () => {
        const r = check(craft(fracturedRing(2), [essence("mana", 1)]), ctx);
        expect(r.diagnostics).toEqual([]);
        expect(hasFracture(r.finalState!)).toBe(true);
        expect(guaranteed(r)).toContain("IncreasedLife");
        expect(guaranteed(r)).toContain("IncreasedMana");
        expect(fracturedTypes(r.finalState!)).toEqual(new Set(["IncreasedLife"]));
    });

    it("a scour clears the crafted count when the fractured mod is a natural one", () => {
        const r = check(craft(fracturedRing(2), [op("scour")]), ctx);
        expect(r.diagnostics).toEqual([]);
        expect(r.finalState!.crafted).toEqual([0, 0]);
    });

    it("survives an annul (a filler suffix is removed instead)", () => {
        const r = check(craft(fracturedRing(2), [op("annul")]), ctx);
        expect(r.diagnostics).toEqual([]);
        expect(guaranteed(r)).toContain("IncreasedLife");
    });

    it("scours to a 1-mod Magic item, keeping the fracture", () => {
        const r = check(craft(fracturedRing(2), [op("scour")]), ctx);
        expect(r.diagnostics).toEqual([]);
        expect(r.finalState!.rarities).toEqual(new Set(["magic"]));
        expect(r.finalState!.counts.total).toEqual([1, 1]);
        expect(guaranteed(r)).toContain("IncreasedLife");
    });

    it("makes annul fail when the fractured mod is the only one", () => {
        const r = check(craft(fracturedRing(0), [op("annul")]), ctx);
        expect(r.diagnostics).toHaveLength(1);
        expect(r.diagnostics[0]!.message).toContain("removable");
    });
});

describe("the fractured predicate", () => {
    it("proves the declared fractured mod (then-branch is live)", () => {
        const c = craft(fracturedRing(2), [iff(fracturedP("maximum life"), [op("chaos")])]);
        const r = check(c, ctx);
        expect(r.diagnostics).toEqual([]);
    });

    it("a mod that is the fracture can never test not-fractured (dead branch)", () => {
        // "not fractured maximum life" is impossible on this item — life IS the
        // fracture — so the branch is unreachable.
        const c = craft(fracturedRing(2), [iff(notp(fracturedP("maximum life")), [op("chaos")])]);
        const r = check(c, ctx);
        expect(r.diagnostics).toHaveLength(1);
        expect(r.diagnostics[0]!.message).toMatch(/never run|impossible/);
    });
});

describe("the Fracturing Orb", () => {
    it("needs at least four modifiers", () => {
        const three = item({
            base: "Iron Ring",
            ilvl: 100,
            rarity: "rare",
            prefixes: ["life", "mana", "armour"],
        });
        const r = check(craft(three, [op("fracture")]), ctx);
        expect(r.diagnostics).toHaveLength(1);
        expect(r.diagnostics[0]!.message).toContain("at least 4");
    });

    it("fractures at four modifiers, pinning no specific mod yet", () => {
        const r = check(craft(fourModRing(), [op("fracture")]), ctx);
        expect(r.diagnostics).toEqual([]);
        expect(hasFracture(r.finalState!)).toBe(true);
        expect(fracturedTypes(r.finalState!).size).toBe(0); // random until a branch proves it
    });

    it("keeps the item Magic-or-better through a later reforge (the fracture is permanent)", () => {
        const c = craft(fourModRing(), [op("fracture"), op("chaos"), op("scour")]);
        const r = check(c, ctx);
        expect(r.diagnostics).toEqual([]);
        // Even with no proof of which mod, one survives, so scour can't reach Normal.
        expect(r.finalState!.rarities).toEqual(new Set(["magic"]));
        expect(hasFracture(r.finalState!)).toBe(true);
    });

    it("cannot fracture an already-fractured item", () => {
        const declared = item({
            base: "Iron Ring",
            ilvl: 100,
            rarity: "rare",
            prefixes: [{ mod: "life", fractured: true }, "mana", "armour"],
            suffixes: ["cold"],
        });
        const r = check(craft(declared, [op("fracture")]), ctx);
        expect(r.diagnostics).toHaveLength(1);
        expect(r.diagnostics[0]!.message).toContain("already");
    });

    it("proving two different mods fractured is a dead branch (exactly one)", () => {
        const c = craft(fourModRing(), [
            op("fracture"),
            iff(fracturedP("life"), [iff(fracturedP("mana"), [op("chaos")])]),
        ]);
        const r = check(c, ctx);
        expect(r.diagnostics.some((d) => /never run|impossible/.test(d.message))).toBe(true);
    });
});
