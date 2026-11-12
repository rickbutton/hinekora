import { describe, expect, it } from "vitest";
import {
    andp,
    callStmt,
    craft,
    has,
    hasP,
    iff,
    item,
    notp,
    op,
    orp,
    param,
    procDef,
    until,
} from "../__fixtures__/ast.js";
import type { Craft } from "../ast/ast.js";
import { TypeId } from "../model/ids.js";
import { startOf } from "./initial.js";
import { craftNames } from "./names.js";
import { HAND_REGISTRY } from "./reference/hand.js";

const ring = (prefixes: readonly string[] = []) =>
    item({ base: "IronRing", ilvl: 84, rarity: "rare", prefixes });

const namesOf = (c: Craft) => {
    const u = startOf(HAND_REGISTRY, c, () => {})!.u;
    const n = craftNames(c, u);
    return { types: [...n.types].sort(), groups: n.groups.map((g) => g.join(",")) };
};

describe("the modifiers a craft names", () => {
    it("are those of its conditions and its item block, a placeholder naming none", () => {
        const c = craft(ring(["Mana1", "random"]), [
            iff(has("Life1"), [op("exalt")]),
            until(notp(has("Cold1")), [op("chaos")]),
        ]);
        expect(namesOf(c).types).toEqual(["TypeCold", "TypeLife", "TypeMana"]);
    });

    it("group what an `or` waits for, and what a negated `and` of absences does", () => {
        const c = craft(ring(), [
            until(orp(has("Life1"), orp(has("Fire1"), has("Cold1"))), [op("chaos")]),
            iff(notp(andp(notp(has("Mana1")), notp(has("Armour1")))), [op("exalt")]),
            // Not a group: what it waits for is an absence.
            iff(notp(andp(has("Lightning1"), has("Life1"))), [op("exalt")]),
        ]);
        expect(namesOf(c).groups.sort()).toEqual([
            "TypeArmour,TypeMana",
            "TypeCold,TypeFire",
            "TypeCold,TypeFire,TypeLife",
        ]);
    });

    it("read a function's conditions with the names its call passes", () => {
        const roll = procDef("roll", ["m"], [until(hasP(param("m")), [op("chaos")])]);
        const c = craft(ring(), [callStmt("roll", ["Fire1"])], [], [roll]);
        expect(namesOf(c).types).toContain(TypeId("TypeFire"));
    });
});
