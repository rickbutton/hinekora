import { describe, expect, it } from "vitest";
import { check, type CheckContext } from "../check/check.js";
import { buildRegistry } from "../resolve/registry.js";
import { bench, craft, has, iff, item, notp, op, orp, until } from "../__fixtures__/ast.js";
import {
    BENCH_LIFE_ROW,
    CATALOG,
    CLASS_RING,
    RING_BASE,
    TIERED_CATALOG,
} from "../__fixtures__/mods.js";
import type { BenchCraft } from "../model/sources.js";
import { itemClassLabel, itemView, remainderText, renderItemText, rollSpan } from "./item.js";

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

    it("marks a corruption on some path only as possible", () => {
        const text = after(
            craft(ring(["random"]), [
                iff(notp(has("maximum life")), [op("exalt")]),
                iff(has("maximum life"), [op("vaal")]),
            ]),
        );
        expect(text).toContain("--------\nPossibly: Corrupted");
    });

    it("names what is proven absent", () => {
        // Inside the branch the life modifier is ruled out; the text of the
        // state there is what hover shows on the step.
        const c = craft(ring(["random"]), [iff(notp(has("maximum life")), [op("exalt")])]);
        const r = check(c, ctx);
        expect(r.diagnostics).toEqual([]);
        const inBranch = r.trace.find((e) => e.kind === "operation")!;
        expect(renderItemText(itemView(inBranch.before, registry))).toMatch(
            /--------\nWithout: maximum life$/,
        );
    });

    it("writes the class as the game does", () => {
        expect(itemClassLabel("Ring")).toBe("Rings");
        expect(itemClassLabel("Body Armour")).toBe("Body Armours");
        expect(itemClassLabel("Staff")).toBe("Staves");
        expect(itemClassLabel("Boots")).toBe("Boots");
        expect(itemClassLabel("AbyssJewel")).toBe("Abyss Jewels");
        expect(itemClassLabel("UtilityFlask")).toBe("Utility Flasks");
        expect(itemClassLabel("Thrusting One Hand Sword")).toBe("Thrusting One Hand Swords");
    });

    it("merges roll ranges across tiers, or keeps the first text when they differ in shape", () => {
        expect(rollSpan(["+(70-84) to maximum Life", "+(20-29) to maximum Life"])).toBe(
            "+(20-84) to maximum Life",
        );
        expect(rollSpan(["Adds (1-2) to (3-4) Damage", "+(5-6) Damage"])).toBe(
            "Adds (1-2) to (3-4) Damage",
        );
        expect(rollSpan(["one text"])).toBe("one text");
    });

    it("words the unknown modifiers and a group header", () => {
        expect(remainderText({ count: [1, 3], where: "either" })).toBe(
            "1-3 more modifiers, prefixes and/or suffixes",
        );
        expect(remainderText({ count: [1, 1], where: "suffix" })).toBe("1 more modifier, a suffix");
        expect(remainderText({ count: [0, 2], where: "prefix" }, "–")).toBe(
            "0–2 more modifiers, prefixes",
        );
    });
});

describe("the marks and the crafted flag", () => {
    const BENCH_LIFE: BenchCraft = {
        mod: BENCH_LIFE_ROW.id,
        tier: 1,
        itemClasses: new Set([CLASS_RING]),
    };
    const benchRegistry = buildRegistry({
        bases: [RING_BASE],
        mods: [...CATALOG, BENCH_LIFE_ROW],
        benchCrafts: [BENCH_LIFE],
    });
    const benchCtx: CheckContext = { registry: benchRegistry };

    it("flags a bench modifier as crafted, with no tier since it does not roll", () => {
        const c = craft(ring(), [bench("maximum life")]);
        const r = check(c, benchCtx);
        expect(r.diagnostics).toEqual([]);
        const text = renderItemText(itemView(r.finalState!, benchRegistry));
        expect(text).toMatch(/\{ Prefix Modifier[^\n]*\}\n[^\n]* \(crafted\)(\n|$)/);
        expect(text).not.toMatch(/Prefix Modifier[^\n]*Tier/);
    });
});
