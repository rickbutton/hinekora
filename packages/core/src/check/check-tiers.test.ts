import { describe, expect, it } from "vitest";
import { check, type CheckContext } from "./check.js";
import { guaranteedTypes } from "./astate.js";
import { buildRegistry } from "../resolve/registry.js";
import { rollableTiers } from "../resolve/tiers.js";
import { craft, has, iff, item, op } from "../__fixtures__/ast.js";
import { FIRE_RES_TIERED, MAXLIFE_T1, RING_BASE, TIERED_CATALOG } from "../__fixtures__/mods.js";

const registry = buildRegistry({ bases: [RING_BASE], mods: TIERED_CATALOG });
const ctx: CheckContext = { registry };
const rareRing = (prefixes: string[] = []) =>
    item({ base: "IronRing", ilvl: 100, rarity: "rare", prefixes });

describe("fuzzy resolution + tier ranking (unit)", () => {
    const rctx = { game: "poe1" as const, base: RING_BASE, ilvl: 100 };

    it("resolves a stat description to a ModType", () => {
        expect(registry.resolveModType("maximum life", rctx)).toMatchObject({
            ok: true,
            value: MAXLIFE_T1.type,
        });
        expect(registry.resolveModType("fire resistance", rctx)).toMatchObject({
            ok: true,
            value: FIRE_RES_TIERED.type,
        });
    });

    it("reports gibberish as unknown", () => {
        expect(registry.resolveModType("qwerty zzz", rctx).ok).toBe(false);
    });

    it("ranks tiers best (T1) first, by ilvl", () => {
        const tiers = rollableTiers(TIERED_CATALOG, "poe1", RING_BASE, 100, MAXLIFE_T1.type);
        expect(tiers.map((m) => m.id)).toEqual(["MaxLifeHigh", "MaxLifeMid", "MaxLifeLow"]);
    });
});

describe("checker — fuzzy names in predicates and item blocks", () => {
    it("resolves a fuzzy stat description in the item block", () => {
        const c = craft("poe1", rareRing(["maximum life"]), []);
        const r = check(c, ctx);
        expect(r.diagnostics).toEqual([]);
        expect(guaranteedTypes(r.finalState!).has(MAXLIFE_T1.type)).toBe(true);
    });

    it("errors on a tier that doesn't roll on this item", () => {
        const c = craft("poe1", rareRing(), [
            op("exalt"),
            iff(has("maximum life", 9), [op("annul")]),
        ]);
        expect(check(c, ctx).diagnostics.some((d) => d.message.includes("out of range"))).toBe(
            true,
        );
    });
});

describe("checker — tier tracking through operations", () => {
    it("tracks tier exclusivity: a mod proven T1 cannot also be T2", () => {
        // After an exalt, maximum-life is possible at any tier. Narrowing to T1
        // fixes the tier; a nested narrow to T2 is then a provably-dead arm.
        const c = craft("poe1", rareRing(), [
            op("exalt"),
            iff(has("maximum life", 1), [iff(has("maximum life", 2), [op("annul")])]),
        ]);
        const r = check(c, ctx);
        expect(r.diagnostics.some((d) => d.message.includes("can never run"))).toBe(true);
    });

    it("accepts a consistent tier narrow (T1 then T1)", () => {
        const c = craft("poe1", rareRing(), [
            op("exalt"),
            iff(has("maximum life", 1), [iff(has("maximum life", 1), [])]),
        ]);
        // The inner T1 narrow is redundant but not dead — no diagnostics.
        expect(check(c, ctx).diagnostics).toEqual([]);
    });
});
