import { describe, expect, it } from "vitest";
import { checkPresent, type CheckContext } from "./check.js";
import { disjunctiveGuarantees, guaranteedTypes } from "./astate.js";
import { buildRegistry } from "../resolve/registry.js";
import {
    beast,
    bench,
    cmp,
    craft,
    essence,
    harvest,
    has,
    iff,
    item,
    notp,
    op,
    veiled,
} from "../__fixtures__/ast.js";
import {
    ATTACK_PREFIX,
    CANNOT_ROLL_ATTACK_CARRIER,
    CATALOG,
    CLASS_RING,
    LIFE_T1,
    MULTIMOD_CARRIER,
    PROTECT_PREFIXES_CARRIER,
    INCREASED_MANA,
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

const guaranteed = (r: ReturnType<typeof checkPresent>): Set<string> =>
    new Set([...guaranteedTypes(r.finalState!)]);

describe("metamod effects are carried on the catalog", () => {
    it("attaches the fixture carriers' effects to their types", () => {
        expect(registry.effectsOfType(TypeId("MetaPrefixesCannotChange"))).toEqual([
            { kind: "protect", gen: "prefix" },
        ]);
        expect(registry.effectsOfType(TypeId("MetaMultimod"))).toEqual([
            { kind: "craftedCap", cap: 3 },
        ]);
        expect(registry.effectsOfType(TypeId("IncreasedLife"))).toEqual([]);
    });
});

describe("a metamod named in a predicate", () => {
    it("resolves although no spawn table admits it, and is proven once benched", () => {
        const c = craft(rareRing(["T1 Life"]), [
            bench("prefixes cannot be changed"),
            iff(notp(has("prefixes cannot be changed")), [op("chaos")]),
        ]);
        const messages = checkPresent(c, ctx).diagnostics.map((d) => d.message);
        expect(messages).toEqual([
            expect.stringContaining('can never run: not has "prefixes cannot be changed"'),
        ]);
    });

    it("lets the Bestiary's random metamod collapse to the one that fits", () => {
        // With the suffixes full, only the prefix-side metamod can be added, so
        // the recipe's result is known without a branch.
        const full = rareRing(["T1 Life"], ["FireResist1", "ColdResist1", "LightningResist1"]);
        const c = craft(full, [
            beast({ kind: "metamod" }),
            iff(notp(has("suffixes cannot be changed")), [op("chaos")]),
        ]);
        const messages = checkPresent(c, ctx).diagnostics.map((d) => d.message);
        expect(messages).toEqual([expect.stringContaining("can never run")]);
    });
});

describe("protection (prefixes cannot be changed)", () => {
    it("spares the protected side from annul", () => {
        const c = craft(rareRing(["T1 Life"]), [bench("prefixes cannot be changed"), op("annul")]);
        const r = checkPresent(c, ctx);
        expect(r.diagnostics).toEqual([]);
        // The life prefix is protected, so annul removes the suffix carrier instead
        // and the life guarantee survives.
        expect(guaranteed(r)).toContain("IncreasedLife");
    });

    it("without the metamod, an unforced annul drops the guarantee", () => {
        const c = craft(rareRing(["T1 Life"]), [op("annul")]);
        const r = checkPresent(c, ctx);
        expect(guaranteed(r)).not.toContain("IncreasedLife");
    });

    it("spares the protected side from a harvest augment's random remove", () => {
        const c = craft(rareRing(["T1 Life"]), [
            bench("prefixes cannot be changed"),
            harvest("augment", "fire"),
        ]);
        const r = checkPresent(c, ctx);
        expect(r.diagnostics).toEqual([]);
        expect(guaranteed(r)).toContain("IncreasedLife");
    });
});

describe("a metamod that may or may not be on the item", () => {
    // The bench craft sits in a branch, so after it the item carries
    // "prefixes cannot be changed" on one path and not on the other.
    const maybeProtected = (then: Parameters<typeof craft>[1]) =>
        craft(rareRing(["T1 Life"], ["random"]), [
            iff(has("FireResist1"), [bench("prefixes cannot be changed")]),
            ...then,
        ]);

    it("a chaos keeps the prefixes on the path that has it and rerolls them on the other", () => {
        const r = checkPresent(maybeProtected([op("chaos")]), ctx);
        expect(r.diagnostics).toEqual([]);
        expect(guaranteed(r)).not.toContain("IncreasedLife");
        expect(r.finalState!.possible.has(TypeId("IncreasedLife"))).toBe(true);
        // The protected path may add nothing beside the kept prefix.
        expect(r.finalState!.counts.total).toEqual([1, 6]);
        const live = checkPresent(
            maybeProtected([op("chaos"), iff(has("T1 Life"), [op("annul")], [op("annul")])]),
            ctx,
        );
        expect(live.diagnostics).toEqual([]);
    });

    it("a fracture after the chaos is refused: the protected path may hold under four", () => {
        const r = checkPresent(maybeProtected([op("chaos"), op("fracture")]), ctx);
        expect(r.diagnostics[0]?.message).toContain("at least 4 modifiers");
    });

    it("an essence is refused, naming the metamod the item may have", () => {
        const r = checkPresent(maybeProtected([essence("greed", 1)]), ctx);
        expect(r.diagnostics).toHaveLength(1);
        expect(r.diagnostics[0]!.message).toContain("metacraft modifier");
        expect(r.diagnostics[0]!.message).toContain(
            'where the item has "prefixes cannot be changed", which it may have here',
        );
    });

    it("a scour leaves the prefix on the protected path, so the item is Normal or Magic", () => {
        const r = checkPresent(maybeProtected([op("scour")]), ctx);
        expect(r.diagnostics).toEqual([]);
        expect(r.finalState!.rarities).toEqual(new Set(["normal", "magic"]));
        expect(
            checkPresent(maybeProtected([op("scour"), op("transmute")]), ctx).diagnostics,
        ).toHaveLength(1);
    });

    it("an annul may take the life on the path without it", () => {
        const r = checkPresent(maybeProtected([op("annul")]), ctx);
        expect(r.diagnostics).toEqual([]);
        expect(guaranteed(r)).not.toContain("IncreasedLife");
    });

    it("once a branch settles it, each arm reads as the sure case does", () => {
        const settled = maybeProtected([
            iff(
                has("prefixes cannot be changed"),
                [op("chaos"), iff(notp(has("T1 Life")), [op("annul")])],
                [op("chaos"), op("fracture")],
            ),
        ]);
        const messages = checkPresent(settled, ctx).diagnostics.map((d) => d.message);
        expect(messages).toEqual([expect.stringContaining('can never run: not has "T1 Life"')]);
    });

    it("the Bestiary's random metamod is one of several, each read on its own path", () => {
        const start = () => rareRing(["T1 Life"], ["FireResist1"]);
        const reforged = checkPresent(
            craft(start(), [beast({ kind: "metamod" }), op("chaos")]),
            ctx,
        );
        expect(reforged.diagnostics).toEqual([]);
        expect(reforged.finalState!.possible.has(TypeId("IncreasedLife"))).toBe(true);
        expect(reforged.finalState!.possible.has(TypeId("FireResist"))).toBe(true);
        const refused = checkPresent(
            craft(start(), [beast({ kind: "metamod" }), essence("greed", 1)]),
            ctx,
        );
        expect(refused.diagnostics[0]?.message).toContain("metacraft modifier");
        // One metamod was crafted, so no path protects both sides: a scour has
        // something to remove on each.
        const scoured = checkPresent(
            craft(start(), [beast({ kind: "metamod" }), op("scour")]),
            ctx,
        );
        expect(scoured.diagnostics).toEqual([]);
        expect(scoured.finalState!.rarities).toEqual(new Set(["normal", "magic"]));
    });

    it("a cannot-roll metamod that may be there shields nothing for sure", () => {
        const c = craft(rareRing(["AddedAttack1"], ["random"]), [
            iff(has("FireResist1"), [bench("cannot roll attack modifiers")]),
            op("annul"),
            op("exalt"),
        ]);
        const r = checkPresent(c, ctx);
        expect(r.diagnostics).toEqual([]);
        expect(guaranteed(r)).not.toContain("AddedAttackDamage");
        expect(r.finalState!.possible.has(TypeId("AddedAttackDamage"))).toBe(true);
    });
});

describe("scour respects protection", () => {
    it("keeps the protected side; the rarity goes by how many survive", () => {
        const c = craft(rareRing(["T1 Life"]), [bench("prefixes cannot be changed"), op("scour")]);
        const r = checkPresent(c, ctx);
        expect(r.diagnostics).toEqual([]);
        // One prefix survives (suffixes + the metamod are gone) → a 1-mod Magic.
        expect(r.finalState!.rarities).toEqual(new Set(["magic"]));
        expect(guaranteed(r)).toContain("IncreasedLife");
        expect(r.finalState!.counts.prefix).toEqual([1, 1]);
        expect(r.finalState!.crafted).toEqual([0, 0]);
    });

    it("refuses a scour when both sides are protected, a fractured modifier or not", () => {
        // A scour never removes a fractured modifier (Fractured item), so the
        // fractured prefix gives it nothing to remove.
        const protectedRing = (fractured: boolean) =>
            item({
                base: "Iron Ring",
                ilvl: 100,
                rarity: "rare",
                prefixes: [PROTECT_SUFFIXES_CARRIER.id, { mod: "IncreasedLife1", fractured }],
                suffixes: [PROTECT_PREFIXES_CARRIER.id, MULTIMOD_CARRIER.id],
            });
        for (const fractured of [false, true]) {
            const r = checkPresent(craft(protectedRing(fractured), [op("scour")]), ctx);
            expect(r.diagnostics[0]?.message).toContain("removable affix");
        }
    });

    it("without a metamod, scour strips to Normal", () => {
        const c = craft(rareRing(["T1 Life"]), [op("scour")]);
        const r = checkPresent(c, ctx);
        expect(r.finalState!.rarities).toEqual(new Set(["normal"]));
        expect(r.finalState!.counts.total).toEqual([0, 0]);
    });
});

describe("essence is blocked by a metamod", () => {
    it("fails while a protection metamod is present", () => {
        const c = craft(rareRing(["T1 Life"]), [
            bench("prefixes cannot be changed"),
            essence("greed", 1),
        ]);
        const r = checkPresent(c, ctx);
        expect(r.diagnostics).toHaveLength(1);
        expect(r.diagnostics[0]!.message).toContain("metacraft modifier");
    });

    it("is allowed under multimod alone (it does not affect mod outcomes)", () => {
        const c = craft(rareRing(["T1 Life"]), [
            bench("can have up to 3 crafted modifiers"),
            essence("greed", 1),
        ]);
        const r = checkPresent(c, ctx);
        expect(r.diagnostics).toEqual([]);
    });
});

describe("multimod raises the crafted-mod limit", () => {
    it("a second bench craft at the default limit of one replaces the first", () => {
        const c = craft(rareRing(), [
            bench("prefixes cannot be changed"),
            bench("suffixes cannot be changed"),
        ]);
        const r = checkPresent(c, ctx);
        expect(r.diagnostics).toEqual([]);
        expect(r.finalState!.crafted).toEqual([1, 1]);
        expect(guaranteed(r)).toContain(PROTECT_SUFFIXES_CARRIER.type);
        expect(guaranteed(r)).not.toContain(PROTECT_PREFIXES_CARRIER.type);
    });

    it("allows three crafted mods once multimod is placed", () => {
        const c = craft(rareRing(), [
            bench("can have up to 3 crafted modifiers"),
            bench("prefixes cannot be changed"),
            bench("suffixes cannot be changed"),
        ]);
        const r = checkPresent(c, ctx);
        expect(r.diagnostics).toEqual([]);
        expect(r.finalState!.crafted).toEqual([3, 3]);
    });
});

describe("reforge respects protection (Stage B)", () => {
    it("chaos keeps the protected side's guarantees", () => {
        const c = craft(rareRing(["T1 Life"]), [bench("prefixes cannot be changed"), op("chaos")]);
        const r = checkPresent(c, ctx);
        expect(r.diagnostics).toEqual([]);
        expect(r.finalState!.rarities).toEqual(new Set(["rare"]));
        expect(guaranteed(r)).toContain("IncreasedLife"); // the protected prefix survives
        expect(r.finalState!.crafted).toEqual([0, 0]); // the metamod was rerolled away
    });

    it("without a metamod, chaos drops all guarantees", () => {
        const c = craft(rareRing(["T1 Life"]), [op("chaos")]);
        const r = checkPresent(c, ctx);
        expect(guaranteed(r)).not.toContain("IncreasedLife");
    });

    it("harvest reforge keeps the protected side and still guarantees the tag", () => {
        const c = craft(rareRing(["T1 Life"]), [
            bench("prefixes cannot be changed"),
            harvest("reforge", "fire"),
        ]);
        const r = checkPresent(c, ctx);
        expect(r.diagnostics).toEqual([]);
        expect(guaranteed(r)).toContain("IncreasedLife");
        const clauses = disjunctiveGuarantees(r.finalState!).map((cl) => new Set(cl));
        expect(clauses).toContainEqual(new Set([TypeId("FireResist"), TypeId("FireChaosResist")]));
    });
});

describe("cannot roll attack modifiers shields attack mods from removal", () => {
    const attackRing = () => rareRing(["AddedAttack1"], []);

    it("an annul never removes the attack prefix, so its guarantee survives", () => {
        const c = craft(attackRing(), [bench("cannot roll attack modifiers"), op("annul")]);
        const r = checkPresent(c, ctx);
        expect(r.diagnostics).toEqual([]);
        expect(guaranteed(r)).toContain("AddedAttackDamage");
    });

    it("the veiled exalt and the harvest augment removals ignore the shield", () => {
        // Metamod § Rules and Exceptions: the Veiled Orb's and the harvest augment's
        // removals ignore cannot-roll, so the attack guarantee may be lost, and the
        // attack prefix being the only prefix is no obstacle to either.
        for (const step of [veiled("exalt"), harvest("augment", "life")]) {
            const c = craft(attackRing(), [bench("cannot roll attack modifiers"), step]);
            const r = checkPresent(c, ctx);
            expect(r.diagnostics).toEqual([]);
            expect(guaranteed(r)).not.toContain("AddedAttackDamage");
        }
    });

    it("an unproven lock may sit on the one modifier that would prove a removal", () => {
        // After the Fracturing Orb the lock may be on the carrier, the only
        // guaranteed unshielded mod, so no removal is proven.
        const c = craft(rareRing(["AddedAttack1"], ["random", "random"]), [
            bench("cannot roll attack modifiers"),
            op("fracture"),
            op("annul"),
        ]);
        const r = checkPresent(c, ctx);
        expect(r.diagnostics[0]?.message).toContain("removable");
    });
});

describe("a scour that keeps a side sets the rarity by survivor count", () => {
    it("one prefix kept beside a fractured suffix stays Rare", () => {
        // Two survivors, one per side: the item remains Rare (Orb of Scouring),
        // so a chaos is fine afterwards and a regal is refused.
        const start = () =>
            item({
                base: "Iron Ring",
                ilvl: 100,
                rarity: "rare",
                prefixes: ["T1 Life"],
                suffixes: [
                    { mod: "FireResist1", fractured: true },
                    "ColdResist1",
                    PROTECT_PREFIXES_CARRIER.id,
                ],
            });
        expect(checkPresent(craft(start(), [op("scour"), op("chaos")]), ctx).diagnostics).toEqual(
            [],
        );
        const r = checkPresent(craft(start(), [op("scour"), op("regal")]), ctx);
        expect(r.diagnostics[0]?.message).toContain("Requires a Magic item");
    });

    it("never raises the rarity: a Magic item keeping two fractured modifiers stays Magic", () => {
        const start = () =>
            item({
                base: "Iron Ring",
                ilvl: 100,
                rarity: "magic",
                prefixes: [{ mod: "T1 Life", fractured: true }],
                suffixes: [{ mod: "FireResist1", fractured: true }],
            });
        const r = checkPresent(craft(start(), [op("scour")]), ctx);
        expect(r.finalState!.rarities).toEqual(new Set(["magic"]));
        expect(checkPresent(craft(start(), [op("scour"), op("regal")]), ctx).diagnostics).toEqual(
            [],
        );
    });

    it("a kept prefix and an unproven lock may leave one or two survivors: Magic or Rare", () => {
        // The lock may sit on the kept prefix (one survivor, Magic) or on a
        // stripped suffix (two, Rare); a regal afterwards is refused since the
        // item is not Magic on every path.
        const c = craft(
            rareRing(["T1 Life"], [PROTECT_PREFIXES_CARRIER.id, "FireResist1", "ColdResist1"]),
            [op("fracture"), op("scour"), op("regal")],
        );
        const r = checkPresent(c, ctx);
        expect(r.diagnostics[0]?.message).toContain("may be Magic or Rare");
        const scoured = r.trace.find(
            (e) => e.kind === "operation" && e.after?.rarities.size === 2,
        )!;
        expect(scoured.after!.rarities).toEqual(new Set(["magic", "rare"]));
    });

    it("two kept prefixes and an unproven lock stay Rare, with the floor at the kept count", () => {
        const c = craft(
            rareRing(["T1 Life", INCREASED_MANA.id], [PROTECT_PREFIXES_CARRIER.id, "FireResist1"]),
            [op("fracture"), op("scour"), op("regal")],
        );
        const r = checkPresent(c, ctx);
        expect(r.diagnostics[0]?.message).toContain("Requires a Magic item");
        const scoured = r.trace.find(
            (e) => e.kind === "operation" && e.after?.counts.total[1] === 3,
        )!;
        // The lock may sit on a kept prefix, so the floor is two, not three.
        expect(scoured.after!.counts.total).toEqual([2, 3]);
    });

    it("a scour whose kept side's count is uncertain leaves Normal or Magic", () => {
        // The exalt may have landed on the protected prefix side or not, so the
        // scour leaves no survivor or one; an augment then needs the Magic path
        // alone, which an if on the count gives it.
        const c = craft(rareRing([], [PROTECT_PREFIXES_CARRIER.id, "FireResist1"]), [
            op("exalt"),
            op("scour"),
            op("augment"),
        ]);
        const r = checkPresent(c, ctx);
        expect(r.diagnostics[0]?.message).toContain("may be Normal or Magic");
        const narrowed = craft(rareRing([], [PROTECT_PREFIXES_CARRIER.id, "FireResist1"]), [
            op("exalt"),
            iff(cmp("prefixCount", "==", 1), [op("scour"), op("augment")]),
        ]);
        expect(checkPresent(narrowed, ctx).diagnostics).toEqual([]);
    });

    it("a fractured suffix beside a protected side's carrier: Rare with a kept prefix, Magic without", () => {
        // The exalt may have landed a prefix (kept) or a suffix (stripped), so
        // each arm narrows the count: two survivors stay Rare, one is Magic.
        const c = craft(
            item({
                base: "Iron Ring",
                ilvl: 100,
                rarity: "rare",
                suffixes: [{ mod: "FireResist1", fractured: true }, PROTECT_PREFIXES_CARRIER.id],
            }),
            [
                op("exalt"),
                iff(
                    cmp("prefixCount", "==", 1),
                    [op("scour"), op("chaos")],
                    [op("scour"), op("regal")],
                ),
            ],
        );
        expect(checkPresent(c, ctx).diagnostics).toEqual([]);
    });
});

describe("an unproven fracture through a scour", () => {
    it("keeps no candidate guaranteed: the lock may be on any one of them", () => {
        // After the Fracturing Orb any present mod may be the locked one; a scour
        // keeps only that one, so no named mod is proven to survive and a branch
        // on one of them is live both ways.
        const c = craft(rareRing(["T1 Life", "random"], ["FireResist1", "random"]), [
            op("fracture"),
            op("scour"),
            iff(has("FireResist1"), [], [op("regal")]),
        ]);
        const r = checkPresent(c, ctx);
        expect(r.diagnostics).toEqual([]);
        const scoured = r.trace.find(
            (e) => e.kind === "operation" && e.after?.rarities.has("magic"),
        )!;
        expect(guaranteedTypes(scoured.after!).size).toBe(0);
    });
});

describe("a declared bench-crafted mod counts toward the crafted limit", () => {
    it("a second bench craft replaces it without multimod", () => {
        const c = craft(rareRing([], [PROTECT_PREFIXES_CARRIER.id]), [
            bench("cannot roll attack modifiers"),
        ]);
        const r = checkPresent(c, ctx);
        expect(r.diagnostics).toEqual([]);
        expect(r.finalState!.crafted).toEqual([1, 1]);
        expect(guaranteed(r)).not.toContain(PROTECT_PREFIXES_CARRIER.type);
    });

    it("an annul under a cannot-roll metamod takes nothing off a side it cannot reach", () => {
        // The one prefix is an attack modifier the metamod shields, so only the
        // metamod itself can go: the prefix count stands, the suffix empties.
        const c = craft(rareRing([ATTACK_PREFIX.id], [CANNOT_ROLL_ATTACK_CARRIER.id]), [
            op("annul"),
        ]);
        const r = checkPresent(c, ctx);
        expect(r.diagnostics).toEqual([]);
        expect(r.finalState!.counts.prefix).toEqual([1, 1]);
        expect(r.finalState!.counts.suffix).toEqual([0, 0]);
        expect(guaranteed(r)).toContain(ATTACK_PREFIX.type);
    });

    it("the declared metamod's effect is active from the start", () => {
        const c = craft(rareRing(["T1 Life"], [PROTECT_PREFIXES_CARRIER.id]), [op("annul")]);
        const r = checkPresent(c, ctx);
        expect(r.diagnostics).toEqual([]);
        expect(guaranteed(r)).toContain("IncreasedLife");
        // The carrier is the only suffix, so the annul can have taken nothing else.
        expect(r.finalState!.crafted).toEqual([0, 0]);
    });
});

describe("a fractured bench row keeps its crafted count through a reforge", () => {
    // The fractured multimod carrier is bench-placed and reforge-proof, so the
    // crafted count can never drop below what it accounts for.
    const fracturedMultimod = () =>
        item({
            base: "Iron Ring",
            ilvl: 100,
            rarity: "rare",
            prefixes: ["T1 Life"],
            suffixes: [{ mod: MULTIMOD_CARRIER.id, fractured: true }, "random", "random"],
        });

    it("after an essence", () => {
        const r = checkPresent(craft(fracturedMultimod(), [essence("greed", 1)]), ctx);
        expect(r.diagnostics).toEqual([]);
        expect(r.finalState!.crafted).toEqual([0, 1]);
    });

    it("after a chaos", () => {
        const r = checkPresent(craft(fracturedMultimod(), [op("chaos")]), ctx);
        expect(r.diagnostics).toEqual([]);
        expect(r.finalState!.crafted).toEqual([0, 1]);
    });

    it("an unproven lock may sit on the crafted mod, so a reforge keeps one", () => {
        // The Fracturing Orb may lock the benched multimod carrier; a chaos or an
        // essence then cannot be sure the crafted count fell to zero.
        const fourMods = rareRing(["T1 Life"], ["random", "random"]);
        for (const reforge of [op("chaos"), essence("greed", 1)]) {
            const c = craft(fourMods, [
                bench("can have up to 3 crafted modifiers"),
                op("fracture"),
                reforge,
            ]);
            const r = checkPresent(c, ctx);
            expect(r.diagnostics).toEqual([]);
            expect(r.finalState!.crafted).toEqual([0, 1]);
        }
    });
});

describe("a kept cannot-roll metamod restricts a reforge's fresh pool", () => {
    // "Suffixes cannot be changed" is a prefix that keeps the suffixes, among them
    // the cannot-roll carrier, so the rerolled prefixes are drawn under the restriction.
    const lockedSuffixes = () =>
        rareRing([PROTECT_SUFFIXES_CARRIER.id], [CANNOT_ROLL_ATTACK_CARRIER.id]);

    it("a harvest reforge for the restricted tag has an empty pool", () => {
        const r = checkPresent(craft(lockedSuffixes(), [harvest("reforge", "attack")]), ctx);
        expect(r.diagnostics[0]?.message).toContain(
            "No attack modifier can be added while the item cannot roll attack modifiers",
        );
    });

    it("a harvest augment for the restricted tag blames the metamod, not a group", () => {
        const r = checkPresent(
            craft(rareRing(["T1 Life"], [CANNOT_ROLL_ATTACK_CARRIER.id]), [
                harvest("augment", "attack"),
            ]),
            ctx,
        );
        expect(r.diagnostics[0]?.message).toContain("cannot roll attack modifiers");
        expect(r.diagnostics[0]?.message).not.toContain("group");
    });

    it("a chaos keeps the restriction out of the rerolled side's pool", () => {
        const r = checkPresent(craft(lockedSuffixes(), [op("chaos")]), ctx);
        expect(r.diagnostics).toEqual([]);
        expect(r.finalState!.possible.has(TypeId("AddedAttackDamage"))).toBe(false);
        expect(r.finalState!.possible.has(TypeId("IncreasedLife"))).toBe(true);
    });
});

describe("cannot roll attack modifiers", () => {
    it("excludes attack-tagged types from a later exalt's pool", () => {
        const c = craft(rareRing(), [bench("cannot roll attack modifiers"), op("exalt")]);
        const r = checkPresent(c, ctx);
        expect(r.diagnostics).toEqual([]);
        expect(r.finalState!.possible.has(TypeId("AddedAttackDamage"))).toBe(false);
        // A non-attack mod is still addable.
        expect(r.finalState!.possible.has(TypeId("IncreasedLife"))).toBe(true);
    });
});
