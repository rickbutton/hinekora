import { describe, expect, it } from "vitest";
import { getSignatureHelp } from "./signature-help.js";

const HEAD = `item { base: "Iron Ring" ilvl: 84 rarity: rare }
def roll(m, step) { until has m { step } }
def anyEleRes(t) = has "fire resistance" t or has "cold resistance" t
`;

/** Signature help with the cursor at the end of `HEAD + tail`. */
const at = (tail: string) => getSignatureHelp(HEAD + tail, HEAD.length + tail.length);

describe("signature help — def calls", () => {
    it("shows the def's parameters and tracks the argument being typed", () => {
        const first = at("roll(")!;
        expect(first.signatures[0]!.label).toBe("roll(m, step)");
        expect(first.signatures[0]!.documentation).toBe("local operation function");
        expect(first.activeParameter).toBe(0);
        expect(at('roll("maximum life", ')!.activeParameter).toBe(1);
    });

    it("follows an unfinished mod name and a predicate call", () => {
        expect(at('roll("maxi')!.activeParameter).toBe(0);
        const pred = at("until anyEleRes(")!;
        expect(pred.signatures[0]!.label).toBe("anyEleRes(t)");
        expect(pred.signatures[0]!.documentation).toBe("local predicate");
    });

    it("stays on the last parameter past the arity, and stops after the call closes", () => {
        expect(at('roll("a", chaos, ')!.activeParameter).toBe(1);
        expect(at('roll("maximum life", chaos) ')).toBeNull();
    });

    it("returns to the call after a block argument's braces", () => {
        // Inside the block the cursor belongs to the block's steps, not the call.
        expect(at('roll("maximum life", { scour ')).toBeNull();
        expect(at('roll("maximum life", { scour alchemy }, ')!.activeParameter).toBe(1);
    });

    it("knows nothing about a call to an undefined name", () => {
        expect(at("nope(")).toBeNull();
    });
});

describe("signature help — method slots", () => {
    it("shows a method's slots with the one being filled marked", () => {
        const first = at("essence ")!;
        expect(first.signatures[0]!.label).toBe('essence "essence" [t<n>]');
        expect(first.activeParameter).toBe(0);
        expect(at('essence "Deafening Essence of Greed" ')!.activeParameter).toBe(1);
    });

    it("keeps a repeated names slot active for every further name", () => {
        expect(at('fossil "pristine" "hollow" ')!.activeParameter).toBe(0);
    });

    it("names a two-word method's slots and offers nothing for a method without any", () => {
        const h = at("harvest change ")!;
        expect(h.signatures[0]!.label).toBe('harvest change "mod" "mod"');
        expect(at("chaos ")).toBeNull();
        expect(at('essence "Deafening Essence of Greed" t1 ')).toBeNull();
    });
});
