import { describe, expect, it } from "vitest";
import type { ItemView, ModGroup, ModView } from "@hinekora/core";
import { figure, moneyText, named, percentage, stateLine } from "./storyboard.js";

describe("the storyboard's cost wording", () => {
    it("quotes figures and chances as a guide does", () => {
        expect(figure(0.25)).toBe("0.25");
        expect(figure(8.8)).toBe("8.8");
        expect(figure(36.84)).toBe("36.8");
        expect(figure(473.26)).toBe("473");
        expect(figure(Infinity)).toBe("∞");
        expect(percentage(0.56)).toBe("56%");
        expect(percentage(0.045)).toBe("4.5%");
        expect(percentage(0.0025)).toBe("0.25%");
    });

    it("lists what a step consumes, priced when the snapshot knows it", () => {
        const spend = [
            { item: "Deafening Essence of Greed", amount: 8.8 },
            { item: "Chaos Orb", amount: 2 },
        ];
        expect(moneyText(spend)).toBe("8.8 Deafening Essence of Greed, 2 Chaos Orb");
        const snapshot = {
            league: "Allflame",
            fetchedAt: "2026-11-09T07:34:02.180Z",
            chaosPerDivine: 473.26,
            chaos: new Map([
                ["Deafening Essence of Greed", 2.5],
                ["Chaos Orb", 1],
            ]),
        };
        expect(moneyText(spend, snapshot)).toBe(
            "8.8 Deafening Essence of Greed, 2 Chaos Orb (about 24 chaos)",
        );
    });
});

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
