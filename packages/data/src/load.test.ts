import { describe, expect, it } from "vitest";
import { type Base, type Item, pool } from "@hinekora/core";
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
        expect(data.manifest.source.publishedAt).toBe("2026-07-14T07:58:14Z");
    });

    it("loads the essence and bench catalogs", () => {
        expect(data.essences.length).toBeGreaterThan(50);
        expect(data.benchCrafts.length).toBeGreaterThan(500);
        // An essence grants a specific mod per item class.
        expect(data.essences.every((e) => e.grants.size > 0)).toBe(true);
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

    it("resolves mods by id and provides the standard currencies/omens", () => {
        expect(registry.resolveMod("Strength1").ok).toBe(true);
        expect(registry.resolveCurrency("exalt").ok).toBe(true);
        expect(registry.resolveOmen("Dextral Exaltation").ok).toBe(true);
    });
});

describe("fuzzy mod resolution against real data", () => {
    const rctx = { game: "poe1" as const, base: base("Iron Ring"), ilvl: 84 };

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
    const empty = (b: Base): Item => ({
        game: "poe1",
        base: b,
        ilvl: 82,
        rarity: "rare",
        prefixes: [],
        suffixes: [],
    });

    it("computes a non-trivial pool, all in the jewel (misc) domain", () => {
        const candidates = pool(data.mods, empty(jewelBase));
        expect(candidates.length).toBeGreaterThan(50);
        expect(candidates.every((c) => c.mod.domain === jewelBase.domain)).toBe(true);
    });

    it("offers nothing once the jewel is a full 3+3 Rare", () => {
        const distinct = pool(data.mods, empty(jewelBase))
            .map((c) => c.mod)
            .filter((m, i, all) => all.findIndex((x) => x.type === m.type) === i);
        const full: Item = {
            ...empty(jewelBase),
            prefixes: distinct.filter((m) => m.gen === "prefix").slice(0, 3),
            suffixes: distinct.filter((m) => m.gen === "suffix").slice(0, 3),
        };
        expect(pool(data.mods, full)).toHaveLength(0);
    });
});
