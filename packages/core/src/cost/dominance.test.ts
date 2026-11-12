import { describe, expect, it } from "vitest";
import { check } from "../exact/check.js";
import { buildRegistry } from "../resolve/registry.js";
import { andp, cmp, craft, has, hasValue, iff, item, notp, op, orp } from "../__fixtures__/ast.js";
import {
    BOOTS_BASE,
    CATALOG,
    ELEVATED_BOOTS_PREFIX,
    ELEVATED_BOOTS_SUFFIX,
    HUNTER_BOOTS_PREFIX,
    HUNTER_BOOTS_SUFFIX,
    PROTECT_SUFFIXES_CARRIER,
} from "../__fixtures__/mods.js";
import type { Pred } from "../ast/index.js";
import { GroupId, ModId, TagId, TypeId } from "../model/ids.js";
import type { Mod } from "../model/mod.js";
import { findMethod } from "../check/methods.js";
import { methodItemOf } from "../exact/build.js";
import { influenceKey } from "../model/marks.js";
import { costOf } from "./report.js";
import { Tracker } from "./track.js";

/** Another Hunter modifier of the base's, with an elevated row of its type:
 *  a condition tells the two apart by value alone. */
const another = (base: Mod, name: string): Mod[] => {
    const row: Mod = {
        ...base,
        id: ModId(`${name}1`),
        type: TypeId(name),
        families: new Set([GroupId(name)]),
        text: `+(10-20) to ${name}`,
    };
    const elevated: Mod = {
        ...row,
        id: ModId(`${name}Elevated`),
        source: "elevated",
        name: `Elevated ${name}`,
        spawn: row.spawn.map((w) => ({ ...w, weight: 0 })),
        text: `+(30-40) to ${name}`,
    };
    return [row, elevated];
};
const [SECOND_PREFIX, ELEVATED_SECOND_PREFIX] = another(HUNTER_BOOTS_PREFIX, "HunterBootsSecond");
const [THIRD, ELEVATED_THIRD] = another(HUNTER_BOOTS_SUFFIX, "HunterBootsThird");
/** A tier above the Hunter suffix's. */
const HIGHER: Mod = { ...HUNTER_BOOTS_SUFFIX, id: ModId("HunterBootsSuffix0"), minLevel: 50 };

const mods = [
    ...CATALOG,
    HUNTER_BOOTS_PREFIX,
    HUNTER_BOOTS_SUFFIX,
    ELEVATED_BOOTS_PREFIX,
    ELEVATED_BOOTS_SUFFIX,
    PROTECT_SUFFIXES_CARRIER,
    THIRD!,
    ELEVATED_THIRD!,
];
const registry = buildRegistry({ bases: [BOOTS_BASE], mods });
const withSecond = buildRegistry({
    bases: [BOOTS_BASE],
    mods: [...mods, SECOND_PREFIX!, ELEVATED_SECOND_PREFIX!],
});
const tiered = buildRegistry({ bases: [BOOTS_BASE], mods: [...mods, HIGHER] });

const boots = (prefixes: string[], suffixes: string[], ilvl = 100) =>
    item({
        base: "Iron Greaves",
        ilvl,
        rarity: "rare",
        prefixes,
        suffixes,
        influences: ["hunter"],
    });

/** The cost report of an Orb of Dominance on the item, then each condition
 *  asked in turn: the orb's step and each condition's chance. */
function after(start: ReturnType<typeof boots>, conditions: readonly Pred[], reg = registry) {
    const c = craft(start, [op("dominance"), ...conditions.map((p) => iff(p, []))]);
    const result = check(c, { registry: reg });
    // The check takes the orb; it may find a condition after it impossible.
    for (const d of result.diagnostics) expect(d.message).toContain("can never run");
    const steps = costOf(c, result, reg).steps;
    return {
        orb: steps.find((s) => s.kind === "operation")!,
        asked: steps.filter((s) => s.kind === "if"),
        chances: steps.filter((s) => s.kind === "if").map((s) => s.branch!),
    };
}

/** The share of the orb's picks, one modifier removed and another raised,
 *  each pair as likely, that `holds` of. */
function share<T>(reach: readonly T[], holds: (gone: T, up: T) => boolean): number {
    let yes = 0;
    let all = 0;
    for (const gone of reach) {
        for (const up of reach) {
            if (up === gone) continue;
            all++;
            if (holds(gone, up)) yes++;
        }
    }
    return yes / all;
}

const elevatedPrefix = has("Elevated hunter boots prefix");
const elevatedThird = hasValue(THIRD!.id, ">=", 30);

describe("the cost walk through an Orb of Dominance", () => {
    it("leaves, of two influenced modifiers, one elevated: each half the time", () => {
        const start = boots([HUNTER_BOOTS_PREFIX.id, "IncreasedLife1"], [HUNTER_BOOTS_SUFFIX.id]);
        const { orb, asked, chances } = after(start, [
            elevatedPrefix,
            has(HUNTER_BOOTS_SUFFIX.id),
            has(HUNTER_BOOTS_PREFIX.id),
            andp(elevatedPrefix, has(HUNTER_BOOTS_SUFFIX.id)),
            has("IncreasedLife1"),
        ]);
        const reach = ["prefix", "suffix"];
        const exact = share(reach, (_gone, up) => up === "prefix");
        expect(exact).toBe(1 / 2);
        expect(chances[0]).toBeCloseTo(exact, 12);
        expect(chances[1]).toBeCloseTo(
            share(reach, (gone) => gone !== "suffix"),
            12,
        );
        // The prefix is removed or elevated, never left as it was, and the
        // suffix does not outlast an elevated prefix; the modifier that is
        // not influenced stays.
        expect(chances[2]).toBe(0);
        expect(chances[3]).toBe(0);
        expect(chances[4]).toBe(1);
        expect(orb.note).toContain("no source states its odds");
        expect(orb.note).not.toContain("every item the check allows");
        expect(asked.map((s) => s.note)).toEqual(asked.map(() => undefined));
    });

    it("picks among three influenced modifiers, each pair of removed and raised alike", () => {
        const start = boots(
            [HUNTER_BOOTS_PREFIX.id, "IncreasedLife1"],
            [HUNTER_BOOTS_SUFFIX.id, THIRD!.id],
        );
        const { asked, chances } = after(start, [
            elevatedPrefix,
            elevatedThird,
            andp(elevatedPrefix, has(HUNTER_BOOTS_SUFFIX.id)),
            notp(orp(has(HUNTER_BOOTS_PREFIX.id), elevatedPrefix)),
            andp(has(HUNTER_BOOTS_PREFIX.id), elevatedThird),
            hasValue(THIRD!.id, ">=", 35),
        ]);
        const reach = ["prefix", "suffix", "third"];
        const exact = [
            share(reach, (_gone, up) => up === "prefix"),
            share(reach, (_gone, up) => up === "third"),
            share(reach, (gone, up) => up === "prefix" && gone === "third"),
            share(reach, (gone) => gone === "prefix"),
            share(reach, (gone, up) => gone === "suffix" && up === "third"),
            // The elevated modifier's value is rolled fresh: 35 to 40 of 30 to 40.
            share(reach, (_gone, up) => up === "third") * (6 / 11),
        ];
        expect(exact.slice(0, 5)).toEqual([1 / 3, 1 / 3, 1 / 6, 1 / 3, 1 / 6]);
        chances.forEach((p, i) => expect(p).toBeCloseTo(exact[i]!, 12));
        expect(asked.map((s) => s.note)).toEqual(asked.map(() => undefined));
    });

    it("leaves the modifiers of a protected side as they are", () => {
        const start = boots(
            [HUNTER_BOOTS_PREFIX.id, SECOND_PREFIX!.id, PROTECT_SUFFIXES_CARRIER.id],
            [HUNTER_BOOTS_SUFFIX.id],
        );
        const { asked, chances } = after(
            start,
            [elevatedPrefix, has(HUNTER_BOOTS_SUFFIX.id), hasValue(SECOND_PREFIX!.id, ">=", 30)],
            withSecond,
        );
        // The suffix is out of the orb's reach: the two prefixes are all it
        // picks among, where three in reach would elevate the first a third
        // of the time.
        const exact = share(["prefix", "second"], (_gone, up) => up === "prefix");
        expect(exact).toBe(1 / 2);
        expect(chances[0]).toBeCloseTo(exact, 12);
        expect(chances[1]).toBe(1);
        expect(chances[2]).toBeCloseTo(
            share(["prefix", "second"], (_gone, up) => up === "second"),
            12,
        );
        expect(asked.map((s) => s.note)).toEqual(asked.map(() => undefined));
    });

    it("raises a modifier below the top a tier, not to its elevated modifier", () => {
        const start = (ilvl: number) =>
            boots([HUNTER_BOOTS_PREFIX.id], [HUNTER_BOOTS_SUFFIX.id], ilvl);
        const { chances } = after(
            start(100),
            [has(HUNTER_BOOTS_SUFFIX.id, 1), has(HUNTER_BOOTS_SUFFIX.id, 2), elevatedPrefix],
            tiered,
        );
        // The suffix, at the second tier, is raised to the first or removed.
        expect(chances[0]).toBeCloseTo(1 / 2, 12);
        expect(chances[1]).toBe(0);
        expect(chances[2]).toBeCloseTo(1 / 2, 12);
        // No source says whether the orb raises a modifier past the item's level.
        const low = after(start(30), [elevatedPrefix], tiered);
        expect(low.orb.note).toContain("a tier above the item's level is not known");
        expect(low.orb.note).toContain("every item the check allows");
    });

    it("rolls the values of an already elevated modifier again", () => {
        // The elevated modifier rolls 30 to 40 and is known to be 35 or more.
        // Half the time it is the one raised, and its value is rolled fresh:
        // 35 to 40 is six values of eleven. Kept as it was, it would hold
        // whenever it stays.
        const high = hasValue(THIRD!.id, ">=", 35);
        const c = craft(boots([HUNTER_BOOTS_PREFIX.id], [ELEVATED_THIRD!.id]), [
            iff(high, [op("dominance"), iff(high, [])]),
        ]);
        const result = check(c, { registry });
        expect(result.diagnostics).toEqual([]);
        const steps = costOf(c, result, registry).steps;
        const [, inner] = steps.filter((s) => s.kind === "if");
        expect(inner!.note).toBeUndefined();
        expect(inner!.branch).toBeCloseTo((1 / 2) * (6 / 11), 12);
    });

    it("keeps an elevated modifier of a type of its own in the slot of the one it was made of", () => {
        // No condition names the elevated prefix: it is counted on its side all
        // the same. Two prefixes are left when the suffix is the one removed.
        const start = boots([HUNTER_BOOTS_PREFIX.id, "IncreasedLife1"], [HUNTER_BOOTS_SUFFIX.id]);
        const { asked, chances } = after(start, [
            cmp("prefixCount", "==", 2),
            has(HUNTER_BOOTS_PREFIX.id),
            cmp("suffixCount", "==", 0),
        ]);
        expect(chances[0]).toBeCloseTo(1 / 2, 12);
        expect(chances[1]).toBe(0);
        expect(chances[2]).toBeCloseTo(1 / 2, 12);
        expect(asked.map((s) => s.note)).toEqual(asked.map(() => undefined));
    });

    describe("is not followed, and says why,", () => {
        /** The orb's note on an item it takes but the walk cannot read. */
        const noteOf = (c: ReturnType<typeof craft>, reg: typeof registry): string => {
            const result = check(c, { registry: reg });
            expect(result.diagnostics).toEqual([]);
            const orb = costOf(c, result, reg).steps.findLast((s) => s.kind === "operation")!;
            expect(orb.note).toContain("every item the check allows");
            return orb.note!;
        };

        it("where the item's influences differ by path", () => {
            // The item the check hands the walk is a Hunter's on one path and
            // a Hunter and Shaper's on another, as after a join.
            const shaper: Mod = {
                ...THIRD!,
                id: ModId("ShaperBoots1"),
                type: TypeId("ShaperBoots"),
                families: new Set([GroupId("ShaperBoots")]),
                spawn: [
                    { tag: TagId("boots_shaper"), weight: 500 },
                    { tag: TagId("default"), weight: 0 },
                ],
            };
            const dual = buildRegistry({ bases: [BOOTS_BASE], mods: [...mods, shaper] });
            const c = craft(boots([HUNTER_BOOTS_PREFIX.id], [HUNTER_BOOTS_SUFFIX.id]), [
                op("dominance"),
            ]);
            const settled = check(c, { registry: dual }).trace.at(-1)!.before;
            const { u } = settled;
            const m = u.dd;
            const slot = u.scalar("influences");
            const both = u.influenceValue(influenceKey(["shaper", "hunter"]))!;
            const before = {
                u,
                dd: m.or(settled.dd, m.and(m.forget(settled.dd, [slot]), m.slotIn(slot, [both]))),
            };
            const tracker = new Tracker(dual, before, [before], [], []);
            const built = findMethod(["dominance"])!.build([], methodItemOf(before), dual);
            if ("refused" in built) throw new Error(built.refused);
            const [start] = tracker.statesIn(before)!;
            tracker.transition(before, built, "estimate")!(start!.state);
            expect(tracker.unfollowed).toBe(
                "which influences the item has is not settled at this step",
            );
        });

        it("where two tiers above the modifier share a level", () => {
            const twin: Mod = { ...HIGHER, id: ModId("HunterBootsSuffix0b") };
            const tied = buildRegistry({ bases: [BOOTS_BASE], mods: [...mods, HIGHER, twin] });
            const c = craft(boots([HUNTER_BOOTS_PREFIX.id], [HUNTER_BOOTS_SUFFIX.id]), [
                op("dominance"),
            ]);
            expect(noteOf(c, tied)).toContain(
                "which tier an Orb of Dominance raises a modifier to is not settled where two tiers share a level",
            );
        });
    });

    it("gives no figure where the check cannot judge the craft", () => {
        // A top-tier influence row with no elevated row is a fault of the data
        // (exact/ops/remove.ts `elevations`): the check judges nothing, and
        // the walk has no item to cost the steps on.
        const none = buildRegistry({
            bases: [BOOTS_BASE],
            mods: mods.filter((m) => m !== ELEVATED_THIRD),
        });
        const c = craft(boots([HUNTER_BOOTS_PREFIX.id], [THIRD!.id]), [op("dominance")]);
        const result = check(c, { registry: none });
        expect(result.ok).toBe(false);
        expect(result.trace).toEqual([]);
        const r = costOf(c, result, none);
        expect(r.unjudged).toBe(true);
        expect(r.unknown).toBe(true);
        expect(r.steps).toEqual([]);
        expect(r.total).toEqual([]);
    });

    it("reads an item block holding an elevated modifier beside the one it was made of as the check goes on from it", () => {
        // The two are of one group: the check refuses the second and goes on
        // from the first, which the orb may elevate.
        const c = craft(
            boots([HUNTER_BOOTS_PREFIX.id, ELEVATED_BOOTS_PREFIX.id], [HUNTER_BOOTS_SUFFIX.id]),
            [op("dominance"), iff(elevatedPrefix, [])],
        );
        const result = check(c, { registry });
        expect(result.diagnostics.map((d) => d.message)).toEqual([
            expect.stringContaining("cannot both be on an item"),
        ]);
        const steps = costOf(c, result, registry).steps;
        expect(steps[0]!.note).not.toContain("every item the check allows");
        expect(steps[1]!.branch).toBeCloseTo(1 / 2, 12);
    });

    it("is not followed where a modifier the guide does not name may be influenced", () => {
        const start = boots([HUNTER_BOOTS_PREFIX.id, "random"], [HUNTER_BOOTS_SUFFIX.id]);
        const { orb } = after(start, [elevatedPrefix], withSecond);
        expect(orb.note).toContain("the item may hold some the guide does not name");
        expect(orb.note).toContain("every item the check allows");
        expect(orb.note).not.toContain("no source states its odds");
        // The same item where no other Hunter prefix exists is followed.
        const sure = after(start, [elevatedPrefix]);
        expect(sure.orb.note).not.toContain("every item the check allows");
        expect(sure.chances[0]).toBeCloseTo(1 / 2, 12);
    });
});
