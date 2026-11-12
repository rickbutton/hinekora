import { describe, expect, it } from "vitest";
import type {
    Check,
    FillCount,
    Op,
    PoolSpec,
    PreconditionFailure,
    Transform,
} from "./ops/types.js";
import { JEWEL_BASE, RING_BASE, SIMPLEX_BASE } from "../__fixtures__/mods.js";
import type { Base } from "../model/base.js";
import { type Gen, ModId, TagId } from "../model/ids.js";
import type { Mod } from "../model/mod.js";
import type { EssenceSpec } from "../model/sources.js";
import { buildRegistry, type Registry } from "../resolve/registry.js";
import { runMethod } from "./method.js";
import type { Handlers } from "./ops/handler.js";
import { HANDLERS } from "./ops/registry.js";
import { benchCraft, metamod, modRow } from "./reference/catalog.js";
import { compareMethod } from "./reference/harness.js";
import { type CItem, cItem, cMod, refCtx, type RefCtx } from "./reference/item.js";
import { listItems } from "./reference/listing.js";
import type { RefHandlers } from "./reference/ops/handler.js";
import { REF_HANDLERS } from "./reference/ops/registry.js";
import { CItemSet } from "./reference/sets.js";
import { fromItems } from "./state.js";
import { buildUniverse, type Universe } from "./universe.js";

const req = (check: Check): Op => ({ kind: "require", check });
const fill = (pool: PoolSpec, count: FillCount): Transform => ({ kind: "fill", pool, count });
const add = (lo = 1, hi = lo): FillCount => ({ kind: "add", n: [lo, hi] });
const reforge = (n: readonly [number, number] | "byRarity"): FillCount => ({ kind: "reforge", n });
const within: FillCount = { kind: "within" };
const natural: PoolSpec = { kind: "natural" };
const strands: Op = { kind: "strands", consume: 0 };

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

const row = (id: string, gen: Gen, extra: Partial<Parameters<typeof modRow>[0]> = {}): Mod =>
    modRow({ id, type: `Type${id.replace(/\d+$/, "")}`, gen, text: `+1 to ${id}`, ...extra });

interface World {
    readonly registry: Registry;
    readonly base: Base;
    readonly u: Universe;
    readonly ctx: RefCtx;
}

function world(
    mods: readonly Mod[],
    base: Base = RING_BASE,
    ilvl = 84,
    essences: EssenceSpec[] = [],
): World {
    const benchCrafts = mods
        .filter((m) => m.source === "bench")
        .map((m) => benchCraft(m, base.itemClass));
    const registry = buildRegistry({ bases: [base], mods, essences, benchCrafts });
    return {
        registry,
        base,
        u: buildUniverse(registry, base, ilvl, undefined),
        ctx: refCtx(registry, base, ilvl),
    };
}

/** The items the method leaves, both frames agreeing. */
function leaves(w: World, items: readonly CItem[], ops: readonly Op[]): CItemSet {
    const d = compareMethod(w.u, w.ctx, CItemSet.of(items), ops, STUBS);
    expect(d, d).toBe("");
    const r = runMethod(fromItems(w.u, items)!, ops, STUBS.exact);
    return listItems(w.u, r.state.dd, { lowest: true });
}

const totals = (s: CItemSet): number[] => [...new Set(s.items().map((x) => x.mods.length))].sort();
const rowsOn = (s: CItemSet): Set<string> =>
    new Set(s.items().flatMap((x) => x.mods.map((m) => m.row)));

const P = ["A1", "B1", "C1"].map((id) => row(id, "prefix"));
const S = ["D1", "E1", "F1"].map((id) => row(id, "suffix"));
const rare = (mods: CItem["mods"] = [], extra: Partial<CItem> = {}): CItem =>
    cItem({ rarity: "rare", mods, ...extra });

describe("how many modifiers a fill lays", () => {
    const w = world([...P, ...S]);

    it("a rare reforge leaves four to six, what is on the item counting", () => {
        expect(totals(leaves(w, [rare()], [fill(natural, reforge([4, 6]))]))).toEqual([4, 5, 6]);
        const fractured = cMod(ModId("A1"), 1, { fractured: true });
        const out = leaves(w, [rare([fractured])], [fill(natural, reforge([4, 4]))]);
        expect(totals(out)).toEqual([4]);
        expect(out.every((x) => x.mods.some((m) => m.row === "A1" && m.fractured))).toBe(true);
    });

    it("a reforge lays what fits when the pool runs dry", () => {
        const small = world([P[0]!, S[0]!]);
        expect(totals(leaves(small, [rare()], [fill(natural, reforge([4, 6]))]))).toEqual([2]);
    });

    it("a Magic reforge or a transmute lays one or two, one a side", () => {
        const magic = cItem({ rarity: "magic" });
        const out = leaves(w, [magic], [fill(natural, reforge("byRarity"))]);
        expect(totals(out)).toEqual([1, 2]);
        expect(leaves(w, [magic], [fill(natural, add(1, 2))]).equals(out)).toBe(true);
        expect(totals(leaves(w, [cItem()], [fill(natural, reforge("byRarity"))]))).toEqual([0]);
    });

    it("a Rare jewel's reforge leaves three or four", () => {
        const jw = world([...P, ...S], JEWEL_BASE);
        expect(totals(leaves(jw, [rare()], [fill(natural, reforge([4, 6]))]))).toEqual([3, 4]);
    });

    it("a transmute on a Simplex Amulet, which holds no modifier when Magic, lays none", () => {
        // Simplex Amulet § Special Crafting Considerations; the add holds to none.
        const sw = world([...P, ...S], SIMPLEX_BASE);
        const ops: Op[] = [{ kind: "rarity", rarity: "magic" }, fill(natural, add(1, 2))];
        const out = leaves(sw, [cItem()], ops);
        expect(out.equals(CItemSet.of([cItem({ rarity: "magic" })]))).toBe(true);
    });

    it("an add on a full item has no outcome: a refusal, but for an either's other branch", () => {
        const full = rare([...P, ...S].map((m) => cMod(m.id, 1)));
        const ops: Op[] = [
            { kind: "either", branches: [[fill(natural, add())], [{ kind: "corrupt" }]] },
        ];
        const out = leaves(w, [full], ops);
        expect(out.equals(CItemSet.of([{ ...full, corrupted: true }]))).toBe(true);
        // Outside an either, the add refuses the method on it.
        expect(runMethod(fromItems(w.u, [full])!, [fill(natural, add())])).toMatchObject({
            ok: false,
            failure: { kind: "noOutcome", op: "fill" },
            sure: true,
        });
    });

    it("under a protected side, a reforge lays one at least, or reaches the count", () => {
        const guard = metamod("prefixesCannotChange");
        const kw = world([...P, ...S, guard]);
        const g = cMod(guard.id, undefined, { crafted: true });
        // Metamod § Examples: "1 prefix as well as 0 to 3 suffixes ... or 0 prefix
        // and add 1 to 3 suffixes", beside the totals the count alone reaches.
        const one = rare([cMod(ModId("A1"), 1), g]);
        expect(totals(leaves(kw, [one], [fill(natural, reforge([4, 6]))]))).toEqual([3, 4, 5, 6]);
        // Already at the least: kept as it is too, though nothing was laid.
        const four = rare([...P.slice(0, 3), S[0]!].map((m) => cMod(m.id, 1)));
        const at = leaves(
            kw,
            [{ ...four, mods: [...four.mods.slice(0, 3), g] }],
            [fill(natural, reforge([4, 6]))],
        );
        expect(totals(at)).toEqual([4, 5, 6]);
        const two = rare([cMod(ModId("A1"), 1), cMod(ModId("B1"), 1), g]);
        expect(totals(leaves(kw, [two], [fill(natural, reforge([4, 6]))]))).toEqual([4, 5, 6]);
        // Without the metamod, what is on the item counts toward four to six.
        const bare = rare([cMod(ModId("A1"), 1)]);
        expect(totals(leaves(kw, [bare], [fill(natural, reforge([4, 6]))]))).toEqual([4, 5, 6]);
    });

    it("of one side, the other kept, fills that side from one up", () => {
        const kept = rare(["D1", "E1"].map((id) => cMod(ModId(id), 1)));
        const out = leaves(
            w,
            [kept],
            [
                { kind: "keep", gen: "suffix" },
                fill({ kind: "natural", gen: "prefix" }, reforge([4, 6])),
            ],
        );
        expect(totals(out)).toEqual([3, 4, 5]);
    });
});

describe("which rows a draw may lay", () => {
    it("never a row of no weight, above the item level, or past a capped level", () => {
        const zero = row("Z1", "prefix", { spawn: [{ tag: TagId("ring"), weight: 0 }] });
        const high = row("H1", "prefix", { minLevel: 86 });
        const mid = row("M1", "suffix", { minLevel: 60 });
        const w = world([...P, zero, high, mid]);
        const out = leaves(w, [cItem({ rarity: "magic" })], [fill(natural, add())]);
        expect(rowsOn(out)).toEqual(new Set(["A1", "B1", "C1", "M1"]));
        const capped = leaves(
            w,
            [cItem({ rarity: "magic" })],
            [fill({ kind: "natural", maxLevel: 50 }, add())],
        );
        expect(rowsOn(capped)).toEqual(new Set(["A1", "B1", "C1"]));
    });

    it("a row a tag of an earlier draw lets roll, in the same reforge", () => {
        const adder = row("Adder1", "prefix", { addsTags: ["staffy"] });
        const gated = row("Gated1", "suffix", { spawn: [{ tag: TagId("staffy"), weight: 100 }] });
        const w = world([adder, gated, S[0]!]);
        const out = leaves(w, [rare()], [fill(natural, reforge([4, 6]))]);
        expect(out.some((x) => x.mods.some((m) => m.row === "Gated1"))).toBe(true);
        expect(
            out.every(
                (x) =>
                    !x.mods.some((m) => m.row === "Gated1") ||
                    x.mods.some((m) => m.row === "Adder1"),
            ),
        ).toBe(true);
    });

    it("no row a cannot-roll metamod on the item bars", () => {
        const attack = row("Atk1", "prefix", { implicitTags: ["attack"] });
        const guard = metamod("cannotRollAttack");
        const w = world([attack, P[1]!, S[0]!, guard]);
        const held = cItem({
            rarity: "rare",
            mods: [cMod(guard.id, undefined, { crafted: true })],
        });
        expect(rowsOn(leaves(w, [held], [fill(natural, add())])).has("Atk1")).toBe(false);
        expect(rowsOn(leaves(w, [rare()], [fill(natural, add())])).has("Atk1")).toBe(true);
    });

    it("only the top tiers under memory strands, read as the item holds them", () => {
        const ladder = [1, 20, 45, 68, 82].map((lvl, i) =>
            modRow({
                id: `L${i + 1}`,
                type: "TypeL",
                gen: "prefix",
                minLevel: lvl,
                text: `+${i + 1} to L`,
            }),
        );
        const w = world([...ladder, S[0]!]);
        const ops = [fill({ kind: "natural", gen: "prefix" }, add()), strands];
        const at = (n: number): Set<string> =>
            rowsOn(leaves(w, [cItem({ rarity: "magic", strands: n })], ops));
        expect(at(0)).toEqual(new Set(["L1", "L2", "L3", "L4", "L5"]));
        // tiersWithStrands(100, 5) = 2 (Memory strand § Mechanics).
        expect(at(100)).toEqual(new Set(["L4", "L5"]));
        expect(
            rowsOn(leaves(w, [cItem({ rarity: "magic", strands: 100 })], ops.slice(0, 1))),
        ).toEqual(at(0));
    });

    it("a type of rows on both sides ranked by the side with room", () => {
        const both = [
            modRow({ id: "Both1", type: "TypeBoth", gen: "suffix", text: "+1 to Both" }),
            modRow({
                id: "Both2",
                type: "TypeBoth",
                gen: "suffix",
                minLevel: 50,
                text: "+2 to Both",
            }),
            modRow({
                id: "Both3",
                type: "TypeBoth",
                gen: "prefix",
                minLevel: 70,
                text: "+3 to Both",
            }),
        ];
        const w = world([...both, ...P, ...S]);
        const full = rare(
            P.map((m) => cMod(m.id, 1)),
            { strands: 100 },
        );
        // tiersWithStrands(100, 3) = 1: with the prefixes full the top suffix
        // row is the one kept (pool/pool.ts ranks what has room).
        const cut = leaves(w, [full], [fill(natural, add()), strands]);
        expect([...rowsOn(cut)].filter((r) => r.startsWith("Both"))).toEqual(["Both2"]);
        const open = leaves(w, [rare([], { strands: 100 })], [fill(natural, add()), strands]);
        expect([...rowsOn(open)].filter((r) => r.startsWith("Both"))).toEqual(["Both3"]);
        // A Foulborn orb keeps the top of two suffix rows, or two of three.
        const foul = leaves(w, [full, rare()], [fill({ kind: "natural", topTiers: true }, add())]);
        expect([...rowsOn(foul)].filter((r) => r.startsWith("Both")).sort()).toEqual([
            "Both2",
            "Both3",
        ]);
    });
});

describe("a reforge with what it guarantees", () => {
    const only = modRow({
        id: "Ess1",
        type: "TypeEss",
        gen: "prefix",
        text: "+9 to Ess",
        spawn: [{ tag: TagId("default"), weight: 0 }],
        source: "essence",
    });
    const essence: EssenceSpec = {
        id: "E",
        name: "Deafening Essence of Testing",
        tier: 7,
        grants: new Map([[RING_BASE.itemClass, only.id]]),
    };
    const w = world([...P, ...S, only], RING_BASE, 84, [essence]);

    it("lays the essence's row first, counted in the total", () => {
        const out = leaves(
            w,
            [cItem()],
            [
                req({ kind: "essenceGrant", spec: essence }),
                { kind: "rarity", rarity: "rare" },
                fill(natural, reforge([4, 6])),
                fill({ kind: "essenceGrant", spec: essence }, within),
            ],
        );
        expect(totals(out)).toEqual([4, 5, 6]);
        expect(out.every((x) => x.mods.some((m) => m.row === "Ess1"))).toBe(true);
    });

    it("leaves out a guaranteed row a kept modifier's group takes", () => {
        const clash = modRow({
            id: "Clash1",
            type: "TypeClash",
            gen: "suffix",
            families: ["TypeEss"],
            text: "+1 to Clash",
        });
        const cw = world([...P, ...S, only, clash], RING_BASE, 84, [essence]);
        const out = leaves(
            cw,
            [rare([cMod(clash.id, 1, { fractured: true })])],
            [fill(natural, reforge([4, 4])), fill({ kind: "essenceGrant", spec: essence }, within)],
        );
        expect(rowsOn(out).has("Ess1")).toBe(false);
        expect(totals(out)).toEqual([4]);
    });
});

describe("the pool checks", () => {
    const attack = row("Atk1", "suffix", { implicitTags: ["attack"] });
    const guard = metamod("cannotRollAttack");
    const pool: PoolSpec = { kind: "tagged", tag: TagId("attack") };
    const check = req({ kind: "poolNonEmpty", pool, tag: TagId("attack") });
    const why = (w: World, x: CItem): PreconditionFailure | undefined => {
        const r = runMethod(fromItems(w.u, [x])!, [check]);
        return r.ok ? undefined : r.failure;
    };

    it("say why no tagged row lands", () => {
        const clash = row("Clash1", "suffix", { families: ["TypeAtk"] });
        const w = world([attack, ...P, ...S, clash, guard]);
        expect(why(w, rare())).toBeUndefined();
        const kind = (x: CItem): string | undefined => why(w, x)?.kind;
        expect(kind(rare([cMod(guard.id, undefined, { crafted: true })]))).toBe(
            "harvestCannotRoll",
        );
        expect(kind(rare([cMod(clash.id, 1)]))).toBe("harvestBlocked");
        const full = rare([...S.slice(1).map((m) => cMod(m.id, 1)), cMod(clash.id, 1)]);
        expect(kind(full)).toBe("harvestBlocked");
        const both = [
            rare([cMod(guard.id, undefined, { crafted: true })]),
            rare(S.map((m) => cMod(m.id, 1))),
        ];
        expect(runMethod(fromItems(w.u, both)!, [check])).toMatchObject({
            ok: false,
            failure: { kind: "harvestCannotRoll" },
        });
        const noTag = world([...P, ...S]);
        expect(why(noTag, rare())?.kind).toBe("harvestEmptyPool");
    });

    it("say there is no room where the tagged rows' side is full", () => {
        const w = world([attack, ...P, ...S]);
        const full = rare(S.map((m) => cMod(m.id, 1)));
        expect(why(w, full)?.kind).toBe("harvestNoRoom");
        expect(why(w, full)).toEqual({ kind: "harvestNoRoom", tag: "attack" });
    });

    it("word an open slot", () => {
        const w = world([...P, ...S]);
        const r = runMethod(fromItems(w.u, [cItem()])!, [req({ kind: "openSlot", gen: "prefix" })]);
        expect(r.ok ? undefined : r.failure).toEqual({
            kind: "noOpenSlot",
            gen: "prefix",
            normal: true,
        });
    });
});
