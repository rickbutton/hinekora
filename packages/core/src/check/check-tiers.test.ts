import { describe, expect, it } from "vitest";
import { check, type CheckContext } from "./check.js";
import { guaranteedTypes } from "./astate.js";
import { buildRegistry } from "../resolve/registry.js";
import { rollableTiers, tierLadder } from "../resolve/tiers.js";
import { andp, craft, has, iff, item, notp, op, orp, until } from "../__fixtures__/ast.js";
import { FIRE_RES_TIERED, MAXLIFE_T1, RING_BASE, TIERED_CATALOG } from "../__fixtures__/mods.js";
import type { TypeId } from "../model/ids.js";

const registry = buildRegistry({ bases: [RING_BASE], mods: TIERED_CATALOG });
const ctx: CheckContext = { registry };
const rareRing = (prefixes: readonly (string | { mod: string; tier?: number })[] = []) =>
    item({ base: "IronRing", ilvl: 100, rarity: "rare", prefixes });

describe("fuzzy resolution + tier ranking (unit)", () => {
    const rctx = { base: RING_BASE, ilvl: 100 };

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
        const tiers = rollableTiers(TIERED_CATALOG, RING_BASE, 100, MAXLIFE_T1.type);
        expect(tiers.map((m) => m.id)).toEqual(["MaxLifeHigh", "MaxLifeMid", "MaxLifeLow"]);
    });
});

describe("checker — fuzzy names in predicates and item blocks", () => {
    it("pins a declared mod's tier from a stat description + `t1`", () => {
        const c = craft(rareRing([{ mod: "maximum life", tier: 1 }]), []);
        const r = check(c, ctx);
        expect(r.diagnostics).toEqual([]);
        expect(guaranteedTypes(r.finalState!).has(MAXLIFE_T1.type)).toBe(true);
    });

    it("errors on a declared stat description with no tier", () => {
        const c = craft(rareRing(["maximum life"]), []);
        expect(check(c, ctx).diagnostics.some((d) => d.message.includes("declare the tier"))).toBe(
            true,
        );
    });

    it("accepts a bare name whose modifier rolls a single tier here", () => {
        const one = item({
            base: "IronRing",
            ilvl: 100,
            rarity: "rare",
            suffixes: ["fire resistance"],
        });
        const r = check(craft(one, []), ctx);
        expect(r.diagnostics).toEqual([]);
        expect(r.finalState!.tiers.get(FIRE_RES_TIERED.type)).toEqual(
            new Set([FIRE_RES_TIERED.id]),
        );
    });

    it("errors on a tier that doesn't roll on this item", () => {
        const c = craft(rareRing(), [op("exalt"), iff(has("maximum life", 9), [op("annul")])]);
        expect(check(c, ctx).diagnostics.some((d) => d.message.includes("out of range"))).toBe(
            true,
        );
    });
});

describe("tier numbers, whatever the item's level", () => {
    // Life's tiers unlock at levels 60, 30 and 1. The game numbers them over the
    // whole ladder, so an item of level 40 has no Tier 1 and its best is Tier 2.
    const LIFE = MAXLIFE_T1.type;
    const ringAt = (
        ilvl: number,
        prefixes: readonly (string | { mod: string; tier?: number })[] = [],
    ) => item({ base: "IronRing", ilvl, rarity: "rare", prefixes });

    it("names the same row at every item level", () => {
        expect(tierLadder(TIERED_CATALOG, RING_BASE, LIFE).map((m) => m.id)).toEqual([
            "MaxLifeHigh",
            "MaxLifeMid",
            "MaxLifeLow",
        ]);
        for (const ilvl of [40, 100]) {
            const r = check(craft(ringAt(ilvl, [{ mod: "maximum life", tier: 2 }]), []), ctx);
            expect(r.diagnostics).toEqual([]);
            expect(r.finalState!.tiers.get(LIFE)).toEqual(new Set(["MaxLifeMid"]));
        }
    });

    it("refuses a declared tier the item's level cannot roll, saying the level it needs", () => {
        const r = check(craft(ringAt(40, [{ mod: "maximum life", tier: 1 }]), []), ctx);
        expect(r.diagnostics.map((d) => d.message)).toEqual([
            'Tier 1 "maximum life" needs item level 60; this item is level 40.',
        ]);
    });

    it("refuses a tier beyond the ladder", () => {
        const r = check(craft(ringAt(40, [{ mod: "maximum life", tier: 4 }]), []), ctx);
        expect(r.diagnostics[0]!.message).toContain(
            'tier 4 is out of range for "maximum life" (it has 3 tiers on this base)',
        );
    });

    it("reads a bare name as the one tier the item's level rolls", () => {
        const r = check(craft(ringAt(10, ["maximum life"]), []), ctx);
        expect(r.diagnostics).toEqual([]);
        expect(r.finalState!.tiers.get(LIFE)).toEqual(new Set(["MaxLifeLow"]));
        const two = check(craft(ringAt(40, ["maximum life"]), []), ctx);
        expect(two.diagnostics[0]!.message).toContain('(e.g. `"maximum life" t2`)');
    });

    it("says a loop waiting on a tier no currency rolls here can never exit, and why", () => {
        const c = craft(ringAt(40), [until(has("maximum life", 1), [op("chaos")])]);
        expect(check(c, ctx).diagnostics.map((d) => d.message)).toEqual([
            'this loop can never exit: has "maximum life" t1 can never become true here — Tier 1 "maximum life" needs item level 60; this item is level 40',
        ]);
        // The best tier the level rolls is reached.
        const best = craft(ringAt(40), [until(has("maximum life", 2), [op("chaos")])]);
        expect(check(best, ctx).diagnostics).toEqual([]);
    });

    it("gives the level as the reason only where the tier is waited for", () => {
        const never = craft(ringAt(40), [op("exalt"), iff(has("maximum life", 1), [op("annul")])]);
        expect(check(never, ctx).diagnostics[0]!.message).toContain(
            'is impossible here — Tier 1 "maximum life" needs item level 60',
        );
        const absent = craft(ringAt(40), [
            op("exalt"),
            iff(notp(has("maximum life", 1)), [], [op("annul")]),
        ]);
        const messages = check(absent, ctx).diagnostics.map((d) => d.message);
        expect(messages).toHaveLength(1);
        expect(messages[0]).toContain("always holds here");
        expect(messages[0]).not.toContain("item level");
    });
});

describe("checker — tier tracking through operations", () => {
    it("tracks tier exclusivity: a mod proven T1 cannot also be T2", () => {
        // After an exalt, maximum-life is possible at any tier. Narrowing to T1
        // fixes the tier; a nested narrow to T2 is then a provably-dead arm.
        const c = craft(rareRing(), [
            op("exalt"),
            iff(has("maximum life", 1), [iff(has("maximum life", 2), [op("annul")])]),
        ]);
        const r = check(c, ctx);
        expect(r.diagnostics.some((d) => d.message.includes("can never run"))).toBe(true);
    });

    it("accepts a consistent tier narrow (T1 then T1)", () => {
        const c = craft(rareRing(), [
            op("exalt"),
            iff(has("maximum life", 1), [iff(has("maximum life", 1), [])]),
        ]);
        // The inner T1 narrow is redundant but not dead — no diagnostics.
        expect(check(c, ctx).diagnostics).toEqual([]);
    });
});

describe("checker — one of several tiers, then the work after it", () => {
    /** The tiers the state before the last step, the `annul`, allows for `type`. */
    const tiersBeforeAnnul = (c: ReturnType<typeof craft>, type: TypeId) => {
        const r = check(c, ctx);
        expect(r.diagnostics).toEqual([]);
        const entry = r.trace.findLast((e) => e.kind === "operation" && e.before.tiers.has(type));
        return entry === undefined ? undefined : [...entry.before.tiers.get(type)!];
    };

    it("pins the other member of 'one of these is T1' once the first is ruled out", () => {
        // until has life t1 or has fire t1 { chaos }   if not has "fire resistance" { annul }
        const c = craft(rareRing(), [
            until(orp(has("maximum life", 1), has("fire resistance", 1)), [op("chaos")]),
            iff(notp(has("fire resistance")), [op("annul")]),
        ]);
        expect(tiersBeforeAnnul(c, MAXLIFE_T1.type)).toEqual(["MaxLifeHigh"]);
    });

    it("pins the remaining tier once the other is ruled out", () => {
        const c = craft(rareRing(), [
            until(orp(has("maximum life", 1), has("maximum life", 2)), [op("chaos")]),
            iff(notp(has("maximum life", 1)), [op("annul")]),
        ]);
        expect(tiersBeforeAnnul(c, MAXLIFE_T1.type)).toEqual(["MaxLifeMid"]);
    });

    it("knows a modifier proven at one row is at no other, through a join", () => {
        const c = craft(rareRing(), [
            until(orp(has("maximum life", 1), has("maximum life", 2)), [op("chaos")]),
            iff(has("maximum life", 1), [iff(has("maximum life", 2), [op("annul")])]),
        ]);
        expect(check(c, ctx).diagnostics.some((d) => d.message.includes("can never run"))).toBe(
            true,
        );
    });

    it("rules a branch dead when every tier the item could have is denied", () => {
        const c = craft(rareRing(), [
            until(orp(has("maximum life", 1), has("maximum life", 2)), [op("chaos")]),
            iff(andp(notp(has("maximum life", 1)), notp(has("maximum life", 2))), [op("annul")]),
        ]);
        expect(check(c, ctx).diagnostics.some((d) => d.message.includes("can never run"))).toBe(
            true,
        );
    });

    it("excludes the other rows once the presence function alone pins a modifier", () => {
        // The join after the loop drops life from the overlay (only one branch
        // named it), so only the atoms know: ruling fire out pins life to T1, and
        // T2 is then impossible; before fire is ruled out, T2 is still live.
        const pinned = craft(rareRing(), [
            until(orp(has("maximum life", 1), has("fire resistance", 1)), [op("chaos")]),
            iff(notp(has("fire resistance")), [iff(has("maximum life", 2), [op("annul")])]),
        ]);
        expect(
            check(pinned, ctx).diagnostics.some((d) => d.message.includes("can never run")),
        ).toBe(true);
        const open = craft(rareRing(), [
            until(orp(has("maximum life", 1), has("fire resistance", 1)), [op("chaos")]),
            iff(has("maximum life", 2), [op("annul")]),
        ]);
        expect(check(open, ctx).diagnostics).toEqual([]);
    });

    it("forgets the tier facts with the modifier when a removal may have taken it", () => {
        // After an Orb of Annulment the life modifier may be gone, so denying
        // both of its tiers is possible again; the branch is live.
        const c = craft(rareRing(), [
            until(orp(has("maximum life", 1), has("maximum life", 2)), [op("chaos")]),
            op("annul"),
            iff(andp(notp(has("maximum life", 1)), notp(has("maximum life", 2))), [op("scour")]),
        ]);
        expect(check(c, ctx).diagnostics.some((d) => d.message.includes("can never run"))).toBe(
            false,
        );
    });
});
