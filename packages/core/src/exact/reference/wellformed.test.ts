import { describe, expect, it } from "vitest";
import {
    AMULET_BASE,
    ASTROLABE_BASE,
    BOOTS_BASE,
    FLASK_BASE,
    JEWEL_BASE,
    RATCHETING_BASE,
    SIMPLEX_BASE,
} from "../../__fixtures__/mods.js";
import { ModId, TypeId } from "../../model/ids.js";
import { INFLUENCES, type InfluenceKey, influenceKey } from "../../model/marks.js";
import {
    ARMOUR,
    BENCH_COLD,
    BENCH_LIFE,
    BENCH_MANA,
    BLANK,
    COLD,
    FIRE,
    FIRE_CHAOS,
    FLASKY,
    handCtx,
    HELMET_BASE,
    LIFE1,
    LIFE2,
    LIGHTNING,
    MANA,
    MULTIMOD,
    VEILED_P,
    VEILED_S,
} from "./hand.js";
import { type CItem, cItem, cMod, type RefCtx } from "./item.js";
import { violations } from "./wellformed.js";

const ring = handCtx();
const ok = (item: CItem, ctx: RefCtx = ring): void => expect(violations(item, ctx)).toEqual([]);
const bad = (item: CItem, fragment: string, ctx: RefCtx = ring): void =>
    expect(violations(item, ctx).join("\n")).toContain(fragment);

const life = cMod(LIFE1.id, 11);
const mana = cMod(MANA.id, 5);
const armour = cMod(ARMOUR.id, 3);
const blank = cMod(BLANK.id, undefined);
const fire = cMod(FIRE.id, 8);
const cold = cMod(COLD.id, 7);
const lightning = cMod(LIGHTNING.id, 7);
const benchLife = cMod(BENCH_LIFE.id, 15, { crafted: true });
const benchMana = cMod(BENCH_MANA.id, 7, { crafted: true });
const benchCold = cMod(BENCH_COLD.id, 9, { crafted: true });
const multimod = cMod(MULTIMOD.id, 3, { crafted: true });
const rare = (...mods: CItem["mods"]): CItem => cItem({ rarity: "rare", mods });
const magic = (...mods: CItem["mods"]): CItem => cItem({ rarity: "magic", mods });

describe("rarity", () => {
    it("a flask is Magic at most", () => {
        ok(magic(), handCtx(FLASK_BASE));
        bad(rare(), "cannot be Rare", handCtx(FLASK_BASE));
    });
    it("a Normal item has no modifier", () => {
        ok(cItem());
        bad(cItem({ mods: [life] }), "1 prefixes, at most 0");
    });
});

describe("rows", () => {
    it("are the catalogue's", () => {
        bad(magic(cMod(ModId("Nowhere"), 1)), "not in the catalogue");
    });
    it("one per type", () => {
        ok(rare(life));
        bad(rare(life, cMod(LIFE2.id, 20)), "two modifiers of type TypeLife");
    });
    it("one per group", () => {
        ok(rare(fire, cold));
        bad(rare(fire, cMod(FIRE_CHAOS.id, 4)), "two modifiers of group ResFire");
    });
    it("a natural row of another domain is refused, a bench row is not", () => {
        bad(magic(cMod(FLASKY.id, 1)), "domain flask");
        ok(magic(benchLife));
    });
    it("a row above the item level is allowed", () => {
        ok(rare(cMod(LIFE2.id, 20)), handCtx(undefined, 10));
    });
});

describe("capacity", () => {
    it("holds each side and the total to the rarity", () => {
        ok(magic(life, fire));
        bad(magic(life, mana), "2 prefixes, at most 1");
        ok(rare(life, mana, armour, fire, cold, lightning));
        bad(rare(life, mana, armour, blank), "4 prefixes, at most 3");
    });
    it("holds a magic Ratcheting Ring to two suffixes by the total", () => {
        const ratcheting = handCtx(RATCHETING_BASE);
        ok(magic(fire, cold), ratcheting);
        bad(magic(fire, cold, lightning), "3 modifiers, at most 2", ratcheting);
        bad(magic(life), "1 prefixes, at most 0", ratcheting);
    });
});

describe("capacity of other classes", () => {
    it("a Rare jewel holds two of each side", () => {
        const jewel = handCtx(JEWEL_BASE);
        ok(rare(life, mana, fire, cold), jewel);
        bad(rare(life, mana, armour), "3 prefixes, at most 2", jewel);
    });
    it("a Simplex Amulet's deltas shift each side, and its total follows", () => {
        const simplex = handCtx(SIMPLEX_BASE);
        ok(rare(life, fire, cold), simplex);
        bad(rare(life, mana), "2 prefixes, at most 1", simplex);
        bad(rare(life, fire, cold, lightning), "3 suffixes, at most 2", simplex);
        bad(magic(fire), "1 suffixes, at most 0", simplex);
    });
});

describe("values", () => {
    it("lie within the row's span, whole where the span is", () => {
        ok(magic(cMod(LIFE1.id, 12)));
        bad(magic(cMod(LIFE1.id, 13)), "outside 10-12");
        bad(magic(cMod(LIFE1.id, 10.5)), "outside 10-12");
        bad(magic(cMod(LIFE1.id, undefined)), "has no value");
    });
    it("a row with no number has no value", () => {
        ok(magic(blank));
        bad(magic(cMod(BLANK.id, 1)), "has no number");
    });
    it("a fixed number is the value", () => {
        ok(magic(armour));
        bad(magic(cMod(ARMOUR.id, 4)), "outside 3-3");
    });
});

describe("crafted modifiers", () => {
    it("a bench row is crafted", () => {
        bad(magic(cMod(BENCH_LIFE.id, 15)), "is a bench row, not crafted");
    });
    it("a natural row may be crafted", () => {
        ok(rare(life, cMod(FIRE.id, 8, { crafted: true })));
    });
    // The limit is the bench's to check: taking the multimod away leaves its crafts.
    it("any number, with the multimod or without", () => {
        ok(rare(benchLife, fire));
        ok(rare(benchLife, benchCold));
        ok(rare(benchLife, benchCold, multimod));
        ok(rare(benchLife, benchMana, benchCold, multimod));
        ok(rare(benchLife, benchMana, benchCold, cMod(FIRE.id, 8, { crafted: true })));
    });
});

describe("veiled modifiers", () => {
    it("one at most", () => {
        ok(rare(cMod(VEILED_P.id, undefined)));
        bad(rare(cMod(VEILED_P.id, undefined), cMod(VEILED_S.id, undefined)), "2 veiled");
    });
});

describe("influences", () => {
    const hunter = influenceKey(["hunter"]);
    it("one or two, in canonical form", () => {
        ok(rare(life), ring);
        ok(cItem({ rarity: "rare", influences: hunter }));
        ok(cItem({ influences: influenceKey(["shaper", "elder"]) }));
        bad(cItem({ influences: influenceKey(["shaper", "elder", "hunter"]) }), "3 influences");
        bad(cItem({ influences: "hunter+shaper" as InfluenceKey }), "not canonical");
        bad(cItem({ influences: "nobody" as InfluenceKey }), "not canonical");
        bad(cItem({ influences: "hunter+hunter" as InfluenceKey }), "not canonical");
    });
    it("not on a class no influence marks", () => {
        bad(cItem({ influences: hunter }), "cannot be influenced", handCtx(JEWEL_BASE));
    });
    it("every one on the Astrolabe Amulet", () => {
        const astrolabe = handCtx(ASTROLABE_BASE);
        ok(cItem({ influences: influenceKey(INFLUENCES) }), astrolabe);
        bad(cItem(), "every influence", astrolabe);
    });
    it("exclude a fracture", () => {
        const fractured = cMod(LIFE1.id, 11, { fractured: true });
        ok(rare(fractured));
        bad(
            cItem({ rarity: "rare", mods: [fractured], influences: hunter }),
            "cannot be fractured",
        );
    });
    it("a fractured item may hold an imprint", () => {
        const fractured = rare(cMod(LIFE1.id, 11, { fractured: true }));
        ok({ ...fractured, imprint: fractured });
    });
    it("fractures have no limit", () => {
        const f = { fractured: true };
        ok(rare(cMod(LIFE1.id, 11, f), cMod(MANA.id, 5, f), cMod(FIRE.id, 8, f)));
    });
});

describe("eldritch implicits", () => {
    const boots = handCtx(BOOTS_BASE);
    const speed = { tier: 3, type: TypeId("ImplicitMoveSpeed") };
    it("an armour piece takes one of the catalogue's rows at its tier", () => {
        ok(cItem({ exarch: speed, eater: { tier: 3, type: TypeId("ImplicitChaosRes") } }), boots);
        bad(
            cItem({ exarch: { tier: 3, type: TypeId("ImplicitChaosRes") } }),
            "not one of tier 3",
            boots,
        );
        bad(cItem({ exarch: { tier: 3, type: undefined } }), "unnamed", boots);
    });
    it("is unnamed where the catalogue has no row at the tier", () => {
        ok(cItem({ exarch: { tier: 1, type: undefined } }), handCtx(HELMET_BASE));
        bad(cItem({ exarch: { tier: 1, type: undefined } }), "unnamed", boots);
    });
    it("tiers 0 to 6, and no type without a tier", () => {
        bad(cItem({ exarch: { tier: 7, type: undefined } }), "outside 0-6", boots);
        bad(cItem({ exarch: { tier: 2.5, type: undefined } }), "outside 0-6", boots);
        bad(cItem({ exarch: { tier: 0, type: TypeId("ImplicitMoveSpeed") } }), "no tier", boots);
    });
    it("not on a ring, below item level 75, or beside an influence", () => {
        bad(cItem({ exarch: { tier: 1, type: undefined } }), "cannot have an exarch", ring);
        bad(cItem({ exarch: speed }), "item level 75", handCtx(BOOTS_BASE, 74));
        const hunter = influenceKey(["hunter"]);
        bad(cItem({ exarch: speed, influences: hunter }), "influenced item cannot", boots);
    });
    it("an amulet has one, Exceptional at most", () => {
        const amulet = handCtx(AMULET_BASE);
        const at = (tier: number, side: string) => ({
            tier,
            type: TypeId(`ImplicitAmulet${side}`),
        });
        ok(cItem({ exarch: at(4, "Exarch") }), amulet);
        ok(cItem({ eater: at(2, "Eater") }), amulet);
        bad(cItem({ exarch: at(5, "Exarch") }), "at most tier 4", amulet);
        bad(cItem({ exarch: at(1, "Exarch"), eater: at(1, "Eater") }), "one eldritch", amulet);
    });
});

describe("memory strands", () => {
    it("0 to 100, whole", () => {
        ok(cItem({ strands: 100 }));
        bad(cItem({ strands: 101 }), "memory strands");
        bad(cItem({ strands: -1 }), "memory strands");
        bad(cItem({ strands: 2.5 }), "memory strands");
    });
});

describe("the imprint", () => {
    it("is a well-formed item with no imprint of its own", () => {
        ok(cItem({ rarity: "magic", imprint: magic(life) }));
        bad(cItem({ imprint: magic(life, mana) }), "imprint: 2 prefixes");
        bad(cItem({ imprint: cItem({ imprint: cItem() }) }), "an imprint holds an imprint");
    });
});
