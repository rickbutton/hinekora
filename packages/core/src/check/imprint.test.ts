import { describe, expect, it } from "vitest";
import { check, type CheckContext } from "./check.js";
import { guaranteedTypes } from "./astate.js";
import { buildRegistry } from "../resolve/registry.js";
import { beast, craft, has, iff, item, notp, op, restore, until } from "../__fixtures__/ast.js";
import { CATALOG, FIRE_RESIST, LIFE_T1, RING_BASE, TALISMAN_BASE } from "../__fixtures__/mods.js";

const registry = buildRegistry({
    bases: [RING_BASE, TALISMAN_BASE],
    mods: CATALOG,
    modAliases: { "T1 Life": "IncreasedLife1" },
    baseAliases: { "Iron Ring": "IronRing", Talisman: "BlackMawTalisman" },
});
const ctx: CheckContext = { registry };

const magicRing = (prefixes: string[] = [], suffixes: string[] = []) =>
    item({ base: "Iron Ring", ilvl: 100, rarity: "magic", prefixes, suffixes });

describe("imprint and restore", () => {
    it("brings the item back to the imprinted state", () => {
        const c = craft(magicRing(["T1 Life"]), [
            beast({ kind: "imprint" }),
            op("regal"),
            op("exalt"),
            restore(),
        ]);
        const r = check(c, ctx);
        expect(r.diagnostics).toEqual([]);
        const s = r.finalState!;
        expect(s.rarities).toEqual(new Set(["magic"]));
        expect(s.counts.total).toEqual([1, 1]);
        expect(guaranteedTypes(s).has(LIFE_T1.type)).toBe(true);
        expect(s.imprint).toBeUndefined();
    });

    it("restores only an imprint held on every path", () => {
        const none = check(craft(magicRing(["T1 Life"]), [restore()]), ctx);
        expect(none.diagnostics[0]!.message).toContain("No imprint");
        const onePath = craft(magicRing(["T1 Life"]), [
            op("augment"),
            iff(has(FIRE_RESIST.id), [beast({ kind: "imprint" })]),
            restore(),
        ]);
        expect(check(onePath, ctx).diagnostics[0]!.message).toContain("No imprint");
    });

    it("imprints a Magic item or a Rare talisman, never a fractured one", () => {
        const rareRing = item({
            base: "Iron Ring",
            ilvl: 100,
            rarity: "rare",
            prefixes: ["T1 Life"],
        });
        expect(
            check(craft(rareRing, [beast({ kind: "imprint" })]), ctx).diagnostics[0]!.message,
        ).toContain("Magic item or a Rare talisman");
        const talisman = item({
            base: "Talisman",
            ilvl: 100,
            rarity: "rare",
            prefixes: ["T1 Life"],
        });
        expect(check(craft(talisman, [beast({ kind: "imprint" })]), ctx).diagnostics).toEqual([]);
        const fractured = item({
            base: "Iron Ring",
            ilvl: 100,
            rarity: "magic",
            prefixes: [{ mod: "IncreasedLife1", fractured: true }],
        });
        expect(
            check(craft(fractured, [beast({ kind: "imprint" })]), ctx).diagnostics[0]!.message,
        ).toContain("fractured");
    });

    it("cannot be applied to an item fractured since", () => {
        const c = craft(magicRing(["T1 Life"]), [
            beast({ kind: "imprint" }),
            op("regal"),
            op("exalt"),
            op("exalt"),
            op("fracture"),
            restore(),
        ]);
        expect(check(c, ctx).diagnostics[0]!.message).toContain("fractured");
    });

    it("survives a loop: the imprint taken before it is still held after", () => {
        const c = craft(magicRing(["T1 Life"]), [
            beast({ kind: "imprint" }),
            until(has(FIRE_RESIST.id), [op("alteration")]),
            restore(),
        ]);
        const r = check(c, ctx);
        expect(r.diagnostics).toEqual([]);
        expect(guaranteedTypes(r.finalState!).has(LIFE_T1.type)).toBe(true);
    });

    it("converges when the loop body itself imprints", () => {
        // Each round imprints a differently rerolled item; the held imprint is
        // widened with the rest, so the loop settles and the restore applies.
        const c = craft(magicRing(["T1 Life"]), [
            until(has(FIRE_RESIST.id), [op("alteration"), beast({ kind: "imprint" })]),
            restore(),
        ]);
        const r = check(c, ctx);
        expect(r.diagnostics).toEqual([]);
        expect(r.finalState!.rarities).toEqual(new Set(["magic"]));
    });

    it("joins imprints of different rarities into one that may be either", () => {
        // A Magic talisman imprinted on one arm, a Rare one on the other: the
        // restore brings back an item that is Magic or Rare, so a regal after
        // it is refused until the rarity is narrowed.
        const talisman = item({
            base: "Talisman",
            ilvl: 100,
            rarity: "magic",
            prefixes: ["T1 Life"],
        });
        const c = craft(talisman, [
            op("augment"),
            iff(
                has(FIRE_RESIST.id),
                [beast({ kind: "imprint" })],
                [op("regal"), beast({ kind: "imprint" })],
            ),
            restore(),
            op("regal"),
        ]);
        const r = check(c, ctx);
        expect(r.diagnostics[0]!.message).toContain("may be Magic or Rare");
        const restored = r.trace.find(
            (e) => e.kind === "operation" && e.after?.rarities.size === 2,
        )!;
        expect(restored.after!.rarities).toEqual(new Set(["magic", "rare"]));
    });

    it("joins the imprints of two branches that both hold one, and drops it when one lacks it", () => {
        const both = craft(magicRing(["T1 Life"]), [
            op("augment"),
            iff(
                has(FIRE_RESIST.id),
                [beast({ kind: "imprint" })],
                [op("alteration"), beast({ kind: "imprint" })],
            ),
            op("regal"),
            restore(),
        ]);
        const r = check(both, ctx);
        expect(r.diagnostics).toEqual([]);
        expect(r.finalState!.rarities).toEqual(new Set(["magic"]));
        // The alteration branch rerolled the life, so it is no longer guaranteed.
        expect(guaranteedTypes(r.finalState!).has(LIFE_T1.type)).toBe(false);
        const one = craft(magicRing(["T1 Life"]), [
            beast({ kind: "imprint" }),
            iff(notp(has(FIRE_RESIST.id)), [op("regal"), op("scour")]),
            restore(),
        ]);
        expect(check(one, ctx).diagnostics).toEqual([]);
    });
});
