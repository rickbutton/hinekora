import { describe, expect, it } from "vitest";
import { check, type CheckResult, METHODS, type Method, type TraceEntry } from "@hinekora/core";
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

const ITEMS: readonly string[] = [
    'base: "Iron Ring"\n    ilvl: 84\n    rarity: rare\n    prefixes: [ "random" ]\n    suffixes: [ "random", "random" ]',
    'base: "Titan Greaves"\n    ilvl: 84\n    rarity: rare\n    influences: hunter\n    prefixes: [ "maximum life" t1 ]\n    suffixes: [ "fire resistance" t1, "random" ]',
    'base: "Thicket Bow"\n    ilvl: 84\n    rarity: magic\n    prefixes: [ "random" ]',
    'base: "Sorcerer Boots"\n    ilvl: 84\n    rarity: rare\n    prefixes: [ "random" ]\n    suffixes: [ "random" ]\n    exarch: lesser\n    eater: grand',
];

const STEPS: readonly (readonly string[])[] = [
    ["chaos"],
    ["exalt", "annul"],
    ['essence "greed"'],
    ['fossil "pristine"'],
    ['harvest change "fire resistance" "cold resistance"'],
    ['bench "prefixes cannot be changed"', "chaos"],
    ["beast add prefix"],
    ["eldritch chaos"],
    ["vaal"],
    ["veiled chaos"],
];

const craftOf = (item: string, steps: readonly string[], defs = ""): string =>
    `item {\n    ${item}\n}\n${defs}${steps.join("\n")}\nif has "maximum life" or suffixCount >= 2 {\n    divine\n} else {\n    scour\n}\n`;

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
    for (const [i, item] of ITEMS.entries()) {
        it(`agrees with every row on item ${i + 1}`, { timeout: 120_000 }, () => {
            for (const steps of STEPS) {
                const trimmed = checked(craftOf(item, steps));
                const wide = checked(craftOf(item, steps, EVERY_METHOD));
                const where = craftOf(item, steps);
                const size = (r: CheckResult): number =>
                    r.trace[0]!.before.u.dd.domains.reduce((a, b) => a + b, 0);
                expect(size(wide), where).toBeGreaterThan(size(trimmed));
                // The def sits between the block and the steps: the same
                // statements, the lines it takes further down.
                const said = (r: CheckResult): string[] =>
                    r.diagnostics.map(
                        (d) => `${d.span.start.line - (r === wide ? lines : 0)}: ${d.message}`,
                    );
                expect(said(trimmed), where).toEqual(said(wide));
                expect(trimmed.ok, where).toBe(wide.ok);
                expect(itemCounts(trimmed.trace), where).toEqual(itemCounts(wide.trace));
            }
        });
    }
});
