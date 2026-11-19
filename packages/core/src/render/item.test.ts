import { describe, expect, it } from "vitest";
import type { CheckContext } from "../check/check.js";
import { check } from "../check/check.js";
import { buildRegistry } from "../resolve/registry.js";
import {
    bench,
    craft,
    essence,
    has,
    hasValue,
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
    BOOTS_BASE,
    CATALOG,
    CLASS_RING,
    ELDRITCH_ROWS,
    FILLERS,
    MAXLIFE_T2,
    RING_BASE,
    SUPPORTED_SPEED,
    SUPPORTED_SPEED_LOW,
    TIERED_CATALOG,
    VEILED_A,
    VEILED_SUFFIX_MOD,
    CORRUPTION_ROWS,
} from "../__fixtures__/mods.js";
import type { Base } from "../model/base.js";
import type { Mod } from "../model/index.js";
import { BaseId, GroupId, ModId, TagId, TypeId } from "../model/ids.js";
import type { BenchCraft, ImplicitSpec } from "../model/sources.js";
import { generateCatalog } from "../check/reference/catalog.js";
import { countOutside, guaranteedTypes } from "../check/views.js";
import { itemDelta } from "./walkthrough.js";
import {
    type ItemView,
    itemClassLabel,
    IMPLICIT_LIST_LIMIT,
    itemView,
    type ModView,
    remainderText,
    renderItemText,
    rollSpan,
    UNNAMED_IMPLICIT,
} from "./item.js";

// More types than the tiered life and fire resistance alone, which a Rare ring
// would always carry both of.
const registry = buildRegistry({ bases: [RING_BASE], mods: [...TIERED_CATALOG, ...FILLERS] });
/** The names the game shows for the fixtures' tags: "resource" has none. */
const TAG_NAMES = { life: "Life", attack: "Attack", speed: "Speed", armour: "Armour" };
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

    it("marks a corruption on some of the items only as possible", () => {
        const text = after(
            craft(ring(["random"]), [
                iff(notp(has("maximum life")), [op("exalt")]),
                iff(has("maximum life"), [op("vaal")]),
            ]),
        );
        expect(text).toContain("--------\nPossibly: Corrupted");
    });

    it("shows a second corruption as Twice Corrupted", () => {
        const corrupted = item({
            base: "IronRing",
            ilvl: 100,
            rarity: "rare",
            prefixes: ["random"],
            corrupted: true,
        });
        expect(after(craft(corrupted, [op("locus")]))).toMatch(/--------\nTwice Corrupted$/);
        const some = craft(corrupted, [iff(has("maximum life"), [op("locus")])]);
        expect(after(some)).toContain("Possibly: Corrupted, or Twice Corrupted");
    });

    it("names what is proven absent", () => {
        // Inside the branch the life modifier is ruled out; the text of the
        // state there is what hover shows on the step.
        const c = craft(ring(["random"]), [iff(notp(has("maximum life")), [op("exalt")])]);
        const r = check(c, ctx);
        expect(r.diagnostics).toEqual([]);
        const inBranch = r.trace.find((e) => e.kind === "operation")!;
        expect(renderItemText(itemView(inBranch.before, registry, c))).toMatch(
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

    it("merges roll ranges across tiers, each wording apart", () => {
        expect(rollSpan(["+(70-84) to maximum Life", "+(20-29) to maximum Life"])).toBe(
            "+(20-84) to maximum Life",
        );
        // Wordings that differ in words are spanned apart, never one for both.
        expect(rollSpan(["Adds (1-2) to (3-4) Damage", "+(5-6) Damage"])).toBe(
            "Adds (1-2) to (3-4) Damage\nor\n+(5-6) Damage",
        );
        expect(
            rollSpan([
                "Projectiles Pierce 2 additional Targets",
                "Projectiles Pierce an additional Target",
                "Projectiles Pierce 3 additional Targets",
            ]),
        ).toBe(
            "Projectiles Pierce (2-3) additional Targets\nor\nProjectiles Pierce an additional Target",
        );
        expect(rollSpan(["one text"])).toBe("one text");
    });

    it("reads a fixed number as a span of one value across tiers", () => {
        expect(rollSpan(["35% increased Movement Speed", "10% increased Movement Speed"])).toBe(
            "(10-35)% increased Movement Speed",
        );
        expect(
            rollSpan(["Adds (17-22) to (34-40) Fire Damage", "Adds 3 to (6-7) Fire Damage"]),
        ).toBe("Adds (3-22) to (6-40) Fire Damage");
        expect(rollSpan(["(30-27)% reduced Cost", "(26-20)% reduced Cost"])).toBe(
            "(20-30)% reduced Cost",
        );
        expect(rollSpan(["10% increased Speed", "10% increased Speed"])).toBe(
            "10% increased Speed",
        );
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
        tagNames: TAG_NAMES,
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

    it("heads a modifier crafted on some items only as possibly crafted, over every row", () => {
        // Benched where the ring has no life, rolled where it has.
        const c = craft(ring(["random"]), [
            iff(notp(has("maximum life")), [bench("maximum life")]),
        ]);
        const r = check(c, benchCtx);
        expect(r.diagnostics).toEqual([]);
        const text = renderItemText(itemView(r.finalState!, benchRegistry, c));
        expect(text).toContain("{ Possibly Master Crafted Prefix Modifier (Tier: 1-2) — Life }");
        expect(text).toContain("+(15-84) to maximum Life");
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
                    kind: "exarch",
                    tiers: ["Grand"],
                    texts: ["10% increased Attack Speed"],
                    count: 1,
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

describe("a value a condition learnt, on a modifier that grants a support", () => {
    const reached = (rows: readonly Mod[]) => {
        const hybrids = buildRegistry({ bases: [RING_BASE], mods: rows });
        const r = check(craft(ring(), [until(hasValue("attack speed", ">=", 12), [op("chaos")])]), {
            registry: hybrids,
        });
        expect(r.diagnostics).toEqual([]);
        return renderItemText(itemView(r.finalState!, hybrids));
    };

    it("narrows the modifier's own roll, past the support's line", () => {
        expect(reached(SUPPORTED_SPEED)).toContain(
            "Socketed Gems are Supported by Level (18-20) Faster Attacks Support\n" +
                "(12-14)% increased Attack Speed",
        );
    });

    it("leaves the support's level where its span overlaps the value's", () => {
        expect(reached(SUPPORTED_SPEED_LOW)).toContain(
            "Socketed Gems are Supported by Level (12-13) Faster Attacks Support\n" +
                "(12-14)% increased Attack Speed",
        );
    });
});

describe("what the craft names", () => {
    const fill = (n: number) => has(`Fillerprefix${n}`);

    it("shows a group the craft waits for, however many modifiers it holds", () => {
        const c = craft(ring(), [
            until(orp(fill(1), orp(fill(2), orp(fill(3), fill(4)))), [op("chaos")]),
        ]);
        const r = check(c, ctx);
        expect(r.diagnostics).toEqual([]);
        const named = renderItemText(itemView(r.finalState!, registry, c));
        expect(named).toContain("{ At least one of these prefix modifiers }");
        for (const n of [1, 2, 3, 4]) expect(named).toContain(`    ${n}% filler prefix`);
        // Without the craft, a group of four is past what the items are searched for.
        expect(renderItemText(itemView(r.finalState!, registry))).not.toContain("one of these");
    });

    it("lists no modifier as absent from an item that has none", () => {
        const c = craft(item({ base: "IronRing", ilvl: 100, rarity: "normal" }), [
            iff(has("maximum life"), [op("scour")]),
        ]);
        const r = check(c, ctx);
        expect(itemView(r.trace[0]!.before, registry, c).without).toEqual([]);
    });
});

describe("the lines of an item", () => {
    it("give the count in all where a group holds at least, not exactly, its number", () => {
        const c = craft(ring(), [
            until(orp(has("Fillerprefix1"), orp(has("Fillersuffix1"), has("Fillersuffix2"))), [
                op("chaos"),
            ]),
        ]);
        const r = check(c, ctx);
        const v = itemView(r.finalState!, registry, c);
        const text = renderItemText(v);
        expect(text).toContain("{ At least one of these modifiers }");
        expect(text).toContain("{ 4-6 modifiers in all }");
        // A group that holds exactly its number leaves the count to the lines.
        const one = check(craft(ring(), [op("chaos")]), ctx).finalState!;
        expect(itemView(one, registry).total).toBeUndefined();
    });

    it("go in the order the item block declares, then by wording", () => {
        const c = craft(
            item({
                base: "IronRing",
                ilvl: 100,
                rarity: "rare",
                prefixes: ["Fillerprefix3", "Fillerprefix1"],
                suffixes: ["Fillersuffix2", "fire resistance"],
            }),
            [],
        );
        const v = itemView(check(c, ctx).finalState!, registry, c);
        expect(v.prefixes.map((g) => (g.kind === "mod" ? g.mod.text : ""))).toEqual([
            "3% filler prefix",
            "1% filler prefix",
        ]);
        expect(v.suffixes.map((g) => (g.kind === "mod" ? g.mod.text : ""))).toEqual([
            "2% filler suffix",
            "+(6-11)% to Fire Resistance",
        ]);
        // Every modifier is named: none is listed as missing.
        expect(v.without).toEqual([]);
    });
});

describe("an eldritch implicit the game data has no wording for", () => {
    const boots = buildRegistry({ bases: [BOOTS_BASE], mods: CATALOG, eldritch: ELDRITCH_ROWS });

    it("is one of the wordings beside those it names", () => {
        // The catalogue has no Lesser Exarch implicit; an ember of Greater has one.
        const ember = {
            ...op("ember"),
            args: [{ kind: "word" as const, value: "greater", span: op("ember").span }],
        };
        const c = craft(
            item({
                base: "Iron Greaves",
                ilvl: 100,
                rarity: "rare",
                prefixes: ["random"],
                exarch: "lesser",
            }),
            [iff(has("IncreasedLife1"), [ember])],
        );
        const r = check(c, { registry: boots });
        expect(r.diagnostics).toEqual([]);
        const [implicit] = itemView(r.finalState!, boots, c).implicits;
        expect(implicit!.texts).toEqual(["8% increased Movement Speed", UNNAMED_IMPLICIT]);
        expect(implicit!.tiers).toEqual(["Lesser", "Greater"]);
    });
});

describe("the base's own implicit", () => {
    const implicit = (id: string, text: string, tags: string[] = []): ImplicitSpec => ({
        id: ModId(id),
        type: TypeId(id),
        groups: new Set([GroupId(id)]),
        implicitTags: new Set(tags.map(TagId)),
        text,
    });
    const LIFE = implicit("RingLife", "(5-7)% increased maximum Life", ["resource", "life"]);
    const FIRE = implicit("RingFireCold", "+(12-16)% to Fire and Cold Resistances");
    const COLD = implicit("RingColdLight", "+(12-16)% to Cold and Lightning Resistances");
    const BLANK = implicit("RingBlank", "");
    const ringOf = (id: string, own: readonly ImplicitSpec[]): Base => ({
        ...RING_BASE,
        id: BaseId(id),
        name: "Test Ring",
        ...(own.length > 0 && { implicits: own.map((i) => i.id) }),
    });
    /** The item text of a Normal Test Ring after the steps, the catalogue's
     *  bases all named alike: named by its id where it is one, else by the name. */
    const textOf = (
        bases: readonly Base[],
        steps: Parameters<typeof craft>[1] = [],
        corrupted = false,
    ) => {
        const reg = buildRegistry({
            bases: [...bases],
            mods: [...TIERED_CATALOG, ...FILLERS],
            implicits: [LIFE, FIRE, COLD, BLANK],
            corruption: CORRUPTION_ROWS,
            tagNames: TAG_NAMES,
        });
        const base = bases.length > 1 ? "Test Ring" : bases[0]!.id;
        const c = craft(item({ base, ilvl: 84, rarity: "normal", corrupted }), steps);
        const r = check(c, { registry: reg });
        expect(r.diagnostics).toEqual([]);
        const v = itemView(r.finalState!, reg, c);
        return { v, text: renderItemText(v) };
    };
    const implicitSection = (text: string): string => text.split("\n--------\n")[2] ?? "";

    it("is shown with its wording and tags and no tier, where every item holds it", () => {
        const { v, text } = textOf([ringOf("LifeRing", [LIFE])]);
        // "resource" has no name in the game, so the tooltip leaves it out.
        expect(implicitSection(text)).toBe(
            ["{ Implicit Modifier — Life }", "(5-7)% increased maximum Life"].join("\n"),
        );
        expect(v.implicits).toEqual([
            {
                kind: "base",
                tiers: [],
                texts: ["(5-7)% increased maximum Life"],
                count: 1,
                tags: ["Life"],
                maybe: false,
            },
        ]);
    });

    it("is possible after a Vaal Orb, which may take it", () => {
        const { v, text } = textOf([ringOf("LifeRing", [LIFE])], [op("vaal")]);
        expect(v.implicits.map((i) => [i.kind, i.maybe])).toEqual([
            ["base", true],
            ["corruption", true],
        ]);
        expect(text).toContain("{ Possibly: Implicit Modifier — Life }");
    });

    it("is one of a name's variants, without their tags", () => {
        const { text } = textOf([ringOf("FireRing", [FIRE]), ringOf("ColdRing", [COLD])]);
        expect(implicitSection(text)).toBe(
            [
                "{ Implicit Modifier }",
                "one of 2:",
                "    +(12-16)% to Fire and Cold Resistances",
                "    +(12-16)% to Cold and Lightning Resistances",
            ].join("\n"),
        );
    });

    it("is possible where a name's variants differ by having one", () => {
        const { v } = textOf([ringOf("LifeRing", [LIFE]), ringOf("BareRing", [])]);
        expect(v.implicits).toHaveLength(1);
        expect(v.implicits[0]!.maybe).toBe(true);
        expect(v.implicits[0]!.texts).toEqual(["(5-7)% increased maximum Life"]);
    });

    it("is not shown on a base made with none", () => {
        const { v, text } = textOf([ringOf("BareRing", [])]);
        expect(v.implicits).toEqual([]);
        expect(text).not.toContain("Implicit");
    });

    it("with no wording in the game data reads as such, not as an empty line", () => {
        const { text } = textOf([ringOf("BlankRing", [BLANK])]);
        expect(implicitSection(text)).toBe(["{ Implicit Modifier }", UNNAMED_IMPLICIT].join("\n"));
    });

    it("is a line an ember takes away", () => {
        const greaves: Base = { ...BOOTS_BASE, implicits: [LIFE.id] };
        const reg = buildRegistry({
            bases: [greaves],
            mods: CATALOG,
            eldritch: ELDRITCH_ROWS,
            implicits: [LIFE],
        });
        const ember = {
            ...op("ember"),
            args: [{ kind: "word" as const, value: "greater", span: op("ember").span }],
        };
        const view = (steps: Parameters<typeof craft>[1]) => {
            const c = craft(item({ base: "Iron Greaves", ilvl: 100, rarity: "rare" }), steps);
            const r = check(c, { registry: reg });
            expect(r.diagnostics).toEqual([]);
            return itemView(r.finalState!, reg, c);
        };
        const delta = itemDelta(view([]), view([ember]));
        expect(delta.removed).toEqual(["Base implicit"]);
        expect(delta.added).toEqual(["Greater Exarch implicit", "Searing Exarch Item"]);
    });

    describe("in what a step changes", () => {
        const lifeRing = [ringOf("LifeRing", [LIFE])];
        const deltaOf = (steps: Parameters<typeof craft>[1], corrupted = false) =>
            itemDelta(textOf(lifeRing, [], corrupted).v, textOf(lifeRing, steps, corrupted).v);

        it("is possibly gone after a Vaal Orb", () => {
            const delta = deltaOf([op("vaal")]);
            expect(delta.removed).toEqual(["Base implicit"]);
            expect(delta.added).toContain("possibly Base implicit");
        });

        it("is possibly gone after the Corruption Altar", () => {
            const delta = deltaOf([op("locus")], true);
            expect(delta.removed).toContain("Base implicit");
            expect(delta.added).toContain("possibly Base implicit");
        });

        it("is not mentioned by a Chaos Orb, which leaves it", () => {
            const delta = deltaOf([op("alchemy"), op("chaos")]);
            expect(
                [...delta.added, ...delta.removed].filter((l) => l.includes("implicit")),
            ).toEqual([]);
        });
    });
});

describe("the corruption implicits", () => {
    // The fixture's ring pool: two Movement Speed rows of one wording each,
    // at item levels 1 and 30, and the Endurance Charge at 75.
    const reg = buildRegistry({ bases: [RING_BASE], mods: CATALOG, corruption: CORRUPTION_ROWS });
    const viewOf = (
        steps: Parameters<typeof craft>[1],
        decl: Partial<Parameters<typeof item>[0]> & { implicits?: string[] } = {},
    ) => {
        const { implicits, ...rest } = decl;
        const c = craft(
            {
                ...item({ base: "IronRing", ilvl: 84, rarity: "rare", ...rest }),
                ...(implicits !== undefined && { implicits }),
            },
            steps,
        );
        const r = check(c, { registry: reg });
        expect(r.diagnostics).toEqual([]);
        const v = itemView(r.finalState!, reg, c);
        return { v, text: renderItemText(v) };
    };
    const section = (text: string): string => text.split("\n--------\n")[2] ?? "";

    it("are not shown on an item no corruption touched", () => {
        expect(viewOf([op("chaos")]).v.implicits).toEqual([]);
        expect(viewOf([], { corrupted: true }).v.implicits).toEqual([]);
    });

    it("show one held on every item plainly, its rows of one wording one line", () => {
        const { v, text } = viewOf([], { corrupted: true, implicits: ["endurance"] });
        expect(v.implicits).toEqual([
            {
                kind: "corruption",
                tiers: [],
                texts: ["+1 to Maximum Endurance Charges"],
                count: 1,
                tags: [],
                maybe: false,
            },
        ]);
        expect(section(text)).toBe(
            ["{ Corruption Implicit Modifier }", "+1 to Maximum Endurance Charges"].join("\n"),
        );
    });

    it("show the tags the game names, and no dash where it names none", () => {
        const tagged = (row: (typeof CORRUPTION_ROWS)[number], tags: string[]) => ({
            ...row,
            implicitTags: new Set(tags.map(TagId)),
        });
        const named = buildRegistry({
            bases: [RING_BASE],
            mods: CATALOG,
            corruption: [
                tagged(CORRUPTION_ROWS[0]!, ["speed"]),
                { ...tagged(CORRUPTION_ROWS[1]!, ["speed"]), text: CORRUPTION_ROWS[0]!.text },
                tagged(CORRUPTION_ROWS[2]!, ["endurance_charge"]),
            ],
            tagNames: { speed: "Speed" },
        });
        const headerOf = (implicit: string): string => {
            const c = craft(
                {
                    ...item({ base: "IronRing", ilvl: 84, rarity: "rare", corrupted: true }),
                    implicits: [implicit],
                },
                [],
            );
            const r = check(c, { registry: named });
            expect(r.diagnostics).toEqual([]);
            return section(renderItemText(itemView(r.finalState!, named, c))).split("\n")[0]!;
        };
        expect(headerOf("endurance")).toBe("{ Corruption Implicit Modifier }");
        expect(headerOf("movement speed")).toBe("{ Corruption Implicit Modifier — Speed }");
    });

    it("show one a Vaal Orb may add as possible, one of the pool's wordings", () => {
        const { v, text } = viewOf([op("vaal")]);
        expect(v.implicits.map((i) => [i.kind, i.maybe, i.count])).toEqual([
            ["corruption", true, 3],
        ]);
        expect(section(text)).toBe(
            [
                "{ Possibly: Corruption Implicit Modifier }",
                "one of 3:",
                "    5% increased Movement Speed",
                "    10% increased Movement Speed",
                "    +1 to Maximum Endurance Charges",
            ].join("\n"),
        );
    });

    it("show a held one beside a second the Corruption Altar may add", () => {
        const { v } = viewOf([op("locus")], { corrupted: true, implicits: ["endurance"] });
        expect(v.implicits.map((i) => [i.texts, i.maybe])).toEqual([
            [["+1 to Maximum Endurance Charges"], false],
            [["5% increased Movement Speed", "10% increased Movement Speed"], true],
        ]);
    });

    it("read as a count past the list's limit", () => {
        const many = Array.from({ length: IMPLICIT_LIST_LIMIT + 1 }, (_, i) => ({
            ...CORRUPTION_ROWS[0]!,
            id: ModId(`Many${i}`),
            type: TypeId(`Many${i}`),
            groups: new Set([GroupId(`Many${i}`)]),
            text: `+${i + 1} to Many`,
        }));
        const big = buildRegistry({ bases: [RING_BASE], mods: CATALOG, corruption: many });
        const c = craft(item({ base: "IronRing", ilvl: 84, rarity: "rare" }), [op("vaal")]);
        const r = check(c, { registry: big });
        const text = renderItemText(itemView(r.finalState!, big, c));
        expect(text).toContain(`one of ${IMPLICIT_LIST_LIMIT + 1} Corruption implicits`);
    });

    it("are a line a Vaal Orb may add, in what a step changes", () => {
        const delta = itemDelta(viewOf([]).v, viewOf([op("vaal")]).v);
        expect(delta.added).toContain("possibly Corruption implicit");
        const altar = itemDelta(
            viewOf([], { corrupted: true, implicits: ["endurance"] }).v,
            viewOf([op("locus")], { corrupted: true, implicits: ["endurance"] }).v,
        );
        expect(altar.added).toEqual(["possibly Corruption implicit", "Twice Corrupted"]);
        expect(altar.removed).toEqual(["Corrupted"]);
    });
});

describe("the modifiers listed as missing, on generated catalogues", () => {
    it("name a `has group` once, by its own modifier's wording, and never an id", () => {
        let seen = 0;
        for (let seed = 7100; seed < 7112; seed++) {
            const cat = generateCatalog(seed, { types: 5, sharedFamily: true });
            const natural = cat.mods.filter((m) => (m.source ?? "natural") === "natural");
            const named = natural.find((m) =>
                natural.some(
                    (o) => o.type !== m.type && [...o.families].some((f) => m.families.has(f)),
                ),
            );
            if (named === undefined) continue;
            const group = { ...has(named.id), group: true as const };
            const c = craft(
                item({
                    base: cat.base.id,
                    ilvl: cat.ilvl,
                    rarity: "rare",
                    prefixes: ["random"],
                    suffixes: ["random"],
                }),
                [iff(notp(group), [op("exalt")])],
            );
            const r = check(c, { registry: cat.registry });
            const inside = r.trace.find((e) => e.kind === "operation")?.before;
            if (inside === undefined) continue;
            const v = itemView(inside, cat.registry, c);
            const ids = new Set(cat.mods.flatMap((m) => [m.id, m.type]));
            const label = cat.registry.typeLabel(named.type);
            for (const w of v.without) expect(ids.has(w as never), w).toBe(false);
            expect(new Set(v.without).size).toBe(v.without.length);
            const siblings = natural.filter(
                (o) => o.type !== named.type && [...o.families].some((f) => named.families.has(f)),
            );
            for (const o of siblings) {
                const l = cat.registry.typeLabel(o.type);
                if (l !== label) expect(v.without).not.toContain(l);
            }
            // An item whose modifiers are all known lists none as missing.
            const known = countOutside(inside, guaranteedTypes(inside))[1] === 0;
            if (known) expect(v.without).toEqual([]);
            else if (label !== named.type) {
                expect(
                    v.without.filter((w) => w === label),
                    `${seed} ${String(v.without)}`,
                ).toHaveLength(1);
                seen++;
            }
        }
        expect(seen).toBeGreaterThan(0);
    });
});
