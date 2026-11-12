import { describe, expect, it } from "vitest";
import { checkPresent, type CheckContext } from "./check.js";
import { buildRegistry } from "../resolve/registry.js";
import { andp, cmp, craft, has, iff, isRarity, item, op, until } from "../__fixtures__/ast.js";
import { RING_BASE, TIERED_CATALOG } from "../__fixtures__/mods.js";

const registry = buildRegistry({ bases: [RING_BASE], mods: TIERED_CATALOG });
const ctx: CheckContext = { registry };
const fullRing = () =>
    item({
        base: "IronRing",
        ilvl: 100,
        rarity: "rare",
        prefixes: ["random", "random", "random"],
        suffixes: ["random", "random", "random"],
    });

describe("checker — a loop whose exit takes several iterations", () => {
    it("is not reported as never exiting", () => {
        // From a full ring, two annuls are needed before both sides can be at
        // two; the exit is judged against the whole invariant, not one pass.
        const c = craft(fullRing(), [
            until(andp(cmp("prefixCount", "<=", 2), cmp("suffixCount", "<=", 2)), [op("annul")]),
        ]);
        expect(checkPresent(c, ctx).diagnostics).toEqual([]);
    });

    it("still reports an exit the body only moves away from", () => {
        // An exalt never removes the prefix the item starts with, so no
        // iteration reaches zero prefixes.
        const c = craft(
            item({ base: "IronRing", ilvl: 100, rarity: "rare", prefixes: ["maximum life"] }),
            [until(cmp("prefixCount", "==", 0), [op("exalt")])],
        );
        const messages = checkPresent(c, ctx).diagnostics.map((d) => d.message);
        expect(messages.some((m) => m.includes("can never exit"))).toBe(true);
        expect(messages.some((m) => m.includes("has"))).toBe(false);
    });
});

describe("checker — the body runs only where the exit predicate is false", () => {
    it("does not refuse a step on the states that leave the loop", () => {
        // With the suffixes full, the exalt is only ever used while a prefix is
        // open: the head states with three prefixes exit instead of exalting.
        const c = craft(
            item({
                base: "IronRing",
                ilvl: 100,
                rarity: "rare",
                suffixes: ["random", "random", "random"],
            }),
            [until(cmp("prefixCount", "==", 3), [op("exalt")])],
        );
        const r = checkPresent(c, ctx);
        expect(r.diagnostics).toEqual([]);
        expect(r.finalState!.counts.total).toEqual([6, 6]);
    });

    it("reports a loop whose exit already holds, so its body never runs", () => {
        const c = craft(
            item({ base: "IronRing", ilvl: 100, rarity: "rare", prefixes: ["random"] }),
            [until(cmp("prefixCount", "<=", 3), [op("annul")])],
        );
        const messages = checkPresent(c, ctx).diagnostics.map((d) => d.message);
        expect(messages).toEqual([expect.stringContaining("this loop's body never runs")]);
    });

    it("still reports a step that fails on a state that continues", () => {
        // From two prefixes the first exalt fills the item and the second has
        // no slot; that head state continues, so the body is checked on it.
        const c = craft(
            item({
                base: "IronRing",
                ilvl: 100,
                rarity: "rare",
                suffixes: ["random", "random", "random"],
            }),
            [until(cmp("prefixCount", "==", 3), [op("exalt"), op("exalt")])],
        );
        const messages = checkPresent(c, ctx).diagnostics.map((d) => d.message);
        expect(messages.some((m) => m.includes("open affix slot"))).toBe(true);
    });
});

describe("checker — a modifier the item is known to carry rules out Normal", () => {
    it("leaves a loop entered Normal as Rare once its exit names a modifier", () => {
        // The head joins the Normal item with the alchemised one; the exit's
        // life is a modifier a Normal item cannot hold, so only Rare leaves.
        const c = craft(item({ base: "IronRing", ilvl: 100, rarity: "normal" }), [
            until(has("maximum life"), [iff(isRarity("normal"), [op("alchemy")], [op("scour")])]),
            op("chaos"),
        ]);
        const r = checkPresent(c, ctx);
        expect(r.diagnostics).toEqual([]);
        expect([...r.finalState!.rarities]).toEqual(["rare"]);
    });

    it("leaves a loop that may be Magic as Rare once its exit needs two prefixes", () => {
        // A Magic item holds one prefix, so only the regalled paths leave.
        const c = craft(item({ base: "IronRing", ilvl: 100, rarity: "magic" }), [
            until(cmp("prefixCount", ">=", 2), [
                iff(isRarity("magic"), [op("regal")], [op("scour"), op("transmute")]),
            ]),
            op("chaos"),
        ]);
        const r = checkPresent(c, ctx);
        expect(r.diagnostics).toEqual([]);
        expect([...r.finalState!.rarities]).toEqual(["rare"]);
    });
});
