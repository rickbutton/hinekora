import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
    check,
    type CheckResult,
    costOf,
    guaranteedTypes,
    type CostReport,
    type Craft,
    METHODS,
    type Method,
    type Stmt,
} from "@hinekora/core";
import { parse } from "@hinekora/parser";
import { loadDefaultPoe1, registryOf } from "@hinekora/data";

// The cost layer is an estimate beside the checker: it must cost any craft the
// checker reads, refused steps and ill-formed items among them, and never say a
// branch the checker finds open is taken always or never.
const registry = registryOf(loadDefaultPoe1());

/** Stand-in names for each kind of name slot, from the bundled data. */
const NAMES: Readonly<Record<string, string>> = {
    mod: "maximum life",
    essence: "greed",
    bench: "maximum life",
    tag: "life",
    aspect: "cat",
    fossil: "pristine",
};

/** The method's statement with a stand-in for each argument it needs. */
function statement(m: Method): string {
    const args = m.args.flatMap((s): string[] => {
        switch (s.kind) {
            case "int":
            case "tier":
                return s.optional === true ? [] : [s.kind === "tier" ? "t1" : "1"];
            case "word":
                return [s.oneOf[0]!];
            case "name":
                return s.optional === true ? [] : [`"${NAMES[s.of] ?? "fire resistance"}"`];
            case "names":
                return [`"${NAMES[s.of] ?? "x"}"`];
        }
    });
    return [...m.words, ...args].join(" ");
}

/** Item blocks of the wrong rarity for many methods, and over-full ones. */
const ITEMS: readonly string[] = [
    'base: "Iron Ring"\n    ilvl: 84\n    rarity: normal',
    'base: "Iron Ring"\n    ilvl: 84\n    rarity: magic\n    prefixes: [ "random" ]',
    'base: "Iron Ring"\n    ilvl: 84\n    rarity: rare\n    prefixes: [ "random", "random" ]\n    suffixes: [ "random", "random" ]',
    'base: "Iron Ring"\n    ilvl: 84\n    rarity: magic\n    prefixes: [ "random", "random" ]\n    suffixes: [ "random", "random" ]',
    'base: "Iron Ring"\n    ilvl: 84\n    rarity: rare\n    prefixes: [ "random", "random", "random", "random" ]\n    suffixes: [ "random", "random", "random" ]',
    'base: "Quicksilver Flask"\n    ilvl: 84\n    rarity: normal',
    'base: "Titan Greaves"\n    ilvl: 84\n    rarity: rare\n    influences: hunter\n    prefixes: [ "maximum life" t1, "random", "random", "random" ]\n    suffixes: [ "fire resistance" t1 ]',
    'base: "Thicket Bow"\n    ilvl: 84\n    rarity: rare\n    prefixes: [ "random" ]\n    suffixes: [ "random" ]',
    'base: "Titan Greaves"\n    ilvl: 84\n    rarity: rare\n    prefixes: [ fractured "movement speed" t1 ]\n    suffixes: [ "random" ]',
];

/** Conditions asked after the step; each `if` has an `else`, so the check
 *  says which arm, if either, can never run. */
const CONDITIONS: readonly string[] = [
    'has "maximum life"',
    "prefixCount <= 1",
    'has "fire resistance" or suffixCount >= 2',
    "not isRare",
];

const crafted = (item: string, steps: readonly string[], condition: string): string =>
    `item {\n    ${item}\n}\n\n${steps.join("\n")}\nif ${condition} {\n    divine\n} else {\n    scour\n}\n`;

/** The craft checked and costed; each `if` of its top level given an empty
 *  `else` where it has none, so the check says whether that arm is dead. */
function costed(source: string): { craft: Craft; result: CheckResult; report: CostReport } {
    const parsed = parse(source);
    if (!parsed.ok) throw new Error(`${parsed.error.message}\n${source}`);
    const body = parsed.craft.body.map((s): Stmt =>
        s.kind === "if" && s.elseBody === undefined ? { ...s, elseBody: [] } : s,
    );
    const craft: Craft = { ...parsed.craft, body };
    const result = check(craft, { registry });
    return { craft, result, report: costOf(craft, result, registry) };
}

/** Every `if` of the craft's top level whose two arms the check finds live
 *  is costed strictly between never and always. */
function branchesAgree(source: string): void {
    const { craft, result, report } = costed(source);
    if (report.failed !== undefined || report.unjudged === true) return;
    const dead = new Set(
        result.findings
            .filter((f) => f.kind === "deadIf" || f.kind === "deadElse")
            .map((f) => f.span.start.offset),
    );
    const ifs = craft.body.filter((s): s is Extract<Stmt, { kind: "if" }> => s.kind === "if");
    for (const stmt of ifs) {
        if (dead.has(stmt.pred.span.start.offset)) continue;
        const step = report.steps.find(
            (s) => s.kind === "if" && s.span.start.offset === stmt.span.start.offset,
        );
        if (step?.branch === undefined || step.unknown === true || step.reached === 0) continue;
        expect(step.branch, source).toBeGreaterThan(0);
        expect(step.branch, source).toBeLessThan(1);
    }
}

describe("the cost of any craft the check reads", () => {
    for (const [i, item] of ITEMS.entries()) {
        it(`costs every method on item ${i + 1} without failing`, { timeout: 120_000 }, () => {
            for (const m of METHODS) {
                const source = crafted(item, [statement(m)], CONDITIONS[i % CONDITIONS.length]!);
                const { report } = costed(source);
                expect(report.failed, source).toBeUndefined();
            }
        });
    }

    it("costs a refused step from what the check goes on from", () => {
        const crafts = [
            crafted(ITEMS[2]!, ["transmute"], CONDITIONS[0]!),
            crafted(ITEMS[5]!, ["alchemy"], CONDITIONS[0]!),
            crafted(
                'base: "Titan Greaves"\n    ilvl: 84\n    rarity: rare\n    prefixes: [ "maximum life" t1, "random", "random", "random" ]\n    suffixes: [ "fire resistance" t1 ]',
                ["locus"],
                CONDITIONS[0]!,
            ),
        ];
        for (const source of crafts) {
            const { result, report } = costed(source);
            expect(result.ok, source).toBe(false);
            expect(report.failed, source).toBeUndefined();
            expect(report.steps.length, source).toBeGreaterThan(0);
        }
    });
});

describe("the Corruption Altar on an item that takes no influence", () => {
    // A fractured item or one with an eldritch implicit takes no influence
    // (Fractured item § Mechanics; Influenced item § Mechanics), so its reforge
    // leaves it uninfluenced in the cost walk as in the check, and the step
    // claims nothing of which influence it gives.
    const altar = (item: string) => costed(`item {\n    ${item}\n}\n\nlocus\n`);
    const greaves = (...lines: string[]): string =>
        [
            'base: "Titan Greaves"',
            "ilvl: 84",
            "rarity: rare",
            ...lines,
            'prefixes: [ "maximum life" t1 ]',
            'suffixes: [ "random" ]',
        ].join("\n    ");
    const influenceNote = (report: CostReport) =>
        report.steps.some((s) => s.note?.includes("each of the six influences") === true);

    it("is costed as the check reads it", () => {
        for (const item of [ITEMS[8]!, greaves("exarch: grand")]) {
            const { result, report } = altar(item);
            expect(result.ok, item).toBe(true);
            expect(report.failed, item).toBeUndefined();
            expect(report.unjudged, item).toBeUndefined();
            expect(influenceNote(report), item).toBe(false);
        }
    });

    it("says which influence it gives only where the item can take one", () => {
        expect(influenceNote(altar(greaves()).report)).toBe(true);
    });
});

describe("an unnamed modifier of a real base", () => {
    // The tracker takes an unnamed modifier for a type of its own only where
    // the catalogue leaves it one; on a real base it never does, so no
    // example's figure rests on that.
    it("is never down to one type in the examples or on the site", () => {
        const root = join(import.meta.dirname, "../../..");
        for (const dir of ["examples", "examples/future", "site/examples", "site/examples/ops"]) {
            for (const f of readdirSync(join(root, dir)).filter((x) => x.endsWith(".craft"))) {
                const parsed = parse(readFileSync(join(root, dir, f), "utf8"));
                if (!parsed.ok) continue;
                const first = check(parsed.craft, { registry }).trace[0]?.before;
                if (first === undefined) continue;
                const { prefixes, suffixes } = parsed.craft.item;
                const named = [...prefixes, ...suffixes].filter((a) => a.mod !== "random");
                expect(guaranteedTypes(first).size, `${dir}/${f}`).toBeLessThanOrEqual(
                    named.length,
                );
            }
        }
    }, 120_000);
});

describe("a branch the check finds open", () => {
    const steps: readonly (readonly string[])[] = [
        ["chaos"],
        ["exalt"],
        ["annul"],
        ["alchemy"],
        ["transmute", "augment"],
        ['bench "chaos damage over time multiplier"', "beast add prefix"],
        ['bench "maximum life"', "annul"],
        ["fracture"],
        ['essence "greed"'],
        ["vaal"],
        ['bench "prefixes cannot be changed"', "vaal"],
        ["locus"],
        ["vaal", "tainted exalt"],
        ["vaal", "tainted chaos"],
    ];
    for (const [i, item] of ITEMS.entries()) {
        it(
            `is never costed as always or never taken, on item ${i + 1}`,
            { timeout: 120_000 },
            () => {
                for (const s of steps) {
                    for (const c of CONDITIONS) branchesAgree(crafted(item, s, c));
                }
            },
        );
    }

    it("on a Thicket Bow whose crafted suffix a beast may take is taken half the time", () => {
        const source = crafted(
            ITEMS[7]!,
            ['bench "chaos damage over time multiplier"', "beast add prefix"],
            'has "chaos damage over time multiplier"',
        );
        const { report } = costed(source);
        const branch = report.steps.find((s) => s.kind === "if")!;
        // The beast takes one of the two suffixes alike (QUESTIONS.md Q61).
        expect(branch.note).toBeUndefined();
        expect(branch.branch).toBeCloseTo(1 / 2, 9);
    });

    it("after a Vaal Orb, whose reforge the walk reads its own way", () => {
        const cases: readonly [string, readonly string[], string][] = [
            [
                'base: "Titan Greaves"\n    ilvl: 84\n    rarity: magic',
                ['bench "prefixes cannot be changed"', "vaal"],
                "not suffixCount == 0",
            ],
            [
                'base: "Vaal Regalia"\n    ilvl: 84\n    rarity: rare\n    suffixes: [ "intelligence" t3 ]',
                ["exalt hunter", "vaal"],
                'has "intelligence" t1 and influenced',
            ],
        ];
        for (const [item, steps, condition] of cases) {
            const source = crafted(item, steps, condition);
            branchesAgree(source);
            const { report } = costed(source);
            expect(report.steps.find((s) => s.kind === "if")?.branch, source).toBe(1 / 2);
        }
    });

    it("in the examples and on the site", () => {
        const root = join(import.meta.dirname, "../../..");
        for (const dir of ["examples", "examples/future", "site/examples", "site/examples/ops"]) {
            for (const f of readdirSync(join(root, dir)).filter((x) => x.endsWith(".craft"))) {
                const source = readFileSync(join(root, dir, f), "utf8");
                if (parse(source).ok) branchesAgree(source);
            }
        }
    }, 120_000);
});
