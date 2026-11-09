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
    has,
    hasValue,
    iff,
    item,
    notp,
    op,
    orp,
    restart,
    stop,
    until,
} from "../__fixtures__/ast.js";
import { BENCH_LIFE_ROW, CATALOG, LIFE_T1, RING_BASE } from "../__fixtures__/mods.js";
import { allAmongFirst } from "./race.js";
import { costOf } from "./report.js";
import type { Prices } from "./prices.js";

const registry = buildRegistry({
    bases: [RING_BASE],
    mods: [...CATALOG, BENCH_LIFE_ROW],
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
        const c = craft(ring("magic", ["IncreasedLife1"]), [beast({ kind: "imprint" })]);
        const r = report(c);
        expect(r.steps[0]!.unit).toBeUndefined();
        expect(r.steps[0]!.note).toContain("no price");
    });
});
