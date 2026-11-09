import { describe, expect, it } from "vitest";
import { countdown } from "./countdown.js";

describe("a make-room loop as a chain over the counts", () => {
    it("annuls a full item until a prefix is open", () => {
        // From 3/3 each annul takes a prefix with chance 3/6, then 3/5, 3/4, 1:
        // the loop always exits, after 1 + 1/2 + 1/5 + 1/20 rounds on average.
        const solved = countdown({
            body: [{ kind: "remove" }],
            starts: [{ prefix: 3, suffix: 3, weight: 1 }],
            keepers: { prefix: 0, suffix: 0 },
            exit: (p) => p <= 2,
        })!;
        expect(solved.exit).toBeCloseTo(1, 9);
        expect(solved.restart).toBeCloseTo(0, 9);
        expect(solved.passes).toBeCloseTo(1 + 1 / 2 + 1 / 5 + 1 / 20, 9);
        expect(solved.reached[0]).toBeCloseTo(solved.passes, 9);
    });

    it("a kept modifier caught by a guard restarts the attempt", () => {
        // 2/3 with one kept suffix; exit when a suffix is gone. The first annul
        // takes a suffix with chance 3/5 and the kept one with chance 1/5: the
        // guard fires then, the exit is reached with 2/5 by the first round.
        const solved = countdown({
            body: [{ kind: "remove" }, { kind: "guard", action: "restart" }],
            starts: [{ prefix: 2, suffix: 3, weight: 1 }],
            keepers: { prefix: 0, suffix: 1 },
            exit: (_p, s) => s <= 2,
        })!;
        expect(solved.exit + solved.restart).toBeCloseTo(1, 9);
        expect(solved.fired[1]).toBeCloseTo(solved.restart, 9);
        expect(solved.restart).toBeGreaterThan(0.2);
        expect(solved.exit).toBeGreaterThan(0.5);
    });

    it("a removal limited to one side leaves the other alone", () => {
        const solved = countdown({
            body: [{ kind: "remove", gen: "prefix" }],
            starts: [{ prefix: 3, suffix: 3, weight: 1 }],
            keepers: { prefix: 0, suffix: 0 },
            exit: (p) => p <= 2,
        })!;
        expect(solved.passes).toBeCloseTo(1, 9);
        expect(solved.exit).toBeCloseTo(1, 9);
    });

    it("starts already at the exit take no round", () => {
        const solved = countdown({
            body: [{ kind: "remove" }],
            starts: [
                { prefix: 2, suffix: 3, weight: 3 },
                { prefix: 3, suffix: 3, weight: 1 },
            ],
            keepers: { prefix: 0, suffix: 0 },
            exit: (p) => p <= 2,
        })!;
        expect(solved.passes).toBeCloseTo((1 + 1 / 2 + 1 / 5 + 1 / 20) / 4, 9);
    });

    it("a body that removes nothing is not a countdown", () => {
        expect(
            countdown({
                body: [{ kind: "other" }],
                starts: [{ prefix: 3, suffix: 3, weight: 1 }],
                keepers: { prefix: 0, suffix: 0 },
                exit: () => false,
            }),
        ).toBeUndefined();
    });
});
