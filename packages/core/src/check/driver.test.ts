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
    influencedP,
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
import { renderState } from "./diagnostics.js";
import { TagId, TypeId } from "../model/ids.js";
import { check, checkDetail, type CheckTuning, UNJUDGED } from "./check.js";
import { buildRegistry, type Registry } from "../resolve/registry.js";
import { RING_BASE, TIERED_CATALOG } from "../__fixtures__/mods.js";
import { startOf } from "./initial.js";
import { generateCatalog, modRow } from "./reference/catalog.js";
import { compareCraft } from "./reference/craft.js";
import { handCtx, HAND_MODS, HAND_REGISTRY } from "./reference/hand.js";
import { refCtx } from "./reference/item.js";
import { isGuaranteed, rarities, summaryOf } from "./views.js";

type Spec = Parameters<typeof item>[0];

const ring = (over: Partial<Spec> = {}) =>
    item({ base: "IronRing", ilvl: 84, rarity: "rare", ...over });

const exact = (c: Craft, tuning?: CheckTuning) => check(c, { registry: HAND_REGISTRY }, tuning);

const said = (c: Craft, tuning?: CheckTuning): string[] =>
    exact(c, tuning).diagnostics.map((d) => d.message);

/** The exact driver against the reference on the hand catalogue's ring. */
const agrees = (c: Craft, tuning?: CheckTuning): void => {
    expect(compareCraft(c, HAND_REGISTRY, handCtx(), tuning).diff).toBe("");
};

describe("the exact driver's words", () => {
    it("word an item's summary", () => {
        const block = ring({ prefixes: ["Life1", { mod: "random" }], suffixes: ["Fire1"] });
        const start = startOf(HAND_REGISTRY, craft(block, []), () => {})!;
        expect(renderState(summaryOf(start.state!))).toBe(
            "IronRing · Rare · 3 affixes · 2 prefixes · 1 suffix · ilvl 84",
        );
    });

    it("refuse a step", () => {
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
        expect(crafts.map((c) => said(c))).toEqual([
            [
                "at this point the item is: IronRing · Magic · 1 affix · 1 prefix · 0 suffixes · ilvl 84\nRequires a Rare item — this item is Magic.",
            ],
            [
                "at this point the item is: IronRing · Normal · 0 affixes · 0 prefixes · 0 suffixes · ilvl 84\nRequires a Rare item — this item is Normal.",
            ],
            [
                "at this point the item is: IronRing · Rare · 1 affix · 1 prefix · 0 suffixes · ilvl 84\nRequires a Magic item — this item is Rare.",
            ],
            ['Unknown currency "zzz".'],
            ['Unknown operation "beast zzz".'],
            [
                "at this point the item is: IronRing · Rare · 6 affixes · 3 prefixes · 3 suffixes · ilvl 84\nRequires an open affix slot — the item may be full.",
            ],
        ]);
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
        const r = check(c, { registry: cat.registry });
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
        expect(said(c)).toEqual([
            'parameter "other" was never given a value',
            'parameter "step" of "p" is never used',
        ]);
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
        ).toContain(
            "this step can never run: the craft always stops or the loop restarts before it",
        );
        // At top level a restart ends the craft.
        expect(said(craft(ring(), [restart(), op("chaos")]))).toEqual([
            "this step can never run: the craft always stops before it",
        ]);
    });
});

describe("the branches that never run", () => {
    it("are worded so", () => {
        const life = ring({ prefixes: ["Life1"] });
        const crafts = [
            craft(life, [iff(isRarity("magic"), [op("chaos")])]),
            craft(life, [iff(has("Life1"), [], [op("chaos")])]),
            craft(ring({ ilvl: 30, prefixes: ["Mana1"] }), [iff(has("maximum life", 1), [])]),
        ];
        expect(crafts.map((c) => said(c))).toEqual([
            ["the 'if' branch can never run: isMagic is impossible here"],
            [`the 'else' branch can never run: has "Life1" always holds here`],
            [
                `the 'if' branch can never run: has "maximum life" t1 is impossible here — Tier 1 "maximum life" needs item level 50; this item is level 30`,
            ],
        ]);
        for (const c of crafts) agrees(c);
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

    it("and an if whose condition names nothing report that alone, and narrow nothing", () => {
        const life = ring({ prefixes: ["Life1"] });
        const crafts = [
            craft(life, [until(has("no such modifier"), [op("divine")]), op("annul")]),
            craft(life, [iff(has("no such modifier"), [op("annul")], [op("divine")])]),
        ];
        for (const c of crafts) {
            expect(said(c)).toEqual(['Unknown mod "no such modifier".']);
            agrees(c);
        }
    });

    it("judges every round: an item the body fills on a later round refuses it", () => {
        const c = craft(ring({ prefixes: ["Life1"] }), [until(has("Fire1"), [op("exalt")])]);
        const r = exact(c);
        expect(r.diagnostics.map((d) => d.message)).toEqual([
            "at this point the item is: IronRing · Rare · 1–6 affixes · 1–3 prefixes · 0–3 suffixes · ilvl 84\nRequires an open affix slot — the item may be full.",
        ]);
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
            "The item this loop works on is still changing after 1 round, too many to follow, so the steps from here on are not checked.",
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

describe("the item an error shows", () => {
    it("is one that breaks the step, where only some of the items do", () => {
        // Scoured where it has the life, so a Chaos Orb meets a Normal item there.
        const c = craft(ring({ prefixes: ["random"], suffixes: ["Fire1"] }), [
            iff(has("Life1"), [op("scour")]),
            op("chaos"),
        ]);
        const [d] = exact(c).diagnostics;
        expect(d!.example?.rarities).toEqual(["normal"]);
        expect(d!.example?.prefixes).toEqual([]);
        expect(d!.example?.suffixes).toEqual([]);
    });

    it("is left out where the step is used on one item, which the message describes", () => {
        const [d] = exact(craft(ring({ rarity: "magic" }), [op("chaos")])).diagnostics;
        expect(d!.message).toContain("Rare");
        expect(d!.example).toBeUndefined();
    });

    it("is left out where every item the step is used on breaks it", () => {
        // Many Magic rings, none of which a Chaos Orb takes.
        const c = craft(ring({ rarity: "magic", prefixes: ["random"] }), [op("chaos")]);
        const [d] = exact(c).diagnostics;
        expect(d!.message).toContain("Requires a Rare item");
        expect(d!.example).toBeUndefined();
    });

    it("is left out where the items reach the step only past an earlier error", () => {
        const after = (first: Stmt[]) =>
            exact(
                craft(ring({ prefixes: ["random"], suffixes: ["Fire1"] }), [
                    ...first,
                    iff(has("Life1"), [op("scour")]),
                    op("chaos"),
                ]),
            ).diagnostics.at(-1)!;
        expect(after([]).example).toBeDefined();
        // A Regal Orb refused on every item: the craft goes on from them as
        // they were, items the game does not make there.
        const past = after([op("regal")]);
        expect(past.message).toContain("Requires a Rare item");
        expect(past.example).toBeUndefined();
    });

    it("is left out where the error is no refused step", () => {
        const c = craft(ring({ prefixes: ["Life1"] }), [iff(notp(has("Life1")), [op("chaos")])]);
        expect(exact(c).diagnostics.map((d) => d.example)).toEqual([undefined]);
    });
});

describe("a fault of the checker's own", () => {
    const failing = (name: keyof Registry): Registry => ({
        ...HAND_REGISTRY,
        [name]: () => {
            throw new Error(`no ${String(name)} here`);
        },
    });

    it("leaves the craft unjudged in one error at the step it was checking", () => {
        const step = op("exalt");
        const c = craft(ring({ prefixes: ["Life1"] }), [step, op("chaos")]);
        // A currency's method reads the registry for the currency.
        const r = check(c, { registry: failing("resolveCurrency") });
        expect(r.ok).toBe(false);
        expect(r.diagnostics).toEqual([
            { message: `${UNJUDGED} — no resolveCurrency here`, span: step.span },
        ]);
        expect(r.findings.map((f) => f.kind)).toEqual(["unjudged"]);
        expect(r.trace).toEqual([]);
    });

    it("is at the item block where the item cannot be read", () => {
        const c = craft(ring(), [op("chaos")]);
        const r = check(c, { registry: failing("influenceTags") });
        expect(r.diagnostics.map((d) => d.span)).toEqual([c.item.span]);
    });
});

describe("an item block no item answers to", () => {
    it("is one error at the block, where no field of it is at fault", () => {
        // The catalogue's ring rolls one prefix type, so two prefixes cannot both be random rolls.
        const registry = buildRegistry({ bases: [RING_BASE], mods: TIERED_CATALOG });
        const c = craft(
            item({
                base: "IronRing",
                ilvl: 84,
                rarity: "rare",
                prefixes: [{ mod: "random" }, { mod: "random" }],
            }),
            [op("chaos")],
        );
        const r = check(c, { registry });
        expect(r.diagnostics).toEqual([
            {
                message: "No item can have everything this item block declares on this base.",
                span: c.item.span,
            },
        ]);
        expect(r.trace).toEqual([]);
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
        // A budget gives the check a universe of its own, as this one is.
        const start = startOf(HAND_REGISTRY, c, () => {}, { maxNodes: 2_000_000 })!;
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

describe("the rounds that settle a loop", () => {
    // A loop no item leaves yields nothing in them: its items are no head's.
    const cat = generateCatalog(11, {
        types: 4,
        oneValue: true,
        sharedFamily: false,
        unnumbered: false,
        ilvl: 84,
    });
    const magic = item({
        base: cat.base.id,
        ilvl: cat.ilvl,
        rarity: "magic",
        prefixes: ["Alpha1"],
    });
    const inner = () => until(has("Delta1"), [iff(has("Charlie1"), [op("alteration")])]);
    const run = (body: Stmt[]) => {
        const c = craft(magic, body);
        expect(compareCraft(c, cat.registry, cat.ctx).diff).toBe("");
        return check(c, { registry: cat.registry });
    };
    const neverExits = (r: ReturnType<typeof run>) =>
        r.diagnostics.filter((d) => d.message.startsWith("this loop can never exit"));

    it("take no recovery from a loop that never exits on an early round", () => {
        const loop = inner();
        const outer = until(has("Bravo1"), [loop, op("alteration")]);
        const r = run([outer]);
        expect(r.ok).toBe(false);
        // The item can never leave the inner loop, so none comes back to the
        // outer loop's head: both are reported, in the order of the craft.
        const spans = [outer.pred.span, loop.pred.span].sort(
            (a, b) => a.start.offset - b.start.offset,
        );
        expect(neverExits(r).map((d) => d.span)).toEqual(spans);
    });

    it("leave the inner loop alone refused as never exiting", () => {
        const loop = inner();
        const r = run([loop]);
        expect(neverExits(r).map((d) => d.span)).toEqual([loop.pred.span]);
    });

    it("are worked out once for an entry met again", () => {
        const c = craft(ring({ suffixes: ["Fire1"] }), [
            until(isRarity("normal"), [until(has("Fire1"), [op("chaos")])]),
        ]);
        const r = exact(c);
        expect(checkDetail(r)!.reused).toBeGreaterThan(0);
        agrees(c);
    });
});

describe("a step after", () => {
    it("a call that stops for every item", () => {
        const ender = procDef("ender", [], [stop()]);
        const c = craft(ring(), [callStmt("ender"), op("chaos")], [], [ender]);
        expect(said(c)).toEqual(["this step can never run: the craft always stops before it"]);
        agrees(c);
    });

    it("a nested if whose arms restart and stop", () => {
        const c = craft(ring({ prefixes: ["Life1"], suffixes: [{ mod: "random" }] }), [
            until(has("Mana1"), [
                op("divine"),
                iff(has("Life1"), [iff(has("Fire1"), [restart()], [stop()])], [restart()]),
                op("exalt"),
            ]),
        ]);
        expect(said(c)).toContain(
            "this step can never run: the craft always stops or the loop restarts before it",
        );
        agrees(c);
    });

    it("an arm that restarts, and one that restarts too", () => {
        const c = craft(ring({ prefixes: ["Life1"] }), [
            until(has("Mana1"), [
                op("divine"),
                iff(has("Life1"), [restart()], [restart()]),
                op("exalt"),
            ]),
        ]);
        expect(said(c)).toContain("this step can never run: the loop always restarts before it");
        agrees(c);
    });
});

describe("a proc", () => {
    it("defined outside a loop and called in it restarts that loop", () => {
        const again = procDef("again", [], [iff(notp(has("Fire1")), [restart()])]);
        const c = craft(
            ring({ rarity: "magic", prefixes: ["Life1"] }),
            [until(has("Mana1"), [op("alteration"), callStmt("again"), op("augment")])],
            [],
            [again],
        );
        const r = exact(c);
        expect(r.diagnostics.filter((d) => d.message.includes("never run"))).toEqual([]);
        agrees(c);
    });

    it("called twice is traced at each call", () => {
        const twice = procDef("twice", ["m"], [iff(hasP(param("m")), [op("annul")])]);
        const c = craft(
            ring({ prefixes: ["Life1"], suffixes: ["Fire1"] }),
            [callStmt("twice", ["Life1"]), callStmt("twice", ["Fire1"])],
            [],
            [twice],
        );
        const r = exact(c);
        expect(r.trace.filter((e) => e.kind === "call").length).toBe(2);
        agrees(c);
    });
});

describe("a method built in parts", () => {
    it("runs the parts built alike as one", () => {
        // The change's parts by influence build the same operations; run apart,
        // the part no item of which passes would recover on its own.
        const cat = generateCatalog(2, { types: 2, harvest: true, influence: true });
        const c = craft(
            item({
                base: cat.base.id,
                ilvl: cat.ilvl,
                rarity: "rare",
                suffixes: ["FireRes1", { mod: "random" }],
            }),
            [
                iff(has("cold resistance"), [{ ...op("exalt"), words: ["exalt", "hunter"] }]),
                {
                    ...op("harvest"),
                    words: ["harvest", "change"],
                    args: [
                        { kind: "string", value: "fire resistance", span: op("x").span },
                        { kind: "string", value: "cold resistance", span: op("x").span },
                    ],
                },
                iff(influencedP(), [op("divine")]),
            ],
        );
        const r = check(c, { registry: cat.registry });
        expect(r.findings.map((f) => f.kind)).toEqual(["refused", "deadIf"]);
        expect(compareCraft(c, cat.registry, cat.ctx).diff).toBe("");
    });

    // No method of the table ends the craft on every item (a `locus` destroys
    // some outcomes only), so the `ended` finding is reached by no craft here.
});

describe("a condition only the items past an error can read", () => {
    it("narrows nothing without recovery, and the items with it", () => {
        // The modifier's second tier is a Hunter row: read on an item with no
        // influence the tier is out of range, which narrows nothing; the
        // recovered Hunter's orb leaves items it is read on, which it narrows.
        const ex = modRow({ id: "Ex1", type: "TypeEx", gen: "prefix", text: "+(1-2) to Ex" });
        const hunterEx = (id: string, minLevel: number) =>
            modRow({
                id,
                type: "TypeEx",
                gen: "prefix",
                text: "+(3-4) to Ex",
                minLevel,
                spawn: [{ tag: TagId("ring_basilisk"), weight: 500 }],
            });
        const registry = buildRegistry({
            bases: [RING_BASE],
            mods: [...HAND_MODS, ex, hunterEx("ExHunter1", 1), hunterEx("ExHunter2", 50)],
        });
        const c = craft(ring({ rarity: "magic", prefixes: [{ mod: "random" }] }), [
            iff(has("Life1"), [{ ...op("exalt"), words: ["exalt", "hunter"] }]),
            iff(has("ex", 2), [op("scour")], [stop()]),
        ]);
        const r = compareCraft(c, registry, refCtx(registry, RING_BASE, 84));
        expect(r.diff).toBe("");
        expect(r.strict.diagnostics.map((d) => d.message)).toContain(
            'tier 2 is out of range for "ex" (it has 1 tier on this base)',
        );
    });
});
