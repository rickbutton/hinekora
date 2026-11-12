import { describe, expect, it } from "vitest";
import { craft, item } from "../__fixtures__/ast.js";
import {
    AMULET_BASE,
    ASTROLABE_BASE,
    BOOTS_BASE,
    CATALOG,
    CLUSTER_BASE,
    CLUSTER_EFFECT,
    FLASK_BASE,
    JEWEL_BASE,
    NOTABLE_OVERSHOCK,
    NOTABLE_SADIST,
    RATCHETING_BASE,
    RING_BASE,
    SMALL_CLUSTER_BASE,
    TAG_DEFAULT,
} from "../__fixtures__/mods.js";
import type { AffixDecl } from "../ast/ast.js";
import { check } from "../check/check.js";
import { declareItem } from "../check/item-block.js";
import { anonymousRows as presentAnonymousRows } from "../check/ops.js";
import { TagId } from "../model/ids.js";
import type { Mod } from "../model/mod.js";
import type { Registry } from "../resolve/registry.js";
import { buildRegistry } from "../resolve/registry.js";
import { anonymousRows, startOf } from "./initial.js";
import { benchCraft, eldritchLadders, generateCatalog, modRow } from "./reference/catalog.js";
import {
    BENCH_COLD,
    BENCH_LIFE,
    BENCH_MANA,
    HAND_MODS,
    HAND_REGISTRY,
    MULTIMOD,
} from "./reference/hand.js";
import { atCells } from "./reference/harness.js";
import { refCtx } from "./reference/item.js";
import { initialItems } from "./reference/initial.js";
import { listItems } from "./reference/listing.js";
import { diffSets } from "./reference/sets.js";

type Spec = Parameters<typeof item>[0];

/** The block's items both ways, and the anonymous pools against the present checker's. */
function expectItems(registry: Registry, spec: Spec): number {
    const block = item(spec);
    const said: string[] = [];
    const start = startOf(registry, craft(block, []), (m) => said.push(m));
    expect(said).toEqual([]);
    const { u, decl, state } = start!;
    const ctx = refCtx(registry, decl.base, decl.ilvl);
    const expected = atCells(u, initialItems(ctx, block));
    const listed = state === null ? atCells(u, []) : listItems(u, state.dd, { lowest: true });
    expect(diffSets(expected, listed), JSON.stringify(spec)).toBe("");
    const before = check(craft(block, []), { registry }).trace[0]!.before;
    for (const gen of ["prefix", "suffix"] as const) {
        const ids = (rows: readonly { id: string }[]) => rows.map((m) => m.id).sort();
        expect(ids(anonymousRows(registry, decl, gen))).toEqual(
            ids(presentAnonymousRows(before, registry, gen)),
        );
    }
    return expected.size;
}

const random: AffixDecl = { mod: "random" };
const benchRandom: AffixDecl = { mod: "random", bench: true };
const fracturedRandom: AffixDecl = { mod: "random", fractured: true };

describe("the item block's items", () => {
    const ring = (over: Partial<Spec>): Spec => ({
        base: "IronRing",
        ilvl: 84,
        rarity: "rare",
        ...over,
    });

    it("hold the named modifiers at their rows, any value", () => {
        // One item: a modifier's value is read only as finely as a condition compares it.
        expect(expectItems(HAND_REGISTRY, ring({ prefixes: ["Life2"], suffixes: ["Fire1"] }))).toBe(
            1,
        );
        expectItems(HAND_REGISTRY, ring({ prefixes: [{ mod: "maximum life", tier: 2 }] }));
        expectItems(HAND_REGISTRY, ring({ rarity: "magic", prefixes: ["Mana1"] }));
    });

    it("hold a random affix as a natural modifier of its side, apart from the rest", () => {
        expect(
            expectItems(HAND_REGISTRY, ring({ prefixes: ["Life1", random], suffixes: [random] })),
        ).toBeGreaterThan(4);
        expectItems(HAND_REGISTRY, ring({ suffixes: [random, "?", "Fire1"] }));
        expectItems(
            HAND_REGISTRY,
            ring({ rarity: "magic", prefixes: [random], suffixes: [random] }),
        );
    });

    it("hold crafted and fractured modifiers, named and not", () => {
        expectItems(
            HAND_REGISTRY,
            ring({ prefixes: [{ mod: "maximum life", bench: true }], suffixes: [random] }),
        );
        expectItems(HAND_REGISTRY, ring({ prefixes: [benchRandom], suffixes: [random] }));
        expectItems(
            HAND_REGISTRY,
            ring({
                prefixes: [{ mod: "Life1", fractured: true }],
                suffixes: [fracturedRandom, random],
            }),
        );
        expectItems(
            HAND_REGISTRY,
            ring({ prefixes: [{ mod: "maximum mana", bench: true, fractured: true }] }),
        );
    });

    it("hold the marks: influences, corruption, strands, eldritch implicits", () => {
        expectItems(
            HAND_REGISTRY,
            ring({ influences: ["hunter"], suffixes: ["Hunter1", random], corrupted: true }),
        );
        expectItems(HAND_REGISTRY, ring({ strands: 40, prefixes: [random] }));
        expectItems(HAND_REGISTRY, {
            base: "IronGreaves",
            ilvl: 84,
            rarity: "rare",
            exarch: { tier: "grand", text: "increased MoveSpeed" },
            eater: "lesser",
            prefixes: [random],
        });
        expectItems(HAND_REGISTRY, {
            base: "CoralAmulet",
            ilvl: 84,
            rarity: "magic",
            exarch: "exceptional",
            prefixes: [random],
        });
    });

    it("hold a tier two declared influences share, a bare name, a tier above the level", () => {
        const row = (id: string, stem: string, minLevel: number, text: string): Mod =>
            modRow({
                id,
                type: "TypeX",
                gen: "prefix",
                minLevel,
                text,
                spawn: [
                    { tag: TagId(`ring_${stem}`), weight: 500 },
                    { tag: TAG_DEFAULT, weight: 0 },
                ],
            });
        const registry = buildRegistry({
            bases: [RING_BASE],
            mods: [
                ...HAND_MODS,
                row("X1", "basilisk", 1, "+(1-2) to Xstat"),
                row("XS", "shaper", 1, "+(3-4) to Xstat"),
                row("X2", "basilisk", 50, "+(5-6) to Xstat"),
            ],
        });
        // Tier 1 is X2 under the Hunter and XS under the Shaper: the item holds either.
        expect(
            expectItems(
                registry,
                ring({ influences: ["hunter", "shaper"], prefixes: [{ mod: "xstat", tier: 1 }] }),
            ),
        ).toBe(2);
        expectItems(HAND_REGISTRY, ring({ prefixes: ["maximum mana"] }));
        expectItems(
            HAND_REGISTRY,
            ring({ ilvl: 30, prefixes: [{ mod: "maximum life", tier: 1 }] }),
        );
    });

    it("hold an Astrolabe Amulet's under every influence", () => {
        const registry = buildRegistry({ bases: [ASTROLABE_BASE], mods: HAND_MODS });
        expectItems(registry, {
            base: "Astrolabe Amulet",
            ilvl: 84,
            rarity: "rare",
            prefixes: [random],
        });
    });

    it("hold a flask's and a jewel's", () => {
        const flask = generateCatalog(4101, { base: "flask", types: 4 });
        expectItems(flask.registry, {
            base: flask.base.id,
            ilvl: flask.ilvl,
            rarity: "magic",
            prefixes: [random],
            suffixes: [random],
        });
        const jewel = generateCatalog(4102, { base: "jewel", types: 5, addsTag: true });
        const adder = jewel.mods.find((m) => m.id === "Adder1")!;
        expectItems(jewel.registry, {
            base: jewel.base.id,
            ilvl: jewel.ilvl,
            rarity: "rare",
            prefixes: [adder.gen === "prefix" ? adder.id : random],
            suffixes: [random, ...(adder.gen === "suffix" ? [adder.id] : [])],
        });
    });

    it("hold a cluster jewel's under its enchantment", () => {
        const registry = buildRegistry({
            bases: [RING_BASE, CLUSTER_BASE, SMALL_CLUSTER_BASE],
            mods: [...CATALOG, NOTABLE_SADIST, NOTABLE_OVERSHOCK, CLUSTER_EFFECT],
        });
        // One notable on a Small jewel holds the other out of its pool.
        expectItems(registry, {
            base: "Small Cluster Jewel",
            ilvl: 84,
            rarity: "rare",
            enchant: { passives: 2, text: "lightning damage" },
            prefixes: ["sadist", random],
        });
        expectItems(registry, {
            base: "Large Cluster Jewel",
            ilvl: 84,
            rarity: "rare",
            enchant: { passives: 8, text: "lightning damage" },
            prefixes: [random, random],
        });
    });

    it("hold a generated catalogue's, every side and source together", () => {
        for (const seed of [4201, 4202, 4203]) {
            const cat = generateCatalog(seed, { types: 4, bench: true, influence: true });
            const prefix = cat.natural.find((m) => m.gen === "prefix")!;
            expectItems(cat.registry, {
                base: cat.base.id,
                ilvl: cat.ilvl,
                rarity: "rare",
                influences: ["hunter"],
                prefixes: [prefix.id, random],
                suffixes: [random, ...(cat.bench!.gen === "suffix" ? [benchRandom] : [])],
            });
        }
    });
});

/** A catalogue with every base a fault of the block is about. */
const FAULTS = buildRegistry({
    bases: [
        RING_BASE,
        BOOTS_BASE,
        AMULET_BASE,
        FLASK_BASE,
        JEWEL_BASE,
        ASTROLABE_BASE,
        RATCHETING_BASE,
        CLUSTER_BASE,
        SMALL_CLUSTER_BASE,
    ],
    mods: [...HAND_MODS, NOTABLE_SADIST, NOTABLE_OVERSHOCK, CLUSTER_EFFECT],
    benchCrafts: [BENCH_LIFE, BENCH_MANA, BENCH_COLD, MULTIMOD].flatMap((m) => [
        benchCraft(m, RING_BASE.itemClass),
        benchCraft(m, BOOTS_BASE.itemClass),
    ]),
    eldritch: [
        ...eldritchLadders("exarch", ["MoveSpeed"], "boots"),
        ...eldritchLadders("eater", ["ChaosRes"], "boots"),
        ...eldritchLadders("exarch", ["AmuletExarch"], "amulet"),
        ...eldritchLadders("eater", ["AmuletEater"], "amulet"),
    ],
    clusterEnchants: { large: ["affliction_lightning_damage"] },
});

describe("the item block's faults", () => {
    const ring = (over: Partial<Spec>): Spec => ({
        base: "IronRing",
        ilvl: 84,
        rarity: "rare",
        ...over,
    });
    const lightning = { passives: 8, text: "lightning damage" };
    /** Each block with a few words of the message it gets. */
    const blocks: readonly (readonly [Spec, string])[] = [
        [{ base: "NoSuchBase", ilvl: 84, rarity: "rare" }, 'Unknown base "NoSuchBase"'],
        [ring({ rarity: "magic", prefixes: [random, random] }), "too many prefixes"],
        [ring({ suffixes: ["Fire1", "Cold1", "Lightning1", random] }), "too many suffixes"],
        [
            {
                base: "RatchetingRing",
                ilvl: 84,
                rarity: "magic",
                suffixes: ["Fire1", "Cold1", "Lightning1"],
            },
            "too many modifiers",
        ],
        [ring({ prefixes: ["Life1", "Life2"] }), "are tiers of one modifier"],
        [ring({ prefixes: ["Life1", "Life1"] }), "is declared twice"],
        [ring({ suffixes: ["Fire1", "FireChaos1"] }), "of the same group"],
        [ring({ suffixes: ["Life1"] }), "listed under suffixes"],
        [ring({ prefixes: ["maximum life"] }), "declare the tier"],
        [ring({ prefixes: [{ mod: "maximum life", tier: 5 }] }), "tier 5 is out of range"],
        [ring({ prefixes: ["no such words"] }), "Unknown mod"],
        [ring({ prefixes: ["Flasky1"] }), '"Flasky1" cannot roll on'],
        [ring({ prefixes: ["flasking"] }), '"flasking" cannot roll on'],
        [ring({ suffixes: ["crafted modifiers"] }), "a bench craft is declared as"],
        [ring({ suffixes: [{ mod: "zzz", bench: true }] }), 'No bench craft adds "zzz"'],
        [{ base: "LifeFlask", ilvl: 84, rarity: "rare" }, "cannot be Rare"],
        [ring({ influences: ["hunter"], suffixes: [fracturedRandom] }), "cannot have a fractured"],
        [
            { base: "Cobalt Jewel", ilvl: 84, rarity: "rare", influences: ["hunter"] },
            "cannot be influenced",
        ],
        [
            { base: "Astrolabe Amulet", ilvl: 84, rarity: "rare", influences: ["hunter"] },
            "has every influence",
        ],
        [ring({ exarch: "grand" }), "Only a body armour"],
        [{ base: "IronGreaves", ilvl: 70, rarity: "rare", exarch: "grand" }, "needs item level 75"],
        [
            {
                base: "IronGreaves",
                ilvl: 84,
                rarity: "rare",
                influences: ["hunter"],
                eater: "lesser",
            },
            "cannot have an eldritch implicit",
        ],
        [
            {
                base: "IronGreaves",
                ilvl: 84,
                rarity: "rare",
                exarch: { tier: "grand", text: "zzz" },
            },
            "No Searing Exarch implicit reads",
        ],
        [
            { base: "CoralAmulet", ilvl: 84, rarity: "rare", exarch: "perfect" },
            "Lesser to Exceptional",
        ],
        [
            { base: "CoralAmulet", ilvl: 84, rarity: "rare", exarch: "grand", eater: "lesser" },
            "not both",
        ],
        [ring({ strands: 150 }), "0 to 100 memory strands"],
        [ring({ enchant: lightning }), "Only a cluster jewel has an enchant"],
        [{ base: "Large Cluster Jewel", ilvl: 84, rarity: "rare" }, "depend on its enchant"],
        [
            {
                base: "Large Cluster Jewel",
                ilvl: 84,
                rarity: "rare",
                enchant: { passives: 3, text: "lightning damage" },
            },
            "adds 8 to 12 passive skills",
        ],
        [
            {
                base: "Large Cluster Jewel",
                ilvl: 84,
                rarity: "rare",
                enchant: { passives: 8, text: "zzz" },
            },
            "is not a cluster jewel enchantment",
        ],
        [
            {
                base: "Small Cluster Jewel",
                ilvl: 84,
                rarity: "rare",
                enchant: { passives: 2, text: "lightning damage" },
            },
            'cannot have the "lightning damage" enchant',
        ],
        [
            {
                base: "IronGreaves",
                ilvl: 84,
                rarity: "rare",
                prefixes: [random, fracturedRandom, benchRandom, "Life1", "Mana1", "Armour1"],
            },
            "too many prefixes",
        ],
    ];

    it("are each reported, and leave items the craft can go on from", () => {
        for (const [spec, words] of blocks) {
            const said: string[] = [];
            const start = startOf(FAULTS, craft(item(spec), []), (m) => said.push(m));
            expect(
                said.some((m) => m.includes(words)),
                `${JSON.stringify(spec)}: ${said.join(" | ")}`,
            ).toBe(true);
            // The present checker reports the same: the validation is one code.
            expect(said).toEqual(
                check(craft(item(spec), []), { registry: FAULTS }).diagnostics.map(
                    (d) => d.message,
                ),
            );
            if (spec.base !== "NoSuchBase") {
                expect(start?.state, JSON.stringify(spec)).not.toBeNull();
            }
        }
    });

    it("leave a block past its caps holding the affixes within them", () => {
        const said: string[] = [];
        const block = item({
            base: "IronRing",
            ilvl: 84,
            rarity: "magic",
            prefixes: ["Life1", "Mana1"],
            suffixes: ["no such words"],
        });
        const start = startOf(HAND_REGISTRY, craft(block, []), (m) => said.push(m))!;
        expect(said.length).toBeGreaterThan(0);
        const items = listItems(start.u, start.state!.dd, { lowest: true }).items();
        expect(items.every((x) => x.mods.length === 2)).toBe(true);
        expect(declareItem(block, HAND_REGISTRY, () => {})!.prefixCount).toBe(1);
    });
});
