import { describe, expect, it } from "vitest";
import { check, type CheckContext } from "../check/check.js";
import { buildRegistry } from "../resolve/registry.js";
import { craft, has, iff, item, notp, op, orp, until } from "../__fixtures__/ast.js";
import { RING_BASE, TIERED_CATALOG } from "../__fixtures__/mods.js";
import { itemView, renderItemText } from "./item.js";

const registry = buildRegistry({ bases: [RING_BASE], mods: TIERED_CATALOG });
const ctx: CheckContext = { registry };
const ring = (prefixes: readonly (string | { mod: string; tier?: number })[] = []) =>
    item({ base: "IronRing", ilvl: 100, rarity: "rare", prefixes });

/** The text of the item after the craft, which must check clean. */
const after = (c: ReturnType<typeof craft>): string => {
    const r = check(c, ctx);
    expect(r.diagnostics).toEqual([]);
    return renderItemText(itemView(r.finalState!, registry));
};

describe("the item in the game's copy layout", () => {
    it("lays out the header, the level and a pinned modifier with its advanced header", () => {
        expect(after(craft(ring([{ mod: "maximum life", tier: 1 }]), []))).toBe(
            [
                "Item Class: Rings",
                "Rarity: Rare",
                "IronRing",
                "--------",
                "Item Level: 100",
                "--------",
                '{ Prefix Modifier "Virile" (Tier: 1) }',
                "+(115-129) to maximum Life",
            ].join("\n"),
        );
    });

    it("shows a tier range and a roll span when the tier is not known", () => {
        const text = after(craft(ring(), [op("exalt"), until(has("maximum life"), [op("chaos")])]));
        expect(text).toContain("{ Prefix Modifier (Tier: 1-3) }");
        expect(text).toMatch(/\+\(\d+-\d+\) to maximum Life\n/);
    });

    it("groups a disjunction and pins each member's tier", () => {
        const text = after(
            craft(ring(), [
                until(orp(has("maximum life", 1), has("fire resistance", 1)), [op("chaos")]),
            ]),
        );
        expect(text).toContain("{ At least one of these modifiers }");
        expect(text).toContain('    { Prefix Modifier "Virile" (Tier: 1) }');
        expect(text).toContain("    +(115-129) to maximum Life");
        expect(text).toContain('    { Suffix Modifier "of the Salamander" (Tier: 1) }');
    });

    it("writes a single unknown modifier as one coupled line", () => {
        const both = item({
            base: "IronRing",
            ilvl: 100,
            rarity: "rare",
            prefixes: ["random"],
            suffixes: ["random"],
        });
        expect(after(craft(both, [op("annul")]))).toContain(
            "{ 1 more modifier, a prefix or a suffix }",
        );
        expect(after(craft(ring(["random", "random"]), [op("annul")]))).toContain(
            "{ 1 more modifier, a prefix }",
        );
    });

    it("names what is proven absent and the marks, possibly when on some path only", () => {
        const text = after(
            craft(ring(["random"]), [
                iff(notp(has("maximum life")), [op("exalt")]),
                iff(has("maximum life"), [op("vaal")]),
            ]),
        );
        expect(text).toContain("Possibly: Corrupted");
        const absent = after(
            craft(ring(["random"]), [iff(notp(has("maximum life")), [op("scour")])]),
        );
        expect(absent.endsWith("Without: maximum life") || !absent.includes("Without")).toBe(true);
    });
});
