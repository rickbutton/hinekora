import { describe, expect, it } from "vitest";
import {
    type Base,
    ClassId,
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
} from "@hinekora/core";
import { loadDefaultPoe1, registryOf } from "./load.js";

const data = loadDefaultPoe1();
const registry = registryOf(data);

/** Resolve a base by display name (throws if the test's assumption is wrong). */
function base(name: string): Base {
    const r = registry.resolveBase(name);
    if (!r.ok) throw new Error(`expected to resolve "${name}": ${r.error.kind}`);
    return r.value;
}

describe("loadPoe1 — the full committed PoE1 catalog", () => {
    it("loads thousands of bases and mods, matching the manifest counts", () => {
        expect(data.bases.length).toBe(data.manifest.extent.bases);
        expect(data.mods.length).toBe(data.manifest.extent.mods);
        expect(data.bases.length).toBeGreaterThan(1000);
        expect(data.mods.length).toBeGreaterThan(10000);
    });

    it("carries dump provenance in the manifest", () => {
        expect(data.manifest.game).toBe("poe1");
        expect(data.manifest.source.commit).toBe("14e3edc89ed705bd4e4eda5c8135756431c76e81");
        // publishedAt is the gh-pages republish timestamp — it changes on rebuilds
        // even for the same commit, so assert only that provenance is present.
        expect(data.manifest.source.publishedAt).toBeTruthy();
    });

    it("loads the essence and bench catalogs", () => {
        expect(data.essences.length).toBeGreaterThan(50);
        expect(data.benchCrafts.length).toBeGreaterThan(500);
        // An essence grants a specific mod per item class.
        expect(data.essences.every((e) => e.grants.size > 0)).toBe(true);
    });

    it("loads the fossil catalog and resolves a fossil by its first word", () => {
        expect(data.fossils.length).toBe(data.manifest.extent.fossils);
        const pristine = registry.resolveFossil("pristine");
        expect(pristine.ok && [...pristine.value.blockedTags]).toEqual(["defences"]);
        const hollow = registry.resolveFossil("Hollow Fossil");
        expect(hollow.ok && hollow.value.forcedMods).toEqual(["DelveAbyssJewelSocket1"]);
        expect(hollow.ok && hollow.value.allowedTags?.has(TagId("helmet"))).toBe(true);
        expect(registry.resolveFossil("glyphic")).toMatchObject({
            value: { corruptedEssenceChance: 100 },
        });
        expect(registry.resolveFossil("tangled")).toMatchObject({
            value: { corruptedEssenceChance: 10 },
        });
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
        expect(registry.eldritchPool(base("Iron Ring"), "exarch", 3)).toEqual([]);
        // The wording covers the plain implicit and its two "presence" variants.
        const speed = registry.resolveEldritch("attack speed", "exarch", gloves);
        expect(speed.ok && speed.value.length).toBe(3);
        expect(registry.resolveEldritch("attack speed", "eater", gloves).ok).toBe(false);
        const vague = registry.resolveEldritch("increased", "exarch", gloves);
        expect(!vague.ok && vague.error.kind).toBe("ambiguous");
        // One wording per implicit, not one per tier.
        const names = registry.eldritchNames("eater");
        expect(names.length).toBeGreaterThan(50);
        expect(names.length).toBeLessThan(400);
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
        expect(registry.essences.some((e) => e.tier === 8 && !isCorruptedEssence(e))).toBe(true);
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
        // Full name + a DISAGREEING tier does not silently resolve.
        expect(registry.resolveEssence("Deafening Essence of Greed", 2).ok).toBe(false);
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

    it("reports a colliding base name as ambiguous, with candidates", () => {
        // Several bases share the name "Academy Map".
        const r = registry.resolveBase("Academy Map");
        expect(r.ok).toBe(false);
        if (!r.ok) {
            expect(r.error.kind).toBe("ambiguous");
            if (r.error.kind === "ambiguous") expect(r.error.candidates.length).toBeGreaterThan(1);
        }
    });

    it("resolves mods by id and provides the standard currencies", () => {
        expect(registry.resolveMod("Strength1").ok).toBe(true);
        expect(registry.resolveCurrency("exalt").ok).toBe(true);
    });

    it("carries affix-cap deltas from experimented-base implicits", () => {
        // Simplex: −2 prefix / −1 suffix (rare 1p/2s); Ratcheting: −3 / +3.
        expect(base("Simplex Amulet").capDelta).toEqual({ prefix: -2, suffix: -1 });
        expect(base("Ratcheting Ring").capDelta).toEqual({ prefix: -3, suffix: 3 });
        expect(base("Iron Ring").capDelta).toBeUndefined(); // an ordinary base has none
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
        expect(both).toBe(130);
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
