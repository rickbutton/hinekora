import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import * as v8 from "node:v8";
import * as vm from "node:vm";
import { describe, expect, it, vi } from "vitest";
import { check, counts, type Craft } from "@hinekora/core";
import { loadDefaultPoe1, registryOf } from "@hinekora/data";
import { parse } from "@hinekora/parser";

// The checker runs over every craft the repository shows, again and again
// for its memory: seconds each on a loaded machine.
vi.setConfig({ testTimeout: 120_000 });

const registry = registryOf(loadDefaultPoe1());
const root = join(import.meta.dirname, "../../..");

function parsed(source: string): Craft {
    const r = parse(source);
    if (!r.ok) throw new Error(r.error.message);
    return r.craft;
}

/** The site's pages and their generated parts, which hold no craft of their own. */
const SKIP = new Set(["node_modules", "public", "operations", ".vitepress", "scripts", "dist"]);

function walk(dir: string, ext: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
        if (SKIP.has(name)) continue;
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p, ext, out);
        else if (p.endsWith(ext)) out.push(p);
    }
    return out;
}

/** Every craft the repository shows: the examples, the site's craft files and
 *  the `hinekora` blocks of its pages that are whole crafts, read as
 *  site/scripts/check-examples.mjs reads them. */
function corpus(): { name: string; source: string }[] {
    const out: { name: string; source: string }[] = [];
    const name = (p: string): string => relative(root, p).replace(/\\/g, "/");
    const examples = join(root, "examples");
    for (const f of readdirSync(examples).filter((f) => f.endsWith(".craft"))) {
        out.push({ name: `examples/${f}`, source: readFileSync(join(examples, f), "utf8") });
    }
    const site = join(root, "site");
    for (const f of walk(join(site, "examples"), ".craft")) {
        out.push({ name: name(f), source: readFileSync(f, "utf8") });
    }
    for (const f of walk(site, ".md")) {
        const lines = readFileSync(f, "utf8").replace(/\r/g, "").split("\n");
        for (let i = 0; i < lines.length; i++) {
            if (!/^```hinekora\b/.test(lines[i]!)) continue;
            const end = lines.findIndex((l, at) => at > i && /^\s*```\s*$/.test(l));
            const above = lines.slice(0, i).findLast((l) => l.trim() !== "") ?? "";
            if (above !== "<!-- fragment -->") {
                out.push({
                    name: `${name(f)}:${i + 1}`,
                    source: lines.slice(i + 1, end).join("\n"),
                });
            }
            i = end;
        }
    }
    return out;
}

/** Crafts whose verdict rests on reading a rule exactly, each with its right
 *  verdict. */
const AUDIT: readonly { name: string; checks: boolean; source: string }[] = [
    {
        // Each annul takes a prefix or a non-fractured suffix; while a prefix
        // is left there is one to take.
        name: "an annul loop that clears the prefixes",
        checks: true,
        source: `item {
    base:     "Amethyst Ring"
    ilvl:     84
    rarity:   rare
    prefixes: [ "random", "random", "random" ]
    suffixes: [ fractured "fire resistance" t1, "random", "random" ]
}
until prefixCount == 0 {
    annul
}`,
    },
    {
        // The suffix is fire or cold resistance on every item, and the arms
        // split by which: each changes the one it has.
        name: "a settled suffix changed in each arm",
        checks: true,
        source: `item {
    base:     "Sorcerer Boots"
    ilvl:     84
    rarity:   rare
    suffixes: [ "random" ]
    exarch:   grand
    eater:    lesser
}
until (has "fire resistance" or has "cold resistance") and suffixCount == 1 and prefixCount == 0 {
    harvest reforge "defence"
}
until has "maximum energy shield" {
    eldritch chaos
}
if has "fire resistance" {
    harvest change "fire resistance" "lightning resistance"
} else {
    harvest change "cold resistance" "lightning resistance"
}`,
    },
    {
        // The augment adds a prefix and takes another modifier, so a suffix
        // slot stays open.
        name: "a speed augment, then a suffix at the bench",
        checks: true,
        source: `item {
    base:     "Sorcerer Boots"
    ilvl:     84
    rarity:   rare
    prefixes: [ "maximum energy shield" t1 ]
    suffixes: [ "intelligence" t1, "cold resistance" t1 ]
}
harvest augment "speed"
bench "fire resistance"`,
    },
    {
        // An item without the life after the first test has five modifiers
        // after the second: one was annulled, or none was added.
        name: "an exalt, an annul where it missed, an exalt where it missed",
        checks: true,
        source: `item {
    base:     "Amethyst Ring"
    ilvl:     84
    rarity:   rare
    prefixes: [ "maximum mana" t3, "random" ]
    suffixes: [ "fire resistance" t1, "cold resistance" t1, "strength" t1 ]
}
exalt
if not has "maximum life" t1 {
    annul
}
if not has "maximum life" t1 {
    exalt
}`,
    },
    {
        // The exalt that added the life left six modifiers.
        name: "an exalt where it hit",
        checks: false,
        source: `item {
    base:     "Amethyst Ring"
    ilvl:     84
    rarity:   rare
    prefixes: [ "maximum mana" t3, "random" ]
    suffixes: [ "fire resistance" t1, "cold resistance" t1, "strength" t1 ]
}
exalt
if not has "maximum life" t1 {
    annul
}
if has "maximum life" t1 {
    exalt
}`,
    },
    {
        name: "a fracture of one of four random modifiers",
        checks: true,
        source: `item {
    base:     "Amethyst Ring"
    ilvl:     84
    rarity:   rare
    prefixes: [ "random", "random" ]
    suffixes: [ "random", "random" ]
}
fracture
if fractured "maximum life" {
    annul
}`,
    },
    {
        // The bench's chaos damage over time multiplier on a bow is a suffix,
        // which the beast's removal may take.
        name: "a crafted suffix of a prefix type, then a random suffix removed",
        checks: true,
        source: `item {
    base:     "Thicket Bow"
    ilvl:     84
    rarity:   rare
    prefixes: [ "random" ]
    suffixes: [ "random" ]
}
bench "chaos damage over time multiplier"
beast add prefix
if has "chaos damage over time multiplier" {
    stop
} else {
    stop
}`,
    },
    {
        name: "a count of two inside a count of one or three",
        checks: false,
        source: `item {
    base:     "Amethyst Ring"
    ilvl:     84
    rarity:   rare
    prefixes: [ "random" ]
    suffixes: [ "random" ]
}
chaos
if prefixCount == 1 or prefixCount == 3 {
    if prefixCount == 2 {
        stop
    }
}`,
    },
    {
        name: "a value test after the items that pass it stopped",
        checks: false,
        source: `item {
    base:     "Amethyst Ring"
    ilvl:     84
    rarity:   rare
    prefixes: [ "random" ]
    suffixes: [ "fire resistance" t1 ]
}
if has "maximum life" >= 110 {
    stop
}
if has "maximum life" >= 110 {
    annul
}`,
    },
    {
        // Each item has one dominant side, the one its arm raised.
        name: "an eldritch orb after paths that raise different sides",
        checks: true,
        source: `item {
    base:     "Sorcerer Boots"
    ilvl:     84
    rarity:   rare
    prefixes: [ "random" ]
    suffixes: [ "intelligence" t1, "cold resistance" t1 ]
}
if has "maximum energy shield" {
    ember grand
} else {
    ichor grand
}
eldritch exalt`,
    },
    {
        // No modifier is influenced, so none can be raised.
        name: "an Orb of Dominance on Crusader gloves with three plain prefixes",
        checks: false,
        source: `item {
    base:       "Titan Gauntlets"
    ilvl:       84
    rarity:     rare
    prefixes:   [ "maximum life" t1, "armour" t1, "adds physical damage" t1 ]
    influences: crusader
}
dominance`,
    },
    {
        name: "an Orb of Dominance on Crusader gloves with two Crusader prefixes",
        checks: true,
        source: `item {
    base:       "Titan Gauntlets"
    ilvl:       84
    rarity:     rare
    prefixes:   [ "maximum life" t1, "ConvertPhysicalToFireInfluence1", "ConvertPhysicalToColdInfluence1_" ]
    influences: crusader
}
dominance`,
    },
];

describe("the crafts read exactly", () => {
    for (const { name, checks, source } of AUDIT) {
        it(`${checks ? "accepts" : "refuses"} ${name}`, () => {
            expect(check(parsed(source), { registry }).ok).toBe(checks);
        });
    }
});

describe("a modifier read on the side of its own row", () => {
    // On a bow the bench's chaos damage over time multiplier is a suffix,
    // though the type's natural rows are prefixes.
    const bow = `item {
    base:     "Thicket Bow"
    ilvl:     84
    rarity:   rare
    prefixes: [ "random" ]
    suffixes: [ "random" ]
}
bench "chaos damage over time multiplier"
`;

    it("is taken by a removal of a random suffix, so the item may be without it", () => {
        const r = check(
            parsed(`${bow}beast add prefix
if has "chaos damage over time multiplier" {
    stop
} else {
    stop
}`),
            { registry },
        );
        expect(r.diagnostics).toEqual([]);
    });

    it("counts as a suffix where a condition names it", () => {
        const craft = parsed(`item {
    base:     "Thicket Bow"
    ilvl:     84
    rarity:   rare
    suffixes: [ "random" ]
}
bench "chaos damage over time multiplier"
annul
if has "chaos damage over time multiplier" {
    if prefixCount == 0 {
        stop
    }
}`);
        const r = check(craft, { registry });
        expect(r.diagnostics).toEqual([]);
        const inner = r.trace.find((e) => e.kind === "if" && e.span.start.line === 10)!;
        expect(counts(inner.before)).toEqual({ total: [1, 1], prefix: [0, 0], suffix: [1, 1] });
    });
});

describe("a Fracturing Orb on modifiers the item block does not name", () => {
    it("may fracture any modifier the item can roll", () => {
        const r = check(
            parsed(`item {
    base:     "Amethyst Ring"
    ilvl:     84
    rarity:   rare
    prefixes: [ "random", "random" ]
    suffixes: [ "random", "random" ]
}
fracture
if fractured "maximum life" {
    stop
}`),
            { registry },
        );
        expect(r.diagnostics).toEqual([]);
    });
});

describe("the exact checker's memory", () => {
    it("settles over hundreds of checks run back to back, with no yield between them", () => {
        v8.setFlagsFromString("--expose-gc");
        const gc = vm.runInNewContext("gc") as () => void;
        const crafts = corpus().map(({ source }) => parsed(source));
        const batch = (): number => {
            for (const craft of crafts) check(craft, { registry });
            gc();
            return process.memoryUsage().heapUsed;
        };
        // The first batch fills what is kept per base and per registry.
        const settled = batch();
        for (let i = 0; i < 3; i++) {
            expect(batch() - settled).toBeLessThan(40e6);
        }
    });
});
