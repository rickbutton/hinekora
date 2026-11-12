import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
    type Base,
    ClassId,
    type Element,
    ELEMENTS,
    emptyItem,
    type Influence,
    INFLUENCE_STEMS,
    INFLUENCES,
    influenceOfTag,
    influenceTags,
    isCorruptedEssence,
    type ItemFacts,
    pool,
    rollableTiers,
    TagId,
    ModId,
    TypeId,
} from "@hinekora/core";
import { POE1_FILES, registryOf } from "./bundle.js";
import { loadDefaultEconomy, loadDefaultPoe1 } from "./load.js";

const data = loadDefaultPoe1();
const registry = registryOf(data);

/** Resolve a base by display name (throws if the test's assumption is wrong). */
function base(name: string): Base {
    const r = registry.resolveBase(name);
    if (!r.ok) throw new Error(`expected to resolve "${name}": ${r.error.kind}`);
    return r.value;
}

describe("the longest ladder a base rolls", () => {
    it("is thirteen tiers, every influence on it: where the Foulborn cull's formula still agrees with the strands'", () => {
        // `foulbornKept` (core, model/strands.ts) follows the Foulborn page's formula,
        // which keeps one tier fewer than the memory strands' from fifteen up.
        let longest = 0;
        const seen = new Set<string>();
        for (const b of data.bases) {
            const key = `${b.domain}|${b.itemClass}|${[...b.tags].sort().join(",")}`;
            if (seen.has(key)) continue;
            seen.add(key);
            const tags = new Set<TagId>();
            for (const i of INFLUENCES) for (const t of registry.influenceTags(b, i)) tags.add(t);
            const types = new Set(
                pool(data.mods, emptyItem(b, 100, "rare")).map((c) => c.mod.type),
            );
            for (const type of types) {
                longest = Math.max(longest, rollableTiers(data.mods, b, 100, type, tags).length);
            }
        }
        expect(longest).toBeLessThanOrEqual(13);
    });
});

describe("loadPoe1 — the full committed PoE1 catalog", () => {
    it("loads thousands of bases and mods, matching the manifest counts", () => {
        expect(data.bases.length).toBe(data.manifest.extent.bases);
        expect(data.mods.length).toBe(data.manifest.extent.mods);
        expect(data.bases.length).toBeGreaterThan(1000);
        expect(data.mods.length).toBeGreaterThan(10000);
    });

    it("carries dump provenance in the manifest", () => {
        expect(data.manifest.game).toBe("poe1");
        expect(data.manifest.source.commit).toBe("aa9fa7c394b18a7a89f913f86703112b3f9d20f1");
        // publishedAt is the gh-pages republish timestamp — it changes on rebuilds
        // even for the same commit, so assert only that provenance is present.
        expect(data.manifest.source.publishedAt).toBeTruthy();
        expect(data.manifest.gameVersion).toMatch(/^3\.\d+/);
        // Every data file has its entry, whichever ingest script wrote it.
        expect(Object.keys(data.manifest.files).sort()).toEqual(
            Object.values(POE1_FILES)
                .filter((f) => f !== POE1_FILES.manifest)
                .sort(),
        );
    });

    it("loads the essence and bench catalogs", () => {
        expect(data.essences.length).toBeGreaterThan(50);
        expect(data.benchCrafts.length).toBeGreaterThan(500);
        // An essence grants a specific mod per item class.
        expect(data.essences.every((e) => e.grants.size > 0)).toBe(true);
        // A craft carries its price in the currency the bench names.
        const lock = registry.resolveBench("suffixes cannot be changed", ClassId("Ring"));
        expect(lock.ok && [...(lock.value.cost ?? [])]).toEqual([["Divine Orb", 2]]);
    });

    it("loads the fossil catalog and resolves a fossil by its first word", () => {
        expect(data.fossils.length).toBe(data.manifest.extent.fossils);
        const pristine = registry.resolveFossil("pristine");
        expect(pristine.ok && [...pristine.value.blockedTags]).toEqual(["defences"]);
        // "More Life modifiers": ten times the weight (Fossil § Fossil weight multipliers).
        expect(pristine.ok && [...pristine.value.weights]).toEqual([["life", 1000]]);
        const hollow = registry.resolveFossil("Hollow Fossil");
        expect(hollow.ok && hollow.value.forcedMods).toEqual(["DelveAbyssJewelSocket1"]);
        expect(hollow.ok && hollow.value.allowedTags?.has(TagId("helmet"))).toBe(true);
        expect(registry.resolveFossil("glyphic")).toMatchObject({
            value: { corruptedEssenceChance: 100 },
        });
        // Since 3.16.0 the Tangled Fossil gives no fossil's own modifiers and
        // no corrupted essence's (Version 3.16.0); the export's row is older.
        expect(registry.resolveFossil("tangled")).toMatchObject({
            value: { corruptedEssenceChance: 0, addedMods: [], randomTags: true },
        });
        // "More Drop modifiers, No Tagless modifiers" (Opulent Fossil § Mechanics).
        expect(registry.resolveFossil("opulent")).toMatchObject({
            value: { blocksTagless: true },
        });
        const faceted = registry.resolveFossil("faceted");
        expect(faceted.ok && faceted.value.addedMods).toContain("DelveStrengthGemLevel1");
        expect(registry.resolveFossil("fractured")).toMatchObject({ value: { fractures: true } });
        expect(registry.resolveFossil("bloodstained")).toMatchObject({ value: { corrupts: true } });
        expect(registry.resolveFossil("fossil").ok).toBe(false); // every fossil matches
        expect(registry.resolveFossil("amber").ok).toBe(false);
    });

    it("loads the eldritch implicit catalog and finds an implicit by its wording", () => {
        expect(data.eldritch.length).toBe(data.manifest.extent.eldritch);
        expect(data.eldritch.length).toBeGreaterThan(3000);
        const gloves = base("Iron Gauntlets");
        const grand = registry.eldritchPool(gloves, "exarch", 3);
        expect(grand.length).toBeGreaterThan(50);
        expect(grand.every((e) => e.tier === 3 && e.side === "exarch")).toBe(true);
        // Tiers count from Lesser: the weakest attack speed row is tier 1, and a
        // presence row's text carries the condition the game prints first.
        const byId = new Map(data.eldritch.map((e) => [e.id, e]));
        expect(byId.get(ModId("IncreasedAttackSpeedEldritchImplicit1"))).toMatchObject({
            tier: 1,
            text: "8% increased Attack Speed",
        });
        expect(byId.get(ModId("IncreasedAttackSpeedEldritchImplicit6"))?.tier).toBe(6);
        expect(byId.get(ModId("IncreasedAttackSpeedEldritchImplicitUniquePresence6"))?.text).toBe(
            "While a Unique Enemy is in your Presence, 17% increased Attack Speed",
        );
        expect(registry.eldritchPool(base("Iron Ring"), "exarch", 3)).toEqual([]);
        // The plain wording names the plain implicit; a presence variant is
        // reached by its condition's words.
        const speed = registry.resolveEldritch("attack speed", "exarch", gloves);
        expect(speed.ok && speed.value.length).toBe(1);
        const unique = registry.resolveEldritch("unique enemy attack speed", "exarch", gloves);
        expect(unique.ok && registry.eldritchTextOf(unique.value[0]!)).toMatch(/^While a Unique/);
        expect(registry.resolveEldritch("attack speed", "eater", gloves).ok).toBe(false);
        const vague = registry.resolveEldritch("damage", "exarch", gloves);
        expect(!vague.ok && vague.error.kind).toBe("ambiguous");
        // One wording per implicit, not one per tier.
        const names = registry.eldritchNames("eater");
        expect(names.length).toBeGreaterThan(50);
        expect(names.length).toBeLessThan(400);
    });

    it("keeps the tiers of a presence implicit no ember gives, out of an ember's pool", () => {
        // An Orb of Conflict lowers a Greater presence implicit to its Lesser
        // tier, a row with no spawn weight.
        const gloves = base("Iron Gauntlets");
        const id = ModId("IncreasedAttackSpeedEldritchImplicitUniquePresence1");
        const lesser = data.eldritch.find((e) => e.id === id);
        expect(lesser).toMatchObject({
            tier: 1,
            unrollable: true,
            text: "While a Unique Enemy is in your Presence, 12% increased Attack Speed",
        });
        expect(registry.eldritchPool(gloves, "exarch", 1).some((e) => e.unrollable)).toBe(false);
        expect(registry.eldritchRows(gloves, "exarch", 1).map((e) => e.id)).toContain(id);
        // Every such row is a tier of an implicit some ember or ichor gives.
        const rollable = new Set(data.eldritch.filter((e) => !e.unrollable).map((e) => e.type));
        expect(data.eldritch.every((e) => rollable.has(e.type))).toBe(true);
    });

    it("resolves the four Aspects the Bestiary crafts to level-30 suffix rows", () => {
        for (const name of ["cat", "avian", "spider", "crab"]) {
            const r = registry.resolveAspect(name);
            expect(r.ok && r.value.gen).toBe("suffix");
            expect(r.ok && r.value.text).toContain("Level 30 Aspect");
        }
        expect(registry.resolveAspect("wolf").ok).toBe(false);
    });

    it("knows the four corrupted essences apart from the other top-tier essence", () => {
        const corrupted = registry.essences.filter(isCorruptedEssence).map((e) => e.name);
        expect(corrupted.sort()).toEqual([
            "Essence of Delirium",
            "Essence of Horror",
            "Essence of Hysteria",
            "Essence of Insanity",
        ]);
        // The export leaves it at level 0; the ingest reads the wiki's 8 for it.
        const desolation = registry.essences.find((e) => e.name === "Essence of Desolation");
        expect(desolation?.tier).toBe(8);
        expect(desolation && isCorruptedEssence(desolation)).toBe(false);
        // Nor does it restrict the level of the modifiers rolled beside its own.
        expect(desolation?.maxRandomModLevel).toBeUndefined();
        const whispering = registry.resolveEssence("Whispering Essence of Greed");
        expect(whispering.ok && whispering.value.maxRandomModLevel).toBe(35);
    });

    it("gives a Rune Dagger the Dagger's essence modifier and a Warstaff the Staff's", () => {
        // Essences name weapons as one- or two-handed, not by class.
        for (const e of registry.essences) {
            expect(e.grants.get(ClassId("Rune Dagger")), e.name).toBe(
                e.grants.get(ClassId("Dagger")),
            );
            expect(e.grants.get(ClassId("Warstaff")), e.name).toBe(e.grants.get(ClassId("Staff")));
        }
        const woe = registry.resolveEssence("Deafening Essence of Woe");
        expect(woe.ok && woe.value.grants.get(ClassId("Rune Dagger"))).toBe(
            "SpellDamageOnWeaponEssence7",
        );
        expect(woe.ok && woe.value.grants.get(ClassId("Warstaff"))).toBe(
            "SpellDamageOnTwoHandWeaponEssence7",
        );
    });

    it("resolves essences by full name, by type + tier, and flags conflicts", () => {
        const name = (r: ReturnType<typeof registry.resolveEssence>) =>
            r.ok ? r.value.name : null;
        expect(name(registry.resolveEssence("Deafening Essence of Greed"))).toBe(
            "Deafening Essence of Greed",
        );
        // Type + tier: t1 = Deafening = best.
        expect(name(registry.resolveEssence("greed", 1))).toBe("Deafening Essence of Greed");
        // Full name + a matching tier is fine; a bare type without one is ambiguous.
        expect(registry.resolveEssence("Deafening Essence of Greed", 1).ok).toBe(true);
        expect(registry.resolveEssence("greed").ok).toBe(false);
        // A corrupted essence has one rung, so it takes `t1` or no tier.
        expect(name(registry.resolveEssence("delirium"))).toBe("Essence of Delirium");
        expect(name(registry.resolveEssence("delirium", 1))).toBe("Essence of Delirium");
        expect(registry.resolveEssence("delirium", 2).ok).toBe(false);
        // Full name + a DISAGREEING tier does not silently resolve.
        expect(registry.resolveEssence("Deafening Essence of Greed", 2).ok).toBe(false);
    });

    it("says which tiers a known essence or bench craft has, for a tier it lacks", () => {
        const error = (r: { ok: boolean; error?: unknown }) => (r.ok ? undefined : r.error);
        expect(error(registry.resolveEssence("greed", 8))).toMatchObject({
            kind: "noSuchTier",
            best: 1,
            worst: 7,
        });
        expect(error(registry.resolveEssence("delirium", 2))).toMatchObject({
            kind: "noSuchTier",
            best: 1,
            worst: 1,
        });
        expect(error(registry.resolveEssence("nonsense", 2))).toMatchObject({
            kind: "unknownEssence",
        });
        expect(error(registry.resolveBench("cold resistance", ClassId("Ring"), 9))).toMatchObject({
            kind: "noSuchTier",
            best: 1,
            worst: 2,
        });
    });

    it("names each modifier once where a bench name fits several", () => {
        const r = registry.resolveBench("resistance", ClassId("Ring"));
        expect(!r.ok && r.error.kind === "ambiguous" && r.error.candidates).toEqual([
            "+(21-28)% to Fire Resistance",
            "+(21-28)% to Cold Resistance",
            "+(21-28)% to Lightning Resistance",
        ]);
    });

    it("stamps a source on every mod, and isolates natural from essence", () => {
        expect(data.mods.every((m) => m.source !== undefined)).toBe(true);
        const bySource = (s: string) => data.mods.filter((m) => m.source === s).length;
        expect(bySource("natural")).toBeGreaterThan(1000);
        expect(bySource("essence")).toBeGreaterThan(100);
    });

    it("uses metadata-path ids and separate display names", () => {
        const jewel = base("Cobalt Jewel");
        expect(jewel.id).toContain("Metadata/");
        expect(jewel.name).toBe("Cobalt Jewel");
    });
});

describe("registry resolution against real data", () => {
    it("resolves equipment/jewel bases by their (unique) display name", () => {
        expect(registry.resolveBase("Cobalt Jewel").ok).toBe(true);
        expect(registry.resolveBase("Iron Ring").ok).toBe(true);
    });

    it("resolves a colliding base name when the bases are one to the checker", () => {
        // A tincture's old and new id, a talisman's implicit variants: same class,
        // domain, tags and caps, so a craft's name for them needs no id.
        expect(registry.resolveBase("Ashbark Tincture").ok).toBe(true);
        expect(registry.resolveBase("Black Maw Talisman").ok).toBe(true);
        expect(registry.resolveBase("Avian Twins Talisman").ok).toBe(true);
    });

    it("resolves a base whose name a Royale base shared", () => {
        for (const name of ["Opal Ring", "Diamond Ring", "Prismatic Ring", "Heavy Belt"]) {
            const r = registry.resolveBase(name);
            expect(r.ok && r.value.id).not.toContain("Royale");
            expect(r.ok).toBe(true);
        }
    });

    it("reports a colliding base name as ambiguous, with candidates", () => {
        // Several bases share the name "Two-Toned Boots", with different tags.
        const r = registry.resolveBase("Two-Toned Boots");
        expect(r.ok).toBe(false);
        if (!r.ok) {
            expect(r.error.kind).toBe("ambiguous");
            if (r.error.kind === "ambiguous") expect(r.error.candidates.length).toBeGreaterThan(1);
        }
    });

    it("refuses a base no craft is modelled on: currency, a gem, a map, a card", () => {
        for (const name of ["Chaos Orb", "Fireball", "Academy Map", "The Doctor"]) {
            const r = registry.resolveBase(name);
            expect(r.ok ? "resolved" : r.error.kind, name).toBe("uncraftedBase");
        }
        expect(registry.baseNames).not.toContain("Chaos Orb");
    });

    it("takes every class of equipment, the jewels, flasks, tinctures and a trinket", () => {
        for (const name of [
            "Vaal Axe",
            "Astral Plate",
            "Iron Ring",
            "Serrated Arrow Quiver",
            "Murderous Eye Jewel",
            "Large Cluster Jewel",
            "Divine Life Flask",
            "Ashbark Tincture",
            "Thief's Trinket",
        ]) {
            const r = registry.resolveBase(name);
            expect(r.ok || r.error.kind === "ambiguous", name).toBe(true);
        }
    });

    it("resolves mods by id and provides the standard currencies", () => {
        expect(registry.resolveMod("Strength1").ok).toBe(true);
        expect(registry.resolveCurrency("exalt").ok).toBe(true);
    });

    it("reads the words players use for a modifier", () => {
        const wording = (name: string, on: string): string => {
            const r = registry.resolveModType(name, { base: base(on), ilvl: 86 });
            if (!r.ok) throw new Error(`"${name}" on ${on}: ${JSON.stringify(r.error)}`);
            return registry.typeLabel(r.value);
        };
        expect(wording("spell suppression", "Slink Boots")).toBe("chance suppress spell damage");
        expect(wording("max es", "Vaal Regalia")).toBe("maximum energy shield");
        expect(wording("+1 gems", "Jade Amulet")).toBe("level all skill gems");
        expect(wording("ms", "Slink Boots")).toBe("increased movement speed");
        expect(wording("dot multi", "Jade Amulet")).toBe("damage over time multiplier");
        expect(wording("flat phys", "Vaal Axe")).toBe("adds physical damage");
        expect(wording("socketed melee gems", "Vaal Axe")).toBe("level socketed melee gems");
    });

    it("knows the cluster jewel enchantments by the words of their stat", () => {
        expect(registry.clusterEnchants().length).toBeGreaterThan(40);
        const lightning = registry.resolveClusterEnchant("lightning damage");
        expect(lightning.ok && lightning.value).toBe("affliction_lightning_damage");
        const vague = registry.resolveClusterEnchant("damage");
        expect(!vague.ok && vague.error.kind).toBe("ambiguous");
    });

    it("knows which size of cluster jewel each enchantment belongs to", () => {
        const sizes = (words: string) => {
            const tag = registry.resolveClusterEnchant(words);
            return tag.ok ? registry.clusterSizesOf(tag.value) : undefined;
        };
        expect(sizes("lightning damage")).toEqual(new Set(["large"]));
        expect(sizes("minion life")).toEqual(new Set(["medium"]));
        expect(sizes("maximum life")).toEqual(new Set(["small"]));
        const listed = Object.values(data.clusterEnchants).flat();
        expect(listed.length).toBe(data.manifest.files["cluster_enchants.json"]!.count);
        // Every enchantment the notables roll under has a size.
        for (const e of registry.clusterEnchants()) {
            expect(registry.clusterSizesOf(e.tag), e.words).toBeDefined();
        }
    });

    it("carries affix-cap deltas from experimented-base implicits", () => {
        // Simplex: −2 prefix / −1 suffix (rare 1p/2s); Ratcheting: −3 / +3.
        expect(base("Simplex Amulet").capDelta).toEqual({ prefix: -2, suffix: -1 });
        expect(base("Ratcheting Ring").capDelta).toEqual({ prefix: -3, suffix: 3 });
        expect(base("Iron Ring").capDelta).toBeUndefined(); // an ordinary base has none
    });

    it("carries the magnitude scaling and the all-influence implicit of experimented bases", () => {
        expect(base("Simplex Amulet").magnitude).toEqual({ prefix: 100, suffix: 100 });
        expect(base("Helical Ring").magnitude).toEqual({ prefix: 0, suffix: 50 });
        expect(base("Ratcheting Ring").magnitude).toBeUndefined();
        expect(base("Astrolabe Amulet").allInfluences).toBe(true);
        expect(base("Iron Ring").allInfluences).toBeUndefined();
    });
});

describe("influence tags against real data", () => {
    const spawnTags = new Set<string>();
    for (const m of registry.catalog) for (const e of m.spawn) spawnTags.add(e.tag);
    const stems = new Set<string>();
    for (const t of spawnTags) {
        const hit = influenceOfTag(TagId(t));
        if (hit) stems.add(hit.stem);
    }

    it("maps every class the spawn tables know, and no class to a stem they do not", () => {
        expect(new Set(Object.values(INFLUENCE_STEMS))).toEqual(stems);
        for (const stem of Object.values(INFLUENCE_STEMS)) {
            for (const i of INFLUENCES) {
                const tags = influenceTags(
                    { ...base("Iron Ring"), itemClass: ClassId(classOf(stem)) },
                    i,
                    new Set([...spawnTags].map(TagId)),
                );
                expect(tags.size, `${stem} ${i}`).toBe(1);
            }
        }
    });

    it("keys the tag by the item class, not by the base's own tags", () => {
        const tag = (name: string, i: Influence): string[] =>
            [...registry.influenceTags(base(name), i)].sort();
        expect(tag("Corroded Blade", "shaper")).toEqual(["2h_sword_shaper"]);
        expect(tag("Rusted Spike", "shaper")).toEqual(["sword_shaper"]);
        expect(tag("Carving Knife", "hunter")).toEqual(["rune_dagger_basilisk"]);
        expect(tag("Iron Staff", "warlord")).toEqual(["warstaff_adjudicator"]);
        expect(tag("Cobalt Jewel", "elder")).toEqual([]);
    });

    it("pairs every influenced modifier of the four armour classes with an elevated row", () => {
        const armour = new Set(["body_armour", "boots", "gloves", "helmet"]);
        const elevated = registry.catalog.filter((m) => m.source === "elevated");
        expect(elevated.length).toBeGreaterThan(200);
        const unpaired: string[] = [];
        for (const m of registry.catalog) {
            if (m.source !== "natural") continue;
            for (const w of m.spawn) {
                const hit = influenceOfTag(w.tag);
                if (!hit || w.weight <= 0 || !armour.has(hit.stem)) continue;
                const families = registry.familiesOfType(m.type);
                const paired = elevated.some(
                    (e) =>
                        [...e.families].some((f) => families.has(f)) &&
                        e.spawn.some((x) => x.tag === w.tag),
                );
                if (!paired) unpaired.push(`${m.type} on ${w.tag}`);
            }
        }
        expect(unpaired).toEqual([]);
    });

    it("lets a Shaper two-handed sword roll a row that spawns only on its class tag", () => {
        const blade = base("Corroded Blade");
        const row = registry.catalog.find((m) =>
            m.spawn.some((e) => e.tag === "2h_sword_shaper" && e.weight > 0),
        )!;
        const tags = registry.influenceTags(blade, "shaper");
        expect(rollableTiers(registry.catalog, blade, 100, row.type, tags).length).toBeGreaterThan(
            0,
        );
        expect(rollableTiers(registry.catalog, blade, 100, row.type).length).toBe(0);
    });
});

/** The first class mapped to a stem, for building a base of that class. */
function classOf(stem: string): string {
    return Object.entries(INFLUENCE_STEMS).find(([, s]) => s === stem)![0];
}

describe("catalog-level facts of the item model", () => {
    const byType = new Map<string, typeof registry.catalog>();
    for (const m of registry.catalog) {
        const rows = byType.get(m.type);
        if (rows) byType.set(m.type, [...rows, m]);
        else byType.set(m.type, [m]);
    }

    it("every row of a ModType claims the same groups", () => {
        for (const rows of byType.values()) {
            const first = [...rows[0]!.families].sort().join(",");
            expect(rows.every((r) => [...r.families].sort().join(",") === first)).toBe(true);
        }
    });

    it("a ModType is not one side: many have both prefix and suffix rows", () => {
        let both = 0;
        for (const rows of byType.values()) {
            if (rows.some((r) => r.gen === "prefix") && rows.some((r) => r.gen === "suffix"))
                both++;
        }
        expect(both).toBeGreaterThan(100);
    });

    it("essence-only rows carry no positive weight anywhere", () => {
        const essenceRows = registry.catalog.filter((m) => m.source === "essence");
        expect(essenceRows.length).toBeGreaterThan(400);
        expect(essenceRows.every((m) => m.spawn.every((e) => e.weight === 0))).toBe(true);
    });

    it("a ModType's rows agree on the attack and caster tags", () => {
        // The cannot-roll shield reads a type's first row; it is exact only while
        // every row of the type carries the same attack and caster tags.
        for (const rows of byType.values()) {
            const key = (m: (typeof rows)[number]) =>
                `${m.implicitTags.has(TagId("attack"))}/${m.implicitTags.has(TagId("caster"))}`;
            const first = key(rows[0]!);
            expect(rows.every((r) => key(r) === first)).toBe(true);
        }
    });

    it("a ModType's rows agree on the tags they add", () => {
        // The add-pool puts one row's added tags on its synthetic item and unions
        // them per type; both are exact only while the rows of a type agree.
        for (const rows of byType.values()) {
            const first = [...rows[0]!.addsTags].sort().join(",");
            expect(rows.every((r) => [...r.addsTags].sort().join(",") === first)).toBe(true);
        }
    });

    it("every cluster notable adds the notable tag and zeroes on it below the Medium size", () => {
        // How the game caps a Small Cluster Jewel at one notable: the generation
        // table reads the Large and Medium size tags at full weight before the
        // zero on the tag every notable adds (Cluster jewel § Mechanics).
        const notables = registry.catalog.filter((m) =>
            m.addsTags.has(TagId("has_affliction_notable")),
        );
        expect(notables.length).toBeGreaterThan(250);
        for (const m of notables) {
            expect(m.generation.map((e) => `${e.tag}:${e.weight}`)).toEqual([
                "expansion_jewel_large:100",
                "expansion_jewel_medium:100",
                "has_affliction_notable:0",
                "expansion_jewel_small:100",
                "default:0",
            ]);
        }
        const others = registry.catalog.filter(
            (m) => m.generation.length > 0 && !notables.includes(m),
        );
        expect(others.length).toBeGreaterThan(0);
    });

    it("the five metamods are the only effect carriers, all bench-placed", () => {
        const carriers = registry.catalog.filter((m) => (m.effects?.length ?? 0) > 0);
        expect(carriers.map((m) => m.id).sort()).toEqual([
            "DexMasterItemGenerationCannotChangeSuffixes",
            "IntMasterItemGenerationCannotRollAttackAffixes",
            "StrDexMasterItemGenerationCannotRollCasterAffixes",
            "StrIntMasterItemGenerationCanHaveMultipleCraftedMods",
            "StrMasterItemGenerationCannotChangePrefixes",
        ]);
        expect(carriers.every((m) => m.source === "bench")).toBe(true);
    });
});

describe("fuzzy mod resolution against real data", () => {
    const rctx = { base: base("Iron Ring"), ilvl: 84 };

    it("resolves a stat description to a ModType, base-aware", () => {
        expect(registry.resolveModType("maximum life", rctx)).toMatchObject({
            ok: true,
            value: "IncreasedLife",
        });
        expect(registry.resolveModType("fire resistance", rctx)).toMatchObject({
            ok: true,
            value: "FireResistance",
        });
    });

    it("resolves abbreviations via prefix matching (max life → maximum life)", () => {
        expect(registry.resolveModType("max life", rctx)).toMatchObject({
            ok: true,
            value: "IncreasedLife",
        });
    });

    it("reports a genuinely ambiguous description with candidates", () => {
        const r = registry.resolveModType("resistance", rctx);
        expect(r.ok).toBe(false);
        if (!r.ok) {
            expect(r.error.kind).toBe("ambiguous");
            if (r.error.kind === "ambiguous") expect(r.error.candidates.length).toBeGreaterThan(1);
        }
    });
});

describe("real pool — a Cobalt Jewel draws its jewel mods", () => {
    const jewelBase = base("Cobalt Jewel");
    const empty = (b: Base): ItemFacts => emptyItem(b, 82, "rare");

    it("computes a non-trivial pool, all in the jewel (misc) domain", () => {
        const candidates = pool(data.mods, empty(jewelBase));
        expect(candidates.length).toBeGreaterThan(50);
        expect(candidates.every((c) => c.mod.domain === jewelBase.domain)).toBe(true);
    });

    it("offers nothing once the jewel is a full 3+3 Rare", () => {
        const distinct = pool(data.mods, empty(jewelBase))
            .map((c) => c.mod)
            .filter((m, i, all) => all.findIndex((x) => x.type === m.type) === i);
        const prefixes = distinct.filter((m) => m.gen === "prefix").slice(0, 3);
        const suffixes = distinct.filter((m) => m.gen === "suffix").slice(0, 3);
        const mods = [...prefixes, ...suffixes];
        const full: ItemFacts = {
            ...empty(jewelBase),
            prefixCount: prefixes.length,
            suffixCount: suffixes.length,
            types: new Set(mods.map((m) => m.type)),
            families: new Set(mods.flatMap((m) => [...m.families])),
        };
        expect(pool(data.mods, full)).toHaveLength(0);
    });
});

describe("the grove's change lists", () => {
    const type = (id: string) => TypeId(id);

    it("are the table the ingest's pairing makes of the lists and its recorded decisions", async () => {
        // The committed file is generated: an edit to it, or to what was seen
        // in game or decided to have no counterpart, without the other fails.
        type Lists = Record<string, Record<string, string[]>>;
        interface Script {
            readonly pairHarvestChange: (lists: Lists, critical: ReadonlySet<string>) => unknown;
            readonly renderHarvestChange: (pairs: unknown) => string;
        }
        const url = new URL("../scripts/ingest-harvest-change.mjs", import.meta.url).href;
        const script = (await import(/* @vite-ignore */ url)) as Script;
        const lists: Lists = {};
        for (const [kind, byElement] of Object.entries(data.harvestChange)) {
            lists[kind] = {};
            for (const [element, rows] of Object.entries(byElement)) {
                lists[kind][element] = rows.map((r) => r.from);
            }
        }
        const critical = new Set<string>(
            data.mods.filter((m) => m.implicitTags.has(TagId("critical"))).map((m) => m.type),
        );
        const committed = readFileSync(
            new URL(`../data/poe1/${POE1_FILES.harvestChange}`, import.meta.url),
            "utf8",
        );
        expect(script.renderHarvestChange(script.pairHarvestChange(lists, critical))).toBe(
            committed,
        );
    });

    it("name only modifiers whose rows all claim the same groups", () => {
        // A change is not blocked by a modifier of the changed one's group
        // (core, check/ops/crafted.ts `noGroupConflict`), which reads one set of
        // groups per type: exact only while its rows agree.
        const listed = new Set(
            Object.values(data.harvestChange).flatMap((byElement) =>
                Object.values(byElement).flatMap((rows) => rows.map((r) => r.from)),
            ),
        );
        expect(listed.size).toBeGreaterThan(100);
        for (const t of listed) {
            const groups = data.mods
                .filter((m) => m.type === t)
                .map((m) => [...m.families].sort().join(","));
            expect(new Set(groups).size, t).toBe(1);
        }
    });

    it("name modifier types of the catalog only, as many as the manifest counts", () => {
        const types = new Set(data.mods.map((m) => m.type));
        const rows = Object.values(data.harvestChange).flatMap((byElement) =>
            Object.values(byElement).flat(),
        );
        expect(rows.length).toBe(data.manifest.files["harvest_change.json"]!.count);
        const named = rows.flatMap((r) => [r.from, ...Object.values(r.to).map((to) => to.type)]);
        expect(named.filter((t) => t !== null && !types.has(t))).toEqual([]);
    });

    it("pair every listed modifier with each other element, or refuse the pair", () => {
        for (const kind of ["resistance", "damage"] as const) {
            for (const element of ELEMENTS) {
                for (const row of data.harvestChange[kind][element] ?? []) {
                    const others = ELEMENTS.filter((e) => e !== element);
                    expect(Object.keys(row.to).sort()).toEqual([...others].sort());
                }
            }
        }
    });

    it("hold every pair the element's word alone gives", () => {
        // What a modifier becomes was once read off its name; the table must
        // not lose a pair that reading gave, the refused multipliers apart.
        const capital = (e: string) => e[0]!.toUpperCase() + e.slice(1);
        const alike = (t: string) => t.replaceAll("Resistance", "Resist");
        let pairs = 0;
        for (const kind of ["resistance", "damage"] as const) {
            for (const element of ELEMENTS) {
                for (const row of data.harvestChange[kind][element] ?? []) {
                    for (const target of ELEMENTS) {
                        const wanted = alike(
                            row.from.replaceAll(capital(element), capital(target)),
                        );
                        const byName = (data.harvestChange[kind][target] ?? []).find(
                            (r) => alike(r.from) === wanted,
                        )?.from;
                        if (target === element || byName === undefined) continue;
                        if (row.from.includes("CritMultiplier")) continue;
                        expect(registry.harvestChangeTarget(row.from, target)).toBe(byName);
                        pairs++;
                    }
                }
            }
        }
        expect(pairs).toBeGreaterThan(300);
    });

    it("pair the ailment modifiers and the multipliers as the game does", () => {
        const becomes = (from: string, element: Element) =>
            registry.harvestChangeTarget(type(from), element);
        expect(becomes("FireDamageAndChanceToIgnite", "cold")).toBe(
            "ColdDamageAndBaseChanceToFreeze",
        );
        expect(becomes("ColdDamageAndBaseChanceToFreeze", "lightning")).toBe(
            "LightningDamageAndChanceToShock",
        );
        expect(becomes("ChanceToShockAddedDamage", "fire")).toBe("ChanceToIgniteAddedDamage");
        expect(becomes("ChanceToIgniteAddedDamage", "cold")).toBe("ChanceToFreezeAddedDamage");
        // Listed, and refused since 3.28.0.
        expect(registry.harvestChangeOf(type("FireCritMultiplierForJewel"))?.kind).toBe("damage");
        expect(becomes("FireCritMultiplierForJewel", "cold")).toBeUndefined();
        // No modifier of its name on the other element's list.
        expect(becomes("ColdDamageAvoidance", "fire")).toBeUndefined();
        expect(becomes("ColdDamageAvoidance", "lightning")).toBe("LightningDamageAvoidance");
        const seen = data.harvestChange.damage.fire!.find(
            (r) => r.from === "FireDamageOverTimeMultiplier",
        )!;
        expect(seen.to).toEqual({
            cold: { type: "ColdDamageOverTimeMultiplier", basis: "seen in game" },
            lightning: { type: null, basis: "seen in game" },
        });
    });

    it("read a modifier as a resistance or a damage of its element, and find its counterpart", () => {
        expect(registry.harvestChangeOf(type("FireResistance"))).toEqual({
            kind: "resistance",
            element: "fire",
        });
        expect(registry.harvestChangeTarget(type("FireResistance"), "cold")).toBe("ColdResistance");
        // The game spells the maximum resistances "…Resist" and "…Resistance".
        expect(registry.harvestChangeTarget(type("MaximumFireResist"), "lightning")).toBe(
            "MaximumLightningResistance",
        );
        // Penetration and the damage over time multipliers are damage modifiers
        // to the grove; lightning has no such multiplier.
        expect(registry.harvestChangeTarget(type("FireResistancePenetration"), "cold")).toBe(
            "ColdResistancePenetration",
        );
        expect(registry.harvestChangeTarget(type("FireDamageOverTimeMultiplier"), "cold")).toBe(
            "ColdDamageOverTimeMultiplier",
        );
        expect(
            registry.harvestChangeTarget(type("FireDamageOverTimeMultiplier"), "lightning"),
        ).toBeUndefined();
        // A resistance shared with chaos is on no list.
        expect(registry.harvestChangeOf(type("FireAndChaosDamageResistance"))).toBeUndefined();
    });
});

describe("the economy snapshot", () => {
    it("prices the currencies the cost layer names, in chaos, with its provenance", () => {
        const prices = loadDefaultEconomy();
        expect(prices.league.length).toBeGreaterThan(0);
        expect(prices.fetchedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
        expect(prices.chaosPerDivine).toBeGreaterThan(1);
        expect(prices.chaos.get("Chaos Orb")).toBe(1);
        for (const item of [
            "Divine Orb",
            "Exalted Orb",
            "Orb of Annulment",
            "Deafening Essence of Greed",
            "Pristine Fossil",
            "Primitive Chaotic Resonator",
            "Wild Crystallised Lifeforce",
            "Veiled Chaos Orb",
        ]) {
            expect(prices.chaos.get(item), item).toBeGreaterThan(0);
        }
    });
});

describe("what the exact checker takes of the data as given", () => {
    // The armour pieces an Orb of Dominance takes (Orb of Dominance § Mechanics).
    const armour = ["Titan Gauntlets", "Titan Greaves", "Royal Burgonet", "Vaal Regalia"].map(base);

    it("pairs every top-tier influence row the orb can reach with one elevated row", () => {
        // check/ops/remove.ts `elevations`: a row with no higher row of its type
        // under its own influence tags becomes its elevated row.
        let tops = 0;
        for (const b of armour) {
            for (const influence of INFLUENCES) {
                const own = registry.influenceTags(b, influence);
                for (const row of registry.catalog) {
                    if (row.source === "elevated" || row.domain !== b.domain) continue;
                    const tags = new Set(
                        row.spawn.filter((e) => e.weight > 0 && own.has(e.tag)).map((e) => e.tag),
                    );
                    if (tags.size === 0) continue;
                    const higher = registry.catalog.some(
                        (m) =>
                            m.type === row.type &&
                            m.source !== "elevated" &&
                            m.minLevel > row.minLevel &&
                            m.spawn.some((e) => e.weight > 0 && tags.has(e.tag)),
                    );
                    if (higher) continue;
                    tops++;
                    expect(registry.elevatedOf(row), `${b.name} ${row.id}`).toBeDefined();
                }
            }
        }
        expect(tops).toBeGreaterThan(200);
    });

    it("has every eldritch implicit at every tier its side reaches on the base", () => {
        // check/ops/marks.ts `conflict`: an Orb of Conflict moves an implicit a
        // tier and keeps its wording, so the wording has a row at each tier.
        // An amulet takes them too (Ukatoa's Ducat § Mechanics).
        for (const b of [...armour, base("Onyx Amulet")]) {
            for (const side of ["exarch", "eater"] as const) {
                const tiers = new Map<TypeId, number[]>();
                for (let t = 1; t <= 6; t++) {
                    for (const e of registry.eldritchRows(b, side, t)) {
                        tiers.set(e.type, [...(tiers.get(e.type) ?? []), t]);
                    }
                }
                expect(tiers.size, `${b.name} ${side}`).toBeGreaterThan(0);
                const reached = Math.max(...[...tiers.values()].flat());
                for (const [type, at] of tiers) {
                    expect([...new Set(at)].sort(), `${b.name} ${side} ${type}`).toEqual(
                        Array.from({ length: reached }, (_, i) => i + 1),
                    );
                }
            }
        }
    });
});

describe("the elevated row of an influence modifier", () => {
    // The armour pieces an Orb of Dominance takes (Orb of Dominance § Mechanics).
    const armour = ["Titan Gauntlets", "Titan Greaves", "Royal Burgonet", "Vaal Regalia"].map(base);
    const positive = (m: (typeof registry.catalog)[number], tags: ReadonlySet<TagId>) =>
        m.spawn.some((e) => e.weight > 0 && tags.has(e.tag));

    it("is one row for every top-tier influence row with an elevated row of its group", () => {
        let tops = 0;
        let ambiguous = 0;
        const seen = new Set<string>();
        for (const b of armour) {
            const tags = new Set(INFLUENCES.flatMap((i) => [...registry.influenceTags(b, i)]));
            for (const row of registry.catalog) {
                if (row.source === "elevated" || row.domain !== b.domain || seen.has(row.id))
                    continue;
                if (
                    !positive(row, tags) ||
                    row.spawn.some((e) => e.weight > 0 && b.tags.has(e.tag))
                )
                    continue;
                seen.add(row.id);
                const own = new Set(
                    row.spawn.filter((e) => e.weight > 0 && tags.has(e.tag)).map((e) => e.tag),
                );
                const higher = registry.catalog.some(
                    (m) =>
                        m.type === row.type &&
                        m.source !== "elevated" &&
                        m.minLevel > row.minLevel &&
                        positive(m, own),
                );
                if (higher) continue;
                const candidates = registry.catalog.filter(
                    (m) =>
                        m.source === "elevated" &&
                        !/^OLD/i.test(m.id) &&
                        [...m.families].some((f) => row.families.has(f)) &&
                        m.spawn.some((e) => own.has(e.tag)),
                );
                if (candidates.length === 0) continue;
                tops++;
                if (candidates.length > 1) ambiguous++;
                const e = registry.elevatedOf(row);
                expect(e && candidates.includes(e), row.id).toBe(true);
            }
        }
        expect(tops).toBe(221);
        expect(ambiguous).toBe(51);
    });

    it("is named for the row, else of its type", () => {
        const of = (id: string) =>
            registry.elevatedOf(registry.catalog.find((m) => m.id === id)!)?.id;
        expect(of("ImmuneToChilledGroundUber1")).toBe("ImmuneToChilledGroundUberMaven");
        expect(of("MaximumEnergyShieldLeechRateSuffixInfluence1")).toBe(
            "MaximumEnergyShieldLeechRateInfluenceMaven_",
        );
    });
});
