import { describe, expect, it } from "vitest";
import { check, type CheckContext } from "./check.js";
import { disjunctiveGuarantees, guaranteedTypes, isExcluded } from "./astate.js";
import { buildRegistry } from "../resolve/registry.js";
import { craft, harvest, item, op } from "../__fixtures__/ast.js";
import {
    AMULET_BASE,
    ATTACK_PREFIX,
    ATTACK_SPEED,
    BOOTS_BASE,
    CATALOG,
    INCREASED_ARMOUR,
    INCREASED_MANA,
    PROTECT_PREFIXES_CARRIER,
    PROTECT_SUFFIXES_CARRIER,
    FLASK_BASE,
    RATCHETING_BASE,
    RING_BASE,
    SIMPLEX_BASE,
    SPECIFIC_WEAPON_A,
    SPECIFIC_WEAPON_B,
} from "../__fixtures__/mods.js";
import { GroupId, ModId, TagId, TypeId } from "../model/ids.js";
import type { Mod } from "../model/mod.js";

const registry = buildRegistry({
    bases: [RING_BASE, AMULET_BASE, SIMPLEX_BASE, RATCHETING_BASE, FLASK_BASE],
    mods: [
        ...CATALOG,
        PROTECT_PREFIXES_CARRIER,
        PROTECT_SUFFIXES_CARRIER,
        ATTACK_PREFIX,
        ATTACK_SPEED,
    ],
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
        // Either unnamed prefix may be alpha, which adds the tag beta is zero on;
        // beta is the only attack-tagged row, so on that path the augment has
        // nothing to add.
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
        const c = craft(rareRing([PROTECT_SUFFIXES_CARRIER.id], ["random"]), [
            harvest("reforge", "elemental"),
        ]);
        expect(check(c, ctx).diagnostics).toEqual([]);
    });

    it("takes the one other modifier, whichever of the tag's modifiers it added", () => {
        // Fire resistance or the fire and chaos one goes on; the removal takes
        // "another" modifier, and the mana is the only other.
        const r = check(craft(rareRing([INCREASED_MANA.id]), [harvest("augment", "fire")]), ctx);
        expect(r.diagnostics).toEqual([]);
        expect(isExcluded(r.finalState!, INCREASED_MANA.type)).toBe(true);
        expect(r.finalState!.counts.total).toEqual([1, 1]);
        // With two others, either may be the one taken.
        const two = check(
            craft(rareRing(["T1 Life", INCREASED_MANA.id]), [harvest("augment", "fire")]),
            ctx,
        );
        expect(isExcluded(two.finalState!, INCREASED_MANA.type)).toBe(false);
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

    it("rejects a tag whose only modifier is already among the protected prefixes", () => {
        // Seen in game: boots roll one speed modifier, movement speed; with it
        // a protected prefix the speed reforge has "no valid mods", though a
        // prefix slot is open.
        const speed: Mod = {
            ...INCREASED_MANA,
            id: ModId("MovementVelocity1"),
            type: TypeId("MovementVelocity"),
            families: new Set([GroupId("MovementVelocity")]),
            spawn: [
                { tag: TagId("boots"), weight: 1000 },
                { tag: TagId("default"), weight: 0 },
            ],
            implicitTags: new Set([TagId("speed")]),
            text: "#% increased Movement Speed",
        };
        const boots = buildRegistry({
            bases: [BOOTS_BASE],
            mods: [...CATALOG, PROTECT_PREFIXES_CARRIER, speed],
        });
        const r = check(
            craft(
                item({
                    base: "Iron Greaves",
                    ilvl: 100,
                    rarity: "rare",
                    prefixes: [speed.id],
                    suffixes: [PROTECT_PREFIXES_CARRIER.id],
                }),
                [harvest("reforge", "speed")],
            ),
            { registry: boots },
        );
        expect(r.diagnostics).toHaveLength(1);
        expect(r.diagnostics[0]!.message).toContain("Every speed modifier may be blocked");
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
        // The augment adds before it removes, so a full item has no slot for it.
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

    it("an augment needs its slot before the removal: a full side refuses a tag of that side", () => {
        // The shape of the refusal reported in game: every fire modifier is a
        // suffix and the suffixes are full, so the grove has "no valid mods"
        // though a prefix is open and the removal would free a suffix.
        const fullSuffixes = craft(
            rareRing(["T1 Life"], ["ColdResist1", "LightningResist1", ATTACK_SPEED.id]),
            [harvest("augment", "fire")],
        );
        expect(check(fullSuffixes, ctx).diagnostics[0]!.message).toContain(
            "fire modifier has no slot on some path",
        );
        // A tag with rows on both sides still has none on a full item.
        const full = craft(
            rareRing(
                ["T1 Life", INCREASED_MANA.id, INCREASED_ARMOUR.id],
                ["FireResist1", "ColdResist1", "LightningResist1"],
            ),
            [harvest("augment", "attack")],
        );
        expect(check(full, ctx).diagnostics[0]!.message).toContain(
            "attack modifier has no slot on some path",
        );
        // With a suffix open the fire modifier lands, and one of the others goes.
        const open = craft(rareRing(["T1 Life"], ["ColdResist1", "LightningResist1"]), [
            harvest("augment", "fire"),
        ]);
        const r = check(open, ctx);
        expect(r.diagnostics).toEqual([]);
        expect(r.finalState!.counts.total).toEqual([3, 3]);
    });

    it("rejects a tag no mod can roll here (the grayed-out case)", () => {
        const c = craft(rareRing(), [harvest("reforge", "minion")]);
        const r = check(c, ctx);
        expect(r.diagnostics).toHaveLength(1);
        expect(r.diagnostics[0]!.message).toContain("minion");
    });

    it('takes the drop tag: "including a Drop modifier"', () => {
        const rarity: Mod = {
            ...INCREASED_MANA,
            id: ModId("ItemRarity1"),
            type: TypeId("ItemRarity"),
            families: new Set([GroupId("ItemRarity")]),
            implicitTags: new Set([TagId("drop")]),
        };
        const drops = buildRegistry({
            bases: [RING_BASE],
            mods: [...CATALOG, rarity],
            baseAliases: { "Iron Ring": "IronRing" },
        });
        const r = check(craft(rareRing(), [harvest("reforge", "drop")]), { registry: drops });
        expect(r.diagnostics).toEqual([]);
        expect(guaranteed(r)).toContain("ItemRarity");
        // The grove has no augment for it.
        const augment = check(craft(rareRing(["T1 Life"]), [harvest("augment", "drop")]), ctx);
        expect(augment.diagnostics[0]!.message).toContain("The grove has no craft that adds");
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
        const c = craft(rareRing(["T1 Life"]), [harvest("augment", "caster")]);
        const r = check(c, ctx);
        expect(r.diagnostics).toHaveLength(1);
        expect(r.diagnostics[0]!.message).toContain("No caster modifier can appear");
    });

    it("keeps the added modifier through the removal, and closes its group by what the item held", () => {
        // Life is the one life modifier: the removal cannot take what was
        // just added, so it is on the item afterwards.
        const added = check(
            craft(rareRing([INCREASED_MANA.id], ["FireResist1"]), [harvest("augment", "life")]),
            ctx,
        );
        expect(added.diagnostics).toEqual([]);
        expect(guaranteed(added)).toContain("IncreasedLife");
        expect(added.finalState!.counts.total).toEqual([2, 2]);
        // The fire resistance is still on the item when the fire modifier is
        // added, and every fire modifier shares its group.
        const closed = check(
            craft(rareRing(["T1 Life"], ["FireResist1"]), [harvest("augment", "fire")]),
            ctx,
        );
        expect(closed.diagnostics[0]!.message).toContain("Every fire modifier may be blocked");
    });

    it("has the grove's eleven augments only", () => {
        for (const tag of ["mana", "attribute", "elemental", "minion", "drop"]) {
            const r = check(craft(rareRing(["T1 Life"]), [harvest("augment", tag)]), ctx);
            expect(r.diagnostics.map((d) => d.message).join()).toContain(
                `The grove has no craft that adds a "${tag}" modifier`,
            );
        }
        for (const tag of ["fire", "defence", "defences"]) {
            const r = check(craft(rareRing(["T1 Life"]), [harvest("augment", tag)]), ctx);
            expect(r.diagnostics).toEqual([]);
        }
    });
});

describe("the grove's more and less likely reforges", () => {
    it("are not part of the language", () => {
        for (const name of ["more likely", "less likely"]) {
            const r = check(craft(rareRing(), [harvest("reforge", name)]), ctx);
            expect(r.diagnostics[0]!.message).toContain("is not a harvest modifier type");
        }
    });
});
