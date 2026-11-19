import { describe, expect, it } from "vitest";

interface Projected {
    readonly projectCorruption: (
        raw: Readonly<Record<string, unknown>>,
        gems?: Readonly<Record<string, unknown>>,
    ) => Readonly<Record<string, Readonly<Record<string, unknown>>>>;
}
// The ingest script is plain JavaScript outside the package's sources.
const url = new URL("../scripts/ingest-corruption.mjs", import.meta.url).href;
const { projectCorruption } = (await import(/* @vite-ignore */ url)) as Projected;

const row = (fields: object) => ({
    generation_type: "corrupted",
    domain: "item",
    groups: ["G"],
    implicit_tags: [],
    required_level: 1,
    grants_effects: [],
    ...fields,
});

describe("the corruption implicits the ingest keeps", () => {
    const projected = projectCorruption(
        {
            V2MaximumEnduranceChargesCorruption: row({
                type: "MaximumEnduranceCharges",
                groups: ["MaximumEnduranceCharges"],
                implicit_tags: ["endurance_charge"],
                required_level: 75,
                spawn_weights: [
                    { tag: "boots", weight: 1000 },
                    { tag: "ring", weight: 50 },
                    { tag: "default", weight: 0 },
                ],
                text: "+1 to Maximum Endurance Charges",
            }),
            MaximumEnduranceChargesCorruption_: row({
                type: "MaximumEnduranceCharges",
                spawn_weights: [
                    { tag: "belt", weight: 0 },
                    { tag: "default", weight: 0 },
                ],
                text: "+1 to Maximum Endurance Charges",
            }),
            V2BlindImmunity: row({
                type: "CannotBeBlinded",
                spawn_weights: [{ tag: "helmet", weight: 1000 }],
                text: "Cannot be [Blind|Blinded]",
            }),
            V2JewelRow: row({
                domain: "misc",
                type: "J",
                spawn_weights: [{ tag: "jewel", weight: 1000 }],
                text: "j",
            }),
            V2AbyssRow: row({
                domain: "abyss_jewel",
                type: "A",
                spawn_weights: [{ tag: "default", weight: 1000 }],
                text: "a",
            }),
            V2MapRow: row({
                domain: "area",
                type: "M",
                spawn_weights: [{ tag: "default", weight: 1000 }],
                text: "m",
            }),
            Prefix: row({
                generation_type: "prefix",
                type: "P",
                spawn_weights: [{ tag: "ring", weight: 1000 }],
                text: "p",
            }),
            V2Support: row({
                type: "SupportedByAccuracy",
                spawn_weights: [{ tag: "two_hand_weapon", weight: 1000 }],
                grants_effects: [{ granted_effect_id: "SupportAccuracy", level: 10 }],
            }),
        },
        {
            SupportAccuracy: { is_support: true, display_name: "Additional Accuracy Support" },
        },
    );

    it("keeps a live row with its level, ordered spawn table, groups and tags", () => {
        expect(projected["V2MaximumEnduranceChargesCorruption"]).toEqual({
            domain: "item",
            type: "MaximumEnduranceCharges",
            groups: ["MaximumEnduranceCharges"],
            level: 75,
            spawn: [
                ["boots", 1000],
                ["ring", 50],
                ["default", 0],
            ],
            tags: ["endurance_charge"],
            text: "+1 to Maximum Endurance Charges",
        });
    });

    it("drops a legacy row no tag weighs, a map's row and an affix", () => {
        expect(Object.keys(projected).sort()).toEqual([
            "V2AbyssRow",
            "V2BlindImmunity",
            "V2JewelRow",
            "V2MaximumEnduranceChargesCorruption",
            "V2Support",
        ]);
    });

    it("strips the tooltip markup, and words a granted support", () => {
        expect(projected["V2BlindImmunity"]?.["text"]).toBe("Cannot be Blinded");
        expect(projected["V2Support"]?.["text"]).toBe(
            "Socketed Gems are Supported by Level 10 Additional Accuracy Support",
        );
    });

    it("fails where a domain yields no row, as a renamed one would", () => {
        const only = {
            V2Ring: row({ type: "R", spawn_weights: [{ tag: "ring", weight: 1000 }], text: "r" }),
        };
        expect(() => projectCorruption(only)).toThrow(/misc, abyss_jewel/);
    });
});
