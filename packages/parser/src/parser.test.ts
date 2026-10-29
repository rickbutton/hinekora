import { describe, expect, it } from "vitest";
import type { Craft, IfStmt, Stmt, UntilStmt } from "@hinekora/core";
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

const CANONICAL = `
item {
    base: "Cobalt Jewel"
    ilvl: 82
    rarity: rare
    prefixes: [ "random prefix", "+1 Suffix Modifier" ]
    suffixes: [ "random suffix", "random suffix" ]
}

exalt

until not has "+1 Suffix Modifier" {
    annul
}
`;

describe("parser — the canonical craft (surface §8)", () => {
    const craft = parseOk(CANONICAL);

    it("reads the item block with defaults for omitted optionals", () => {
        expect(craft.item).toMatchObject({
            base: "Cobalt Jewel",
            ilvl: 82,
            rarity: "rare",
            prefixes: [{ mod: "random prefix" }, { mod: "+1 Suffix Modifier" }],
            suffixes: [{ mod: "random suffix" }, { mod: "random suffix" }],
        });
    });

    it("parses a `t1` tier on a declared affix", () => {
        const c = parseOk(
            `item { base: "R" ilvl: 84 rarity: rare prefixes: [ "maximum life" t1, "random" ] }`,
        );
        expect(c.item.prefixes).toEqual([{ mod: "maximum life", tier: 1 }, { mod: "random" }]);
    });

    it("parses the body: an op, then an until-loop", () => {
        expect(craft.body).toHaveLength(2);
        expect(craft.body[0]).toMatchObject({ kind: "operation", words: ["exalt"] });

        const until = craft.body[1] as UntilStmt;
        expect(until.kind).toBe("until");
        expect(until.pred).toMatchObject({
            kind: "not",
            inner: { kind: "has", mod: "+1 Suffix Modifier" },
        });
        expect(until.body).toEqual([
            expect.objectContaining({ kind: "operation", words: ["annul"] }),
        ]);
    });
});

describe("parser — the item block comes first", () => {
    it("requires the item block before anything else", () => {
        expect(parseErr('exalt item { base: "R" ilvl: 1 rarity: rare }').message).toMatch(
            /expected 'item'/,
        );
    });

    it("points a file that still opens with the old header at the change", () => {
        expect(parseErr('craft in poe1 item { base: "R" ilvl: 1 rarity: rare }').message).toMatch(
            /'craft in poe1' header is no longer written/,
        );
    });

    it("parses a body directly at file scope (no wrapping braces)", () => {
        const craft = parseOk('item { base: "R" ilvl: 1 rarity: rare } exalt regal exalt');
        expect(
            craft.body.map((s) => (s.kind === "operation" ? s.words.join(" ") : s.kind)),
        ).toEqual(["exalt", "regal", "exalt"]);
    });

    it("rejects a stray closing brace at the top level", () => {
        expect(parseErr('item { base: "R" ilvl: 1 rarity: rare } exalt }').message).toMatch(
            /expected end of input/,
        );
    });
});

describe("parser — item block", () => {
    it("defaults the affix lists to empty", () => {
        const craft = parseOk(`    item {
        base: "Vaal Regalia"
        ilvl: 86
        rarity: normal
    }
    transmute`);
        expect(craft.item).toMatchObject({ base: "Vaal Regalia", prefixes: [], suffixes: [] });
    });

    it("normalizes rarity case-insensitively", () => {
        expect(parseOk('item { base: "R" ilvl: 1 rarity: RARE } exalt').item.rarity).toBe("rare");
    });

    it("rejects a missing required field", () => {
        expect(parseErr('item { base: "R" rarity: rare } exalt').message).toMatch(/missing 'ilvl'/);
    });

    it("rejects an unknown field", () => {
        expect(parseErr('item { base: "R" ilvl: 1 rarity: rare foo: 2 } exalt').message).toMatch(
            /unknown item field 'foo'/,
        );
    });

    it("rejects a duplicate field", () => {
        expect(parseErr('item { base: "R" base: "S" ilvl: 1 rarity: rare } exalt').message).toMatch(
            /duplicate item field 'base'/,
        );
    });

    it("reads the marks: one or two influences, and the bare corrupted flag", () => {
        const one = parseOk(
            'item { base: "R" ilvl: 1 rarity: rare influences: hunter } exalt',
        ).item;
        expect(one.influences).toEqual(["hunter"]);
        expect(one.corrupted).toBe(false);
        const two = parseOk(
            'item { base: "R" ilvl: 1 rarity: rare influences: shaper elder corrupted } exalt',
        ).item;
        expect(two.influences).toEqual(["shaper", "elder"]);
        expect(two.corrupted).toBe(true);
        expect(parseOk('item { base: "R" ilvl: 1 rarity: rare } exalt').item).toMatchObject({
            influences: [],
            corrupted: false,
        });
    });

    it("rejects an unknown, repeated or third influence", () => {
        expect(
            parseErr('item { base: "R" ilvl: 1 rarity: rare influences: hunters } exalt').message,
        ).toMatch(/expected an influence after 'influences' \(shaper, elder/);
        expect(
            parseErr('item { base: "R" ilvl: 1 rarity: rare influences: hunter hunter } exalt')
                .message,
        ).toMatch(/'hunter' is listed twice/);
        expect(
            parseErr(
                'item { base: "R" ilvl: 1 rarity: rare influences: hunter shaper elder } exalt',
            ).message,
        ).toMatch(/at most two influences/);
    });

    it("parses the influenced and corrupted predicates", () => {
        const c = parseOk(
            'item { base: "R" ilvl: 1 rarity: rare } if influenced hunter { exalt } if influenced and not corrupted { exalt }',
        );
        expect(c.body[0]).toMatchObject({ pred: { kind: "influenced", influence: "hunter" } });
        expect(c.body[1]).toMatchObject({
            pred: {
                kind: "and",
                left: { kind: "influenced" },
                right: { kind: "not", inner: { kind: "corrupted" } },
            },
        });
        expect((c.body[1] as IfStmt).pred).not.toHaveProperty("left.influence");
    });
});

/** An operation statement as `{ words, args }`, a tier written `t<n>`, a param `$<p>`. */
const shape = (s: Stmt): { words: string; args: (string | number)[] } => {
    if (s.kind !== "operation") throw new Error(`expected an operation, got ${s.kind}`);
    return {
        words: s.words.join(" "),
        args: s.args.map((a) =>
            a.kind === "tier" ? `t${a.value}` : a.kind === "param" ? `$${a.param}` : a.value,
        ),
    };
};

describe("parser — operation statements, shaped by the method table", () => {
    const bodyOf = (src: string) =>
        parseOk(`item { base: "R" ilvl: 1 rarity: rare } ${src}`).body[0]!;
    const opOf = (src: string) => shape(bodyOf(src));

    it("parses a name slot with and without its optional tier", () => {
        expect(opOf('essence "Deafening Essence of Greed"')).toEqual({
            words: "essence",
            args: ["Deafening Essence of Greed"],
        });
        expect(opOf('essence "greed" t1')).toEqual({ words: "essence", args: ["greed", "t1"] });
        expect(opOf('bench "increased life"')).toEqual({
            words: "bench",
            args: ["increased life"],
        });
        expect(opOf('bench "life" t2')).toEqual({ words: "bench", args: ["life", "t2"] });
    });

    it("takes the longest run of words that names a method", () => {
        expect(opOf("bench remove")).toEqual({ words: "bench remove", args: [] });
        expect(opOf("veiled chaos")).toEqual({ words: "veiled chaos", args: [] });
        expect(opOf("foulborn regal")).toEqual({ words: "foulborn regal", args: [] });
        expect(opOf("beast fracture")).toEqual({ words: "beast fracture", args: [] });
        expect(opOf("restore")).toEqual({ words: "restore", args: [] });
    });

    it("rejects a second word no method of the family has", () => {
        expect(() => bodyOf("veiled scour")).toThrow(/'chaos', 'exalt'/);
        expect(() => bodyOf("foulborn chaos")).toThrow(/'augment', 'regal', 'exalt'/);
        expect(() => bodyOf('harvest remove "cold"')).toThrow(/'reforge', 'augment', 'change'/);
    });

    it("parses a word slot and an optional number", () => {
        expect(opOf("beast add prefix")).toEqual({ words: "beast add", args: ["prefix"] });
        expect(opOf("beast add suffix 83")).toEqual({ words: "beast add", args: ["suffix", 83] });
        expect(() => bodyOf("beast add tail")).toThrow(/'prefix' or 'suffix'/);
    });

    it("parses two name slots, a list of names, and an optional name", () => {
        expect(opOf('harvest change "fire res" "cold res"')).toEqual({
            words: "harvest change",
            args: ["fire res", "cold res"],
        });
        expect(() => bodyOf('harvest change "fire res"')).toThrow(
            /quoted mod name after 'harvest change "fire res"'/,
        );
        expect(opOf('fossil "pristine"')).toEqual({ words: "fossil", args: ["pristine"] });
        expect(opOf('fossil "pristine" "dense"')).toEqual({
            words: "fossil",
            args: ["pristine", "dense"],
        });
        expect(() => bodyOf("fossil")).toThrow(/a quoted fossil name after 'fossil'/);
    });

    it("names a missing argument in the guide's words, without a token at the end", () => {
        expect(() => bodyOf("bench")).toThrow(/a quoted bench craft after 'bench'$/);
        expect(() => bodyOf("harvest reforge 3")).toThrow(/a quoted modifier type/);
        expect(() => bodyOf("beast add")).toThrow(/'prefix' or 'suffix' after 'beast add'$/);
        expect(() => bodyOf("beast add 3")).toThrow(
            /'prefix' or 'suffix' after 'beast add', not '3'/,
        );
        expect(() => bodyOf("beast")).toThrow(/after 'beast' expected one of 'add'.*'imprint'$/);
        expect(opOf("unveil")).toEqual({ words: "unveil", args: [] });
        expect(opOf('unveil "double damage"')).toEqual({
            words: "unveil",
            args: ["double damage"],
        });
        expect(opOf('beast aspect "cat"')).toEqual({ words: "beast aspect", args: ["cat"] });
        expect(opOf('harvest reforge "fire"')).toEqual({
            words: "harvest reforge",
            args: ["fire"],
        });
    });

    it("keeps a lone word no method knows, for the checker to name", () => {
        expect(opOf("bogus")).toEqual({ words: "bogus", args: [] });
    });

    it("parses a param in a name slot inside a proc", () => {
        const c = parseOk(
            `item { base: "R" ilvl: 1 rarity: rare } def h(t) { harvest reforge t }
h("fire")`,
        );
        expect(shape(c.procs[0]!.body[0]!)).toEqual({ words: "harvest reforge", args: ["$t"] });
    });
});

describe("parser — predicate defs", () => {
    const parseDef = (src: string): Craft =>
        parseOk(`item { base: "R" ilvl: 1 rarity: rare } ${src}`);

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

describe("parser — operation functions", () => {
    const parseDef = (src: string): Craft =>
        parseOk(`item { base: "R" ilvl: 1 rarity: rare } ${src}`);

    it("collects a `def name(p) { … }` as a proc, separate from preds and body", () => {
        const c = parseDef(`def spam(m) { until has m { scour alchemy } }
spam("life")`);
        expect(c.defs).toHaveLength(0);
        expect(c.procs).toHaveLength(1);
        expect(c.procs[0]).toMatchObject({ kind: "procDef", name: "spam", params: ["m"] });
        // `m` in the loop guard is a parameter reference.
        expect(c.procs[0]!.body[0]).toMatchObject({
            kind: "until",
            pred: { kind: "has", mod: { param: "m" } },
            body: [
                { kind: "operation", words: ["scour"] },
                { kind: "operation", words: ["alchemy"] },
            ],
        });
        // The call site parses as a statement-position call.
        expect(c.body[0]).toMatchObject({
            kind: "call",
            name: "spam",
            args: [{ kind: "string", value: "life" }],
        });
    });

    it("dispatches def body on `{` vs `=` (proc vs predicate)", () => {
        const c = parseDef(`def p(t) = has "life" t
def q() { exalt }`);
        expect(c.defs).toHaveLength(1);
        expect(c.procs).toHaveLength(1);
        expect(c.procs[0]).toMatchObject({ name: "q", params: [] });
    });

    it("parses a param in a bench mod-name slot", () => {
        const c = parseDef(`def add(m) { bench m }
add("life")`);
        expect(shape(c.procs[0]!.body[0]!)).toEqual({ words: "bench", args: ["$m"] });
    });

    it("parses a param in an essence tier slot", () => {
        const c = parseDef(`def e(k) { essence "greed" k }
e(t1)`);
        expect(shape(c.procs[0]!.body[0]!)).toEqual({ words: "essence", args: ["greed", "$k"] });
    });

    it("still parses a bare currency name as an operation, not a call", () => {
        const c = parseDef(`exalt`);
        expect(c.body[0]).toMatchObject({ kind: "operation", words: ["exalt"] });
    });
});

describe("parser — predicates", () => {
    const wrap = (pred: string): Craft =>
        parseOk(`item { base: "R" ilvl: 1 rarity: rare } until ${pred} { exalt }`);

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
            parseErr('item { base: "R" ilvl: 1 rarity: rare } until wat { exalt }').message,
        ).toMatch(/expected a predicate/);
    });
});

describe("parser — if / else", () => {
    it("attaches an else to its if", () => {
        const craft = parseOk(`    item { base: "R" ilvl: 1 rarity: rare }
    if isRare { exalt } else { annul }`);
        const branch = craft.body[0] as IfStmt;
        expect(branch.kind).toBe("if");
        expect(branch.body).toEqual([expect.objectContaining({ words: ["exalt"] })]);
        expect(branch.elseBody).toEqual([expect.objectContaining({ words: ["annul"] })]);
    });

    it("allows an if with no else, followed by a sibling statement", () => {
        const craft = parseOk(`    item { base: "R" ilvl: 1 rarity: rare }
    if isRare { exalt }
    annul`);
        expect(craft.body).toHaveLength(2);
        const branch = craft.body[0] as IfStmt;
        expect(branch.elseBody).toBeUndefined();
        expect(craft.body[1]).toMatchObject({ kind: "operation", words: ["annul"] });
    });

    it("rejects an else with no matching if", () => {
        expect(parseErr('item { base: "R" ilvl: 1 rarity: rare } else { exalt }').message).toMatch(
            /'else' without a matching 'if'/,
        );
    });

    it("parses an empty block", () => {
        const craft = parseOk('item { base: "R" ilvl: 1 rarity: rare } if isRare {}');
        expect((craft.body[0] as IfStmt).body).toEqual([]);
    });
});

describe("parser — comments and error spans", () => {
    it("ignores comments and blank lines", () => {
        const craft = parseOk(`# a guide


    item { base: "R" ilvl: 1 rarity: rare }   # the item

    exalt   # slam it
`);
        expect(craft.body).toEqual([
            expect.objectContaining({ kind: "operation", words: ["exalt"] }),
        ]);
    });

    it("reports a useful span on error", () => {
        const err = parseErr(`    item { base: "R" ilvl: 1 rarity: rare }
    until isRare exalt`);
        // Missing '{' after the until predicate — the next token is 'exalt' on line 2.
        expect(err.message).toMatch(/expected '\{'/);
        expect(err.span.start.line).toBe(2);
    });
});
