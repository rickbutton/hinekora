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
        const three = `${HEAD}def three(a, b, c) { a b c }\n`;
        const help = (tail: string) => getSignatureHelp(three + tail, three.length + tail.length);
        // Inside the block the cursor belongs to the block's steps, not the call.
        expect(help('three("maximum life", { scour ')).toBeNull();
        const after = help('three("maximum life", { scour alchemy }, ')!;
        expect(after.signatures[0]!.label).toBe("three(a, b, c)");
        expect(after.activeParameter).toBe(2);
    });

    it("follows the innermost call, and the outer one again once it closes", () => {
        const three = `${HEAD}def three(a, b, c) { a b c }\n`;
        const help = (tail: string) => getSignatureHelp(three + tail, three.length + tail.length);
        const inner = help('three("x", roll("y", ')!;
        expect(inner.signatures[0]!.label).toBe("roll(m, step)");
        expect(inner.activeParameter).toBe(1);
        const outer = help('three("x", roll("y", chaos), ')!;
        expect(outer.signatures[0]!.label).toBe("three(a, b, c)");
        expect(outer.activeParameter).toBe(2);
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
