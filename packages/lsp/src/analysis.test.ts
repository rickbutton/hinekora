import { describe, expect, it } from "vitest";
import { loadDefaultPoe1, registryOf } from "@hinekora/data";
import { checkCached, parseCached } from "./analysis.js";

const registry = registryOf(loadDefaultPoe1());
const SRC = `item { base: "Iron Ring" ilvl: 84 rarity: rare }\nchaos`;

describe("the analysis cache", () => {
    it("parses and checks a text once, handing out the same results again", () => {
        expect(parseCached(SRC)).toBe(parseCached(SRC));
        expect(checkCached(SRC, registry)).toBe(checkCached(SRC, registry));
        expect(checkCached(SRC, registry)!.ok).toBe(true);
    });

    it("tells texts and registries apart", () => {
        const other = `${SRC}\nexalt`;
        expect(checkCached(other, registry)).not.toBe(checkCached(SRC, registry));
        const second = registryOf(loadDefaultPoe1());
        expect(checkCached(SRC, second)).not.toBe(checkCached(SRC, registry));
    });

    it("keeps the last sixteen texts and lets the oldest go", () => {
        const texts = Array.from({ length: 17 }, (_, i) => `${SRC}\n# ${i}`);
        const first = parseCached(texts[0]!);
        const firstCheck = checkCached(texts[0]!, registry);
        for (const t of texts.slice(1)) checkCached(t, registry);
        expect(parseCached(texts[16]!)).toBe(parseCached(texts[16]!));
        expect(parseCached(texts[0]!)).not.toBe(first);
        expect(checkCached(texts[0]!, registry)).not.toBe(firstCheck);
    });

    it("has nothing to check for a text that does not parse", () => {
        expect(parseCached("item {").ok).toBe(false);
        expect(checkCached("item {", registry)).toBeUndefined();
    });
});
