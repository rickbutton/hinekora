/**
 * Name resolution (language.md §2): raw strings from the parser → internal
 * entities, in tiers, (1) exact id, (2) curated alias, (3) fuzzy text match.
 * Mods also resolve fuzzily to a ModTYPE (`resolveModType`, see `fuzzy.ts`),
 * since a human writes a stat description, not a tier id.
 */
import type { Base } from "../model/base.js";
import { isCraftedOn } from "../model/capacity.js";
import type { Effect } from "../model/effects.js";
import type { ClassId, Gen, GroupId, ModId, TypeId } from "../model/ids.js";
import { Domain, TagId } from "../model/ids.js";
import {
    type EldritchSide,
    type Influence,
    influenceOfTag,
    influenceTags,
} from "../model/marks.js";
import { withMetamodEffects } from "../model/metamods.js";
import { emptyItem } from "../model/item.js";
import type { Mod } from "../model/mod.js";
import { pool } from "../pool/pool.js";
import {
    type BenchCraft,
    CORRUPTED_ESSENCE_TIER,
    type EldritchImplicitSpec,
    type Element,
    ELEMENTS,
    type EssenceSpec,
    type FossilSpec,
    type HarvestChangeKind,
    type HarvestChangePair,
    type HarvestChangeTable,
} from "../model/sources.js";
import {
    buildTypeIndex,
    matchScore,
    matchTypes,
    normalizeText,
    queryTokens,
    rowWordings,
    singular,
    tokenMatches,
    type TypeMatch,
    type WordingAliasEntry,
    wordingAliases,
} from "./fuzzy.js";
import { rollableTiers, tierLadder } from "./tiers.js";

/** DSL tier (T1 = best) → catalog ladder level (Deafening = 7, Whispering = 1). */
const ladderOf = (tier: number): number => 8 - tier;

const EMPTY_TAGS: ReadonlySet<TagId> = new Set();
/** The cluster jewels' domain, whose notables roll under their enchantment's tag. */
const CLUSTER_DOMAIN = Domain("affliction_jewel");
const EMPTY_SIDES: ReadonlySet<Gen> = new Set();
const EMPTY_FAMILIES: ReadonlySet<GroupId> = new Set();
const EMPTY_EFFECTS: readonly Effect[] = [];

export type ClusterSize = "small" | "medium" | "large";

/** A cluster jewel enchantment: the notables' spawn tag and the words of its stat. */
export interface ClusterEnchant {
    readonly tag: TagId;
    readonly words: string;
}

/** A stat-description completion suggestion. */
export interface StatSuggestion {
    /** The clean, normalized form a user types (e.g. "maximum life"). */
    readonly label: string;
    /** A representative full stat text (e.g. "+(10-24) to maximum Life"). */
    readonly detail: string;
    /** The ModType this suggestion resolves to, lets completion filter by rollability. */
    readonly type: TypeId;
}

/** A currency operation, identified by the op sequence it runs (`currencyOps`). */
export type CurrencyKind =
    | "transmute"
    | "augment"
    | "alteration"
    | "regal"
    | "alchemy"
    | "chaos"
    | "exalt"
    | "annul"
    | "scour"
    | "fracture"
    | "divine";

/**
 * A currency in the catalog. `name`/`kind` drive the language (the alias, and
 * the op sequence the currency runs); `displayName`/`description` are
 * display-only metadata for hover/completion, curated here because RePoE ships
 * neither.
 */
export interface CurrencySpec {
    /** The alias written in a craft, e.g. "exalt". */
    readonly name: string;
    readonly kind: CurrencyKind;
    /** The real in-game item name, e.g. "Exalted Orb". */
    readonly displayName: string;
    /** The in-game-style one-line description, e.g. "Augments a rare item with a new random modifier." */
    readonly description: string;
}

export type ResolveError =
    | { readonly kind: "unknownBase"; readonly name: string }
    /** A base of a class no craft is modelled on: currency, a gem, a map. */
    | { readonly kind: "uncraftedBase"; readonly name: string }
    | { readonly kind: "unknownMod"; readonly name: string }
    | { readonly kind: "unknownCurrency"; readonly name: string }
    | { readonly kind: "unknownEssence"; readonly name: string }
    | { readonly kind: "unknownFossil"; readonly name: string }
    | { readonly kind: "unknownEldritch"; readonly name: string; readonly side: EldritchSide }
    | { readonly kind: "unknownAspect"; readonly name: string }
    | { readonly kind: "unknownBench"; readonly name: string }
    | { readonly kind: "unknownHarvestTag"; readonly name: string }
    | { readonly kind: "unknownEnchant"; readonly name: string }
    /** The name is known, but not at that tier; `best` and `worst` are the tiers it has. */
    | {
          readonly kind: "noSuchTier";
          readonly name: string;
          readonly tier: number;
          readonly best: number;
          readonly worst: number;
      }
    | { readonly kind: "ambiguous"; readonly name: string; readonly candidates: readonly string[] };

/**
 * The Aspect skills the Bestiary crafts (Beastcrafting, "Craft an Aspect Skill
 * onto an Item"), by the beast's animal, each the level-30 row the recipe places.
 */
export const ASPECTS: Readonly<Record<string, string>> = {
    cat: "GrantsCatAspectCrafted30",
    avian: "GrantsBirdAspectCrafted30",
    spider: "GrantsSpiderAspectCrafted30",
    crab: "GrantsCrabAspectCrafted30",
};

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
            ["drop", "drop"],
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

/** The eleven tags the grove has an augment for (List of harvest crafting
 *  options); the other reforge tags have none. */
export const HARVEST_AUGMENT_TAGS: ReadonlySet<TagId> = new Set(
    [
        "fire",
        "cold",
        "lightning",
        "physical",
        "life",
        "defences",
        "chaos",
        "attack",
        "caster",
        "speed",
        "critical",
    ].map(TagId),
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
    "drop",
    "elemental",
    "fire",
    "life",
    "lightning",
    "mana",
    "minion",
    "physical",
    "speed",
];

export interface HarvestChange {
    readonly kind: HarvestChangeKind;
    readonly element: Element;
}

export type Resolved<T> =
    { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: ResolveError };

const found = <T>(value: T): Resolved<T> => ({ ok: true, value });
const fail = <T>(error: ResolveError): Resolved<T> => ({ ok: false, error });

/** Item context that lets fuzzy mod-type resolution filter by rollability. */
export interface ModTypeContext {
    readonly base: Base;
    readonly ilvl: number;
    /** The item's influence tags, under which its influence rows roll. */
    readonly tags?: ReadonlySet<TagId>;
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
    /**
     * Of rows of one ModType, the ones a name means: the row whose id it is,
     * or the rows whose own wording has every word of it. All of them where
     * the name tells none apart.
     */
    rowsNamed(name: string, rows: readonly Mod[]): readonly Mod[];
    resolveCurrency(name: string): Resolved<CurrencySpec>;
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
    /** The types the bench can put on an item class: what an anonymous crafted
     *  affix may be. */
    benchTypesFor(itemClass: ClassId): ReadonlySet<TypeId>;
    /** The bench tier of the craft that adds this mod row, if the bench adds it. */
    benchTierOf(mod: ModId): number | undefined;
    /** The rows the bench crafts onto an item class. */
    benchModsFor(itemClass: ClassId): ReadonlySet<ModId>;
    /** Resolve a fossil by name, in full ("Pristine Fossil") or by its first word. */
    resolveFossil(name: string): Resolved<FossilSpec>;
    /** The eldritch implicit rows an ember or ichor of that tier can give a base. */
    eldritchPool(base: Base, side: EldritchSide, tier: number): readonly EldritchImplicitSpec[];
    /** The rows an eldritch implicit of that tier on a base may be: the pool's,
     *  and the tiers only an Orb of Conflict reaches. */
    eldritchRows(base: Base, side: EldritchSide, tier: number): readonly EldritchImplicitSpec[];
    /** Resolve an eldritch implicit's wording to every type it covers on that side
     *  (the "presence" variants share a wording), narrowed to the base when given. */
    resolveEldritch(name: string, side: EldritchSide, base?: Base): Resolved<readonly TypeId[]>;
    /** The eldritch implicits' texts of that side, each once, for completion. */
    eldritchNames(side: EldritchSide): readonly string[];
    /** The wording of an eldritch implicit type, the most common text among its rows. */
    eldritchTextOf(type: TypeId): string | undefined;
    /** What the grove's change craft reads a modifier type as: a resistance or
     *  a damage modifier of an element, or nothing it takes. */
    harvestChangeOf(type: TypeId): HarvestChange | undefined;
    /** The type a Harvest change turns `type` into for that element, by the
     *  data's pairing table. Undefined where the grove refuses the change. */
    harvestChangeTarget(type: TypeId, element: Element): TypeId | undefined;
    /** The elevated row an Orb of Dominance makes of an influence row at the
     *  top of its ladder, where the data has one: of those sharing its group
     *  under its influence, the one named for it (its id less its tier, plus
     *  "Maven"), else the one of its type. Never a retired (`OLD…`) row. */
    elevatedOf(row: Mod): Mod | undefined;
    /** Resolve an Aspect by its animal ("cat") to the row the Bestiary crafts:
     *  the level-30 skill's, or the level-20 one's of the recipe that takes
     *  the one beast. */
    resolveAspect(name: string, level?: 20 | 30): Resolved<Mod>;
    /** The generation (prefix/suffix) a ModType always occupies, if known. */
    genOfType(type: TypeId): Gen | undefined;
    /** A cluster jewel's enchantment that decides its notable pool, named by the
     *  words of the stat its small passives grant ("lightning damage"); the
     *  catalog knows it as the spawn tag the notables roll under. */
    resolveClusterEnchant(name: string): Resolved<TagId>;
    clusterEnchants(): readonly ClusterEnchant[];
    /** The cluster jewel sizes an enchantment appears on; undefined where the
     *  data does not say. */
    clusterSizesOf(enchant: TagId): ReadonlySet<ClusterSize> | undefined;
    /** A cluster jewel base with its enchantment's tag: one object per base and
     *  enchantment, so what is cached by the base is shared between checks. */
    enchantedBase(base: Base, enchant: TagId): Base;
    /** The sides the type's rows sit on across the catalog: one for most types,
     *  both for a type that is a prefix on one base and a suffix on another. */
    sidesOfType(type: TypeId): ReadonlySet<Gen>;
    /** The mod groups (families) a ModType belongs to, across its tiers. */
    familiesOfType(type: TypeId): ReadonlySet<GroupId>;
    /** The types sharing a modifier group (family) with this one, itself included:
     *  what `has group` asks about and what a bench craft of it clashes with. */
    groupOf(type: TypeId): ReadonlySet<TypeId>;
    /** The tags any row of a ModType adds to the item while present. */
    addsTagsOfType(type: TypeId): ReadonlySet<TagId>;
    /** The tags an influence adds to a base, the ones its rows' spawn tables name. */
    influenceTags(base: Base, influence: Influence): ReadonlySet<TagId>;
    /** The effects a ModType carries (non-empty only for metamod carriers). */
    effectsOfType(type: TypeId): readonly Effect[];
    /** Canonical range-stripped wording for a ModType ("maximum life"), for
     *  hover/diagnostics; falls back to the raw TypeId. */
    typeLabel(type: TypeId): string;

    // --- completion lists (precomputed) ---
    readonly currencyNames: readonly string[];
    readonly currencies: readonly CurrencySpec[];
    /** Display names that name one base of a class that takes modifiers. */
    readonly baseNames: readonly string[];
    readonly statSuggestions: readonly StatSuggestion[];
    /** Full essence names, for `essence "…"` completion. */
    readonly essenceNames: readonly string[];
    readonly fossilNames: readonly string[];
    readonly aspectNames: readonly string[];
    readonly essences: readonly EssenceSpec[];
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
    {
        name: "fracture",
        kind: "fracture",
        displayName: "Fracturing Orb",
        description: "Fractures a random modifier on an item with at least four modifiers.",
    },
    {
        name: "divine",
        kind: "divine",
        displayName: "Divine Orb",
        description: "Randomises the values of the random modifiers on an item.",
    },
];

export interface RegistryData {
    readonly bases: readonly Base[];
    readonly mods: readonly Mod[];
    /** Optional human aliases → mod id (e.g. "T1 Life" → "IncreasedLife1"). */
    readonly modAliases?: Readonly<Record<string, string>>;
    readonly baseAliases?: Readonly<Record<string, string>>;
    /** Optional community wordings → the game's ("spell suppression" → "chance to
     *  suppress spell damage"), rewritten inside a modifier name before matching. */
    readonly wordingAliases?: Readonly<Record<string, WordingAliasEntry>>;
    readonly currencies?: readonly CurrencySpec[];
    readonly essences?: readonly EssenceSpec[];
    readonly benchCrafts?: readonly BenchCraft[];
    readonly fossils?: readonly FossilSpec[];
    readonly eldritch?: readonly EldritchImplicitSpec[];
    readonly harvestChange?: HarvestChangeTable;
    /** The enchantment tags a cluster jewel of each size can have. */
    readonly clusterEnchants?: Readonly<Partial<Record<ClusterSize, readonly string[]>>>;
    /** Aspect name → the row the Bestiary crafts; the game's four by default. */
    readonly aspects?: Readonly<Record<string, string>>;
}

/** Do two bases agree on everything the model reads of a base: class, domain,
 *  tags and affix caps? */
function sameToTheModel(a: Base, b: Base): boolean {
    if (a.itemClass !== b.itemClass || a.domain !== b.domain) return false;
    if (a.tags.size !== b.tags.size || [...a.tags].some((t) => !b.tags.has(t))) return false;
    return (
        (a.capDelta?.prefix ?? 0) === (b.capDelta?.prefix ?? 0) &&
        (a.capDelta?.suffix ?? 0) === (b.capDelta?.suffix ?? 0)
    );
}

/** Lookups are case-insensitive on the whole name; ids and aliases are both accepted. */
export function buildRegistry(data: RegistryData): Registry {
    const norm = (s: string): string => s.trim().toLowerCase();

    const baseById = new Map(data.bases.map((b) => [norm(b.id), b] as const));
    const baseAlias = new Map(
        Object.entries(data.baseAliases ?? {}).map(
            ([alias, id]) => [norm(alias), norm(id)] as const,
        ),
    );
    // Display names are not unique, so a name maps to a list; >1 hit is ambiguous
    // unless the hits are one base to the model.
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

    const wordings = wordingAliases(data.wordingAliases ?? {});

    const currencyByName = new Map(
        (data.currencies ?? STANDARD_CURRENCIES).map((c) => [norm(c.name), c] as const),
    );
    const essences = data.essences ?? [];
    const benchCrafts = data.benchCrafts ?? [];
    const fossils = data.fossils ?? [];
    // The bench's types per item class: a name may mean a modifier only the
    // bench puts on this class (a metamod), which no spawn table admits.
    const benchTypesByClass = new Map<ClassId, Set<TypeId>>();
    const benchTierByMod = new Map<ModId, number>();
    const benchModsByClass = new Map<ClassId, Set<ModId>>();
    for (const craft of benchCrafts) {
        const mod = modById.get(norm(craft.mod));
        if (!mod) continue;
        const type = mod.type;
        benchTierByMod.set(mod.id, craft.tier);
        for (const cls of craft.itemClasses) {
            let types = benchTypesByClass.get(cls);
            if (!types) benchTypesByClass.set(cls, (types = new Set()));
            types.add(type);
            let rows = benchModsByClass.get(cls);
            if (!rows) benchModsByClass.set(cls, (rows = new Set()));
            rows.add(mod.id);
        }
    }
    const eldritch = data.eldritch ?? [];
    const aspects = new Map(
        Object.entries(data.aspects ?? ASPECTS).map(
            ([name, id]) => [norm(name), norm(id)] as const,
        ),
    );

    const changeOf = new Map<TypeId, HarvestChange>();
    const changeTo = new Map<TypeId, HarvestChangePair["to"]>();
    for (const kind of ["resistance", "damage"] as const) {
        for (const element of ELEMENTS) {
            for (const pair of data.harvestChange?.[kind][element] ?? []) {
                changeOf.set(pair.from, { kind, element });
                changeTo.set(pair.from, pair.to);
            }
        }
    }

    // Elevated rows by the groups they share, retired ones left out (the wiki's
    // Elevated modifier tables list none of them).
    const elevatedByFamily = new Map<GroupId, Mod[]>();
    for (const m of catalog) {
        if (m.source !== "elevated" || /^OLD/i.test(m.id)) continue;
        for (const f of m.families)
            elevatedByFamily.set(f, [...(elevatedByFamily.get(f) ?? []), m]);
    }
    const elevatedMemo = new Map<Mod, Mod | undefined>();
    const elevatedPair = (row: Mod): Mod | undefined => {
        const own = new Set(
            row.spawn
                .filter((e) => e.weight > 0 && influenceOfTag(e.tag) !== undefined)
                .map((e) => e.tag),
        );
        const candidates = [
            ...new Set([...row.families].flatMap((f) => elevatedByFamily.get(f) ?? [])),
        ].filter((m) => m.spawn.some((e) => own.has(e.tag)));
        if (candidates.length <= 1) return candidates[0];
        const bare = (id: string): string => id.replace(/_+$/, "");
        // "ImmuneToChilledGroundUber1" → "…UberMaven", "…Influence2New_" → "…InfluenceMavenNew".
        const named = bare(row.id).replace(/\d+(New)?$/, "Maven$1");
        const byName = candidates.filter((m) => bare(m.id) === named);
        if (byName.length === 1) return byName[0];
        const byType = candidates.filter((m) => m.type === row.type);
        return byType.length === 1 ? byType[0] : undefined;
    };

    const typeGen = new Map<TypeId, Gen>();
    for (const m of catalog) if (!typeGen.has(m.type)) typeGen.set(m.type, m.gen);
    // The cluster jewel enchantments are the `affliction_` spawn tags the
    // notables roll under, worded by their slug ("affliction_lightning_damage").
    const enchantTags = new Set<string>();
    for (const m of catalog) {
        if (m.domain !== CLUSTER_DOMAIN) continue;
        for (const w of m.spawn)
            if (w.weight > 0 && w.tag.startsWith("affliction_")) enchantTags.add(w.tag);
    }
    const enchants: ClusterEnchant[] = [...enchantTags].sort().map((tag) => ({
        tag: TagId(tag),
        words: tag.slice("affliction_".length).replace(/_+$/, "").replaceAll("_", " "),
    }));
    const enchantedBases = new WeakMap<Base, Map<TagId, Base>>();
    const enchantSizes = new Map<TagId, Set<ClusterSize>>();
    for (const [size, tags] of Object.entries(data.clusterEnchants ?? {})) {
        for (const tag of tags) {
            const sizes = enchantSizes.get(TagId(tag));
            if (sizes) sizes.add(size as ClusterSize);
            else enchantSizes.set(TagId(tag), new Set([size as ClusterSize]));
        }
    }
    const typeSides = new Map<TypeId, Set<Gen>>();
    for (const m of catalog) {
        let sides = typeSides.get(m.type);
        if (!sides) typeSides.set(m.type, (sides = new Set()));
        sides.add(m.gen);
    }

    const typeAddsTags = new Map<TypeId, Set<TagId>>();
    for (const m of catalog) {
        if (m.addsTags.size === 0) continue;
        let tags = typeAddsTags.get(m.type);
        if (!tags) typeAddsTags.set(m.type, (tags = new Set()));
        for (const t of m.addsTags) tags.add(t);
    }
    const typeFamilies = new Map<TypeId, Set<GroupId>>();
    const groupOfType = new Map<TypeId, ReadonlySet<TypeId>>();
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

    // Veiled result types: referenceable (an unveil can produce them) even though
    // the domain gate makes them non-rollable, so `resolveModType` must keep them
    // through the rollability narrowing.
    const veiledTypes = new Set<TypeId>();
    for (const m of catalog) if (m.source === "veiled") veiledTypes.add(m.type);

    const typeIndex = buildTypeIndex(catalog);
    // Read by a name's resolution on an item, and the lists below by completion:
    // built on first use, so a run that reads neither does not pay for them.
    const varied = new Map<Base["domain"], ReturnType<typeof rowWordings>>();
    const variedRows = (domain: Base["domain"]): ReturnType<typeof rowWordings> => {
        let rows = varied.get(domain);
        if (rows === undefined) {
            rows = rowWordings(
                catalog.filter((m) => m.domain === domain),
                typeIndex,
            );
            varied.set(domain, rows);
        }
        return rows;
    };

    // Every tag a spawn table names, which is what tells an influence tag that
    // exists (`ring_shaper`) from one no row would ever match.
    const spawnTags = new Set<TagId>();
    for (const m of catalog) for (const e of m.spawn) spawnTags.add(e.tag);

    // A check resolves the same names on the same item many times over (per
    // influence case, per statement, per edit in the editor). Bounded, since an
    // editor's names change as they are typed.
    const MEMO_LIMIT = 4096;
    const eldritchMemo = new WeakMap<Base, Map<string, readonly EldritchImplicitSpec[]>>();
    const typeMemo = new Map<string, Resolved<TypeId>>();
    const typeMemoByBase = new WeakMap<Base, Map<string, Map<string, Resolved<TypeId>>>>();
    const memoOf = (ctx: ModTypeContext): Map<string, Resolved<TypeId>> => {
        let byItem = typeMemoByBase.get(ctx.base);
        if (byItem === undefined)
            typeMemoByBase.set(
                ctx.base,
                (byItem = new Map<string, Map<string, Resolved<TypeId>>>()),
            );
        const key = `${ctx.ilvl}|${[...(ctx.tags ?? [])].sort().join(",")}`;
        let memo = byItem.get(key);
        if (memo === undefined) {
            if (byItem.size >= MEMO_LIMIT) byItem.clear();
            byItem.set(key, (memo = new Map<string, Resolved<TypeId>>()));
        }
        return memo;
    };

    const matchMemo = new Map<string, readonly TypeMatch[]>();
    const matchesOf = (name: string): readonly TypeMatch[] => {
        let hit = matchMemo.get(name);
        if (hit === undefined) {
            if (matchMemo.size >= MEMO_LIMIT) matchMemo.clear();
            matchMemo.set(name, (hit = matchTypes(typeIndex, name, wordings)));
        }
        return hit;
    };

    /** The varied rows the name's words all match, by type, each with its
     *  score; the item narrows them. */
    const variedMemo = new Map<string, { type: TypeId; rows: { mod: Mod; score: number }[] }[]>();
    const variedOf = (name: string, domain: Base["domain"]) => {
        const key = `${domain}|${name}`;
        let hit = variedMemo.get(key);
        if (hit === undefined) {
            const q = queryTokens(name, wordings);
            hit = [];
            if (q.length > 0) {
                for (const [type, rows] of variedRows(domain)) {
                    const matched = rows
                        .filter(({ tokens }) => q.every((w) => tokenMatches(w, tokens)))
                        .map(({ mod, tokens }) => ({ mod, score: matchScore(q, tokens) }));
                    if (matched.length > 0) hit.push({ type, rows: matched });
                }
            }
            if (variedMemo.size >= MEMO_LIMIT) variedMemo.clear();
            variedMemo.set(key, hit);
        }
        return hit;
    };

    function resolveModTypeOf(name: string, ctx: ModTypeContext | undefined): Resolved<TypeId> {
        const key = norm(name);
        const exact = modById.get(key) ?? modById.get(modAlias.get(key) ?? "");
        if (exact) return found(exact.type);

        let matches = [...matchesOf(name)];
        // A row of the item's that reads differently from its type's
        // wording answers to its own.
        if (ctx) {
            let added = false;
            for (const { type, rows } of variedOf(name, ctx.base.domain)) {
                const ladder = tierLadder(catalog, ctx.base, type, ctx.tags);
                const scores = rows.filter(({ mod }) => ladder.includes(mod)).map((r) => r.score);
                if (scores.length === 0) continue;
                const score = Math.max(...scores);
                const known = matches.findIndex((m) => m.type === type);
                if (known >= 0 && matches[known]!.score >= score) continue;
                const match = { type, entry: typeIndex.get(type)!, score };
                if (known >= 0) matches[known] = match;
                else matches.push(match);
                added = true;
            }
            if (added) matches.sort((a, b) => b.score - a.score);
        }
        // Narrow to types that can actually roll on this item, when known;
        // failing any, to those its level stops short of (an essence or a
        // Harvest change still places one), then to those an unveil or the
        // bench can put on it. The words name what rolls first: a
        // veiled-only type shares many of them with the natural modifier
        // it resembles.
        if (ctx) {
            const rollable = matches.filter(
                (m) => rollableTiers(catalog, ctx.base, ctx.ilvl, m.type, ctx.tags).length > 0,
            );
            const onBase = matches.filter(
                (m) => tierLadder(catalog, ctx.base, m.type, ctx.tags).length > 0,
            );
            const benchable = benchTypesByClass.get(ctx.base.itemClass);
            const reachable = matches.filter(
                (m) => veiledTypes.has(m.type) || benchable?.has(m.type),
            );
            if (rollable.length > 0) matches = rollable;
            else if (onBase.length > 0) matches = onBase;
            else if (reachable.length > 0) matches = reachable;
        }
        if (matches.length === 0) return fail({ kind: "unknownMod", name });

        const top = matches[0]!;
        const tied = matches.filter((m) => m.score === top.score);
        if (tied.length === 1) return found(top.type);
        return fail({ kind: "ambiguous", name, candidates: tied.map((m) => m.entry.text) });
    }

    const eldritchByName = new Map<string, Resolved<readonly TypeId[]>>();
    const eldritchByBase = new WeakMap<Base, Map<string, Resolved<readonly TypeId[]>>>();
    const eldritchMemoOf = (base: Base): Map<string, Resolved<readonly TypeId[]>> => {
        let m = eldritchByBase.get(base);
        if (m === undefined)
            eldritchByBase.set(base, (m = new Map<string, Resolved<readonly TypeId[]>>()));
        return m;
    };
    /** Each implicit's words, read once. */
    const eldritchWords = new Map<EldritchImplicitSpec, { set: Set<string>; key: string }>();
    const wordsOf = (e: EldritchImplicitSpec): { set: Set<string>; key: string } => {
        let w = eldritchWords.get(e);
        if (w === undefined) {
            const tokens = normalizeText(e.text);
            w = { set: new Set(tokens), key: [...new Set(tokens.map(singular))].sort().join(" ") };
            eldritchWords.set(e, w);
        }
        return w;
    };

    function resolveEldritchOf(
        name: string,
        side: EldritchSide,
        base: Base | undefined,
    ): Resolved<readonly TypeId[]> {
        const q = normalizeText(name);
        if (q.length === 0) return fail({ kind: "unknownEldritch", name, side });
        const rows = eldritch.filter(
            (e) =>
                e.side === side &&
                (base === undefined || [...e.classes].some((t) => base.tags.has(t))),
        );
        // Every query word must be a word (or a prefix of one) of the text.
        // Rows of one wording (the tiers) are one candidate, ranked by how much
        // of the wording the query covers, so "attack speed" names the plain
        // implicit and its presence variants are reached by their condition's
        // words; a tie at the top is ambiguous. A tier that changes a number
        // also changes a plural, so plurals are folded.
        const byWording = new Map<string, { text: string; types: Set<TypeId>; score: number }>();
        for (const e of rows) {
            const { set, key } = wordsOf(e);
            const hit = q.every(
                (w) => set.has(w) || [...set].some((t) => w.length >= 3 && t.startsWith(w)),
            );
            if (!hit) continue;
            const entry = byWording.get(key) ?? {
                text: e.text,
                types: new Set<TypeId>(),
                score: matchScore(q, set),
            };
            entry.types.add(e.type);
            byWording.set(key, entry);
        }
        if (byWording.size === 0) return fail({ kind: "unknownEldritch", name, side });
        const best = Math.max(...[...byWording.values()].map((c) => c.score));
        const top = [...byWording.values()].filter((c) => c.score === best);
        if (top.length > 1) {
            return fail({ kind: "ambiguous", name, candidates: top.map((c) => c.text) });
        }
        return found([...top[0]!.types]);
    }

    // --- precompute completion lists ---
    const currencies = [...new Set(currencyByName.values())];
    const currencyNames = currencies.map((c) => c.name);
    // A base is worth offering when `base:` takes it and its class takes
    // modifiers at all: a class is kept once any base of it has a modifier
    // pool (at the loosest gate, ilvl 100 and rare). A name shared by several
    // bases cannot be written in `base:` and is left out too.
    const baseNamesOf = (): readonly string[] => {
        const craftableClasses = new Set<ClassId>();
        for (const b of data.bases) {
            if (craftableClasses.has(b.itemClass) || !isCraftedOn(b)) continue;
            if (pool(catalog, emptyItem(b, 100, "rare")).length > 0) {
                craftableClasses.add(b.itemClass);
            }
        }
        return [
            ...new Set(
                data.bases
                    .filter((b) => craftableClasses.has(b.itemClass))
                    .map((b) => b.name)
                    .filter(
                        (n): n is string =>
                            n !== undefined && baseByName.get(norm(n))?.length === 1,
                    ),
            ),
        ];
    };
    const statSuggestionsOf = (): readonly StatSuggestion[] => {
        const out: StatSuggestion[] = [];
        const seenStat = new Set<string>();
        for (const entry of typeIndex.values()) {
            const label = normalizeText(entry.text).join(" ");
            if (label && !seenStat.has(label)) {
                seenStat.add(label);
                out.push({ label, detail: entry.text, type: entry.type });
            }
        }
        return out;
    };
    const benchNamesOf = (): readonly string[] => [
        ...new Set(
            benchCrafts
                .map((c) => modById.get(norm(c.mod))?.text)
                .filter((t): t is string => t !== undefined)
                .map((t) => normalizeText(t).join(" "))
                .filter((t) => t.length > 0),
        ),
    ];
    let baseNames: readonly string[] | undefined;
    let statSuggestions: readonly StatSuggestion[] | undefined;
    let benchNames: readonly string[] | undefined;

    return {
        catalog,
        currencyNames,
        currencies,
        get baseNames() {
            return (baseNames ??= baseNamesOf());
        },
        get statSuggestions() {
            return (statSuggestions ??= statSuggestionsOf());
        },
        essenceNames: essences.map((e) => e.name),
        fossilNames: fossils.map((f) => f.name),
        aspectNames: [...aspects.keys()],
        essences,
        get benchNames() {
            return (benchNames ??= benchNamesOf());
        },
        harvestTags: HARVEST_TAG_LABELS,

        resolveBase(name) {
            const key = norm(name);
            const admit = (b: Base): Resolved<Base> =>
                isCraftedOn(b) ? found(b) : fail({ kind: "uncraftedBase", name });
            const direct = baseById.get(key);
            if (direct) return admit(direct);
            const aliased = baseAlias.get(key);
            const viaAlias = aliased ? baseById.get(aliased) : undefined;
            if (viaAlias) return admit(viaAlias);
            const named = baseByName.get(key) ?? [];
            // A name shared with a base no craft is modelled on means the other.
            const crafted = named.filter(isCraftedOn);
            const byName = crafted.length > 0 ? crafted : named;
            if (byName.length === 1) return admit(byName[0]!);
            if (byName.length > 1) {
                // Variants that share a name and everything the model reads are one
                // base to the checker, so any of them serves: a talisman's implicit
                // variants, a tincture's old and new id.
                const [first, ...rest] = byName;
                if (crafted.length === 0 || rest.every((b) => sameToTheModel(first!, b))) {
                    return admit(first!);
                }
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
            const byItem = ctx === undefined ? typeMemo : memoOf(ctx);
            const hit = byItem.get(name);
            if (hit !== undefined) return hit;
            if (byItem.size >= MEMO_LIMIT) byItem.clear();
            const r = resolveModTypeOf(name, ctx);
            byItem.set(name, r);
            return r;
        },

        rowsNamed(name, rows) {
            if (rows.length < 2) return rows;
            const key = norm(name);
            const exact = modById.get(key) ?? modById.get(modAlias.get(key) ?? "");
            if (exact) return rows.includes(exact) ? [exact] : rows;
            const q = queryTokens(name, wordings);
            const named = rows.filter((m) => {
                const tokens = new Set(normalizeText(m.text ?? ""));
                return q.every((w) => tokenMatches(w, tokens));
            });
            return named.length > 0 ? named : rows;
        },

        resolveCurrency(name) {
            const c = currencyByName.get(norm(name));
            return c ? found(c) : fail({ kind: "unknownCurrency", name });
        },

        resolveHarvestTag(name) {
            const tag = HARVEST_TAGS.get(norm(name));
            return tag ? found(tag) : fail({ kind: "unknownHarvestTag", name });
        },

        resolveClusterEnchant(name) {
            const q = normalizeText(name);
            if (q.length === 0) return fail({ kind: "unknownEnchant", name });
            const scored = enchants.flatMap((e) => {
                const tokens = new Set(normalizeText(e.words));
                return q.every((w) => tokenMatches(w, tokens))
                    ? [{ e, score: matchScore(q, tokens) }]
                    : [];
            });
            if (scored.length === 0) return fail({ kind: "unknownEnchant", name });
            const best = Math.max(...scored.map((s) => s.score));
            const top = scored.filter((s) => s.score === best);
            if (top.length > 1) {
                return fail({ kind: "ambiguous", name, candidates: top.map((s) => s.e.words) });
            }
            return found(top[0]!.e.tag);
        },

        clusterEnchants() {
            return enchants;
        },

        clusterSizesOf(enchant) {
            return enchantSizes.get(enchant);
        },

        enchantedBase(base, enchant) {
            let byEnchant = enchantedBases.get(base);
            if (byEnchant === undefined) {
                byEnchant = new Map<TagId, Base>();
                enchantedBases.set(base, byEnchant);
            }
            let enchanted = byEnchant.get(enchant);
            if (enchanted === undefined) {
                enchanted = { ...base, tags: new Set([...base.tags, enchant]) };
                byEnchant.set(enchant, enchanted);
            }
            return enchanted;
        },

        resolveEssence(name, tier) {
            const q = normalizeText(name);
            if (q.length === 0) return fail({ kind: "unknownEssence", name });
            // Match against the FULL name so a bare type and a full name both
            // work; a tier narrows to that rung AND rejects a name that
            // disagrees with it ("Deafening…" + t2 → no match).
            const named = essences.filter((e) => {
                const tokens = new Set(normalizeText(e.name));
                return q.every((w) => tokens.has(w));
            });
            const matches =
                tier === undefined ? named : named.filter((e) => e.tier === ladderOf(tier));
            if (matches.length === 1) return found(matches[0]!);
            // A corrupted essence is its ladder's one rung, so `t1` names it too.
            if (
                matches.length === 0 &&
                tier === 1 &&
                named.length === 1 &&
                named[0]!.tier === CORRUPTED_ESSENCE_TIER
            ) {
                return found(named[0]!);
            }
            if (matches.length === 0 && tier !== undefined && named.length > 0) {
                const tiers = named.map((e) =>
                    e.tier === CORRUPTED_ESSENCE_TIER ? 1 : ladderOf(e.tier),
                );
                return fail({
                    kind: "noSuchTier",
                    name,
                    tier,
                    best: Math.min(...tiers),
                    worst: Math.max(...tiers),
                });
            }
            if (matches.length === 0) return fail({ kind: "unknownEssence", name });
            return fail({ kind: "ambiguous", name, candidates: matches.map((e) => e.name) });
        },

        harvestChangeOf(type) {
            return changeOf.get(type);
        },

        harvestChangeTarget(type, element) {
            return changeTo.get(type)?.[element]?.type ?? undefined;
        },

        elevatedOf(row) {
            if (!elevatedMemo.has(row)) elevatedMemo.set(row, elevatedPair(row));
            return elevatedMemo.get(row);
        },

        resolveAspect(name, level = 30) {
            // The one-beast recipe's level-20 row is named as the level-30 one
            // without its level ("GrantsCatAspectCrafted").
            const top = aspects.get(norm(name));
            const id = level === 30 ? top : top?.replace(/30$/, "");
            const mod = id === undefined ? undefined : modById.get(id);
            return mod ? found(mod) : fail({ kind: "unknownAspect", name });
        },

        resolveFossil(name) {
            const q = normalizeText(name);
            if (q.length === 0) return fail({ kind: "unknownFossil", name });
            const matches = fossils.filter((f) => {
                const tokens = new Set(normalizeText(f.name));
                return q.every((w) => tokens.has(w));
            });
            if (matches.length === 1) return found(matches[0]!);
            if (matches.length === 0) return fail({ kind: "unknownFossil", name });
            return fail({ kind: "ambiguous", name, candidates: matches.map((f) => f.name) });
        },

        eldritchPool(base, side, tier) {
            return this.eldritchRows(base, side, tier).filter((e) => !e.unrollable);
        },

        eldritchRows(base, side, tier) {
            let byBase = eldritchMemo.get(base);
            if (byBase === undefined)
                eldritchMemo.set(
                    base,
                    (byBase = new Map<string, readonly EldritchImplicitSpec[]>()),
                );
            const key = `${side}${tier}`;
            let rows = byBase.get(key);
            if (rows === undefined) {
                rows = eldritch.filter(
                    (e) =>
                        e.side === side &&
                        e.tier === tier &&
                        [...e.classes].some((t) => base.tags.has(t)),
                );
                byBase.set(key, rows);
            }
            return rows;
        },

        resolveEldritch(name, side, base) {
            const memo = base === undefined ? eldritchByName : eldritchMemoOf(base);
            const key = `${side}|${name}`;
            let r = memo.get(key);
            if (r === undefined) {
                if (memo.size >= MEMO_LIMIT) memo.clear();
                memo.set(key, (r = resolveEldritchOf(name, side, base)));
            }
            return r;
        },

        eldritchNames(side) {
            // One wording per implicit: the tiers and the presence variants of
            // one implicit differ only in their numbers and the plurals they bring.
            const seen = new Set<string>();
            const out: string[] = [];
            for (const e of eldritch) {
                if (e.side !== side) continue;
                const key = [...new Set(normalizeText(e.text).map(singular))].sort().join(" ");
                if (seen.has(key)) continue;
                seen.add(key);
                out.push(e.text);
            }
            return out;
        },

        eldritchTextOf(type) {
            const counts = new Map<string, number>();
            for (const e of eldritch) {
                if (e.type === type) counts.set(e.text, (counts.get(e.text) ?? 0) + 1);
            }
            let best: string | undefined;
            let bestN = 0;
            for (const [text, n] of counts) if (n > bestN) [best, bestN] = [text, n];
            return best;
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
                if (q.every((w) => tokenMatches(w, tokens))) {
                    scored.push({ craft, mod, score: matchScore(q, tokens) });
                }
            }
            if (scored.length === 0) return fail({ kind: "unknownBench", name });
            const top = Math.max(...scored.map((s) => s.score));
            const best = scored.filter((s) => s.score === top);
            const sorted = best.sort((a, b) => b.craft.tier - a.craft.tier);
            // A modifier's tiers are one candidate, named by its best.
            const byType = new Map<TypeId, string>();
            for (const s of sorted) {
                if (!byType.has(s.mod.type)) byType.set(s.mod.type, s.mod.text ?? "");
            }
            if (byType.size > 1) {
                return fail({ kind: "ambiguous", name, candidates: [...byType.values()] });
            }
            const pick = tier === undefined ? sorted[0] : sorted[tier - 1];
            if (pick) return found(pick.craft);
            return fail({
                kind: "noSuchTier",
                name,
                tier: tier ?? 1,
                best: 1,
                worst: sorted.length,
            });
        },

        benchTypesFor(itemClass) {
            return benchTypesByClass.get(itemClass) ?? new Set<TypeId>();
        },

        benchTierOf(mod) {
            return benchTierByMod.get(mod);
        },

        benchModsFor(itemClass) {
            return benchModsByClass.get(itemClass) ?? new Set<ModId>();
        },

        genOfType(type) {
            return typeGen.get(type);
        },

        sidesOfType(type) {
            return typeSides.get(type) ?? EMPTY_SIDES;
        },

        familiesOfType(type) {
            return typeFamilies.get(type) ?? EMPTY_FAMILIES;
        },

        groupOf(type) {
            const cached = groupOfType.get(type);
            if (cached) return cached;
            const fams = typeFamilies.get(type) ?? EMPTY_FAMILIES;
            const out = new Set<TypeId>([type]);
            for (const [t, fs] of typeFamilies) {
                for (const f of fs) {
                    if (fams.has(f)) {
                        out.add(t);
                        break;
                    }
                }
            }
            groupOfType.set(type, out);
            return out;
        },

        addsTagsOfType(type) {
            return typeAddsTags.get(type) ?? EMPTY_TAGS;
        },
        influenceTags(base, influence) {
            return influenceTags(base, influence, spawnTags);
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
