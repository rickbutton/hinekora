import { describe, expect, it } from "vitest";
import { FLOW_END, FLOW_START, flowchart, walkthrough } from "@hinekora/core";
import { loadDefaultPoe1, registryOf } from "@hinekora/data";
import { checkCached, parseCached } from "./analysis.js";

const registry = registryOf(loadDefaultPoe1());

const chart = (source: string) => {
    const parsed = parseCached(source);
    if (!parsed.ok) throw new Error(parsed.error.message);
    return flowchart(walkthrough(parsed.craft, checkCached(source, registry)!, registry));
};

const lines = (text: string): string[] => text.split("\n").map((l) => l.trim());

describe("the flowchart", () => {
    it("runs from the start through each step to the end", () => {
        const c = chart(`item { base: "Iron Ring" ilvl: 84 rarity: normal }\ntransmute\nregal`);
        const l = lines(c.text);
        expect(l[0]).toBe("flowchart TD");
        expect(l).toContain('n1["`Orb of Transmutation`"]:::transmute');
        expect(l).toContain('n2["`Regal Orb`"]:::regal');
        expect(l).toContain(`${FLOW_START} --> n1`);
        expect(l).toContain("n1 --> n2");
        expect(l).toContain(`n2 --> ${FLOW_END}`);
        expect([...c.nodes.keys()]).toEqual([FLOW_START, "n1", "n2"]);
        expect(c.nodes.get("n1")!.step!.kind).toBe("operation");
        expect(c.nodes.get(FLOW_START)!.step).toBeUndefined();
    });

    it("draws a loop as a repeat region whose decision leads back to its first step", () => {
        const c = chart(`item { base: "Iron Ring" ilvl: 84 rarity: rare }
until has "maximum life" t1 {
    chaos
    if not has "maximum life" { restart }
}`);
        const l = lines(c.text);
        expect(l).toContain("subgraph n1 [repeat]");
        expect(l).toContain('n3{{"`item has no +#35; to maximum Life?`"}}');
        expect(l).toContain('n5{{"`item has +#35; to maximum Life (T1)?`"}}');
        expect(l).toContain('n5 -- "`no`" --> n2');
        expect(l).toContain(`n5 -- "\`yes\`" --> ${FLOW_END}`);
        // The restart in the branch goes back to the first step too; the
        // branch's "no" falls through to the loop's decision.
        expect(l).toContain("n4 --> n2");
        expect(l).toContain('n3 -- "`no`" --> n5');
        expect(c.nodes.get("n5")!.step!.kind).toBe("loop");
        expect(c.nodes.get("n4")!.step!.kind).toBe("restart");
    });

    it("asks a decision in the player's words, alternatives listed under 'one of'", () => {
        const c = chart(`item { base: "Iron Ring" ilvl: 84 rarity: rare }
if has "fire resistance" t1 or has "cold resistance" t1 { annul } else { exalt }`);
        expect(c.text).toContain(
            '{{"`item has:\none of:\n– +#35;% to Fire Resistance (T1)\n– +#35;% to Cold Resistance (T1)?`"}}',
        );
        const l = lines(c.text);
        expect(l).toContain('n1 -- "`yes`" --> n2');
        expect(l).toContain('n1 -- "`no`" --> n3');
        expect(l).toContain(`n2 --> ${FLOW_END}`);
        expect(l).toContain(`n3 --> ${FLOW_END}`);
    });

    it("keeps each alternative of a choice on one line", () => {
        const c = chart(`item { base: "Iron Ring" ilvl: 84 rarity: rare }
def two() = (has "fire resistance" and has "cold resistance") or (has "fire resistance" and has "lightning resistance")
until two() and prefixCount <= 2 { chaos }`);
        expect(c.text).toContain(
            '{{"`item has:\none of:\n– +#35;% to Fire Resistance and +#35;% to Cold Resistance\n– +#35;% to Fire Resistance and +#35;% to Lightning Resistance\nat most 2 prefixes?`"}}',
        );
    });

    it("folds a disjunction of every pair into 'at least two of'", () => {
        const c = chart(`item { base: "Iron Ring" ilvl: 84 rarity: rare }
def two() = (has "fire resistance" t1 and has "cold resistance" t1)
    or (has "fire resistance" t1 and has "lightning resistance" t1)
    or (has "cold resistance" t1 and has "lightning resistance" t1)
until two() { chaos }`);
        expect(c.text).toContain(
            '{{"`item has:\nat least two of:\n– +#35;% to Fire Resistance (T1)\n– +#35;% to Cold Resistance (T1)\n– +#35;% to Lightning Resistance (T1)?`"}}',
        );
    });

    it("escapes the characters Mermaid would read", () => {
        const c = chart(`item { base: "Iron Ring" ilvl: 84 rarity: rare }\nbench "maximum life"`);
        expect(lines(c.text)).toContain('n1["`bench #quot;maximum life#quot;`"]:::bench');
    });
});
