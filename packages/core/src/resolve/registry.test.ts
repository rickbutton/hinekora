import { describe, expect, it } from "vitest";
import { buildRegistry } from "./registry.js";
import { BaseId, ClassId } from "../model/ids.js";
import type { Base } from "../model/base.js";
import { CATALOG, RING_BASE } from "../__fixtures__/mods.js";

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
