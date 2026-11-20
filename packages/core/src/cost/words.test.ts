import { describe, expect, it } from "vitest";
import type { Prices } from "./prices.js";
import type { StepCost } from "./report.js";
import {
    approx,
    costIsObvious,
    figure,
    oddsFigure,
    oddsText,
    percentage,
    priceText,
    spreadText,
} from "./words.js";

describe("the cost report's words", () => {
    it("quotes figures and chances as players do", () => {
        expect(figure(0.25)).toBe("0.25");
        expect(figure(8.8)).toBe("8.8");
        expect(figure(36.84)).toBe("36.8");
        expect(figure(473.26)).toBe("473");
        expect(figure(Infinity)).toBe("∞");
        expect(percentage(0.56)).toBe("56%");
        expect(percentage(0.045)).toBe("4.5%");
        expect(percentage(0.0025)).toBe("0.25%");
        // Short of certain never reads as certain.
        expect(percentage(0.9996)).toBe("99.96%");
        expect(percentage(0.997)).toBe("99.7%");
        expect(percentage(0.999999)).toBe("99.99%");
        expect(percentage(0.994)).toBe("99%");
        expect(percentage(1)).toBe("100%");
        expect(percentage(1 - 1e-14)).toBe("100%");
        // Above none never reads as none.
        expect(percentage(0.00005)).toBe("0.01%");
        expect(percentage(0.0000499)).toBe("0.01%");
        expect(percentage(0.0000001)).toBe("0.01%");
        expect(percentage(0.000149)).toBe("0.01%");
        expect(percentage(0.00016)).toBe("0.02%");
        expect(percentage(0)).toBe("0.00%");
        expect(percentage(1e-14)).toBe("0.00%");
    });

    it("lists a spend, priced in chaos under a snapshot", () => {
        const spend = [
            { item: "Deafening Essence of Greed", amount: 8.8 },
            { item: "Chaos Orb", amount: 2 },
        ];
        expect(priceText(spend)).toBe("8.8 Deafening Essence of Greed, 2 Chaos Orb");
        const snapshot: Prices = {
            league: "Test",
            fetchedAt: "2026-11-09T00:00:00Z",
            chaosPerDivine: 400,
            chaos: new Map([
                ["Deafening Essence of Greed", 2.5],
                ["Chaos Orb", 1],
            ]),
        };
        expect(priceText(spend, snapshot)).toBe(
            "8.8 Deafening Essence of Greed, 2 Chaos Orb (~24 chaos)",
        );
    });

    it("marks an estimate with ~ and words a repeat's odds as players quote them", () => {
        expect(approx(24.9)).toBe("~24.9");
        expect(oddsText(0.114)).toBe("1/9 chance");
        expect(oddsText(1 / 37)).toBe("1/37 chance");
        expect(oddsText(0.6)).toBe("60% chance");
        expect(oddsText(0)).toBe("never ends");
    });

    it("words a spread's ends, and nothing when they print alike", () => {
        expect(spreadText({ low: 36.5, high: 37.3 }, figure)).toBe("36.5 to 37.3");
        expect(spreadText({ low: 111.2, high: 111.4 }, figure)).toBeUndefined();
        expect(spreadText(undefined, figure)).toBeUndefined();
        expect(oddsFigure(1 / 36.5)).toBe("1/36.5");
        expect(oddsFigure(0.62)).toBe("62%");
    });

    it("leaves out the cost of a step that runs once and spends one of one currency", () => {
        const at = {
            start: { offset: 0, line: 1, column: 1 },
            end: { offset: 9, line: 1, column: 10 },
        };
        const once = (amount: number, runs = 1): StepCost => ({
            kind: "operation",
            span: at,
            reached: 1,
            runs,
            unit: [{ item: "Regal Orb", amount }],
            expected: [{ item: "Regal Orb", amount: amount * runs }],
        });
        expect(costIsObvious(once(1))).toBe(true);
        expect(costIsObvious(once(1, 3))).toBe(false);
        expect(costIsObvious(once(50))).toBe(false);
        expect(costIsObvious({ ...once(1), note: "an assumed price" })).toBe(false);
    });
});
