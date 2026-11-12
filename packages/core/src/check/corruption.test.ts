import { describe, expect, it } from "vitest";
import { check, type CheckContext } from "./check.js";
import * as v from "./views.js";
import { guaranteedTypes } from "./views.js";
import { buildRegistry } from "../resolve/registry.js";
import { corruptedP, craft, has, iff, item, notp, op } from "../__fixtures__/ast.js";
import type { OperationStmt } from "../ast/ast.js";
import {
    BENCH_LIFE_ROW,
    CATALOG,
    COLD_RESIST,
    FLASK_BASE,
    JEWEL_BASE,
    LIFE_T1,
    LIFE_T2,
    PROTECT_SUFFIXES_CARRIER,
    RING_BASE,
} from "../__fixtures__/mods.js";
import { influenceKey } from "../model/marks.js";
import { rowIds } from "../__fixtures__/views.js";

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
        expect(v.corruptions(s)).toEqual(new Set([true]));
        expect(v.rarities(s)).toEqual(new Set(["magic", "rare"]));
        expect(v.counts(s).total).toEqual([1, 6]);
        const m = s.u.dd;
        const rare = m.slotIn(s.u.scalar("rarity"), [s.u.rarityValue("rare")]);
        expect(v.counts({ u: s.u, dd: m.and(s.dd, rare) }).total).toEqual([6, 6]);
        const kept = { u: s.u, dd: m.diff(s.dd, rare) };
        expect(v.rarities(kept)).toEqual(new Set(["magic"]));
        expect(rowIds(kept, LIFE_T1.type)).toEqual(new Set([LIFE_T1.id]));
        expect(rowIds(s, LIFE_T1.type)).toEqual(new Set([LIFE_T1.id, LIFE_T2.id]));
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
        expect(v.rarities(r.finalState!)).toEqual(new Set(["normal", "rare"]));
        expect(v.counts(r.finalState!).total).toEqual([0, 6]);
        expect(v.corruptions(r.finalState!)).toEqual(new Set([true]));
    });

    it("keeps a side a metamod protects through its reforge", () => {
        const guarded = ring({ prefixes: [PROTECT_SUFFIXES_CARRIER.id], suffixes: ["cold"] });
        const r = run(craft(guarded, [op("vaal")]));
        expect(r.diagnostics).toEqual([]);
        const s = r.finalState!;
        expect(guaranteedTypes(s).has(COLD_RESIST.type)).toBe(true);
        // The metamod itself is a prefix, and the reforge takes it.
        expect(guaranteedTypes(s).has(PROTECT_SUFFIXES_CARRIER.type)).toBe(false);
        expect(v.counts(s).suffix[0]).toBe(1);
        // An unprotected side is rerolled: the life may come back at its lower tier.
        const open = run(craft(ring({ prefixes: ["life"], suffixes: ["cold"] }), [op("vaal")]));
        expect(rowIds(open.finalState!, LIFE_T1.type)).toEqual(new Set([LIFE_T1.id, LIFE_T2.id]));
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
        expect(v.counts(r.finalState!).total).toEqual([3, 4]);
    });

    it("may turn a basic jewel into a unique, on which the craft ends", () => {
        const jewel = item({ base: "Cobalt Jewel", ilvl: 100, rarity: "rare" });
        const r = run(craft(jewel, [op("vaal")]));
        expect(r.diagnostics).toEqual([]);
        // The unique outcome ends the craft, so what goes on is Rare.
        expect(v.rarities(r.finalState!)).toEqual(new Set(["rare"]));
        expect(v.corruptions(r.finalState!)).toEqual(new Set([true]));
    });

    it("only corrupts a base that cannot be Rare", () => {
        const flask = item({ base: "Life Flask", ilvl: 100, rarity: "magic" });
        const r = run(craft(flask, [op("vaal")]));
        expect(r.diagnostics).toEqual([]);
        expect(v.rarities(r.finalState!)).toEqual(new Set(["magic"]));
        expect(v.corruptions(r.finalState!)).toEqual(new Set([true]));
    });
});

describe("the Corruption Altar", () => {
    it("takes corrupted equipment only: weapons, armour, jewellery and quivers", () => {
        const flask = item({ base: "Life Flask", ilvl: 100, rarity: "magic", corrupted: true });
        expect(messages(craft(flask, [op("locus")]))).toContain(
            "Needs a weapon, armour, piece of jewellery or quiver",
        );
        // A jewel is not equipment (QUESTIONS.md Q32).
        const jewel = item({ base: "Cobalt Jewel", ilvl: 100, rarity: "rare", corrupted: true });
        expect(messages(craft(jewel, [op("locus")]))).toContain("Needs a weapon");
        expect(run(craft(ring({ corrupted: true }), [op("locus")])).diagnostics).toEqual([]);
        expect(messages(craft(ring(), [op("locus")]))).toContain(
            "The Corruption Altar needs a corrupted item — this item is not corrupted.",
        );
    });

    it("makes the item twice corrupted, its modifiers kept, or destroys it", () => {
        const start = ring({ corrupted: true, prefixes: ["life"], suffixes: ["cold"] });
        const r = run(craft(start, [op("locus")]));
        expect(r.diagnostics).toEqual([]);
        const s = r.finalState!;
        expect(v.corruptions(s)).toEqual(new Set(["twice"]));
        expect(v.counts(s).total).toEqual([2, 2]);
        expect(v.influenceSets(s)).toEqual(new Set([influenceKey([])]));
        // A twice-corrupted item takes nothing more (QUESTIONS.md Q32).
        expect(messages(craft(start, [op("locus"), op("locus")]))).toContain(
            "The Corruption Altar takes no twice-corrupted item — this item is twice corrupted.",
        );
        expect(messages(craft(start, [op("locus"), words("tainted", "exalt")]))).toContain(
            "A Tainted Exalted Orb takes no twice-corrupted item — this item is twice corrupted.",
        );
        expect(messages(craft(start, [op("locus"), op("chaos")]))).toContain(
            "The item is twice corrupted — a twice-corrupted item takes no further craft.",
        );
    });

    it("leaves `corrupted` true on a twice-corrupted item", () => {
        const twice = ring({ corrupted: "twice", prefixes: ["life"] });
        expect(messages(craft(twice, [iff(notp(corruptedP()), [op("chaos")])]))).toContain(
            "'if' branch can never run",
        );
        const live = messages(craft(twice, [iff(corruptedP(), [], [op("chaos")])]));
        expect(live).toContain("'else' branch can never run");
        expect(live).not.toContain("'if' branch can never run");
    });

    it("refuses an item that may already be twice corrupted, in words of the some", () => {
        const start = ring({ corrupted: true, prefixes: ["life"], suffixes: ["random"] });
        expect(messages(craft(start, [iff(has("cold"), [op("locus")]), op("locus")]))).toContain(
            "takes no twice-corrupted item — this item may be twice corrupted.",
        );
    });
});

describe("a corruption's reforge", () => {
    it("rolls six modifiers from a Vaal Orb", () => {
        // Each item held six, so the lower bound is the reforge's own.
        const three = ["random", "random", "random"];
        const full = ring({ prefixes: three, suffixes: three });
        expect(v.counts(run(craft(full, [op("vaal")])).finalState!).total).toEqual([6, 6]);
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
        expect(v.rarities(r.finalState!)).toEqual(new Set(["normal", "rare"]));
        expect(v.counts(r.finalState!).total).toEqual([0, 6]);
    });

    it("exalt: adds a modifier or removes one", () => {
        const r = run(craft(corruptedRing, [words("tainted", "exalt")]));
        expect(r.diagnostics).toEqual([]);
        expect(v.counts(r.finalState!).total).toEqual([1, 3]);
        expect(guaranteedTypes(r.finalState!).has(LIFE_T1.type)).toBe(false);
    });

    it("exalt: a full item takes it, and is left one modifier short", () => {
        const three = ["random", "random", "random"];
        const full = ring({ corrupted: true, prefixes: three, suffixes: three });
        const r = run(craft(full, [words("tainted", "exalt")]));
        expect(r.diagnostics).toEqual([]);
        expect(v.counts(r.finalState!).total).toEqual([5, 5]);
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
        expect(v.rarities(r.finalState!)).toEqual(new Set(["normal", "rare"]));

        const locked = ring({ corrupted: true, suffixes: [{ mod: "cold", fractured: true }] });
        const f = run(craft(locked, [words("tainted", "chaos")]));
        expect(v.rarities(f.finalState!)).toEqual(new Set(["magic", "rare"]));
    });

    it("chaos: a fractured prefix beside a fractured suffix may leave Magic, which a second refuses", () => {
        const locked = ring({
            corrupted: true,
            prefixes: [{ mod: "life", fractured: true }],
            suffixes: [{ mod: "cold", fractured: true }],
        });
        const r = run(craft(locked, [words("tainted", "chaos")]));
        expect(r.diagnostics).toEqual([]);
        expect(v.rarities(r.finalState!)).toEqual(new Set(["magic", "rare"]));
        expect(
            messages(craft(locked, [words("tainted", "chaos"), words("tainted", "chaos")])),
        ).toContain("Requires a Rare item — this item may be");
        // The plain scour keeps the survivor-count rule: two survivors stay Rare.
        const scoured = run(craft(ring({ ...locked, corrupted: false }), [op("scour")]));
        expect(v.rarities(scoured.finalState!)).toEqual(new Set(["rare"]));
    });

    it("needs the corruption on every item", () => {
        // Whether the reforge rolled T1 life is unknown, so only some items are
        // corrupted.
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
        expect(rowIds(before, LIFE_T1.type)).toEqual(new Set([LIFE_T1.id]));
        const r = run(craft(benched, [words("tainted", "divine")]));
        expect(r.diagnostics).toEqual([]);
        expect(rowIds(r.finalState!, LIFE_T1.type)).toEqual(new Set([LIFE_T1.id, LIFE_T2.id]));
        expect(rowIds(r.finalState!, PROTECT_SUFFIXES_CARRIER.type)).toEqual(
            new Set([PROTECT_SUFFIXES_CARRIER.id]),
        );
    });
});
