import { describe, expect, it } from "vitest";
import { check } from "../check/check.js";
import { buildRegistry } from "../resolve/registry.js";
import { pool } from "../pool/pool.js";
import { emptyItem } from "../model/item.js";
import {
    andp,
    beast,
    blockArg,
    bench,
    benchRemove,
    callStmt,
    cmp,
    craft,
    dominantP,
    eldritchP,
    fracturedP,
    harvest,
    has,
    hasValue,
    iff,
    isRarity,
    item,
    notp,
    op,
    orp,
    paramStep,
    procDef,
    restart,
    stop,
    until,
    unveil,
    veiled,
} from "../__fixtures__/ast.js";
import {
    BENCH_LIFE_ROW,
    BOOTS_BASE,
    CATALOG,
    ELDRITCH_ROWS,
    CLASS_RING,
    LIFE_T1,
    PROTECT_PREFIXES_CARRIER,
    RING_BASE,
    VEILED_CATALOG,
} from "../__fixtures__/mods.js";
import { costOf } from "./report.js";
import type { Prices } from "./prices.js";

const registry = buildRegistry({
    bases: [RING_BASE],
    mods: [...CATALOG, BENCH_LIFE_ROW, PROTECT_PREFIXES_CARRIER, ...VEILED_CATALOG],
    baseAliases: { "Iron Ring": "IronRing" },
    benchCrafts: [BENCH_LIFE_ROW.id, PROTECT_PREFIXES_CARRIER.id].map((mod) => ({
        mod,
        tier: 1,
        itemClasses: new Set([CLASS_RING]),
    })),
});
const ring = (
    rarity: "normal" | "magic" | "rare",
    prefixes: string[] = [],
    suffixes: string[] = [],
) => item({ base: "Iron Ring", ilvl: 84, rarity, prefixes, suffixes });

function report(c: ReturnType<typeof craft>, prices?: Prices) {
    return costOf(c, check(c, { registry }), registry, prices);
}

/** The weight share of a type among one side's groups of the empty ring's pool. */
function side(gen: "prefix" | "suffix"): { types: string[]; weights: number[] } {
    const byType = new Map<string, number>();
    for (const c of pool(registry.catalog, emptyItem(RING_BASE, 84, "rare"))) {
        if (c.mod.gen !== gen) continue;
        byType.set(c.mod.type, (byType.get(c.mod.type) ?? 0) + c.weight);
    }
    return { types: [...byType.keys()], weights: [...byType.values()] };
}

describe("the cost of a guide", () => {
    it("an exalt into the last prefix slot is one draw from the prefix race", () => {
        // Two prefixes and three suffixes named: the Exalted Orb draws one prefix.
        const c = craft(
            ring(
                "rare",
                ["IncreasedMana1", "IncreasedArmour1"],
                ["FireResist1", "ColdResist1", "LightningResist1"],
            ),
            [until(has("IncreasedLife1"), [op("annul"), op("exalt")])],
        );
        const r = report(c);
        const loop = r.steps.find((s) => s.kind === "until")!;
        expect(loop.attempts!.chance).toBeGreaterThan(0);
        expect(loop.attempts!.expected).toBeCloseTo(1 / loop.attempts!.chance, 9);
    });

    it("an annul and an exalt draw on the item as it is, its modifiers closing their groups", () => {
        // The annul takes one of the five. A prefix (2/5): the suffixes are
        // full, the exalt draws a prefix with the other prefix's group closed.
        // A resistance (3/5): the exalt draws a side by the open pools'
        // weights, the two prefixes' and the two resistances' groups closed.
        const c = craft(
            ring(
                "rare",
                ["IncreasedMana1", "IncreasedArmour1"],
                ["FireResist1", "ColdResist1", "LightningResist1"],
            ),
            [op("annul"), op("exalt"), iff(has("maximum life"), [stop()])],
        );
        const branch = report(c).steps.find((s) => s.kind === "if")!;
        // The exalt's chance of a life row on the item the annul left: the life
        // rows' share of the pool that item leaves open.
        const lifeShare = (ids: string[]): number => {
            const mods = ids.map((id) => CATALOG.find((m) => m.id === id)!);
            const facts = {
                ...emptyItem(RING_BASE, 84, "rare"),
                prefixCount: mods.filter((m) => m.gen === "prefix").length,
                suffixCount: mods.filter((m) => m.gen === "suffix").length,
                types: new Set(mods.map((m) => m.type)),
                families: new Set(mods.flatMap((m) => [...m.families])),
            };
            const open = pool(registry.catalog, facts).filter((x) =>
                x.mod.gen === "prefix" ? facts.prefixCount < 3 : facts.suffixCount < 3,
            );
            const total = open.reduce((a, x) => a + x.weight, 0);
            const life = open
                .filter((x) => x.mod.type === LIFE_T1.type)
                .reduce((a, x) => a + x.weight, 0);
            return life / total;
        };
        const all = [
            "IncreasedMana1",
            "IncreasedArmour1",
            "FireResist1",
            "ColdResist1",
            "LightningResist1",
        ];
        let expected = 0;
        for (const gone of all) expected += lifeShare(all.filter((id) => id !== gone)) / 5;
        expect(branch.note).toBeUndefined();
        expect(branch.branch).toBeCloseTo(expected, 9);
    });

    it("a chaos loop's rounds multiply the orb's runs and the total", () => {
        const c = craft(ring("rare"), [until(has("IncreasedLife1"), [op("chaos")])]);
        const r = report(c);
        const loop = r.steps.find((s) => s.kind === "until")!;
        const chaos = r.steps.find((s) => s.kind === "operation")!;
        expect(chaos.runs).toBeCloseTo(loop.attempts!.expected, 9);
        expect(chaos.unit).toEqual([{ item: "Chaos Orb", amount: 1 }]);
        expect(r.total).toEqual([{ item: "Chaos Orb", amount: chaos.runs }]);
        // A looser exit is reached sooner.
        const looser = report(
            craft(ring("rare"), [
                until(orp(has("IncreasedLife1"), has("FireResist1")), [op("chaos")]),
            ]),
        );
        expect(looser.steps[0]!.attempts!.chance).toBeGreaterThan(loop.attempts!.chance);
        // A tighter one later.
        const tighter = report(
            craft(ring("rare"), [
                until(andp(has("IncreasedLife1"), has("FireResist1")), [op("chaos")]),
            ]),
        );
        expect(tighter.steps[0]!.attempts!.chance).toBeLessThan(loop.attempts!.chance);
    });

    it("a branch after a reforge is taken as often as its condition comes up", () => {
        const c = craft(ring("rare"), [op("chaos"), iff(has("IncreasedLife1"), [op("exalt")])]);
        const r = report(c);
        const branch = r.steps.find((s) => s.kind === "if")!;
        const exalt = r.steps[2]!;
        expect(branch.branch).toBeGreaterThan(0);
        expect(branch.branch).toBeLessThan(1);
        expect(exalt.runs).toBeCloseTo(branch.branch!, 9);
        // The loop that waits for the same modifier ends with that chance.
        const loop = report(craft(ring("rare"), [until(has("IncreasedLife1"), [op("chaos")])]));
        expect(loop.steps[0]!.attempts!.chance).toBeCloseTo(branch.branch!, 9);
    });

    it("a stop inside a loop ends the craft on its share of the rounds", () => {
        const c = craft(ring("rare"), [
            until(has("IncreasedLife1"), [op("chaos"), iff(notp(has("FireResist1")), [stop()])]),
            op("exalt"),
        ]);
        const r = report(c);
        expect(r.stopped).toBeGreaterThan(0);
        expect(r.stopped).toBeLessThan(1);
        const exalt = r.steps.find(
            (s) => s.kind === "operation" && s.unit![0]!.item === "Exalted Orb",
        )!;
        expect(exalt.runs).toBeCloseTo(1 - r.stopped, 9);
    });

    it("a restart goes back to the loop's head with the item as it is", () => {
        const full = ring(
            "rare",
            ["IncreasedLife1", "IncreasedMana1", "IncreasedArmour1"],
            ["FireResist1", "ColdResist1", "LightningResist1"],
        );
        const loopOf = (body: Parameters<typeof until>[1]) =>
            craft(full, [
                until(cmp("prefixCount", "<=", 2), body),
                iff(has("IncreasedLife1"), [op("divine")]),
            ]);
        const r = report(loopOf([op("annul"), iff(notp(has("IncreasedLife1")), [restart()])]));
        const plain = report(loopOf([op("annul")]));
        const rounds = (x: typeof r): number => x.steps.find((s) => s.kind === "until")!.runs;
        const kept = (x: typeof r): number =>
            x.steps.filter((s) => s.kind === "if").at(-1)!.branch!;
        // The head finds a prefix open after the life went and leaves without
        // it: the rounds and the item are those of the loop with no restart,
        // the first prefix taken being the life one time in three.
        const loop = r.steps.find((s) => s.kind === "until")!;
        expect(loop.attempts!.expected).toBeCloseTo(1 + 1 / 2 + 1 / 5 + 1 / 20, 9);
        expect(rounds(r)).toBeCloseTo(rounds(plain), 9);
        expect(kept(r)).toBeCloseTo(2 / 3, 9);
        expect(kept(plain)).toBeCloseTo(2 / 3, 9);
        expect(r.stopped).toBe(0);
        // In a loop inside another it goes back to the inner loop's head.
        const nested = report(
            craft(full, [
                until(cmp("suffixCount", "<=", 2), [
                    until(cmp("prefixCount", "<=", 2), [
                        op("annul"),
                        iff(notp(has("IncreasedLife1")), [restart()]),
                    ]),
                    op("annul"),
                ]),
            ]),
        );
        const inner = nested.steps.filter((s) => s.kind === "until")[1]!;
        expect(inner.note).toBeUndefined();
        expect(inner.attempts!.expected).toBeGreaterThan(1);
        expect(nested.steps.every((s) => s.note === undefined)).toBe(true);
    });

    it("a restart outside every loop ends the craft", () => {
        const c = craft(ring("rare", ["IncreasedLife1"], ["FireResist1"]), [
            op("annul"),
            iff(notp(has("IncreasedLife1")), [restart()]),
            op("exalt"),
        ]);
        const r = report(c);
        expect(r.stopped).toBeCloseTo(1 / 2, 9);
        const steps = r.steps.filter((s) => s.kind === "operation");
        expect(steps[0]!.runs).toBeCloseTo(1, 9);
        expect(steps[1]!.runs).toBeCloseTo(1 / 2, 9);
    });

    it("a branch after a solved loop reads where the loop left the item", () => {
        // Annulling a full ring until a prefix is open takes a suffix on the
        // way three times in ten and leaves exactly two.
        const c = craft(
            ring(
                "rare",
                ["IncreasedLife1", "IncreasedMana1", "IncreasedArmour1"],
                ["FireResist1", "ColdResist1", "LightningResist1"],
            ),
            [
                until(cmp("prefixCount", "<=", 2), [op("annul")]),
                iff(cmp("suffixCount", "==", 2), [stop()]),
            ],
        );
        const branch = report(c).steps.find((s) => s.kind === "if")!;
        expect(branch.note).toBeUndefined();
        expect(branch.branch).toBeCloseTo(3 / 10, 9);
    });

    it("a tier a solved loop never told apart is not read off its states", () => {
        // The Chaos Orb loop asks for the life at any tier, so its states hold
        // the life by a stand-in row; a branch on the top tier cannot read it.
        const c = craft(ring("rare"), [
            until(has("maximum life"), [op("chaos")]),
            iff(has("maximum life", 1), [stop()]),
        ]);
        const branch = report(c).steps.find((s) => s.kind === "if")!;
        expect(branch.branch).toBeGreaterThan(0);
        expect(branch.branch).toBeLessThan(1);
    });

    it("an annul that may take a protecting metamod reaches the side it protected after", () => {
        // The metamod is the only suffix, so the first annul takes it; from
        // then on the prefixes are in reach and the loop ends.
        const c = craft(
            ring(
                "rare",
                ["IncreasedLife1", "IncreasedMana1", "IncreasedArmour1"],
                [PROTECT_PREFIXES_CARRIER.id],
            ),
            [until(cmp("prefixCount", "<=", 1), [op("annul")])],
        );
        const loop = report(c).steps.find((s) => s.kind === "until")!;
        expect(loop.note).toBeUndefined();
        // One annul for the metamod, then two for the prefixes.
        expect(loop.attempts!.expected).toBeCloseTo(3, 6);
    });

    it("a second loop starts from where a solved first loop left the item", () => {
        // A make-room loop, then one that annuls down to a single prefix: the
        // second is solved from the first's exits, not from a guess.
        const c = craft(
            ring(
                "rare",
                ["IncreasedLife1", "IncreasedMana1", "IncreasedArmour1"],
                ["FireResist1", "ColdResist1", "LightningResist1"],
            ),
            [
                until(cmp("prefixCount", "<=", 2), [op("annul")]),
                until(cmp("prefixCount", "<=", 1), [op("annul")]),
            ],
        );
        const loops = report(c).steps.filter((s) => s.kind === "until");
        expect(loops[1]!.note).toBeUndefined();
        // The first loop leaves two prefixes and three, two, one or no suffixes
        // (1/2, 3/10, 3/20, 1/20); from two prefixes and s suffixes the second
        // takes 2, 5/3, 4/3 or 1 annuls.
        expect(loops[1]!.attempts!.expected).toBeCloseTo(
            (1 / 2) * 2 + (3 / 10) * (5 / 3) + (3 / 20) * (4 / 3) + 1 / 20,
            9,
        );
    });

    it("a second loop may name a modifier the first did not, when the item settles it", () => {
        // The exalts never remove the life, so the second loop knows it is
        // there and starts from the first loop's states.
        const c = craft(ring("rare", ["IncreasedLife1"]), [
            until(cmp("suffixCount", ">=", 1), [op("exalt")]),
            until(andp(has("maximum life"), cmp("prefixCount", ">=", 2)), [op("exalt")]),
        ]);
        const loops = report(c).steps.filter((s) => s.kind === "until");
        expect(loops[1]!.note).toBeUndefined();
        expect(loops[1]!.attempts!.expected).toBeGreaterThan(0);
    });

    it("a call is walked as its steps written in its place", () => {
        const guide = (
            step: Parameters<typeof craft>[1][number],
            procs: ReturnType<typeof procDef>[],
        ) =>
            craft(
                ring(
                    "rare",
                    ["IncreasedLife1", "IncreasedMana1", "IncreasedArmour1"],
                    ["FireResist1", "ColdResist1", "LightningResist1"],
                ),
                [
                    until(cmp("prefixCount", "<=", 2), [op("annul")]),
                    step,
                    iff(cmp("suffixCount", "==", 2), [stop()]),
                ],
                [],
                procs,
            );
        const called = report(guide(callStmt("reroll"), [procDef("reroll", [], [op("chaos")])]));
        const inline = report(guide(op("chaos"), []));
        const branch = (r: typeof called) => r.steps.find((s) => s.kind === "if")!;
        expect(called.steps.every((s) => s.note === undefined)).toBe(true);
        expect(called.total).toEqual(inline.total);
        expect(branch(called).branch).toBeCloseTo(branch(inline).branch!, 12);
    });

    it("a step parameter used twice runs as two steps, each on its own item", () => {
        const twice = procDef("twice", ["s"], [paramStep("s"), paramStep("s")]);
        const guide = (steps: Parameters<typeof craft>[1], procs: ReturnType<typeof procDef>[]) =>
            craft(
                ring("rare", ["IncreasedMana1"], ["FireResist1"]),
                [...steps, iff(has("IncreasedLife1"), [stop()])],
                [],
                procs,
            );
        const branch = (c: ReturnType<typeof craft>) =>
            report(c).steps.find((s) => s.kind === "if")!.branch!;
        const inline = branch(guide([op("exalt"), op("exalt")], []));
        expect(branch(guide([callStmt("twice", [blockArg([op("exalt")])])], [twice]))).toBeCloseTo(
            inline,
            9,
        );
        // A call as the argument of a call: four exalts would not fit, so two
        // calls of one exalt each, nested.
        const once = procDef("once", ["s"], [paramStep("s")]);
        const nested = guide(
            [callStmt("twice", [blockArg([callStmt("once", [blockArg([op("exalt")])])])])],
            [twice, once],
        );
        expect(branch(nested)).toBeCloseTo(inline, 9);
        expect(
            branch(guide([callStmt("one"), callStmt("one")], [procDef("one", [], [op("exalt")])])),
        ).toBeCloseTo(inline, 9);
    });

    it("a step parameter used twice inside a solved loop is two steps of each round", () => {
        const guide = (steps: Parameters<typeof craft>[1], procs: ReturnType<typeof procDef>[]) =>
            craft(
                ring("rare", ["IncreasedMana1"], ["FireResist1"]),
                [
                    until(has("IncreasedLife1"), [
                        op("scour"),
                        op("transmute"),
                        op("regal"),
                        ...steps,
                    ]),
                ],
                [],
                procs,
            );
        const called = report(
            guide(
                [callStmt("twice", [blockArg([op("exalt")])])],
                [procDef("twice", ["s"], [paramStep("s"), paramStep("s")])],
            ),
        ).steps[0]!;
        const inline = report(guide([op("exalt"), op("exalt")], [])).steps[0]!;
        expect(called.note).toBeUndefined();
        expect(called.attempts!.expected).toBeCloseTo(inline.attempts!.expected, 6);
    });

    it("a call inside a loop is followed round by round", () => {
        const guide = (body: Parameters<typeof craft>[1], procs: ReturnType<typeof procDef>[]) =>
            craft(ring("rare"), [until(has("IncreasedLife1"), body)], [], procs);
        const called = report(guide([callStmt("reroll")], [procDef("reroll", [], [op("chaos")])]))
            .steps[0]!;
        const inline = report(guide([op("chaos")], [])).steps[0]!;
        expect(called.note).toBeUndefined();
        expect(called.attempts!.expected).toBeCloseTo(inline.attempts!.expected, 9);
    });

    it("a branch after a solved loop reads the modifier the loop did not name", () => {
        // The loop ends on the annul that takes a prefix, any of the three
        // alike: the life is gone a third of the time.
        const c = craft(
            ring(
                "rare",
                ["IncreasedLife1", "IncreasedMana1", "IncreasedArmour1"],
                ["FireResist1", "ColdResist1", "LightningResist1"],
            ),
            [until(cmp("prefixCount", "<=", 2), [op("annul")]), iff(has("maximum life"), [stop()])],
        );
        const branch = report(c).steps.find((s) => s.kind === "if")!;
        expect(branch.note).toBeUndefined();
        expect(branch.branch).toBeCloseTo(2 / 3, 9);
    });

    it("a reforge in a make-room loop's else arm pays for the kept modifier again", () => {
        // Three prefixes with the life among them: an annul takes the life a
        // third of the time and sends the loop back to the Chaos Orb until the
        // life rolls again, so the orbs run a fair share of a whole reroll loop.
        const c = craft(ring("rare", ["IncreasedLife1", "IncreasedMana1", "IncreasedArmour1"]), [
            until(andp(has("IncreasedLife1"), cmp("prefixCount", "<=", 2)), [
                iff(has("IncreasedLife1"), [op("annul")], [op("chaos")]),
            ]),
        ]);
        const r = report(c);
        const chaos = r.steps.find((s) => s.unit?.[0]?.item === "Chaos Orb")!;
        const alone = report(craft(ring("rare"), [until(has("IncreasedLife1"), [op("chaos")])]));
        const perLife = alone.steps[0]!.attempts!.expected;
        expect(chaos.runs).toBeGreaterThan(0.2 * perLife);
        expect(r.steps.find((s) => s.kind === "until")!.note).toBeUndefined();
    });

    it("a restore to an imprint whose counts are open keeps the spread of what it may hold", () => {
        // A Transmutation lays down one modifier or two; the imprint keeps
        // either, which the walk reads by the reading, so its ends are walked.
        const c = craft(ring("normal"), [
            op("transmute"),
            beast({ kind: "imprint" }),
            op("restore"),
            op("regal"),
            iff(cmp("prefixCount", ">=", 2), [stop()]),
        ]);
        const branch = report(c).steps.find((s) => s.kind === "if")!;
        expect(branch.branchRange).toBeDefined();
    });

    it("a restore inside a loop sets the item back to its imprint each round", () => {
        // A Magic ring holding the life alone, imprinted and regaled; the loop
        // restores it until the Regal Orb lands a suffix. Each round starts
        // from the imprint, so the chance per round is the suffix side's share
        // of the draw, the life's group out of the prefixes.
        const c = craft(ring("magic", ["IncreasedLife1"]), [
            beast({ kind: "imprint" }),
            op("regal"),
            until(cmp("prefixCount", "==", 1), [
                op("restore"),
                beast({ kind: "imprint" }),
                op("regal"),
            ]),
        ]);
        const r = report(c);
        const loop = r.steps.find((s) => s.kind === "until")!;
        const prefixes = side("prefix");
        const suffixes = side("suffix");
        const lifeGroup = prefixes.weights[prefixes.types.indexOf("IncreasedLife")]!;
        const prefixWeight = prefixes.weights.reduce((a, b) => a + b, 0) - lifeGroup;
        const suffixWeight = suffixes.weights.reduce((a, b) => a + b, 0);
        const toSuffix = suffixWeight / (prefixWeight + suffixWeight);
        expect(loop.note).toBeUndefined();
        expect(loop.attempts!.chance).toBeCloseTo(toSuffix, 6);
        // Entered with the first Regal's prefix share; each round ends it with
        // the suffix share.
        expect(loop.attempts!.expected).toBeCloseTo((1 - toSuffix) / toSuffix, 6);
    });

    it("a Veiled Exalted Orb takes a modifier and puts a veiled one on either side with room", () => {
        // A prefix goes half the time; the veiled modifier is a prefix half
        // the time either way (Q76), so one prefix is left a quarter of the time.
        const c = craft(
            ring("rare", ["IncreasedMana1", "IncreasedArmour1"], ["FireResist1", "ColdResist1"]),
            [veiled("exalt"), iff(cmp("prefixCount", "==", 1), [stop()])],
        );
        const branch = report(c).steps.find((s) => s.kind === "if")!;
        expect(branch.note).toBeUndefined();
        expect(branch.branch).toBeCloseTo(1 / 4, 9);
    });

    it("an unveil takes the modifier the guide names when it is offered", () => {
        // The veiled modifier is a suffix half the time, and a ring's veiled
        // suffixes are two, both offered: the named one is taken.
        const c = craft(
            ring("rare", ["IncreasedMana1", "IncreasedArmour1"], ["FireResist1", "ColdResist1"]),
            [veiled("exalt"), unveil(), iff(has("veiled double damage"), [stop()])],
        );
        const branch = report(c).steps.find((s) => s.kind === "if")!;
        expect(branch.note).toBeUndefined();
        expect(branch.branch).toBeCloseTo(1 / 2, 9);
    });

    it("an unveil does not take a modifier a condition asks to be absent", () => {
        const c = craft(
            ring("rare", ["IncreasedMana1", "IncreasedArmour1"], ["FireResist1", "ColdResist1"]),
            [veiled("exalt"), unveil(), iff(notp(has("veiled double damage")), [stop()])],
        );
        expect(report(c).steps.find((s) => s.kind === "if")!.branch).toBeCloseTo(1, 9);
    });

    it("an unveil with a target takes the target over a modifier a later condition names", () => {
        const c = craft(
            ring("rare", ["IncreasedMana1", "IncreasedArmour1"], ["FireResist1", "ColdResist1"]),
            [
                veiled("exalt"),
                unveil("veiled cast speed"),
                iff(has("veiled double damage"), [stop()]),
            ],
        );
        const branch = report(c).steps.find((s) => s.kind === "if")!;
        expect(branch.branch).toBeCloseTo(0, 9);
    });

    it("a fractured modifier is one the annuls after never take", () => {
        // The lock lands on the mana a quarter of the time; otherwise one annul
        // takes it one time in three among the three left unlocked.
        const c = craft(
            ring("rare", ["IncreasedMana1", "IncreasedArmour1"], ["FireResist1", "ColdResist1"]),
            [
                op("fracture"),
                iff(fracturedP("IncreasedMana1"), [op("exalt")]),
                op("annul"),
                iff(has("IncreasedMana1"), [stop()]),
            ],
        );
        const steps = report(c).steps.filter((s) => s.kind === "if");
        expect(steps[0]!.branch).toBeCloseTo(1 / 4, 9);
        expect(steps[1]!.note).toBeUndefined();
        expect(steps[1]!.branch).toBeCloseTo(1 / 4 + (3 / 4) * (2 / 3), 9);
    });

    it("a loop entered from a branch the states cannot read keeps the fracture", () => {
        // A rarity condition drops the tracked states; the loop's start then
        // reads the item, which still says the life is fractured.
        const guide = (pre: Parameters<typeof craft>[1]) =>
            report(
                craft(
                    item({
                        base: "Iron Ring",
                        ilvl: 84,
                        rarity: "rare",
                        prefixes: [{ mod: "IncreasedLife1", fractured: true }, "IncreasedMana1"],
                    }),
                    [...pre, until(has("IncreasedArmour1"), [op("chaos")])],
                ),
            ).steps.find((s) => s.kind === "until")!;
        const plain = guide([]);
        const after = guide([iff(isRarity("rare"), [])]);
        expect(after.note).toBeUndefined();
        expect(after.attempts!.expected).toBeCloseTo(plain.attempts!.expected, 9);
    });

    it("a Harvest augment keeps what its removal did not take", () => {
        // The removal takes one of three; life stays two times in three.
        const c = craft(ring("rare", ["IncreasedMana1", "IncreasedLife1"], ["FireResist1"]), [
            harvest("augment", "lightning"),
            iff(has("IncreasedLife1"), [stop()]),
        ]);
        const branch = report(c).steps.find((s) => s.kind === "if")!;
        expect(branch.note).toBeUndefined();
        expect(branch.branch).toBeCloseTo(2 / 3, 9);
    });

    it("a Harvest augment's removal takes one of the others, never what it added", () => {
        const after = (pred: ReturnType<typeof has>) =>
            report(
                craft(ring("rare", ["IncreasedMana1"], ["FireResist1"]), [
                    harvest("augment", "life"),
                    iff(pred, [stop()]),
                ]),
            ).steps.find((s) => s.kind === "if")!;
        expect(after(has("IncreasedLife1")).branch).toBeCloseTo(1, 9);
        expect(after(has("IncreasedMana1")).branch).toBeCloseTo(1 / 2, 9);
    });

    it("a crafted modifier put on and taken off leaves what the item held as it was", () => {
        // The checker forgets which life the removal took; the state knows it
        // was the crafted one.
        const life = (steps: ReturnType<typeof op>[]) =>
            report(
                craft(ring("rare"), [
                    op("chaos"),
                    iff(andp(notp(has("maximum life")), cmp("prefixCount", "<=", 2)), steps),
                    iff(has("maximum life"), [stop()]),
                ]),
            ).steps.at(-2)!;
        const plain = life([]);
        const crafted = life([bench("maximum life"), benchRemove()]);
        expect(crafted.note).toBeUndefined();
        expect(crafted.branch).toBeCloseTo(plain.branch!, 9);
    });

    it("a Divine Orb reaches a value by the share of the range at or above it", () => {
        // LIFE_T1 rolls 70–84: fifteen values, five of them 80 or more. The
        // ring's own life is one of them a third of the time, and then no
        // Divine Orb is spent: two rounds on average, not three.
        const c = craft(ring("rare", ["IncreasedLife1"]), [
            until(hasValue("IncreasedLife1", ">=", 80), [op("divine")]),
        ]);
        const r = report(c);
        expect(r.steps[0]!.note).toBeUndefined();
        expect(r.steps[0]!.attempts!.chance).toBeCloseTo(5 / 15, 9);
        expect(r.steps[0]!.attempts!.expected).toBeCloseTo((10 / 15) * 3, 9);
    });

    it("a Divine Orb leaves a fractured modifier's value as it is", () => {
        const c = craft(
            item({
                base: "Iron Ring",
                ilvl: 84,
                rarity: "rare",
                prefixes: [{ mod: "IncreasedLife1", fractured: true }],
            }),
            [until(hasValue("IncreasedLife1", ">=", 80), [op("divine")])],
        );
        const loop = report(c).steps[0]!;
        expect(loop.note).toMatch(/cannot end/);
    });

    it("a loop that cannot end has no figure, nor has the guide", () => {
        const prices: Prices = {
            league: "Test",
            fetchedAt: "2026-11-09T00:00:00Z",
            chaosPerDivine: 400,
            chaos: new Map([
                ["Divine Orb", 400],
                ["Chaos Orb", 1],
            ]),
        };
        const stuck = (body: Parameters<typeof craft>[1]) =>
            report(
                craft(
                    item({
                        base: "Iron Ring",
                        ilvl: 84,
                        rarity: "rare",
                        prefixes: [{ mod: "IncreasedLife1", fractured: true }],
                    }),
                    body,
                ),
                prices,
            );
        // The fractured life never rolls again: two times in three the rounds
        // go on for ever, and the rounds followed before giving up are no figure.
        const r = stuck([op("chaos"), until(hasValue("IncreasedLife1", ">=", 80), [op("divine")])]);
        const [chaos, loop, divine] = r.steps;
        expect(loop!.unknown).toBe(true);
        expect(loop!.attempts).toBeUndefined();
        expect(loop!.note).toMatch(/67% of the time .* not known/);
        expect(divine!.unknown).toBe(true);
        expect(divine!.expected).toBeUndefined();
        expect(chaos!.unknown).toBeUndefined();
        expect(r.unknown).toBe(true);
        expect(r.chaos).toBeUndefined();
        expect(r.total).toEqual([{ item: "Chaos Orb", amount: 1 }]);
        // A loop the check refuses, its body never checked: the same, with
        // the check's reason and none of a step's own.
        const refused = report(
            craft(ring("rare", ["IncreasedLife1"]), [
                until(andp(has("IncreasedLife1"), cmp("prefixCount", "==", 0)), [op("chaos")]),
            ]),
            prices,
        );
        expect(refused.steps[0]!.unknown).toBe(true);
        expect(refused.steps[0]!.note).toMatch(
            /the check finds this loop can never reach its exit/,
        );
        expect(refused.steps[1]!.note).toBeUndefined();
        expect(refused.unknown).toBe(true);
        expect(refused.chaos).toBeUndefined();
    });

    it("a loop whose exit already holds takes no round", () => {
        const r = report(
            craft(ring("rare", ["IncreasedLife1"]), [
                until(has("IncreasedLife1"), [op("chaos")]),
                op("divine"),
            ]),
        );
        expect(r.steps[0]!.attempts).toEqual({ chance: 1, expected: 0 });
        expect(r.steps.map((s) => s.kind)).toEqual(["until", "operation"]);
        expect(r.unknown).toBe(false);
    });

    it("a Divine Orb leaves the values on a side a metamod protects", () => {
        const c = craft(
            item({
                base: "Iron Ring",
                ilvl: 84,
                rarity: "rare",
                prefixes: ["IncreasedLife1"],
                suffixes: [{ mod: "prefixes cannot be changed", bench: true }],
            }),
            [until(hasValue("IncreasedLife1", ">=", 80), [op("divine")])],
        );
        const loop = report(c).steps[0]!;
        expect(loop.note).toMatch(/cannot end/);
    });

    it("a reforge rolls the value of the modifier it lands within its range", () => {
        // The top life tier with a value of 80 or more is that tier a third of
        // the time: three times the rounds.
        const value = report(
            craft(ring("rare"), [until(hasValue("IncreasedLife1", ">=", 80), [op("chaos")])]),
        ).steps[0]!.attempts!;
        const tier = report(craft(ring("rare"), [until(has("maximum life", 1), [op("chaos")])]))
            .steps[0]!.attempts!;
        expect(value.expected).toBeCloseTo(3 * tier.expected, 6);
    });

    it("a Vaal Orb's four outcomes are each as likely, one of them a reforge", () => {
        // A new implicit, a socket's colour and no effect leave the life; the
        // reforge rolls six modifiers, the life among them now and then.
        const r = report(
            craft(ring("rare", ["IncreasedLife1"], ["FireResist1"]), [
                op("vaal"),
                iff(has("maximum life", 1), [stop()]),
                iff(cmp("suffixCount", "==", 3), [stop()]),
            ]),
        );
        const vaal = r.steps[0];
        const [kept, bricked] = r.steps.filter((s) => s.kind === "if");
        expect(vaal!.note).toBeUndefined();
        expect(kept!.note).toBeUndefined();
        expect(kept!.branch).toBeGreaterThan(3 / 4);
        expect(kept!.branch).toBeLessThan(3 / 4 + 1 / 4);
        // What is left without the life is the reforge, its suffixes full.
        expect(bricked!.branch).toBeCloseTo(1, 9);
    });

    it("a Tainted Exalted Orb is taken at even odds, and its step says so", () => {
        const tainted = { ...op("tainted"), words: ["tainted", "exalt"] };
        const on = (prefixes: string[], suffixes: string[]) =>
            report(
                craft(
                    item({
                        base: "Iron Ring",
                        ilvl: 84,
                        rarity: "rare",
                        prefixes,
                        suffixes,
                        corrupted: true,
                    }),
                    [tainted, iff(has("IncreasedLife1"), [stop()])],
                ),
            );
        // Two modifiers: removed half the time, the life half of those.
        const r = on(["IncreasedLife1"], ["FireResist1"]);
        expect(r.steps[0]!.note).toMatch(/even odds.*no source states/);
        expect(r.steps[1]!.note).toBeUndefined();
        expect(r.steps[1]!.branch).toBeCloseTo(3 / 4, 9);
        // A full item has nothing to add: one of its six goes.
        const full = on(
            ["IncreasedLife1", "IncreasedMana1", "IncreasedArmour1"],
            ["FireResist1", "ColdResist1", "LightningResist1"],
        );
        expect(full.steps[1]!.branch).toBeCloseTo(5 / 6, 9);
    });

    it("the snapshot prices the total in chaos and divine", () => {
        const prices: Prices = {
            league: "Test",
            fetchedAt: "2026-11-09T00:00:00Z",
            chaosPerDivine: 400,
            chaos: new Map([["Chaos Orb", 1]]),
        };
        const c = craft(ring("rare"), [until(has("IncreasedLife1"), [op("chaos")])]);
        const r = report(c, prices);
        expect(r.chaos).toBeCloseTo(r.total[0]!.amount, 9);
        expect(r.divine).toBeCloseTo(r.total[0]!.amount / 400, 9);
        expect(r.unpriced).toEqual([]);
        // An item the snapshot lacks leaves the total unpriced and is named.
        const bare = report(craft(ring("normal"), [op("transmute")]), prices);
        expect(bare.chaos).toBeUndefined();
        expect(bare.unpriced).toEqual(["Orb of Transmutation"]);
    });

    it("a step whose price is not known is reported, not priced", () => {
        const c = craft(ring("rare", ["IncreasedLife1"]), [op("locus")]);
        const r = report(c);
        expect(r.steps[0]!.unit).toBeUndefined();
        expect(r.steps[0]!.note).toContain("no price");
    });

    it("a Harvest reforge is priced in lifeforce, five of them with Crystallised Rancour", () => {
        const unitOf = (tag: string) =>
            report(craft(ring("rare"), [harvest("reforge", tag)])).steps[0]!.unit;
        expect(unitOf("life")).toEqual([{ item: "Wild Crystallised Lifeforce", amount: 75 }]);
        expect(unitOf("mana")).toEqual([
            { item: "Primal Crystallised Lifeforce", amount: 200 },
            { item: "Crystallised Rancour", amount: 2 },
        ]);
        expect(unitOf("drop")).toEqual([
            { item: "Vivid Crystallised Lifeforce", amount: 200 },
            { item: "Crystallised Rancour", amount: 1 },
        ]);
    });

    it("a Bestiary recipe is priced by its beasts", () => {
        const c = craft(ring("magic", ["IncreasedLife1"]), [beast({ kind: "imprint" })]);
        expect(report(c).steps[0]!.unit).toEqual([{ item: "Craicic Croaker", amount: 1 }]);
        const unitOf = (stmt: ReturnType<typeof beast>) =>
            report(craft(ring("rare", ["IncreasedLife1"]), [stmt])).steps[0]!.unit;
        expect(unitOf(beast({ kind: "add", side: "prefix" }))).toEqual([
            { item: "Farric Wolf Alpha", amount: 1 },
        ]);
        expect(unitOf(beast({ kind: "fracture", n: 2 }))).toEqual([
            { item: "Fenumal Plagued Arachnid", amount: 1 },
            { item: "Black Mórrigan", amount: 1 },
        ]);
        expect(unitOf(beast({ kind: "metamod" }))).toEqual([
            { item: "Wild Bristle Matron", amount: 1 },
        ]);
        expect(unitOf(beast({ kind: "aspect", name: "cat" }))).toEqual([
            { item: "Farrul, First of the Plains", amount: 1 },
            { item: "Black Mórrigan", amount: 1 },
        ]);
    });
});

describe("the counts the checker leaves open", () => {
    it("are followed from the roll that left them, not bracketed", () => {
        // After a Chaos Orb the ring holds four to six modifiers; the Exalted
        // Orb's draw is read on each, weighted by the Chaos Orb's odds.
        const c = craft(ring("rare"), [
            op("chaos"),
            op("exalt"),
            iff(has("IncreasedLife1"), [stop()]),
        ]);
        const r = report(c);
        const branch = r.steps.find((s) => s.kind === "if")!;
        expect(branch.branch).toBeGreaterThan(0);
        expect(branch.branch).toBeLessThan(1);
        expect(branch.note).toBeUndefined();
        expect(branch.branchRange).toBeUndefined();
        expect(r.chaosRange).toBeUndefined();
    });

    it("carry a Magic item's one or two modifiers through a Regal Orb into the loop", () => {
        const c = craft(ring("normal"), [
            op("transmute"),
            op("regal"),
            until(has("IncreasedLife1"), [op("annul"), op("exalt")]),
        ]);
        const loop = report(c).steps.find((s) => s.kind === "until")!;
        expect(loop.note).toBeUndefined();
        expect(loop.attemptsRange).toBeUndefined();
        // The chance is per round run: the Orb of Transmutation or the Regal
        // Orb lands the life some of the time, and those attempts take no
        // round, so the rounds fall short of the chance's reciprocal.
        const { chance, expected } = loop.attempts!;
        expect(chance * expected).toBeLessThan(1);
        expect(chance * expected).toBeGreaterThan(0);
    });
});

describe("the eldritch implicits", () => {
    const boots = buildRegistry({
        bases: [BOOTS_BASE],
        mods: [...CATALOG],
        eldritch: ELDRITCH_ROWS,
    });
    const at = (words: string[], tier: string) => {
        const o = op(words[0]!);
        return { ...o, words, args: [{ kind: "word" as const, value: tier, span: o.span }] };
    };
    const on = (decl: Partial<Parameters<typeof item>[0]>, body: Parameters<typeof craft>[1]) => {
        const c = craft(item({ base: "Iron Greaves", ilvl: 100, rarity: "rare", ...decl }), body);
        return costOf(c, check(c, { registry: boots }), boots);
    };

    it("an ember sets the implicit to each of its pool's types by weight", () => {
        // Three Grand Exarch rows of equal weight, one of them life regeneration.
        const r = on({}, [
            at(["ember"], "grand"),
            iff(eldritchP("exarch", "grand", "regenerate"), [stop()]),
        ]);
        const branch = r.steps.find((s) => s.kind === "if")!;
        expect(branch.note).toBeUndefined();
        expect(branch.branch).toBeCloseTo(1 / 3, 9);
    });

    it("a loop entered from a branch the states cannot read keeps the implicits", () => {
        const loop = (pre: Parameters<typeof craft>[1]) =>
            on({ exarch: "greater", eater: "grand" }, [
                ...pre,
                until(eldritchP("exarch", "grand"), [op("conflict")]),
            ]).steps.find((s) => s.kind === "until")!;
        const after = loop([iff(isRarity("rare"), [])]);
        expect(after.note).toBeUndefined();
        expect(after.attempts!.expected).toBeCloseTo(loop([]).attempts!.expected, 9);
    });

    it("an implicit the item block declares without a type is any of its tier's", () => {
        // A condition names an Exarch type; the declared Eater has none.
        const r = on({ eater: "greater" }, [
            at(["ember"], "grand"),
            until(eldritchP("exarch", "grand", "regenerate"), [at(["ember"], "grand")]),
        ]);
        const loop = r.steps.find((s) => s.kind === "until")!;
        expect(loop.note).toBeUndefined();
        expect(loop.attempts!.chance).toBeCloseTo(1 / 3, 9);
    });

    it("an implicit a Vaal Orb may replace is not taken as kept", () => {
        const r = on({ exarch: "greater" }, [op("vaal"), iff(eldritchP("exarch"), [stop()])]);
        expect(r.steps.find((s) => s.kind === "if")!.branch).toBeLessThan(1);
    });

    it("an Orb of Conflict takes a lowered Lesser implicit off and keeps a raised Perfect one", () => {
        const branch = (
            decl: Partial<Parameters<typeof item>[0]>,
            pred: Parameters<typeof iff>[0],
        ) =>
            on(decl, [op("conflict"), iff(pred, [stop()])]).steps.find((s) => s.kind === "if")!
                .branch!;
        // Lesser Exarch, Grand Eater: two tiers behind, the Exarch is lowered
        // off 28 times in a hundred.
        expect(branch({ exarch: "lesser", eater: "grand" }, eldritchP("exarch"))).toBeCloseTo(
            0.72,
            9,
        );
        // Perfect Exarch: raised it stays Perfect, lowered it is Exquisite.
        expect(
            branch({ exarch: "perfect", eater: "grand" }, eldritchP("exarch", "perfect")),
        ).toBeCloseTo(0.17, 9);
        // Five tiers ahead the line would go below nothing: the floor holds.
        expect(
            branch({ exarch: "perfect", eater: "lesser" }, eldritchP("exarch", "perfect")),
        ).toBeCloseTo(0.01, 9);
    });

    it("an Eldritch Chaos Orb fills the rerolled side when its count asks for more", () => {
        // Four to six modifiers with the kept suffix among them is three to
        // five prefixes, and the side holds three: every count lands on three.
        const r = on(
            { exarch: "lesser", prefixes: ["IncreasedLife1"], suffixes: ["FireResist1"] },
            [
                { ...op("eldritch"), words: ["eldritch", "chaos"] },
                iff(cmp("prefixCount", "==", 3), [stop()]),
            ],
        );
        expect(r.steps.find((s) => s.kind === "if")!.branch).toBeCloseTo(1, 9);
        // With two suffixes kept the counts are two, three and three again,
        // and no share of them is lost.
        const two = on(
            {
                exarch: "lesser",
                prefixes: ["IncreasedLife1"],
                suffixes: ["FireResist1", "ColdResist1"],
            },
            [
                { ...op("eldritch"), words: ["eldritch", "chaos"] },
                iff(cmp("prefixCount", "==", 2), [stop()]),
                iff(cmp("prefixCount", "==", 3), [stop()]),
            ],
        );
        const [low, high] = two.steps.filter((s) => s.kind === "if");
        expect(low!.branch).toBeCloseTo(8 / 12, 9);
        expect(high!.branch).toBeCloseTo(1, 9);
        expect(two.stopped).toBeCloseTo(1, 9);
    });

    it("a method that does not touch the implicits leaves them as they were", () => {
        const r = on({ exarch: "greater" }, [
            op("chaos"),
            iff(eldritchP("exarch", "greater"), [stop()]),
        ]);
        const branch = r.steps.find((s) => s.kind === "if")!;
        expect(branch.note).toBeUndefined();
        expect(branch.branch).toBeCloseTo(1, 9);
    });

    it("an Orb of Conflict favours the implicit that is behind, eleven hundredths a tier", () => {
        // Equal tiers rise alike (Orb of Conflict § Mechanics).
        const even = on({ exarch: "grand", eater: "grand" }, [
            op("conflict"),
            iff(eldritchP("exarch", "exceptional"), [stop()]),
        ]);
        expect(even.steps.find((s) => s.kind === "if")!.branch).toBeCloseTo(1 / 2, 9);
        // Greater Exarch, Grand Eater: the Exarch, a tier behind, rises to
        // Grand 61 times in a hundred; else the Eater rises, dominant.
        const r = on({ exarch: "greater", eater: "grand" }, [
            op("conflict"),
            iff(eldritchP("exarch", "grand"), [op("conflict")]),
            iff(dominantP("eater"), [stop()]),
        ]);
        const [raised, dominant] = r.steps.filter((s) => s.kind === "if");
        expect(raised!.branch).toBeCloseTo(0.61, 9);
        // From Grand Exarch, Greater Eater, a second Conflict raises the
        // Eater, now behind, 61 times in a hundred: dominant again.
        expect(dominant!.note).toBeUndefined();
        expect(dominant!.branch).toBeCloseTo(0.39 + 0.61 * 0.61, 9);
    });
});
