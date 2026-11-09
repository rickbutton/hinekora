import { describe, expect, it } from "vitest";
import type { Prices } from "./prices.js";
import { figure, percentage, priceText } from "./words.js";

describe("the cost report's words", () => {
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
            "8.8 Deafening Essence of Greed, 2 Chaos Orb (about 24 chaos)",
        );
    });
});
