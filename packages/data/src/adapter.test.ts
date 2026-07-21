import { describe, expect, it } from "vitest";
import { isNonzero } from "@hinekora/core";
import { adaptBase, adaptBench, adaptEssence, adaptMod, classifySource } from "./adapter.js";
import type { RepoeBase, RepoeBench, RepoeEssence, RepoeMod } from "./repoe/schema.js";

const LIFE: RepoeMod = {
    domain: "item",
    generation_type: "prefix",
    groups: ["IncreasedLife"],
    required_level: 5,
    spawn_weights: [
        { tag: "weapon", weight: 0 },
        { tag: "default", weight: 1000 },
    ],
    adds_tags: [],
    type: "IncreasedLife",
    name: "Healthy",
    text: "+(10-24) to maximum Life",
    is_essence_only: false,
};

describe("adaptMod", () => {
    it("maps a RePoE mod entry onto the core Mod shape", () => {
        const m = adaptMod("IncreasedLife1", LIFE);
        expect(m).not.toBeNull();
        expect(m).toMatchObject({
            id: "IncreasedLife1",
            type: "IncreasedLife",
            gen: "prefix",
            domain: "item",
            minLevel: 5,
        });
        expect([...m!.families]).toEqual(["IncreasedLife"]);
    });

    it("tags PoE1 weights as Known (including a disabling zero)", () => {
        const m = adaptMod("IncreasedLife1", LIFE)!;
        expect(m.spawn.map((s) => [s.tag, s.weight])).toEqual([
            ["weapon", { kind: "known", value: 0 }],
            ["default", { kind: "known", value: 1000 }],
        ]);
        // The zero-weight entry is Known-and-ineligible; the default is eligible.
        expect(isNonzero(m.spawn[0]!.weight)).toBe(false);
        expect(isNonzero(m.spawn[1]!.weight)).toBe(true);
    });

    it("skips non-affix generation types", () => {
        expect(adaptMod("X", { ...LIFE, generation_type: "corrupted" })).toBeNull();
        expect(adaptMod("X", { ...LIFE, generation_type: "unique" })).toBeNull();
    });

    it("stamps the acquisition source", () => {
        expect(adaptMod("X", LIFE)?.source).toBe("natural");
    });

    it("carries the category (implicit) tags used for tag-directed crafting", () => {
        const m = adaptMod("FireResist1", {
            ...LIFE,
            implicit_tags: ["fire", "elemental", "resistance"],
        })!;
        expect([...m.implicitTags]).toEqual(["fire", "elemental", "resistance"]);
        // A projection without the field leaves the set empty, not undefined.
        expect(adaptMod("X", LIFE)!.implicitTags.size).toBe(0);
    });
});

describe("classifySource", () => {
    it("classifies by essence flag, domain, and generation type", () => {
        expect(classifySource(LIFE)).toBe("natural");
        expect(classifySource({ ...LIFE, is_essence_only: true })).toBe("essence");
        expect(classifySource({ ...LIFE, domain: "crafted" })).toBe("bench");
        expect(classifySource({ ...LIFE, domain: "unveiled" })).toBe("veiled");
        expect(classifySource({ ...LIFE, domain: "delve" })).toBe("fossil");
        expect(classifySource({ ...LIFE, generation_type: "unique" })).toBe("unique");
        expect(classifySource({ ...LIFE, generation_type: "corrupted" })).toBe("corrupted");
        // item-domain but non-spawnable and not essence → other.
        expect(classifySource({ ...LIFE, spawn_weights: [{ tag: "default", weight: 0 }] })).toBe(
            "other",
        );
    });
});

describe("adaptEssence / adaptBench", () => {
    it("maps an essence to its per-class guaranteed mods", () => {
        const raw: RepoeEssence = {
            name: "Whispering Essence of Hatred",
            tier: 1,
            maxRandomModLevel: 35,
            grants: { Ring: "ColdDamagePercentEssence1", Belt: "ColdResist1" },
        };
        const e = adaptEssence("CurrencyEssenceHatred1", raw);
        expect(e).toMatchObject({
            id: "CurrencyEssenceHatred1",
            name: raw.name,
            tier: 1,
            maxRandomModLevel: 35,
        });
        expect(e.grants.get("Ring" as never)).toBe("ColdDamagePercentEssence1");
        expect(e.grants.size).toBe(2);
    });

    it("maps a bench craft to a mod + item classes", () => {
        const raw: RepoeBench = {
            mod: "HelenaMasterIncreasedLife1",
            tier: 1,
            item_classes: ["Ring", "Amulet"],
            master: "Niko",
        };
        const b = adaptBench(raw);
        expect(b).toMatchObject({ mod: "HelenaMasterIncreasedLife1", tier: 1, master: "Niko" });
        expect(b.itemClasses.size).toBe(2);
    });
});

describe("adaptBase", () => {
    it("maps a RePoE base entry, using its name as the id", () => {
        const jewel: RepoeBase = {
            name: "Cobalt Jewel",
            item_class: "Jewel",
            domain: "misc",
            tags: ["jewel", "not_dex", "not_str", "intjewel", "default"],
            release_state: "released",
        };
        const b = adaptBase("Metadata/Items/Jewels/JewelInt", jewel);
        expect(b).toMatchObject({
            id: "Metadata/Items/Jewels/JewelInt", // metadata key is the id
            name: "Cobalt Jewel", // display name is separate
            itemClass: "Jewel",
            domain: "misc",
        });
        expect(b.tags.size).toBe(5);
    });
});
