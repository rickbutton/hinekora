import { describe, expect, it } from "vitest";
import { check, type CheckContext } from "./check.js";
import { guaranteedTypes } from "./astate.js";
import { buildRegistry } from "../resolve/registry.js";
import { craft, harvest, has as hasT, iff, influencedP, item } from "../__fixtures__/ast.js";
import type { OperationStmt } from "../ast/ast.js";
import {
    CATALOG,
    CLASS_RING,
    HUNTER_RING_SUFFIX,
    JEWEL_BASE,
    PROTECT_SUFFIXES_CARRIER,
    RING_BASE,
} from "../__fixtures__/mods.js";
import { influenceKey, INFLUENCES } from "../model/marks.js";
import { BddManager } from "./bdd.js";
import { initialState, join, refine } from "./astate.js";
import { runMethod } from "./ops.js";
import { HARVEST_INFLUENCE_REFORGE } from "./library.js";
import { preconditionMessage } from "./diagnostics.js";

const registry = buildRegistry({
    bases: [RING_BASE, JEWEL_BASE],
    mods: [...CATALOG, PROTECT_SUFFIXES_CARRIER],
    modAliases: {
        life: "IncreasedLife1",
        mana: "IncreasedMana1",
        armour: "IncreasedArmour1",
        cold: "ColdResist1",
    },
    baseAliases: { "Iron Ring": "IronRing" },
    benchCrafts: [
        { mod: PROTECT_SUFFIXES_CARRIER.id, tier: 1, itemClasses: new Set([CLASS_RING]) },
    ],
});
const ctx: CheckContext = { registry };

type Infl = "shaper" | "elder" | "hunter";
const ring = (influences: Infl[] = [], suffixes: string[] = []) =>
    item({ base: "Iron Ring", ilvl: 100, rarity: "rare", influences, suffixes });

const words = (...ws: string[]): OperationStmt => ({
    kind: "operation",
    words: ws,
    args: [],
    span: { start: { offset: 0, line: 1, column: 1 }, end: { offset: 0, line: 1, column: 1 } },
});
const wordArg = (ws: string[], w: string): OperationStmt => ({
    ...words(...ws),
    args: [{ kind: "word", value: w, span: words().span }],
});

const run = (c: ReturnType<typeof craft>) => check(c, ctx);
const messages = (c: ReturnType<typeof craft>) =>
    run(c)
        .diagnostics.map((d) => d.message)
        .join("\n");

describe("the influence exalts", () => {
    it("mark the item and guarantee one of the influence's modifiers", () => {
        const r = run(craft(ring(), [words("exalt", "hunter")]));
        expect(r.diagnostics).toEqual([]);
        const s = r.finalState!;
        expect(s.influences).toEqual(new Set([influenceKey(["hunter"])]));
        expect(guaranteedTypes(s).has(HUNTER_RING_SUFFIX.type)).toBe(true);
        expect(s.counts.total).toEqual([1, 1]);
    });

    it("refuse an influenced item, the same influence included, and a fractured one", () => {
        expect(messages(craft(ring(["hunter"]), [words("exalt", "hunter")]))).toContain(
            "A Hunter's Exalted Orb cannot be used on an influenced item — this item has Hunter",
        );
        expect(messages(craft(ring(["shaper"]), [words("exalt", "hunter")]))).toContain(
            "cannot be used on an influenced item",
        );
        const fractured = item({
            base: "Iron Ring",
            ilvl: 100,
            rarity: "rare",
            suffixes: [{ mod: "cold", fractured: true }],
        });
        expect(messages(craft(fractured, [words("exalt", "hunter")]))).toContain(
            "already has a fractured modifier",
        );
    });

    it("refuse a base whose class cannot be influenced", () => {
        const jewel = item({ base: "Cobalt Jewel", ilvl: 100, rarity: "rare" });
        expect(messages(craft(jewel, [words("exalt", "hunter")]))).toContain(
            "A Hunter's Exalted Orb cannot be used on a Cobalt Jewel — its class cannot be influenced",
        );
    });
});

describe("an influence the item may have", () => {
    const bdd = new BddManager();
    const counts = {
        prefixCount: 0,
        suffixCount: 0,
        present: new Set<never>(),
        pinned: new Map<never, never>(),
        crafted: 0,
    };
    const hunter = initialState(bdd, RING_BASE, 100, "rare", counts, {
        influences: ["hunter"],
        corrupted: false,
    });
    const plain = initialState(bdd, RING_BASE, 100, "rare", counts, {
        influences: [],
        corrupted: false,
    });
    const met = join(hunter, plain);

    it("is not enough for a craft that needs one", () => {
        const r = runMethod(met, HARVEST_INFLUENCE_REFORGE, registry);
        expect(r.ok).toBe(false);
        if (!r.ok) {
            expect(preconditionMessage(met, r.failure)).toContain(
                "needs an influenced item — this item may have Hunter or no influence",
            );
        }
        expect(
            runMethod(refine(met, { kind: "influenced" })!, HARVEST_INFLUENCE_REFORGE, registry).ok,
        ).toBe(true);
    });

    it("lets a predicate name its modifier and tier after a randomise", () => {
        const r = run(
            craft(ring(["shaper"]), [
                words("harvest", "randomise"),
                iff(hasT("Hunter ring suffix", 1), [words("harvest", "randomise")]),
            ]),
        );
        expect(r.diagnostics).toEqual([]);
    });
});

describe("the grove's randomise under a protection metamod", () => {
    const protectedRing = (suffixes: string[]) =>
        item({
            base: "Iron Ring",
            ilvl: 100,
            rarity: "rare",
            prefixes: [PROTECT_SUFFIXES_CARRIER.id],
            suffixes,
            influences: ["hunter"],
        });

    it("is refused while a protected side may carry an influence modifier", () => {
        expect(
            messages(craft(protectedRing(["random"]), [words("harvest", "randomise")])),
        ).toContain(
            "not offered while the suffixes cannot be changed and one of them may be an influence modifier",
        );
    });

    it("is offered when the protected side holds natural modifiers only", () => {
        const r = run(craft(protectedRing(["cold"]), [words("harvest", "randomise")]));
        expect(r.diagnostics).toEqual([]);
    });
});

describe("the grove's influence crafts", () => {
    it("reforges an influenced Rare with one of its influence modifiers guaranteed", () => {
        const r = run(craft(ring(["hunter"]), [harvest("reforge", "influence")]));
        expect(r.diagnostics).toEqual([]);
        expect(guaranteedTypes(r.finalState!).has(HUNTER_RING_SUFFIX.type)).toBe(true);
        expect(messages(craft(ring(), [harvest("reforge", "influence")]))).toContain(
            "needs an influenced item — this item has no influence",
        );
    });

    it("randomises to every influence set of the same size, which `influenced` narrows", () => {
        const r = run(craft(ring(["hunter"]), [words("harvest", "randomise")]));
        expect(r.diagnostics).toEqual([]);
        expect(r.finalState!.influences).toEqual(new Set(INFLUENCES.map((i) => influenceKey([i]))));
        expect(r.finalState!.counts.total).toEqual([4, 6]);

        const pair = run(craft(ring(["shaper", "elder"]), [words("harvest", "randomise")]));
        expect(pair.finalState!.influences.size).toBe(15);

        const narrowed = run(
            craft(ring(["hunter"]), [
                words("harvest", "randomise"),
                iff(influencedP("shaper"), [words("exalt", "hunter")], [words("exalt", "hunter")]),
            ]),
        );
        // Both arms are reachable, and each refuses the orb: the item is influenced either way.
        expect(narrowed.diagnostics.map((d) => d.message).join("\n")).not.toContain("never run");
        expect(narrowed.diagnostics).toHaveLength(2);
    });

    it("reforges at the item's rarity when it is Magic", () => {
        const magic = item({
            base: "Iron Ring",
            ilvl: 100,
            rarity: "magic",
            influences: ["hunter"],
        });
        const r = run(craft(magic, [words("harvest", "randomise")]));
        expect(r.diagnostics).toEqual([]);
        expect(r.finalState!.counts.total).toEqual([1, 2]);
    });

    it("refuses a harvest augment on an influenced item", () => {
        expect(messages(craft(ring(["hunter"], ["cold"]), [harvest("augment", "life")]))).toContain(
            "A harvest augment craft cannot be used on an influenced item",
        );
    });
});

describe("the Awakener's Orb", () => {
    it("adds the donor's influence to an item with one other, reforged Rare", () => {
        const r = run(craft(ring(["hunter"]), [wordArg(["awakener"], "shaper")]));
        expect(r.diagnostics).toEqual([]);
        expect(r.finalState!.influences).toEqual(new Set([influenceKey(["shaper", "hunter"])]));
        expect(r.finalState!.counts.total).toEqual([4, 6]);
    });

    it("ignores the metamods: a protected side is reforged with the rest", () => {
        const guarded = item({
            base: "Iron Ring",
            ilvl: 100,
            rarity: "rare",
            prefixes: [PROTECT_SUFFIXES_CARRIER.id],
            suffixes: ["cold"],
            influences: ["hunter"],
        });
        const r = run(craft(guarded, [wordArg(["awakener"], "shaper")]));
        expect(r.diagnostics).toEqual([]);
        const s = r.finalState!;
        expect(s.counts.total).toEqual([4, 6]);
        expect(guaranteedTypes(s).has(PROTECT_SUFFIXES_CARRIER.type)).toBe(false);
    });

    it("refuses an item with no, two, or the donor's influence", () => {
        for (const start of [ring(), ring(["shaper", "elder"]), ring(["shaper"])]) {
            expect(messages(craft(start, [wordArg(["awakener"], "shaper")]))).toContain(
                "exactly one influence other than the donor's Shaper",
            );
        }
    });
});

describe("the Bestiary's add-to-an-influenced-item recipe", () => {
    it("needs that influence and adds into an open slot", () => {
        const r = run(craft(ring(["hunter"]), [wordArg(["beast", "add"], "hunter")]));
        expect(r.diagnostics).toEqual([]);
        expect(r.finalState!.counts.total).toEqual([1, 1]);
        expect(r.finalState!.possible.has(HUNTER_RING_SUFFIX.type)).toBe(true);
        expect(messages(craft(ring(["shaper"]), [wordArg(["beast", "add"], "hunter")]))).toContain(
            "needs a Hunter item — this item has Shaper",
        );
    });
});
