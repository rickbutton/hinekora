import { describe, expect, it } from "vitest";
import { check, type CheckContext } from "../check/check.js";
import { buildRegistry } from "../resolve/registry.js";
import {
    bench,
    craft,
    essence,
    has,
    iff,
    item,
    notp,
    op,
    orp,
    unveil,
    until,
} from "../__fixtures__/ast.js";
import {
    BENCH_LIFE_ROW,
    CATALOG,
    CLASS_RING,
    MAXLIFE_T2,
    RING_BASE,
    TIERED_CATALOG,
    VEILED_A,
    VEILED_SUFFIX_MOD,
} from "../__fixtures__/mods.js";
import type { BenchCraft } from "../model/sources.js";
import { itemDelta } from "./walkthrough.js";
import {
    type ItemView,
    itemClassLabel,
    itemView,
    type ModView,
    remainderText,
    renderItemText,
    rollSpan,
} from "./item.js";

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
            "{ 1 additional prefix or suffix modifier }",
        );
        expect(after(craft(ring(["random", "random"]), [op("annul")]))).toContain(
            "{ 1 additional prefix modifier }",
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
            "1-3 additional prefix or suffix modifiers",
        );
        expect(remainderText({ count: [1, 1], where: "suffix" })).toBe(
            "1 additional suffix modifier",
        );
        expect(remainderText({ count: [0, 1], where: "suffix" })).toBe(
            "0-1 additional suffix modifiers",
        );
        expect(remainderText({ count: [0, 2], where: "prefix" }, "–")).toBe(
            "0–2 additional prefix modifiers",
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

    it("heads a bench modifier as master crafted with its rank, not a tier", () => {
        const c = craft(ring(), [bench("maximum life")]);
        const r = check(c, benchCtx);
        expect(r.diagnostics).toEqual([]);
        const text = renderItemText(itemView(r.finalState!, benchRegistry));
        expect(text).toContain(
            "{ Master Crafted Prefix Modifier (Rank: 1) — Life }\n+(15-25) to maximum Life",
        );
        expect(text).not.toContain("(crafted)");
        expect(text).not.toContain("Tier");
    });

    it("heads an unveiled modifier as veiled, with no rank", () => {
        const veiledRegistry = buildRegistry({
            bases: [RING_BASE],
            mods: [...CATALOG, VEILED_SUFFIX_MOD, VEILED_A],
        });
        const veiledRing = item({
            base: "IronRing",
            ilvl: 100,
            rarity: "rare",
            suffixes: ["VeiledSuffix"],
        });
        const r = check(craft(veiledRing, [unveil("veiled double damage")]), {
            registry: veiledRegistry,
        });
        expect(r.diagnostics).toEqual([]);
        const text = renderItemText(itemView(r.finalState!, veiledRegistry));
        expect(text).toContain("{ Veiled Suffix Modifier }\nveiled double damage");
    });

    it("lays out the 3.28 advanced copy's headers and marks", () => {
        const mod = (over: Partial<ModView>): ModView => ({
            gen: "prefix",
            text: "+(115-129) to maximum Life",
            tags: ["Life"],
            fractured: false,
            crafted: false,
            veiled: false,
            ...over,
        });
        const view: ItemView = {
            base: "Iron Gauntlets",
            itemClass: "Gloves",
            ilvl: 84,
            strands: [40, 82],
            rarities: ["rare"],
            implicits: [
                {
                    side: "exarch",
                    tiers: ["Grand"],
                    texts: ["10% increased Attack Speed"],
                    tags: ["Attack", "Speed"],
                    maybe: false,
                },
            ],
            prefixes: [
                {
                    kind: "mod",
                    mod: mod({ name: "Encased", tier: [2, 2], fractured: true, tags: ["Armour"] }),
                },
                {
                    kind: "mod",
                    mod: mod({
                        name: "Prior's",
                        tier: [1, 1],
                        text: "+(11-15) to maximum Energy Shield\n+(24-28) to maximum Life",
                    }),
                },
                { kind: "mod", mod: mod({ name: "Upgraded", crafted: true, rank: 3 }) },
            ],
            suffixes: [{ kind: "mod", mod: mod({ gen: "suffix", veiled: true, tags: [] }) }],
            either: [],
            marks: [
                { kind: "influence", text: "Hunter Item", maybe: false },
                { kind: "eldritch", text: "Searing Exarch Item", maybe: false },
                { kind: "fractured", text: "Fractured Item", maybe: false },
                { kind: "corrupted", text: "Corrupted", maybe: true },
            ],
            without: [],
        };
        expect(renderItemText(view)).toBe(
            [
                "Item Class: Gloves",
                "Rarity: Rare",
                "Iron Gauntlets",
                "--------",
                "Memory Strands: 40-82",
                "--------",
                "Item Level: 84",
                "--------",
                "{ Searing Exarch Implicit Modifier (Grand) — Attack, Speed }",
                "10% increased Attack Speed",
                "--------",
                '{ Fractured Prefix Modifier "Encased" (Tier: 2) — Armour }',
                "+(115-129) to maximum Life",
                '{ Prefix Modifier "Prior\'s" (Tier: 1) — Life }',
                "+(11-15) to maximum Energy Shield",
                "+(24-28) to maximum Life",
                '{ Master Crafted Prefix Modifier "Upgraded" (Rank: 3) — Life }',
                "+(115-129) to maximum Life",
                "{ Veiled Suffix Modifier }",
                "+(115-129) to maximum Life",
                "Searing Exarch Item",
                "--------",
                "Possibly: Corrupted",
                "--------",
                "Hunter Item",
                "--------",
                "Fractured Item",
            ].join("\n"),
        );
        expect(itemDelta({ ...view, suffixes: [] }, view).added).toEqual([
            "+(115-129) to maximum Life (veiled)",
        ]);
    });
});

describe("the tier numbers of an item whose level stops short of the best tier", () => {
    // Life's tiers unlock at levels 60, 30 and 1. The game counts all three at
    // any item level: seen on a level-25 body armour, whose +(18-23)% cold
    // resistance shows "Tier: 6" of the eight the base rolls.
    const low = (prefixes: readonly (string | { mod: string; tier?: number })[] = []) =>
        item({ base: "IronRing", ilvl: 40, rarity: "rare", prefixes });

    it("shows a declared modifier's place on the whole ladder", () => {
        expect(after(craft(low([{ mod: "maximum life", tier: 2 }]), []))).toContain(
            '{ Prefix Modifier "Robust" (Tier: 2) }',
        );
    });

    it("shows the tiers a currency may have rolled as a range of those numbers", () => {
        const rolled = craft(low(), [until(has("maximum life"), [op("chaos")])]);
        expect(after(rolled)).toContain(
            "{ Prefix Modifier (Tier: 2-3) }\n+(10-84) to maximum Life",
        );
    });

    const essenced = buildRegistry({
        bases: [RING_BASE],
        mods: TIERED_CATALOG,
        essences: [
            {
                id: "TestGreed",
                name: "Deafening Essence of Greed",
                tier: 7,
                grants: new Map([[CLASS_RING, MAXLIFE_T2.id]]),
            },
        ],
    });

    it("shows the tier of a modifier an essence placed above the item's level", () => {
        const r = check(
            craft(item({ base: "IronRing", ilvl: 1, rarity: "normal" }), [
                essence("Deafening Essence of Greed"),
            ]),
            { registry: essenced },
        );
        expect(r.diagnostics).toEqual([]);
        expect(renderItemText(itemView(r.finalState!, essenced))).toContain(
            '{ Prefix Modifier "Robust" (Tier: 2) }',
        );
    });
});
