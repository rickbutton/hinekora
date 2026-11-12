import { describe, expect, it } from "vitest";
import { type Literal, METHODS, type MethodItem } from "./methods.js";
import { type Op } from "./ops/types.js";
import {
    BENCH_REMOVE,
    beastFractureOps,
    BEAST_IMPRINT,
    BEAST_METAMOD,
    RESTORE,
    VEILED_CHAOS,
    VEILED_EXALT,
    beastAddOps,
    beastAspectOps,
    benchOps,
    currencyOps,
    essenceOps,
    foulbornOps,
    harvestAugmentOps,
    harvestChangeOps,
    harvestReforgeOps,
    locusOps,
    resonatorOps,
    TAINTED_CHAOS,
    TAINTED_DIVINE,
    TAINTED_EXALT,
    unveilOps,
    vaalOps,
} from "./library.js";
import { buildRegistry, STANDARD_CURRENCIES } from "../resolve/registry.js";
import {
    ASPECT_CAT,
    BENCH_LIFE_ROW,
    CATALOG,
    CLASS_RING,
    COLD_RESIST,
    FIRE_RESIST,
    FOSSILS,
    harvestTable,
    LIFE_T1,
    RING_BASE,
} from "../__fixtures__/mods.js";
import type { EssenceSpec } from "../model/sources.js";
import { TagId } from "../model/ids.js";
import { eldritchKey, influenceKey } from "../model/marks.js";

const ESSENCE: EssenceSpec = {
    id: "TestLife",
    name: "Deafening Essence of Greed",
    tier: 7,
    grants: new Map([[CLASS_RING, LIFE_T1.id]]),
};

const registry = buildRegistry({
    bases: [RING_BASE],
    mods: [...CATALOG, ASPECT_CAT, BENCH_LIFE_ROW],
    essences: [ESSENCE],
    benchCrafts: [{ mod: BENCH_LIFE_ROW.id, tier: 1, itemClasses: new Set([CLASS_RING]) }],
    fossils: FOSSILS,
    aspects: { cat: ASPECT_CAT.id },
    harvestChange: harvestTable({
        resistance: [[FIRE_RESIST.type, COLD_RESIST.type]],
        damage: [],
    }),
});

/** Every method but an unveil settles corruption first: refused on a corrupted
 *  item, or, for the Tainted currency, required. */
const opensWithCorruptionCheck = (ops: readonly Op[]): boolean =>
    ops[0]?.kind === "require" &&
    (ops[0].check.kind === "notCorrupted" || ops[0].check.kind === "corruptedItem");

describe("every method refuses a corrupted item first", () => {
    it("holds for each sequence the library states", () => {
        const sequences: Record<string, readonly Op[]> = {
            ...Object.fromEntries(STANDARD_CURRENCIES.map((c) => [c.name, currencyOps(c.kind)])),
            essence: essenceOps(ESSENCE, 100),
            bench: benchOps(BENCH_LIFE_ROW),
            benchRemove: BENCH_REMOVE,
            harvestReforge: harvestReforgeOps(TagId("life")),
            harvestAugment: harvestAugmentOps(TagId("life")),
            harvestChange: harvestChangeOps(FIRE_RESIST.type, "fire", [COLD_RESIST]),
            foulbornExalt: foulbornOps("exalt"),
            beastAdd: beastAddOps("prefix", 100),
            beastAspect: beastAspectOps(ASPECT_CAT),
            beastImprint: BEAST_IMPRINT,
            restore: RESTORE,
            beastMetamod: BEAST_METAMOD,
            beastFracture: beastFractureOps(1),
            beastFractureTwo: beastFractureOps(2),
            resonator: resonatorOps({ fossils: [], added: [], forced: [], corrupted: [] }),
            veiledChaos: VEILED_CHAOS,
            veiledExalt: VEILED_EXALT,
            vaal: vaalOps(RING_BASE),
            locus: locusOps(),
            taintedChaos: TAINTED_CHAOS,
            taintedExalt: TAINTED_EXALT,
            taintedDivine: TAINTED_DIVINE,
        };
        for (const [name, ops] of Object.entries(sequences)) {
            expect(opensWithCorruptionCheck(ops), name).toBe(true);
        }
        // The one exception: a corrupted item can be unveiled.
        expect(opensWithCorruptionCheck(unveilOps(undefined))).toBe(false);
    });

    it("holds for each entry of the method table, built with a sample argument per slot", () => {
        // An Exarch implicit, so the Eldritch orbs have a dominant side to build for.
        const a: MethodItem = {
            base: RING_BASE,
            ilvl: 100,
            influences: new Set([influenceKey([])]),
            eldritch: new Set([eldritchKey(3, 0)]),
            tiers: new Map(),
        };
        // Two mod slots in one method (the harvest change) take two elements.
        const sample: Record<string, readonly string[]> = {
            mod: [FIRE_RESIST.id, COLD_RESIST.id],
            essence: [ESSENCE.name],
            bench: ["maximum life"],
            fossil: [FOSSILS[0]!.name],
            tag: ["life"],
            aspect: ["cat"],
        };
        for (const method of METHODS) {
            let mods = 0;
            const args: Literal[] = method.args.flatMap((slot): Literal[] => {
                switch (slot.kind) {
                    case "name":
                    case "names": {
                        const names = sample[slot.of]!;
                        const value = names[slot.of === "mod" ? mods++ : 0] ?? names[0]!;
                        return [{ kind: "string", value }];
                    }
                    case "word":
                        return [{ kind: "word", value: slot.oneOf[0]! }];
                    case "int":
                        // Each int slot is optional and means something else.
                        return [];
                    case "tier":
                        return [];
                }
            });
            const built = method.build(args, a, registry);
            const label = method.words.join(" ");
            expect("refused" in built ? built.refused : "", label).toBe("");
            if ("refused" in built || label === "unveil") continue;
            expect(opensWithCorruptionCheck(built), label).toBe(true);
        }
    });
});
