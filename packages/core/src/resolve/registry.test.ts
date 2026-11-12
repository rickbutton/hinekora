import { describe, expect, it } from "vitest";
import { buildRegistry } from "./registry.js";
import { BaseId, ClassId } from "../model/ids.js";
import type { Base } from "../model/base.js";
import { CATALOG, RING_BASE } from "../__fixtures__/mods.js";
import { benchCraft, metamod } from "../check/reference/catalog.js";

describe("a base name two bases share", () => {
    const ring: Base = { ...RING_BASE, name: "Twin" };
    // A divination card: an item class no craft is modelled on.
    const card: Base = {
        ...RING_BASE,
        id: BaseId("TwinCard"),
        name: "Twin",
        itemClass: ClassId("DivinationCard"),
    };

    it("names the one a craft is modelled on, whichever the catalog lists first", () => {
        for (const bases of [
            [card, ring],
            [ring, card],
        ]) {
            const r = buildRegistry({ bases, mods: CATALOG }).resolveBase("Twin");
            expect(r.ok && r.value.id).toBe(ring.id);
        }
    });

    it("is refused where neither is", () => {
        const other: Base = { ...card, id: BaseId("TwinCard2") };
        const r = buildRegistry({ bases: [card, other], mods: CATALOG }).resolveBase("Twin");
        expect(!r.ok && r.error.kind).toBe("uncraftedBase");
    });
});

describe("a bench craft named by its whole wording", () => {
    const one = metamod("onePrefixCannotChange");
    const two = metamod("twoPrefixesCannotChange");
    const registry = buildRegistry({
        bases: [RING_BASE],
        mods: [...CATALOG, one, two],
        benchCrafts: [one, two].map((m) => benchCraft(m, RING_BASE.itemClass)),
    });

    it("is its own craft, though the numbers are not words", () => {
        for (const m of [one, two]) {
            const r = registry.resolveBench(m.text!, RING_BASE.itemClass);
            expect(r.ok && r.value.mod).toBe(m.id);
            const shouted = registry.resolveBench(` ${m.text!.toUpperCase()} `);
            expect(shouted.ok && shouted.value.mod).toBe(m.id);
        }
    });

    it("leaves words short of a whole wording ambiguous", () => {
        const r = registry.resolveBench("prefix modifier cannot", RING_BASE.itemClass);
        expect(!r.ok && r.error.kind).toBe("ambiguous");
    });
});
