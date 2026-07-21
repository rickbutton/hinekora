/**
 * Name resolution (surface doc §2): raw strings from the parser → internal
 * entities, in tiers, (1) exact id, (2) curated alias, (3) fuzzy text match.
 * Mods also resolve fuzzily to a ModTYPE (`resolveModType`, see `fuzzy.ts`),
 * since a human writes a stat description, not a tier id.
 */
import type { Base } from "../model/base.js";
import type { Effect } from "../model/effects.js";
import type { ClassId, Game, Gen, GroupId, TypeId } from "../model/ids.js";
import { TagId } from "../model/ids.js";
import { withMetamodEffects } from "../model/metamods.js";
import type { Mod } from "../model/mod.js";
import type { BenchCraft, EssenceSpec } from "../model/sources.js";
import { buildTypeIndex, matchTypes, normalizeText } from "./fuzzy.js";
import { rollableTiers } from "./tiers.js";

/** DSL tier (T1 = best) → catalog ladder level (Deafening = 7, Whispering = 1). */
const ladderOf = (tier: number): number => 8 - tier;

/** Shared empty result for `familiesOfType` on an unknown type. */
const EMPTY_FAMILIES: ReadonlySet<GroupId> = new Set();
/** Shared empty result for `effectsOfType` on a non-carrier type. */
const EMPTY_EFFECTS: readonly Effect[] = [];

/** A stat-description completion suggestion. */
export interface StatSuggestion {
    /** The clean, normalized form a user types (e.g. "maximum life"). */
    readonly label: string;
    /** A representative full stat text (e.g. "+(10-24) to maximum Life"). */
    readonly detail: string;
    /** The ModType this suggestion resolves to, lets completion filter by rollability. */
    readonly type: TypeId;
}

/** A currency operation, identified by which transfer-function semantics it has. */
export type CurrencyKind =
    | "transmute"
    | "augment"
    | "alteration"
    | "regal"
    | "alchemy"
    | "chaos"
    | "exalt"
    | "annul"
    | "scour";

/**
 * A currency in the catalog. `name`/`kind` drive the language (alias + which
 * transfer function governs it); `displayName`/`description` are display-only
 * metadata for hover/completion, curated here because RePoE ships neither.
 */
export interface CurrencySpec {
    /** The alias written in a craft, e.g. "exalt". */
    readonly name: string;
    /** Which transfer function's semantics this currency has. */
    readonly kind: CurrencyKind;
    /** The real in-game item name, e.g. "Exalted Orb". */
    readonly displayName: string;
    /** The in-game-style one-line description, e.g. "Augments a rare item with a new random modifier." */
    readonly description: string;
}

/**
 * A PoE2 omen that forces a specific operation to a specific generation.
 * Dextral = right = suffix; Sinistral = left = prefix.
 */
export interface OmenSpec {
    readonly name: string;
    readonly directs: "exalt" | "annul";
    readonly gen: Gen;
}

export type ResolveError =
    | { readonly kind: "unknownBase"; readonly name: string }
    | { readonly kind: "unknownMod"; readonly name: string }
    | { readonly kind: "unknownCurrency"; readonly name: string }
    | { readonly kind: "unknownOmen"; readonly name: string }
    | { readonly kind: "unknownEssence"; readonly name: string }
    | { readonly kind: "unknownBench"; readonly name: string }
    | { readonly kind: "unknownHarvestTag"; readonly name: string }
    | { readonly kind: "ambiguous"; readonly name: string; readonly candidates: readonly string[] };

/**
 * The harvest modifier categories a craft can target, mapping the surface name a
 * user writes to the canonical category tag (`Mod.implicitTags`). Curated: the
 * game groups harvest crafts by these categories, and a couple of surface
 * spellings ("defence") normalize to the data's tag ("defences").
 */
export const HARVEST_TAGS: ReadonlyMap<string, TagId> = new Map(
    (
        [
            ["attack", "attack"],
            ["attribute", "attribute"],
            ["caster", "caster"],
            ["chaos", "chaos"],
            ["cold", "cold"],
            ["critical", "critical"],
            ["defence", "defences"],
            ["defences", "defences"],
            ["elemental", "elemental"],
            ["fire", "fire"],
            ["life", "life"],
            ["lightning", "lightning"],
            ["mana", "mana"],
            ["minion", "minion"],
            ["physical", "physical"],
            ["speed", "speed"],
        ] as const
    ).map(([surface, tag]) => [surface, TagId(tag)] as const),
);

/** One surface label per category, for completion (drops the "defences" alias). */
const HARVEST_TAG_LABELS: readonly string[] = [
    "attack",
    "attribute",
    "caster",
    "chaos",
    "cold",
    "critical",
    "defence",
    "elemental",
    "fire",
    "life",
    "lightning",
    "mana",
    "minion",
    "physical",
    "speed",
];

export type Resolved<T> =
    { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: ResolveError };

const found = <T>(value: T): Resolved<T> => ({ ok: true, value });
const fail = <T>(error: ResolveError): Resolved<T> => ({ ok: false, error });

/** Item context that lets fuzzy mod-type resolution filter by rollability. */
export interface ModTypeContext {
    readonly game: Game;
    readonly base: Base;
    readonly ilvl: number;
}

export interface Registry {
    /** The full mod catalog, for `pool`. */
    readonly catalog: readonly Mod[];
    resolveBase(name: string): Resolved<Base>;
    resolveMod(name: string): Resolved<Mod>;
    /**
     * Fuzzy-resolve a stat description (or exact mod id) to its ModType. With
     * `ctx`, candidates narrow to types that can roll on that base/ilvl,
     * disambiguating identically-worded types of which only one rolls here.
     */
    resolveModType(name: string, ctx?: ModTypeContext): Resolved<TypeId>;
    resolveCurrency(name: string): Resolved<CurrencySpec>;
    resolveOmen(name: string): Resolved<OmenSpec>;
    /** Resolve a harvest modifier category ("fire", "caster") to its canonical
     *  category tag (`Mod.implicitTags`). */
    resolveHarvestTag(name: string): Resolved<TagId>;
    /**
     * Resolve an essence by full name (`"Deafening Essence of Greed"`) or
     * type + tier (`"greed"`, `tier = 1` where T1 = Deafening = best); a bare
     * type without a tier is ambiguous.
     */
    resolveEssence(name: string, tier?: number): Resolved<EssenceSpec>;
    /**
     * Resolve a bench craft by the mod it adds, narrowed to `itemClass`.
     * Multiple bench tiers of one mod pick the best (or the tier given);
     * ambiguity is only across distinct mod families.
     */
    resolveBench(name: string, itemClass?: ClassId, tier?: number): Resolved<BenchCraft>;
    /** The generation (prefix/suffix) a ModType always occupies, if known. */
    genOfType(type: TypeId): Gen | undefined;
    /** The mod groups (families) a ModType belongs to, across its tiers;
     *  drives the bench group-exclusivity check. */
    familiesOfType(type: TypeId): ReadonlySet<GroupId>;
    /** The effects a ModType carries (non-empty only for metamod carriers);
     *  drives the abstract metamod folds (protection, cannot-roll, multimod). */
    effectsOfType(type: TypeId): readonly Effect[];
    /** Canonical range-stripped wording for a ModType ("maximum life"), for
     *  hover/diagnostics; falls back to the raw TypeId. */
    typeLabel(type: TypeId): string;

    // --- completion lists (precomputed) ---
    /** Currency alias names. */
    readonly currencyNames: readonly string[];
    /** The full currency catalog (alias + kind + display name + description). */
    readonly currencies: readonly CurrencySpec[];
    /** Unique base display names. */
    readonly baseNames: readonly string[];
    /** Stat-description suggestions for mod completion. */
    readonly statSuggestions: readonly StatSuggestion[];
    /** Full essence names, for `essence "…"` completion. */
    readonly essenceNames: readonly string[];
    /** Distinct bench-mod descriptions, for `bench "…"` completion. */
    readonly benchNames: readonly string[];
    /** Harvest category labels, for `harvest <verb> "…"` completion. */
    readonly harvestTags: readonly string[];
}

/**
 * The default currency catalog. Adding a new currency means adding a transfer
 * function for its `kind` AND an entry here.
 */
export const STANDARD_CURRENCIES: readonly CurrencySpec[] = [
    {
        name: "transmute",
        kind: "transmute",
        displayName: "Orb of Transmutation",
        description: "Upgrades a normal item to a magic item.",
    },
    {
        name: "augment",
        kind: "augment",
        displayName: "Orb of Augmentation",
        description: "Augments a magic item with a new random modifier.",
    },
    {
        name: "alteration",
        kind: "alteration",
        displayName: "Orb of Alteration",
        description: "Reforges a magic item with new random modifiers.",
    },
    {
        name: "regal",
        kind: "regal",
        displayName: "Regal Orb",
        description: "Upgrades a magic item to a rare item.",
    },
    {
        name: "alchemy",
        kind: "alchemy",
        displayName: "Orb of Alchemy",
        description: "Upgrades a normal item to a rare item.",
    },
    {
        name: "chaos",
        kind: "chaos",
        displayName: "Chaos Orb",
        description: "Reforges a rare item with new random modifiers.",
    },
    {
        name: "exalt",
        kind: "exalt",
        displayName: "Exalted Orb",
        description: "Augments a rare item with a new random modifier.",
    },
    {
        name: "annul",
        kind: "annul",
        displayName: "Orb of Annulment",
        description: "Removes a random modifier from an item.",
    },
    {
        name: "scour",
        kind: "scour",
        displayName: "Orb of Scouring",
        description: "Removes all modifiers from an item.",
    },
];

/** The default omen table (the four Dextral/Sinistral directors modelled so far). */
export const STANDARD_OMENS: readonly OmenSpec[] = [
    { name: "Dextral Exaltation", directs: "exalt", gen: "suffix" },
    { name: "Sinistral Exaltation", directs: "exalt", gen: "prefix" },
    { name: "Dextral Annulment", directs: "annul", gen: "suffix" },
    { name: "Sinistral Annulment", directs: "annul", gen: "prefix" },
];

export interface RegistryData {
    readonly bases: readonly Base[];
    readonly mods: readonly Mod[];
    /** Optional human aliases → mod id (e.g. "T1 Life" → "IncreasedLife1"). */
    readonly modAliases?: Readonly<Record<string, string>>;
    /** Optional base aliases → base id. */
    readonly baseAliases?: Readonly<Record<string, string>>;
    readonly currencies?: readonly CurrencySpec[];
    readonly omens?: readonly OmenSpec[];
    readonly essences?: readonly EssenceSpec[];
    readonly benchCrafts?: readonly BenchCraft[];
}

/**
 * Build a registry from loaded data. Lookups are case-insensitive on the whole
 * name; ids and aliases are both accepted.
 */
export function buildRegistry(data: RegistryData): Registry {
    const norm = (s: string): string => s.trim().toLowerCase();

    const baseById = new Map(data.bases.map((b) => [norm(b.id), b] as const));
    const baseAlias = new Map(
        Object.entries(data.baseAliases ?? {}).map(
            ([alias, id]) => [norm(alias), norm(id)] as const,
        ),
    );
    // Display names are not unique, so a name maps to a list; >1 hit = ambiguous.
    const baseByName = new Map<string, Base[]>();
    for (const b of data.bases) {
        if (b.name === undefined) continue;
        const nk = norm(b.name);
        const bucket = baseByName.get(nk);
        if (bucket) bucket.push(b);
        else baseByName.set(nk, [b]);
    }

    // Attach curated metamod effects (protect / cannot-roll / multimod) to the
    // catalog; every downstream view reads this effect-bearing catalog.
    const catalog = withMetamodEffects(data.mods);

    const modById = new Map(catalog.map((m) => [norm(m.id), m] as const));
    const modAlias = new Map(
        Object.entries(data.modAliases ?? {}).map(
            ([alias, id]) => [norm(alias), norm(id)] as const,
        ),
    );

    const currencyByName = new Map(
        (data.currencies ?? STANDARD_CURRENCIES).map((c) => [norm(c.name), c] as const),
    );
    const omenByName = new Map(
        (data.omens ?? STANDARD_OMENS).map((o) => [norm(o.name), o] as const),
    );
    const essences = data.essences ?? [];
    const benchCrafts = data.benchCrafts ?? [];

    const typeGen = new Map<TypeId, Gen>();
    for (const m of catalog) if (!typeGen.has(m.type)) typeGen.set(m.type, m.gen);

    // Union of families per ModType, the group set used for bench conflict checks.
    const typeFamilies = new Map<TypeId, Set<GroupId>>();
    for (const m of catalog) {
        let fams = typeFamilies.get(m.type);
        if (!fams) typeFamilies.set(m.type, (fams = new Set()));
        for (const f of m.families) fams.add(f);
    }

    // Effects per ModType, from the effect-carrying mods (metamods). A carrier's
    // type is unique to it, so a plain last-wins map is exact.
    const typeEffects = new Map<TypeId, readonly Effect[]>();
    for (const m of catalog)
        if (m.effects && m.effects.length > 0) typeEffects.set(m.type, m.effects);

    const typeIndex = buildTypeIndex(catalog);

    // --- precompute completion lists ---
    const currencies = [...new Set(currencyByName.values())];
    const currencyNames = currencies.map((c) => c.name);
    const baseNames = [
        ...new Set(data.bases.map((b) => b.name).filter((n): n is string => n !== undefined)),
    ];
    const statSuggestions: StatSuggestion[] = [];
    const seenStat = new Set<string>();
    for (const entry of typeIndex.values()) {
        const label = normalizeText(entry.text).join(" ");
        if (label && !seenStat.has(label)) {
            seenStat.add(label);
            statSuggestions.push({ label, detail: entry.text, type: entry.type });
        }
    }

    return {
        catalog,
        currencyNames,
        currencies,
        baseNames,
        statSuggestions,
        essenceNames: essences.map((e) => e.name),
        benchNames: [
            ...new Set(
                benchCrafts
                    .map((c) => modById.get(norm(c.mod))?.text)
                    .filter((t): t is string => t !== undefined)
                    .map((t) => normalizeText(t).join(" "))
                    .filter((t) => t.length > 0),
            ),
        ],
        harvestTags: HARVEST_TAG_LABELS,

        resolveBase(name) {
            const key = norm(name);
            // 1) exact id (metadata path), 2) curated alias, 3) display name.
            const direct = baseById.get(key);
            if (direct) return found(direct);
            const aliased = baseAlias.get(key);
            const viaAlias = aliased ? baseById.get(aliased) : undefined;
            if (viaAlias) return found(viaAlias);
            const byName = baseByName.get(key);
            if (byName && byName.length === 1) return found(byName[0]!);
            if (byName && byName.length > 1) {
                return fail({ kind: "ambiguous", name, candidates: byName.map((b) => b.id) });
            }
            return fail({ kind: "unknownBase", name });
        },

        resolveMod(name) {
            const key = norm(name);
            const direct = modById.get(key);
            if (direct) return found(direct);
            const aliased = modAlias.get(key);
            const viaAlias = aliased ? modById.get(aliased) : undefined;
            return viaAlias ? found(viaAlias) : fail({ kind: "unknownMod", name });
        },

        resolveModType(name, ctx) {
            const key = norm(name);
            // An exact mod id / alias resolves to that mod's type directly.
            const exact = modById.get(key) ?? modById.get(modAlias.get(key) ?? "");
            if (exact) return found(exact.type);

            let matches = matchTypes(typeIndex, name);
            // Narrow to types that can actually roll on this item, when known.
            if (ctx) {
                const rollable = matches.filter(
                    (m) => rollableTiers(catalog, ctx.game, ctx.base, ctx.ilvl, m.type).length > 0,
                );
                if (rollable.length > 0) matches = rollable;
            }
            if (matches.length === 0) return fail({ kind: "unknownMod", name });

            const top = matches[0]!;
            const tied = matches.filter((m) => m.score === top.score);
            if (tied.length === 1) return found(top.type);
            return fail({ kind: "ambiguous", name, candidates: tied.map((m) => m.entry.text) });
        },

        resolveCurrency(name) {
            const c = currencyByName.get(norm(name));
            return c ? found(c) : fail({ kind: "unknownCurrency", name });
        },

        resolveOmen(name) {
            const o = omenByName.get(norm(name));
            return o ? found(o) : fail({ kind: "unknownOmen", name });
        },

        resolveHarvestTag(name) {
            const tag = HARVEST_TAGS.get(norm(name));
            return tag ? found(tag) : fail({ kind: "unknownHarvestTag", name });
        },

        resolveEssence(name, tier) {
            const q = normalizeText(name);
            if (q.length === 0) return fail({ kind: "unknownEssence", name });
            // Match against the FULL name so a bare type and a full name both
            // work; a tier narrows to that rung AND rejects a name that
            // disagrees with it ("Deafening…" + t2 → no match).
            const matches = essences.filter((e) => {
                if (tier !== undefined && e.tier !== ladderOf(tier)) return false;
                const tokens = new Set(normalizeText(e.name));
                return q.every((w) => tokens.has(w));
            });
            if (matches.length === 1) return found(matches[0]!);
            if (matches.length === 0) return fail({ kind: "unknownEssence", name });
            return fail({ kind: "ambiguous", name, candidates: matches.map((e) => e.name) });
        },

        resolveBench(name, itemClass, tier) {
            const q = normalizeText(name);
            if (q.length === 0) return fail({ kind: "unknownBench", name });
            // Score by how tightly the query covers the mod's wording, so
            // "maximum life" prefers the flat life mod over "minions have … life".
            const scored: { craft: BenchCraft; mod: Mod; score: number }[] = [];
            for (const craft of benchCrafts) {
                if (itemClass !== undefined && !craft.itemClasses.has(itemClass)) continue;
                const mod = modById.get(norm(craft.mod));
                if (!mod?.text) continue;
                const tokens = new Set(normalizeText(mod.text));
                if (q.every((w) => tokens.has(w))) {
                    scored.push({ craft, mod, score: q.length / tokens.size });
                }
            }
            if (scored.length === 0) return fail({ kind: "unknownBench", name });
            const top = Math.max(...scored.map((s) => s.score));
            const best = scored.filter((s) => s.score === top);
            // Only distinct mod families are ambiguous; tiers of one mod just
            // pick the best (or the tier given).
            const types = new Set(best.map((s) => s.mod.type));
            if (types.size > 1) {
                return fail({
                    kind: "ambiguous",
                    name,
                    candidates: [...new Set(best.map((s) => s.mod.text ?? ""))],
                });
            }
            const sorted = best.sort((a, b) => b.craft.tier - a.craft.tier);
            const pick = tier === undefined ? sorted[0] : sorted[tier - 1];
            return pick ? found(pick.craft) : fail({ kind: "unknownBench", name });
        },

        genOfType(type) {
            return typeGen.get(type);
        },

        familiesOfType(type) {
            return typeFamilies.get(type) ?? EMPTY_FAMILIES;
        },

        effectsOfType(type) {
            return typeEffects.get(type) ?? EMPTY_EFFECTS;
        },

        typeLabel(type) {
            const entry = typeIndex.get(type);
            return entry ? normalizeText(entry.text).join(" ") : type;
        },
    };
}
