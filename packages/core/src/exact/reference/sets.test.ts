import { describe, expect, it } from "vitest";
import { BOOTS_BASE, RING_BASE } from "../../__fixtures__/mods.js";
import { influenceKey, NO_INFLUENCE } from "../../model/marks.js";
import { buildRegistry } from "../../resolve/registry.js";
import { benchCraft, benchRow, modRow } from "./catalog.js";
import { cItem, cMod, NO_IMPLICIT, refCtx } from "./item.js";
import { allItems, diffSets, ItemSet, randomSubset } from "./sets.js";
import { isWellFormed } from "./wellformed.js";

// Two prefixes and a suffix that shares the first prefix's group.
const A = modRow({ id: "A1", type: "TypeA", gen: "prefix", families: ["FA"], text: "+(1-2) to A" });
const B = modRow({ id: "B1", type: "TypeB", gen: "prefix", families: ["FB"], text: "+5 to B" });
const C = modRow({ id: "C1", type: "TypeC", gen: "suffix", families: ["FA"], text: "Grants C" });
const BENCH_B = benchRow("BenchB1", B, "+(6-7) to B");
const registry = buildRegistry({
    bases: [RING_BASE, BOOTS_BASE],
    mods: [A, B, C, BENCH_B],
    benchCrafts: [benchCraft(BENCH_B, RING_BASE.itemClass)],
});
const ctx = refCtx(registry, RING_BASE, 84);
const rows = [A.id, B.id, C.id];

describe("allItems", () => {
    // Magic: none, A, B, C, B+C (A+B are two prefixes, A+C share a group).
    it("lists the subsets the caps and groups allow", () => {
        expect(allItems(ctx, { rows, rarities: ["normal", "magic"] }).size).toBe(1 + 5);
        // Rare: every subset but those with both A and C.
        expect(allItems(ctx, { rows, rarities: ["rare"] }).size).toBe(6);
    });
    it("every value of a span when asked", () => {
        expect(allItems(ctx, { rows, rarities: ["normal", "magic"], values: true }).size).toBe(7);
        // Rare: none, A×2, B, C, A+B×2, B+C.
        expect(allItems(ctx, { rows, rarities: ["rare"], values: true }).size).toBe(8);
    });
    it("fractured and not", () => {
        // Magic: 1 + 2 + 2 + 2 + 4.
        expect(allItems(ctx, { rows, rarities: ["magic"], fractured: true }).size).toBe(11);
    });
    it("crafted and not, the bench's limit aside", () => {
        // Magic: 1 + 2 + 2 + 2 + 4.
        expect(allItems(ctx, { rows, rarities: ["magic"], crafted: true }).size).toBe(11);
    });
    it("a bench row is always crafted", () => {
        const items = allItems(ctx, { rows: [BENCH_B.id], rarities: ["magic"], values: true });
        expect(items.size).toBe(3);
        expect(items.every((i) => i.mods.every((m) => m.crafted))).toBe(true);
    });
    it("the marks it is given, refusing a fractured influenced item", () => {
        const items = allItems(ctx, {
            rows,
            rarities: ["magic"],
            fractured: true,
            influences: [NO_INFLUENCE, influenceKey(["hunter"])],
            strands: [0, 100],
        });
        expect(items.size).toBe((11 + 5) * 2);
    });
    it("corruption and eldritch implicits, where the base takes them", () => {
        const marks = {
            rows,
            rarities: ["magic"],
            corrupted: [false, true],
            exarch: [NO_IMPLICIT, { tier: 1, type: undefined }],
            eater: [NO_IMPLICIT, { tier: 2, type: undefined }],
        } as const;
        // Boots of item level 84 take either implicit, unnamed in this catalogue.
        expect(allItems(refCtx(registry, BOOTS_BASE, 84), marks).size).toBe(5 * 2 * 2 * 2);
        // A ring takes none.
        expect(allItems(ctx, marks).size).toBe(5 * 2);
    });
    it("lists only well-formed items", () => {
        const items = allItems(ctx, { rows, values: true, fractured: true, crafted: true });
        expect(items.every((i) => isWellFormed(i, ctx))).toBe(true);
    });
});

describe("ItemSet", () => {
    const none = cItem({ rarity: "magic" });
    const a1 = cItem({ rarity: "magic", mods: [cMod(A.id, 1)] });
    const a2 = cItem({ rarity: "magic", mods: [cMod(A.id, 2)] });
    const bc = cItem({ rarity: "magic", mods: [cMod(C.id, undefined), cMod(B.id, 5)] });
    const cb = cItem({ rarity: "magic", mods: [cMod(B.id, 5), cMod(C.id, undefined)] });

    it("an item is its modifiers in any order", () => {
        expect(ItemSet.of([bc, cb]).size).toBe(1);
        expect(ItemSet.of([bc]).has(cb)).toBe(true);
    });
    it("set algebra", () => {
        const x = ItemSet.of([none, a1]);
        const y = ItemSet.of([a1, a2]);
        expect(x.union(y).size).toBe(3);
        expect(x.intersect(y).equals(ItemSet.of([a1]))).toBe(true);
        expect(x.minus(y).equals(ItemSet.of([none]))).toBe(true);
        expect(x.equals(y)).toBe(false);
        expect(ItemSet.empty.size).toBe(0);
    });
    it("filter, map and flatMap", () => {
        const x = ItemSet.of([none, a1, a2]);
        expect(x.filter((i) => i.mods.length > 0).size).toBe(2);
        expect(x.map(() => none).equals(ItemSet.of([none]))).toBe(true);
        const image = x.flatMap((i) => (i.mods.length === 0 ? [a1, a2] : []));
        expect(image.equals(ItemSet.of([a1, a2]))).toBe(true);
    });
    it("a diff names the extra and the missing items, capped", () => {
        expect(diffSets(ItemSet.of([a1]), ItemSet.of([a1]))).toBe("");
        const diff = diffSets(ItemSet.of([none, a1]), ItemSet.of([a1, a2, bc]), 1);
        expect(diff).toContain("expected 2 items, got 3");
        expect(diff).toContain("extra (2):");
        expect(diff).toContain("… and 1 more");
        expect(diff).toContain("missing (1):");
    });
    it("a random subset is the seed's", () => {
        const all = allItems(ctx, { rows, values: true, fractured: true });
        const pick = randomSubset(all, 7, 5);
        expect(pick.size).toBe(5);
        expect(pick.equals(randomSubset(all, 7, 5))).toBe(true);
        expect(pick.every((i) => all.has(i))).toBe(true);
        expect(randomSubset(all, 7, all.size + 3).equals(all)).toBe(true);
    });
});
