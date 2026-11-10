import { describe, expect, it } from "vitest";
import { check, type CheckContext } from "./check.js";
import { guaranteedTypes } from "./astate.js";
import { runMethod } from "./ops.js";
import { buildRegistry } from "../resolve/registry.js";
import { corruptedP, craft, has, iff, influencedP, item, notp, op } from "../__fixtures__/ast.js";
import type { OperationStmt } from "../ast/ast.js";
import {
    BENCH_LIFE_ROW,
    CATALOG,
    COLD_RESIST,
    FLASK_BASE,
    JEWEL_BASE,
    LIFE_T1,
    PROTECT_SUFFIXES_CARRIER,
    RING_BASE,
} from "../__fixtures__/mods.js";
import { influenceKey, INFLUENCES } from "../model/marks.js";

const registry = buildRegistry({
    bases: [RING_BASE, FLASK_BASE, JEWEL_BASE],
    mods: [...CATALOG, PROTECT_SUFFIXES_CARRIER, BENCH_LIFE_ROW],
    modAliases: { life: "IncreasedLife1", cold: "ColdResist1" },
    baseAliases: { "Iron Ring": "IronRing", "Life Flask": "LifeFlask" },
});
const ctx: CheckContext = { registry };

const words = (...ws: string[]): OperationStmt => ({
    kind: "operation",
    words: ws,
    args: [],
    span: { start: { offset: 0, line: 1, column: 1 }, end: { offset: 0, line: 1, column: 1 } },
});
const run = (c: ReturnType<typeof craft>) => check(c, ctx);
const messages = (c: ReturnType<typeof craft>) =>
    run(c)
        .diagnostics.map((d) => d.message)
        .join("\n");

const ring = (extra: Partial<Parameters<typeof item>[0]> = {}) =>
    item({ base: "Iron Ring", ilvl: 100, rarity: "rare", ...extra });

describe("the Vaal Orb", () => {
    it("corrupts the item and leaves it as it was or a Rare with six modifiers", () => {
        const magic = item({ base: "Iron Ring", ilvl: 100, rarity: "magic", prefixes: ["life"] });
        const r = run(craft(magic, [op("vaal")]));
        expect(r.diagnostics).toEqual([]);
        const s = r.finalState!;
        expect(s.corrupted).toEqual(new Set([true]));
        expect(s.rarities).toEqual(new Set(["magic", "rare"]));
        expect(s.counts.total).toEqual([1, 6]);
        expect(guaranteedTypes(s).has(LIFE_T1.type)).toBe(false);
    });

    it("ends every ordinary craft afterwards, and `corrupted` then always holds", () => {
        expect(messages(craft(ring(), [op("vaal"), op("exalt")]))).toContain(
            "The item is corrupted",
        );
        expect(
            messages(craft(ring(), [op("vaal"), iff(corruptedP(), [], [op("vaal")])])),
        ).toContain("'else' branch can never run");
        expect(messages(craft(ring({ corrupted: true }), [op("vaal")]))).toContain(
            "The item is corrupted",
        );
    });

    it("takes a Normal item, which stays Normal or becomes the Rare", () => {
        const normal = item({ base: "Iron Ring", ilvl: 100, rarity: "normal" });
        const r = run(craft(normal, [op("vaal")]));
        expect(r.diagnostics).toEqual([]);
        expect(r.finalState!.rarities).toEqual(new Set(["normal", "rare"]));
        expect(r.finalState!.counts.total).toEqual([0, 6]);
        expect(r.finalState!.corrupted).toEqual(new Set([true]));
    });

    it("keeps a side a metamod protects through its reforge", () => {
        const guarded = ring({ prefixes: [PROTECT_SUFFIXES_CARRIER.id], suffixes: ["cold"] });
        const r = run(craft(guarded, [op("vaal")]));
        expect(r.diagnostics).toEqual([]);
        const s = r.finalState!;
        expect(guaranteedTypes(s).has(COLD_RESIST.type)).toBe(true);
        // The metamod itself is a prefix, and the reforge takes it.
        expect(guaranteedTypes(s).has(PROTECT_SUFFIXES_CARRIER.type)).toBe(false);
        expect(s.counts.suffix[0]).toBe(1);
        const open = run(craft(ring({ prefixes: ["life"], suffixes: ["cold"] }), [op("vaal")]));
        expect(guaranteedTypes(open.finalState!).has(COLD_RESIST.type)).toBe(false);
    });

    it("reforges a jewel into three or four modifiers, not six", () => {
        const two = ["random", "random"];
        const jewel = item({
            base: "Cobalt Jewel",
            ilvl: 100,
            rarity: "rare",
            prefixes: two,
            suffixes: two,
        });
        const r = run(craft(jewel, [op("vaal")]));
        expect(r.diagnostics).toEqual([]);
        expect(r.finalState!.counts.total).toEqual([3, 4]);
    });

    it("may turn a basic jewel into a unique, on which the craft ends", () => {
        const jewel = item({ base: "Cobalt Jewel", ilvl: 100, rarity: "rare" });
        const r = run(craft(jewel, [op("vaal")]));
        expect(r.diagnostics).toEqual([]);
        // The join of the kept and bricked outcomes; the unique one adds nothing.
        expect(r.finalState!.rarities).toEqual(new Set(["rare"]));
        expect(r.finalState!.corrupted).toEqual(new Set([true]));
    });

    it("only corrupts a base that cannot be Rare", () => {
        const flask = item({ base: "Life Flask", ilvl: 100, rarity: "magic" });
        const r = run(craft(flask, [op("vaal")]));
        expect(r.diagnostics).toEqual([]);
        expect(r.finalState!.rarities).toEqual(new Set(["magic"]));
        expect(r.finalState!.corrupted).toEqual(new Set([true]));
    });
});

describe("the Corruption Altar", () => {
    it("takes weapons, armour, jewellery, quivers and jewels only", () => {
        const flask = item({ base: "Life Flask", ilvl: 100, rarity: "magic" });
        expect(messages(craft(flask, [op("locus")]))).toContain(
            "Needs a weapon, armour, piece of jewellery, quiver or jewel",
        );
        const jewel = item({ base: "Cobalt Jewel", ilvl: 100, rarity: "rare" });
        const r = run(craft(jewel, [op("locus")]));
        expect(r.diagnostics).toEqual([]);
        expect(r.finalState!.influences).toEqual(new Set([influenceKey([])]));
    });

    it("may make an influenced Rare, or destroy the item", () => {
        const r = run(craft(ring(), [op("locus")]));
        expect(r.diagnostics).toEqual([]);
        const s = r.finalState!;
        expect(s.corrupted).toEqual(new Set([true]));
        expect(s.influences).toEqual(
            new Set([influenceKey([]), ...INFLUENCES.map((i) => influenceKey([i]))]),
        );
        // Both arms are reachable: the item kept its state or was reforged with an influence.
        expect(messages(craft(ring(), [op("locus"), iff(influencedP(), [], [])]))).not.toContain(
            "never run",
        );
    });
});

describe("a method's outcomes that end the craft", () => {
    const start = run(craft(ring(), [])).finalState!;
    const end = [{ kind: "end" }] as const;

    it("add nothing to what the others leave", () => {
        const r = runMethod(
            start,
            [{ kind: "either", branches: [[{ kind: "corrupt" }], end] }],
            registry,
        );
        expect(r.ended).toBeUndefined();
        expect(r.state.corrupted).toEqual(new Set([true]));
    });

    it("end it where no other outcome is left", () => {
        const r = runMethod(start, [{ kind: "either", branches: [end, end] }], registry);
        expect(r.ok).toBe(true);
        expect(r.ended).toBe(true);
    });
});

describe("a corruption's reforge", () => {
    const full = () => {
        const three = ["random", "random", "random"];
        return ring({ prefixes: three, suffixes: three });
    };

    it("rolls six modifiers from a Vaal Orb, four to six from the altar", () => {
        // Each item held six, so the lower bound is the reforge's own.
        expect(run(craft(full(), [op("vaal")])).finalState!.counts.total).toEqual([6, 6]);
        expect(run(craft(full(), [op("locus")])).finalState!.counts.total).toEqual([4, 6]);
    });
});

describe("the Tainted currency", () => {
    const corruptedRing = ring({ corrupted: true, prefixes: ["life"], suffixes: ["cold"] });

    it("needs a corrupted item", () => {
        expect(messages(craft(ring(), [words("tainted", "chaos")]))).toContain(
            "A Tainted Chaos Orb needs a corrupted item — this item is not corrupted",
        );
    });

    it("chaos: reforges, or strips to the rarity the survivors allow", () => {
        const r = run(craft(corruptedRing, [words("tainted", "chaos")]));
        expect(r.diagnostics).toEqual([]);
        expect(r.finalState!.rarities).toEqual(new Set(["normal", "rare"]));
        expect(r.finalState!.counts.total).toEqual([0, 6]);
    });

    it("exalt: adds a modifier or removes one", () => {
        const r = run(craft(corruptedRing, [words("tainted", "exalt")]));
        expect(r.diagnostics).toEqual([]);
        expect(r.finalState!.counts.total).toEqual([1, 3]);
        expect(guaranteedTypes(r.finalState!).has(LIFE_T1.type)).toBe(false);
    });

    it("exalt: a full item takes it, and is left full or one modifier short", () => {
        const three = ["random", "random", "random"];
        const full = ring({ corrupted: true, prefixes: three, suffixes: three });
        const r = run(craft(full, [words("tainted", "exalt")]));
        expect(r.diagnostics).toEqual([]);
        expect(r.finalState!.counts.total).toEqual([5, 6]);
    });

    it("chaos: a protected side is not kept, and a fractured modifier leaves a Magic item", () => {
        const guarded = ring({
            corrupted: true,
            prefixes: [PROTECT_SUFFIXES_CARRIER.id],
            suffixes: ["cold"],
        });
        const r = run(craft(guarded, [words("tainted", "chaos")]));
        expect(r.diagnostics).toEqual([]);
        expect(guaranteedTypes(r.finalState!).has(COLD_RESIST.type)).toBe(false);
        expect(r.finalState!.rarities).toEqual(new Set(["normal", "rare"]));

        const locked = ring({ corrupted: true, suffixes: [{ mod: "cold", fractured: true }] });
        const f = run(craft(locked, [words("tainted", "chaos")]));
        expect(f.finalState!.rarities).toEqual(new Set(["magic", "rare"]));
    });

    it("chaos: a fractured prefix beside a fractured suffix may leave Magic, which a second refuses", () => {
        const locked = ring({
            corrupted: true,
            prefixes: [{ mod: "life", fractured: true }],
            suffixes: [{ mod: "cold", fractured: true }],
        });
        const r = run(craft(locked, [words("tainted", "chaos")]));
        expect(r.diagnostics).toEqual([]);
        expect(r.finalState!.rarities).toEqual(new Set(["magic", "rare"]));
        expect(
            messages(craft(locked, [words("tainted", "chaos"), words("tainted", "chaos")])),
        ).toContain("Requires a Rare item — this item may be");
        // The plain scour keeps the survivor-count rule: two survivors stay Rare.
        const scoured = run(craft(ring({ ...locked, corrupted: false }), [op("scour")]));
        expect(scoured.finalState!.rarities).toEqual(new Set(["rare"]));
    });

    it("needs the corruption on every path", () => {
        // Whether the reforge rolled T1 life is unknown, so only one path corrupts.
        const c = craft(ring(), [
            op("chaos"),
            iff(has("life", 1), [op("vaal")]),
            words("tainted", "exalt"),
        ]);
        expect(messages(c)).toContain("may not be corrupted");
    });

    it("divine: forgets a tier fact about a modifier that may be natural", () => {
        // A life modifier may be the bench row or a natural one; a negative tier
        // fact about it must not survive the Teardrop.
        const c = craft(ring({ corrupted: true, prefixes: ["life"] }), [
            iff(notp(has("life", 1)), [], []),
            words("tainted", "divine"),
            iff(has("life", 1), [], []),
        ]);
        const text = messages(c);
        expect(text).not.toContain("'if' branch can never run: has \"life\" t1");
    });

    it("divine: forgets every tier but a crafted modifier's", () => {
        const benched = ring({ corrupted: true, prefixes: ["life", PROTECT_SUFFIXES_CARRIER.id] });
        const before = run(craft(benched, [])).finalState!;
        expect(before.tiers.get(LIFE_T1.type)).toBeDefined();
        const r = run(craft(benched, [words("tainted", "divine")]));
        expect(r.diagnostics).toEqual([]);
        expect(r.finalState!.tiers.has(LIFE_T1.type)).toBe(false);
        expect(r.finalState!.tiers.get(PROTECT_SUFFIXES_CARRIER.type)).toEqual(
            new Set([PROTECT_SUFFIXES_CARRIER.id]),
        );
    });
});
