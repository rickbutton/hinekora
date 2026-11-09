import { describe, expect, it } from "vitest";
import { buildTypeIndex, expandAliases, singular, wordingAliases } from "./fuzzy.js";
import { BENCH_LIFE_ROW, LIFE_T1, LIFE_T2 } from "../__fixtures__/mods.js";
import { ModId } from "../model/ids.js";

describe("the name index", () => {
    it("shows a type with the wording of its own rows, not its bench rows'", () => {
        // Three bench tiers against one natural tier: the natural numbers still win.
        const bench = [1, 2, 3].map((n) => ({
            ...BENCH_LIFE_ROW,
            id: ModId(`BenchLife${n}`),
            text: `+(${n}-${n + 1}) to maximum Life`,
        }));
        const entry = buildTypeIndex([LIFE_T1, ...bench]).get(LIFE_T1.type);
        expect(entry?.text).toBe(LIFE_T1.text);
        // Among a type's own rows, the most common wording is the canonical one.
        expect(buildTypeIndex([LIFE_T1, LIFE_T2]).get(LIFE_T1.type)?.text).toBeDefined();
    });

    it("rewrites community wordings inside a query, longest phrase first", () => {
        const aliases = wordingAliases({
            "spell suppression": "chance to suppress spell damage",
            suppression: "suppress",
            es: "energy shield",
        });
        expect(expandAliases(["max", "es"], aliases)).toEqual(["max", "energy", "shield"]);
        expect(expandAliases(["spell", "suppression"], aliases)).toEqual([
            "chance",
            "suppress",
            "spell",
            "damage",
        ]);
        expect(expandAliases(["suppression"], aliases)).toEqual(["suppress"]);
        expect(expandAliases(["fire", "res"], aliases)).toEqual(["fire", "res"]);
    });

    it("folds the plural a tier's number brings", () => {
        expect(["enemies", "targets", "charge"].map(singular)).toEqual([
            "enemy",
            "target",
            "charge",
        ]);
    });
});
