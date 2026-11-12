import { describe, expect, it, vi } from "vitest";
import * as L from "../../check/library.js";
import type { Check, Op, PoolSpec, Selector, Transform } from "../../check/ops.js";
import { type Gen, ModId, type Rarity, TagId } from "../../model/ids.js";
import { type InfluenceKey, influenceKey, NO_INFLUENCE } from "../../model/marks.js";
import type { Mod } from "../../model/mod.js";
import { type Catalog, type CatalogOptions, generateCatalog } from "../reference/catalog.js";
import {
    cellCuts,
    compareMethodOn,
    harnessStates,
    harnessUniverse,
    pickRows,
    someInfluences,
} from "../reference/harness.js";
import type { RefHandlers } from "../reference/ops/handler.js";
import { REF_HANDLERS } from "../reference/ops/registry.js";
import type { Handlers } from "./handler.js";
import { HANDLERS } from "./registry.js";

// Each comparison lists every item a removal or a reforge leaves, beside the
// reference playing each one out.
vi.setConfig({ testTimeout: 60_000 });

const req = (check: Check): Op => ({ kind: "require", check });
const strip: Transform = { kind: "strip" };
const remove = (selector: Selector): Transform => ({ kind: "remove", selector });
const random = (honourCannotRoll: boolean, gen?: Gen): Selector & { kind: "random" } => ({
    kind: "random",
    honourCannotRoll,
    ...(gen !== undefined && { gen }),
});
const keep = (gen: Gen): Op => ({ kind: "keep", gen });
const unprotect: Op = { kind: "unprotect" };
const natural: PoolSpec = { kind: "natural" };
/** A removal on the items it can act on: elsewhere it refuses the method. */
const removes = (sel: Selector): Op[] => [req({ kind: "removable", selector: sel }), remove(sel)];
/** The Harvest augment's run: an add from the pool, then a removal sparing it. */
const augment = (pool: PoolSpec, sel = random(false)): Op[] => [
    req({ kind: "poolNonEmpty", pool, tag: TagId("any") }),
    req({ kind: "removable", selector: sel }),
    { kind: "fill", pool, count: { kind: "add", n: [1, 1] } },
    remove({ ...sel, sparing: pool }),
];

/** The frames with a `strands` that uses none: the memory strands family is
 *  not this one, and the states hold none. */
const STUBS: { exact: Handlers; reference: RefHandlers } = {
    exact: {
        ...HANDLERS,
        transforms: { ...HANDLERS.transforms, strands: { reads: [], apply: (_op, s) => s } },
    },
    reference: {
        ...REF_HANDLERS,
        transforms: { ...REF_HANDLERS.transforms, strands: { reads: [], apply: (_op, x) => [x] } },
    },
};

interface Plan {
    readonly seed: number;
    readonly opts: CatalogOptions;
    readonly rarities?: readonly Rarity[];
    readonly rows?: number;
    readonly influences?: readonly InfluenceKey[] | boolean;
    readonly fractured?: boolean;
    readonly crafted?: boolean;
    readonly values?: boolean;
    readonly imprint?: boolean;
    readonly include?: (cat: Catalog) => readonly Mod[];
    readonly eldritch?: boolean;
    /** How many random states beside the fixed ones. */
    readonly random?: number;
}

/** The symbolic method lists to exactly the reference's items, and refuses
 *  exactly its items, on states of the plan's catalogue. */
function exactOn(plan: Plan, ops: (cat: Catalog) => readonly Op[]): void {
    const cat = generateCatalog(plan.seed, plan.opts);
    const plain = harnessUniverse(cat);
    const u = harnessUniverse(cat, {
        ...(plan.values && { comparisons: cellCuts(plain) }),
        ...(plan.imprint && { imprint: true }),
    });
    const include = (plan.include?.(cat) ?? []).map((m) => m.id);
    const rows = pickRows(u, plan.seed, plan.rows ?? 4, include);
    const influences =
        plan.influences === true
            ? someInfluences(u)
            : plan.influences === false || plan.influences === undefined
              ? undefined
              : plan.influences;
    const ex = (side: "exarch" | "eater") => {
        const type = cat.eldritch.find((e) => e.side === side)?.type;
        return type === undefined
            ? [{ tier: 0, type: undefined }]
            : [0, 2, 5].map((tier) => ({ tier, type: tier === 0 ? undefined : type }));
    };
    const states = harnessStates(u, cat.ctx, plan.seed, {
        bounds: {
            rows,
            ...(plan.rarities && { rarities: plan.rarities }),
            ...(influences && { influences }),
            ...(plan.fractured && { fractured: true }),
            ...(plan.crafted && { crafted: true }),
            ...(plan.values && { values: true }),
            ...(plan.eldritch && { exarch: ex("exarch"), eater: ex("eater") }),
        },
        random: plan.random ?? 6,
        maxSize: 12,
        ...(plan.imprint && { imprints: true }),
    });
    const method = ops(cat);
    const d = compareMethodOn(u, cat.ctx, states, method, STUBS);
    expect(d, `catalogue ${plan.seed} ${JSON.stringify(plan.opts)}\n${d}`).toBe("");
}

const CATALOGUES: readonly CatalogOptions[] = [
    { types: 4 },
    { types: 4, metamods: ["prefixesCannotChange"] },
    { types: 4, metamods: ["suffixesCannotChange", "cannotRollAttack"] },
    { types: 4, metamods: ["prefixesCannotChange", "suffixesCannotChange"] },
    { types: 4, metamods: ["cannotRollAttack", "cannotRollCaster"] },
    { types: 3, twoSided: true },
    { types: 3, base: "jewel" },
    { types: 3, base: "flask" },
    { types: 3, base: "ratcheting", influence: true },
    { types: 3, base: "simplex" },
    { types: 4, bench: true },
    { types: 3, addsTag: true },
    { types: 3, veiled: true },
];

const flagged = (cat: Catalog, opts: CatalogOptions): Mod[] => [
    ...(opts.metamods ? cat.metamods : []),
    ...(opts.bench && cat.bench ? [cat.bench] : []),
    ...cat.mods.filter(
        (m) =>
            (opts.addsTag === true && m.id === "Adder1") ||
            (opts.twoSided === true && (m.id === "Both1" || m.id === "Both2")) ||
            (opts.veiled === true && (m.id === "VeiledPrefix" || m.id === "UnveiledSuffix1")),
    ),
];

const plans = (seed: number, extra: Partial<Plan> = {}): Plan[] =>
    CATALOGUES.filter((o) => !extra.rarities?.includes("rare") || o.base !== "flask").map(
        (opts, i) => ({
            seed: seed + i,
            opts,
            influences: opts.influence === true,
            include: (cat: Catalog) => flagged(cat, opts),
            ...(opts.bench && { crafted: true }),
            ...extra,
        }),
    );

describe("a strip", () => {
    it("is exact under every protection, kept side and unprotect", () => {
        for (const p of plans(9500, { fractured: true })) {
            exactOn(p, () => [strip]);
            exactOn(p, () => [keep("prefix"), strip]);
            exactOn(p, () => [keep("suffix"), strip]);
            exactOn(p, () => [unprotect, strip]);
        }
    });

    it("is exact over value cells and held imprints", () => {
        for (const p of plans(9520, { rows: 3 }).slice(0, 6)) {
            exactOn({ ...p, values: true, fractured: true }, () => [strip]);
            exactOn({ ...p, imprint: true, rarities: ["magic"] }, () => [strip]);
        }
    });
});

describe("a random removal", () => {
    it("is exact whether it honours a cannot-roll metamod or not, of either side or one", () => {
        for (const p of plans(9600, { fractured: true })) {
            for (const honour of [true, false]) {
                exactOn(p, () => removes(random(honour)));
                exactOn(p, () => removes(random(honour, "prefix")));
                exactOn(p, () => removes(random(honour, "suffix")));
            }
        }
    });

    it("is exact over value cells, held imprints and crafted marks", () => {
        for (const p of plans(9620, { rows: 3 }).slice(0, 6)) {
            exactOn({ ...p, values: true }, () => removes(random(true)));
            exactOn({ ...p, imprint: true, rarities: ["rare"] }, () => removes(random(false)));
            exactOn({ ...p, crafted: true, fractured: true }, () => removes(random(true)));
        }
    });

    it("in a branch, leaves nothing where nothing is in reach", () => {
        for (const p of plans(9640, { fractured: true }).slice(0, 6)) {
            exactOn(p, () => [{ kind: "either", branches: [[remove(random(true))], []] }]);
        }
    });
});

describe("an add, then a removal sparing it", () => {
    it("is exact from the natural and tagged pools", () => {
        for (const p of plans(9700, { rows: 3, rarities: ["magic", "rare"] })) {
            exactOn(p, () => augment(natural));
            for (const tag of ["attack", "caster"].map(TagId)) {
                exactOn(p, () => augment({ kind: "tagged", tag }));
            }
        }
    });

    it("is exact with a side-limited or shielded removal, and over fractures", () => {
        for (const p of plans(9720, { rows: 3, fractured: true }).slice(0, 6)) {
            exactOn(p, () => augment(natural, random(true)));
            exactOn(p, () => augment(natural, random(false, "suffix")));
        }
    });
});

const DOMINANCE_CATALOGUES: readonly CatalogOptions[] = [
    { types: 2, base: "boots", influence: true, elevated: true },
    { types: 2, base: "boots", influence: true, elevated: true, ilvl: 40 },
    {
        types: 2,
        base: "boots",
        influence: true,
        elevated: true,
        metamods: ["prefixesCannotChange"],
    },
    {
        types: 2,
        base: "boots",
        influence: true,
        elevated: true,
        metamods: ["suffixesCannotChange"],
    },
    {
        types: 2,
        base: "boots",
        influence: true,
        elevated: true,
        addsTag: true,
        influencedAdder: true,
    },
];

const SOME_INFLUENCES: readonly InfluenceKey[] = [
    NO_INFLUENCE,
    influenceKey(["hunter"]),
    influenceKey(["shaper"]),
    influenceKey(["shaper", "hunter"]),
];

const dominancePlans = (seed: number): Plan[] =>
    DOMINANCE_CATALOGUES.map((opts, i) => ({
        seed: seed + i,
        opts,
        rows: 6,
        rarities: ["magic", "rare"],
        influences: SOME_INFLUENCES,
        include: (cat: Catalog) => [
            ...cat.metamods,
            ...cat.mods.filter((m) =>
                [
                    "Hunter1",
                    "HunterA1",
                    "HunterB1",
                    "ElevatedHunterB",
                    ...(opts.addsTag ? ["Adder1", "HunterGated1"] : []),
                ]
                    .map(ModId)
                    .includes(m.id),
            ),
        ],
    }));

describe("the Orb of Dominance", () => {
    it("removes one influenced modifier exactly", () => {
        for (const p of dominancePlans(9800)) {
            exactOn(p, () => removes({ kind: "influenced" }));
        }
    });

    it("raises one exactly, and raises another than it removed", () => {
        for (const p of dominancePlans(9810)) {
            exactOn(p, () => [{ kind: "either", branches: [[{ kind: "elevate" }], []] }]);
            exactOn(p, () => L.DOMINANCE);
        }
        // The higher tiers held: a Shaper row of the ladder, and its top.
        for (const p of dominancePlans(9820).slice(0, 3)) {
            exactOn(
                {
                    ...p,
                    include: (cat) => [
                        ...cat.metamods,
                        ...cat.mods.filter((m) =>
                            ["ShaperA1", "HunterB1", "ElevatedHunterA"].map(ModId).includes(m.id),
                        ),
                    ],
                },
                () => L.DOMINANCE,
            );
        }
    });
});

describe("the removal checks", () => {
    it("refuse exactly the reference's items", () => {
        for (const p of plans(9900, { fractured: true })) {
            exactOn(p, () => [
                req({ kind: "strippable" }),
                req({ kind: "unprotectedSide", gen: "prefix", what: "An orb" }),
                req({ kind: "removable", selector: random(true, "suffix") }),
            ]);
            exactOn(p, () => [keep("suffix"), req({ kind: "strippable" })]);
        }
        for (const p of dominancePlans(9920)) {
            exactOn(p, () => [
                req({ kind: "influencedAtLeast", count: 2 }),
                req({ kind: "noInfluencedOnProtected", what: "The grove" }),
            ]);
            exactOn(p, () => [req({ kind: "noInfluencedOnProtected", what: "The grove" })]);
            exactOn(p, () => [req({ kind: "influencedAtLeast", count: 1 })]);
        }
    });
});

describe("the library's methods that remove", () => {
    const rare = ["rare"] as const;
    const few = (ps: Plan[]): Plan[] => ps.map((p) => ({ ...p, random: 2 }));

    it("are exact end to end: the currencies", () => {
        for (const p of few(plans(10000, { fractured: true, rows: 3 }))) {
            for (const kind of ["scour", "annul", "chaos", "alteration"] as const) {
                exactOn(p, () => L.currencyOps(kind));
            }
        }
    });

    it("are exact end to end: the Harvest, the Bestiary and the Tainted orbs", () => {
        for (const p of few(plans(10100, { rows: 3, rarities: rare }))) {
            exactOn(p, () => L.harvestReforgeOps(TagId("attack")));
            exactOn(p, () => L.harvestAugmentOps(TagId("caster")));
            exactOn(p, () => L.beastAddOps("prefix", 100));
            exactOn(p, () => L.beastAddOps("suffix", 45));
            exactOn({ ...p, fractured: true }, () => [
                req({ kind: "rarity", rarity: "rare" }),
                { kind: "corrupt" },
                ...L.TAINTED_EXALT,
            ]);
            exactOn({ ...p, fractured: true }, () => [{ kind: "corrupt" }, ...L.TAINTED_CHAOS]);
        }
    });

    it("are exact end to end: the eldritch orbs", () => {
        const configs: CatalogOptions[] = [
            { types: 4, base: "boots", eldritch: true },
            { types: 4, base: "boots", eldritch: true, metamods: ["prefixesCannotChange"] },
            { types: 4, base: "boots", eldritch: true, metamods: ["suffixesCannotChange"] },
            { types: 3, base: "boots", eldritch: true, twoSided: true },
        ];
        configs.forEach((opts, i) => {
            const p: Plan = {
                seed: 10200 + i,
                opts,
                rows: 3,
                rarities: ["magic", "rare"],
                fractured: true,
                eldritch: true,
                random: 3,
                include: (cat) => flagged(cat, opts),
            };
            for (const side of ["exarch", "eater"] as const) {
                exactOn(p, () => L.eldritchChaosOps(side));
                exactOn(p, () => L.eldritchAnnulOps(side));
            }
        });
    });
});
