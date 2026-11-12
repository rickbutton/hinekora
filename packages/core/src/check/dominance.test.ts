import { describe, expect, it } from "vitest";
import { type CheckContext } from "./check.js";
import { check } from "../exact/check.js";
import * as v from "../exact/views.js";
import { disjunctiveGuarantees, guaranteedTypes, isExcluded } from "../exact/views.js";
import { rowIds } from "../__fixtures__/views.js";
import { buildRegistry } from "../resolve/registry.js";
import { craft, has, iff, item, op } from "../__fixtures__/ast.js";
import {
    BOOTS_BASE,
    CATALOG,
    ELEVATED_BOOTS_PREFIX,
    ELEVATED_BOOTS_SUFFIX,
    HUNTER_BOOTS_PREFIX,
    HUNTER_BOOTS_SUFFIX,
    LIFE_T1,
    PROTECT_SUFFIXES_CARRIER,
    RING_BASE,
} from "../__fixtures__/mods.js";
import { GroupId, ModId, TagId, TypeId } from "../model/ids.js";
import type { Mod } from "../model/mod.js";

const registry = buildRegistry({
    bases: [RING_BASE, BOOTS_BASE],
    mods: [
        ...CATALOG,
        HUNTER_BOOTS_PREFIX,
        HUNTER_BOOTS_SUFFIX,
        ELEVATED_BOOTS_PREFIX,
        ELEVATED_BOOTS_SUFFIX,
        PROTECT_SUFFIXES_CARRIER,
    ],
    modAliases: { life: "IncreasedLife1" },
    baseAliases: { "Iron Ring": "IronRing" },
});
const ctx: CheckContext = { registry };

/** A third Hunter modifier for boots with its elevated row, as the data has
 *  one for every influence row of the armour the orb takes; and a tier above
 *  the suffix's. */
const THIRD: Mod = {
    ...HUNTER_BOOTS_SUFFIX,
    id: ModId("HunterBootsOther1"),
    type: TypeId("HunterBootsOther"),
    families: new Set([GroupId("HunterBootsOther")]),
    text: "Hunter boots other",
};
const THIRD_ELEVATED: Mod = {
    ...ELEVATED_BOOTS_SUFFIX,
    id: ModId("HunterBootsOtherUberMaven"),
    type: THIRD.type,
    families: THIRD.families,
    text: "Elevated hunter boots other",
};
const HIGHER: Mod = { ...HUNTER_BOOTS_SUFFIX, id: ModId("HunterBootsSuffix0"), minLevel: 50 };
const three = buildRegistry({
    bases: [BOOTS_BASE],
    mods: [...registry.catalog, THIRD, THIRD_ELEVATED],
});
const tiered = buildRegistry({ bases: [BOOTS_BASE], mods: [...registry.catalog, HIGHER] });

const run = (c: ReturnType<typeof craft>) => check(c, ctx);
const messages = (c: ReturnType<typeof craft>) =>
    run(c)
        .diagnostics.map((d) => d.message)
        .join("\n");

const boots = (prefixes: string[], suffixes: string[] = []) =>
    item({
        base: "Iron Greaves",
        ilvl: 100,
        rarity: "rare",
        prefixes,
        suffixes,
        influences: ["hunter"],
    });

describe("the Orb of Dominance", () => {
    it("removes one of three influenced modifiers and may raise any other; the rest stay", () => {
        const r = check(
            craft(boots([HUNTER_BOOTS_PREFIX.id, LIFE_T1.id], [HUNTER_BOOTS_SUFFIX.id, THIRD.id]), [
                op("dominance"),
            ]),
            { registry: three },
        );
        expect(r.diagnostics).toEqual([]);
        const s = r.finalState!;
        expect(v.counts(s).total).toEqual([3, 3]);
        expect(guaranteedTypes(s).has(LIFE_T1.type)).toBe(true);
        expect(guaranteedTypes(s).has(HUNTER_BOOTS_PREFIX.type)).toBe(false);
        expect(v.possibleTypes(s).has(ELEVATED_BOOTS_PREFIX.type)).toBe(true);
        expect(rowIds(s, ELEVATED_BOOTS_PREFIX.type)).toEqual(new Set([ELEVATED_BOOTS_PREFIX.id]));
        // Either of the two left may have been raised: the suffix may be at
        // either of its rows; the prefix, where it is not raised, is at its own.
        expect(rowIds(s, HUNTER_BOOTS_PREFIX.type)).toEqual(new Set([HUNTER_BOOTS_PREFIX.id]));
        expect(rowIds(s, HUNTER_BOOTS_SUFFIX.type)).toEqual(
            new Set([HUNTER_BOOTS_SUFFIX.id, ELEVATED_BOOTS_SUFFIX.id]),
        );
        // Two of the three are left, the prefix at its own row or raised.
        expect(v.cardinalityGuarantees(s)).toContainEqual({
            atLeast: 2,
            types: [
                THIRD.type,
                HUNTER_BOOTS_PREFIX.type,
                ELEVATED_BOOTS_PREFIX.type,
                HUNTER_BOOTS_SUFFIX.type,
            ].sort(),
        });
    });

    it("leaves, of two influenced modifiers, the raised one: elevated from the top tier", () => {
        const start = boots([HUNTER_BOOTS_PREFIX.id, "life"], [HUNTER_BOOTS_SUFFIX.id]);
        const r = run(craft(start, [op("dominance")]));
        expect(r.diagnostics).toEqual([]);
        const s = r.finalState!;
        expect(v.counts(s).total).toEqual([2, 2]);
        expect(guaranteedTypes(s).has(LIFE_T1.type)).toBe(true);
        // The prefix's elevated row is a type of its own; the suffix's shares its type.
        expect(isExcluded(s, HUNTER_BOOTS_PREFIX.type)).toBe(true);
        expect(rowIds(s, ELEVATED_BOOTS_PREFIX.type)).toEqual(new Set([ELEVATED_BOOTS_PREFIX.id]));
        expect(rowIds(s, HUNTER_BOOTS_SUFFIX.type)).toEqual(new Set([ELEVATED_BOOTS_SUFFIX.id]));
        expect(disjunctiveGuarantees(s).map((c) => new Set(c))).toEqual([
            new Set([ELEVATED_BOOTS_PREFIX.type, HUNTER_BOOTS_SUFFIX.type]),
        ]);
        // Exactly one is left, and a guide can name the elevated prefix.
        const both = craft(start, [
            op("dominance"),
            iff(has("Elevated hunter boots prefix"), [iff(has(HUNTER_BOOTS_SUFFIX.id), [])]),
        ]);
        expect(messages(both)).toContain("'if' branch can never run");
    });

    it("raises a modifier below the top a tier, whatever the item's level", () => {
        const start = (ilvl: number) =>
            item({
                base: "Iron Greaves",
                ilvl,
                rarity: "rare",
                prefixes: [HUNTER_BOOTS_PREFIX.id],
                suffixes: [HUNTER_BOOTS_SUFFIX.id],
                influences: ["hunter"],
            });
        const r = check(craft(start(100), [op("dominance")]), { registry: tiered });
        expect(r.diagnostics).toEqual([]);
        expect(rowIds(r.finalState!, HUNTER_BOOTS_SUFFIX.type)).toEqual(new Set([HIGHER.id]));
        // Below that level the orb raises it all the same, as an elevation
        // ignores the level (exact/ops/remove.ts `elevations`); the prefix,
        // raised from its top, is the elevated row's type or gone.
        const low = check(craft(start(30), [op("dominance")]), { registry: tiered });
        expect(low.diagnostics).toEqual([]);
        expect(rowIds(low.finalState!, HUNTER_BOOTS_SUFFIX.type)).toEqual(new Set([HIGHER.id]));
        expect(v.possibleTypes(low.finalState!).has(HUNTER_BOOTS_PREFIX.type)).toBe(false);
        expect(v.possibleTypes(low.finalState!).has(ELEVATED_BOOTS_PREFIX.type)).toBe(true);
    });

    it("raises a modifier within its own influence's rows on an item with two influences", () => {
        // The Elder's row of the suffix's type sits at a higher level; the
        // Hunter suffix is at the top of the Hunter's rows, so it is elevated,
        // not turned into the Elder's.
        const elder: Mod = {
            ...HUNTER_BOOTS_SUFFIX,
            id: ModId("ElderBootsSuffix1"),
            minLevel: 60,
            spawn: [
                { tag: TagId("boots_elder"), weight: 500 },
                { tag: TagId("default"), weight: 0 },
            ],
        };
        const dual = buildRegistry({ bases: [BOOTS_BASE], mods: [...registry.catalog, elder] });
        const start = item({
            base: "Iron Greaves",
            ilvl: 100,
            rarity: "rare",
            prefixes: [HUNTER_BOOTS_PREFIX.id],
            suffixes: [HUNTER_BOOTS_SUFFIX.id],
            influences: ["elder", "hunter"],
        });
        const r = check(craft(start, [op("dominance")]), { registry: dual });
        expect(r.diagnostics).toEqual([]);
        expect(rowIds(r.finalState!, HUNTER_BOOTS_SUFFIX.type)).toEqual(
            new Set([ELEVATED_BOOTS_SUFFIX.id]),
        );
    });

    it("leaves an influenced modifier on a protected side alone, and takes a Magic item", () => {
        const guarded = item({
            base: "Iron Greaves",
            ilvl: 100,
            rarity: "rare",
            prefixes: [HUNTER_BOOTS_PREFIX.id, "life", PROTECT_SUFFIXES_CARRIER.id],
            suffixes: [HUNTER_BOOTS_SUFFIX.id],
            influences: ["hunter"],
        });
        // Only the prefix is unprotected: too few to use the orb.
        expect(messages(craft(guarded, [op("dominance")]))).toContain("only one is guaranteed");
        const magic = item({
            base: "Iron Greaves",
            ilvl: 100,
            rarity: "magic",
            prefixes: [HUNTER_BOOTS_PREFIX.id],
            suffixes: [HUNTER_BOOTS_SUFFIX.id],
            influences: ["hunter"],
        });
        const r = run(craft(magic, [op("dominance")]));
        expect(r.diagnostics).toEqual([]);
        expect(v.counts(r.finalState!).total).toEqual([1, 1]);
    });

    it("needs two influenced modifiers on sides a metamod does not protect", () => {
        expect(
            messages(craft(boots([HUNTER_BOOTS_PREFIX.id, "life"]), [op("dominance")])),
        ).toContain(
            "needs 2 influenced modifiers on sides a metamod does not protect — only one is guaranteed",
        );
        const guarded = boots(
            [HUNTER_BOOTS_PREFIX.id, PROTECT_SUFFIXES_CARRIER.id],
            [HUNTER_BOOTS_SUFFIX.id],
        );
        expect(messages(craft(guarded, [op("dominance")]))).toContain("only one is guaranteed");
    });

    it("counts an elevated modifier among the two, and may remove it", () => {
        const r = run(
            craft(boots([ELEVATED_BOOTS_PREFIX.id], [HUNTER_BOOTS_SUFFIX.id]), [op("dominance")]),
        );
        expect(r.diagnostics).toEqual([]);
        expect(guaranteedTypes(r.finalState!).has(ELEVATED_BOOTS_PREFIX.type)).toBe(false);
        expect(v.counts(r.finalState!).total).toEqual([1, 1]);
    });

    it("takes the four armour classes only", () => {
        const ring = item({ base: "Iron Ring", ilvl: 100, rarity: "rare", influences: ["hunter"] });
        expect(messages(craft(ring, [op("dominance")]))).toContain(
            "Needs a body armour, boots, gloves or helmet",
        );
    });
});
