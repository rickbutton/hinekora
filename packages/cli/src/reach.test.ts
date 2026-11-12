import { describe, expect, it } from "vitest";
import {
    check,
    type CheckResult,
    METHODS,
    type Method,
    REACH,
    type TraceEntry,
} from "@hinekora/core";
import { parse } from "@hinekora/parser";
import { loadDefaultPoe1, registryOf } from "@hinekora/data";

// The checker builds its universe from the rows the craft's steps can lay. A
// step whose rows it leaves out would make it refuse or drop items the game
// makes; the same craft beside a def that uses every method, never called,
// is checked over every row, and must say the same.
const registry = registryOf(loadDefaultPoe1());

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
            case "names":
                return s.kind === "name" && s.optional === true ? [] : ['"maximum life"'];
        }
    });
    return [...m.words, ...args].join(" ");
}

const EVERY_METHOD = `def everyMethod() {\n${METHODS.map((m) => `    ${statement(m)}`).join("\n")}\n}\n`;
/** The lines the def adds before the steps. */
const lines = EVERY_METHOD.split("\n").length - 1;

const block = (base: string, rarity: string, ...rest: string[]): string =>
    [`base: "${base}"`, "ilvl: 84", `rarity: ${rarity}`, ...rest].join("\n    ");

const RING = block(
    "Iron Ring",
    "rare",
    'prefixes: [ "random" ]',
    'suffixes: [ "random", "random" ]',
);
const BOW = block("Thicket Bow", "rare", 'prefixes: [ "random" ]');
const GAUNTLETS = block(
    "Titan Gauntlets",
    "rare",
    'prefixes: [ "maximum life" t1 ]',
    'suffixes: [ "fire resistance" t1, "random" ]',
);
const PLATE = block("Astral Plate", "normal");
const REGALIA = block(
    "Vaal Regalia",
    "rare",
    'prefixes: [ "maximum energy shield" t1, "random" ]',
    'suffixes: [ "intelligence" t1, "fire resistance" t1, "random" ]',
);

/** A craft per method that can put on rows beyond the natural pool (`REACH`),
 *  on an item it takes, and a condition after it whose two arms are both
 *  live. */
const CASES: readonly (readonly [string, readonly string[], string])[] = [
    [RING, ["chaos"], 'has "maximum life" or suffixCount >= 2'],
    [BOW, ["exalt", "annul"], "prefixCount == 1"],
    [RING, ['bench "prefixes cannot be changed"', "chaos"], 'has "fire resistance"'],
    [
        block("Iron Ring", "rare", 'prefixes: [ "maximum mana" t1 ]', 'suffixes: [ "random" ]'),
        ['bench "maximum life"'],
        'has "fire resistance"',
    ],
    [RING, ["beast metamod"], 'has "fire resistance"'],
    [GAUNTLETS, ['beast aspect "cat"'], 'has "cold resistance"'],
    // Each with a row of its own: Deafening Greed's on gloves, Glyphic's
    // corrupted essence rows.
    [block("Titan Gauntlets", "normal"), ['essence "greed" t1'], 'has "fire resistance"'],
    [PLATE, ['fossil "glyphic"'], 'has "fire resistance"'],
    // The Hollow Fossil's forced abyssal socket, a row only a fossil lays; the
    // Fractured Fossil fractures one of the rows it rolls.
    [block("Titan Gauntlets", "normal"), ['fossil "hollow"'], 'has "fire resistance"'],
    [block("Titan Gauntlets", "normal"), ['fossil "fractured"'], 'has "fire resistance"'],
    [BOW, ["veiled chaos"], "suffixCount >= 2"],
    [REGALIA, ["veiled exalt"], 'has "cold resistance"'],
    // An unveil needs a veiled modifier, which only a veiled step puts on, and
    // that step reaches the same rows: no craft checks clean on `unveil`'s
    // entry alone.
    [BOW, ["veiled chaos", "unveil"], "suffixCount >= 2"],
    [
        block(
            "Titan Gauntlets",
            "rare",
            'prefixes: [ "maximum life" t1, "chance to impale" t1 ]',
            'suffixes: [ "increased dexterity" t1, "fire resistance" t1 ]',
            "influences: hunter",
        ),
        ["dominance"],
        "prefixCount == 2",
    ],
    [
        block(
            "Sorcerer Boots",
            "rare",
            'prefixes: [ "maximum energy shield" t1, "random" ]',
            'suffixes: [ "intelligence" t1, "random" ]',
        ),
        ["fracture"],
        'has "fire resistance"',
    ],
    [
        block(
            "Black Maw Talisman",
            "rare",
            'prefixes: [ "maximum life" t1, "random" ]',
            'suffixes: [ "strength" t1, "random" ]',
        ),
        ["beast fracture"],
        'has "fire resistance"',
    ],
    [
        block(
            "Ruby Ring",
            "rare",
            'prefixes: [ "random" ]',
            'suffixes: [ "ColdDamagePercentEssence7", "fire resistance" t1 ]',
        ),
        // An essence's row, which no step here lays, changed into its twin.
        ['harvest change "cold damage" "fire damage"'],
        'has "maximum life"',
    ],
    [
        block(
            "Sorcerer Boots",
            "rare",
            'prefixes: [ "random" ]',
            'suffixes: [ "random" ]',
            "exarch: lesser",
            "eater: grand",
        ),
        ["eldritch chaos"],
        'has "maximum life" or suffixCount >= 2',
    ],
];

const craftOf = (item: string, steps: readonly string[], condition: string, defs = ""): string =>
    `item {\n    ${item}\n}\n${defs}${steps.join("\n")}\nif ${condition} {\n    divine\n} else {\n    scour\n}\n`;

function checked(source: string): CheckResult {
    const parsed = parse(source);
    if (!parsed.ok) throw new Error(`${parsed.error.message}\n${source}`);
    return check(parsed.craft, { registry });
}

/** Each traced statement's items, counted, calls' bodies within. */
function itemCounts(trace: readonly TraceEntry[]): string[] {
    return trace.flatMap((e) => [
        `${e.kind}: ${e.before.u.dd.count(e.before.dd)} -> ${e.after === undefined ? "-" : e.before.u.dd.count(e.after.dd)}`,
        ...itemCounts(e.inlined?.trace ?? []),
    ]);
}

describe("a craft checked over the rows it reaches", () => {
    it("has a case for each method that reaches beyond the natural pool", () => {
        const steps = CASES.flatMap(([, s]) => s);
        for (const words of Object.keys(REACH)) {
            expect(
                steps.some((s) => s === words || s.startsWith(`${words} `)),
                words,
            ).toBe(true);
        }
    });

    for (const [item, steps, condition] of CASES) {
        const where = craftOf(item, steps, condition);
        it(`agrees with every row: ${steps.join(", ")}`, { timeout: 120_000 }, () => {
            const trimmed = checked(where);
            const wide = checked(craftOf(item, steps, condition, EVERY_METHOD));
            expect(
                trimmed.diagnostics.map((d) => d.message),
                where,
            ).toEqual([]);
            expect(trimmed.ok, where).toBe(true);
            const size = (r: CheckResult): number =>
                r.trace[0]!.before.u.dd.domains.reduce((a, b) => a + b, 0);
            expect(size(wide), where).toBeGreaterThan(size(trimmed));
            // The def sits between the block and the steps: the same
            // statements, the lines it takes further down.
            const said = (r: CheckResult): string[] =>
                r.diagnostics.map(
                    (d) => `${d.span.start.line - (r === wide ? lines : 0)}: ${d.message}`,
                );
            expect(said(wide), where).toEqual(said(trimmed));
            expect(wide.ok, where).toBe(trimmed.ok);
            expect(itemCounts(wide.trace), where).toEqual(itemCounts(trimmed.trace));
        });
    }
});
