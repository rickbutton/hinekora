import { describe, expect, it } from "vitest";
import { check, type CheckContext } from "./check.js";
import { guaranteedTypes } from "./astate.js";
import { buildRegistry } from "../resolve/registry.js";
import { craft, dominantP, eldritchP, iff, item, op } from "../__fixtures__/ast.js";
import type { OperationStmt } from "../ast/ast.js";
import {
    ATTACK_PREFIX,
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
    bases: [RING_BASE, BOOTS_BASE],
    mods: [
        ...CATALOG,
        ATTACK_PREFIX,
        CANNOT_ROLL_ATTACK_CARRIER,
        PROTECT_PREFIXES_CARRIER,
        PROTECT_SUFFIXES_CARRIER,
    ],
    modAliases: { life: "IncreasedLife1", cold: "ColdResist1", mana: "IncreasedMana1" },
    baseAliases: { "Iron Ring": "IronRing" },
});
const ctx: CheckContext = { registry };

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
const run = (c: ReturnType<typeof craft>) => check(c, ctx);
const messages = (c: ReturnType<typeof craft>) =>
    run(c)
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
        expect(r.finalState!.eldritch).toEqual(new Set([eldritchKey(3, 1)]));
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
        expect(s.counts.prefix).toEqual([0, 3]);
        expect(guaranteedTypes(s).size).toBe(1); // the cold suffix stayed
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

    it("annul spares what a cannot-roll metamod shields, and refuses a protected side", () => {
        const shielded = boots({
            exarch: "grand",
            prefixes: [ATTACK_PREFIX.id],
            suffixes: [CANNOT_ROLL_ATTACK_CARRIER.id],
        });
        expect(messages(craft(shielded, [words("eldritch", "annul")]))).toContain(
            "Requires a removable affix",
        );
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
        expect(r.finalState!.counts.prefix).toEqual([0, 0]);
        expect(r.finalState!.counts.total).toEqual([2, 2]);
        const a = run(craft(start, [words("eldritch", "annul")]));
        expect(a.diagnostics).toEqual([]);
        expect(a.finalState!.counts.total).toEqual([0, 0]);
    });

    it("refuse an item with no dominance, and one whose dominance differs between paths", () => {
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
        expect(messages(split)).toContain("differs between paths");
    });
});

describe("corruption may replace an eldritch implicit", () => {
    it("a Vaal Orb one of them, the Corruption Altar both", () => {
        const start = boots({ exarch: "grand", eater: "lesser" });
        const v = run(craft(start, [op("vaal")]));
        expect(v.finalState!.eldritch).toEqual(
            new Set([eldritchKey(3, 1), eldritchKey(0, 1), eldritchKey(3, 0)]),
        );
        expect(
            messages(craft(start, [op("vaal"), iff(eldritchP("exarch"), [], [])])),
        ).not.toContain("never run");
        const l = run(craft(start, [op("locus")]));
        expect(l.finalState!.eldritch).toEqual(new Set([eldritchKey(3, 1), eldritchKey(0, 0)]));
    });
});

describe("the Orb of Conflict", () => {
    it("raises one implicit and lowers the other, removing a lowered Lesser", () => {
        const r = run(craft(boots({ exarch: "greater", eater: "lesser" }), [words("conflict")]));
        expect(r.diagnostics).toEqual([]);
        expect(r.finalState!.eldritch).toEqual(new Set([eldritchKey(3, 0), eldritchKey(1, 2)]));
    });

    it("needs both implicits", () => {
        expect(messages(craft(boots({ exarch: "greater" }), [words("conflict")]))).toContain(
            "needs both a Searing Exarch and an Eater of Worlds implicit",
        );
    });

    it("leaves a dominance a branch can pick out", () => {
        const c = craft(boots({ exarch: "grand", eater: "grand" }), [
            words("conflict"),
            iff(dominantP("exarch"), [words("eldritch", "chaos")], [words("eldritch", "chaos")]),
        ]);
        expect(run(c).diagnostics).toEqual([]);
        const tiered = craft(boots({ exarch: "grand", eater: "grand" }), [
            words("conflict"),
            iff(eldritchP("exarch", "exceptional"), [], [op("chaos")]),
        ]);
        expect(messages(tiered)).not.toContain("never run");
        expect(
            messages(craft(boots({ exarch: "grand" }), [iff(eldritchP("eater"), [], [])])),
        ).toContain("'if' branch can never run");
    });
});
