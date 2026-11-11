import { describe, expect, it } from "vitest";
import { resolveMessage } from "./diagnostics.js";

describe("a name that does not resolve, in words", () => {
    it("names the tiers a known craft has, for a tier it lacks", () => {
        expect(
            resolveMessage({ kind: "noSuchTier", name: "greed", tier: 8, best: 1, worst: 7 }),
        ).toBe('"greed" has no tier 8 — it has t1 to t7.');
        expect(
            resolveMessage({ kind: "noSuchTier", name: "delirium", tier: 2, best: 1, worst: 1 }),
        ).toBe('"delirium" has no tier 2 — it has the one tier, t1.');
    });

    it("keeps a hybrid modifier's two lines on the message's one", () => {
        expect(
            resolveMessage({
                kind: "ambiguous",
                name: "armour",
                candidates: ["+(3-10) to Armour", "(15-26)% increased Armour\n+(6-7)% to Stun"],
            }),
        ).toBe(
            'Ambiguous name "armour" — candidates: +(3-10) to Armour, (15-26)% increased Armour / +(6-7)% to Stun.',
        );
    });
});
