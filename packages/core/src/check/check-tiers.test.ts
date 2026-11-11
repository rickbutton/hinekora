import { describe, expect, it } from "vitest";
import { check, type CheckContext } from "./check.js";
import { guaranteedTypes } from "./astate.js";
import { buildRegistry } from "../resolve/registry.js";
import { rollableTiers, tierLadder } from "../resolve/tiers.js";
import { andp, craft, has, iff, item, notp, op, orp, until } from "../__fixtures__/ast.js";
import {
    BOOTS_BASE,
    CATALOG,
    FIRE_RES_TIERED,
    FIRE_RESIST,
    MAXLIFE_T1,
    RING_BASE,
    TIERED_CATALOG,
} from "../__fixtures__/mods.js";
import { GroupId, ModId, TagId, TypeId } from "../model/ids.js";
import type { Mod } from "../model/mod.js";

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

describe("the item level as the reason a tier cannot be met", () => {
    const ringAt = (ilvl: number, prefixes: readonly { mod: string; tier: number }[]) =>
        item({ base: "IronRing", ilvl, rarity: "rare", prefixes });

    it("is not given for a modifier the item holds at another tier", () => {
        // The item has the second tier: that, not its level, rules the first out.
        const held = craft(ringAt(40, [{ mod: "maximum life", tier: 2 }]), [
            iff(has("maximum life", 1), [op("annul")]),
        ]);
        expect(check(held, ctx).diagnostics.map((d) => d.message)).toEqual([
            `the 'if' branch can never run: has "maximum life" t1 is impossible here`,
        ]);
        // A loop that never rerolls the modifier cannot reach the tier either.
        const kept = craft(ringAt(40, [{ mod: "maximum life", tier: 2 }]), [
            until(has("maximum life", 1), [op("exalt")]),
        ]);
        expect(check(kept, ctx).diagnostics[0]!.message).toBe(
            `this loop can never exit: has "maximum life" t1 can never become true here`,
        );
    });

    it("is given where a reroll could bring the modifier back at a tier the level allows", () => {
        const rerolled = craft(ringAt(40, [{ mod: "maximum life", tier: 2 }]), [
            until(has("maximum life", 1), [op("chaos")]),
        ]);
        expect(check(rerolled, ctx).diagnostics[0]!.message).toContain(
            'Tier 1 "maximum life" needs item level 60; this item is level 40',
        );
    });
});

describe("tier numbers on an item with two influences", () => {
    // Each influence's rows are numbered apart, so a tier names a row of each.
    const WARD = TypeId("Ward");
    const row = (tag: "shaper" | "eyrie", minLevel: number, roll: string): Mod => ({
        ...FIRE_RESIST,
        id: ModId(`Ward_${tag}_${minLevel}`),
        type: WARD,
        families: new Set([GroupId("Ward")]),
        minLevel,
        spawn: [
            { tag: TagId(`boots_${tag}`), weight: 500 },
            { tag: TagId("default"), weight: 0 },
        ],
        text: `+${roll} to Ward against Ailing Enemies`,
    });
    const two = buildRegistry({
        bases: [BOOTS_BASE],
        mods: [
            ...CATALOG,
            row("shaper", 80, "(41-50)"),
            row("shaper", 68, "(31-40)"),
            row("eyrie", 84, "(46-55)"),
            row("eyrie", 75, "(36-45)"),
            row("eyrie", 60, "(26-35)"),
        ],
    });
    const boots = (ilvl: number, suffixes: readonly (string | { mod: string; tier?: number })[]) =>
        item({
            base: "Iron Greaves",
            ilvl,
            rarity: "rare",
            influences: ["shaper", "redeemer"],
            suffixes,
        });
    const run = (c: ReturnType<typeof craft>) => check(c, { registry: two });
    const WARD_NAME = "ward against ailing enemies";

    it("reads a declared tier as either influence's row of that number", () => {
        const r = run(craft(boots(100, [{ mod: WARD_NAME, tier: 2 }]), []));
        expect(r.diagnostics).toEqual([]);
        expect(r.finalState!.tiers.get(WARD)).toEqual(new Set(["Ward_shaper_68", "Ward_eyrie_75"]));
        // The third tier is the Redeemer's alone.
        const third = run(craft(boots(100, [{ mod: WARD_NAME, tier: 3 }]), []));
        expect(third.finalState!.tiers.get(WARD)).toEqual(new Set(["Ward_eyrie_60"]));
        const fourth = run(craft(boots(100, [{ mod: WARD_NAME, tier: 4 }]), []));
        expect(fourth.diagnostics[0]!.message).toContain("it has 3 tiers on this base");
    });

    it("holds a declared tier to the rows the item's level rolls", () => {
        // At level 82 the Shaper's first tier rolls and the Redeemer's does not.
        const r = run(craft(boots(82, [{ mod: WARD_NAME, tier: 1 }]), []));
        expect(r.diagnostics).toEqual([]);
        expect(r.finalState!.tiers.get(WARD)).toEqual(new Set(["Ward_shaper_80"]));
        const low = run(craft(boots(70, [{ mod: WARD_NAME, tier: 1 }]), []));
        expect(low.diagnostics.map((d) => d.message)).toEqual([
            `Tier 1 "${WARD_NAME}" needs item level 80; this item is level 70.`,
        ]);
    });

    it("finds a row at its own influence's number in a condition", () => {
        // The Redeemer's level-75 row is its second tier, not the fourth of five.
        const held = (tier: number) =>
            run(
                craft(boots(100, ["Ward_eyrie_75"]), [
                    iff(has(WARD_NAME, tier), [op("annul")], [op("exalt")]),
                ]),
            ).diagnostics.map((d) => d.message);
        expect(held(2)).toHaveLength(1);
        expect(held(2)[0]).toContain("always holds here");
        expect(held(1)[0]).toContain("can never run");
        expect(held(4)[0]).toContain("out of range");
        // A reroll may leave either influence's first tier.
        const rolled = run(
            craft(boots(100, []), [
                until(has(WARD_NAME, 1), [op("chaos")]),
                iff(has(WARD_NAME, 1), [], [op("annul")]),
            ]),
        );
        expect(rolled.diagnostics.map((d) => d.message)).toHaveLength(1);
        expect(rolled.diagnostics[0]!.message).toContain("always holds here");
    });

    /** The rows the modifier may be before the last step, an `annul`. */
    const rowsBeforeAnnul = (c: ReturnType<typeof craft>) => {
        const r = run(c);
        expect(r.diagnostics).toEqual([]);
        const entry = r.trace.findLast((e) => e.kind === "operation")!;
        return [...(entry.before.tiers.get(WARD) ?? [])].sort();
    };

    it("leaves a loop on a tier at either influence's row of it", () => {
        const exit = (ilvl: number) =>
            rowsBeforeAnnul(
                craft(boots(ilvl, []), [until(has(WARD_NAME, 1), [op("chaos")]), op("annul")]),
            );
        expect(exit(100)).toEqual(["Ward_eyrie_84", "Ward_shaper_80"]);
        // At level 82 a Chaos Orb rolls the Shaper's first tier only.
        expect(exit(82)).toEqual(["Ward_shaper_80"]);
    });

    it("rules both rows of a tier out where the condition on it fails", () => {
        // The modifier is at any of its five rows; not at its first tier, it is
        // at neither influence's.
        const others = rowsBeforeAnnul(
            craft(boots(100, []), [
                until(has(WARD_NAME), [op("chaos")]),
                iff(has(WARD_NAME, 1), [], [op("annul")]),
            ]),
        );
        expect(others).toEqual(["Ward_eyrie_60", "Ward_eyrie_75", "Ward_shaper_68"]);
        // Declared at the second tier, it is one of two rows: the first tier's
        // condition never holds, the second's never fails.
        const declared = (tier: number) =>
            run(
                craft(boots(100, [{ mod: WARD_NAME, tier: 2 }]), [
                    iff(has(WARD_NAME, tier), [op("exalt")], [op("annul")]),
                ]),
            ).diagnostics.map((d) => d.message);
        expect(declared(1)).toEqual([expect.stringContaining("the 'if' branch can never run")]);
        expect(declared(2)).toEqual([expect.stringContaining("the 'else' branch can never run")]);
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

describe("checker — two modifiers that share a type and a level", () => {
    // As an Elder amulet's minion counts are: one type, two rows of one level,
    // each the only tier of its own modifier.
    const minion = (id: string, text: string): Mod => ({
        ...MAXLIFE_T1,
        id: ModId(id),
        type: TypeId("MinionCount"),
        families: new Set([GroupId("MinionCount")]),
        minLevel: 68,
        text,
    });
    const SKELETONS = minion("Skeletons1", "+1 to maximum number of Skeletons");
    const ZOMBIES = minion("Zombies1", "+1 to maximum number of Raised Zombies");
    const twins = buildRegistry({
        bases: [RING_BASE],
        mods: [...TIERED_CATALOG, SKELETONS, ZOMBIES],
    });
    const run = (c: ReturnType<typeof craft>) => check(c, { registry: twins });
    const rows = (r: ReturnType<typeof check>) => [
        ...(r.finalState!.tiers.get(SKELETONS.type) ?? []),
    ];
    const zombies = "maximum number of raised zombies";
    const skeletons = "maximum number of skeletons";

    it("resolves either modifier's wording to the type", () => {
        const rctx = { base: RING_BASE, ilvl: 100 };
        for (const name of [zombies, skeletons, "maximum number of"]) {
            expect(twins.resolveModType(name, rctx)).toEqual({ ok: true, value: SKELETONS.type });
        }
    });

    it("declares the one a name words, with no tier to give", () => {
        for (const [name, row] of [
            [zombies, ZOMBIES],
            [skeletons, SKELETONS],
        ] as const) {
            const r = run(craft(rareRing([name]), []));
            expect(r.diagnostics).toEqual([]);
            expect(rows(r)).toEqual([row.id]);
        }
    });

    it("declares either where the name words both", () => {
        const r = run(craft(rareRing(["maximum number of"]), []));
        expect(r.diagnostics).toEqual([]);
        expect(rows(r).sort()).toEqual([SKELETONS.id, ZOMBIES.id]);
    });

    it("has one tier, so a second is out of range", () => {
        const declared = run(craft(rareRing([{ mod: zombies, tier: 2 }]), []));
        expect(declared.diagnostics.map((d) => d.message)).toEqual([
            `tier 2 is out of range for "${zombies}" (it has 1 tier on this base).`,
        ]);
        const loop = run(craft(rareRing(), [until(has(zombies, 2), [op("chaos")])]));
        expect(loop.diagnostics.map((d) => d.message)).toEqual([
            `tier 2 is out of range for "${zombies}" (it has 1 tier on this base)`,
        ]);
    });

    it("a condition on one is not met by the other, with a tier or without", () => {
        for (const tier of [undefined, 1]) {
            const other = run(
                craft(rareRing([zombies]), [iff(has(skeletons, tier), [op("annul")])]),
            );
            expect(other.diagnostics.map((d) => d.message)).toEqual([
                expect.stringContaining("the 'if' branch can never run"),
            ]);
            const same = run(craft(rareRing([zombies]), [iff(has(zombies, tier), [op("annul")])]));
            expect(same.diagnostics).toEqual([]);
        }
    });

    it("a loop on one ends on that one, and on either where the name words both", () => {
        const one = run(craft(rareRing(), [until(has(zombies), [op("chaos")])]));
        expect(one.diagnostics).toEqual([]);
        expect(rows(one)).toEqual([ZOMBIES.id]);
        const either = run(craft(rareRing(), [until(has("maximum number of"), [op("chaos")])]));
        expect(either.diagnostics).toEqual([]);
        expect(rows(either).sort()).toEqual([SKELETONS.id, ZOMBIES.id]);
    });

    it("a modifier's id among them means that one", () => {
        const r = run(craft(rareRing(), [until(has(ZOMBIES.id), [op("chaos")])]));
        expect(r.diagnostics).toEqual([]);
        expect(rows(r)).toEqual([ZOMBIES.id]);
    });
});
