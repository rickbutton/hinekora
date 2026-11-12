import { describe, expect, it } from "vitest";
import {
    blockArg,
    callStmt,
    cmp,
    craft,
    essence,
    has,
    hasP,
    iff,
    isRarity,
    item,
    notp,
    op,
    param,
    paramStep,
    procDef,
    restart,
    stop,
    until,
} from "../__fixtures__/ast.js";
import type { Craft, ProcDef, Stmt } from "../ast/ast.js";
import { check } from "../check/check.js";
import { renderState } from "../check/diagnostics.js";
import { TypeId } from "../model/ids.js";
import { checkExact, type ExactTuning } from "./check.js";
import { startOf } from "./initial.js";
import { generateCatalog } from "./reference/catalog.js";
import { compareCraft } from "./reference/craft.js";
import { handCtx, HAND_REGISTRY } from "./reference/hand.js";
import { isGuaranteed, rarities, summaryOf } from "./views.js";

type Spec = Parameters<typeof item>[0];

const ring = (over: Partial<Spec> = {}) =>
    item({ base: "IronRing", ilvl: 84, rarity: "rare", ...over });

const exact = (c: Craft, tuning?: ExactTuning) =>
    checkExact(c, { registry: HAND_REGISTRY }, tuning);

const said = (c: Craft, tuning?: ExactTuning): string[] =>
    exact(c, tuning).diagnostics.map((d) => d.message);

const presentSaid = (c: Craft): string[] =>
    check(c, { registry: HAND_REGISTRY }).diagnostics.map((d) => d.message);

/** The exact driver against the reference on the hand catalogue's ring. */
const agrees = (c: Craft, tuning?: ExactTuning): void => {
    expect(compareCraft(c, HAND_REGISTRY, handCtx(), tuning).diff).toBe("");
};

describe("the exact driver's words", () => {
    it("word an item's summary as the present checker does", () => {
        const block = ring({ prefixes: ["Life1", { mod: "random" }], suffixes: ["Fire1"] });
        const start = startOf(HAND_REGISTRY, craft(block, []), () => {})!;
        const present = check(craft(block, []), { registry: HAND_REGISTRY }).trace[0]!.before;
        expect(renderState(summaryOf(start.state!))).toBe(renderState(present));
    });

    it("refuse a step as the present checker does", () => {
        const crafts = [
            craft(ring({ rarity: "magic", prefixes: ["Life1"] }), [op("exalt")]),
            craft(ring({ rarity: "normal" }), [op("chaos")]),
            craft(ring({ prefixes: ["Life1"] }), [op("regal")]),
            craft(ring({ prefixes: ["Life1"] }), [op("zzz")]),
            craft(ring(), [{ ...op("beast"), words: ["beast", "zzz"] }]),
            craft(
                ring({
                    prefixes: ["Life1", "Mana1", "Armour1"],
                    suffixes: ["Fire1", "Cold1", "Lightning1"],
                }),
                [op("exalt")],
            ),
        ];
        for (const c of crafts) {
            expect(said(c)).toEqual(presentSaid(c));
            expect(said(c).length).toBe(1);
        }
    });

    it("say which metamod a step is refused under, where some items carry it", () => {
        const cat = generateCatalog(77, {
            types: 3,
            essenceOnly: true,
            metamods: ["prefixesCannotChange", "multimod"],
        });
        const prefix = cat.natural.find((m) => m.gen === "prefix")!;
        const c = craft(
            item({
                base: cat.base.id,
                ilvl: cat.ilvl,
                rarity: "rare",
                prefixes: [prefix.id],
                suffixes: [{ mod: "random", bench: true }],
            }),
            [essence("Deafening Essence of Testing"), op("chaos")],
        );
        const r = checkExact(c, { registry: cat.registry });
        expect(r.diagnostics.map((d) => d.message)).toEqual([
            `at this point the item is: IronRing · Rare · 2 affixes · 1 prefix · 1 suffix · ilvl ${cat.ilvl}\nThis currency can't be used while a metacraft modifier is on the item — remove it first.\nThis is so where the item has "prefixes cannot be changed", which it may have here — settle it with an 'if has' first.`,
        ]);
        // The craft goes on from the items the essence reforged.
        const after = r.trace[1]!.after!;
        expect(isGuaranteed(after, TypeId("TypeEssence"))).toBe(true);
        expect(compareCraft(c, cat.registry, cat.ctx).diff).toBe("");
    });

    it("name a parameter never given a value", () => {
        const proc = procDef("p", ["step"], [paramStep("other")]);
        const c = craft(ring(), [callStmt("p", [blockArg([op("chaos")])])], [], [proc]);
        expect(said(c)).toEqual(presentSaid(c));
    });
});

describe("the steps that never run", () => {
    it("after a stop", () => {
        const c = craft(ring({ prefixes: ["Life1"] }), [stop(), op("chaos")]);
        const r = exact(c);
        expect(r.diagnostics.map((d) => d.message)).toEqual([
            "this step can never run: the craft always stops before it",
        ]);
        expect(r.diagnostics[0]!.span).toBe(c.body[1]!.span);
        expect(r.trace.map((e) => e.kind)).toEqual(["item", "stop"]);
        expect(r.finalState).toBeUndefined();
    });

    it("after a restart, and after an arm that restarts and one that stops", () => {
        const loop = (body: Stmt[]) =>
            craft(ring({ prefixes: ["Life1"] }), [until(has("Mana1"), body)]);
        expect(said(loop([op("chaos"), restart(), op("exalt")]))).toContain(
            "this step can never run: the loop always restarts before it",
        );
        expect(
            said(loop([op("chaos"), iff(has("Life1"), [restart()], [stop()]), op("exalt")])),
        ).toContain("this step can never run: every path before it stops or restarts");
        // At top level a restart ends the craft.
        expect(said(craft(ring(), [restart(), op("chaos")]))).toEqual([
            "this step can never run: the craft always stops before it",
        ]);
    });
});

describe("the branches that never run", () => {
    it("are worded as the present checker words them", () => {
        const life = ring({ prefixes: ["Life1"] });
        const crafts = [
            craft(life, [iff(isRarity("magic"), [op("chaos")])]),
            craft(life, [iff(has("Life1"), [], [op("chaos")])]),
            craft(ring({ ilvl: 30, prefixes: ["Mana1"] }), [iff(has("maximum life", 1), [])]),
        ];
        for (const c of crafts) {
            expect(said(c)).toEqual(presentSaid(c));
            expect(said(c).length).toBe(1);
            agrees(c);
        }
        expect(said(crafts[2]!)[0]).toContain("needs item level 50; this item is level 30");
    });

    it("unite the arms that fall through", () => {
        const c = craft(ring({ prefixes: ["Life1"], suffixes: [{ mod: "random" }] }), [
            iff(has("Fire1"), [op("annul")], [stop()]),
        ]);
        const r = exact(c);
        expect(r.diagnostics).toEqual([]);
        agrees(c);
    });
});

describe("a loop", () => {
    it("whose body never runs, or that never exits", () => {
        const life = ring({ prefixes: ["Life1"] });
        const runs = craft(life, [until(has("Life1"), [op("chaos")])]);
        expect(said(runs)).toEqual([
            'this loop\'s body never runs: has "Life1" already holds here',
        ]);
        const exits = craft(life, [until(isRarity("normal"), [op("divine")]), op("annul")]);
        expect(said(exits)).toEqual([
            "this loop can never exit: isNormal can never become true here",
        ]);
        // The craft goes on from every item the loop works on.
        const r = exact(exits);
        expect(r.trace.find((e) => e.kind === "until")!.after).toBeDefined();
        agrees(runs);
        agrees(exits);
    });

    it("judges every round: an item the body fills on a later round refuses it", () => {
        const c = craft(ring({ prefixes: ["Life1"] }), [until(has("Fire1"), [op("exalt")])]);
        const r = exact(c);
        expect(r.diagnostics.map((d) => d.message)).toEqual(presentSaid(c));
        expect(r.diagnostics.length).toBe(1);
        expect(r.diagnostics[0]!.message).toContain("Requires an open affix slot");
        expect(isGuaranteed(r.finalState!, TypeId("TypeFire"))).toBe(true);
        agrees(c);
    });

    it("refuses a loop past the round limit and judges nothing after it", () => {
        const c = craft(ring({ prefixes: ["Life1"] }), [
            until(cmp("suffixCount", ">=", 3), [op("exalt")]),
            op("regal"),
        ]);
        const r = exact(c, { maxRounds: 1 });
        expect(r.diagnostics.map((d) => d.message)).toEqual([
            "The item this loop works on is still changing after 1 rounds, too many to follow.",
        ]);
        expect(r.diagnostics[0]!.span).toBe(c.body[0]!.span);
        expect(r.finalState).toBeUndefined();
        expect(r.findings.map((f) => f.kind)).toEqual(["unsettled"]);
        agrees(c, { maxRounds: 1 });
        // With the rounds it needs, the loop settles and the regal is refused.
        expect(said(c, { maxRounds: 8 }).length).toBe(1);
        expect(said(c, { maxRounds: 8 })[0]).toContain("Requires a Magic item");
        agrees(c, { maxRounds: 8 });
    });

    it("takes back the items a restart sends, in nested loops", () => {
        const inner = until(has("Fire1"), [
            op("alteration"),
            iff(notp(has("Life1")), [restart()]),
            op("augment"),
        ]);
        const c = craft(ring({ rarity: "magic", prefixes: ["Life1"] }), [
            until(isRarity("rare"), [inner, op("regal")]),
        ]);
        const r = exact(c);
        agrees(c);
        // Only a restart brings an item without the life back to the inner
        // loop's head, and some leave it so, with the fire.
        const left = r.trace.find((e) => e.span === inner.span)!.after!;
        expect(isGuaranteed(left, TypeId("TypeLife"))).toBe(false);
        expect(isGuaranteed(left, TypeId("TypeFire"))).toBe(true);
        expect(rarities(r.finalState!)).toEqual(new Set(["rare"]));
    });
});

describe("a call", () => {
    const withStep: ProcDef = procDef(
        "withStep",
        ["step"],
        [until(has("Mana1"), [paramStep("step")])],
    );
    const withMod: ProcDef = procDef("withMod", ["m"], [iff(hasP(param("m")), [op("annul")])]);

    it("is one traced step with its body's trace", () => {
        const c = craft(
            ring({ prefixes: ["Life1"] }),
            [callStmt("withMod", ["Life1"])],
            [],
            [withMod],
        );
        const r = exact(c);
        expect(r.diagnostics).toEqual([]);
        const call = r.trace[1]!;
        expect(call.kind).toBe("call");
        // The body's statements, those inside its branches first.
        expect(call.inlined!.trace.map((e) => e.kind)).toEqual(["operation", "if"]);
        expect(call.inlined!.trace[1]!.stmt).toBe(call.inlined!.body[0]);
        agrees(c);
    });

    it("runs a step argument where it stands: a restart in it re-enters the proc's loop", () => {
        const c = craft(
            ring({ prefixes: ["Life1"], suffixes: ["Fire1"] }),
            [
                callStmt("withStep", [
                    blockArg([op("annul"), iff(notp(has("Fire1")), [restart()]), op("exalt")]),
                ]),
                op("divine"),
            ],
            [],
            [withStep],
        );
        const r = exact(c);
        agrees(c);
        expect(isGuaranteed(r.finalState!, TypeId("TypeMana"))).toBe(true);
        expect(r.trace[1]!.inlined!.trace.at(-1)!.kind).toBe("until");
    });
});

describe("the engine's limit", () => {
    it("is one error at the statement that passed it, and the check stops there", () => {
        const c = craft(ring({ prefixes: ["Life1"] }), [
            op("chaos"),
            op("annul"),
            op("exalt"),
            op("regal"),
        ]);
        const start = startOf(HAND_REGISTRY, c, () => {})!;
        const made = start.u.dd.nodeCount;
        // The smallest budget past the item block's own diagrams.
        let r = exact(c, { maxNodes: made });
        for (let more = 1; r.findings[0]?.span === c.item.span; more *= 2) {
            r = exact(c, { maxNodes: made + more });
        }
        expect(r.diagnostics.map((d) => d.message)).toEqual([
            "The item can turn out too many different ways here to follow each, so the steps from here on are not checked.",
        ]);
        expect(c.body.map((s) => s.span)).toContain(r.diagnostics[0]!.span);
        expect(r.finalState).toBeUndefined();
        expect(r.findings.map((f) => f.kind)).toEqual(["limit"]);
    });
});
