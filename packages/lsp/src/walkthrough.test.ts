import { describe, expect, it } from "vitest";
import {
    clause,
    criteria,
    type Criterion,
    itemDelta,
    itemView,
    renderItemText,
    stepDelta,
    strandsText,
    walkthrough,
} from "@hinekora/core";
import { loadDefaultPoe1, registryOf } from "@hinekora/data";
import { checkCached, parseCached } from "./analysis.js";

const registry = registryOf(loadDefaultPoe1());

/** The walkthrough of a guide, which must parse. */
const walk = (source: string) => {
    const parsed = parseCached(source);
    if (!parsed.ok) throw new Error(parsed.error.message);
    return walkthrough(parsed.craft, checkCached(source, registry)!, registry);
};

describe("the walkthrough", () => {
    it("starts with the declared item and lists one step per statement with its states", () => {
        const w = walk(`item { base: "Iron Ring" ilvl: 84 rarity: normal }\ntransmute\nregal`);
        expect(itemView(w.start.item!, registry).rarities).toEqual(["normal"]);
        expect(w.steps.map((s) => s.kind)).toEqual(["operation", "operation"]);
        const regal = w.steps[1]!;
        if (regal.kind !== "operation") throw new Error("expected an operation");
        expect(regal.title).toBe("Regal Orb");
        expect(regal.text).toBe("regal");
        expect(regal.detail).toMatch(/^Upgrades a magic item/);
        expect(regal.words).toEqual(["regal"]);
        expect(itemView(regal.before!, registry).rarities).toEqual(["magic"]);
        expect(itemView(regal.after!, registry).rarities).toEqual(["rare"]);
        expect(regal.problems).toEqual([]);
    });

    it("nests a loop's body and words its exit, and a branch's arms", () => {
        const w = walk(`item { base: "Iron Ring" ilvl: 84 rarity: rare }
until has "maximum life" t1 or has "fire resistance" t1 {
    chaos
    if not has "maximum life" { annul } else { restart }
}`);
        const loop = w.steps[0]!;
        if (loop.kind !== "loop") throw new Error("expected a loop");
        expect(loop.condition).toBe('(has "maximum life" t1 or has "fire resistance" t1)');
        expect(loop.body.map((s) => s.kind)).toEqual(["operation", "branch"]);
        const branch = loop.body[1]!;
        if (branch.kind !== "branch") throw new Error("expected a branch");
        expect(branch.condition).toBe('not has "maximum life"');
        expect(branch.then.map((s) => s.kind)).toEqual(["operation"]);
        expect(branch.else?.map((s) => s.kind)).toEqual(["restart"]);
        // The loop's after-state is the proven exit; the restart has none.
        expect(loop.after).toBeDefined();
        expect(branch.else![0]!.after).toBeUndefined();
    });

    it("narrows a modifier's span to the value the guide proved", () => {
        const w = walk(`item { base: "Vaal Regalia" ilvl: 86 rarity: rare }
until has "maximum life" >= 150 { chaos }`);
        const loop = w.steps[0]!;
        const life = itemView(loop.after!, registry).prefixes.find(
            (g) => g.kind === "mod" && /maximum Life/.test(g.mod.text),
        );
        if (life === undefined || life.kind !== "mod") throw new Error("expected life");
        expect(life.mod.text).toMatch(/^\+\(150-\d+\) to maximum Life$/);
    });

    it("never shows a value outside the span of the tier it is pinned to", () => {
        const lifeText = (src: string): string => {
            const w = walk(src);
            const branch = w.steps[w.steps.length - 1]!;
            if (branch.kind !== "branch") throw new Error("expected a branch");
            const inside = branch.then[0]!;
            const life = itemView(inside.before!, registry).prefixes.find(
                (g) => g.kind === "mod" && /maximum Life/.test(g.mod.text),
            );
            if (life === undefined || life.kind !== "mod") throw new Error("expected life");
            return life.mod.text;
        };
        const plain = lifeText(`item { base: "Vaal Regalia" ilvl: 86 rarity: rare }
until has "maximum life" { chaos }
if has "maximum life" t1 { chaos }`);
        const valued = lifeText(`item { base: "Vaal Regalia" ilvl: 86 rarity: rare }
until has "maximum life" >= 100 { chaos }
if has "maximum life" t1 { chaos }`);
        expect(valued).toBe(plain);
    });

    it("writes the memory strands as a range once some may be spent", () => {
        expect(strandsText([82, 82])).toBe("82");
        expect(strandsText([40, 82])).toBe("40-82");
    });

    it("carries the memory strands and the second items the guide declares", () => {
        const w = walk(`item { base: "Vaal Regalia" ilvl: 86 rarity: rare strands: 82 }
with donor { base: "Vaal Regalia" ilvl: 86 rarity: rare }
chaos`);
        const view = itemView(w.start.item!, registry);
        expect(view.strands).toEqual([82, 82]);
        expect(renderItemText(view)).toContain("Item Level: 86\nMemory Strands: 82");
        expect(w.donors.map((d) => d.name)).toEqual(["donor"]);
        expect(w.donors[0]!.item).toBeDefined();
        expect(w.donors[0]!.span.start.line).toBe(2);
    });

    it("reads an earlier item the same whatever a later step does", () => {
        const head = `item { base: "Vaal Regalia" ilvl: 84 rarity: normal }
transmute
regal
until has "fire res" t1 or has "cold res" t1 or has "light res" t1 { annul exalt }`;
        const exit = (src: string): string => {
            const loop = walk(src).steps.find((s) => s.kind === "loop")!;
            return itemView(loop.after!, registry)
                .suffixes.map((g) => g.kind)
                .join(",");
        };
        expect(exit(head)).toBe("oneOf");
        expect(exit(`${head}\nif prefixCount == 0 { bench "maximum life" }`)).toBe("oneOf");
        // A later step naming a second tier of a member keeps the group's pins.
        const pinned = (src: string): string => {
            const loop = walk(src).steps.find((s) => s.kind === "loop")!;
            const group = itemView(loop.after!, registry).suffixes[0]!;
            if (group.kind !== "oneOf") throw new Error("expected a group");
            return group.members.map((m) => m.tier?.join("-") ?? "?").join(",");
        };
        expect(pinned(head)).toBe("1-1,1-1,1-1");
        expect(pinned(`${head}\nif has "fire res" t2 { exalt }`)).toBe("1-1,1-1,1-1");
    });

    it("words an eldritch implicit from the rows of its tier, and a whole pool as one line", () => {
        const known = walk(
            `item { base: "Iron Gauntlets" ilvl: 84 rarity: rare exarch: grand "increased attack speed" }\nexalt`,
        );
        const [implicit] = itemView(known.start.item!, registry).implicits;
        expect(implicit!.side).toBe("exarch");
        expect(implicit!.tiers).toEqual(["Grand"]);
        // The wording names the plain implicit at the Grand row's value; its
        // presence variants are wordings of their own.
        expect(implicit!.texts).toEqual(["10% increased Attack Speed"]);
        const presence = walk(
            `item { base: "Iron Gauntlets" ilvl: 84 rarity: rare exarch: grand "unique enemy attack speed" }
exalt`,
        );
        expect(itemView(presence.start.item!, registry).implicits[0]!.texts).toEqual([
            "While a Unique Enemy is in your Presence, 14% increased Attack Speed",
        ]);

        const drawn = walk(`item { base: "Iron Gauntlets" ilvl: 84 rarity: rare }\nember grand`);
        const view = itemView(drawn.steps[0]!.after!, registry);
        expect(view.implicits[0]!.texts.length).toBeGreaterThan(6);
        expect(renderItemText(view)).toMatch(
            /\{ Searing Exarch Implicit Modifier \(Tier: Grand\) \}\none of \d+ Searing Exarch implicits \(exarch implicit\)/,
        );
    });

    it("gives a finding to the innermost statement that contains it", () => {
        const w = walk(`item { base: "Iron Ring" ilvl: 84 rarity: rare }
until has "maximum life" {
    chaos
    exalt
}`);
        const loop = w.steps[0]!;
        if (loop.kind !== "loop") throw new Error("expected a loop");
        expect(loop.problems).toEqual([]);
        expect(loop.body[1]!.problems.some((m) => m.includes("open affix slot"))).toBe(true);
    });

    it("words a call and a method with arguments as written", () => {
        const w = walk(`item { base: "Iron Ring" ilvl: 84 rarity: rare }
def spam(m) { until has m { chaos } }
spam("maximum life")
bench "cold resistance"`);
        const call = w.steps[0]!;
        expect(call.kind === "call" && call.text).toBe('spam("maximum life")');
        const bench = w.steps[1]!;
        if (bench.kind !== "operation") throw new Error("expected an operation");
        expect(bench.text).toBe('bench "cold resistance"');
        expect(bench.title).toBe("bench");
        expect(bench.detail).toContain("craft a modifier at the bench");
    });

    it("tells what a step added and removed", () => {
        const w = walk(`item { base: "Iron Ring" ilvl: 84 rarity: normal }\ntransmute\nregal`);
        const d = stepDelta(w.steps[1]!, registry)!;
        expect(d.added).toContain("Rare");
        expect(d.removed).toContain("Magic");
        const v = itemView(w.start.item!, registry);
        expect(itemDelta(v, v)).toEqual({ added: [], removed: [] });
    });
});

describe("a condition in the player's words", () => {
    const parsedLoop = (pred: string) => {
        const src = `item { base: "Iron Ring" ilvl: 84 rarity: rare }
def both() = has "maximum life" and has "cold resistance"
def few() = prefixCount <= 1
def eleRes(t) = has "fire resistance" t or has "cold resistance" t
until ${pred} { chaos }`;
        const parsed = parseCached(src);
        if (!parsed.ok) throw new Error(parsed.error.message);
        const loop = parsed.craft.body[0]!;
        if (loop.kind !== "until") throw new Error("expected a loop");
        const base = registry.resolveBase("Iron Ring");
        if (!base.ok) throw new Error("no ring");
        return { pred: loop.pred, craft: parsed.craft, wording: { base: base.value, ilvl: 84 } };
    };
    const words = (pred: string): string => {
        const { pred: p, craft, wording } = parsedLoop(pred);
        return clause(p, craft, registry, wording);
    };
    const list = (pred: string): Criterion => {
        const { pred: p, craft, wording } = parsedLoop(pred);
        return criteria(p, craft, registry, wording);
    };

    it("turns a negated count round and says 'no' for a modifier", () => {
        expect(words("not prefixCount == 2")).toBe("not exactly 2 prefixes");
        expect(words("not suffixCount <= 2")).toBe("more than 2 suffixes");
        expect(words('not has "maximum life"')).toBe("no +# to maximum Life");
        expect(words("not both()")).toBe("not (+# to maximum Life and +#% to Cold Resistance)");
    });

    it("parenthesises only a mixed connective and expands a local predicate in place", () => {
        expect(words('both() or has "fire resistance"')).toBe(
            "(+# to maximum Life and +#% to Cold Resistance) or +#% to Fire Resistance",
        );
        expect(words("both() and few()")).toBe(
            "+# to maximum Life and +#% to Cold Resistance and at most 1 prefix",
        );
        expect(words("eleRes(t1)")).toBe(
            "+#% to Fire Resistance at T1 or +#% to Cold Resistance at T1",
        );
    });

    it("lays a condition out as a checklist, alternatives grouped", () => {
        expect(list('both() and eleRes(t1) and not has "chaos resistance"')).toEqual({
            kind: "all",
            items: [
                { kind: "leaf", text: "+# to maximum Life", negated: false },
                { kind: "leaf", text: "+#% to Cold Resistance", negated: false },
                {
                    kind: "any",
                    items: [
                        { kind: "leaf", text: "+#% to Fire Resistance (T1)", negated: false },
                        { kind: "leaf", text: "+#% to Cold Resistance (T1)", negated: false },
                    ],
                },
                { kind: "leaf", text: "+#% to Chaos Resistance", negated: true },
            ],
        });
        expect(list("not prefixCount == 2")).toEqual({
            kind: "leaf",
            text: "not exactly 2 prefixes",
            negated: false,
        });
    });

    it("folds every pair of a set into 'at least two of', and nothing less", () => {
        const pairs = (...ps: [string, string][]): string =>
            ps.map(([a, b]) => `(has "${a}" and has "${b}")`).join(" or ");
        const all = list(
            pairs(
                ["fire resistance", "cold resistance"],
                ["fire resistance", "lightning resistance"],
                ["cold resistance", "lightning resistance"],
            ),
        );
        expect(all.kind).toBe("atLeast");
        if (all.kind !== "atLeast") throw new Error("expected at least");
        expect(all.count).toBe(2);
        expect(all.items.map((l) => l.text)).toEqual([
            "+#% to Fire Resistance",
            "+#% to Cold Resistance",
            "+#% to Lightning Resistance",
        ]);
        const some = list(
            pairs(
                ["fire resistance", "cold resistance"],
                ["fire resistance", "lightning resistance"],
            ),
        );
        expect(some.kind).toBe("any");
    });
});
