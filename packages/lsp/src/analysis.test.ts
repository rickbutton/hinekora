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

    it("has nothing to check for a text that does not parse", () => {
        expect(parseCached("item {").ok).toBe(false);
        expect(checkCached("item {", registry)).toBeUndefined();
    });
});
