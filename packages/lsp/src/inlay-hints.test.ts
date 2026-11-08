import { describe, expect, it } from "vitest";
import { InlayHintKind } from "vscode-languageserver-types";
import { getInlayHints } from "./inlay-hints.js";

const SRC = `item { base: "Iron Ring" ilvl: 84 rarity: rare }
def anyEleRes(t) = has "fire resistance" t or has "cold resistance" t
def viaRes(t) = anyEleRes(t)
def roll(m, step, n) { until has m or prefixCount < n { step } }
roll("maximum life", { scour alchemy }, 2)
until viaRes(t1) { chaos }
`;

const lines = SRC.split("\n");
/** Hints as `line:col label` so the expectation reads like the guide. */
const render = (src: string) =>
    getInlayHints(src).map(
        (h) => `${h.position.line}:${h.position.character} ${h.label as string}`,
    );

describe("inlay hints", () => {
    it("names each parameter's sort at the declaration", () => {
        const hints = render(SRC);
        expect(hints).toContain(`1:${lines[1]!.indexOf("t)") + 1} : tier`);
        expect(hints).toContain(`3:${lines[3]!.indexOf("m,") + 1} : mod`);
        expect(hints).toContain(`3:${lines[3]!.indexOf("step,") + 4} : steps`);
        expect(hints).toContain(`3:${lines[3]!.indexOf("n)") + 1} : count`);
    });

    it("gives a parameter that is only forwarded no sort", () => {
        expect(render(SRC).some((h) => h.startsWith("2:"))).toBe(false);
    });

    it("names the parameter each call argument fills, but not a forwarded one of the same name", () => {
        const hints = render(SRC);
        expect(hints).toContain(`4:${lines[4]!.indexOf('"maximum')} m:`);
        expect(hints).toContain(`4:${lines[4]!.indexOf("{ scour")} step:`);
        expect(hints).toContain(`4:${lines[4]!.indexOf(", 2)") + 2} n:`);
        expect(hints).toContain(`5:${lines[5]!.indexOf("t1")} t:`);
        // `anyEleRes(t)` inside viaRes forwards t to t: nothing to say.
        expect(hints.filter((h) => h.startsWith("2:"))).toEqual([]);
    });

    it("marks sorts as type hints and arguments as parameter hints", () => {
        const kinds = new Set(getInlayHints(SRC).map((h) => `${h.label as string}|${h.kind}`));
        expect(kinds.has(`: mod|${InlayHintKind.Type}`)).toBe(true);
        expect(kinds.has(`m:|${InlayHintKind.Parameter}`)).toBe(true);
    });

    it("returns nothing while the guide does not parse", () => {
        expect(getInlayHints(`item {`)).toEqual([]);
    });
});
