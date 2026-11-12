import { describe, expect, it, vi } from "vitest";
import { TALISMAN_BASE } from "../../__fixtures__/mods.js";
import * as L from "../library.js";
import type { Check, Op, PreconditionFailure, Transform } from "./types.js";
import { rollRange } from "../values.js";
import type { Base } from "../../model/base.js";
import { Domain, type Gen, type ModId, TagId, TypeId } from "../../model/ids.js";
import { influenceKey, NO_INFLUENCE } from "../../model/marks.js";
import type { Mod } from "../../model/mod.js";
import { buildRegistry } from "../../resolve/registry.js";
import { runMethod, runMethodTrace } from "../method.js";
import { isVeiledRow } from "./crafted-rows.js";
import {
    benchCraft,
    type Catalog,
    type CatalogOptions,
    generateCatalog,
    modRow,
} from "../reference/catalog.js";
import { atCells, compareMethodOn, harnessStates, harnessUniverse } from "../reference/harness.js";
import { type CItem, cItem, cMod, refCtx } from "../reference/item.js";
import { listItems } from "../reference/listing.js";
import { refRunMethod } from "../reference/method.js";
import type { Bounds } from "../reference/sets.js";
import { CItemSet } from "../reference/sets.js";
import { violations } from "../reference/wellformed.js";
import { fromItems, narrow } from "../state.js";
import type { Universe } from "../universe.js";

// Each property test runs a dozen methods over several hundred items each way.
vi.setConfig({ testTimeout: 60_000 });

const req = (check: Check): Op => ({ kind: "require", check });
const lock = (n: number): Transform => ({ kind: "lock", n });
const corrupt: Op = { kind: "corrupt" };
const end: Transform = { kind: "end" };
const either = (...branches: Transform[][]): Op => ({ kind: "either", branches });
const removeCrafted = (replacing: boolean): Op => ({
    kind: "remove",
    selector: { kind: "crafted", replacing },
});
const veiledAdd: Op = {
    kind: "fill",
    pool: { kind: "veiledPlaceholder" },
    count: { kind: "add", n: [1, 1] },
};
const hunter = influenceKey(["hunter"]);

// --- catalogues ----------------------------------------------------------------------

interface Setup {
    readonly cat: Catalog;
    readonly u: Universe;
}

const setupOf = (cat: Catalog): Setup => ({ cat, u: harnessUniverse(cat) });

const byId = (cat: Catalog, id: string): Mod => {
    const m = cat.mods.find((x) => (x.id as string) === id);
    if (m === undefined) throw new Error(`no row ${id}`);
    return m;
};

/** The catalogue on another base, with more rows; the bench rows craftable
 *  on the base's class. */
function rebuilt(
    cat: Catalog,
    extra: {
        base?: Base;
        mods?: readonly Mod[];
        bench?: readonly Mod[];
        aspects?: Readonly<Record<string, string>>;
    } = {},
): Catalog {
    const base = extra.base ?? cat.base;
    const mods = [...cat.mods, ...(extra.mods ?? []), ...(extra.bench ?? [])];
    const registry = buildRegistry({
        bases: [base],
        mods,
        benchCrafts: mods
            .filter((m) => m.source === "bench")
            .map((m) => benchCraft(m, base.itemClass)),
        eldritch: cat.eldritch,
        ...(extra.aspects !== undefined && { aspects: extra.aspects }),
    });
    const held = (m: Mod): Mod => registry.catalog.find((x) => x.id === m.id)!;
    return {
        ...cat,
        registry,
        base,
        ctx: refCtx(registry, base, cat.ilvl),
        mods: registry.catalog,
        natural: cat.natural.map(held),
        bench: cat.bench && held(cat.bench),
        veiled: cat.veiled.map(held),
        metamods: cat.metamods.map(held),
    };
}

/** The first row of `k` natural types, of both sides where it can, no two
 *  sharing a group. */
function naturals(cat: Catalog, k: number): Mod[] {
    const out: Mod[] = [];
    const free = (m: Mod): boolean =>
        !out.some((x) => x.type === m.type || [...x.families].some((f) => m.families.has(f)));
    for (const gen of ["prefix", "suffix"] as const) {
        const m = cat.natural.find((x) => x.gen === gen && free(x));
        if (m !== undefined && out.length < k) out.push(m);
    }
    for (const m of cat.natural) if (out.length < k && free(m)) out.push(m);
    return out;
}

const ids = (rows: readonly (Mod | undefined)[]): ModId[] =>
    rows.filter((m): m is Mod => m !== undefined).map((m) => m.id);

function statesOf(s: Setup, seed: number, bounds: Bounds, random = 10): CItemSet[] {
    return harnessStates(s.u, s.cat.ctx, seed, {
        bounds,
        random,
        maxSize: random < 10 ? 10 : 30,
    });
}

function exact(s: Setup, states: readonly CItemSet[], ops: readonly Op[]): void {
    const d = compareMethodOn(s.u, s.cat.ctx, states, ops);
    expect(d, d).toBe("");
}

const CHECKS = (cat: Catalog): Check[] => [
    { kind: "atLeast", count: 2 },
    { kind: "atLeast", count: 4, what: "The Bestiary's fracture" },
    { kind: "noFracture" },
    { kind: "craftedBelowCap" },
    { kind: "craftedRemovable" },
    { kind: "craftedReplaceable" },
    { kind: "noGroupConflict", mod: cat.natural[0]! },
    { kind: "noGroupConflict", mod: cat.natural[1]!, replacing: cat.natural[1]!.type },
    ...(cat.bench ? [{ kind: "noGroupConflict", mod: cat.bench } as const] : []),
    { kind: "metamodFits" },
    { kind: "veiledPresent" },
    { kind: "noVeiled" },
    { kind: "noVeiledKept" },
    { kind: "unveilTarget", type: TypeId("TypeUnveiledPrefix"), name: "the prefix" },
    { kind: "unveilTarget", type: TypeId("TypeUnveiledSuffix"), name: "the suffix" },
];

const CONFIGS: readonly [string, CatalogOptions][] = [
    [
        "ring",
        {
            base: "ring",
            types: 4,
            bench: true,
            veiled: true,
            metamods: ["multimod", "prefixesCannotChange", "suffixesCannotChange"],
        },
    ],
    [
        "boots",
        {
            base: "boots",
            types: 4,
            bench: true,
            veiled: true,
            influence: true,
            metamods: ["multimod", "cannotRollAttack"],
        },
    ],
    ["jewel", { base: "jewel", types: 4, bench: true, veiled: true, metamods: ["multimod"] }],
];

describe("the crafted family over tiny catalogues", () => {
    CONFIGS.forEach(([name, options], i) => {
        const seed = 8000 + 20 * i;
        const s = setupOf(generateCatalog(seed, options));
        const { cat } = s;
        const multimod = cat.metamods[0];
        const guard = cat.metamods[1];
        const nat = naturals(cat, 4);
        const influences = cat.influence ? [NO_INFLUENCE, hunter] : [NO_INFLUENCE];
        const rare: Bounds["rarities"] = ["magic", "rare"];

        it(`${name}: every check refuses the same items`, () => {
            const crafts = statesOf(s, seed + 1, {
                rows: ids([cat.bench, multimod, cat.veiled[0], nat[1]]),
                rarities: rare,
                fractured: true,
                crafted: true,
            });
            const veiled = statesOf(s, seed + 2, {
                rows: ids([cat.veiled[1], cat.veiled[3], guard, nat[0]]),
                rarities: rare,
                fractured: true,
                influences,
            });
            for (const c of CHECKS(cat)) {
                exact(s, crafts, [req(c), corrupt]);
                exact(s, veiled, [req(c), corrupt]);
            }
        });

        it(`${name}: the crafted removals`, () => {
            const states = statesOf(s, seed + 3, {
                rows: ids([cat.bench, multimod, guard, nat[0]]),
                rarities: rare,
                fractured: true,
                crafted: true,
            });
            exact(s, states, [removeCrafted(false)]);
            exact(s, states, [removeCrafted(true)]);
            exact(s, states, L.BENCH_REMOVE);
            exact(s, states, [req({ kind: "craftedReplaceable" }), removeCrafted(true)]);
        });

        it(`${name}: a bench craft and the Bestiary's metamod`, () => {
            const states = statesOf(s, seed + 7, {
                rows: ids([cat.bench, multimod, guard, nat[0], nat[1]]),
                rarities: rare,
                fractured: true,
                crafted: true,
            });
            exact(s, states, L.benchOps(cat.bench!));
            exact(s, states, L.benchOps(multimod!));
            exact(s, states, L.BEAST_METAMOD);
        });

        it(`${name}: a fracture`, () => {
            const states = statesOf(s, seed + 10, {
                rows: ids([...nat, cat.bench, multimod]),
                rarities: ["rare"],
                fractured: true,
                influences,
            });
            exact(s, states, L.currencyOps("fracture"));
            // An influenced item takes no fracture: the library's check refuses it.
            const clean = req({ kind: "noInfluence", what: "A fracture" });
            exact(s, states, [clean, either([lock(1)], [end])]);
            exact(s, states, [clean, either([lock(2)], [end])]);
            exact(s, states, [clean, lock(2)]);
        });

        it(`${name}: a veiled modifier added and unveiled`, () => {
            const bounds: Bounds = {
                rows: ids([cat.veiled[0], cat.veiled[1], cat.veiled[2], guard, nat[0]]),
                rarities: rare,
                fractured: true,
                influences,
                strands: [0, 40],
            };
            const states = statesOf(s, seed + 14, bounds);
            exact(s, states, [req({ kind: "noVeiled" }), req({ kind: "openSlot" }), veiledAdd]);
            exact(s, states, L.unveilOps(undefined));
            exact(
                s,
                states,
                L.unveilOps({ type: TypeId("TypeUnveiledPrefix"), name: "the prefix" }),
            );
            exact(s, states, L.VEILED_EXALT);
            exact(s, statesOf(s, seed + 17, bounds, 6), L.VEILED_CHAOS);
        });
    });
});

// --- the documented decisions, item by item ------------------------------------------

const valueOf = (m: Mod): number | undefined =>
    m.text === undefined ? undefined : rollRange(m.text)?.[0];
const at = (m: Mod, marks: { fractured?: boolean; crafted?: boolean } = {}) =>
    cMod(m.id, valueOf(m), { crafted: m.source === "bench", ...marks });

/** The items the method leaves on the items, symbolic and reference agreeing. */
function outcomes(
    s: Setup,
    items: CItem[],
    ops: readonly Op[],
): { items: CItem[]; failure: PreconditionFailure | undefined } {
    for (const x of items) expect(violations(x, s.cat.ctx)).toEqual([]);
    const r = runMethod(fromItems(s.u, items)!, ops);
    const got = listItems(s.u, r.state.dd, { lowest: true });
    const ref = refRunMethod(CItemSet.of(items), ops, s.cat.ctx);
    expect(got.keys()).toEqual(
        CItemSet.of(ref.state.items().map((x) => s.u.decodeOne(s.u.encode(x)))).keys(),
    );
    expect(r.ok).toBe(ref.ok);
    return { items: got.items(), failure: r.ok ? undefined : r.failure };
}

describe("a bench craft", () => {
    const base = generateCatalog(8100, {
        types: 5,
        bench: true,
        sharedFamily: false,
        metamods: ["multimod", "prefixesCannotChange"],
    });
    const second = modRow({
        id: "BenchSecond",
        type: "TypeSecondCraft",
        gen: "prefix",
        text: "+(3-4) to Second",
        spawn: [],
        domain: Domain("crafted"),
        source: "bench",
    });
    const cat = rebuilt(base, { bench: [second] });
    const s = setupOf(cat);
    const [multimod, guard] = cat.metamods;
    const bench = cat.bench!;
    const craft = byId(cat, "BenchSecond");
    const others = naturals(cat, 5).filter(
        (m) => ![...m.families].some((f) => bench.families.has(f)),
    );
    const rareWith = (...mods: ReturnType<typeof at>[]) => cItem({ rarity: "rare", mods });
    const crafts = (x: CItem): string[] =>
        x.mods
            .filter((m) => m.crafted)
            .map((m) => m.row as string)
            .sort();

    it("replaces the one crafted modifier under a limit of one", () => {
        const item = rareWith(at(bench), at(others[0]!));
        const out = outcomes(s, [item], L.benchOps(craft));
        expect(out.failure).toBeUndefined();
        expect(out.items.map(crafts)).toEqual([["BenchSecond"]]);
    });

    it("adds beside the crafted modifiers under the multimod, which counts toward its three", () => {
        const item = rareWith(at(multimod!), at(bench));
        const out = outcomes(s, [item], L.benchOps(craft));
        expect(out.items.map(crafts)).toEqual([
            ["BenchSecond", bench.id as string, multimod!.id as string].sort(),
        ]);
        const full = rareWith(at(multimod!), at(bench), at(guard!));
        expect(outcomes(s, [full], L.benchOps(craft)).failure).toEqual({
            kind: "craftedLimit",
            cap: 3,
        });
    });

    it("cannot replace a fractured crafted modifier, nor one of two left by an annulled multimod", () => {
        const fractured = rareWith(at(bench, { fractured: true }), at(others[0]!));
        expect(outcomes(s, [fractured], L.benchOps(craft)).failure).toEqual({
            kind: "craftedFractured",
        });
        const two = rareWith(at(bench), at(guard!));
        expect(violations(two, cat.ctx)).toEqual([]);
        expect(outcomes(s, [two, fractured], L.benchOps(craft)).failure).toEqual({
            kind: "craftedMultiple",
        });
    });

    it("refuses a modifier of the row's group, the one it replaces excepted", () => {
        const natural = cat.natural.find((m) => m.type === bench.type)!;
        const item = rareWith(at(natural));
        expect(outcomes(s, [item], L.benchOps(bench)).failure).toMatchObject({
            kind: "modConflict",
            among: [],
        });
        // The crafted one of the group is replaced first, so it is no conflict.
        expect(outcomes(s, [rareWith(at(bench))], L.benchOps(bench)).failure).toBeUndefined();
        const check = req({ kind: "noGroupConflict", mod: bench, replacing: bench.type });
        expect(outcomes(s, [item], [check]).failure).toBeUndefined();
    });

    it("lays its row crafted at any value of its span", () => {
        const out = runMethod(fromItems(s.u, [rareWith(at(others[0]!))])!, L.benchOps(craft));
        const all = listItems(s.u, out.state.dd);
        const values = new Set(
            all.items().map((x) => x.mods.find((m) => m.row === craft.id)?.value),
        );
        expect([...values].sort()).toEqual([3, 4]);
        expect(all.every((x) => x.mods.find((m) => m.row === craft.id)!.crafted)).toBe(true);
    });

    it("clears every crafted modifier at the bench but a fractured one", () => {
        const item = rareWith(at(multimod!), at(bench, { fractured: true }), at(guard!));
        const out = outcomes(s, [item], L.BENCH_REMOVE);
        expect(out.items.map(crafts)).toEqual([[bench.id as string]]);
        expect(
            outcomes(s, [rareWith(at(bench, { fractured: true }))], L.BENCH_REMOVE).failure,
        ).toEqual({ kind: "noCraftedToRemove" });
    });

    it("words the limit by the items that reach it", () => {
        const one = rareWith(at(bench));
        const r = outcomes(s, [one], [req({ kind: "craftedBelowCap", refusal: "no metamod" })]);
        expect(r.failure).toEqual({ kind: "craftedLimit", cap: 1, refusal: "no metamod" });
    });
});

describe("the Bestiary's metamod", () => {
    const cat = generateCatalog(8200, {
        types: 4,
        metamods: ["multimod", "prefixesCannotChange", "suffixesCannotChange"],
    });
    const s = setupOf(cat);
    const [multimod, prefixes, suffixes] = cat.metamods;
    const nat = naturals(cat, 4);
    const suffix = nat.filter((m) => m.gen === "suffix");

    it("is one of the metamods not on the item whose side has room, crafted", () => {
        const out = outcomes(
            s,
            [cItem({ rarity: "rare", mods: [at(multimod!)] })],
            L.BEAST_METAMOD,
        );
        const added = out.items.map((x) => x.mods.find((m) => m.row !== multimod!.id)!);
        expect(added.map((m) => m.row).sort()).toEqual([prefixes!.id, suffixes!.id].sort());
        expect(added.every((m) => m.crafted)).toBe(true);
    });

    it("is the prefix one where the suffixes are full, and none fits a full item", () => {
        // A Magic item: one suffix fills its suffixes.
        const magic = cItem({ rarity: "magic", mods: [at(suffix[0]!)] });
        const out = outcomes(s, [magic], L.BEAST_METAMOD);
        expect(out.items.map((x) => x.mods.map((m) => m.row).sort())).toEqual([
            [suffix[0]!.id, suffixes!.id].sort(),
        ]);
        const full = cItem({
            rarity: "magic",
            mods: [at(nat.find((m) => m.gen === "prefix")!), at(suffix[0]!)],
        });
        expect(outcomes(s, [full], L.BEAST_METAMOD).failure).toEqual({ kind: "noMetamodFits" });
    });
});

describe("a fracture", () => {
    const cat = generateCatalog(8300, {
        types: 8,
        bench: true,
        influence: true,
        sharedFamily: false,
        metamods: ["multimod"],
    });
    const s = setupOf(cat);
    const nat = naturals(cat, 8).filter((m) => m.type !== cat.bench!.type);

    it("may fracture any one of the item's modifiers, a crafted one and a metamod among them", () => {
        const mods = [at(nat[0]!), at(nat[1]!), at(cat.bench!), at(cat.metamods[0]!)];
        const item = cItem({ rarity: "rare", mods });
        const out = outcomes(s, [item], L.currencyOps("fracture"));
        const which = out.items.map((x) => x.mods.filter((m) => m.fractured).map((m) => m.row));
        expect(which.map((w) => w.length)).toEqual([1, 1, 1, 1]);
        expect(which.flat().sort()).toEqual(mods.map((m) => m.row).sort());
    });

    it("leaves every modifier of every item of four fractured on some outcome of it", () => {
        // Each item alone: whichever of its modifiers a craft names, an outcome
        // of that item has that one fractured, and one fracture gives four.
        const rows = naturals(cat, 6);
        const items: CItem[] = [];
        for (let i = 0; i < rows.length; i++) {
            const four = rows.filter((_, j) => j !== i && j !== (i + 1) % rows.length).slice(0, 4);
            const x = cItem({ rarity: "rare", mods: four.map((m) => at(m)) });
            if (violations(x, cat.ctx).length === 0) items.push(x);
        }
        expect(items.length).toBeGreaterThan(1);
        for (const x of items) {
            const r = runMethod(fromItems(s.u, [x])!, L.currencyOps("fracture"));
            expect(r.ok).toBe(true);
            expect(listItems(s.u, r.state.dd, { lowest: true }).size).toBe(4);
            for (const m of x.mods) {
                const row = rows.find((y) => y.id === m.row)!;
                const named = narrow(r.state, { kind: "fractured", type: row.type });
                expect(named, row.id).not.toBeNull();
            }
        }
        const all = runMethod(fromItems(s.u, items)!, L.currencyOps("fracture"));
        expect(listItems(s.u, all.state.dd, { lowest: true }).size).toBe(items.length * 4);
        const two = runMethod(fromItems(s.u, items)!, [lock(2)]);
        expect(listItems(s.u, two.state.dd, { lowest: true }).size).toBe(items.length * 6);
    });

    it("needs four modifiers, none fractured, no influence", () => {
        const three = cItem({ rarity: "rare", mods: nat.slice(0, 3).map((m) => at(m)) });
        expect(outcomes(s, [three], L.currencyOps("fracture")).failure).toEqual({
            kind: "tooFewMods",
            needed: 4,
        });
        const done = cItem({
            rarity: "rare",
            mods: [at(nat[0]!, { fractured: true }), ...nat.slice(1, 4).map((m) => at(m))],
        });
        const plain = cItem({ rarity: "rare", mods: nat.slice(0, 4).map((m) => at(m)) });
        expect(
            outcomes(s, [done, plain], [req({ kind: "noFracture", what: "no" })]).failure,
        ).toEqual({ kind: "alreadyFractured", what: "no" });
        const marked = cItem({ ...plain, influences: hunter });
        expect(outcomes(s, [marked], L.currencyOps("fracture")).failure).toMatchObject({
            kind: "influenced",
        });
    });

    it("of two on a talisman fractures every pair", () => {
        const t = setupOf(rebuilt(cat, { base: TALISMAN_BASE }));
        const side = (gen: Gen) =>
            naturals(t.cat, 8)
                .filter((m) => m.gen === gen)
                .slice(0, 3);
        const rows = [...side("prefix"), ...side("suffix")];
        expect(rows).toHaveLength(6);
        const item = cItem({ rarity: "rare", mods: rows.map((m) => at(m)) });
        const out = outcomes(t, [item], L.beastFractureOps(2));
        expect(out.items).toHaveLength(15);
    });
});

describe("a veiled modifier", () => {
    const base = generateCatalog(8400, {
        types: 5,
        veiled: true,
        sharedFamily: false,
        metamods: ["prefixesCannotChange", "multimod"],
    });
    const prefixes = naturals(base, 8).filter((m) => m.gen === "prefix");
    const naturalSuffix = base.natural.find((m) => m.gen === "suffix")!;
    // Five prefix results, two sharing a group with a natural prefix each and
    // one the natural suffix's; a suffix result sharing it too; a bench row
    // crafting a veiled modifier.
    const groupOf = (k: number): readonly string[] | undefined =>
        k === 4
            ? [...naturalSuffix.families]
            : k <= 3
              ? prefixes[k - 2] && [...prefixes[k - 2]!.families]
              : undefined;
    const extra = [2, 3, 4, 5, 6].map((k) =>
        modRow({
            id: `UnveiledPrefix${k}`,
            type: `TypeUnveiledP${k}`,
            gen: "prefix",
            text: `+${k} to UnveiledP${k}`,
            domain: Domain("unveiled"),
            source: "veiled",
            spawn: [{ tag: TagId("default"), weight: 100 }],
            ...(groupOf(k) !== undefined && { families: groupOf(k)! }),
        }),
    );
    extra.push(
        modRow({
            id: "UnveiledSuffix2",
            type: "TypeUnveiledS2",
            gen: "suffix",
            text: "+9 to UnveiledS2",
            domain: Domain("unveiled"),
            source: "veiled",
            spawn: [{ tag: TagId("default"), weight: 100 }],
            families: [...naturalSuffix.families],
        }),
    );
    const craftable = modRow({
        id: "BenchVeiledCraft",
        type: "TypeVeiledCraft",
        gen: "suffix",
        text: "+1 to VeiledCraft",
        spawn: [],
        domain: Domain("crafted"),
        source: "bench",
        implicitTags: ["unveiled_mod"],
    });
    const cat = rebuilt(base, { mods: extra, bench: [craftable] });
    const s = setupOf(cat);
    const [vPrefix, vSuffix] = cat.veiled;
    const guard = cat.metamods[0]!;
    const rows = (x: CItem): string[] => x.mods.map((m) => m.row as string).sort();

    it("is one placeholder, of a side with room", () => {
        const item = cItem({ rarity: "rare", mods: prefixes.slice(0, 1).map((m) => at(m)) });
        const out = outcomes(s, [item], [veiledAdd]);
        expect(
            out.items.map((x) => x.mods.find((m) => m.row.startsWith("Veiled"))!.row).sort(),
        ).toEqual([vPrefix!.id, vSuffix!.id].sort());
    });

    it("unveils to every result of its side its groups leave free, keeping its marks", () => {
        const item = cItem({
            rarity: "rare",
            mods: [at(vPrefix!, { fractured: true }), at(prefixes[0]!)],
        });
        const out = outcomes(s, [item], L.unveilOps(undefined));
        const results = out.items.map((x) => x.mods.find((m) => m.row.startsWith("Unveiled"))!);
        // UnveiledPrefix2 shares the present prefix's group.
        expect(results.map((m) => m.row).sort()).toEqual(
            [
                "UnveiledPrefix1",
                "UnveiledPrefix3",
                "UnveiledPrefix4",
                "UnveiledPrefix5",
                "UnveiledPrefix6",
            ].sort(),
        );
        expect(results.every((m) => m.fractured && !m.crafted)).toBe(true);
    });

    it("to a named result only when three or fewer are offered", () => {
        const target = { type: TypeId("TypeUnveiledP5"), name: "Five" };
        const open = cItem({ rarity: "rare", mods: [at(vPrefix!)] });
        expect(outcomes(s, [open], L.unveilOps(target)).failure).toEqual({
            kind: "unveilNotGuaranteed",
            mod: "Five",
            options: 6,
        });
        // Three blocked by their groups leave three.
        const blocked = cItem({
            rarity: "rare",
            mods: [at(vPrefix!), at(prefixes[0]!), at(prefixes[1]!), at(naturalSuffix)],
        });
        const out = outcomes(s, [blocked], L.unveilOps(target));
        expect(out.failure).toBeUndefined();
        expect(out.items.map(rows)).toEqual([
            rows({
                ...blocked,
                mods: [...blocked.mods.slice(1), at(byId(cat, "UnveiledPrefix5"))],
            }),
        ]);
        const wrongSide = { type: TypeId("TypeUnveiledSuffix"), name: "Suffix" };
        expect(outcomes(s, [open], L.unveilOps(wrongSide)).failure).toEqual({
            kind: "unveilNotAvailable",
            mod: "Suffix",
        });
    });

    it("is refused by a veiled orb beside a veiled, unveiled or craftable veiled modifier", () => {
        const check = req({ kind: "noVeiled" });
        for (const m of [vSuffix!, byId(cat, "UnveiledPrefix4"), byId(cat, "BenchVeiledCraft")]) {
            expect(
                outcomes(s, [cItem({ rarity: "rare", mods: [at(m)] })], [check]).failure,
            ).toEqual({
                kind: "alreadyVeiled",
            });
        }
    });

    it("refuses a Veiled Chaos Orb only where its strip keeps one", () => {
        const check = [req({ kind: "noVeiledKept" })];
        const kept = cItem({ rarity: "rare", mods: [at(guard), at(vPrefix!)] });
        expect(outcomes(s, [kept], check).failure).toEqual({ kind: "veiledWouldSurvive" });
        const fractured = cItem({ rarity: "rare", mods: [at(vSuffix!, { fractured: true })] });
        expect(outcomes(s, [fractured], check).failure).toEqual({ kind: "veiledWouldSurvive" });
        const goes = cItem({
            rarity: "rare",
            mods: [at(vSuffix!), at(byId(cat, "BenchVeiledCraft"))],
        });
        expect(outcomes(s, [goes], check).failure).toBeUndefined();
        const out = outcomes(s, [goes], L.VEILED_CHAOS);
        expect(out.items.length).toBeGreaterThan(0);
        expect(
            out.items.every((x) => x.mods.filter((m) => m.row.startsWith("Veiled")).length === 1),
        ).toBe(true);
    });

    it("stays veiled where no result of its side can be offered", () => {
        const t = setupOf(base);
        const [placeholder, , only] = base.veiled;
        const item = cItem({ rarity: "rare", mods: [at(placeholder!), at(only!)] });
        expect(outcomes(t, [item], L.unveilOps(undefined)).items.map(rows)).toEqual([rows(item)]);
    });

    it("needs a placeholder to unveil", () => {
        const none = cItem({ rarity: "rare", mods: [at(prefixes[0]!)] });
        expect(outcomes(s, [none], L.unveilOps(undefined)).failure).toEqual({
            kind: "noVeiledMod",
        });
    });

    it("comes with the Veiled Exalted Orb after one modifier goes", () => {
        const item = cItem({ rarity: "rare", mods: [at(prefixes[0]!), at(naturalSuffix)] });
        const out = outcomes(s, [item], L.VEILED_EXALT);
        expect(out.items.every((x) => x.mods.length === 2)).toBe(true);
        expect(out.items.length).toBeGreaterThan(1);
    });
});

describe("an Aspect", () => {
    it("is laid uncrafted, and refused beside another skill", () => {
        const base = generateCatalog(8500, { types: 4, bench: true });
        const aspect = (id: string, type: string) =>
            modRow({
                id,
                type,
                gen: "suffix",
                text: "Grants the Aspect",
                families: ["GrantedSkill"],
                spawn: [{ tag: TagId("default"), weight: 0 }],
                domain: base.base.domain,
            });
        const cat = rebuilt(base, {
            mods: [aspect("CatAspect30", "TypeCat"), aspect("CrabAspect30", "TypeCrab")],
            aspects: { cat: "CatAspect30", crab: "CrabAspect30" },
        });
        const s = setupOf(cat);
        const cat30 = byId(cat, "CatAspect30");
        const out = outcomes(s, [cItem({ rarity: "rare" })], L.beastAspectOps(cat30));
        expect(out.items.map((x) => x.mods)).toEqual([[cMod(cat30.id, undefined)]]);
        const crab = cItem({ rarity: "rare", mods: [at(byId(cat, "CrabAspect30"))] });
        expect(outcomes(s, [crab], L.beastAspectOps(cat30)).failure).toMatchObject({
            kind: "modConflict",
            refusal: "the Aspect can't be crafted",
        });
    });
});

describe("an unveil among many results", () => {
    const base = generateCatalog(8700, { types: 4, veiled: true, sharedFamily: false });
    const nat = naturals(base, 4);
    const a = nat.find((m) => m.gen === "prefix")!;
    const sfx = nat.find((m) => m.gen === "suffix")!;
    const result = (id: string, type: string, families?: readonly string[], minLevel = 1) =>
        modRow({
            id,
            type,
            gen: "prefix",
            minLevel,
            text: `+(${minLevel}-${minLevel + 1}) to ${type}`,
            domain: Domain("unveiled"),
            source: "veiled",
            spawn: [{ tag: TagId("default"), weight: 100 }],
            ...(families !== undefined && { families }),
        });
    // Beside the catalogue's own prefix result: one sharing the natural
    // prefix's group, one the natural suffix's, a type of two tiers, and two
    // sharing a group with each other.
    const cat = rebuilt(base, {
        mods: [
            result("ResultA", "TypeResultA", [...a.families]),
            result("ResultS", "TypeResultS", [...sfx.families]),
            result("ResultTwo1", "TypeResultTwo", undefined, 1),
            result("ResultTwo2", "TypeResultTwo", undefined, 20),
            result("ResultPairX", "TypeResultPairX", ["FamPair"]),
            result("ResultPairY", "TypeResultPairY", ["FamPair"]),
        ],
    });
    const s = setupOf(cat);
    const [vPrefix, vSuffix, own] = cat.veiled;
    const two = { type: TypeId("TypeResultTwo"), name: "Two" };
    const pair = { type: TypeId("TypeResultPairY"), name: "Pair" };

    it("is exact over fractured and crafted placeholders, the count and the shared group", () => {
        const states = statesOf(s, 8701, {
            rows: ids([vPrefix, vSuffix, a, sfx, own]),
            rarities: ["rare"],
            fractured: true,
            crafted: true,
        });
        exact(s, states, L.unveilOps(undefined));
        exact(s, states, L.unveilOps(two));
        exact(s, states, L.unveilOps(pair));
        exact(s, states, [req({ kind: "unveilTarget", ...two }), corrupt]);
        exact(s, states, [req({ kind: "unveilTarget", ...pair }), corrupt]);
    });

    it("names a result sure only among three offered, none of its group", () => {
        // Three blocked leave the two-tier type and the pair offered.
        const three = cItem({ rarity: "rare", mods: [at(vPrefix!), at(a), at(own!), at(sfx)] });
        const out = outcomes(s, [three], L.unveilOps(two));
        expect(out.failure).toBeUndefined();
        expect(
            out.items.map((x) => x.mods.find((m) => m.row.startsWith("ResultTwo"))!.row).sort(),
        ).toEqual(["ResultTwo1", "ResultTwo2"]);
        expect(outcomes(s, [three], L.unveilOps(pair)).failure).toEqual({
            kind: "unveilNotGuaranteed",
            mod: "Pair",
            options: 3,
        });
        const four = cItem({ rarity: "rare", mods: [at(vPrefix!), at(a), at(sfx)] });
        expect(outcomes(s, [four], L.unveilOps(two)).failure).toEqual({
            kind: "unveilNotGuaranteed",
            mod: "Two",
            options: 4,
        });
    });
});

describe("the veiled orbs on the strip and removal they use", () => {
    const cat = generateCatalog(8800, {
        types: 4,
        veiled: true,
        bench: true,
        metamods: ["prefixesCannotChange", "suffixesCannotChange", "cannotRollAttack"],
    });
    const s = setupOf(cat);
    const nat = naturals(cat, 4);

    it("refuse a Veiled Chaos Orb exactly where the strip keeps a veiled or unveiled modifier", () => {
        const items = statesOf(s, 8801, {
            rows: ids([...cat.veiled.slice(0, 3), cat.metamods[0], cat.metamods[1], nat[0]]),
            rarities: ["rare"],
            fractured: true,
        })[1]!;
        const refused = runMethodTrace(fromItems(s.u, items)!, [
            req({ kind: "noVeiledKept" }),
        ]).failing.get(0);
        const listed =
            refused === undefined ? CItemSet.empty : listItems(s.u, refused, { lowest: true });
        const kept = items.filter((x) =>
            refRunMethod(CItemSet.of([x]), [{ kind: "strip" }], cat.ctx).state.some((y) =>
                y.mods.some((m) => isVeiledRow(cat.ctx.rows.get(m.row)!, false)),
            ),
        );
        expect(kept.size).toBeGreaterThan(0);
        expect(listed.keys()).toEqual(atCells(s.u, kept).keys());
    });

    it("let a Veiled Exalted Orb take a cannot-roll metamod's modifier, never a protected one", () => {
        const [prefixes, , attack] = cat.metamods;
        const prefix = nat.find((m) => m.gen === "prefix")!;
        const item = cItem({
            rarity: "rare",
            mods: [
                at(prefixes!),
                at(attack!),
                at(prefix),
                at(nat.find((m) => m.gen === "suffix")!),
            ],
        });
        const out = outcomes(s, [item], L.VEILED_EXALT);
        expect(out.items.every((x) => x.mods.some((m) => m.row === prefix.id))).toBe(true);
        expect(out.items.some((x) => !x.mods.some((m) => m.row === attack!.id))).toBe(true);
        expect(
            out.items.every((x) => x.mods.filter((m) => m.row.startsWith("Veiled")).length === 1),
        ).toBe(true);
    });
});
