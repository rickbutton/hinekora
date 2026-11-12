import { describe, expect, it } from "vitest";
import * as L from "../library.js";
import type { Check, Op, PoolSpec, Selector, Transform } from "./types.js";
import { rollRange } from "../values.js";
import { BOOTS_BASE, RING_BASE } from "../../__fixtures__/mods.js";
import type { Base } from "../../model/base.js";
import { type Gen, ModId, TagId, TypeId } from "../../model/ids.js";
import { type InfluenceKey, influenceKey } from "../../model/marks.js";
import type { Mod } from "../../model/mod.js";
import { buildRegistry, type Registry } from "../../resolve/registry.js";
import { runMethod } from "../method.js";
import {
    benchCraft,
    type Catalog,
    eldritchLadders,
    generateCatalog,
    metamod,
    type MetamodKind,
    modRow,
    type RowSpec,
} from "../reference/catalog.js";
import { type CItem, cItem, type CMod, cMod, refCtx, type RefCtx } from "../reference/item.js";
import { cellCuts, harnessUniverse } from "../reference/harness.js";
import { listItems } from "../reference/listing.js";
import { refRunMethod } from "../reference/method.js";
import type { RefHandlers } from "../reference/ops/handler.js";
import { REF_HANDLERS } from "../reference/ops/registry.js";
import { CItemSet } from "../reference/sets.js";
import { violations } from "../reference/wellformed.js";
import { conditionOf, fromItems, type ItemSet } from "../state.js";
import { buildUniverse, type Universe } from "../universe.js";
import { counts } from "../views.js";
import type { Handlers } from "./handler.js";
import { HANDLERS } from "./registry.js";

const req = (check: Check): Op => ({ kind: "require", check });
const strip: Transform = { kind: "strip" };
const remove = (selector: Selector): Transform => ({ kind: "remove", selector });
const random = (gen?: Gen): Selector & { kind: "random" } => ({
    kind: "random",
    ...(gen !== undefined && { gen }),
});
const removes = (sel: Selector): Op[] => [req({ kind: "removable", selector: sel }), remove(sel)];

/** The frames with a `strands` that uses none, which the eldritch orbs end on. */
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

interface World {
    readonly registry: Registry;
    readonly ctx: RefCtx;
    readonly u: Universe;
}

function world(rows: readonly Mod[], base: Base = RING_BASE, metamods: MetamodKind[] = []): World {
    const meta = metamods.map(metamod);
    const registry = buildRegistry({
        bases: [base],
        mods: [...rows, ...meta],
        // Every bench row of the catalogue, the metamods among them, is crafted on the base.
        benchCrafts: [...rows.filter((m) => m.source === "bench"), ...meta].map((m) =>
            benchCraft(m, base.itemClass),
        ),
        eldritch:
            base === BOOTS_BASE
                ? [
                      ...eldritchLadders("exarch", ["Blaze"], "boots"),
                      ...eldritchLadders("eater", ["Gloom"], "boots"),
                  ]
                : [],
    });
    return {
        registry,
        ctx: refCtx(registry, base, 84),
        u: buildUniverse(registry, base, 84, undefined),
    };
}

const ofCatalog = (cat: Catalog): World => ({
    registry: cat.registry,
    ctx: cat.ctx,
    u: buildUniverse(cat.registry, cat.base, cat.ilvl, undefined),
});

const row = (spec: Partial<RowSpec> & Pick<RowSpec, "id" | "gen">): Mod =>
    modRow({ type: `Type${spec.id}`, text: `+(1-2) to ${spec.id}`, ...spec });

/** A modifier of the row at its lowest value. */
function on(w: World, id: string, marks: Partial<CMod> = {}): CMod {
    const m = w.ctx.rows.get(ModId(id))!;
    const span = m.text === undefined ? undefined : rollRange(m.text);
    return cMod(ModId(id), span?.[0], marks);
}

const metaId = (k: MetamodKind): string => metamod(k).id;

/** A modifier of the row at the lowest or the highest value of its span. */
function cell(w: World, id: string, lo: boolean): CMod {
    const span = rollRange(w.ctx.rows.get(ModId(id))!.text!)!;
    return cMod(ModId(id), lo ? span[0] : span[1]);
}

/** The items the method leaves on the items, the symbolic frame and the
 *  reference agreeing, each modifier at the lowest value of its cell. */
function outcomes(w: World, items: CItem[], ops: readonly Op[]): CItem[] {
    for (const x of items) expect(violations(x, w.ctx)).toEqual([]);
    const r = runMethod(fromItems(w.u, items)!, ops, STUBS.exact);
    const exact = listItems(w.u, r.state.dd, { lowest: true });
    const ref = refRunMethod(CItemSet.of(items), ops, w.ctx, STUBS.reference);
    expect(exact.keys()).toEqual(CItemSet.of(ref.state.items().map(lowest(w))).keys());
    return exact.items();
}

const lowest = (w: World) => (x: CItem) => w.u.decodeOne(w.u.encode(x));

/** The rows of each item, sorted. */
const rowsOf = (xs: readonly CItem[]): string[][] =>
    xs.map((x) => x.mods.map((m) => m.row as string).sort());

const sorted = (xs: string[][]): string[][] =>
    xs
        .map((r) => r.join(","))
        .sort()
        .map((r) => r.split(","));

function refusal(w: World, items: CItem[], ops: readonly Op[]) {
    const r = runMethod(fromItems(w.u, items)!, ops, STUBS.exact);
    const ref = refRunMethod(CItemSet.of(items), ops, w.ctx, STUBS.reference);
    expect(r.ok).toBe(ref.ok);
    return r.ok ? undefined : r.failure;
}

// --- strip ------------------------------------------------------------------------

describe("a strip", () => {
    const w = world(
        [
            row({ id: "Pre", gen: "prefix" }),
            row({ id: "Pre2", gen: "prefix" }),
            row({ id: "Suf", gen: "suffix" }),
            row({ id: "Suf2", gen: "suffix" }),
        ],
        RING_BASE,
        ["prefixesCannotChange"],
    );
    const guard = metaId("prefixesCannotChange");
    const item = cItem({
        rarity: "rare",
        mods: [
            on(w, "Pre"),
            on(w, "Pre2"),
            on(w, "Suf", { fractured: true }),
            on(w, "Suf2"),
            on(w, guard, { crafted: true }),
        ],
    });

    it("keeps the protected side and the fractured modifier, and takes the metamod with its side", () => {
        expect(rowsOf(outcomes(w, [item], L.currencyOps("scour")))).toEqual([
            ["Pre", "Pre2", "Suf"],
        ]);
    });

    it("keeps the side `keep` names in place of the item's protections", () => {
        expect(rowsOf(outcomes(w, [item], [{ kind: "keep", gen: "suffix" }, strip]))).toEqual([
            [guard, "Suf", "Suf2"].sort(),
        ]);
    });

    it("after `unprotect`, keeps the fractured modifier alone", () => {
        expect(rowsOf(outcomes(w, [item], [{ kind: "unprotect" }, strip]))).toEqual([["Suf"]]);
    });

    it("leaves the rarity to the method", () => {
        expect(outcomes(w, [item], [strip])[0]!.rarity).toBe("rare");
    });
});

// --- a type with rows on both sides -------------------------------------------------

describe("a crafted suffix of a type whose natural rows are prefixes", () => {
    // A bow's crafted chaos damage over time multiplier is a suffix of a type
    // whose natural rows are prefixes: its side is its row's.
    const dot = row({ id: "Dot1", type: "TypeDot", families: ["FamDot"], gen: "prefix" });
    const bench = modRow({
        id: "DotBench",
        type: "TypeDot",
        families: ["FamDot"],
        gen: "suffix",
        text: "+(3-4) to Dot",
        spawn: [],
        domain: metamod("multimod").domain,
        source: "bench",
    });
    const w = world([
        dot,
        bench,
        row({ id: "Pre", gen: "prefix" }),
        row({ id: "Suf", gen: "suffix" }),
    ]);
    const item = cItem({
        rarity: "rare",
        mods: [on(w, "Pre"), on(w, "DotBench", { crafted: true }), on(w, "Suf")],
    });

    it("goes with its side's strip and stays with the other's", () => {
        const keep = (gen: Gen): Op => ({ kind: "keep", gen });
        expect(rowsOf(outcomes(w, [item], [keep("prefix"), strip]))).toEqual([["Pre"]]);
        expect(rowsOf(outcomes(w, [item], [keep("suffix"), strip]))).toEqual([["DotBench", "Suf"]]);
    });

    it("is in reach of a suffix's removal and out of a prefix's", () => {
        expect(sorted(rowsOf(outcomes(w, [item], removes(random("suffix")))))).toEqual(
            sorted([
                ["DotBench", "Pre"],
                ["Pre", "Suf"],
            ]),
        );
        expect(rowsOf(outcomes(w, [item], removes(random("prefix"))))).toEqual([
            ["DotBench", "Suf"],
        ]);
    });
});

// --- a random removal --------------------------------------------------------------

describe("a random removal", () => {
    const w = world(
        [
            row({ id: "Pre", gen: "prefix" }),
            row({ id: "Atk", gen: "prefix", implicitTags: ["attack"] }),
            row({ id: "Suf", gen: "suffix" }),
        ],
        RING_BASE,
        ["cannotRollAttack", "suffixesCannotChange"],
    );
    const shield = metaId("cannotRollAttack");
    const sides = metaId("suffixesCannotChange");

    it("takes any one modifier in reach, never a fractured one, and leaves the rarity", () => {
        const item = cItem({
            rarity: "rare",
            mods: [on(w, "Pre"), on(w, "Atk", { fractured: true }), on(w, "Suf")],
        });
        const out = outcomes(w, [item], L.currencyOps("annul"));
        expect(sorted(rowsOf(out))).toEqual(
            sorted([
                ["Atk", "Suf"],
                ["Atk", "Pre"],
            ]),
        );
        expect(out.every((x) => x.rarity === "rare")).toBe(true);
    });

    it("of the Orb of Annulment takes a modifier a cannot-roll metamod bars from rolling", () => {
        // Version 3.30.0 (Item Changes): the metamod no longer keeps an Orb of
        // Annulment off the modifiers it bars.
        const item = cItem({
            rarity: "rare",
            mods: [on(w, "Atk"), on(w, "Suf"), on(w, shield, { crafted: true })],
        });
        expect(sorted(rowsOf(outcomes(w, [item], L.currencyOps("annul"))))).toEqual(
            sorted(
                [
                    ["Suf", shield],
                    ["Atk", shield],
                    ["Atk", "Suf"],
                ].map((r) => r.sort()),
            ),
        );
        expect(outcomes(w, [item], removes(random()))).toHaveLength(3);
    });

    it("limited to a protected side leaves the item as it was", () => {
        const item = cItem({
            rarity: "rare",
            mods: [on(w, "Pre"), on(w, "Suf"), on(w, sides, { crafted: true })],
        });
        expect(outcomes(w, [item], removes(random("suffix")))).toEqual([lowest(w)(item)]);
        // The beastcraft adds without removing (Metamod § Rules and Exceptions).
        const out = outcomes(w, [item], L.beastAddOps("prefix", 100));
        expect(out.every((x) => x.mods.length === 4)).toBe(true);
    });

    it("with nothing in reach is refused by its check, and leaves nothing in a branch", () => {
        const item = cItem({
            rarity: "rare",
            mods: [
                on(w, "Pre", { fractured: true }),
                on(w, "Suf"),
                on(w, sides, { crafted: true, fractured: true }),
            ],
        });
        expect(refusal(w, [item], L.currencyOps("annul"))).toEqual({ kind: "nothingToRemove" });
        const end: Op = { kind: "either", branches: [[remove(random())], [{ kind: "end" }]] };
        const r = runMethod(fromItems(w.u, [item])!, [end]);
        expect(r.ended).toBe(true);
    });
});

// --- the add and remove another --------------------------------------------------------

describe("an add, then a removal sparing it", () => {
    const fast = row({ id: "Fast", gen: "prefix", implicitTags: ["speed"] });
    const w = world(
        [fast, row({ id: "Pre", gen: "prefix" }), row({ id: "Suf", gen: "suffix" })],
        BOOTS_BASE,
    );
    const pool: PoolSpec = { kind: "rows", mods: [w.ctx.rows.get(ModId("Fast"))!] };
    const run = (sel = random()): Op[] => [
        req({ kind: "poolNonEmpty", pool, tag: TagId("speed") }),
        req({ kind: "removable", selector: sel }),
        { kind: "fill", pool, count: { kind: "add", n: [1, 1] } },
        remove({ ...sel, sparing: pool }),
    ];

    it("never takes the modifier it added", () => {
        const item = cItem({ rarity: "rare", mods: [on(w, "Suf")] });
        const out = outcomes(w, [item], run());
        expect(rowsOf(out)).toEqual([["Fast"]]);
    });

    it("draws with the item as it stands, the one it removes still there", () => {
        // Magic boots with a prefix have no room for another, though the
        // removal would make some.
        const magic = cItem({ rarity: "magic", mods: [on(w, "Pre"), on(w, "Suf")] });
        expect(refusal(w, [magic], run())).toMatchObject({ kind: "harvestEmptyPool" });
    });

    it("is refused on an item whose rarity holds no modifier", () => {
        // Unreached behind the Harvest augment's checks, which take a Rare.
        const ops: Op[] = [
            { kind: "fill", pool, count: { kind: "add", n: [1, 1] } },
            remove({ ...random(), sparing: pool }),
        ];
        expect(refusal(w, [cItem()], ops)).toMatchObject({ kind: "noOutcome" });
    });

    it("is refused where nothing but the added modifier could go", () => {
        const item = cItem({ rarity: "rare", mods: [on(w, "Suf", { fractured: true })] });
        expect(refusal(w, [item], run())).toEqual({ kind: "nothingToRemove" });
    });
});

// --- the Orb of Dominance --------------------------------------------------------------

/** A boots catalogue for the orb whose two Hunter types sit on the sides asked for. */
function dominanceWorld(
    seed: number,
    apart: boolean,
    metamods: MetamodKind[] = [],
): World & { readonly cat: Catalog } {
    for (let k = seed; ; k++) {
        const cat = generateCatalog(k, {
            base: "boots",
            types: 2,
            influence: true,
            elevated: true,
            ilvl: 40,
            metamods,
        });
        const gen = (id: string) => cat.ctx.rows.get(ModId(id))!.gen;
        if ((gen("HunterA1") !== gen("HunterB1")) === apart) return { ...ofCatalog(cat), cat };
    }
}

describe("the Orb of Dominance", () => {
    const w = dominanceWorld(9300, false);
    const hunter = influenceKey(["hunter"]);
    const both = influenceKey(["shaper", "hunter"]);
    const item = (influences: InfluenceKey, ...ids: string[]) =>
        cItem({ rarity: "rare", influences, mods: ids.map((id) => on(w, id)) });
    const rowSets = (xs: readonly CItem[]) =>
        [...new Set(rowsOf(xs).map((r) => r.join(",")))].sort();

    it("removes one and raises the other a tier, or to its elevated row from the top", () => {
        const out = outcomes(w, [item(hunter, "HunterA1", "HunterB1")], L.DOMINANCE);
        // A Shaper row between the Hunter tiers is not of the Hunter's ladder,
        // and the tier above stands above the item's level.
        expect(rowSets(out)).toEqual(["ElevatedHunterB", "HunterA2"]);
        expect(w.ctx.ilvl).toBeLessThan(w.ctx.rows.get(ModId("HunterA2"))!.minLevel);
        // An elevated row with no number has no value.
        const b = out.flatMap((x) => x.mods).find((m) => m.row === "ElevatedHunterB")!;
        expect(b.value).toBeUndefined();
        const top = outcomes(w, [item(hunter, "HunterA2", "HunterB1")], L.DOMINANCE);
        expect(rowSets(top)).toEqual(["ElevatedHunterA", "ElevatedHunterB"]);
    });

    it("takes a modifier to its own influence's elevated row", () => {
        const out = outcomes(w, [item(both, "ShaperA1", "HunterB1")], L.DOMINANCE);
        expect(rowSets(out)).toEqual(["ElevatedHunterB", "ElevatedShaperA"]);
    });

    it("rerolls the values of an elevated modifier it upgrades", () => {
        const out = outcomes(w, [item(hunter, "ElevatedHunterA", "HunterB1")], L.DOMINANCE);
        expect(rowSets(out)).toEqual(["ElevatedHunterA", "ElevatedHunterB"]);
        // Over cells cut inside each span, the upgrade reaches both of its row's.
        const u = harnessUniverse(w.cat, { comparisons: cellCuts(w.u) });
        const at = (lo: boolean) =>
            cItem({
                rarity: "rare",
                influences: hunter,
                mods: [on(w, "HunterB1"), cell(w, "ElevatedHunterA", lo)],
            });
        const cells = (x: CItem) =>
            listItems(u, runMethod(fromItems(u, [x])!, L.DOMINANCE).state.dd, { lowest: true })
                .items()
                .flatMap((y) => y.mods.filter((m) => m.row === "ElevatedHunterA"))
                .map((m) => m.value);
        const slot = u.slotOfType(TypeId("TypeElevatedHunterA"))!;
        const plain = u.valuesWhere(slot, (v) => !v.fractured && !v.crafted);
        expect(plain.length).toBeGreaterThan(1);
        expect(new Set(cells(at(true))).size).toBe(plain.length);
        expect(cells(at(false))).toEqual(cells(at(true)));
    });

    it("counts only the modifiers of the item's influence", () => {
        expect(
            refusal(w, [item(influenceKey(["shaper"]), "HunterA1", "HunterB1")], L.DOMINANCE),
        ).toEqual({
            kind: "tooFewInfluenced",
            needed: 2,
            have: 0,
        });
    });

    it("leaves a protected side alone", () => {
        const p = dominanceWorld(9400, true, ["prefixesCannotChange"]);
        const at = (id: string) => p.ctx.rows.get(ModId(id))!.gen;
        const [onPrefix, onSuffix] =
            at("HunterA1") === "prefix" ? ["HunterA1", "HunterB1"] : ["HunterB1", "HunterA1"];
        const guard = on(p, metaId("prefixesCannotChange"), { crafted: true });
        const x = cItem({
            rarity: "rare",
            influences: hunter,
            mods: [on(p, onPrefix), on(p, onSuffix), guard],
        });
        expect(refusal(p, [x], L.DOMINANCE)).toEqual({
            kind: "tooFewInfluenced",
            needed: 2,
            have: 1,
        });
        // The removal alone reaches only the suffix.
        expect(rowsOf(outcomes(p, [x], removes({ kind: "influenced" })))).toEqual([
            [onPrefix, guard.row].sort(),
        ]);
    });
});

describe("the Orb of Dominance on an elevated row of the other side", () => {
    const hunterTag = TagId("boots_basilisk");
    const hunterRow = (id: string, gen: Gen): Mod =>
        row({
            id,
            gen,
            families: [`Fam${id}`],
            spawn: [
                { tag: hunterTag, weight: 400 },
                { tag: TagId("default"), weight: 0 },
            ],
        });
    const elevatedRow = (id: string, of: string, gen: Gen): Mod =>
        row({
            id,
            gen,
            families: [`Fam${of}`],
            source: "elevated",
            spawn: [
                { tag: hunterTag, weight: 0 },
                { tag: TagId("default"), weight: 0 },
            ],
        });
    const w = world(
        [
            hunterRow("HunterP", "prefix"),
            hunterRow("HunterQ", "prefix"),
            hunterRow("HunterR", "prefix"),
            hunterRow("HunterS", "suffix"),
            elevatedRow("ElevatedP", "HunterP", "suffix"),
            elevatedRow("ElevatedQ", "HunterQ", "prefix"),
            elevatedRow("ElevatedR", "HunterR", "prefix"),
            elevatedRow("ElevatedS", "HunterS", "suffix"),
            row({ id: "S1", gen: "suffix" }),
            row({ id: "S2", gen: "suffix" }),
            row({ id: "S3", gen: "suffix" }),
        ],
        BOOTS_BASE,
        ["prefixesCannotChange"],
    );
    const hunter = influenceKey(["hunter"]);
    const item = (...ids: string[]) =>
        cItem({ rarity: "rare", influences: hunter, mods: ids.map((id) => on(w, id)) });
    const elevated = (xs: readonly CItem[]) =>
        [...new Set(xs.flatMap((x) => x.mods.map((m) => m.row as string)))]
            .filter((r) => r.startsWith("Elevated"))
            .sort();

    it("changes side where the item has room on it", () => {
        const out = outcomes(w, [item("HunterP", "HunterQ", "S1", "S2")], L.DOMINANCE);
        expect(elevated(out)).toEqual(["ElevatedP", "ElevatedQ"]);
    });

    it("is not one the orb can upgrade where that side is full", () => {
        const out = outcomes(
            w,
            [item("HunterP", "HunterQ", "HunterR", "S1", "S2", "S3")],
            L.DOMINANCE,
        );
        expect(elevated(out)).toEqual(["ElevatedQ", "ElevatedR"]);
    });

    it("leaves an item with none it can upgrade refused", () => {
        expect(refusal(w, [item("HunterP", "HunterQ", "S1", "S2", "S3")], L.DOMINANCE)).toEqual({
            kind: "noOutcome",
            op: "elevate",
        });
    });

    it("counts each item's influenced modifiers under its own protections", () => {
        // One item with "Prefixes Cannot Be Changed" reaches one, the other two.
        const guard = on(w, metaId("prefixesCannotChange"), { crafted: true });
        const y = cItem({
            rarity: "rare",
            influences: hunter,
            mods: [on(w, "HunterP"), on(w, "HunterS"), guard],
        });
        expect(refusal(w, [y, item("HunterP", "HunterQ")], L.DOMINANCE)).toEqual({
            kind: "tooFewInfluenced",
            needed: 2,
            have: 1,
        });
    });
});

// --- the checks' words ----------------------------------------------------------------

describe("the removal checks' words", () => {
    const w = world(
        [row({ id: "Pre", gen: "prefix" }), row({ id: "Suf", gen: "suffix" })],
        RING_BASE,
        ["prefixesCannotChange", "suffixesCannotChange"],
    );
    const both = [
        on(w, metaId("prefixesCannotChange"), { crafted: true }),
        on(w, metaId("suffixesCannotChange"), { crafted: true }),
    ];

    it("refuse a scour of a Normal item, or of one with both sides protected", () => {
        expect(refusal(w, [cItem()], L.currencyOps("scour"))).toEqual({ kind: "nothingToRemove" });
        const x = cItem({ rarity: "rare", mods: both });
        expect(refusal(w, [x], L.currencyOps("scour"))).toEqual({ kind: "nothingToRemove" });
    });

    it("name the protected side an Eldritch Orb of Annulment would reach", () => {
        const b = world([row({ id: "Pre", gen: "prefix" })], BOOTS_BASE, ["prefixesCannotChange"]);
        const x = cItem({
            rarity: "rare",
            mods: [on(b, "Pre"), on(b, metaId("prefixesCannotChange"), { crafted: true })],
            exarch: { tier: 3, type: TypeId("ImplicitBlaze") },
        });
        expect(refusal(b, [x], L.eldritchAnnulOps("exarch"))).toEqual({
            kind: "sideProtected",
            gen: "prefix",
            what: "An Eldritch Orb of Annulment",
        });
    });

    it("name the protected side an influenced modifier sits on", () => {
        const cat = generateCatalog(9600, {
            base: "boots",
            types: 2,
            influence: true,
            metamods: ["prefixesCannotChange", "suffixesCannotChange"],
        });
        const c = ofCatalog(cat);
        const hunterRow = cat.influence!;
        const x = cItem({
            rarity: "rare",
            influences: influenceKey(["hunter"]),
            mods: [
                on(c, hunterRow.id),
                on(
                    c,
                    metaId(
                        hunterRow.gen === "prefix"
                            ? "prefixesCannotChange"
                            : "suffixesCannotChange",
                    ),
                    { crafted: true },
                ),
            ],
        });
        expect(refusal(c, [x], L.HARVEST_RANDOMISE)).toEqual({
            kind: "influencedOnProtected",
            what: "The grove's randomise craft",
            gen: hunterRow.gen,
        });
    });
});

// --- what a removal keeps of the facts about an item ----------------------------------------

describe("what the removals keep of what the item is known to be", () => {
    it("an annul loop's head on three prefixes and a fractured suffix has a prefix to take while every item holds one", () => {
        const w = world([
            row({ id: "P1", gen: "prefix" }),
            row({ id: "P2", gen: "prefix" }),
            row({ id: "P3", gen: "prefix" }),
            row({ id: "S1", gen: "suffix" }),
        ]);
        const start = cItem({
            rarity: "rare",
            mods: [on(w, "P1"), on(w, "P2"), on(w, "P3"), on(w, "S1", { fractured: true })],
        });
        const prefixes = conditionOf(w.u, {
            kind: "compare",
            projection: "prefixCount",
            op: ">=",
            value: 1,
        });
        const m = w.u.dd;
        let s: ItemSet = fromItems(w.u, [start])!;
        let head = s.dd;
        for (let round = 1; round <= 3; round++) {
            const r = runMethod({ u: w.u, dd: m.and(s.dd, prefixes) }, L.currencyOps("annul"));
            expect(r.ok, `round ${round}`).toBe(true);
            s = r.state;
            expect(counts(s).prefix).toEqual([3 - round, 3 - round]);
            expect(counts(s).suffix).toEqual([1, 1]);
            head = m.or(head, s.dd);
        }
        // The loop's head unites the rounds; its body runs where a prefix is left.
        expect(runMethod({ u: w.u, dd: m.and(head, prefixes) }, L.currencyOps("annul")).ok).toBe(
            true,
        );
        expect(runMethod({ u: w.u, dd: head }, L.currencyOps("annul"))).toMatchObject({
            ok: false,
            failure: { kind: "nothingToRemove" },
        });
    });

    it("an Eldritch Chaos Orb leaves what the kept side was untouched", () => {
        const w = world(
            [
                row({ id: "P1", gen: "prefix" }),
                row({ id: "P2", gen: "prefix" }),
                row({ id: "P3", gen: "prefix" }),
                row({ id: "FireRes", gen: "suffix" }),
                row({ id: "ColdRes", gen: "suffix" }),
                row({ id: "S3", gen: "suffix" }),
            ],
            BOOTS_BASE,
        );
        const exarch = { tier: 3, type: TypeId("ImplicitBlaze") };
        const start = [
            cItem({ rarity: "rare", exarch, mods: [on(w, "P1"), on(w, "FireRes"), on(w, "S3")] }),
            cItem({ rarity: "rare", exarch, mods: [on(w, "P2"), on(w, "ColdRes")] }),
        ];
        const s = fromItems(w.u, start)!;
        const r = runMethod(s, L.eldritchChaosOps("exarch"), STUBS.exact);
        expect(r.ok).toBe(true);
        const m = w.u.dd;
        const prefixSlots = w.u.modSlots().filter((x) => w.u.modSlot(x)!.sides.has("prefix"));
        // Every item's suffixes are one start item's, and both are reached.
        expect(m.forget(r.state.dd, prefixSlots)).toBe(m.forget(s.dd, prefixSlots));
        outcomes(w, start.slice(1), L.eldritchChaosOps("exarch"));
    });

    it("a Harvest augment of a speed modifier on boots leaves no more suffixes than it found", () => {
        const w = world(
            [
                row({ id: "MoveSpeed", gen: "prefix", implicitTags: ["speed"] }),
                row({ id: "P1", gen: "prefix" }),
                row({ id: "P2", gen: "prefix" }),
                row({ id: "S1", gen: "suffix" }),
                row({ id: "S2", gen: "suffix" }),
            ],
            BOOTS_BASE,
        );
        const start = cItem({
            rarity: "rare",
            mods: [on(w, "P1"), on(w, "P2"), on(w, "S1"), on(w, "S2")],
        });
        const ops = L.harvestAugmentOps(TagId("speed"));
        const out = outcomes(w, [start], ops);
        expect(out.every((x) => x.mods.some((m) => m.row === "MoveSpeed"))).toBe(true);
        const r = runMethod(fromItems(w.u, [start])!, ops);
        expect(counts(r.state).suffix).toEqual([1, 2]);
        expect(counts(r.state).prefix).toEqual([2, 3]);
        expect(runMethod(r.state, [req({ kind: "openSlot", gen: "suffix" })]).ok).toBe(true);
    });
});

// --- the partial protections ---------------------------------------------------------

describe("a partial protection", () => {
    // Version 3.30.0 (Endgame): "1 Prefix Modifier cannot be changed" and its
    // siblings; which modifiers it keeps is chosen at random each use (ruled).
    const w = world(
        [
            row({ id: "P1", gen: "prefix" }),
            row({ id: "P2", gen: "prefix" }),
            row({ id: "P3", gen: "prefix" }),
            row({ id: "S1", gen: "suffix" }),
        ],
        RING_BASE,
        ["onePrefixCannotChange", "twoPrefixesCannotChange"],
    );
    const one = metaId("onePrefixCannotChange");
    const two = metaId("twoPrefixesCannotChange");
    const rare = (ids: string[], meta: string): CItem =>
        cItem({
            rarity: "rare",
            mods: [...ids.map((id) => on(w, id)), on(w, meta, { crafted: true })],
        });

    it("keeps one of three prefixes through a scour, any one of them", () => {
        const out = outcomes(w, [rare(["P1", "P2", "P3"], one)], L.currencyOps("scour"));
        expect(sorted(rowsOf(out))).toEqual([["P1"], ["P2"], ["P3"]]);
    });

    it("keeps two of three, any two, under the two-prefix protection", () => {
        const out = outcomes(w, [rare(["P1", "P2", "P3"], two)], L.currencyOps("scour"));
        expect(sorted(rowsOf(out))).toEqual(
            sorted([
                ["P1", "P2"],
                ["P1", "P3"],
                ["P2", "P3"],
            ]),
        );
    });

    it("keeps the whole side where it holds no more than the protection keeps", () => {
        expect(rowsOf(outcomes(w, [rare(["P1"], one)], L.currencyOps("scour")))).toEqual([["P1"]]);
        const kept = outcomes(w, [rare(["P1", "P2"], two)], L.currencyOps("scour"));
        expect(sorted(rowsOf(kept))).toEqual([["P1", "P2"]]);
        // The side kept whole refuses the Eldritch Orb of Annulment as the full
        // protection does (QUESTIONS.md Q128).
        expect(
            refusal(
                w,
                [rare(["P1"], one)],
                [req({ kind: "unprotectedSide", gen: "prefix", what: "An orb" })],
            ),
        ).toEqual({ kind: "sideProtected", gen: "prefix", what: "An orb" });
    });

    it("lets an annul take any modifier but the kept one, the metamod among them", () => {
        const out = outcomes(w, [rare(["P1", "P2", "S1"], one)], L.currencyOps("annul"));
        expect(sorted(rowsOf(out))).toEqual(
            sorted([
                ["P2", "S1", one],
                ["P1", "S1", one],
                ["P1", "P2", one],
                ["P1", "P2", "S1"],
            ]),
        );
    });

    it("refuses a removal where some choice leaves nothing to take", () => {
        // The one prefix not fractured may be the kept one.
        const item = cItem({
            rarity: "rare",
            mods: [on(w, "P1"), on(w, "P2", { fractured: true }), on(w, one, { crafted: true })],
        });
        const sideOnly: Op[] = [
            req({ kind: "removable", selector: { kind: "random", gen: "prefix" } }),
        ];
        expect(refusal(w, [item], sideOnly)).toEqual({ kind: "nothingToRemove" });
    });
});
