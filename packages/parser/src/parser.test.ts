import { describe, expect, it } from "vitest";
import type { Craft, IfStmt, UntilStmt, WithOmenStmt } from "@hinekora/core";
import { parse } from "./index.js";
import type { SyntaxDiagnostic } from "./errors.js";

function parseOk(src: string): Craft {
    const r = parse(src);
    if (!r.ok) throw new Error(`expected parse success, got: ${r.error.message}`);
    return r.craft;
}

function parseErr(src: string): SyntaxDiagnostic {
    const r = parse(src);
    if (r.ok) throw new Error("expected parse failure");
    return r.error;
}

const CANONICAL = `craft in poe2

item {
    base: "Cobalt Jewel"
    ilvl: 82
    rarity: rare
    prefixes: [ "random prefix", "+1 Suffix Modifier" ]
    suffixes: [ "random suffix", "random suffix" ]
}

exalt

with omen "Sinistral Annulment" {
    until not has "+1 Suffix Modifier" {
        annul
    }
}
`;

describe("parser — the canonical craft (surface §8)", () => {
    const craft = parseOk(CANONICAL);

    it("reads the game from the top-level declaration", () => {
        expect(craft.game).toBe("poe2");
    });

    it("reads the item block with defaults for omitted optionals", () => {
        expect(craft.item).toMatchObject({
            base: "Cobalt Jewel",
            ilvl: 82,
            rarity: "rare",
            prefixes: ["random prefix", "+1 Suffix Modifier"],
            suffixes: ["random suffix", "random suffix"],
            augments: [],
            quality: 0,
        });
    });

    it("parses the body: an op, then an omen scope wrapping an until-loop", () => {
        expect(craft.body).toHaveLength(2);
        expect(craft.body[0]).toMatchObject({ kind: "op", name: "exalt" });

        const withOmen = craft.body[1] as WithOmenStmt;
        expect(withOmen.kind).toBe("withOmen");
        expect(withOmen.omen).toBe("Sinistral Annulment");
        expect(withOmen.body).toHaveLength(1);

        const until = withOmen.body[0] as UntilStmt;
        expect(until.kind).toBe("until");
        expect(until.pred).toMatchObject({
            kind: "not",
            inner: { kind: "has", mod: "+1 Suffix Modifier" },
        });
        expect(until.body).toEqual([expect.objectContaining({ kind: "op", name: "annul" })]);
    });
});

describe("parser — the craft declaration comes first", () => {
    it("requires `craft in <game>` before anything else", () => {
        expect(
            parseErr('exalt craft in poe1 item { base: "R" ilvl: 1 rarity: rare }').message,
        ).toMatch(/expected 'craft'/);
    });

    it("requires the item block right after the declaration", () => {
        expect(parseErr("craft in poe1 exalt").message).toMatch(/expected 'item'/);
    });

    it("parses a body directly at file scope (no wrapping braces)", () => {
        const craft = parseOk(
            'craft in poe1 item { base: "R" ilvl: 1 rarity: rare } exalt regal exalt',
        );
        expect(craft.body.map((s) => (s.kind === "op" ? s.name : s.kind))).toEqual([
            "exalt",
            "regal",
            "exalt",
        ]);
    });

    it("rejects a stray closing brace at the top level", () => {
        expect(
            parseErr('craft in poe1 item { base: "R" ilvl: 1 rarity: rare } exalt }').message,
        ).toMatch(/expected end of input/);
    });
});

describe("parser — item block", () => {
    it("accepts all fields including augments and quality", () => {
        const craft = parseOk(`craft in poe1
    item {
        base: "Vaal Regalia"
        ilvl: 86
        rarity: normal
        augments: [ "can roll Marksman" ]
        quality: 20
    }
    transmute`);
        expect(craft.item).toMatchObject({
            base: "Vaal Regalia",
            augments: ["can roll Marksman"],
            quality: 20,
            prefixes: [],
            suffixes: [],
        });
    });

    it("normalizes rarity case-insensitively", () => {
        expect(
            parseOk('craft in poe1 item { base: "R" ilvl: 1 rarity: RARE } exalt').item.rarity,
        ).toBe("rare");
    });

    it("rejects a missing required field", () => {
        expect(parseErr('craft in poe1 item { base: "R" rarity: rare } exalt').message).toMatch(
            /missing 'ilvl'/,
        );
    });

    it("rejects an unknown field", () => {
        expect(
            parseErr('craft in poe1 item { base: "R" ilvl: 1 rarity: rare foo: 2 } exalt').message,
        ).toMatch(/unknown item field 'foo'/);
    });

    it("rejects a duplicate field", () => {
        expect(
            parseErr('craft in poe1 item { base: "R" base: "S" ilvl: 1 rarity: rare } exalt')
                .message,
        ).toMatch(/duplicate item field 'base'/);
    });
});

describe("parser — essence statement", () => {
    const bodyOf = (pred: string) =>
        parseOk(`craft in poe1 item { base: "R" ilvl: 1 rarity: normal } ${pred}`).body[0]!;

    it("parses a full essence name", () => {
        const s = bodyOf('essence "Deafening Essence of Greed"');
        expect(s).toMatchObject({ kind: "essence", name: "Deafening Essence of Greed" });
        expect("tier" in s).toBe(false);
    });

    it("parses the `type t1` shorthand", () => {
        expect(bodyOf('essence "greed" t1')).toMatchObject({
            kind: "essence",
            name: "greed",
            tier: 1,
        });
    });

    it("parses a bench craft, with and without a tier", () => {
        expect(bodyOf('bench "increased life"')).toMatchObject({
            kind: "bench",
            name: "increased life",
        });
        expect(bodyOf('bench "life" t2')).toMatchObject({ kind: "bench", name: "life", tier: 2 });
    });
});

describe("parser — predicate defs", () => {
    const parseDef = (src: string): Craft =>
        parseOk(`craft in poe1 item { base: "R" ilvl: 1 rarity: rare } ${src}`);

    it("collects defs separately from the body, with a param in the tier slot", () => {
        const c = parseDef(`def anyEleRes(t) = has "fire res" t or has "cold res" t
until anyEleRes(t1) { exalt }`);
        expect(c.defs).toHaveLength(1);
        expect(c.defs[0]).toMatchObject({ kind: "def", name: "anyEleRes", params: ["t"] });
        // `t` in the tier slot is a parameter reference, not a literal tier.
        const body = c.defs[0]!.body;
        expect(body).toMatchObject({
            kind: "or",
            left: { kind: "has", mod: "fire res", tier: { param: "t" } },
        });
        // The call site — `t1` is a tier argument (its own sort, not a bare int).
        expect(c.body[0]).toMatchObject({
            kind: "until",
            pred: { kind: "call", name: "anyEleRes", args: [{ kind: "tier", value: 1 }] },
        });
    });

    it("distinguishes a `t1` tier argument from a bare-int count argument", () => {
        const c = parseDef(`def hasIt(m) = has m
until hasIt("life") { exalt }`);
        expect(c.defs[0]!.body).toMatchObject({ kind: "has", mod: { param: "m" } });

        const c2 = parseDef(`def eleRes(t) = has "fire res" t
until eleRes(t1) { exalt }`);
        expect(c2.body[0]).toMatchObject({
            pred: { kind: "call", args: [{ kind: "tier", value: 1 }] },
        });
        const c3 = parseDef(`def few(n) = prefixCount < n
until few(2) { exalt }`);
        expect(c3.body[0]).toMatchObject({
            pred: { kind: "call", args: [{ kind: "int", value: 2 }] },
        });
    });

    it("parses a parameter passed through to a nested call", () => {
        const c = parseDef(`def eleRes(t) = has "fire res" t
def anyEle(t) = eleRes(t)
until anyEle(1) { exalt }`);
        // In `anyEle`, the argument to `eleRes` is the param `t`, not a literal.
        expect(c.defs[1]!.body).toMatchObject({
            kind: "call",
            name: "eleRes",
            args: [{ kind: "param", param: "t" }],
        });
    });

    it("rejects a bare `=` used as equality and vice versa", () => {
        // `def` needs a single `=`; a comparison still needs `==`.
        expect(() => parseDef(`def f(x) == has "life" x`)).toThrow();
    });
});

describe("parser — predicates", () => {
    const wrap = (pred: string): Craft =>
        parseOk(`craft in poe1 item { base: "R" ilvl: 1 rarity: rare } until ${pred} { exalt }`);

    const predOf = (craft: Craft) => (craft.body[0] as UntilStmt).pred;

    it("parses niladic rarity predicates", () => {
        expect(predOf(wrap("isRare"))).toMatchObject({ kind: "isRarity", rarity: "rare" });
        expect(predOf(wrap("isMagic"))).toMatchObject({ kind: "isRarity", rarity: "magic" });
        expect(predOf(wrap("isNormal"))).toMatchObject({ kind: "isRarity", rarity: "normal" });
    });

    it("parses a has with a tier qualifier", () => {
        expect(predOf(wrap('has "maximum life" t1'))).toMatchObject({
            kind: "has",
            mod: "maximum life",
            tier: 1,
        });
        // Without the qualifier, tier is absent (any tier).
        expect("tier" in predOf(wrap('has "maximum life"'))).toBe(false);
    });

    it("parses has, count comparisons, and negation", () => {
        expect(predOf(wrap('has "T1 Life"'))).toMatchObject({ kind: "has", mod: "T1 Life" });
        expect(predOf(wrap("prefixCount == 3"))).toMatchObject({
            kind: "compare",
            projection: "prefixCount",
            op: "==",
            value: 3,
        });
        expect(predOf(wrap('not has "X"'))).toMatchObject({
            kind: "not",
            inner: { kind: "has", mod: "X" },
        });
    });

    it("parses parenthesized grouping under negation", () => {
        expect(predOf(wrap("not (suffixCount < 2)"))).toMatchObject({
            kind: "not",
            inner: { kind: "compare", projection: "suffixCount", op: "<", value: 2 },
        });
    });

    it("parses `and`/`or` with `or` binding looser than `and`", () => {
        // `a or b and c` == `a or (b and c)`.
        expect(predOf(wrap('has "a" or has "b" and has "c"'))).toMatchObject({
            kind: "or",
            left: { kind: "has", mod: "a" },
            right: {
                kind: "and",
                left: { kind: "has", mod: "b" },
                right: { kind: "has", mod: "c" },
            },
        });
    });

    it("binds `not` tighter than `and`, and honors parentheses", () => {
        // `not a and b` == `(not a) and b`.
        expect(predOf(wrap('not has "a" and has "b"'))).toMatchObject({
            kind: "and",
            left: { kind: "not", inner: { kind: "has", mod: "a" } },
            right: { kind: "has", mod: "b" },
        });
        // Parens override: `not (a or b)`.
        expect(predOf(wrap('not (has "a" or has "b")'))).toMatchObject({
            kind: "not",
            inner: {
                kind: "or",
                left: { kind: "has", mod: "a" },
                right: { kind: "has", mod: "b" },
            },
        });
    });

    it("rejects a bogus predicate", () => {
        expect(
            parseErr('craft in poe1 item { base: "R" ilvl: 1 rarity: rare } until wat { exalt }')
                .message,
        ).toMatch(/expected a predicate/);
    });
});

describe("parser — if / else", () => {
    it("attaches an else to its if", () => {
        const craft = parseOk(`craft in poe1
    item { base: "R" ilvl: 1 rarity: rare }
    if isRare { exalt } else { annul }`);
        const branch = craft.body[0] as IfStmt;
        expect(branch.kind).toBe("if");
        expect(branch.body).toEqual([expect.objectContaining({ name: "exalt" })]);
        expect(branch.elseBody).toEqual([expect.objectContaining({ name: "annul" })]);
    });

    it("allows an if with no else, followed by a sibling statement", () => {
        const craft = parseOk(`craft in poe1
    item { base: "R" ilvl: 1 rarity: rare }
    if isRare { exalt }
    annul`);
        expect(craft.body).toHaveLength(2);
        const branch = craft.body[0] as IfStmt;
        expect(branch.elseBody).toBeUndefined();
        expect(craft.body[1]).toMatchObject({ kind: "op", name: "annul" });
    });

    it("rejects an else with no matching if", () => {
        expect(
            parseErr('craft in poe1 item { base: "R" ilvl: 1 rarity: rare } else { exalt }')
                .message,
        ).toMatch(/'else' without a matching 'if'/);
    });

    it("parses an empty block", () => {
        const craft = parseOk('craft in poe1 item { base: "R" ilvl: 1 rarity: rare } if isRare {}');
        expect((craft.body[0] as IfStmt).body).toEqual([]);
    });
});

describe("parser — comments and error spans", () => {
    it("rejects an unknown game", () => {
        expect(
            parseErr('craft in poe3 item { base: "R" ilvl: 1 rarity: rare } exalt').message,
        ).toMatch(/unknown game 'poe3'/);
    });

    it("ignores comments and blank lines", () => {
        const craft = parseOk(`# a guide
craft in poe1

    item { base: "R" ilvl: 1 rarity: rare }   # the item

    exalt   # slam it
`);
        expect(craft.body).toEqual([expect.objectContaining({ kind: "op", name: "exalt" })]);
    });

    it("reports a useful span on error", () => {
        const err = parseErr(`craft in poe1
    item { base: "R" ilvl: 1 rarity: rare }
    until isRare exalt`);
        // Missing '{' after the until predicate — the next token is 'exalt' on line 3.
        expect(err.message).toMatch(/expected '\{'/);
        expect(err.span.start.line).toBe(3);
    });
});
