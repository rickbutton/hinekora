import { describe, expect, expectTypeOf, it } from "vitest";
import { initialState } from "../check/astate.js";
import { BddManager } from "../check/bdd.js";
import * as L from "../check/library.js";
import { METHODS } from "../check/methods.js";
import type { Check, Op, Transform } from "../check/ops.js";
import { RING_BASE } from "../__fixtures__/mods.js";
import { canBeRare } from "../model/capacity.js";
import { effectsOf } from "../model/effects.js";
import { type Gen, TagId, TypeId } from "../model/ids.js";
import { INFLUENCES } from "../model/marks.js";
import { metamodCases, runMethod, runMethodTrace } from "./method.js";
import {
    type DispatchKey,
    type Handlers,
    InternalError,
    NotImplementedError,
    outcome,
    type Reads,
    readsFor,
    type RuleField,
} from "./ops/handler.js";
import { CHECK_OWNERS, COMPOUND_OWNERS, type FrameKind, OP_OWNERS } from "./ops/owners.js";
import { FAMILIES, HANDLERS } from "./ops/registry.js";
import {
    checkPlacement,
    type CompoundKind,
    MethodShapeError,
    type Step,
    stepsOf,
} from "./ops/steps.js";
import { generateCatalog } from "./reference/catalog.js";
import { HAND_REGISTRY } from "./reference/hand.js";
import {
    cellCuts,
    compareMethodOn,
    harnessStates,
    harnessUniverse,
    pickRows,
} from "./reference/harness.js";
import { cItem, cMod } from "./reference/item.js";
import { listItems } from "./reference/listing.js";
import { refRunMethod } from "./reference/method.js";
import type { RefHandlers } from "./reference/ops/handler.js";
import { REF_FAMILIES, REF_HANDLERS } from "./reference/ops/registry.js";
import { ItemSet } from "./reference/sets.js";
import type { Rules } from "./rules.js";
import { fromItems } from "./state.js";
import { rarities } from "./views.js";

const req = (check: Check): Op => ({ kind: "require", check });
const corrupt: Transform = { kind: "corrupt" };
const rarity = (r: "normal" | "magic" | "rare"): Transform => ({ kind: "rarity", rarity: r });
const end: Transform = { kind: "end" };
const either = (...branches: Transform[][]): Op => ({ kind: "either", branches });
const ALL_FIELDS: readonly RuleField[] = [
    "protected",
    "cannotRoll",
    "craftedCap",
    "blocksSourced",
    "governed",
    "strands",
];

describe("the families", () => {
    it("own every operation, run and check", () => {
        expectTypeOf<keyof typeof OP_OWNERS>().toEqualTypeOf<FrameKind | DispatchKey>();
        expectTypeOf<keyof typeof COMPOUND_OWNERS>().toEqualTypeOf<CompoundKind>();
        expectTypeOf<keyof typeof CHECK_OWNERS>().toEqualTypeOf<Check["kind"]>();
    });

    it("register only what they own, and both frames the same with the same reads", () => {
        for (const [family, h] of [...Object.entries(FAMILIES), ...Object.entries(REF_FAMILIES)]) {
            for (const k of Object.keys(h.transforms))
                expect(OP_OWNERS[k as DispatchKey], k).toBe(family);
            for (const k of Object.keys(h.compounds))
                expect(COMPOUND_OWNERS[k as CompoundKind], k).toBe(family);
            for (const k of Object.keys(h.checks))
                expect(CHECK_OWNERS[k as Check["kind"]], k).toBe(family);
        }
        // A handler reading by its operation is read on a real one of each
        // shape it may hold; a list ignores it.
        const random = [true, false].map((honourCannotRoll) => ({
            kind: "random",
            honourCannotRoll,
        }));
        const selectors = [
            ...random,
            { kind: "crafted", replacing: true },
            { kind: "type", type: TypeId("TypeX") },
            { kind: "influenced" },
        ];
        const fillOf = (pool: string, count: string): unknown => ({
            kind: "fill",
            pool: { kind: pool },
            count: { kind: count, n: [1, 1] },
        });
        const samples = (k: string, reads: Reads<unknown>): unknown[] => {
            if (typeof reads !== "function") return [undefined];
            if (k.startsWith("fill:")) {
                return ["add", "reforge", "within"].map((count) => fillOf(k.slice(5), count));
            }
            if (k === "remove:random")
                return random.map((selector) => ({ kind: "remove", selector }));
            if (k === "removable") return selectors.map((selector) => ({ kind: k, selector }));
            if (k === "addAnother") {
                return random.map((selector) => ({
                    kind: k,
                    fill: fillOf("tagged", "add"),
                    remove: { kind: "remove", selector },
                }));
            }
            throw new Error(`no sample operation for ${k}, whose reads are by operation`);
        };
        for (const table of ["transforms", "compounds", "checks"] as const) {
            const exact = HANDLERS[table] as Record<string, { reads: Reads<unknown> }>;
            const ref = REF_HANDLERS[table] as Record<string, { reads: Reads<unknown> }>;
            expect(Object.keys(exact).sort()).toEqual(Object.keys(ref).sort());
            for (const k of Object.keys(exact)) {
                expect(typeof exact[k]!.reads, k).toBe(typeof ref[k]!.reads);
                for (const op of samples(k, exact[k]!.reads)) {
                    expect([...readsFor(exact[k]!.reads, op)].sort(), k).toEqual(
                        [...readsFor(ref[k]!.reads, op)].sort(),
                    );
                }
            }
        }
    });

    it("implement every operation, pool, selector, run and check in both frames", () => {
        for (const h of [HANDLERS, REF_HANDLERS] as const) {
            for (const [k, family] of Object.entries(OP_OWNERS)) {
                if (family === "frame") continue;
                expect((h.transforms as Record<string, unknown>)[k], k).toBeDefined();
            }
            for (const k of Object.keys(COMPOUND_OWNERS)) {
                expect((h.compounds as Record<string, unknown>)[k], k).toBeDefined();
            }
            for (const k of Object.keys(CHECK_OWNERS)) {
                expect((h.checks as Record<string, unknown>)[k], k).toBeDefined();
            }
        }
        const cat = generateCatalog(6000, { types: 2 });
        const s = fromItems(harnessUniverse(cat), [cItem()])!;
        const none: Handlers = { ...HANDLERS, transforms: {}, checks: {} };
        expect(() => runMethod(s, [corrupt], none)).toThrow(NotImplementedError);
        expect(() => runMethod(s, [req({ kind: "hasImprint" })], none)).toThrow(/"hasImprint"/);
    });
});

describe("the method frame", () => {
    const cat = generateCatalog(6100, { types: 3 });
    const u = harnessUniverse(cat);
    const rows = pickRows(u, 6100, 3);
    const states = harnessStates(u, cat.ctx, 6100, { bounds: { rows, corrupted: [false, true] } });
    const exact = (
        ops: readonly Op[],
        handlers?: { exact: Handlers; reference: RefHandlers },
    ): void => {
        const d = compareMethodOn(u, cat.ctx, states, ops, handlers);
        expect(d, d).toBe("");
    };

    it("is exact on the marks and their checks", () => {
        exact([corrupt]);
        exact([req({ kind: "notCorrupted" }), corrupt]);
        exact([req({ kind: "corruptedItem", what: "A Tainted Orb" })]);
        exact([req({ kind: "rarity", rarity: "normal" }), rarity("magic")]);
        exact([req({ kind: "rarity", rarity: "magic" }), corrupt]);
        exact([req({ kind: "notMagic" }), req({ kind: "notNormal" }), corrupt]);
        exact([req({ kind: "notNormal" }), req({ kind: "canBeRare" }), rarity("rare")]);
    });

    it("is exact on several value cells", () => {
        const v = harnessUniverse(cat, { comparisons: cellCuts(harnessUniverse(cat)) });
        const ss = harnessStates(v, cat.ctx, 6101, { bounds: { rows, values: true } });
        expect(v.modSlots().some((slot) => v.modSlot(slot)!.compared)).toBe(true);
        const d = compareMethodOn(v, cat.ctx, ss, [
            req({ kind: "rarity", rarity: "magic" }),
            corrupt,
        ]);
        expect(d, d).toBe("");
    });

    it("is exact on items holding an imprint", () => {
        const v = harnessUniverse(cat, { imprint: true });
        const ss = harnessStates(v, cat.ctx, 6102, {
            bounds: { rows, rarities: ["normal", "magic"] },
            imprints: true,
        });
        expect(ss.some((x) => x.some((i) => i.imprint !== undefined))).toBe(true);
        const d = compareMethodOn(v, cat.ctx, ss, [req({ kind: "notMagic" }), corrupt]);
        expect(d, d).toBe("");
    });

    it("raises an internal error for a rarity the item's modifiers exceed", () => {
        const magic = fromItems(u, [
            cItem({ rarity: "magic", mods: [cMod(rows[0]!, lowest(rows[0]!))] }),
        ])!;
        expect(() => runMethod(magic, [rarity("normal")])).toThrow(InternalError);
        expect(() => refRunMethod(atLeastOne(magic), [rarity("normal")], cat.ctx)).toThrow(
            InternalError,
        );
    });

    const lowest = (id: string): number | undefined => {
        const m = [...u.rows.keys()].find((r) => r.id === id)!;
        return m.text === undefined ? undefined : Number(/\d+/.exec(m.text)![0]);
    };
    const atLeastOne = (s: NonNullable<ReturnType<typeof fromItems>>): ItemSet =>
        listItems(u, s.dd, { lowest: true });

    it("refuses on any item that breaks a check, and goes on from the items that pass", () => {
        exact([
            req({ kind: "notCorrupted" }),
            rarity("rare"),
            req({ kind: "rarity", rarity: "rare" }),
        ]);
        const s = fromItems(u, [cItem({ corrupted: true }), cItem({ rarity: "magic" })])!;
        const r = runMethodTrace(s, [req({ kind: "notCorrupted" }), corrupt]);
        expect(r.result.ok).toBe(false);
        expect(listItems(u, r.failing.get(0)!).items()).toEqual([cItem({ corrupted: true })]);
        expect(listItems(u, r.result.state.dd).items()).toEqual([
            cItem({ rarity: "magic", corrupted: true }),
        ]);
        if (!r.result.ok) expect(r.result.failure).toEqual({ kind: "corrupted", sure: false });
    });

    it("recovers from the refused items as the guide meant them, else from the state unchanged", () => {
        const magic = fromItems(u, [cItem({ rarity: "magic" })])!;
        const r = runMethod(magic, [req({ kind: "rarity", rarity: "rare" }), corrupt]);
        expect(r.ok).toBe(false);
        expect(listItems(u, r.state.dd).items()).toEqual([
            cItem({ rarity: "rare", corrupted: true }),
        ]);
        expect(r.ended).toBeUndefined();
        // No repair: the state as it was.
        const all = fromItems(u, [cItem({ corrupted: true })])!;
        expect(runMethod(all, [req({ kind: "notCorrupted" }), rarity("magic")])).toEqual({
            ok: false,
            failure: { kind: "corrupted", sure: true },
            state: all,
            recovered: true,
        });
        // A repair the modifiers do not fit: the state as it was, and no end.
        const full = fromItems(u, [
            cItem({ rarity: "rare", mods: rows.map((id) => cMod(id, lowest(id))) }),
        ])!;
        const none = runMethod(full, [req({ kind: "rarity", rarity: "normal" }), rarity("magic")]);
        expect(none.state).toEqual(full);
        expect(none.ended).toBeUndefined();
        exact([
            req({ kind: "rarity", rarity: "rare" }),
            corrupt,
            req({ kind: "rarity", rarity: "magic" }),
        ]);
    });

    it("words a refusal once, over every case and part together", () => {
        const s = fromItems(u, [cItem(), cItem({ rarity: "magic" })])!;
        const r = runMethod(s, [req({ kind: "rarity", rarity: "magic" })]);
        if (!r.ok)
            expect(r.failure).toEqual({
                kind: "wrongRarity",
                needed: "magic",
                actual: rarities(s),
            });
        const split: Handlers = {
            ...HANDLERS,
            transforms: {
                ...HANDLERS.transforms,
                corrupt: {
                    ...HANDLERS.transforms.corrupt!,
                    split: (_op, v) =>
                        ["normal", "magic", "rare"].map((x) =>
                            v.dd.slotIn(v.scalar("rarity"), [v.rarityValue(x as "normal")]),
                        ),
                },
            },
        };
        const two = fromItems(u, [cItem({ corrupted: true }), cItem({ rarity: "magic" })])!;
        const w = runMethod(two, [req({ kind: "notCorrupted" }), corrupt], split);
        expect(w.ok === false && w.failure).toEqual({ kind: "corrupted", sure: false });
    });

    it("unites the branches of either, an ending branch adding nothing", () => {
        exact([either([corrupt], [end])]);
        exact([req({ kind: "rarity", rarity: "normal" }), either([], [rarity("magic"), corrupt])]);
        exact([either([end], [end])]);
        exact([req({ kind: "notCorrupted" }), either([end])]);
        const s = fromItems(u, [cItem()])!;
        expect(runMethod(s, [either([end], [end])])).toEqual({ ok: true, state: s, ended: true });
        expect(runMethod(s, [either([end], [])]).ended).toBeUndefined();
    });

    it("ends the craft only when every item that passed the checks ended", () => {
        const s = fromItems(u, [cItem({ corrupted: true })])!;
        expect(runMethod(s, [req({ kind: "notCorrupted" }), end]).ended).toBeUndefined();
        const mixed = fromItems(u, [cItem({ corrupted: true }), cItem()])!;
        expect(runMethod(mixed, [req({ kind: "notCorrupted" }), end]).ended).toBe(true);
    });

    // A corrupt that cannot act on a Normal item, in both frames.
    const normal = (v: typeof u) => v.dd.slotIn(v.scalar("rarity"), [v.rarityValue("normal")]);
    const picky = {
        exact: {
            ...HANDLERS,
            transforms: {
                ...HANDLERS.transforms,
                corrupt: {
                    reads: [],
                    apply: (_op, d, { u: v }) =>
                        outcome(
                            v.dd.set(v.dd.diff(d, normal(v)), v.scalar("corrupted"), 1),
                            v.dd.and(d, normal(v)),
                        ),
                },
            },
        } satisfies Handlers,
        reference: {
            ...REF_HANDLERS,
            transforms: {
                ...REF_HANDLERS.transforms,
                corrupt: {
                    reads: [],
                    apply: (_op, item) =>
                        item.rarity === "normal" ? [] : [{ ...item, corrupted: true }],
                },
            },
        } satisfies RefHandlers,
    };
    const two = (): ReturnType<typeof fromItems> =>
        fromItems(u, [cItem(), cItem({ rarity: "magic" })]);

    it("refuses a method on the items an operation cannot act on, as both frames see them", () => {
        exact([corrupt], picky);
        exact([either([corrupt], [])], picky);
        exact([either([corrupt], [corrupt])], picky);
        exact([either([corrupt], [end])], picky);
        exact([req({ kind: "notCorrupted" }), corrupt], picky);
        const r = runMethodTrace(two()!, [corrupt], picky.exact);
        expect(r.result).toMatchObject({
            ok: false,
            failure: { kind: "noOutcome", op: "corrupt", sure: false },
        });
        expect(listItems(u, r.failing.get(0)!).items()).toEqual([cItem()]);
        const all = fromItems(u, [cItem()])!;
        expect(runMethod(all, [corrupt], picky.exact)).toEqual({
            ok: false,
            failure: { kind: "noOutcome", op: "corrupt", sure: true },
            state: all,
            recovered: true,
        });
    });

    it("goes on from the items an operation acts on", () => {
        const r = runMethod(two()!, [corrupt], picky.exact);
        expect(listItems(u, r.state.dd).items()).toEqual([
            cItem({ rarity: "magic", corrupted: true }),
        ]);
    });

    it("takes no refusal from an either branch while another acts", () => {
        const s = two()!;
        expect(runMethod(s, [either([corrupt], [])], picky.exact).ok).toBe(true);
        const both = runMethod(s, [either([corrupt], [corrupt])], picky.exact);
        expect(both.ok === false && both.failure).toEqual({
            kind: "noOutcome",
            op: "either",
            sure: false,
        });
        expect(
            runMethod(fromItems(u, [cItem()])!, [either([corrupt], [end])], picky.exact).ended,
        ).toBe(true);
    });

    it("reports the earliest refusing step, a check or an operation", () => {
        const s = two()!;
        const later = runMethod(s, [corrupt, req({ kind: "rarity", rarity: "rare" })], picky.exact);
        expect(later.ok === false && later.failure.kind).toBe("noOutcome");
        const earlier = runMethod(s, [req({ kind: "notMagic" }), corrupt], picky.exact);
        expect(earlier.ok === false && earlier.failure.kind).toBe("magicRefused");
        exact([corrupt, req({ kind: "rarity", rarity: "rare" })], picky);
    });

    it("raises an internal error for a handler that loses items it does not report", () => {
        const loses: Handlers = {
            ...HANDLERS,
            transforms: {
                ...HANDLERS.transforms,
                corrupt: {
                    reads: [],
                    apply: (_op, d, { u: v }) => outcome(v.dd.EMPTY, v.dd.and(d, normal(v))),
                },
            },
        };
        expect(() => runMethod(two()!, [corrupt], loses)).toThrow(InternalError);
    });

    it("is told apart from a handler that is wrong", () => {
        const wrong = (
            transforms: Handlers["transforms"],
            checks: Handlers["checks"] = HANDLERS.checks,
        ): Handlers => ({
            ...HANDLERS,
            transforms: { ...HANDLERS.transforms, ...transforms },
            checks: { ...HANDLERS.checks, ...checks },
        });
        const same = { exact: HANDLERS, reference: REF_HANDLERS };
        const differs = (h: Handlers, ops: readonly Op[]): string =>
            compareMethodOn(u, cat.ctx, states, ops, { ...same, exact: h });
        // The identity: the items left differ.
        expect(differs(wrong({ corrupt: { reads: [], apply: (_op, d) => d } }), [corrupt])).toMatch(
            /items left/,
        );
        // A superset: every item, corrupted or not.
        const superset = wrong({
            corrupt: {
                reads: [],
                apply: (_op, d, { u: v }) => v.dd.or(d, v.dd.set(d, v.scalar("corrupted"), 1)),
            },
        });
        expect(differs(superset, [corrupt])).toMatch(/items left/);
        // Dropping the Normal items.
        const drops = wrong({
            corrupt: {
                reads: [],
                apply: (_op, d, { u: v }) =>
                    v.dd.diff(
                        v.dd.set(d, v.scalar("corrupted"), 1),
                        v.dd.slotIn(v.scalar("rarity"), [0]),
                    ),
            },
        });
        expect(differs(drops, [corrupt])).toMatch(/items left/);
        // A check passing too few, and one passing too many.
        const few = wrong(
            {},
            {
                notCorrupted: {
                    reads: [],
                    verdict: (_c, _d, { u: v }) => ({
                        pass: v.dd.EMPTY,
                        word: () => ({ kind: "corrupted", sure: true }),
                    }),
                },
            },
        );
        expect(differs(few, [req({ kind: "notCorrupted" })])).toMatch(/refused by op 0/);
        const many = wrong(
            {},
            {
                notMagic: {
                    reads: [],
                    verdict: (_c, _d, { u: v }) => ({
                        pass: v.dd.ALL,
                        word: () => ({ kind: "magicRefused", actual: new Set() }),
                    }),
                },
            },
        );
        expect(differs(many, [req({ kind: "notMagic" })])).toMatch(/refused/);
    });

    it("is exact on a flask, which cannot be Rare", () => {
        const flask = generateCatalog(6150, { types: 2, base: "flask" });
        const v = harnessUniverse(flask);
        expect(canBeRare(flask.base)).toBe(false);
        const ss = harnessStates(v, flask.ctx, 6150, { bounds: { rows: pickRows(v, 6150, 2) } });
        const d = compareMethodOn(v, flask.ctx, ss, [req({ kind: "canBeRare" }), rarity("rare")]);
        expect(d, d).toBe("");
    });
});

// A stand-in operation that writes the rules an item runs under into its
// memory strands, so a listing shows them item by item.
const code = (r: Rules): number =>
    (r.protected.has("prefix") ? 1 : 0) +
    (r.protected.has("suffix") ? 2 : 0) +
    (r.cannotRoll.length > 0 ? 4 : 0) +
    (r.craftedCap > 1 ? 8 : 0) +
    (r.governed ? 16 : 0) +
    (r.blocksSourced ? 32 : 0);

const sideFree = (gen: Gen, r: Rules): boolean => !r.protected.has(gen);

const EXACT_FAKE: Handlers = {
    ...HANDLERS,
    transforms: {
        ...HANDLERS.transforms,
        lock: {
            reads: ALL_FIELDS,
            apply: (_op, s, { u, rules }) => u.dd.set(s, u.scalar("strands"), code(rules)),
        },
    },
    checks: {
        ...HANDLERS.checks,
        unprotectedSide: {
            reads: ["protected"],
            verdict: (check, _s, { u, rules }) => ({
                pass: sideFree(check.gen, rules) ? u.dd.ALL : u.dd.EMPTY,
                word: () => ({ kind: "sideProtected", gen: check.gen, what: check.what }),
            }),
        },
    },
};

const REF_FAKE: RefHandlers = {
    ...REF_HANDLERS,
    transforms: {
        ...REF_HANDLERS.transforms,
        lock: {
            reads: ALL_FIELDS,
            apply: (_op, item, { rules }) => [{ ...item, strands: code(rules) }],
        },
    },
    checks: {
        ...REF_HANDLERS.checks,
        unprotectedSide: {
            reads: ["protected"],
            pass: (check, _item, { rules }) => sideFree(check.gen, rules),
        },
    },
};

describe("the rules in force", () => {
    const cat = generateCatalog(6200, {
        types: 3,
        metamods: ["prefixesCannotChange", "suffixesCannotChange", "multimod", "cannotRollCaster"],
    });
    const u = harnessUniverse(cat);
    const [prefixes, , multimod] = cat.metamods;
    const rows = pickRows(
        u,
        6200,
        5,
        cat.metamods.map((m) => m.id),
    );
    const states = harnessStates(u, cat.ctx, 6200, {
        bounds: { rows, rarities: ["rare"], crafted: true },
    });
    const handlers = { exact: EXACT_FAKE, reference: REF_FAKE };
    const lock: Op = { kind: "lock", n: 1 };
    const exact = (ops: readonly Op[]): void => {
        const d = compareMethodOn(u, cat.ctx, states, ops, handlers);
        expect(d, d).toBe("");
    };

    it("are each item's own, read once when the method starts", () => {
        expect(effectsOf(prefixes!).length).toBeGreaterThan(0);
        exact([lock]);
        const ran = runMethod(fromItems(u, states[1]!)!, [lock], EXACT_FAKE);
        // Items with and without each metamod run under different rules.
        expect(u.dd.valuesOf(ran.state.dd, u.scalar("strands")).length).toBeGreaterThan(4);
        exact([lock, { kind: "unprotect" }, lock]);
        exact([{ kind: "keep", gen: "suffix" }, lock]);
        exact([{ kind: "unprotect" }, { kind: "keep", gen: "prefix" }, lock]);
        exact([either([lock], [{ kind: "corrupt" }])]);
    });

    it("split a state only by the metamods deciding a rule the method reads", () => {
        const s = fromItems(u, states[1]!)!;
        expect(metamodCases(s, new Set()).length).toBe(1);
        expect(metamodCases(s, new Set(["protected"])).length).toBe(4);
        expect(metamodCases(s, new Set(["craftedCap"])).length).toBe(2);
        expect(metamodCases(s, new Set(ALL_FIELDS)).length).toBe(16);
    });

    it("throw on a rule a handler does not declare", () => {
        const sneaky: Handlers = {
            ...HANDLERS,
            transforms: {
                ...HANDLERS.transforms,
                corrupt: {
                    reads: [],
                    apply: (_op, d, { rules }) => (rules.craftedCap > 1 ? d : d),
                },
            },
        };
        expect(() => runMethod(fromItems(u, states[0]!)!, [corrupt], sneaky)).toThrow(
            /does not declare/,
        );
    });

    it("refuse by case, naming the metamods the refused items carry", () => {
        exact([req({ kind: "unprotectedSide", gen: "prefix", what: "An orb" }), lock]);
        const bare = cItem({ rarity: "rare", mods: [] });
        const guarded = cItem({
            rarity: "rare",
            mods: [cMod(prefixes!.id, undefined, { crafted: true })],
        });
        const both = cItem({
            rarity: "rare",
            mods: [
                cMod(prefixes!.id, undefined, { crafted: true }),
                cMod(multimod!.id, 3, { crafted: true }),
            ],
        });
        const check = req({ kind: "unprotectedSide", gen: "prefix", what: "An orb" });
        const r = runMethod(fromItems(u, [bare, guarded])!, [check], EXACT_FAKE);
        expect(r.ok === false && r.under).toEqual([prefixes!.type]);
        const every = runMethod(fromItems(u, [guarded, both])!, [check], EXACT_FAKE);
        expect(every.ok === false && every.under).toBe(undefined);
    });
});

describe("the steps of a method", () => {
    const kinds = (steps: readonly Step[]): string[] =>
        steps.map((s) =>
            s.kind === "compound"
                ? s.compound.kind
                : s.kind === "either"
                  ? `either(${s.branches.map((b) => kinds(b).join(",")).join("|")})`
                  : s.kind === "single"
                    ? s.op.kind
                    : s.kind,
        );
    const cat = generateCatalog(6300, { types: 4, bench: true, essenceOnly: true, veiled: true });
    const mod = cat.natural[0]!;
    const other = cat.natural[1]!;

    it("match the reforge with what it guarantees, the add and remove another, and the change", () => {
        const essence = cat.registry.essences[0]!;
        expect(kinds(stepsOf(L.essenceOps(essence, 84)))).toContain("reforgeWith");
        expect(kinds(stepsOf(L.harvestReforgeOps(TagId("attack"))))).toContain("reforgeWith");
        expect(kinds(stepsOf(L.HARVEST_INFLUENCE_REFORGE))).toContain("reforgeWith");
        expect(kinds(stepsOf(L.VEILED_CHAOS))).toContain("reforgeWith");
        const resonator = L.resonatorOps({
            fossils: [],
            added: [],
            forced: [mod, other],
            corrupted: [],
        });
        const r = stepsOf(resonator).find((s) => s.kind === "compound")!;
        expect(
            r.kind === "compound" && r.compound.kind === "reforgeWith" && r.compound.within.length,
        ).toBe(2);
        expect(kinds(stepsOf(L.harvestAugmentOps(TagId("attack"))))).toContain("addAnother");
        expect(kinds(stepsOf(L.harvestChangeOps(mod.type, "x", [other])))).toContain("change");
        expect(kinds(stepsOf(L.unveilOps(undefined)))).toEqual(["require", "fill"]);
        const nested: Op[] = [
            either(
                [],
                [
                    {
                        kind: "fill",
                        pool: { kind: "natural" },
                        count: { kind: "reforge", n: [4, 6] },
                    },
                    {
                        kind: "fill",
                        pool: { kind: "veiledPlaceholder" },
                        count: { kind: "within" },
                    },
                ],
            ),
        ];
        expect(kinds(stepsOf(nested))).toEqual(["either(|reforgeWith)"]);
    });

    it("refuse a guaranteed fill, a removal sparing a pool or rows replacing a type left alone", () => {
        expect(() =>
            stepsOf([
                {
                    kind: "fill",
                    pool: { kind: "tagged", tag: TagId("x") },
                    count: { kind: "within" },
                },
            ]),
        ).toThrow(MethodShapeError);
        expect(() =>
            stepsOf([
                {
                    kind: "remove",
                    selector: {
                        kind: "random",
                        honourCannotRoll: false,
                        sparing: { kind: "natural" },
                    },
                },
            ]),
        ).toThrow(MethodShapeError);
        expect(() =>
            stepsOf([
                {
                    kind: "fill",
                    pool: { kind: "rows", mods: [mod], replacing: mod.type },
                    count: { kind: "add", n: [1, 1] },
                },
            ]),
        ).toThrow(MethodShapeError);
    });

    it("hand a compound run to its one handler in both frames", () => {
        const u = harnessUniverse(cat);
        const states = harnessStates(u, cat.ctx, 6300, { bounds: { rows: pickRows(u, 6300, 3) } });
        const ops = L.harvestChangeOps(mod.type, "x", [other]).slice(-2);
        const exact: Handlers = {
            ...HANDLERS,
            compounds: {
                change: {
                    reads: [],
                    apply: (_c, d, { u: v }) => v.dd.set(d, v.scalar("strands"), 7),
                },
            },
        };
        const ref: RefHandlers = {
            ...REF_HANDLERS,
            compounds: { change: { reads: [], apply: (_c, item) => [{ ...item, strands: 7 }] } },
        };
        const d = compareMethodOn(u, cat.ctx, states, ops, { exact, reference: ref });
        expect(d, d).toBe("");
        const none: Handlers = { ...HANDLERS, compounds: {} };
        expect(() => runMethod(fromItems(u, states[0]!)!, ops, none)).toThrow(/"change"/);
    });
});

describe("the placement of checks", () => {
    it("refuses a check after an operation that can leave more than one item", () => {
        const fill: Op = {
            kind: "fill",
            pool: { kind: "natural" },
            count: { kind: "add", n: [1, 1] },
        };
        expect(() => checkPlacement([fill, req({ kind: "openSlot" })])).toThrow(MethodShapeError);
        expect(() => checkPlacement([either([corrupt]), req({ kind: "notNormal" })])).toThrow(
            MethodShapeError,
        );
        expect(() =>
            checkPlacement([{ kind: "strip" }, rarity("rare"), req({ kind: "notNormal" })]),
        ).not.toThrow();
    });

    it("asserts in the reference that one item's outcomes agree at each check", () => {
        const cat = generateCatalog(6400, { types: 2 });
        const two: RefHandlers = {
            ...REF_HANDLERS,
            transforms: {
                ...REF_HANDLERS.transforms,
                corrupt: { reads: [], apply: (_op, item) => [item, { ...item, corrupted: true }] },
            },
        };
        expect(() =>
            refRunMethod(
                ItemSet.of([cItem()]),
                [corrupt, req({ kind: "notCorrupted" })],
                cat.ctx,
                two,
            ),
        ).toThrow(/disagree/);
    });

    it("holds for every method of the table and every sequence of the library", () => {
        const cat = generateCatalog(6500, {
            types: 4,
            bench: true,
            essenceOnly: true,
            veiled: true,
            metamods: ["multimod"],
        });
        const registries = [HAND_REGISTRY, cat.registry];
        let built = 0;
        for (const registry of registries) {
            const base = registry === HAND_REGISTRY ? RING_BASE : cat.base;
            const a = initialState(new BddManager(), base, 84, "rare", {
                prefixCount: 0,
                suffixCount: 0,
                present: new Set(),
                pinned: new Map(),
                crafted: 0,
            });
            for (const m of METHODS) {
                const names = (of: string): string[] =>
                    of === "essence"
                        ? registry.essences.map((e) => e.name)
                        : of === "bench"
                          ? [
                                ...registry.catalog
                                    .filter((r) => r.source === "bench")
                                    .map((r) => r.id),
                            ]
                          : of === "tag"
                            ? ["attack", "caster"]
                            : ["life", "cold resistance", registry.catalog[0]!.id];
                const args = m.args.map((s) =>
                    s.kind === "int" || s.kind === "tier"
                        ? { kind: s.kind, value: 1 }
                        : s.kind === "word"
                          ? { kind: "word" as const, value: s.oneOf[0]! }
                          : { kind: "string" as const, value: names(s.of)[0] ?? "life" },
                );
                let ops: readonly Op[];
                try {
                    const r = m.build(args, a, registry);
                    if ("refused" in r) continue;
                    ops = r;
                } catch {
                    continue;
                }
                built++;
                expect(() => checkPlacement(ops), m.words.join(" ")).not.toThrow();
                expect(() => stepsOf(ops), m.words.join(" ")).not.toThrow();
            }
        }
        expect(built).toBeGreaterThan(30);
        const mod = cat.natural[0]!;
        const library: (readonly Op[])[] = [
            ...(
                [
                    "transmute",
                    "augment",
                    "alteration",
                    "regal",
                    "alchemy",
                    "chaos",
                    "exalt",
                    "annul",
                    "scour",
                    "divine",
                    "fracture",
                ] as const
            ).flatMap((k) => {
                try {
                    return [L.currencyOps(k)];
                } catch {
                    return [];
                }
            }),
            L.essenceOps(cat.registry.essences[0]!, 84),
            L.benchOps(cat.bench!),
            L.BENCH_REMOVE,
            L.harvestReforgeOps(TagId("attack")),
            L.harvestAugmentOps(TagId("attack")),
            L.HARVEST_INFLUENCE_REFORGE,
            L.HARVEST_RANDOMISE,
            ...INFLUENCES.map(L.influenceExaltOps),
            ...INFLUENCES.map(L.beastAddInfluenceOps),
            L.vaalOps(cat.base),
            L.locusOps(cat.base),
            L.TAINTED_CHAOS,
            L.TAINTED_EXALT,
            L.TAINTED_DIVINE,
            L.eldritchImplicitOps("exarch", 1, []),
            L.eldritchChaosOps("eater"),
            L.eldritchExaltOps("exarch"),
            L.eldritchAnnulOps("eater"),
            L.DOMINANCE,
            L.CONFLICT,
            L.foulbornOps("exalt"),
            L.beastAddOps("prefix", 40),
            L.beastAspectOps(mod),
            L.BEAST_IMPRINT,
            L.RESTORE,
            L.BEAST_METAMOD,
            L.beastFractureOps(2),
            L.harvestChangeOps(mod.type, "x", [cat.natural[1]!]),
            L.resonatorOps({ fossils: [], added: [], forced: [mod], corrupted: [mod] }),
            L.VEILED_CHAOS,
            L.VEILED_EXALT,
            L.unveilOps({ type: TypeId("TypeUnveiledPrefix"), name: "x" }),
        ];
        for (const ops of library) {
            expect(() => checkPlacement(ops)).not.toThrow();
            expect(() => stepsOf(ops)).not.toThrow();
        }
    });
});
