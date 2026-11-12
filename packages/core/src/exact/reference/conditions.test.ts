import { describe, expect, it } from "vitest";
import { BOOTS_BASE } from "../../__fixtures__/mods.js";
import type { RPred } from "../../check/pred.js";
import type { ModId } from "../../model/ids.js";
import { TypeId } from "../../model/ids.js";
import { influenceKey } from "../../model/marks.js";
import { compare, holds } from "./conditions.js";
import { BLANK, COLD, FIRE, FIRE_CHAOS, handCtx, LIFE1, LIFE2, MANA } from "./hand.js";
import { type CItem, cItem, cMod } from "./item.js";

const ctx = handCtx();
const boots = handCtx(BOOTS_BASE);
const at = (item: CItem, pred: RPred, c = ctx): boolean => holds(pred, item, c);

const lifeRare = cItem({
    rarity: "rare",
    mods: [cMod(LIFE1.id, 11), cMod(FIRE.id, 8, { fractured: true }), cMod(COLD.id, 7)],
});
const has = (type: TypeId, tierMod?: ModId): RPred => ({
    kind: "has",
    type,
    gen: "prefix",
    ...(tierMod !== undefined && { tierMod }),
});

describe("rarity", () => {
    it("is the item's", () => {
        expect(at(lifeRare, { kind: "isRarity", rarity: "rare" })).toBe(true);
        expect(at(lifeRare, { kind: "isRarity", rarity: "magic" })).toBe(false);
    });
});

describe("has", () => {
    it("any row of the type", () => {
        expect(at(lifeRare, has(LIFE1.type))).toBe(true);
        expect(at(lifeRare, has(MANA.type))).toBe(false);
    });
    it("a named row", () => {
        expect(at(lifeRare, has(LIFE1.type, LIFE1.id))).toBe(true);
        expect(at(lifeRare, has(LIFE1.type, LIFE2.id))).toBe(false);
    });
    it("reads the side off the row, not the condition", () => {
        expect(at(lifeRare, { kind: "has", type: FIRE.type, gen: "prefix" })).toBe(true);
    });
});

describe("has group", () => {
    const fireGroup = new Set([FIRE.type, FIRE_CHAOS.type]);
    it("some type of the group", () => {
        expect(at(lifeRare, { kind: "hasGroup", type: FIRE_CHAOS.type, types: fireGroup })).toBe(
            true,
        );
        expect(
            at(lifeRare, { kind: "hasGroup", type: MANA.type, types: new Set([MANA.type]) }),
        ).toBe(false);
    });
});

describe("has with a value", () => {
    const value = (
        op: "<" | ">=" | "!=",
        v: number,
        rows: [ModId, [number, number]][],
        oneTier = false,
    ): RPred => ({
        ...(oneTier && { oneTier: true as const }),
        kind: "hasValue",
        type: LIFE1.type,
        gen: "prefix",
        op,
        value: v,
        rows: new Map(rows),
        unnumbered: new Set(),
    });
    const both: [ModId, [number, number]][] = [
        [LIFE1.id, [10, 12]],
        [LIFE2.id, [20, 21]],
    ];
    it("compares the modifier's value", () => {
        expect(at(lifeRare, value(">=", 11, both))).toBe(true);
        expect(at(lifeRare, value(">=", 12, both))).toBe(false);
        expect(at(lifeRare, value("<", 12, both))).toBe(true);
        expect(at(lifeRare, value("!=", 11, both))).toBe(false);
    });
    it("fails where the modifier is absent", () => {
        expect(at(cItem({ rarity: "rare" }), value("<", 100, both))).toBe(false);
    });
    it("compares at any row of the type where no tier is named", () => {
        expect(at(lifeRare, value(">=", 0, [[LIFE2.id, [20, 21]]]))).toBe(true);
        expect(at(lifeRare, value(">=", 12, [[LIFE2.id, [20, 21]]]))).toBe(false);
    });
    it("fails at a row the named tier does not hold", () => {
        const tier = (rows: [ModId, [number, number]][]): RPred => value(">=", 0, rows, true);
        expect(at(lifeRare, tier([[LIFE2.id, [20, 21]]]))).toBe(false);
        expect(at(lifeRare, tier([[LIFE1.id, [10, 12]]]))).toBe(true);
    });
    it("fails at a row with no number", () => {
        const blank = cItem({ rarity: "magic", mods: [cMod(BLANK.id, undefined)] });
        const pred: Extract<RPred, { kind: "hasValue" }> = {
            kind: "hasValue",
            type: BLANK.type,
            gen: "prefix",
            op: "!=",
            value: 0,
            rows: new Map(),
            unnumbered: new Set([BLANK.id]),
        };
        expect(at(blank, pred)).toBe(false);
        expect(at(blank, { kind: "not", inner: pred })).toBe(true);
        expect(at(blank, { ...pred, op: "==" })).toBe(false);
        expect(at(blank, { ...pred, oneTier: true })).toBe(false);
    });
});

describe("counts", () => {
    it("count every affix of the side", () => {
        const prefixes = (op: "==" | ">", value: number): RPred => ({
            kind: "compare",
            projection: "prefixCount",
            op,
            value,
        });
        expect(at(lifeRare, prefixes("==", 1))).toBe(true);
        expect(at(lifeRare, prefixes(">", 1))).toBe(false);
        expect(
            at(lifeRare, { kind: "compare", projection: "suffixCount", op: "==", value: 2 }),
        ).toBe(true);
    });
});

describe("marks", () => {
    it("fractured", () => {
        expect(at(lifeRare, { kind: "fractured", type: FIRE.type })).toBe(true);
        expect(at(lifeRare, { kind: "fractured", type: COLD.type })).toBe(false);
        expect(at(lifeRare, { kind: "fractured", type: MANA.type })).toBe(false);
    });
    it("influenced, by any or a named influence", () => {
        const hunter = cItem({ influences: influenceKey(["hunter"]) });
        expect(at(hunter, { kind: "influenced" })).toBe(true);
        expect(at(hunter, { kind: "influenced", influence: "hunter" })).toBe(true);
        expect(at(hunter, { kind: "influenced", influence: "shaper" })).toBe(false);
        expect(at(cItem(), { kind: "influenced" })).toBe(false);
    });
    it("corrupted", () => {
        expect(at(cItem({ corrupted: true }), { kind: "corrupted" })).toBe(true);
        expect(at(cItem(), { kind: "corrupted" })).toBe(false);
    });
});

describe("eldritch implicits", () => {
    const speed = TypeId("ImplicitMoveSpeed");
    const regen = TypeId("ImplicitLifeRegen");
    const item = cItem({ exarch: { tier: 3, type: speed }, eater: { tier: 2, type: undefined } });
    it("present, at a tier, of a wording", () => {
        expect(at(item, { kind: "eldritch", side: "exarch" }, boots)).toBe(true);
        expect(at(item, { kind: "eldritch", side: "exarch", tier: 3 }, boots)).toBe(true);
        expect(at(item, { kind: "eldritch", side: "exarch", tier: 2 }, boots)).toBe(false);
        expect(at(item, { kind: "eldritch", side: "exarch", types: new Set([speed]) }, boots)).toBe(
            true,
        );
        expect(at(item, { kind: "eldritch", side: "exarch", types: new Set([regen]) }, boots)).toBe(
            false,
        );
        expect(at(cItem(), { kind: "eldritch", side: "eater" }, boots)).toBe(false);
    });
    it("an unnamed implicit matches no wording", () => {
        expect(at(item, { kind: "eldritch", side: "eater", types: new Set([regen]) }, boots)).toBe(
            false,
        );
    });
    it("dominant: the higher tier, none when equal", () => {
        expect(at(item, { kind: "dominant", side: "exarch" }, boots)).toBe(true);
        expect(at(item, { kind: "dominant", side: "eater" }, boots)).toBe(false);
        const equal = cItem({
            exarch: { tier: 2, type: speed },
            eater: { tier: 2, type: undefined },
        });
        expect(at(equal, { kind: "dominant", side: "exarch" }, boots)).toBe(false);
        expect(at(equal, { kind: "dominant", side: "eater" }, boots)).toBe(false);
    });
});

describe("connectives", () => {
    const life = has(LIFE1.type);
    const mana = has(MANA.type);
    it("not, and, or", () => {
        expect(at(lifeRare, { kind: "not", inner: mana })).toBe(true);
        expect(at(lifeRare, { kind: "not", inner: life })).toBe(false);
        expect(at(lifeRare, { kind: "and", left: life, right: mana })).toBe(false);
        expect(at(lifeRare, { kind: "and", left: life, right: life })).toBe(true);
        expect(at(lifeRare, { kind: "or", left: mana, right: life })).toBe(true);
        expect(at(lifeRare, { kind: "or", left: mana, right: mana })).toBe(false);
    });
});

describe("compare", () => {
    it("every operator", () => {
        expect([compare(1, "==", 1), compare(1, "!=", 1), compare(1, "<", 2)]).toEqual([
            true,
            false,
            true,
        ]);
        expect([compare(2, "<=", 2), compare(2, ">", 2), compare(2, ">=", 3)]).toEqual([
            true,
            false,
            false,
        ]);
    });
});
