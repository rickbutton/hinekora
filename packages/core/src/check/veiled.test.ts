import { describe, expect, it } from "vitest";
import { check, type CheckContext } from "./check.js";
import { guaranteedTypes } from "./astate.js";
import { buildRegistry } from "../resolve/registry.js";
import { craft, has, iff, item, op, unveil, veiled } from "../__fixtures__/ast.js";
import { AMULET_BASE, CATALOG, RING_BASE, VEILED_CATALOG } from "../__fixtures__/mods.js";
import { veiledPool } from "../pool/veiled.js";
import { GroupId, TypeId } from "../model/ids.js";

const registry = buildRegistry({
    bases: [RING_BASE, AMULET_BASE],
    mods: [...CATALOG, ...VEILED_CATALOG],
    baseAliases: { "Iron Ring": "IronRing", "Coral Amulet": "CoralAmulet" },
});
const ctx: CheckContext = { registry };

const rareRing = (suffixes: string[] = []) =>
    item({ base: "Iron Ring", ilvl: 100, rarity: "rare", suffixes });
const rareAmulet = () => item({ base: "Coral Amulet", ilvl: 100, rarity: "rare" });

const guaranteed = (r: ReturnType<typeof check>): Set<string> =>
    new Set([...guaranteedTypes(r.finalState!)]);

describe("veiledPool", () => {
    it("returns the item's unveil options, filtered by class and blocked families", () => {
        const ring = veiledPool(registry.catalog, RING_BASE, 100, new Set());
        expect(new Set(ring.map((m) => m.type))).toEqual(
            new Set([
                TypeId("VeiledDoubleDamage"),
                TypeId("VeiledCastSpeed"),
                TypeId("VeiledArmourAndLife"),
            ]),
        );
        // An amulet also offers the amulet-only life hybrid (four options).
        expect(veiledPool(registry.catalog, AMULET_BASE, 100, new Set())).toHaveLength(4);
        // A present Life family blocks that hybrid back out.
        const blocked = veiledPool(registry.catalog, AMULET_BASE, 100, new Set([GroupId("Life")]));
        expect(blocked.map((m) => m.type)).not.toContain(TypeId("VeiledLifeHybrid"));
    });
});

describe("veiled orbs", () => {
    it("veiled chaos leaves a veiled mod ready to unveil", () => {
        const r = check(craft("poe1", rareRing(), [veiled("chaos"), unveil()]), ctx);
        expect(r.diagnostics).toEqual([]);
    });

    it("unveil without a veiled mod fails", () => {
        const r = check(craft("poe1", rareRing(), [unveil()]), ctx);
        expect(r.diagnostics).toHaveLength(1);
        expect(r.diagnostics[0]!.message).toContain("veiled modifier");
    });

    it("veiled exalt keeps the affix count (removes one, adds the veiled mod)", () => {
        const r = check(craft("poe1", rareRing(["random", "random"]), [veiled("exalt")]), ctx);
        expect(r.diagnostics).toEqual([]);
        expect(r.finalState!.counts.total).toEqual([2, 2]);
    });
});

describe("unveil", () => {
    it("guarantees a target when the pool is 3 or fewer", () => {
        const r = check(craft("poe1", rareRing(), [veiled("chaos"), unveil("double damage")]), ctx);
        expect(r.diagnostics).toEqual([]);
        expect(guaranteed(r)).toContain("VeiledDoubleDamage");
    });

    it("cannot guarantee a target when more than 3 options remain", () => {
        const r = check(
            craft("poe1", rareAmulet(), [veiled("chaos"), unveil("double damage")]),
            ctx,
        );
        expect(r.diagnostics).toHaveLength(1);
        expect(r.diagnostics[0]!.message).toMatch(/block the pool|3 or fewer/);
    });

    it("rejects a target that isn't an available option", () => {
        const r = check(craft("poe1", rareRing(), [veiled("chaos"), unveil("maximum life")]), ctx);
        expect(r.diagnostics).toHaveLength(1);
        expect(r.diagnostics[0]!.message).toContain("not an available unveil option");
    });

    it("bare unveil leaves a disjunction a branch can narrow", () => {
        const c = craft("poe1", rareAmulet(), [
            veiled("chaos"),
            unveil(),
            iff(has("cast speed"), [op("scour")]),
        ]);
        const r = check(c, ctx);
        // The `if has "cast speed"` branch is reachable (one possible unveil outcome),
        // so no dead-branch diagnostic.
        expect(r.diagnostics).toEqual([]);
    });
});
