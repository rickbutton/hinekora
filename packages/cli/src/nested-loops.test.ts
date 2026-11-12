import { describe, expect, it, vi } from "vitest";
import { check, type Craft } from "@hinekora/core";
import { loadDefaultPoe1, registryOf } from "@hinekora/data";
import { parse } from "@hinekora/parser";

// The exact checker over the real catalogue builds a universe of its own for
// each craft: seconds on a loaded machine.
vi.setConfig({ testTimeout: 60_000 });

const registry = registryOf(loadDefaultPoe1());

function parsed(source: string): Craft {
    const r = parse(source);
    if (!r.ok) throw new Error(r.error.message);
    return r.craft;
}

const ITEM = `item { base: "Iron Ring"  ilvl: 84  rarity: rare  suffixes: [ "fire resistance" t1 ] }`;
const INNER = `until has "maximum life" {
    if has "maximum mana" { chaos }
}`;

describe("a loop inside a loop, on the real catalogue", () => {
    it("is refused where the item can never leave the inner loop", () => {
        const craft = parsed(`${ITEM}
until has "maximum life" t1 {
    ${INNER}
    chaos
}`);
        const r = check(craft, { registry });
        expect(r.ok).toBe(false);
        // No item gets past the outer loop but by the recovery after the error.
        const strict = check(craft, { registry }, { strict: true });
        expect(strict.finalState === undefined).toBe(true);
        const exits = r.diagnostics.filter((d) => d.message.startsWith("this loop can never exit"));
        // The outer loop's head holds the first item alone, which never
        // leaves the inner loop: both loops are reported.
        expect(exits.map((d) => d.message)).toEqual([
            'this loop can never exit: has "maximum life" t1 can never become true here',
            'this loop can never exit: has "maximum life" can never become true here',
        ]);
    });

    it("refuses the inner loop alone", () => {
        const r = check(parsed(`${ITEM}\n${INNER}`), { registry });
        expect(r.diagnostics.map((d) => d.message)).toEqual([
            'this loop can never exit: has "maximum life" can never become true here',
            `the 'if' branch can never run: has "maximum mana" is impossible here`,
        ]);
    });
});
