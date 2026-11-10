import { describe, expect, it } from "vitest";
import { check } from "../check/check.js";
import { buildRegistry } from "../resolve/registry.js";
import { pool } from "../pool/pool.js";
import { emptyItem } from "../model/item.js";
import {
    andp,
    beast,
    cmp,
    craft,
    donor,
    harvest,
    has,
    hasValue,
    iff,
    item,
    notp,
    op,
    orp,
    recombine,
    restart,
    stop,
    until,
} from "../__fixtures__/ast.js";
import {
    BENCH_LIFE_ROW,
    CATALOG,
    LIFE_T1,
    PROTECT_PREFIXES_CARRIER,
    RING_BASE,
} from "../__fixtures__/mods.js";
import { allAmongFirst } from "./race.js";
import { costOf } from "./report.js";
import type { Prices } from "./prices.js";

const registry = buildRegistry({
    bases: [RING_BASE],
    mods: [...CATALOG, BENCH_LIFE_ROW, PROTECT_PREFIXES_CARRIER],
    baseAliases: { "Iron Ring": "IronRing" },
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
        const prefixes = side("prefix");
        const life = prefixes.types.indexOf(LIFE_T1.type);
        // The annul before it may take any of the five; the exalt then draws
        // from whichever side has room, so the chance lies below a prefix-only
        // draw's and above nothing.
        expect(loop.attempts!.chance).toBeGreaterThan(0);
        expect(loop.attempts!.chance).toBeLessThanOrEqual(
            allAmongFirst(prefixes.weights, [life], 1) + 1e-9,
        );
        expect(loop.attempts!.expected).toBeCloseTo(1 / loop.attempts!.chance, 9);
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

    it("a make-room loop annuls until a slot is open, restarting when the kept modifier goes", () => {
        const c = craft(
            ring(
                "rare",
                ["IncreasedLife1", "IncreasedMana1", "IncreasedArmour1"],
                ["FireResist1", "ColdResist1", "LightningResist1"],
            ),
            [
                until(cmp("prefixCount", "<=", 2), [
                    op("annul"),
                    iff(notp(has("IncreasedLife1")), [restart()]),
                ]),
            ],
        );
        const r = report(c);
        const loop = r.steps.find((s) => s.kind === "until")!;
        const annul = r.steps.find((s) => s.kind === "operation")!;
        const guard = r.steps.find((s) => s.kind === "if")!;
        // Each round takes a prefix with chance one half, the life among them
        // one in six: more than one round, a restart now and then.
        expect(loop.attempts!.expected).toBeGreaterThan(1);
        expect(annul.runs).toBeCloseTo(loop.attempts!.expected, 9);
        expect(guard.branch).toBeGreaterThan(0.1);
        expect(guard.branch).toBeLessThan(0.3);
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
        // A make-room loop, then a loop that exalts until two suffixes are back:
        // the second is solved from the first's exits, not from a guess.
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

    it("a branch on a modifier no solved loop named reads the item, not its states", () => {
        const c = craft(
            ring(
                "rare",
                ["IncreasedLife1", "IncreasedMana1", "IncreasedArmour1"],
                ["FireResist1", "ColdResist1", "LightningResist1"],
            ),
            [until(cmp("prefixCount", "<=", 2), [op("annul")]), iff(has("maximum life"), [stop()])],
        );
        // The annuls may have taken the life; the walk cannot say how likely.
        const branch = report(c).steps.find((s) => s.kind === "if")!;
        expect(branch.note).toBeDefined();
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

    it("a Divine Orb reaches a value by the share of the range at or above it", () => {
        // LIFE_T1 rolls 70–84: fifteen values, five of them 80 or more.
        const c = craft(ring("rare", ["IncreasedLife1"]), [
            until(hasValue("IncreasedLife1", ">=", 80), [op("divine")]),
        ]);
        const r = report(c);
        expect(r.steps[0]!.attempts!.chance).toBeCloseTo(5 / 15, 9);
        expect(r.steps[0]!.attempts!.expected).toBeCloseTo(3, 9);
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

    it("the grove's likely reforges cost 200 Wild lifeforce", () => {
        const c = craft(ring("rare", ["IncreasedLife1"]), [harvest("reforge", "more likely")]);
        expect(report(c).steps[0]!.unit).toEqual([
            { item: "Wild Crystallised Lifeforce", amount: 200 },
        ]);
    });
});

describe("the spread over the item's unnamed modifiers", () => {
    it("brackets an add onto an item whose counts the checker left open", () => {
        // After a Chaos Orb the ring holds four to six modifiers: on the
        // emptiest the Exalted Orb draws into the open slots, on the fullest it
        // finds none and the Chaos Orb's roll is what the condition reads.
        const c = craft(ring("rare"), [
            op("chaos"),
            op("exalt"),
            iff(has("IncreasedLife1"), [stop()]),
        ]);
        const r = report(c);
        const branch = r.steps.find((s) => s.kind === "if")!;
        expect(branch.branch).toBeGreaterThan(0);
        expect(branch.branchRange).toBeDefined();
        expect(branch.branchRange!.low).toBeLessThan(branch.branchRange!.high);
        expect(branch.branch).toBeGreaterThanOrEqual(branch.branchRange!.low - 1e-9);
        expect(branch.branch).toBeLessThanOrEqual(branch.branchRange!.high + 1e-9);
        // A reforge leaves nothing open: no spread on its loop.
        const loop = report(craft(ring("rare"), [until(has("IncreasedLife1"), [op("chaos")])]));
        expect(loop.steps[0]!.attemptsRange).toBeUndefined();
        expect(loop.chaosRange).toBeUndefined();
    });

    it("reads the fullest item within what it can hold", () => {
        // A Magic ring after a Regal Orb holds two or three modifiers, each side
        // up to two: the fullest item is three, not two and two, so an Exalted
        // Orb still finds a slot and its loop keeps a finite spread.
        const c = craft(ring("normal"), [
            op("transmute"),
            op("regal"),
            until(has("IncreasedLife1"), [op("annul"), op("exalt")]),
        ]);
        const loop = report(c).steps.find((s) => s.kind === "until")!;
        expect(loop.attempts!.expected).toBeGreaterThan(0);
        expect(loop.attemptsRange).toBeDefined();
        expect(loop.attemptsRange!.high).toBeLessThan(20 * loop.attempts!.expected);
        // The chance is per round run: the Regal Orb lands the life some of
        // the time, and those attempts take no round, so the rounds fall short
        // of the chance's reciprocal.
        const { chance, expected } = loop.attempts!;
        expect(chance * expected).toBeLessThan(1);
        expect(chance * expected).toBeGreaterThan(0);
        expect(loop.chanceRange).toBeDefined();
        expect(chance).toBeGreaterThanOrEqual(loop.chanceRange!.low - 1e-12);
        expect(chance).toBeLessThanOrEqual(loop.chanceRange!.high + 1e-12);
    });
});

describe("the Recombinator", () => {
    it("keeps a named prefix by the count table and the weighted pick", () => {
        // Two prefixes pooled, one from each item: the result keeps one (66.7%)
        // or both (33.3%); with one kept, the life is picked by weight share.
        const c = craft(
            ring("rare", ["IncreasedLife1"]),
            [recombine("d"), iff(has("IncreasedLife1"), [stop()])],
            [],
            [],
            [donor("d", ring("rare", ["IncreasedMana1"]))],
        );
        const r = report(c);
        const branch = r.steps.find((s) => s.kind === "if")!;
        const prefixes = side("prefix");
        const w = (type: string) => prefixes.weights[prefixes.types.indexOf(type)]!;
        const share = w(LIFE_T1.type) / (w(LIFE_T1.type) + w("IncreasedMana"));
        expect(branch.branch).toBeCloseTo(0.333 + 0.667 * share, 6);
        // The Recombinator's gold and dust are not in the snapshot.
        expect(r.steps[0]!.unit).toBeUndefined();
    });

    it("recombining until both modifiers sit on one item is judged on the item as found", () => {
        // Each attempt pools the two prefixes; both survive when two are kept.
        const c = craft(
            ring("rare", ["IncreasedLife1"]),
            [until(andp(has("IncreasedLife1"), has("IncreasedMana1")), [recombine("d")])],
            [],
            [],
            [donor("d", ring("rare", ["IncreasedMana1"]))],
        );
        const loop = report(c).steps.find((s) => s.kind === "until")!;
        expect(loop.attempts!.chance).toBeCloseTo(0.333, 6);
        expect(loop.note).toBeUndefined();
    });
});
