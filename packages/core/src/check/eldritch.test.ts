import { describe, expect, it } from "vitest";
import { check, type CheckContext } from "./check.js";
import * as v from "./views.js";
import { guaranteedTypes } from "./views.js";
import { buildRegistry } from "../resolve/registry.js";
import {
    craft,
    dominantP,
    eldritchP,
    fossil,
    hasP,
    iff,
    item,
    notp,
    op,
    until,
} from "../__fixtures__/ast.js";
import type { OperationStmt } from "../ast/ast.js";
import { TypeId } from "../model/ids.js";
import {
    AMULET_BASE,
    ATTACK_PREFIX,
    ELDRITCH_ROWS,
    ELDRITCH_ROWS_EVERY_TIER,
    FOSSIL_BLOODSTAINED,
    BOOTS_BASE,
    CANNOT_ROLL_ATTACK_CARRIER,
    CATALOG,
    LIFE_T1,
    PROTECT_PREFIXES_CARRIER,
    PROTECT_SUFFIXES_CARRIER,
    RING_BASE,
} from "../__fixtures__/mods.js";
import { eldritchKey } from "../model/marks.js";

const registry = buildRegistry({
    bases: [RING_BASE, BOOTS_BASE, AMULET_BASE],
    mods: [
        ...CATALOG,
        ATTACK_PREFIX,
        CANNOT_ROLL_ATTACK_CARRIER,
        PROTECT_PREFIXES_CARRIER,
        PROTECT_SUFFIXES_CARRIER,
    ],
    modAliases: { life: "IncreasedLife1", cold: "ColdResist1", mana: "IncreasedMana1" },
    baseAliases: { "Iron Ring": "IronRing" },
    eldritch: ELDRITCH_ROWS,
    fossils: [FOSSIL_BLOODSTAINED],
});
const ctx: CheckContext = { registry };
/** Each implicit at every tier, as the game's data has them: an Orb of
 *  Conflict moves an implicit a tier and keeps its wording. */
const everyTier: CheckContext = {
    registry: buildRegistry({
        bases: [BOOTS_BASE],
        mods: CATALOG,
        eldritch: ELDRITCH_ROWS_EVERY_TIER,
    }),
};

const DS = { start: { offset: 0, line: 1, column: 1 }, end: { offset: 0, line: 1, column: 1 } };
const words = (...ws: string[]): OperationStmt => ({
    kind: "operation",
    words: ws,
    args: [],
    span: DS,
});
const wordArg = (ws: string[], w: string): OperationStmt => ({
    ...words(...ws),
    args: [{ kind: "word", value: w, span: DS }],
});
const run = (c: ReturnType<typeof craft>, on: CheckContext = ctx) => check(c, on);
const messages = (c: ReturnType<typeof craft>, on: CheckContext = ctx) =>
    run(c, on)
        .diagnostics.map((d) => d.message)
        .join("\n");

type Spec = Partial<Parameters<typeof item>[0]>;
const boots = (extra: Spec = {}) =>
    item({ base: "Iron Greaves", ilvl: 100, rarity: "rare", ...extra });

describe("embers and ichors", () => {
    it("set that implicit's tier on an armour piece, replacing its own", () => {
        const r = run(
            craft(boots({ exarch: "lesser" }), [
                wordArg(["ember"], "grand"),
                wordArg(["ichor"], "lesser"),
            ]),
        );
        expect(r.diagnostics).toEqual([]);
        expect(v.eldritchPairs(r.finalState!)).toEqual(new Set([eldritchKey(3, 1)]));
    });

    it("refuse a ring, and an influenced item", () => {
        const ring = item({ base: "Iron Ring", ilvl: 100, rarity: "rare" });
        expect(messages(craft(ring, [wordArg(["ember"], "lesser")]))).toContain(
            "Needs a body armour, boots, gloves or helmet",
        );
        expect(
            messages(craft(boots({ influences: ["hunter"] }), [wordArg(["ichor"], "lesser")])),
        ).toContain("An Eldritch Ichor cannot be used on an influenced item");
    });

    it("cannot be declared on a ring", () => {
        const ring = item({ base: "Iron Ring", ilvl: 100, rarity: "rare", exarch: "grand" });
        expect(messages(craft(ring, []))).toContain(
            "Only a body armour, boots, gloves, a helmet or an amulet can have an eldritch implicit",
        );
        expect(messages(craft(boots({ exarch: "grand" }), []))).toBe("");
    });

    it("are declared on an amulet one at a time, Lesser to Exceptional", () => {
        const amulet = (extra: Spec) =>
            item({ base: "CoralAmulet", ilvl: 100, rarity: "rare", ...extra });
        expect(messages(craft(amulet({ exarch: "exceptional" }), []))).toBe("");
        expect(messages(craft(amulet({ eater: "lesser" }), []))).toBe("");
        expect(messages(craft(amulet({ exarch: "grand", eater: "lesser" }), []))).toContain(
            "An amulet has one eldritch implicit",
        );
        expect(messages(craft(amulet({ eater: "exquisite" }), []))).toContain(
            "An amulet's eldritch implicit is Lesser to Exceptional, not Exquisite",
        );
        // With one implicit only, an Orb of Conflict has nothing to trade.
        expect(messages(craft(amulet({ exarch: "grand" }), [words("conflict")]))).toContain(
            "An Orb of Conflict needs both",
        );
    });

    it("cannot be declared beside an influence", () => {
        expect(messages(craft(boots({ exarch: "lesser", influences: ["hunter"] }), []))).toContain(
            "An influenced item cannot have an eldritch implicit",
        );
    });

    it("keep an influence orb off an item with an eldritch implicit", () => {
        expect(messages(craft(boots({ exarch: "lesser" }), [words("exalt", "hunter")]))).toContain(
            "cannot be used on an item with an eldritch implicit — this item has Lesser Exarch",
        );
    });
});

describe("the Eldritch orbs act on the dominant implicit's side", () => {
    it("chaos rerolls the prefixes under an Exarch dominance and keeps the suffixes", () => {
        const start = boots({
            exarch: "grand",
            eater: "lesser",
            prefixes: ["life"],
            suffixes: ["cold"],
        });
        const r = run(craft(start, [words("eldritch", "chaos")]));
        expect(r.diagnostics).toEqual([]);
        const s = r.finalState!;
        expect(guaranteedTypes(s).has(LIFE_T1.type)).toBe(false);
        // With the suffixes kept, the reforge rolls one prefix at least.
        expect(v.counts(s).prefix).toEqual([1, 3]);
        expect(guaranteedTypes(s).size).toBe(1); // the cold suffix stayed
        // The orb rolls no suffix, so the suffix count stands and the total
        // is that one suffix plus the new prefixes.
        expect(v.counts(s).suffix).toEqual([1, 1]);
        expect(v.counts(s).total).toEqual([2, 4]);
    });

    it("chaos leaves the other side's open slots open", () => {
        const start = boots({ exarch: "grand", prefixes: ["life", "random"], suffixes: ["cold"] });
        const r = run(craft(start, [words("eldritch", "chaos"), words("eldritch", "exalt")]));
        // Three prefixes may have rolled, so the Exarch's exalt is refused; the
        // two open suffix slots are still open.
        expect(r.diagnostics[0]?.message).toContain("Requires an open prefix slot");
        expect(v.counts(r.finalState!).suffix).toEqual([1, 1]);
    });

    it("chaos ignores the item's own protection of the rerolled side", () => {
        const guarded = boots({
            exarch: "grand",
            prefixes: ["life"],
            suffixes: [PROTECT_PREFIXES_CARRIER.id],
        });
        const r = run(craft(guarded, [words("eldritch", "chaos")]));
        expect(r.diagnostics).toEqual([]);
        expect(guaranteedTypes(r.finalState!).has(LIFE_T1.type)).toBe(false);
        expect(guaranteedTypes(r.finalState!).has(PROTECT_PREFIXES_CARRIER.type)).toBe(true);
    });

    it("annul takes what a cannot-roll metamod bars from rolling, and refuses a protected side", () => {
        // Version 3.30.0 (Item Changes) names the Orb of Annulment; the eldritch
        // orb is taken alike (QUESTIONS.md Q122).
        const barred = boots({
            exarch: "grand",
            prefixes: [ATTACK_PREFIX.id],
            suffixes: [CANNOT_ROLL_ATTACK_CARRIER.id],
        });
        const r = run(craft(barred, [words("eldritch", "annul")]));
        expect(r.diagnostics).toEqual([]);
        expect(v.counts(r.finalState!).prefix).toEqual([0, 0]);
        const guarded = boots({
            eater: "grand",
            prefixes: [PROTECT_SUFFIXES_CARRIER.id],
            suffixes: ["cold"],
        });
        expect(messages(craft(guarded, [words("eldritch", "annul")]))).toContain(
            "removes a suffix, but the suffixes cannot be changed here",
        );
    });

    it("exalt adds a suffix under an Eater dominance; annul removes one", () => {
        const start = boots({ eater: "greater", suffixes: ["cold"] });
        const r = run(craft(start, [words("eldritch", "exalt")]));
        expect(r.diagnostics).toEqual([]);
        expect(v.counts(r.finalState!).prefix).toEqual([0, 0]);
        expect(v.counts(r.finalState!).total).toEqual([2, 2]);
        const a = run(craft(start, [words("eldritch", "annul")]));
        expect(a.diagnostics).toEqual([]);
        expect(v.counts(a.finalState!).total).toEqual([0, 0]);
    });

    it("refuse an item with no dominance, and act on each item's own dominant side", () => {
        expect(
            messages(
                craft(boots({ exarch: "grand", eater: "grand" }), [words("eldritch", "exalt")]),
            ),
        ).toContain("needs an item where the Searing Exarch or the Eater of Worlds is dominant");
        expect(messages(craft(boots(), [words("eldritch", "chaos")]))).toContain("is dominant");
        const split = craft(boots({ exarch: "grand", eater: "greater" }), [
            words("conflict"),
            words("eldritch", "chaos"),
        ]);
        // The conflict leaves either implicit dominant; the orb rerolls that
        // side of each item, one modifier at least, and nothing of the other.
        const r = run(split, everyTier);
        expect(r.diagnostics).toEqual([]);
        expect(v.eldritchPairs(r.finalState!)).toEqual(
            new Set([eldritchKey(4, 1), eldritchKey(2, 3)]),
        );
        expect(v.counts(r.finalState!).total).toEqual([1, 3]);
    });
});

describe("which implicit an ember gave", () => {
    const speed = new Set([TypeId("ImplicitMoveSpeed"), TypeId("ImplicitMoveSpeedUniquePresence")]);

    it("is one of the tier's pool on the base, which a wording narrows", () => {
        const r = run(craft(boots(), [wordArg(["ember"], "grand")]));
        expect(r.diagnostics).toEqual([]);
        expect(v.eldritchTypes(r.finalState!, "exarch")).toEqual(
            new Set([...speed, TypeId("ImplicitLifeRegen")]),
        );
        const narrowed = run(
            craft(boots(), [
                wordArg(["ember"], "grand"),
                iff(eldritchP("exarch", undefined, "movement speed"), [], []),
            ]),
        );
        expect(narrowed.diagnostics).toEqual([]);
        const loop = craft(boots(), [
            until(eldritchP("exarch", undefined, "movement speed"), [wordArg(["ember"], "grand")]),
        ]);
        const l = run(loop);
        expect(l.diagnostics).toEqual([]);
        expect(v.eldritchTypes(l.finalState!, "exarch")).toEqual(speed);
    });

    it("cannot be a wording the tier's pool lacks, nor one no implicit has", () => {
        const never = craft(boots(), [
            until(eldritchP("exarch", undefined, "life per second"), [
                wordArg(["ember"], "greater"),
            ]),
        ]);
        expect(messages(never)).toMatch(/never/);
        expect(
            messages(craft(boots(), [iff(eldritchP("exarch", undefined, "spell damage"), [], [])])),
        ).toContain('No Searing Exarch implicit reads "spell damage"');
    });

    it("is excluded by a negated wording only when the implicit is surely present", () => {
        const sure = craft(boots({ exarch: "grand" }), [
            wordArg(["ember"], "grand"),
            iff(notp(eldritchP("exarch", undefined, "movement speed")), [], []),
        ]);
        expect(run(sure).diagnostics).toEqual([]);
        const declared = craft(boots({ exarch: { tier: "grand", text: "movement speed" } }), [
            iff(notp(eldritchP("exarch", undefined, "movement speed")), [], []),
        ]);
        expect(messages(declared)).toContain("'if' branch can never run");
        // Merely possible: the implicit may be absent, so nothing is excluded.
        const maybe = craft(boots(), [
            op("chaos"),
            iff(hasP("life"), [wordArg(["ember"], "grand")], []),
            iff(notp(eldritchP("exarch", undefined, "movement speed")), [], []),
        ]);
        // Both arms live: an item without the ember, or with the life implicit,
        // meets the negation.
        const r = run(maybe);
        expect(r.diagnostics).toEqual([]);
        expect(v.eldritchTypes(r.finalState!, "exarch")).toEqual(
            new Set([...speed, TypeId("ImplicitLifeRegen")]),
        );
    });

    it("is declared with the item, and survives an Orb of Conflict", () => {
        const declared = boots({
            exarch: { tier: "grand", text: "movement speed" },
            eater: "lesser",
        });
        const r = run(craft(declared, [words("conflict")]), everyTier);
        expect(r.diagnostics).toEqual([]);
        expect(v.eldritchTypes(r.finalState!, "exarch")).toEqual(speed);
        // The boots have one Eater implicit, so the declared Lesser is that one.
        expect(v.eldritchTypes(r.finalState!, "eater")).toEqual(
            new Set([TypeId("ImplicitChaosRes")]),
        );
    });

    it("is unknown again where a path with another meets", () => {
        const c = craft(boots({ exarch: { tier: "grand", text: "movement speed" } }), [
            op("chaos"),
            iff(hasP("life"), [wordArg(["ember"], "grand")], []),
        ]);
        const s = run(c).finalState!;
        expect(v.eldritchTypes(s, "exarch")).toEqual(
            new Set([...speed, TypeId("ImplicitLifeRegen")]),
        );
    });
});

describe("corruption may replace an eldritch implicit", () => {
    it("a Vaal Orb one of them, the Corruption Altar both", () => {
        const start = boots({ exarch: "grand", eater: "lesser" });
        const vaal = run(craft(start, [op("vaal")]));
        expect(v.eldritchPairs(vaal.finalState!)).toEqual(
            new Set([eldritchKey(3, 1), eldritchKey(0, 1), eldritchKey(3, 0)]),
        );
        expect(
            messages(craft(start, [op("vaal"), iff(eldritchP("exarch"), [], [])])),
        ).not.toContain("never run");
        // Up to two implicits go, and the base's own may be among them.
        const l = run(craft(start, [op("locus")]));
        expect(v.eldritchPairs(l.finalState!)).toEqual(
            new Set([eldritchKey(3, 1), eldritchKey(0, 1), eldritchKey(3, 0), eldritchKey(0, 0)]),
        );
    });

    it("a Bloodstained Fossil one of them, as a Vaal Orb's implicit does", () => {
        const r = run(craft(boots({ exarch: "grand", eater: "lesser" }), [fossil("bloodstained")]));
        expect(r.diagnostics).toEqual([]);
        expect(v.corruptions(r.finalState!)).toEqual(new Set([true]));
        expect(v.eldritchPairs(r.finalState!)).toEqual(
            new Set([eldritchKey(3, 1), eldritchKey(0, 1), eldritchKey(3, 0)]),
        );
    });
});

describe("an Eldritch Ember on a low item level", () => {
    it("needs item level 75", () => {
        const low = item({ base: "Iron Greaves", ilvl: 74, rarity: "rare" });
        expect(messages(craft(low, [wordArg(["ember"], "lesser")]))).toContain(
            "An Eldritch Ember needs item level 75 or more — this item is item level 74.",
        );
        const at = item({ base: "Iron Greaves", ilvl: 75, rarity: "rare" });
        expect(messages(craft(at, [wordArg(["ichor"], "lesser")]))).toBe("");
    });

    it("cannot be on an item block below it", () => {
        for (const side of [{ eater: "grand" }, { exarch: "lesser" }] as const) {
            const below = item({ base: "Iron Greaves", ilvl: 74, rarity: "rare", ...side });
            expect(messages(craft(below, []))).toBe(
                "An eldritch implicit needs item level 75 or more — this item is item level 74.",
            );
            const at = item({ base: "Iron Greaves", ilvl: 75, rarity: "rare", ...side });
            expect(messages(craft(at, []))).toBe("");
        }
    });
});

describe("the Orb of Conflict", () => {
    it("raises one implicit and lowers the other, removing a lowered Lesser", () => {
        const r = run(
            craft(boots({ exarch: "greater", eater: "lesser" }), [words("conflict")]),
            everyTier,
        );
        expect(r.diagnostics).toEqual([]);
        expect(v.eldritchPairs(r.finalState!)).toEqual(
            new Set([eldritchKey(3, 0), eldritchKey(1, 2)]),
        );
    });

    it("needs both implicits", () => {
        expect(messages(craft(boots({ exarch: "greater" }), [words("conflict")]))).toContain(
            "needs both a Searing Exarch and an Eater of Worlds implicit",
        );
    });

    it("leaves an item it refuses as it was", () => {
        // After one orb a Lesser pair keeps a single Greater implicit; a second
        // orb is refused there and changes neither side.
        const c = craft(boots({ exarch: "lesser", eater: "lesser" }), [
            words("conflict"),
            words("conflict"),
        ]);
        const r = run(c, everyTier);
        expect(r.diagnostics.map((d) => d.message)).toEqual([
            expect.stringContaining("this item has Greater Eater or Greater Exarch."),
        ]);
        expect(v.eldritchPairs(r.finalState!)).toEqual(
            new Set([eldritchKey(2, 0), eldritchKey(0, 2)]),
        );
    });

    it("leaves a dominance a branch can pick out", () => {
        const c = craft(boots({ exarch: "grand", eater: "grand" }), [
            words("conflict"),
            iff(dominantP("exarch"), [words("eldritch", "chaos")], [words("eldritch", "chaos")]),
        ]);
        expect(run(c, everyTier).diagnostics).toEqual([]);
        const tiered = craft(boots({ exarch: "grand", eater: "grand" }), [
            words("conflict"),
            iff(eldritchP("exarch", "exceptional"), [], [op("chaos")]),
        ]);
        expect(messages(tiered, everyTier)).not.toContain("never run");
        expect(
            messages(craft(boots({ exarch: "grand" }), [iff(eldritchP("eater"), [], [])])),
        ).toContain("'if' branch can never run");
    });
});
