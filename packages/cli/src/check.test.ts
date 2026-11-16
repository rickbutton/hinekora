import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { check, costOf, possibleTypes, rowsOf } from "@hinekora/core";
import { loadDefaultEconomy, loadDefaultPoe1, registryOf } from "@hinekora/data";
import { parse } from "@hinekora/parser";
import { chartSource, checkSource, costSource, unjudgedText } from "./check.js";

// Built once against the real bundled catalog — the CLI's actual data path.
const registry = registryOf(loadDefaultPoe1());
const run = (src: string) => checkSource(src, "test.craft", registry);

describe("chartSource — the craft as Mermaid text", () => {
    it("prints a flowchart with a node per step", () => {
        const text = chartSource(
            `item { base: "Iron Ring" ilvl: 84 rarity: normal }\ntransmute\nregal`,
            registry,
        );
        expect(text).toMatch(/^flowchart TD\n/);
        expect(text).toContain("Orb of Transmutation");
        expect(text).toContain("Regal Orb");
        expect(text).toContain("--> finish");
    });

    it("has nothing for a craft that does not parse", () => {
        expect(chartSource("item {", registry)).toBeUndefined();
    });
});

describe("the modifiers an item is listed without", () => {
    /** The `n`th hinekora block of a site page. */
    const block = (page: string, n: number): string => {
        const text = readFileSync(
            fileURLToPath(new URL(`../../../site/${page}`, import.meta.url)),
            "utf8",
        ).replace(/\r/g, "");
        const blocks = [...text.matchAll(/```hinekora\n([\s\S]*?)```/g)].map((m) => m[1]!);
        return blocks[n]!;
    };

    it.each([
        ["docs/language/conditions.md", 0],
        ["docs/getting-started.md", 2],
        ["docs/cost.md", 0],
        ["docs/syntax.md", 0],
    ])("are plain words on the item %s block %i ends with", (page, n) => {
        const r = run(block(page, n));
        expect(r.ok).toBe(true);
        const line = r.output.split("\n").find((l) => l.trim().startsWith("Without:"));
        for (const w of line?.trim().slice("Without: ".length).split(", ") ?? []) {
            expect(w).toMatch(/^[a-z0-9][a-z0-9 %+'-]*$/);
        }
    });
});

describe("the base's own implicit, against real data", () => {
    const implicits = (src: string): string => {
        const r = run(src);
        expect(r.ok).toBe(true);
        return r.output.split("\n  --------\n")[2] ?? "";
    };

    it("shows a Vermillion Ring's, possibly once a Vaal Orb may have taken it", () => {
        const ring = `item { base: "Vermillion Ring" ilvl: 84 rarity: normal }`;
        expect(implicits(ring)).toBe(
            "  { Implicit Modifier — Resource, Life }\n  (5-7)% increased maximum Life",
        );
        expect(implicits(`${ring}\nvaal`)).toBe(
            "  { Possibly: Implicit Modifier — Resource, Life }\n  (5-7)% increased maximum Life",
        );
    });

    it("shows a Two-Stone Ring's as one of its three", () => {
        expect(implicits(`item { base: "Two-Stone Ring" ilvl: 84 rarity: normal }`)).toBe(
            [
                "  { Implicit Modifier }",
                "  one of 3:",
                "      +(12-16)% to Fire and Lightning Resistances",
                "      +(12-16)% to Cold and Lightning Resistances",
                "      +(12-16)% to Fire and Cold Resistances",
            ].join("\n"),
        );
    });

    it("sets in a Shadowed Ring's second line of each of its three wordings", () => {
        expect(implicits(`item { base: "Shadowed Ring" ilvl: 84 rarity: normal }`)).toBe(
            [
                "  { Implicit Modifier }",
                "  one of 3:",
                "      Left ring slot: 25% of Cold Damage from Hits taken as Fire Damage",
                "          Right ring slot: 25% of Fire Damage from Hits taken as Cold Damage",
                "      Left ring slot: 25% of Fire Damage from Hits taken as Lightning Damage",
                "          Right ring slot: 25% of Lightning Damage from Hits taken as Fire Damage",
                "      Left ring slot: 25% of Lightning Damage from Hits taken as Cold Damage",
                "          Right ring slot: 25% of Cold Damage from Hits taken as Lightning Damage",
            ].join("\n"),
        );
    });

    it("prints a Rare Vermillion Ring after a Vaal Orb whole", () => {
        const r = run(`item { base: "Vermillion Ring" ilvl: 84 rarity: rare }\nvaal`);
        expect(r.ok).toBe(true);
        expect(r.output).toBe(
            [
                "✓ test.craft checks.",
                "",
                "  Item Class: Rings",
                "  Rarity: Rare",
                "  Vermillion Ring",
                "  --------",
                "  Item Level: 84",
                "  --------",
                "  { Possibly: Implicit Modifier — Resource, Life }",
                "  (5-7)% increased maximum Life",
                "  --------",
                "  { 0-6 additional prefix or suffix modifiers }",
                "  --------",
                "  Corrupted",
            ].join("\n"),
        );
    });
});

describe("checkSource — end to end against real data", () => {
    it("passes a valid craft and reports the final item", () => {
        const r = run(`item { base: "Iron Ring" ilvl: 84 rarity: normal }
transmute
regal`);
        expect(r.ok).toBe(true);
        expect(r.output).toContain("checks");
        expect(r.output).toContain("  Item Class: Rings\n  Rarity: Rare\n  Iron Ring");
    });

    it("rejects a precondition failure with a located, carated error", () => {
        const r = run(`item { base: "Iron Ring" ilvl: 84 rarity: magic }
exalt`);
        expect(r.ok).toBe(false);
        expect(r.output).toContain("test.craft:2:1: error:");
        expect(r.output).toContain("Requires a Rare item");
        expect(r.output).toContain("^"); // source caret
        expect(r.output).toContain("✗ 1 error");
    });

    it("refuses a second Corruption Altar on an item it corrupted again", () => {
        const r =
            run(`item { base: "Iron Ring" ilvl: 84 rarity: rare prefixes: [ "maximum life" t1 ] corrupted }
locus
locus`);
        expect(r.ok).toBe(false);
        expect(r.output).toContain("test.craft:3:1: error:");
        expect(r.output).toContain(
            "The Corruption Altar takes no twice-corrupted item — this item is twice corrupted.",
        );
    });

    it("shows under an error an item that breaks the step, where the items differ", () => {
        // An annul leaves two or three prefixes: the bench is refused where three are left.
        const r =
            run(`item { base: "Vaal Regalia" ilvl: 84 rarity: rare prefixes: [ "random", "random", "random" ] suffixes: [ "random", "random" ] }
annul
bench "maximum life"`);
        expect(r.output).toContain(
            '  3 | bench "maximum life"\n    | ^\n  For example, this item:\n    Item Class: Body Armours\n    Rarity: Rare\n    Vaal Regalia\n',
        );
        const example = r.output.slice(r.output.indexOf("For example"));
        expect(example.match(/\{ (Master Crafted )?Prefix Modifier/g)).toHaveLength(3);
        expect(example).not.toContain("additional");
        // One item: the message describes it, and no example follows.
        const one = run(`item { base: "Iron Ring" ilvl: 84 rarity: magic }
exalt`);
        expect(one.output).not.toContain("For example");
    });

    it("says when the checker could not judge the craft, apart from the craft's errors", () => {
        const broken = {
            ...registry,
            resolveCurrency: () => {
                throw new Error("no currencies");
            },
        };
        const r = checkSource(
            `item { base: "Iron Ring" ilvl: 84 rarity: normal }
transmute`,
            "t.craft",
            broken,
        );
        expect(r.ok).toBe(false);
        expect(r.unjudged).toBe(true);
        expect(r.output).toContain("t.craft:2:1: error: This step could not be checked");
        expect(r.output).toContain("— no currencies");
        expect(
            run(`item { base: "Iron Ring" ilvl: 84 rarity: magic }
exalt`).unjudged,
        ).toBeUndefined();
    });

    it("gives a cost the checker could not judge as such, not as a figure", () => {
        const broken = {
            ...registry,
            resolveCurrency: () => {
                throw new Error("no currencies");
            },
        };
        const r = costSource(
            `item { base: "Iron Ring" ilvl: 84 rarity: normal }
transmute`,
            "t.craft",
            broken,
        );
        expect(r.ok).toBe(false);
        expect(r.unjudged).toBe(true);
        expect(r.output).toContain("t.craft:2:1: error: This step could not be checked");
        expect(r.output).not.toContain("Expected spend");
    });

    it("gives the could-not-judge line where drawing the item fails after a clean check", () => {
        const broken = {
            ...registry,
            typeLabel: () => {
                throw new Error("no wording");
            },
        };
        const r = checkSource(
            `item { base: "Iron Ring" ilvl: 84 rarity: normal }
transmute
until has "maximum life" {
    alteration
}`,
            "t.craft",
            broken,
        );
        expect(r).toEqual({
            ok: false,
            output: unjudgedText("t.craft", new Error("no wording")),
            unjudged: true,
        });
        expect(r.output).toMatch(/^t\.craft: error: the craft could not be judged.* — no wording$/);
    });

    it("points an item block's error at the field or the modifier it is about", () => {
        const r = run(`item {
    base: "Iron Ring"
    ilvl: 84
    rarity: rare
    prefixes: ["maximum life" t1, "maximum lief" t1]
    strands: 400
}
exalt`);
        expect(r.output).toContain('test.craft:5:35: error: Unknown mod "maximum lief".');
        expect(r.output).toContain("test.craft:6:14: error: An item holds 0 to");
        expect(r.output).toContain("✗ 2 errors");
    });

    it("reports a parse error with location", () => {
        const r = run(`item { base: "Iron Ring" ilvl: 84 rarity: rare
exalt`);
        expect(r.ok).toBe(false);
        expect(r.output).toMatch(/test\.craft:\d+:\d+: error:/);
    });

    it("resolves fuzzy stat names (with a declared tier) in a real craft", () => {
        const r =
            run(`item { base: "Iron Ring" ilvl: 84 rarity: rare prefixes: [ "maximum life" t1 ] }
exalt`);
        expect(r.ok).toBe(true);
    });

    it("rejects a declared mod with no tier", () => {
        const r = run(`item { base: "Iron Ring" ilvl: 84 rarity: rare prefixes: [ "maximum life" ] }
exalt`);
        expect(r.ok).toBe(false);
        expect(r.output).toContain("declare the tier");
    });

    it("a corrupted essence reforges a Rare and guarantees its modifier", () => {
        const r = run(`item { base: "Iron Ring" ilvl: 84 rarity: rare }
essence "horror"
if not has "cold damage per frenzy charge" { exalt }`);
        expect(r.ok).toBe(false);
        expect(r.output).toContain("can never run");
    });

    it("a resonator's blocked tag keeps its modifiers out of the reforge", () => {
        const r = run(`item { base: "Iron Ring" ilvl: 84 rarity: rare }
fossil "pristine" "dense"
if has "maximum life" { exalt }`);
        expect(r.ok).toBe(false);
        expect(r.output).toContain("can never run");
    });

    it("checks the bundled example.craft clean (bench after a proven-suffix reforge)", () => {
        const src = readFileSync(
            fileURLToPath(new URL("../../../examples/example.craft", import.meta.url)),
            "utf8",
        );
        const r = run(src);
        expect(r.ok).toBe(true);
        // The final item in the game's layout, its unknown modifiers as one line.
        expect(r.output).toContain("  Item Class: Body Armours\n  Rarity: Rare\n  Vaal Regalia");
        expect(r.output).toContain("  --------\n  Item Level: 84\n  --------\n");
        expect(r.output).toMatch(/\{ \d-\d additional prefix or suffix modifiers \}/);
    });

    it("checks phys-dot-weapon.craft clean (fractured reforge keeps its count and clears crafted)", () => {
        const src = readFileSync(
            fileURLToPath(new URL("../../../examples/phys-dot-weapon.craft", import.meta.url)),
            "utf8",
        );
        const r = run(src);
        expect(r.ok).toBe(true);
        // The advanced copy's headers, the fractured one flagged in its header, and the mark.
        expect(r.output).toContain('{ Prefix Modifier "Magister\'s" (Tier: 1) — Caster, Gem }');
        expect(r.output).toMatch(/\{ Fractured [^\n]*\}\n *[^\n]*to Damage over Time Multiplier\n/);
        expect(r.output).toContain("  --------\n  Fractured Item");
    });

    // A Shaper Laminated Kite Shield of item level 85, copied from the game
    // with the advanced tooltip on (patch 3.29): each tier below is the number
    // its modifier's header showed.
    const shield = (ilvl: number, suffixes: string) => `item {
    base:       "Laminated Kite Shield"
    ilvl:       ${ilvl}
    rarity:     rare
    influences: shaper
    prefixes:   [ "armour maximum life" t3, "maximum mana" t7, "maximum life" t8 ]
    suffixes:   [ ${suffixes} ]
    corrupted
}`;

    it("numbers a real item's tiers as the game's advanced tooltip does", () => {
        const r = run(
            shield(
                85,
                `"maximum lightning resistance" t3, "intelligence" t1, "fire resistance" t8`,
            ),
        );
        expect(r.ok).toBe(true);
        for (const header of [
            `{ Prefix Modifier "Oyster's" (Tier: 3) `,
            `{ Prefix Modifier "Aqua" (Tier: 7) `,
            `{ Prefix Modifier "Stalwart" (Tier: 8) `,
            `{ Suffix Modifier "of Impedance" (Tier: 3) `,
            `{ Suffix Modifier "of the Genius" (Tier: 1) `,
            `{ Suffix Modifier "of the Whelpling" (Tier: 8) `,
        ]) {
            expect(r.output).toContain(header);
        }
    });

    it("puts that item's Corrupted section before its influence, as its copy has them", () => {
        const r = run(
            shield(
                85,
                `"maximum lightning resistance" t3, "intelligence" t1, "fire resistance" t8`,
            ),
        );
        expect(r.output).toMatch(/ {2}--------\n {2}Corrupted\n {2}--------\n {2}Shaper Item$/m);
    });

    it("keeps those numbers on an item whose level stops short of the best tiers", () => {
        // At item level 68 no currency rolls the mana or life above 60 and 64,
        // nor the level-82 Intelligence; the rows below keep their numbers.
        const r = run(shield(68, `"maximum lightning resistance" t3, "fire resistance" t8`));
        expect(r.ok).toBe(true);
        expect(r.output).toContain(`{ Prefix Modifier "Aqua" (Tier: 7) `);
        expect(r.output).toContain(`{ Prefix Modifier "Stalwart" (Tier: 8) `);
        expect(r.output).toContain(`{ Suffix Modifier "of Impedance" (Tier: 3) `);
        const genius = run(
            shield(
                68,
                `"maximum lightning resistance" t3, "intelligence" t1, "fire resistance" t8`,
            ),
        );
        // The Intelligence is declared all the same, as an item an essence or
        // a Harvest change left it on.
        expect(genius.ok).toBe(true);
        expect(genius.output).toContain(`{ Suffix Modifier "of the Genius" (Tier: 1) `);
    });

    describe("a modifier above the item's level", () => {
        it("is declared on a body armour of level 25 at the tier its tooltip shows", () => {
            const r = run(`item {
    base: "Plate Vest"
    ilvl: 25
    rarity: rare
    suffixes: [ "cold resistance" t6 ]
}`);
            expect(r.ok).toBe(true);
            expect(r.output).toContain("(Tier: 6) ");
            const byId = run(`item {
    base: "Plate Vest"
    ilvl: 25
    rarity: rare
    suffixes: [ "ColdResist3" ]
}`);
            expect(byId.ok).toBe(true);
            expect(byId.output).toContain("(Tier: 6) ");
        });

        const boots = (body = "") => `item {
    base: "Titan Greaves"
    ilvl: 84
    rarity: rare
    prefixes: [ "movement speed" t1 ]
}
${body}`;

        it("is declared on boots of level 84, where no currency rolls it", () => {
            const r = run(boots());
            expect(r.ok).toBe(true);
            expect(r.output).toContain("(Tier: 1) ");
        });

        it("is not rolled back once lost: the loop that waits for it cannot exit", () => {
            const r = run(boots(`chaos\nuntil has "movement speed" t1 { chaos }`));
            expect(r.ok).toBe(false);
            expect(r.output).toContain("this loop can never exit");
            expect(r.output).toContain(
                'Tier 1 "movement speed" needs item level 86; this item is level 84',
            );
        });

        it("is still refused where the number is beyond the modifier's tiers", () => {
            const r = run(`item {
    base: "Plate Vest"
    ilvl: 25
    rarity: rare
    suffixes: [ "cold resistance" t9 ]
}`);
            expect(r.ok).toBe(false);
            expect(r.output).toContain('tier 9 is out of range for "cold resistance"');
        });

        it("writes 'an' before a modifier's name that opens with a vowel", () => {
            const r = run(`item {
    base: "Two-Stone Ring"
    ilvl: 84
    rarity: rare
    prefixes: [ "adds fire damage to attacks" t1 ]
}
bench "adds fire damage to attacks"`);
            expect(r.output).toContain('The item already carries an "adds fire damage');
        });

        it("says a modifier the base cannot roll cannot roll, and how a bench craft is declared", () => {
            const declared = (mod: string): string =>
                run(`item {
    base: "Two-Stone Ring"
    ilvl: 84
    rarity: rare
    prefixes: [ "${mod}" ]
}`).output;
            expect(declared("increased spell damage")).toContain(
                '"increased spell damage" cannot roll on a Two-Stone Ring.',
            );
            expect(declared("suffixes cannot be changed")).toContain(
                'a bench craft is declared as `bench "suffixes cannot be changed"`.',
            );
        });
    });

    it("tells the partial protections apart by their counts, and from the full one", () => {
        // One modifier type holds both counts (Version 3.30.0 § Endgame Changes).
        // A protection of one side is crafted on the other.
        const sides = [
            {
                base: "Iron Ring",
                on: "suffixes",
                names: [
                    "1 Prefix Modifier cannot be changed",
                    "2 Prefix Modifiers cannot be changed",
                    "prefixes cannot be changed",
                ],
            },
            {
                base: "Titan Greaves",
                on: "prefixes",
                names: [
                    "1 Suffix Modifier cannot be changed",
                    "2 Suffix Modifiers cannot be changed",
                    "suffixes cannot be changed",
                ],
            },
        ];
        for (const { base, on, names } of sides) {
            for (const held of names) {
                const r = run(`item {
    base: "${base}"
    ilvl: 84
    rarity: rare
    ${on}: [ bench "${held}" ]
}
${names.map((n) => `if has "${n}" { exalt }`).join("\n")}`);
                const dead = names.filter((n) => n !== held);
                expect(r.output, held).not.toContain(`has "${held}" is impossible`);
                for (const n of dead) {
                    expect(r.output, held).toContain(`has "${n}" is impossible here`);
                }
            }
        }
    });

    it("numbers one influence's rows apart from the base's own of the same modifier", () => {
        const ring = (base: string, influence: string, side: string, mod: string) =>
            run(`item {
    base: "${base}"
    ilvl: 84
    rarity: rare
    influences: ${influence}
    ${side}: [ "${mod}" ]
}`);
        // An Elder ring's own life per enemy hit is one row below the Elder's
        // two: the first tier of its ladder, the third were they one ladder.
        const own = ring("Iron Ring", "elder", "suffixes", "LifeGainPerTarget1");
        expect(own.ok).toBe(true);
        expect(own.output).toContain(`"of Rejuvenation" (Tier: 1) `);
        // A Redeemer Bone Ring's minion damage: the base's five rows and the
        // Redeemer's three, not one ladder of eight.
        for (const [mod, tier] of [
            ["MinionDamagePercent5", 1],
            ["MinionDamagePercent1", 5],
            ["MinionDamageRingInfluence3", 1],
            ["MinionDamageRingInfluence1", 3],
        ] as const) {
            const r = ring("Bone Ring", "redeemer", "prefixes", mod);
            expect(r.ok).toBe(true);
            expect(r.output).toContain(`(Tier: ${tier}) `);
        }
    });

    describe("an Elder amulet's two minion modifiers, one type and one level", () => {
        const amulet = (prefixes: string, body = "") => `item {
    base: "Paua Amulet"
    ilvl: 84
    rarity: rare
    influences: elder
    prefixes: [ ${prefixes} ]
}
${body}`;

        it("declares the one its name words, each the first tier of its own", () => {
            const zombies = run(amulet(`"maximum number of raised zombies"`));
            expect(zombies.ok).toBe(true);
            expect(zombies.output).toContain("(Tier: 1)");
            expect(zombies.output).toContain("+1 to maximum number of Raised Zombies");
            expect(zombies.output).not.toContain("Skeletons");
            const skeletons = run(amulet(`"maximum number of skeletons" t1`));
            expect(skeletons.ok).toBe(true);
            expect(skeletons.output).toContain("+1 to maximum number of Skeletons");
            expect(skeletons.output).not.toContain("Zombies");
        });

        it("refuses a second tier of either", () => {
            const declared = run(amulet(`"maximum number of raised zombies" t2`));
            expect(declared.ok).toBe(false);
            expect(declared.output).toContain(
                'tier 2 is out of range for "maximum number of raised zombies" (it has 1 tier on this base)',
            );
            const loop = run(
                amulet("", `until has "maximum number of raised zombies" t2 { chaos }`),
            );
            expect(loop.ok).toBe(false);
            expect(loop.output).toContain("tier 2 is out of range");
        });

        it("ends a loop for the Raised Zombies on that modifier, not on the Skeletons", () => {
            const r = run(amulet("", `until has "maximum number of raised zombies" { chaos }`));
            expect(r.ok).toBe(true);
            expect(r.output).toContain("+1 to maximum number of Raised Zombies");
            expect(r.output).not.toContain("Skeletons");
            const other = run(
                amulet(
                    `"maximum number of skeletons"`,
                    `if has "maximum number of raised zombies" { annul }`,
                ),
            );
            expect(other.ok).toBe(false);
            expect(other.output).toContain("the 'if' branch can never run");
        });
    });
});

describe("the Bestiary's metamod on the real catalog", () => {
    /** The bench rows the recipe can leave, by type, on the item the block declares. */
    const crafted = (block: string): Map<string, string[]> => {
        const parsed = parse(`item {\n${block}\n}\nbeast metamod\n`);
        if (!parsed.ok) throw new Error(parsed.error.message);
        const r = check(parsed.craft, { registry });
        expect(r.diagnostics).toEqual([]);
        const out = new Map<string, string[]>();
        for (const type of possibleTypes(r.finalState!)) {
            const rows = rowsOf(r.finalState!, type).filter((m) => m.source === "bench");
            if (rows.length > 0) out.set(type, rows.map((m) => m.id as string).sort());
        }
        return out;
    };

    it("crafts the boots' row of each suffix protection on Titan Greaves with three suffixes", () => {
        const rows = crafted(`base: "Titan Greaves"
ilvl: 86
rarity: rare
prefixes: [ "maximum life" t1 ]
suffixes: [ "fire resistance" t1, "cold resistance" t1, "chaos resistance" t2 ]`);
        expect([...rows.values()].flat().sort()).toEqual([
            "DexMasterItemGenerationCannotChangeOneSuffixesB",
            "DexMasterItemGenerationCannotChangeSuffixesB",
            "DexMasterItemGenerationCannotChangeTwoSuffixesB",
        ]);
    });

    it("crafts each metamod once on a ring, by its jewellery row or its only one", () => {
        const rows = crafted(`base: "Iron Ring"
ilvl: 84
rarity: rare
prefixes: [ "maximum life" t1 ]`);
        expect([...rows.values()].flat().sort()).toEqual([
            "DexMasterItemGenerationCannotChangeOneSuffixesC",
            "DexMasterItemGenerationCannotChangeSuffixesC",
            "DexMasterItemGenerationCannotChangeTwoSuffixesC",
            "IntMasterItemGenerationCannotRollAttackAffixes",
            "StrDexMasterItemGenerationCannotRollCasterAffixes",
            "StrIntMasterItemGenerationCanHaveMultipleCraftedMods",
            "StrMasterItemGenerationCannotChangeOnePrefixesC",
            "StrMasterItemGenerationCannotChangePrefixesC",
            "StrMasterItemGenerationCannotChangeTwoPrefixesC",
        ]);
    });

    it("crafts the first row of each on a class the bench crafts nothing on", () => {
        const rows = crafted(`base: "Cobalt Jewel"
ilvl: 84
rarity: rare
prefixes: [ "random" ]
suffixes: [ "random", "random" ]`);
        expect([...rows.values()].flat().sort()).toEqual([
            "DexMasterItemGenerationCannotChangeOneSuffixes",
            "DexMasterItemGenerationCannotChangeSuffixes",
            "DexMasterItemGenerationCannotChangeTwoSuffixes",
        ]);
    });

    /** The errors of a craft on Titan Greaves with these modifiers and steps. */
    const errors = (prefixes: string, suffixes: string, steps: string): string[] =>
        run(`item {
    base: "Titan Greaves"
    ilvl: 84
    rarity: rare
    prefixes: [ ${prefixes} ]
    suffixes: [ ${suffixes} ]
}
${steps}
`)
            .output.split("\n")
            .filter((l) => l.includes("error:"));
    const SUFFIXES_FULL = `"fire resistance" t1, "cold resistance" t1, "chaos resistance" t2`;

    it.each(["", "B", "C"])(
        "reads the id of any class's row of the full lock as the boots' (%s)",
        (variant) => {
            expect(
                errors(
                    "",
                    SUFFIXES_FULL,
                    `beast metamod\nif has "DexMasterItemGenerationCannotChangeSuffixes${variant}" {\n    bench remove\n}`,
                ),
            ).toEqual([]);
        },
    );

    it("reads one row of a metamod as another, declared or crafted", () => {
        const either = (id: string) => `if has "${id}" { stop } else { stop }`;
        expect(
            errors(
                `"DexMasterItemGenerationCannotChangeSuffixesC"`,
                `"fire resistance" t1`,
                either("DexMasterItemGenerationCannotChangeSuffixesB"),
            ),
        ).toEqual([expect.stringContaining("'else' branch can never run")]);
        expect(
            errors(
                `"maximum life" t1`,
                `"fire resistance" t1`,
                `bench "suffixes cannot be changed"\n${either("DexMasterItemGenerationCannotChangeSuffixes")}`,
            ),
        ).toEqual([expect.stringContaining("'else' branch can never run")]);
        expect(
            errors(
                `"maximum life" t1`,
                `"fire resistance" t1`,
                `if not has "DexMasterItemGenerationCannotChangeSuffixesC" { stop } else { stop }`,
            ),
        ).toEqual([expect.stringContaining("'else' branch can never run")]);
    });

    it.each([
        ["Suffixes", "prefixes", `"fire resistance" t1`],
        ["Prefixes", "suffixes", `"maximum life" t1`],
    ] as const)(
        "does not read a One row's id as the Two row or the full lock (%s)",
        (side, holds, other) => {
            const lead = side === "Suffixes" ? "Dex" : "Str";
            const one = `${lead}MasterItemGenerationCannotChangeOne${side}C`;
            for (const held of [`Two${side}B`, `${side}B`]) {
                const row = `"${lead}MasterItemGenerationCannotChange${held}"`;
                const [prefixes, suffixes] = holds === "prefixes" ? [row, other] : [other, row];
                expect(errors(prefixes, suffixes, `if has "${one}" { stop }`), held).toEqual([
                    expect.stringContaining("'if' branch can never run"),
                ]);
            }
            const two = `"${lead}MasterItemGenerationCannotChangeTwo${side}"`;
            const [prefixes, suffixes] = holds === "prefixes" ? [two, other] : [other, two];
            const full = `${lead}MasterItemGenerationCannotChange${side}C`;
            expect(errors(prefixes, suffixes, `if has "${full}" { stop }`)).toEqual([
                expect.stringContaining("'if' branch can never run"),
            ]);
        },
    );
});

describe("the Bestiary's metamod costed on the real catalog", () => {
    /** Each step of a craft on Titan Greaves with maximum life, by its line. */
    const steps = (block: string, body: string) => {
        const parsed = parse(`item {
    base: "Titan Greaves"
    ilvl: 84
    rarity: rare
    prefixes: [ "maximum life" t1 ]
${block}
}
${body}
if has "cannot roll attack modifiers" {
    bench remove
}
`);
        if (!parsed.ok) throw new Error(parsed.error.message);
        const result = check(parsed.craft, { registry });
        expect(result.diagnostics).toEqual([]);
        const report = costOf(parsed.craft, result, registry);
        return (line: number) => report.steps.find((s) => s.span.start.line === line)!;
    };

    it("draws one of nine metamods, each one row, where both sides have room", () => {
        // Each metamod's three class rows drawn apart would give one in 21.
        const at = steps("", "beast metamod");
        expect(at(8).note).toBeUndefined();
        expect(at(9).branch).toBeCloseTo(1 / 9, 9);
    });

    it("leaves out a metamod the item surely holds", () => {
        const at = steps(
            `    suffixes: [ bench "can have up to 3 crafted modifiers" ]`,
            "beast metamod",
        );
        expect(at(8).note).toBeUndefined();
        expect(at(9).branch).toBeCloseTo(1 / 8, 9);
    });

    it("does not know the draw beside a metamod the item may hold", () => {
        const at = steps(
            "",
            `bench "can have up to 3 crafted modifiers"\nbeast metamod\nbeast metamod`,
        );
        expect(at(9).note).toBeUndefined();
        expect(at(10).note).toMatch(/may or may not hold a metamod/);
        expect(at(11).note).toMatch(/chance of this condition is not known/);
    });
});

describe("costSource — what a craft is expected to spend", () => {
    const prices = loadDefaultEconomy();

    it("prices an essence loop by its rounds and the snapshot", () => {
        const src = readFileSync(
            fileURLToPath(new URL("../../../examples/essence-life-boots.craft", import.meta.url)),
            "utf8",
        );
        const r = costSource(src, "essence-life-boots.craft", registry, prices);
        expect(r.ok).toBe(true);
        expect(r.output).toMatch(/until anyEleRes\(t1\) \{\s+1\/\d+ chance/);
        expect(r.output).toMatch(/Deafening Essence of Greed/);
        expect(r.output).toMatch(/Expected spend: .* Deafening Essence of Greed\./);
        expect(r.output).toMatch(
            /~\d+(\.\d+)? Chaos Orbs \(~\d+(\.\d+)? Divine Orbs\) at \S+ prices of \d{4}-\d{2}-\d{2}\./,
        );
    });

    it("gives a step written inside a one-line branch its own text", () => {
        const r = costSource(
            `item {
    base: "Iron Ring"
    ilvl: 84
    rarity: magic
    prefixes: ["maximum life" t1]
}
if suffixCount == 0 { augment }
regal`,
            "test.craft",
            registry,
            prices,
        );
        const rows = r.output.split("\n").filter((l) => /^\s+7\s/.test(l));
        expect(rows.map((l) => l.trim().split(/\s{2,}/)[1])).toEqual([
            "if suffixCount == 0 { augment }",
            "augment",
        ]);
    });

    it("answers for a craft whose compared values are too many to follow one by one", () => {
        // Four values compared against thresholds: their rows and the pieces
        // the thresholds cut are more states than the walk follows, so it
        // reads the loop on the checker's item instead, and answers at once.
        const r = costSource(
            `item { base: "Amethyst Ring" ilvl: 84 rarity: rare }
until has "maximum life" >= 70 and has "fire resistance" >= 40 and has "cold resistance" >= 40 and has "lightning resistance" >= 40 {
    chaos
}`,
            "test.craft",
            registry,
            prices,
        );
        expect(r.ok).toBe(true);
        expect(r.output).toMatch(/1\/\d+ chance/);
    });

    it("gives a branch's chance but no figure for a restart", () => {
        const r = costSource(
            `item { base: "Iron Ring" ilvl: 84 rarity: rare }
until has "maximum life" {
    chaos
    if not has "maximum life" {
        restart
    }
}`,
            "test.craft",
            registry,
            prices,
        );
        expect(r.output).toMatch(/if not has "maximum life" \{\s+taken \d+(\.\d+)?%/);
        const restart = r.output.split("\n").find((l) => l.includes("restart"));
        expect(restart).toBeDefined();
        expect(restart).not.toMatch(/%/);
    });

    it("places a Harvest reforge's tagged modifier whatever the item may hold", () => {
        // The suffixes are kept, so the life lands among the prefixes the
        // reforge has not yet drawn: no reading of the item finds that side
        // full, and the branch has one figure, about one life row in eight.
        const r = costSource(
            `item {
    base: "Vermillion Ring"
    ilvl: 84
    rarity: rare
    prefixes: [ "maximum mana" t5 ]
    suffixes: [ "fire resistance" t1, "cold resistance" t1, "chaos resistance" t2 ]
}
bench "suffixes cannot be changed"
harvest reforge "life"
if has "maximum life" t1 {
    stop
}`,
            "test.craft",
            registry,
            prices,
        );
        const branch = r.output.split("\n").find((l) => l.includes("if has"));
        expect(branch).toMatch(/taken 1[23]%$/);
    });

    it(
        "a loop at the head of a loop body reads what the round before left",
        {
            timeout: 30_000,
        },
        () => {
            // The ring enters with one prefix, but a later round starts from the
            // reforge's item, which holds three prefixes now and then: the inner
            // loop annuls those to make room for the metamod.
            const r = costSource(
                `item {
    base: "Vermillion Ring"
    ilvl: 84
    rarity: rare
    prefixes: [ "maximum mana" t5 ]
    suffixes: [ "fire resistance" t1, "cold resistance" t1, "chaos resistance" t2 ]
}
until has "maximum life" t1 and prefixCount <= 2 {
    until prefixCount <= 2 {
        annul
    }
    bench "suffixes cannot be changed"
    harvest reforge "life"
}`,
                "test.craft",
                registry,
                prices,
            );
            const annul = r.output.split("\n").find((l) => /^\s*\d+\s+annul/.test(l));
            expect(annul).toBeDefined();
            expect(annul).not.toMatch(/×0[:\s]/);
        },
    );

    it("gives a loop that drifts for thousands of rounds its figure, with no spread", () => {
        // example.craft's second loop drifts between items of two and three
        // modifiers for longer than its rounds are followed one by one.
        const src = readFileSync(
            fileURLToPath(new URL("../../../examples/example.craft", import.meta.url)),
            "utf8",
        );
        const r = costSource(src, "example.craft", registry, prices);
        const lines = r.output.split("\n");
        const at = lines.findIndex((l) => l.includes("until hasTwoEleRes()"));
        expect(lines[at]).toMatch(/1\/\d{4} chance$/);
        expect(lines[at + 1]).toMatch(/^\s*\d+\s+annul/);
        expect(r.output).not.toMatch(/by what the item may hold/);
    });

    it("asks the exit of a restart's item in a loop read round by round alike", () => {
        // The Tangled Fossil's roll is not followed, so the rounds are read as
        // independent; a restart is still at the loop's head with the item as
        // it is, so the loop ends on the life whether the fire came with it or
        // not, as it does without the branch.
        const rounds = (branch: string): string | undefined =>
            costSource(
                `item { base: "Vaal Regalia" ilvl: 86 rarity: rare }
until has "maximum life" {
    fossil "tangled"
    chaos${branch}
}`,
                "test.craft",
                registry,
                prices,
            ).output.match(/chaos\s+×(\d+(\.\d+)?)/)?.[1];
        const plain = rounds("");
        expect(plain).toBeDefined();
        // The loop's note gives the fossil as the cause, and no other.
        const loop = costSource(
            `item { base: "Vaal Regalia" ilvl: 86 rarity: rare }
until has "maximum life" {
    fossil "tangled"
}`,
            "test.craft",
            registry,
            prices,
        ).output.split("\n")[1];
        expect(loop).toMatch(/\(a Tangled Fossil makes .* every round of this loop is read alike/);
        expect(loop).not.toContain("more ways than could be followed");
        expect(
            rounds(`
    if has "fire resistance" {
        restart
    }`),
        ).toBe(plain);
    });

    it("names what the snapshot cannot price and still sums the rest", () => {
        const r = costSource(
            `item { base: "Iron Ring" ilvl: 84 rarity: rare prefixes: [ "maximum life" t1 ] corrupted }\nlocus`,
            "test.craft",
            registry,
            prices,
        );
        expect(r.ok).toBe(true);
        expect(r.output).toContain("no price is known for this step");
        expect(r.output).toContain("Expected spend: nothing this report can count.");
    });

    it("ends the craft where a Vaal Orb turns a jewel into a unique one", () => {
        const vaal = (base: string) =>
            costSource(
                `item { base: "${base}" ilvl: 84 rarity: rare }\nvaal`,
                "test.craft",
                registry,
                prices,
            ).output;
        const cobalt = vaal("Cobalt Jewel");
        expect(cobalt).toContain("25% of the time a Vaal Orb turns this jewel into a unique jewel");
        expect(cobalt).toContain("The craft ends short of a finished item 25% of the time.");
        // Only the three basic jewels have a unique to become (Vaal Orb § Jewels).
        expect(vaal("Ghastly Eye Jewel")).not.toContain("The craft ends");
    });

    it("names the currency the snapshot has no price for, on its step and under the total", () => {
        const chaos = new Map(prices.chaos);
        chaos.delete("Regal Orb");
        const r = costSource(
            `item { base: "Iron Ring" ilvl: 84 rarity: normal }\ntransmute\nregal`,
            "test.craft",
            registry,
            { ...prices, chaos },
        );
        expect(r.output).toMatch(/regal\s+×1: 1 Regal Orb {2}\(no price for Regal Orb\)/);
        expect(r.output).toContain("Expected spend: 1 Orb of Transmutation, 1 Regal Orb.");
        expect(r.output).toContain(
            `No total in Chaos Orbs: ${prices.league} prices of ${prices.fetchedAt.slice(0, 10)} lack Regal Orb.`,
        );
    });

    it("costs a craft with errors as written, and says so", () => {
        const r = costSource(
            `item { base: "Iron Ring" ilvl: 84 rarity: magic }\nexalt`,
            "test.craft",
            registry,
        );
        expect(r.output).toMatch(/^test\.craft: 1 error; the costs take the steps as written\./);
        expect(r.output).toContain("Exalted Orb");
    });

    it("gives no figure for a loop that can never exit, nor a total", () => {
        // A fossil pair that blocks the life it is rolled for.
        const r = costSource(
            `item { base: "Stygian Vise" ilvl: 84 rarity: normal }\nuntil has "maximum life" t1 {\n    fossil "pristine" "dense"\n}`,
            "test.craft",
            registry,
            prices,
        );
        expect(r.output).toContain("rounds not known");
        expect(r.output).toContain("the check finds this loop can never reach its exit");
        expect(r.output).toContain("uses not known");
        expect(r.output).not.toContain("a parameter stands");
        expect(r.output).toContain("Expected spend: not known, for a loop above has no figure.");
        expect(r.output).not.toContain("Chaos Orbs (");
    });

    it("reports a parse error as the check does", () => {
        const r = costSource(`item { base: "Iron Ring"`, "test.craft", registry);
        expect(r.ok).toBe(false);
        expect(r.output).toMatch(/test\.craft:\d+:\d+: error:/);
    });
});
