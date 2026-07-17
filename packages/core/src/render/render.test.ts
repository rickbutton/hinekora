import { describe, expect, it } from "vitest";
import {
    renderItem,
    renderItemSummary,
    renderOpError,
    renderOutcome,
    renderWfViolation,
} from "./render.js";
import { annul, exalt } from "../currency/base.js";
import type { OpContext } from "../currency/result.js";
import { addOne, removeOne } from "../outcome/outcome.js";
import { wfViolations } from "../model/wf.js";
import { known } from "../model/weight.js";
import type { PoolCandidate } from "../pool/pool.js";
import {
    CATALOG,
    COLD_RESIST,
    FIRE_RESIST,
    INCREASED_ARMOUR,
    INCREASED_MANA,
    LIFE_T1,
    LIGHTNING_RESIST,
    mkItem,
} from "../__fixtures__/mods.js";

const ctx: OpContext = { catalog: CATALOG };
const cand = (m: PoolCandidate["mod"]): PoolCandidate => ({ mod: m, weight: known(100) });

describe("renderItemSummary — the one-line state (surface §6)", () => {
    it("pluralizes counts and shows base · rarity · counts · ilvl", () => {
        const it = mkItem({
            rarity: "rare",
            ilvl: 82,
            prefixes: [LIFE_T1, INCREASED_MANA],
            suffixes: [FIRE_RESIST],
        });
        expect(renderItemSummary(it)).toBe("IronRing · Rare · 2 prefixes · 1 suffix · ilvl 82");
    });

    it("uses singular for exactly one and 0-plural for empty", () => {
        const one = mkItem({ rarity: "magic", ilvl: 82, prefixes: [LIFE_T1] });
        expect(renderItemSummary(one)).toBe("IronRing · Magic · 1 prefix · 0 suffixes · ilvl 82");
    });
});

describe("renderItem — the multi-line view", () => {
    it("lists prefixes and suffixes, or (none)", () => {
        const it = mkItem({ rarity: "rare", ilvl: 82, prefixes: [LIFE_T1] });
        const text = renderItem(it);
        expect(text).toContain("  prefixes: IncreasedLife1");
        expect(text).toContain("  suffixes: (none)");
    });
});

describe("renderOutcome — unions summarized without enumeration", () => {
    it("renders an addOne with count ranges, arm count, kept mods, and choices", () => {
        const base = mkItem({ rarity: "rare", ilvl: 82, prefixes: [LIFE_T1] });
        const o = addOne(base, [cand(INCREASED_MANA), cand(FIRE_RESIST)]);
        const text = renderOutcome(o);
        expect(text).toContain("one of 2 outcomes");
        expect(text).toContain("1–2 prefixes");
        expect(text).toContain("0–1 suffixes");
        expect(text).toContain("keeps: IncreasedLife1");
        expect(text).toContain("adds one of: IncreasedMana1, FireResist1");
    });

    it("renders a removeOne with the guaranteed floor and removal choices", () => {
        const base = mkItem({ rarity: "rare", prefixes: [LIFE_T1], suffixes: [FIRE_RESIST] });
        const o = removeOne(base, [LIFE_T1, FIRE_RESIST]);
        const text = renderOutcome(o);
        expect(text).toContain("one of 2 outcomes");
        expect(text).toContain("guaranteed to remain: (nothing)");
        expect(text).toContain("removes one of: IncreasedLife1, FireResist1");
    });

    it("renders a certain outcome as a plain item view", () => {
        const base = mkItem({ rarity: "rare", prefixes: [LIFE_T1] });
        // annul with a single removable is still a one-arm removeOne, but a
        // certain() would be a deterministic op; here we exercise the item path.
        expect(renderOutcome({ kind: "certain", item: base })).toBe(renderItem(base));
    });
});

describe("renderOpError — state + what was needed (surface §6), driven through real ops", () => {
    it("wrong rarity: shows the item state and the needed rarity", () => {
        const magic = mkItem({ rarity: "magic", ilvl: 82, prefixes: [LIFE_T1] });
        const r = exalt(ctx, magic);
        expect(r.ok).toBe(false);
        if (r.ok) throw new Error("unreachable");
        const text = renderOpError(magic, r.error);
        expect(text).toContain("at this point the item is: IronRing · Magic · 1 prefix");
        expect(text).toContain("Requires a Rare item — this item is Magic.");
    });

    it("no open slot: reports the full item", () => {
        const full = mkItem({
            rarity: "rare",
            prefixes: [LIFE_T1, INCREASED_MANA, INCREASED_ARMOUR],
            suffixes: [FIRE_RESIST, COLD_RESIST, LIGHTNING_RESIST],
        });
        const r = exalt(ctx, full);
        if (r.ok) throw new Error("expected failure");
        expect(renderOpError(full, r.error)).toContain("Requires an open affix slot");
    });

    it("nothing to remove: reports it", () => {
        const empty = mkItem({ rarity: "rare" });
        const r = annul(ctx, empty);
        if (r.ok) throw new Error("expected failure");
        expect(renderOpError(empty, r.error)).toContain("Requires a removable affix");
    });

    it("not well-formed: lists the violations", () => {
        const illFormed = mkItem({
            rarity: "rare",
            prefixes: [LIFE_T1, { ...LIFE_T1 }],
        });
        const r = exalt(ctx, illFormed);
        if (r.ok) throw new Error("expected failure");
        const text = renderOpError(illFormed, r.error);
        expect(text).toContain("Item is not well-formed:");
        expect(text).toContain("duplicate mod type:");
    });
});

describe("renderWfViolation — individual violation lines", () => {
    it("renders an over-cap prefix count", () => {
        const over = mkItem({
            rarity: "rare",
            prefixes: [LIFE_T1, INCREASED_MANA, INCREASED_ARMOUR, { ...LIFE_T1, id: LIFE_T1.id }],
        });
        const lines = wfViolations(over).map(renderWfViolation);
        expect(lines.some((l) => l.startsWith("too many prefixes:"))).toBe(true);
    });
});
