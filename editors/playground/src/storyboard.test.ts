import { describe, expect, it } from "vitest";
import type { ItemView, ModGroup, ModView } from "@hinekora/core";
import type { StepCost } from "@hinekora/core";
import {
    breakdown,
    figure,
    moneyText,
    named,
    passIsPartial,
    passSpend,
    percentage,
    stateLine,
} from "./storyboard.js";

const snapshot = {
    league: "Allflame",
    fetchedAt: "2026-11-09T07:34:02.180Z",
    chaosPerDivine: 400,
    chaos: new Map([
        ["Deafening Essence of Greed", 2.5],
        ["Chaos Orb", 1],
    ]),
};

describe("the storyboard's breakdown", () => {
    it("prices each currency, dearest first, and sums what it can", () => {
        const b = breakdown(
            [
                { item: "Chaos Orb", amount: 10 },
                { item: "Deafening Essence of Greed", amount: 8 },
            ],
            snapshot,
        );
        expect(b.rows.map((r) => r.item)).toEqual(["Deafening Essence of Greed", "Chaos Orb"]);
        expect(b.rows[0]).toEqual({
            item: "Deafening Essence of Greed",
            amount: 8,
            each: 2.5,
            chaos: 20,
        });
        expect(b.chaos).toBe(30);
        expect(b.divine).toBe(0.075);
    });

    it("leaves an unpriced currency last and the sum out", () => {
        const b = breakdown(
            [
                { item: "Vivid Crystallised Lifeforce", amount: 300 },
                { item: "Chaos Orb", amount: 2 },
            ],
            snapshot,
        );
        expect(b.rows.map((r) => r.item)).toEqual(["Chaos Orb", "Vivid Crystallised Lifeforce"]);
        expect(b.chaos).toBeUndefined();
        expect(breakdown([{ item: "Chaos Orb", amount: 2 }]).chaos).toBeUndefined();
    });

    it("tells what one pass through a repeat takes from the body's spend over the guide", () => {
        const span = (a: number, b: number) => ({
            start: { offset: a, line: 1, column: 1 },
            end: { offset: b, line: 1, column: 1 },
        });
        const loop: StepCost = { kind: "until", span: span(0, 100), reached: 1, runs: 2 };
        const steps: StepCost[] = [
            loop,
            {
                kind: "operation",
                span: span(10, 20),
                reached: 1,
                runs: 17.6,
                expected: [{ item: "Deafening Essence of Greed", amount: 17.6 }],
            },
            {
                kind: "operation",
                span: span(30, 40),
                reached: 0.5,
                runs: 4,
                expected: [{ item: "Chaos Orb", amount: 4 }],
            },
            {
                kind: "operation",
                span: span(200, 210),
                reached: 1,
                runs: 1,
                expected: [{ item: "Chaos Orb", amount: 1 }],
            },
        ];
        expect(passSpend(loop, steps)).toEqual([
            { item: "Deafening Essence of Greed", amount: 8.8 },
            { item: "Chaos Orb", amount: 2 },
        ]);
        expect(passIsPartial(loop, steps)).toBe(false);
        // A call inside the repeat that could not be costed makes the spend partial.
        const call: StepCost = {
            kind: "call",
            span: span(50, 60),
            reached: 1,
            runs: 2,
            note: "the steps inside a call are not costed",
        };
        expect(passIsPartial(loop, [...steps, call])).toBe(true);
    });
});

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
