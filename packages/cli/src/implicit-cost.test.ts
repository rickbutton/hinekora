import { describe, expect, it } from "vitest";
import { check, costOf, GroupId } from "@hinekora/core";
import { parse } from "@hinekora/parser";
import { loadDefaultPoe1, registryOf } from "@hinekora/data";

// The chance of an `implicit` condition after a corruption, against the real
// pools: a Vaal Orb's implicit outcome is one in four (Vaal Orb § Equipment),
// the row drawn by spawn weight among the base's at its item level
// (QUESTIONS.md Q135), the implicit it replaces picked evenly.
const registry = registryOf(loadDefaultPoe1());

/** Each `if`'s chance and note, and the share of the craft that ends short;
 *  the checker says only `refused`. */
function costed(source: string, refused: readonly string[] = []) {
    const parsed = parse(source);
    if (!parsed.ok) throw new Error(parsed.error.message);
    const result = check(parsed.craft, { registry });
    expect(result.diagnostics.map((d) => d.message)).toEqual(refused);
    const report = costOf(parsed.craft, result, registry);
    const ifs = report.steps.filter((s) => s.kind === "if");
    for (const s of ifs) expect(s.note).toBeUndefined();
    return { branches: ifs.map((s) => s.branch!), stopped: report.stopped };
}

const ring = (ilvl: number, extra = "") =>
    `item { base: "Vermillion Ring" ilvl: ${ilvl} rarity: rare prefixes: [ "maximum life" t1 ] ${extra} }`;
const boots = (extra = "") =>
    `item { base: "Sorcerer Boots" ilvl: 86 rarity: rare prefixes: [ "maximum life" t1 ] ${extra} }`;

/** The weight of a wording's rows and of the whole pool on a base. */
function pool(base: string, ilvl: number, id: string): { row: number; total: number } {
    const b = registry.resolveBase(base);
    if (!b.ok) throw new Error(base);
    const rows = registry.corruptionPool(b.value, ilvl);
    return {
        row: rows.find((c) => c.row.id === id)!.weight,
        total: rows.reduce((s, c) => s + c.weight, 0),
    };
}

const ENDURANCE = "V2MaximumEnduranceChargesCorruption";

describe("the chance of an implicit after a Vaal Orb, on the real pools", () => {
    it("is a quarter of the row's share of a ring's pool at item level 84", () => {
        const { row, total } = pool("Vermillion Ring", 84, ENDURANCE);
        expect([row, total]).toEqual([50, 31_400]);
        const r = costed(`${ring(84)}\nvaal\nif not implicit "maximum endurance charges" { stop }`);
        expect(1 - r.branches[0]!).toBeCloseTo((1 / 4) * (50 / 31_400), 12);
    });

    it("reads the pool at the item's level: a ring of level 60 draws from less", () => {
        const { row, total } = pool("Vermillion Ring", 60, "V2CannotBePoisonedCorrupted");
        expect([row, total]).toEqual([1000, 30_500]);
        const r = costed(`${ring(60)}\nvaal\nif implicit "cannot be poisoned" { stop }`);
        expect(r.branches[0]).toBeCloseTo((1 / 4) * (1000 / 30_500), 12);
    });

    it("is a quarter of the row's share of a pair of boots' pool", () => {
        const { row, total } = pool("Sorcerer Boots", 86, ENDURANCE);
        expect([row, total]).toEqual([1000, 21_500]);
        const r = costed(`${boots()}\nvaal\nif implicit "maximum endurance charges" { stop }`);
        expect(r.branches[0]).toBeCloseTo((1 / 4) * (1000 / 21_500), 12);
    });

    it("takes the ring's own implicit whenever it lands", () => {
        const r = costed(`${ring(84)}\nvaal\nif implicit "maximum life" { stop }`);
        expect(r.branches[0]).toBeCloseTo(3 / 4, 12);
    });

    it("takes one of two eldritch implicits evenly, and only one", () => {
        const both = boots("exarch: grand eater: grand");
        expect(costed(`${both}\nvaal\nif exarch and eater { stop }`).branches[0]).toBeCloseTo(
            3 / 4,
            12,
        );
        // The implicit outcome, then the Eater kept: one time in two.
        const kept = costed(
            `${both}\nvaal\nif implicit "maximum endurance charges" and eater { stop }`,
        );
        expect(kept.branches[0]).toBeCloseTo((1 / 4) * (1 / 2) * (1000 / 21_500), 12);
    });

    it("takes the only eldritch implicit boots have", () => {
        const r = costed(
            `${boots("exarch: grand")}\nvaal\nif implicit "maximum endurance charges" or exarch { stop }`,
        );
        expect(r.branches[0]).toBeCloseTo(3 / 4 + (1 / 4) * (1000 / 21_500), 12);
    });

    it("finds the base's implicit gone once an ember replaced it", () => {
        const twoToned = `item { base: "Metadata/Items/Armours/Boots/BootsAtlas1" ilvl: 86 rarity: rare }`;
        const r = costed(
            `${twoToned}\nchaos\nif has "maximum life" { ember grand }\nvaal\nif implicit "cold and lightning resistances" { stop }`,
        );
        const [embered, kept] = r.branches;
        expect(kept).toBeCloseTo((1 - embered!) * (3 / 4), 12);
    });

    it("is drawn after a Bloodstained Fossil's reforge, on every use", () => {
        const r = costed(
            `${ring(84)}\nfossil "bloodstained"\nif implicit "maximum endurance charges" { stop }`,
        );
        expect(r.branches[0]).toBeCloseTo(50 / 31_400, 12);
    });
});

describe("the chance of an implicit after the Corruption Altar, on the real pools", () => {
    // Half the items are destroyed (assumed, QUESTIONS.md Q32); of the rest,
    // half took the implicit outcome.
    it("replaces a corrupted ring's own implicit", () => {
        const r = costed(
            `${ring(84, "corrupted")}\nlocus\nif implicit "maximum endurance charges" { stop }`,
        );
        expect(r.branches[0]).toBeCloseTo((1 / 2) * (50 / 31_400), 12);
    });

    it("adds a second beside a lone corruption implicit, never of its group", () => {
        const declared = ring(84, `corrupted implicits: [ "hatred has" ]`);
        // Hatred's group holds ten reservation rows of 1,000 each.
        const { row, total } = pool("Vermillion Ring", 84, ENDURANCE);
        const r = costed(
            `${declared}\nlocus\nif implicit "hatred has" and implicit "wrath has" { stop }\nif implicit "maximum endurance charges" { stop }`,
            [
                `the 'if' branch can never run: (implicit "hatred has" and implicit "wrath has") is impossible here`,
            ],
        );
        expect(r.branches[0]).toBe(0);
        expect(r.branches[1]).toBeCloseTo((1 / 2) * (row / (total - 10_000)), 12);
    });

    it("replaces either the eldritch or the corruption implicit beside it", () => {
        const declared = boots(
            `exarch: grand corrupted implicits: [ "maximum endurance charges" ]`,
        );
        expect(costed(`${declared}\nlocus\nif exarch { stop }`).branches[0]).toBeCloseTo(3 / 4, 12);
        // The endurance charges kept, or replaced by another draw of them.
        const kept = costed(
            `${declared}\nlocus\nif implicit "maximum endurance charges" and exarch { stop }`,
        );
        expect(kept.branches[0]).toBeCloseTo(1 / 2 + (1 / 4) * (1000 / 21_500), 12);
    });

    it("keeps the declared implicit no condition names, closing its group", () => {
        const b = registry.resolveBase("Vermillion Ring");
        if (!b.ok) throw new Error("ring");
        const rows = registry.corruptionPool(b.value, 84);
        const anger = rows.find((c) => c.row.id === "V2ManaReservationEfficiencyAngerCorrupted")!;
        const weigh = (keep: (c: (typeof rows)[number]) => boolean): number =>
            rows.filter(keep).reduce((s, c) => s + c.weight, 0);
        const open = weigh((c) => ![...c.row.groups].some((g) => anger.row.groups.has(g)));
        const cold = weigh((c) => c.row.groups.has(GroupId("AddedColdDamageToSpellsAndAttacks")));
        expect([weigh(() => true), open, cold]).toEqual([31_400, 21_400, 2_250]);
        const declared = ring(84, `corrupted implicits: [ "anger has" ]`);
        const r = costed(
            `${declared}\nlocus\nif implicit "cold damage to spells and attacks" { stop }`,
        );
        expect(r.branches[0]).toBeCloseTo((1 / 2) * (cold / open), 12);
        // Wrath shares Anger's group: the checker refuses it, and its chance is none.
        const wrath = costed(`${declared}\nlocus\nif implicit "wrath has" { stop }`, [
            `the 'if' branch can never run: implicit "wrath has" is impossible here`,
        ]);
        expect(wrath.branches[0]).toBe(0);
    });

    it("says the chance is not known where the items are not followed", () => {
        // A Tangled Fossil's roll is not followed, so neither is which
        // corruption implicits the items hold after the Vaal Orb.
        const parsed = parse(
            `${ring(84)}\nfossil "tangled"\nvaal\nif implicit "cold damage to spells and attacks" { stop }`,
        );
        if (!parsed.ok) throw new Error(parsed.error.message);
        const report = costOf(parsed.craft, check(parsed.craft, { registry }), registry);
        const step = report.steps.find((s) => s.kind === "if")!;
        expect([step.branch, step.note]).toEqual([
            0.5,
            "the chance of this condition is not known; half is assumed",
        ]);
    });

    it("follows a Vaal Orb's implicit into either place the altar may leave it", () => {
        // After the Vaal Orb the ring holds its own implicit three times in
        // four, else one corruption implicit; the altar's implicit then
        // replaces the first, or is added beside the second, never of its group.
        const b = registry.resolveBase("Vermillion Ring");
        if (!b.ok) throw new Error("ring");
        const rows = registry.corruptionPool(b.value, 84);
        const total = rows.reduce((s, c) => s + c.weight, 0);
        const p = 50 / total;
        let beside = 0;
        for (const x of rows) {
            if (x.row.id === ENDURANCE) {
                beside += x.weight / total;
                continue;
            }
            const open = rows.filter((r) => ![...r.row.groups].some((g) => x.row.groups.has(g)));
            const weight = open.reduce((s, r) => s + r.weight, 0);
            beside += (x.weight / total) * (1 / 2) * (50 / weight);
        }
        const r = costed(
            `${ring(84)}\nvaal\nlocus\nif implicit "maximum endurance charges" { stop }`,
        );
        expect(r.branches[0]).toBeCloseTo((3 / 4) * (1 / 2) * p + (1 / 4) * beside, 12);
    });

    it("leaves boots after a Vaal Orb with their eldritch implicit three times in eight", () => {
        const r = costed(`${boots("exarch: grand")}\nvaal\nlocus\nif exarch { stop }`);
        expect(r.branches[0]).toBeCloseTo(3 / 8, 12);
    });
});
