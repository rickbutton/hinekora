import { describe, expect, it } from "vitest";
import { check, type CheckContext } from "./check.js";
import { buildRegistry } from "../resolve/registry.js";
import { andp, cmp, craft, item, op, until } from "../__fixtures__/ast.js";
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
        expect(check(c, ctx).diagnostics).toEqual([]);
    });

    it("still reports an exit the body only moves away from", () => {
        // An exalt never removes the prefix the item starts with, so no
        // iteration reaches zero prefixes.
        const c = craft(
            item({ base: "IronRing", ilvl: 100, rarity: "rare", prefixes: ["maximum life"] }),
            [until(cmp("prefixCount", "==", 0), [op("exalt")])],
        );
        const messages = check(c, ctx).diagnostics.map((d) => d.message);
        expect(messages.some((m) => m.includes("can never exit"))).toBe(true);
        expect(messages.some((m) => m.includes("has"))).toBe(false);
    });
});
