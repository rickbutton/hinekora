import { describe, expect, it } from "vitest";
import { check, type CheckContext } from "./check.js";
import { BddManager } from "./bdd.js";
import { type InitialCounts, initialState, join, refine } from "./astate.js";
import { runMethod } from "./ops.js";
import { currencyOps } from "./library.js";
import { preconditionMessage, renderState } from "./diagnostics.js";
import { buildRegistry } from "../resolve/registry.js";
import { corruptedP, craft, has, iff, influencedP, item, op, until } from "../__fixtures__/ast.js";
import { CATALOG, HUNTER_RING_SUFFIX, RING_BASE } from "../__fixtures__/mods.js";

const registry = buildRegistry({
    bases: [RING_BASE],
    mods: CATALOG,
    modAliases: {
        life: "IncreasedLife1",
        mana: "IncreasedMana1",
        armour: "IncreasedArmour1",
        cold: "ColdResist1",
    },
    baseAliases: { "Iron Ring": "IronRing" },
});
const ctx: CheckContext = { registry };

const ring = (extra: { influences?: ("hunter" | "shaper")[]; corrupted?: boolean } = {}) =>
    item({ base: "Iron Ring", ilvl: 100, rarity: "rare", ...extra });

const messages = (c: ReturnType<typeof craft>) => check(c, ctx).diagnostics.map((d) => d.message);

describe("influence", () => {
    it("widens the pool with the influence's rows, and only then", () => {
        const influenced = check(craft(ring({ influences: ["hunter"] }), [op("chaos")]), ctx);
        expect(influenced.diagnostics).toEqual([]);
        expect(influenced.finalState!.possible.has(HUNTER_RING_SUFFIX.type)).toBe(true);

        const plain = check(craft(ring(), [op("chaos")]), ctx);
        expect(plain.finalState!.possible.has(HUNTER_RING_SUFFIX.type)).toBe(false);
        const other = check(craft(ring({ influences: ["shaper"] }), [op("chaos")]), ctx);
        expect(other.finalState!.possible.has(HUNTER_RING_SUFFIX.type)).toBe(false);
    });

    it("makes an until on an influence modifier reachable", () => {
        const loop = [until(has("Hunter ring suffix"), [op("chaos")])];
        expect(messages(craft(ring({ influences: ["hunter"] }), loop))).toEqual([]);
        expect(messages(craft(ring(), loop)).join("\n")).toMatch(/never/);
    });

    it("refuses a fracture on an influenced item", () => {
        const four = item({
            base: "Iron Ring",
            ilvl: 100,
            rarity: "rare",
            prefixes: ["life", "mana", "armour"],
            suffixes: ["cold"],
            influences: ["hunter"],
        });
        expect(messages(craft(four, [op("fracture")])).join("\n")).toContain(
            "cannot be used on an influenced item — this item has Hunter",
        );
    });

    it("rejects a declared fracture on an influenced item", () => {
        const declared = item({
            base: "Iron Ring",
            ilvl: 100,
            rarity: "rare",
            suffixes: [{ mod: "cold", fractured: true }],
            influences: ["hunter"],
        });
        expect(messages(craft(declared, [])).join("\n")).toContain("cannot have a fractured");
    });

    it("narrows by `influenced`, naming an influence or not", () => {
        const hunter = craft(ring({ influences: ["hunter"] }), [
            iff(influencedP("hunter"), [op("chaos")], [op("chaos")]),
        ]);
        expect(messages(hunter).join("\n")).toContain("'else' branch can never run");
        const any = craft(ring(), [iff(influencedP(), [op("chaos")], [op("chaos")])]);
        expect(messages(any).join("\n")).toContain("'if' branch can never run");
    });
});

describe("corruption", () => {
    it("refuses every craft on a corrupted item", () => {
        expect(messages(craft(ring({ corrupted: true }), [op("exalt")])).join("\n")).toContain(
            "The item is corrupted — a corrupted item takes no further craft",
        );
    });

    it("narrows by `corrupted`", () => {
        const c = craft(ring(), [iff(corruptedP(), [op("chaos")], [op("chaos")])]);
        expect(messages(c).join("\n")).toContain("'if' branch can never run");
    });
});

describe("marks where paths meet", () => {
    const bdd = new BddManager();
    const counts: InitialCounts = {
        prefixCount: 0,
        suffixCount: 0,
        present: new Set(),
        pinned: new Map(),
        crafted: 0,
    };
    const hunter = initialState(bdd, RING_BASE, 100, "rare", counts, {
        influences: ["hunter"],
        corrupted: false,
    });
    const plain = initialState(bdd, RING_BASE, 100, "rare", counts, {
        influences: [],
        corrupted: true,
    });
    const met = join(hunter, plain);

    it("joins to the set of what either path had", () => {
        expect(met.influences).toEqual(new Set(["hunter", ""]));
        expect(met.corrupted).toEqual(new Set([true, false]));
        expect(renderState(met)).toContain("· Hunter or no influence · maybe corrupted");
    });

    it("refines back to one path, and to none when the predicate is impossible", () => {
        expect(refine(met, { kind: "influenced", influence: "hunter" })!.influences).toEqual(
            new Set(["hunter"]),
        );
        expect(refine(met, { kind: "influenced" }, false)!.influences).toEqual(new Set([""]));
        expect(refine(met, { kind: "corrupted" })!.corrupted).toEqual(new Set([true]));
        expect(refine(hunter, { kind: "corrupted" })).toBeNull();
        expect(refine(plain, { kind: "influenced", influence: "shaper" })).toBeNull();
    });

    it("lets an influence held on some path only admit its rows as possible", () => {
        const maybeHunter = refine(met, { kind: "corrupted" }, false)!;
        const r = runMethod(maybeHunter, currencyOps("chaos"), registry);
        expect(r.ok && r.state.possible.has(HUNTER_RING_SUFFIX.type)).toBe(true);
    });

    it("judges a mark that holds on some path as unproven", () => {
        const fracture = runMethod(
            refine(met, { kind: "corrupted" }, false)!,
            currencyOps("fracture"),
            registry,
        );
        expect(fracture.ok).toBe(false);
        if (!fracture.ok) {
            expect(preconditionMessage(met, fracture.failure)).toContain("may have Hunter");
        }
        const exalt = runMethod(met, currencyOps("exalt"), registry);
        expect(exalt.ok).toBe(false);
        if (!exalt.ok) {
            expect(preconditionMessage(met, exalt.failure)).toContain("may be corrupted");
        }
    });
});
