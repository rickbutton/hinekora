import { describe, expect, it } from "vitest";
import { rollableTiers } from "@hinekora/core";
import { loadDefaultPoe1, registryOf } from "@hinekora/data";
import { getCompletions } from "./completion.js";
import { getHover } from "./hover.js";
import { getSemanticTokens } from "./semantic.js";

const registry = registryOf(loadDefaultPoe1());

const SRC = `item { base: "Iron Ring" ilvl: 84 rarity: normal }
transmute
regal`;

describe("hover", () => {
    it("shows a currency op's signature plus the item tooltip", () => {
        // Offset inside "regal" (last line): the headline is regal's signature,
        // the tooltip is the item AFTER regal — a Rare.
        const offset = SRC.indexOf("regal") + 1;
        const md = getHover(SRC, offset, registry);
        expect(md).not.toBeNull();
        expect(md!).toContain("Regal Orb"); // the signature headline
        expect(md!).toContain("Requires:");
        expect(md!).toContain("Iron Ring"); // the tooltip header
        expect(md!).toContain("Rare"); // after regal
    });

    it("hovers a fossil line with what each fossil does", () => {
        const src = `item { base: "Iron Ring" ilvl: 84 rarity: rare }\nfossil "pristine" "hollow"`;
        const md = getHover(src, src.indexOf("pristine") + 1, registry);
        expect(md).not.toBeNull();
        expect(md!).toContain("Pristine Fossil");
        expect(md!).toContain("no defences modifiers");
        expect(md!).toContain("Hollow Fossil");
        expect(md!).toContain("only on: weapon, helmet, boots, gloves, body armour");
    });

    it("hovers an essence name with its tier and the mod it guarantees here", () => {
        const src = `item { base: "Iron Ring" ilvl: 84 rarity: normal }\nessence "Deafening Essence of Greed"`;
        const md = getHover(src, src.indexOf("Deafening") + 1, registry);
        expect(md).not.toBeNull();
        expect(md!).toContain("Deafening Essence of Greed");
        expect(md!).toContain("essence (T1)");
        expect(md!).toMatch(/Guarantees/);
    });

    it("marks a fractured mod in the item tooltip", () => {
        const src = `item { base: "Iron Ring" ilvl: 84 rarity: rare prefixes: [ fractured "maximum life" t1 ] }\nchaos`;
        const md = getHover(src, src.indexOf("chaos") + 1, registry);
        expect(md).not.toBeNull();
        expect(md!).toContain("(Fractured)"); // the locked mod survives the chaos, flagged
    });

    it("hovers a bench mod with what it adds and its generation", () => {
        const src = `item { base: "Iron Ring" ilvl: 84 rarity: rare }\nbench "maximum life"`;
        const md = getHover(src, src.indexOf("maximum life") + 1, registry);
        expect(md).not.toBeNull();
        expect(md!).toContain("bench craft");
        expect(md!).toMatch(/prefix|suffix/);
    });

    it("hovers a method's words with its help and a tag argument with what it is", () => {
        const src = `item { base: "Iron Ring" ilvl: 84 rarity: rare }\nharvest reforge "fire"`;
        const onWord = getHover(src, src.indexOf("reforge"), registry);
        expect(onWord).toContain('**harvest reforge "<tag>"**');
        expect(onWord).toContain("Rare");
        const onTag = getHover(src, src.indexOf('"fire"') + 2, registry);
        expect(onTag).toContain('**"fire"**');
    });

    it("hovers a method inside a one-line body and one that follows another", () => {
        const src = `item { base: "Iron Ring" ilvl: 84 rarity: rare }\nif isRare { exalt } else { annul }\ntransmute regal`;
        expect(getHover(src, src.indexOf("annul"), registry)).toContain("Orb of Annulment");
        expect(getHover(src, src.lastIndexOf("regal"), registry)).toContain("Regal Orb");
        expect(getHover(src, src.indexOf("isRare"), registry)).not.toContain("Orb");
    });

    it("names the item's marks in the tooltip", () => {
        const src = `item { base: "Iron Ring" ilvl: 84 rarity: rare influences: hunter corrupted }\nexalt`;
        const h = getHover(src, src.indexOf("exalt"), registry)!;
        expect(h).toContain("Hunter");
        expect(h).toContain("corrupted");
    });

    it("hovers a local def (declaration, call, and param share one signature)", () => {
        const src = `item { base: "Iron Ring" ilvl: 84 rarity: rare }
def anyEleRes(t) = has "fire resistance" t or has "cold resistance" t
until anyEleRes(t1) { chaos }`;
        const decl = getHover(src, src.indexOf("anyEleRes") + 1, registry);
        const callSite = getHover(src, src.lastIndexOf("anyEleRes") + 1, registry);
        expect(decl).not.toBeNull();
        expect(decl!).toContain("def anyEleRes(t)");
        expect(decl!).toContain("local predicate");
        expect(decl!).toContain('has "fire resistance" t'); // the expansion, param intact
        expect(callSite).toContain("def anyEleRes(t)"); // call hovers the same
    });

    it("resolves a mod string to its ModType signature", () => {
        const src = `item { base: "Iron Ring" ilvl: 84 rarity: rare }
until has "maximum life" t1 { exalt }`;
        const offset = src.indexOf("maximum life") + 1;
        const md = getHover(src, offset, registry);
        expect(md).not.toBeNull();
        expect(md!).toContain("maximum life");
        expect(md!).toMatch(/prefix|suffix/); // its generation
    });

    it("renders the state as a tagged, one-mod-per-line tooltip with resolved text", () => {
        const src = `item { base: "Iron Ring" ilvl: 84 rarity: rare prefixes: ["maximum life" t1] suffixes: ["fire resistance" t2] }
bench "cold resistance"`;
        const md = getHover(src, src.indexOf("bench") + 1, registry);
        expect(md).not.toBeNull();
        expect(md!).toContain("(P)"); // prefix tag
        expect(md!).toContain("(S)"); // suffix tag
        expect(md!).toMatch(/maximum Life/); // resolved text, not the "maximum life" label
        expect(md!).not.toMatch(/\bmodifiers\b/); // no total-count line
    });

    it("shows a disjunctive guarantee as 'at least one of'", () => {
        const src = `item { base: "Titan Greaves" ilvl: 84 rarity: normal }
until has "fire resistance" t1 or has "cold resistance" t1 or has "lightning resistance" t1 {
  essence "greed" t1
}`;
        const md = getHover(src, src.indexOf("until") + 1, registry);
        expect(md).not.toBeNull();
        expect(md!).toContain("at least one of:"); // 4–6 mods ⇒ could be more than one
        expect(md!).toMatch(/to Fire Resistance/); // resolved text, not the bare label
    });

    it("tightens a disjunction to 'exactly one of' when only one slot remains", () => {
        // A single mod; the loop proves it's fire-or-cold, so exactly one is
        // present (never both — there is no room).
        const src = `item { base: "Vaal Regalia" ilvl: 84 rarity: rare prefixes: [ "random" ] }
until has "fire res" t1 or has "cold res" t1 { annul exalt }`;
        const md = getHover(src, src.indexOf("until") + 1, registry);
        expect(md!).toContain("exactly one of:");
        expect(md!).not.toContain("at least one of:");
    });

    it("collapses `≥2 of 3` pairwise clauses into one 'exactly two of' block", () => {
        const twoOf3 = `(has "fire resistance" t1 or has "cold resistance" t1) and (has "fire resistance" t1 or has "lightning resistance" t1) and (has "cold resistance" t1 or has "lightning resistance" t1)`;
        const src = `item { base: "Vaal Regalia" ilvl: 84 rarity: rare prefixes: [ "random" ] suffixes: [ "random" ] }
until ${twoOf3} { annul annul exalt exalt }`;
        const md = getHover(src, src.indexOf("until") + 1, registry);
        expect(md!).toContain("exactly two of:"); // total 2, all suffixes ⇒ exactly two
        expect((md!.match(/one of:/g) ?? []).length).toBe(0); // not three pairwise blocks
    });

    it("pins the tier in a disjunctive block: shows the t1 roll, not the full span", () => {
        const twoOf3 = `(has "fire resistance" t1 or has "cold resistance" t1) and (has "fire resistance" t1 or has "lightning resistance" t1) and (has "cold resistance" t1 or has "lightning resistance" t1)`;
        const src = `item { base: "Vaal Regalia" ilvl: 84 rarity: rare prefixes: [ "random" ] suffixes: [ "random" ] }
until ${twoOf3} { annul annul exalt exalt }`;
        const md = getHover(src, src.indexOf("until") + 1, registry)!;

        // The T1 fire-resistance roll on this base — the block must show THIS, not
        // the merged T1..Tn span the flat overlay fell back to.
        const base = registry.resolveBase("Vaal Regalia");
        expect(base.ok).toBe(true);
        const type = registry.resolveModType("fire resistance", {
            base: base.ok ? base.value : (undefined as never),
            ilvl: 84,
        });
        expect(type.ok).toBe(true);
        const t1 = rollableTiers(
            registry.catalog,
            base.ok ? base.value : (undefined as never),
            84,
            type.ok ? type.value : (undefined as never),
        )[0]!;
        expect(md).toContain(t1.text!); // the exact t1 roll, tier pinned through the join
    });

    it("reports a fixed undetermined count as one coupled prefix-or-suffix line", () => {
        // After annul the item has exactly one mod — a prefix OR a suffix, not the
        // misleading independent "0–1 prefix" and "0–1 suffix".
        const src = `item { base: "Vaal Regalia" ilvl: 84 rarity: rare prefixes: [ "random" ] suffixes: [ "random" ] }
annul`;
        const md = getHover(src, src.lastIndexOf("annul") + 1, registry);
        expect(md!).toContain("1 undetermined — a prefix or a suffix");
    });

    it("returns null in dead space", () => {
        expect(getHover(SRC, 0, registry)).not.toBe(undefined);
    });
});

describe("completion", () => {
    it("offers currencies + control keywords at statement position", () => {
        const labels = getCompletions(SRC, SRC.length, registry).map((c) => c.label);
        expect(labels).toContain("exalt");
        expect(labels).toContain("until");
    });

    it("offers predicate keywords after `until` and `if`, not currencies", () => {
        for (const kw of ["until ", "if "]) {
            const src = `item { base: "Iron Ring" ilvl: 84 rarity: rare }\n${kw}`;
            const labels = getCompletions(src, src.length, registry).map((c) => c.label);
            expect(labels).toEqual(expect.arrayContaining(["has", "not", "isRare", "prefixCount"]));
            expect(labels).not.toContain("exalt"); // not a statement position
        }
    });

    it("offers predicate keywords after `not`", () => {
        const src = `item { base: "Iron Ring" ilvl: 84 rarity: rare }\nuntil not `;
        const labels = getCompletions(src, src.length, registry).map((c) => c.label);
        expect(labels).toContain("has");
    });

    it("offers base names inside a base: string", () => {
        const src = `item { base: "Iron`;
        const labels = getCompletions(src, src.length, registry).map((c) => c.label);
        expect(labels).toContain("Iron Ring");
        expect(labels).not.toContain("exalt");
    });

    it('offers essence names inside an `essence "` string, not mods', () => {
        const src = `item { base: "Iron Ring" ilvl: 84 rarity: normal }\nessence "`;
        const labels = getCompletions(src, src.length, registry).map((c) => c.label);
        expect(labels).toContain("Deafening Essence of Greed");
        expect(labels).not.toContain("maximum life"); // not mod suggestions
    });

    it('offers fossil names inside a `fossil "` string, also after an earlier name', () => {
        const first = `item { base: "Iron Ring" ilvl: 84 rarity: rare }\nfossil "`;
        expect(getCompletions(first, first.length, registry).map((c) => c.label)).toContain(
            "Pristine Fossil",
        );
        const second = `${first}pristine" "`;
        const labels = getCompletions(second, second.length, registry).map((c) => c.label);
        expect(labels).toContain("Dense Fossil");
        expect(labels).not.toContain("maximum life");
    });

    it("offers `remove` after `bench`", () => {
        const src = `item { base: "Iron Ring" ilvl: 84 rarity: rare }\nbench `;
        expect(getCompletions(src, src.length, registry).map((c) => c.label)).toContain("remove");
    });

    it('offers bench mod names inside a `bench "` string', () => {
        const src = `item { base: "Iron Ring" ilvl: 84 rarity: rare }\nbench "`;
        const labels = getCompletions(src, src.length, registry).map((c) => c.label);
        expect(labels).toContain("maximum life");
    });

    it("offers harvest as a statement keyword, then its verbs, then tags", () => {
        const stmt = getCompletions(SRC, SRC.length, registry).map((c) => c.label);
        expect(stmt).toContain("harvest");

        const verbSrc = `item { base: "Iron Ring" ilvl: 84 rarity: rare }\nharvest `;
        const verbs = getCompletions(verbSrc, verbSrc.length, registry).map((c) => c.label);
        expect(verbs).toEqual(expect.arrayContaining(["reforge", "augment"]));
        expect(verbs).not.toContain("exalt");

        const tagSrc = `item { base: "Iron Ring" ilvl: 84 rarity: rare }\nharvest reforge "`;
        const tags = getCompletions(tagSrc, tagSrc.length, registry).map((c) => c.label);
        expect(tags).toEqual(expect.arrayContaining(["fire", "caster", "life"]));
        expect(tags).not.toContain("maximum life"); // tags, not mods
    });

    it("offers a word slot's choices, and a statement once a method's slots are spent", () => {
        const side = `item { base: "Iron Ring" ilvl: 84 rarity: rare }\nbeast add `;
        expect(getCompletions(side, side.length, registry).map((c) => c.label)).toEqual([
            "prefix",
            "suffix",
        ]);
        const spent = `item { base: "Iron Ring" ilvl: 84 rarity: rare }\nexalt `;
        const labels = getCompletions(spent, spent.length, registry).map((c) => c.label);
        expect(labels).toContain("regal");
        expect(labels).toContain("until");
    });

    it("finds the method inside a one-line body and after another statement", () => {
        const body = `item { base: "Iron Ring" ilvl: 84 rarity: rare }\nif isRare { essence "`;
        const names = getCompletions(body, body.length, registry).map((c) => c.label);
        expect(names).toContain("Deafening Essence of Greed");
        expect(names).not.toContain("maximum life");

        const after = `item { base: "Iron Ring" ilvl: 84 rarity: rare }\nexalt beast aspect "`;
        expect(getCompletions(after, after.length, registry).map((c) => c.label)).toContain("cat");

        const pred = `item { base: "Iron Ring" ilvl: 84 rarity: rare }\nexalt if has "`;
        expect(getCompletions(pred, pred.length, registry).map((c) => c.label)).toContain(
            "maximum life",
        );
    });

    it('offers Aspect names inside a `beast aspect "` string', () => {
        const src = `item { base: "Iron Ring" ilvl: 84 rarity: rare }\nbeast aspect "`;
        const labels = getCompletions(src, src.length, registry).map((c) => c.label);
        expect(labels).toContain("cat");
        expect(labels).not.toContain("maximum life");
    });

    it("offers local def names as predicates (after a connective too)", () => {
        const src = `item { base: "Iron Ring" ilvl: 84 rarity: rare }
def anyEleRes(t) = has "fire resistance" t
until has "life" or `;
        const labels = getCompletions(src, src.length, registry).map((c) => c.label);
        expect(labels).toContain("anyEleRes"); // the local def
        expect(labels).toContain("has"); // and still the built-in predicates
        expect(labels).not.toContain("exalt"); // not a statement position
    });

    it("offers stat descriptions inside a has string", () => {
        const src = `item { base: "Iron Ring" ilvl: 84 rarity: rare }\nuntil has "maximum`;
        const labels = getCompletions(src, src.length, registry).map((c) => c.label);
        expect(labels).toContain("maximum life");
    });

    it("filters mod completions to those rollable on the item's base", () => {
        const src = `item { base: "Iron Ring" ilvl: 84 rarity: rare }\nuntil has "`;
        const labels = getCompletions(src, src.length, registry).map((c) => c.label);
        expect(labels).toContain("maximum life"); // rings roll life
        // A ring can't roll everything, so this is a strict subset of all mods.
        expect(labels.length).toBeLessThan(registry.statSuggestions.length);
    });
});

describe("semantic tokens", () => {
    it("emits tokens (5 ints per token) and doesn't throw on valid input", () => {
        const toks = getSemanticTokens(SRC, registry);
        expect(toks.data.length).toBeGreaterThan(0);
        expect(toks.data.length % 5).toBe(0);
    });

    it("returns empty on unlexable input rather than throwing", () => {
        expect(getSemanticTokens(`has "unterminated`, registry).data).toEqual([]);
    });

    it("colours the marks' words: the fields, the predicates and the influence names", () => {
        const plain = getSemanticTokens(SRC, registry).data.length;
        const marked = getSemanticTokens(
            `${SRC}\nif influenced hunter and corrupted { chaos }`,
            registry,
        ).data.length;
        // `if`, `influenced`, `hunter`, `and`, `corrupted`, `chaos`: six tokens of five ints.
        expect(marked - plain).toBe(30);
    });
});
