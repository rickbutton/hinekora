import { describe, expect, it } from "vitest";
import { checkPresent, type CheckContext } from "./check.js";
import { guaranteedTypes } from "./astate.js";
import { buildRegistry } from "../resolve/registry.js";
import { craft, has, iff, item, notp, op, orp, stop, unveil, veiled } from "../__fixtures__/ast.js";
import {
    AMULET_BASE,
    CATALOG,
    CROSS_SIDE_A_NATURAL,
    CROSS_SIDE_A_UNVEILED,
    CROSS_SIDE_B_NATURAL,
    CROSS_SIDE_B_UNVEILED,
    PROTECT_PREFIXES_CARRIER,
    PROTECT_SUFFIXES_CARRIER,
    RING_BASE,
    VEILED_CATALOG,
    VEILED_PREFIX_MOD,
    VEILED_SUFFIX_MOD,
} from "../__fixtures__/mods.js";
import { veiledPool } from "../pool/veiled.js";
import { GroupId, TypeId } from "../model/ids.js";

const registry = buildRegistry({
    bases: [RING_BASE, AMULET_BASE],
    mods: [...CATALOG, ...VEILED_CATALOG, PROTECT_PREFIXES_CARRIER, PROTECT_SUFFIXES_CARRIER],
    baseAliases: { "Iron Ring": "IronRing", "Coral Amulet": "CoralAmulet" },
});
const ctx: CheckContext = { registry };

const rareRing = (suffixes: string[] = []) =>
    item({ base: "Iron Ring", ilvl: 100, rarity: "rare", suffixes });
const rareAmulet = () => item({ base: "Coral Amulet", ilvl: 100, rarity: "rare" });

const guaranteed = (r: ReturnType<typeof checkPresent>): Set<string> =>
    new Set([...guaranteedTypes(r.finalState!)]);

describe("veiledPool", () => {
    it("returns the item's unveil options, filtered by class and blocked families", () => {
        const ring = veiledPool(registry.catalog, RING_BASE, 100, new Set());
        expect(new Set(ring.map((m) => m.type))).toEqual(
            new Set([
                TypeId("VeiledDoubleDamage"),
                TypeId("VeiledCastSpeed"),
                TypeId("VeiledArmourAndLife"),
            ]),
        );
        // An amulet also offers the amulet-only life hybrid (four options).
        expect(veiledPool(registry.catalog, AMULET_BASE, 100, new Set())).toHaveLength(4);
        // A present Life family blocks that hybrid back out.
        const blocked = veiledPool(registry.catalog, AMULET_BASE, 100, new Set([GroupId("Life")]));
        expect(blocked.map((m) => m.type)).not.toContain(TypeId("VeiledLifeHybrid"));
    });
});

describe("veiled orbs", () => {
    it("veiled chaos leaves a veiled mod ready to unveil", () => {
        const r = checkPresent(craft(rareRing(), [veiled("chaos"), unveil()]), ctx);
        expect(r.diagnostics).toEqual([]);
    });

    it("unveil without a veiled mod fails", () => {
        const r = checkPresent(craft(rareRing(), [unveil()]), ctx);
        expect(r.diagnostics).toHaveLength(1);
        expect(r.diagnostics[0]!.message).toContain("veiled modifier");
    });

    it("a corrupted item can still be unveiled, and takes no veiled orb", () => {
        const corrupted = item({
            base: "Iron Ring",
            ilvl: 100,
            rarity: "rare",
            prefixes: ["VeiledPrefix"],
            corrupted: true,
        });
        expect(checkPresent(craft(corrupted, [unveil()]), ctx).diagnostics).toEqual([]);
        const again = checkPresent(craft(corrupted, [unveil(), veiled("exalt")]), ctx);
        expect(again.diagnostics[0]?.message).toContain("The item is corrupted");
    });

    it("a veiled orb is refused while a veiled modifier is pending", () => {
        const r = checkPresent(craft(rareRing(), [veiled("chaos"), veiled("exalt")]), ctx);
        expect(r.diagnostics).toHaveLength(1);
        expect(r.diagnostics[0]!.message).toContain("veiled or unveiled modifier");
    });

    it("a veiled exalt is refused once an unveiled modifier may be on the item", () => {
        const r = checkPresent(
            craft(rareRing(), [veiled("chaos"), unveil(), veiled("exalt")]),
            ctx,
        );
        expect(r.diagnostics).toHaveLength(1);
        expect(r.diagnostics[0]!.message).toContain("veiled or unveiled modifier");
    });

    it("a veiled orb is refused on an item that declares an unveiled modifier", () => {
        // The declared row shares its type with a natural row listed first, so only
        // the rows the type may be, not the first row, reveal it as unveiled.
        const r = checkPresent(craft(rareRing(["SharedVeilUnveiled1"]), [veiled("exalt")]), ctx);
        expect(r.diagnostics[0]!.message).toContain("veiled or unveiled modifier");
    });

    it("a veiled chaos reforges an unveiled modifier away, so it is not refused", () => {
        const r = checkPresent(craft(rareRing(["SharedVeilUnveiled1"]), [veiled("chaos")]), ctx);
        expect(r.diagnostics).toEqual([]);
    });

    it("a veiled chaos is refused when a protected side keeps the item's veiled modifier", () => {
        // "Prefixes Cannot Be Changed" keeps the veiled prefix through the reforge,
        // and the orb cannot add a second one; an unveiled suffix beside the same
        // metamod is rerolled away, so that orb goes through.
        const kept = item({
            base: "Iron Ring",
            ilvl: 100,
            rarity: "rare",
            prefixes: ["VeiledPrefix"],
            suffixes: [PROTECT_PREFIXES_CARRIER.id],
        });
        const r = checkPresent(craft(kept, [veiled("chaos")]), ctx);
        expect(r.diagnostics[0]!.message).toContain("veiled or unveiled modifier");
        const rerolled = rareRing(["SharedVeilUnveiled1", PROTECT_PREFIXES_CARRIER.id]);
        expect(checkPresent(craft(rerolled, [veiled("chaos")]), ctx).diagnostics).toEqual([]);
    });

    it("a veiled chaos is refused when a protected side keeps an unveiled modifier", () => {
        const kept = item({
            base: "Iron Ring",
            ilvl: 100,
            rarity: "rare",
            prefixes: [PROTECT_SUFFIXES_CARRIER.id],
            suffixes: ["SharedVeilUnveiled1"],
        });
        const r = checkPresent(craft(kept, [veiled("chaos")]), ctx);
        expect(r.diagnostics[0]!.message).toContain("would survive the reforge");
    });

    it("a veiled chaos is refused when the unveiled modifier is fractured", () => {
        const kept = item({
            base: "Iron Ring",
            ilvl: 100,
            rarity: "rare",
            suffixes: [{ mod: "SharedVeilUnveiled1", fractured: true }],
        });
        const r = checkPresent(craft(kept, [veiled("chaos")]), ctx);
        expect(r.diagnostics[0]!.message).toContain("would survive the reforge");
    });

    it("a veiled chaos is refused under an unproven fracture beside an unveiled modifier", () => {
        // The Fracturing Orb may have locked the unveiled suffix, so it may survive.
        const start = item({
            base: "Iron Ring",
            ilvl: 100,
            rarity: "rare",
            prefixes: ["random", "random"],
            suffixes: ["SharedVeilUnveiled1", "random"],
        });
        const r = checkPresent(craft(start, [op("fracture"), veiled("chaos")]), ctx);
        expect(r.diagnostics[0]!.message).toContain("would survive the reforge");
    });

    it("has no word for Aisling's retired safehouse bench", () => {
        const r = checkPresent(craft(rareRing(["FireResist1"]), [op("aisling")]), ctx);
        expect(r.diagnostics).toHaveLength(1);
    });

    it("veiled exalt keeps the affix count (removes one, adds the veiled mod)", () => {
        const r = checkPresent(craft(rareRing(["random", "random"]), [veiled("exalt")]), ctx);
        expect(r.diagnostics).toEqual([]);
        expect(r.finalState!.counts.total).toEqual([2, 2]);
    });
});

describe("unveil", () => {
    it("guarantees a target when the pool is 3 or fewer", () => {
        const r = checkPresent(craft(rareRing(), [veiled("chaos"), unveil("double damage")]), ctx);
        expect(r.diagnostics).toEqual([]);
        expect(guaranteed(r)).toContain("VeiledDoubleDamage");
    });

    it("cannot guarantee a target when more than 3 options remain", () => {
        const r = checkPresent(
            craft(rareAmulet(), [veiled("chaos"), unveil("double damage")]),
            ctx,
        );
        expect(r.diagnostics).toHaveLength(1);
        expect(r.diagnostics[0]!.message).toMatch(/block the pool|3 or fewer/);
    });

    it("rejects a target that isn't an available option", () => {
        const r = checkPresent(craft(rareRing(), [veiled("chaos"), unveil("maximum life")]), ctx);
        expect(r.diagnostics).toHaveLength(1);
        expect(r.diagnostics[0]!.message).toContain("not an available unveil option");
    });

    it("bare unveil leaves a disjunction a branch can narrow", () => {
        const c = craft(rareAmulet(), [
            veiled("chaos"),
            unveil(),
            iff(has("cast speed"), [op("scour")]),
        ]);
        const r = checkPresent(c, ctx);
        // The `if has "cast speed"` branch is reachable (one possible unveil outcome),
        // so no dead-branch diagnostic.
        expect(r.diagnostics).toEqual([]);
    });
});

describe("a veiled orb on an item whose placeholders were proven absent", () => {
    it("relaxes the exclusion before asserting the placeholder", () => {
        // Inside the branch both placeholder types are excluded; the orb's fill
        // must lift that before it asserts one is present, or the state is a
        // contradiction under which every later check holds vacuously.
        const c = craft(
            item({ base: "Iron Ring", ilvl: 100, rarity: "rare", prefixes: ["random"] }),
            [iff(notp(orp(has("VeiledPrefix"), has("VeiledSuffix"))), [veiled("chaos")])],
        );
        const r = checkPresent(c, ctx);
        expect(r.diagnostics).toEqual([]);
        expect(r.finalState!.presence).not.toBe(r.finalState!.bdd.FALSE);
    });
});

describe("a modifier unveiled on the other side from its natural row", () => {
    const cross = buildRegistry({
        bases: [RING_BASE],
        mods: [
            ...CATALOG,
            VEILED_PREFIX_MOD,
            VEILED_SUFFIX_MOD,
            PROTECT_SUFFIXES_CARRIER,
            CROSS_SIDE_A_NATURAL,
            CROSS_SIDE_A_UNVEILED,
            CROSS_SIDE_B_NATURAL,
            CROSS_SIDE_B_UNVEILED,
        ],
        baseAliases: { "Iron Ring": "IronRing" },
    });

    it("is not what a declared random affix is, so a veiled orb takes the item", () => {
        // The random suffix may be a cross-side modifier's natural row; its
        // unveiled row is on the item only when the block names it.
        const random = item({
            base: "Iron Ring",
            ilvl: 100,
            rarity: "rare",
            prefixes: ["random"],
            suffixes: ["random"],
        });
        const r = checkPresent(craft(random, [veiled("exalt")]), { registry: cross });
        expect(r.diagnostics).toEqual([]);
        const named = item({
            base: "Iron Ring",
            ilvl: 100,
            rarity: "rare",
            prefixes: [CROSS_SIDE_A_UNVEILED.id],
            suffixes: ["random"],
        });
        expect(
            checkPresent(craft(named, [veiled("exalt")]), { registry: cross }).diagnostics,
        ).toHaveLength(1);
    });

    it("is not what a branch's added modifier is where the other arm added none", () => {
        // Only the arm that used the Exalted Orb can hold a suffix, and that
        // suffix is a natural row; where the arms meet it is still one.
        const random = item({ base: "Iron Ring", ilvl: 100, rarity: "rare", prefixes: ["random"] });
        const c = craft(random, [iff(has("IncreasedLife1"), [op("exalt")]), veiled("exalt")]);
        expect(checkPresent(c, { registry: cross }).diagnostics).toEqual([]);
    });

    it("may be the unnamed affix of that side, so a later veiled orb is refused", () => {
        // The suffixes are locked and all named, so the veiled orb's modifier is
        // a prefix and the unveil leaves one of the two cross-side modifiers as a
        // prefix. Read from their natural suffix rows they would be judged
        // absent, the suffix side being fully named, and the orb accepted.
        const locked = item({
            base: "Iron Ring",
            ilvl: 100,
            rarity: "rare",
            prefixes: ["IncreasedLife1", PROTECT_SUFFIXES_CARRIER.id],
            suffixes: ["FireResist1", "ColdResist1", "LightningResist1"],
        });
        const r = checkPresent(craft(locked, [veiled("exalt"), unveil(), veiled("exalt")]), {
            registry: cross,
        });
        expect(r.diagnostics).toHaveLength(1);
        expect(r.diagnostics[0]!.message).toContain("veiled or unveiled modifier");
    });
});

describe("a veiled orb after an unveiled modifier has provably gone", () => {
    it("is accepted when every affix of each side is a named one", () => {
        // Under the suffix lock the orb takes the life or the metamod; a bad
        // unveil is annulled away, and where the annul took the life or a
        // resistance the guide stops. What continues has one prefix, the life,
        // and the three resistances, so no unveiled modifier can remain.
        const locked = item({
            base: "Iron Ring",
            ilvl: 100,
            rarity: "rare",
            prefixes: ["IncreasedLife1", PROTECT_SUFFIXES_CARRIER.id],
            suffixes: ["FireResist1", "ColdResist1", "LightningResist1"],
        });
        const bricked = orp(
            orp(notp(has("IncreasedLife1")), notp(has("FireResist1"))),
            orp(notp(has("ColdResist1")), notp(has("LightningResist1"))),
        );
        const c = craft(locked, [
            veiled("exalt"),
            iff(notp(has("IncreasedLife1")), [stop()]),
            unveil(),
            op("annul"),
            iff(bricked, [stop()]),
            veiled("exalt"),
        ]);
        expect(checkPresent(c, ctx).diagnostics).toEqual([]);
    });
});
