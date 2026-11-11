import { describe, expect, it } from "vitest";
import {
    check,
    costOf,
    emptyItem,
    findMethod,
    type Gen,
    type Literal,
    type Mod,
    pool,
    rollOf,
} from "@hinekora/core";
import { parse } from "@hinekora/parser";
import { loadDefaultPoe1, registryOf } from "@hinekora/data";

// The cost layer's draw against the game's rule played out row by row over the
// same pool: modifiers drawn one at a time by weight, each closing every
// modifier group it lists (Modifier § Group/family) and a full side admitting
// no more. The bases are ones where a group holds several modifier types.
const registry = registryOf(loadDefaultPoe1());

interface Candidate {
    readonly mod: Mod;
    readonly weight: number;
    readonly gen: Gen;
}

/** A seeded generator, so a failure repeats. */
function seeded(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** The share of `trials` draws of `count()` modifiers in which `hit` holds. */
function played(
    rows: readonly Candidate[],
    count: (random: () => number) => number,
    cap: number,
    hit: (drawn: readonly Mod[]) => boolean,
    trials = 60_000,
): number {
    const random = seeded(20261110);
    const ids = new Map<string, number>();
    const families = rows.map((c) =>
        [...c.mod.families].map((f) => ids.get(f) ?? ids.set(f, ids.size).get(f)!),
    );
    const closed = new Uint8Array(ids.size);
    const live = new Uint8Array(rows.length);
    let hits = 0;
    for (let k = 0; k < trials; k++) {
        closed.fill(0);
        const held = { prefix: 0, suffix: 0 };
        const drawn: Mod[] = [];
        for (let d = count(random); d > 0; d--) {
            let total = 0;
            for (let i = 0; i < rows.length; i++) {
                const c = rows[i]!;
                live[i] = held[c.gen] < cap && !families[i]!.some((f) => closed[f]) ? 1 : 0;
                if (live[i]) total += c.weight;
            }
            if (total <= 0) break;
            let x = random() * total;
            let pick = -1;
            for (let i = 0; i < rows.length; i++) {
                if (!live[i]) continue;
                pick = i;
                if ((x -= rows[i]!.weight) < 0) break;
            }
            held[rows[pick]!.gen]++;
            for (const f of families[pick]!) closed[f] = 1;
            drawn.push(rows[pick]!.mod);
        }
        if (hit(drawn)) hits++;
    }
    return hits / trials;
}

/**
 * Whether a chance agrees with its share of `trials` played draws: within the
 * model's own allowance `off`, as a share of the chance, and three standard
 * errors of the sample, so a small sample cannot pass for a close reading.
 */
function agrees(chance: number, hits: number, trials: number, off: number): boolean {
    const exact = hits / trials;
    const error = Math.sqrt((exact * (1 - exact)) / trials);
    return Math.abs(chance - exact) <= off * exact + 3 * error;
}

/** Time for the tests that play several hundred thousand draws. */
const LONG = 60_000;

const chaosCount = (random: () => number): number => {
    const x = random() * 12;
    return x < 8 ? 4 : x < 11 ? 5 : 6;
};

/** A guide of one step and one condition: the step's roll and the chance the
 *  cost layer gives the condition after it. */
function judged(
    item: string,
    steps: readonly string[],
    condition: string,
): { rows: Candidate[]; chance: number } {
    const parsed = parse(`${item}\n${steps.join("\n")}\nif ${condition} {\n    divine\n}\n`);
    if (!parsed.ok) throw new Error(parsed.error.message);
    const result = check(parsed.craft, { registry });
    expect(result.diagnostics).toEqual([]);
    const stmt = parsed.craft.body[steps.length - 1]!;
    if (stmt.kind !== "operation") throw new Error("not a step");
    const entry = result.trace.find((e) => e.span.start.offset === stmt.span.start.offset)!;
    const literals: Literal[] = [];
    for (const arg of stmt.args) if (arg.kind !== "param") literals.push(arg);
    const ops = findMethod(stmt.words)!.build(literals, entry.before, registry);
    if ("refused" in ops) throw new Error(ops.refused);
    const roll = rollOf(entry.before, ops, registry);
    const rows =
        roll.kind === "draw"
            ? [...roll.variants[0]!.prefix, ...roll.variants[0]!.suffix].flatMap((g) =>
                  g.members.flatMap((m) => m.rows.map((r) => ({ ...r, gen: g.gen }))),
              )
            : roll.kind === "unveil"
              ? roll.options.flatMap((m) => m.rows.map((r) => ({ ...r, gen: r.mod.gen })))
              : [];
    const branch = costOf(parsed.craft, result, registry).steps.find((s) => s.kind === "if")!;
    return { rows, chance: branch.branch! };
}

const has =
    (...types: string[]) =>
    (drawn: readonly Mod[]): boolean =>
        drawn.some((m) => types.includes(m.type));

const wand = (rarity: string): string =>
    `item {\n    base: "Imbued Wand"\n    ilvl: 84\n    rarity: ${rarity}\n}`;

describe("the race against the draw played out", { timeout: LONG }, () => {
    it("a Chaos Orb on a wand, where spell damage shares its group with three elements", () => {
        const { rows, chance } = judged(wand("rare"), ["chaos"], 'has "increased spell damage"');
        const exact = played(rows, chaosCount, 3, has("WeaponSpellDamage"));
        expect(exact).toBeGreaterThan(0.24);
        expect(exact).toBeLessThan(0.26);
        expect(Math.abs(chance / exact - 1)).toBeLessThan(0.01);
    });

    const prefixes =
        (n: number) =>
        (drawn: readonly Mod[]): boolean =>
            drawn.filter((m) => m.gen === "prefix").length === n;

    it("a modifier together with its side's count, which the draw couples", () => {
        // With one prefix drawn it is likelier a heavy one, with three a
        // lighter one is likelier among them.
        const joint = (n: number) =>
            judged(wand("rare"), ["chaos"], `has "increased spell damage" and prefixCount == ${n}`);
        // One played sample counts both: three standard errors are under a
        // thirtieth of either chance, the model allowed a two-hundredth more.
        const trials = 400_000;
        const seen = [0, 0, 0, 0];
        played(
            joint(1).rows,
            chaosCount,
            3,
            (drawn) => {
                if (has("WeaponSpellDamage")(drawn))
                    seen[drawn.filter((m) => m.gen === "prefix").length]!++;
                return false;
            },
            trials,
        );
        for (const n of [1, 3]) {
            expect(agrees(joint(n).chance, seen[n]!, trials, 0.005)).toBe(true);
        }
    });

    it("a modifier of each side together, the sides taken as independent given the split", () => {
        const { rows, chance } = judged(
            wand("rare"),
            ["chaos"],
            'has "increased spell damage" and has "cast speed"',
        );
        const trials = 300_000;
        const exact = played(
            rows,
            chaosCount,
            3,
            (drawn) => has("WeaponSpellDamage")(drawn) && has("IncreasedCastSpeed")(drawn),
            trials,
        );
        // The model reads about a hundredth low here; two are allowed it.
        expect(agrees(chance, exact * trials, trials, 0.02)).toBe(true);
    });

    it("either of two modifiers of one group, which never come together", () => {
        const { rows, chance } = judged(
            wand("rare"),
            ["chaos"],
            'has "increased spell damage" or has "increased fire damage"',
        );
        const exact = played(
            rows,
            chaosCount,
            3,
            has("WeaponSpellDamage", "FireDamageWeaponPrefix"),
        );
        expect(Math.abs(chance / exact - 1)).toBeLessThan(0.02);
        const both = judged(
            wand("rare"),
            ["chaos"],
            'has "increased spell damage" and has "increased fire damage"',
        );
        expect(both.chance).toBeLessThan(1e-9);
    });

    it("an Aetheric Fossil on a wand, its caster rows ten times as heavy", () => {
        const { rows, chance } = judged(
            wand("normal"),
            ['fossil "aetheric"'],
            'has "increased spell damage"',
        );
        const exact = played(rows, chaosCount, 3, has("WeaponSpellDamage"));
        expect(exact).toBeGreaterThan(0.66);
        expect(exact).toBeLessThan(0.69);
        expect(Math.abs(chance / exact - 1)).toBeLessThan(0.02);
    });

    it("a jewel, whose damage group has rows on both sides", () => {
        const item = `item {\n    base: "Cobalt Jewel"\n    ilvl: 84\n    rarity: rare\n}`;
        const { chance } = judged(item, ["chaos"], 'has "increased spell damage"');
        const base = registry.resolveBase("Cobalt Jewel");
        if (!base.ok) throw new Error("no base");
        const rows = pool(registry.catalog, emptyItem(base.value, 84, "rare")).map((c) => ({
            ...c,
            gen: c.mod.gen,
        }));
        const count = (random: () => number): number => (random() < 0.65 ? 3 : 4);
        // One played sample counts the modifier and its joint with the count.
        const trials = 400_000;
        let alone = 0;
        let together = 0;
        played(
            rows,
            count,
            2,
            (drawn) => {
                if (!has("SpellDamageForJewel")(drawn)) return false;
                alone++;
                if (prefixes(2)(drawn)) together++;
                return false;
            },
            trials,
        );
        // Up to five hundredths low, never high: a draw the full side turns
        // away loses the group.
        expect(agrees(chance, alone, trials, 0.05)).toBe(true);
        expect(chance).toBeLessThan(alone / trials);
        const joint = judged(item, ["chaos"], 'has "increased spell damage" and prefixCount == 2');
        expect(agrees(joint.chance, together, trials, 0.05)).toBe(true);
        expect(joint.chance).toBeLessThan(together / trials);
    });

    const unveiled = (base: string, held: string, lock: string, condition: string) =>
        judged(
            `item {\n    base: "${base}"\n    ilvl: 86\n    rarity: rare\n    ${held}\n}`,
            [`bench "${lock}"`, "veiled exalt", "unveil"],
            condition,
        );
    const three = (): number => 3;

    it("an unveil's three options on a wand, seven hybrids in the caster group", () => {
        const { rows, chance } = unveiled(
            "Imbued Wand",
            'suffixes: [ "cast speed" t1, "mana regeneration rate" t1, "global critical strike multiplier" t1 ]',
            "suffixes cannot be changed",
            'has "non-chaos damage as extra chaos damage"',
        );
        const exact = played(
            rows.filter((c) => c.gen === "prefix"),
            three,
            3,
            has("SpellDamageAndNonChaosDamageToAddAsChaosDamage"),
        );
        expect(exact).toBeGreaterThan(0.13);
        expect(exact).toBeLessThan(0.155);
        expect(Math.abs(chance / exact - 1)).toBeLessThan(0.02);
    });

    it("an unveil's attribute hybrids, which list two groups each", () => {
        // Strength and Dexterity excludes Strength and Avoid Ignite as well as
        // the two other attribute pairs: no one clock holds what it closes.
        const { rows, chance } = unveiled(
            "Astral Plate",
            'prefixes: [ "maximum life" t2, "increased armour" t2, "armour" t2 ]',
            "prefixes cannot be changed",
            'has "strength dexterity"',
        );
        const exact = played(
            rows.filter((c) => c.gen === "suffix"),
            three,
            3,
            has("StrengthAndDexterity"),
            200_000,
        );
        expect(Math.abs(chance / exact - 1)).toBeLessThan(0.02);
        // A type of one group beside them, which the hybrids' clock read low.
        const single = unveiled(
            "Astral Plate",
            'prefixes: [ "maximum life" t2, "increased armour" t2, "armour" t2 ]',
            "prefixes cannot be changed",
            'has "fire and chaos resistance"',
        );
        const singleExact = played(
            single.rows.filter((c) => c.gen === "suffix"),
            three,
            3,
            has("FireAndChaosDamageResistance"),
            200_000,
        );
        expect(Math.abs(single.chance / singleExact - 1)).toBeLessThan(0.02);
    });
});
