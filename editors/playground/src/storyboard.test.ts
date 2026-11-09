import { describe, expect, it } from "vitest";
import type { ItemView, ModGroup, ModView } from "@hinekora/core";
import { named, stateLine } from "./storyboard.js";

const mod = (text: string): ModView => ({
    text,
    gen: "suffix",
    tags: [],
    fractured: false,
    crafted: false,
});

const view = (groups: ModGroup[], remainder?: ItemView["remainder"]): ItemView => ({
    base: "Iron Ring",
    itemClass: "Rings",
    ilvl: 84,
    rarities: ["rare"],
    implicits: [],
    prefixes: [],
    suffixes: groups,
    either: [],
    ...(remainder !== undefined && { remainder }),
    marks: [],
    without: [],
});

describe("the storyboard's state line", () => {
    it("counts a group of alternatives as the modifiers it guarantees", () => {
        const two: ModGroup = {
            kind: "oneOf",
            atLeast: 2,
            exact: false,
            members: [mod("fire"), mod("cold"), mod("lightning")],
        };
        expect(stateLine(view([two], { count: [1, 2], where: "either" }))).toBe(
            "Rare · 3–4 modifiers",
        );
        expect(stateLine(view([{ kind: "mod", mod: mod("life") }]))).toBe("Rare · 1 modifier");
        expect(stateLine(view([], { count: [1, 2], where: "either" }))).toBe(
            "Rare · 1–2 modifiers",
        );
    });
});

describe("the storyboard's named changes", () => {
    it("drops the rarity and the unnamed count, keeps the rest", () => {
        expect(
            named({
                added: ["Rare", "+# to maximum Life", "2 unknown modifiers"],
                removed: ["Magic", "1 unknown modifier", "Hunter Item"],
            }),
        ).toEqual({ added: ["+# to maximum Life"], removed: ["Hunter Item"] });
    });
});
