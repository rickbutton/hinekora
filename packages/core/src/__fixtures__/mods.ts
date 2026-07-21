/**
 * Hardcoded mini mod/base set for tests, NOT real game data. A small,
 * deliberately-shaped catalog where each fixture isolates one `pool`/`wf` rule
 * so tests can attribute a pass/reject to a single cause.
 *
 * Shape summary:
 *   - Two domains (item, flask) to isolate the domain gate.
 *   - Three item classes (Ring, Amulet, Flask) to isolate the class gate.
 *   - Life mods (two tiers, same ModType) to test ilvl gating and dup-type.
 *   - Fire-resist + Fire-and-Chaos-resist (shared family) to test exclusion.
 *   - A ring-disabled mod (zero-weight first match) to test spawn ordering.
 *   - An unknown-weight mod (PoE2 sentinel) to test eligibility.
 */
import {
    type Base,
    BaseId,
    ClassId,
    Domain,
    type Effect,
    type Game,
    type Gen,
    type GroupId,
    GroupId as mkGroup,
    type Item,
    type Mod,
    ModId,
    type ModSource,
    type Rarity,
    type SpawnEntry,
    TagId,
    TypeId,
} from "../model/index.js";
import { approx, known, unknown } from "../model/weight.js";

// --- Domains --------------------------------------------------------------

export const DOMAIN_ITEM = Domain("item");
export const DOMAIN_FLASK = Domain("flask");

// --- Item classes ---------------------------------------------------------

export const CLASS_RING = ClassId("Ring");
export const CLASS_AMULET = ClassId("Amulet");
export const CLASS_FLASK = ClassId("LifeFlask"); // a real flask class (caps at Magic)

// --- Tags (for spawn-weight matching) -------------------------------------

export const TAG_DEFAULT = TagId("default"); // catch-all: every base carries it
export const TAG_RING = TagId("ring");
export const TAG_AMULET = TagId("amulet");
export const TAG_FLASK = TagId("flask");
export const TAG_JEWEL = TagId("jewel"); // no fixture base carries this

// Families are referenced by name in each mod's `families` list below (e.g.
// "Life", "ResistFire"); `mkMod` brands the strings into GroupIds.

// --- Bases ----------------------------------------------------------------

export const RING_BASE: Base = {
    id: BaseId("IronRing"),
    itemClass: CLASS_RING,
    domain: DOMAIN_ITEM,
    tags: new Set([TAG_DEFAULT, TAG_RING]),
};

export const AMULET_BASE: Base = {
    id: BaseId("CoralAmulet"),
    itemClass: CLASS_AMULET,
    domain: DOMAIN_ITEM,
    tags: new Set([TAG_DEFAULT, TAG_AMULET]),
};

export const FLASK_BASE: Base = {
    id: BaseId("LifeFlask"),
    itemClass: CLASS_FLASK,
    domain: DOMAIN_FLASK,
    tags: new Set([TAG_DEFAULT, TAG_FLASK]),
};

/** Experimented amulet base (like the Simplex Amulet): −2 prefix / −1 suffix, so
 *  a rare holds 1 prefix + 2 suffixes and a magic holds none. */
export const SIMPLEX_BASE: Base = {
    id: BaseId("SimplexAmulet"),
    itemClass: CLASS_AMULET,
    domain: DOMAIN_ITEM,
    tags: new Set([TAG_DEFAULT, TAG_AMULET]),
    capDelta: { prefix: -2, suffix: -1 },
};

/** Experimented ring base (like the Ratcheting Ring): −3 prefix / +3 suffix, so
 *  a rare holds 0 prefixes + 6 suffixes and a magic 0 prefixes + 2 suffixes
 *  (the +3 is held to the hard magic total of 2, not 4). */
export const RATCHETING_BASE: Base = {
    id: BaseId("RatchetingRing"),
    itemClass: CLASS_RING,
    domain: DOMAIN_ITEM,
    tags: new Set([TAG_DEFAULT, TAG_RING]),
    capDelta: { prefix: -3, suffix: 3 },
};

// --- Mod builder ----------------------------------------------------------

interface ModSpec {
    readonly id: string;
    readonly type: string;
    readonly gen: Gen;
    readonly minLevel: number;
    readonly domain?: Domain; // defaults to item domain
    readonly families?: readonly string[];
    readonly spawn: readonly SpawnEntry[];
    readonly classRestriction?: ReadonlySet<ClassId>;
    readonly effects?: readonly Effect[];
    /** Category tags (fire, caster, life, …) for tag-directed crafting (harvest). */
    readonly implicitTags?: readonly string[];
    readonly source?: ModSource;
    readonly text?: string;
    readonly name?: string;
}

function mkMod(spec: ModSpec): Mod {
    const families = new Set<GroupId>((spec.families ?? []).map(mkGroup));
    // exactOptionalPropertyTypes: attach optional fields only when present,
    // rather than setting them to `undefined`.
    return {
        id: ModId(spec.id),
        type: TypeId(spec.type),
        families,
        gen: spec.gen,
        domain: spec.domain ?? DOMAIN_ITEM,
        minLevel: spec.minLevel,
        addsTags: new Set<TagId>(),
        implicitTags: new Set<TagId>((spec.implicitTags ?? []).map(TagId)),
        spawn: spec.spawn,
        ...(spec.classRestriction !== undefined && { classRestriction: spec.classRestriction }),
        ...(spec.effects !== undefined && { effects: spec.effects }),
        ...(spec.source !== undefined && { source: spec.source }),
        ...(spec.text !== undefined && { text: spec.text }),
        ...(spec.name !== undefined && { name: spec.name }),
    };
}

const spawn = (tag: TagId, w: SpawnEntry["weight"]): SpawnEntry => ({ tag, weight: w });

// --- The catalog ----------------------------------------------------------

/** "increased Life", T1, high tier, gated at ilvl 60. Prefix, family Life. */
export const LIFE_T1: Mod = mkMod({
    id: "IncreasedLife1",
    type: "IncreasedLife",
    gen: "prefix",
    minLevel: 60,
    families: ["Life"],
    spawn: [spawn(TAG_DEFAULT, known(1000))],
    implicitTags: ["life"],
    text: "+(70-84) to maximum Life",
});

/** "increased Life", T2, low tier, gated at ilvl 30. SAME ModType as T1. */
export const LIFE_T2: Mod = mkMod({
    id: "IncreasedLife2",
    type: "IncreasedLife",
    gen: "prefix",
    minLevel: 30,
    families: ["Life"],
    spawn: [spawn(TAG_DEFAULT, known(2000))],
    implicitTags: ["life"],
});

/** A second, unrelated prefix so we can fill prefix slots with distinct types. */
export const INCREASED_MANA: Mod = mkMod({
    id: "IncreasedMana1",
    type: "IncreasedMana",
    gen: "prefix",
    minLevel: 1,
    families: ["Mana"],
    spawn: [spawn(TAG_DEFAULT, known(1000))],
    implicitTags: ["mana"],
});

/** A third prefix, for filling to a 3-prefix cap with distinct ModTypes. */
export const INCREASED_ARMOUR: Mod = mkMod({
    id: "IncreasedArmour1",
    type: "IncreasedArmour",
    gen: "prefix",
    minLevel: 1,
    families: ["Defences"],
    spawn: [spawn(TAG_DEFAULT, known(1000))],
    implicitTags: ["defences"],
});

/** Fire Resistance, suffix, family ResistFire. */
export const FIRE_RESIST: Mod = mkMod({
    id: "FireResist1",
    type: "FireResist",
    gen: "suffix",
    minLevel: 20,
    families: ["ResistFire"],
    spawn: [spawn(TAG_DEFAULT, known(500))],
    implicitTags: ["fire", "elemental", "resistance"],
});

/** Fire & Chaos Resistance, DIFFERENT ModType, but SHARES family ResistFire. */
export const FIRE_CHAOS_RESIST: Mod = mkMod({
    id: "FireChaosResist1",
    type: "FireChaosResist",
    gen: "suffix",
    minLevel: 40,
    families: ["ResistFire", "ResistChaos"],
    spawn: [spawn(TAG_DEFAULT, known(200))],
    implicitTags: ["fire", "chaos", "resistance"],
});

/** Two more distinct suffixes, for filling suffix slots to cap. */
export const COLD_RESIST: Mod = mkMod({
    id: "ColdResist1",
    type: "ColdResist",
    gen: "suffix",
    minLevel: 1,
    families: ["ResistCold"],
    spawn: [spawn(TAG_DEFAULT, known(500))],
    implicitTags: ["cold", "elemental", "resistance"],
});

export const LIGHTNING_RESIST: Mod = mkMod({
    id: "LightningResist1",
    type: "LightningResist",
    gen: "suffix",
    minLevel: 1,
    families: ["ResistLightning"],
    spawn: [spawn(TAG_DEFAULT, known(500))],
    implicitTags: ["lightning", "elemental", "resistance"],
});

/** Amulet-only prefix, isolates the class-restriction gate. */
export const AMULET_ONLY: Mod = mkMod({
    id: "AmuletOnly1",
    type: "AllAttributes",
    gen: "prefix",
    minLevel: 1,
    spawn: [spawn(TAG_DEFAULT, known(300))],
    classRestriction: new Set([CLASS_AMULET]),
});

/**
 * Disabled-on-rings suffix, spawn is ORDERED so that on a ring base the first
 * matching tag (`ring`) yields weight 0 (disabled), while on other bases the
 * `default` entry (weight 100) applies. Isolates spawn first-match + zero-disable.
 */
export const RING_DISABLED: Mod = mkMod({
    id: "RingDisabled1",
    type: "SpecialSuffix",
    gen: "suffix",
    minLevel: 1,
    spawn: [spawn(TAG_RING, known(0)), spawn(TAG_DEFAULT, known(100))],
});

/** Flask-domain prefix whose weight WOULD match any base (default tag), so the
 * domain gate is the sole reason it is excluded from item-domain bases. */
export const FLASK_MOD: Mod = mkMod({
    id: "FlaskRecovery1",
    type: "FlaskRecovery",
    gen: "prefix",
    minLevel: 1,
    domain: DOMAIN_FLASK,
    spawn: [spawn(TAG_DEFAULT, known(100))],
});

/** Jewel-only spawn tag that no fixture base carries, isolates the "no matching
 * spawn tag" (null weight) path. */
export const JEWEL_ONLY_SPAWN: Mod = mkMod({
    id: "JewelOnly1",
    type: "JewelThing",
    gen: "suffix",
    minLevel: 1,
    spawn: [spawn(TAG_JEWEL, known(100))],
});

/** Unknown-weight suffix (PoE2 sentinel), eligible despite no numeric weight. */
export const UNKNOWN_WEIGHT_MOD: Mod = mkMod({
    id: "UnknownWeight1",
    type: "UnknownThing",
    gen: "suffix",
    minLevel: 1,
    spawn: [spawn(TAG_DEFAULT, unknown)],
});

/**
 * A "prefixes cannot be changed" carrier (typing rules §9.6): a SUFFIX-slot mod
 * that carries a Protect(prefix) effect. Placed directly onto items in tests
 * (not rolled), so its spawn weight is zero to keep it out of `pool`.
 */
export const PROTECT_PREFIXES_CARRIER: Mod = mkMod({
    id: "MetaPrefixesCannotChange",
    type: "MetaPrefixesCannotChange",
    gen: "suffix",
    minLevel: 1,
    spawn: [spawn(TAG_DEFAULT, known(0))],
    effects: [{ kind: "protect", target: { by: "gen", gen: "prefix" } }],
    text: "prefixes cannot be changed",
});

/** "Suffixes cannot be changed": a PREFIX-slot Protect(suffix) carrier. */
export const PROTECT_SUFFIXES_CARRIER: Mod = mkMod({
    id: "MetaSuffixesCannotChange",
    type: "MetaSuffixesCannotChange",
    gen: "prefix",
    minLevel: 1,
    spawn: [spawn(TAG_DEFAULT, known(0))],
    effects: [{ kind: "protect", target: { by: "gen", gen: "suffix" } }],
    text: "suffixes cannot be changed",
});

/** "Cannot roll attack modifiers": a SUFFIX pool-restrict carrier keyed on the
 *  `attack` category tag. */
export const CANNOT_ROLL_ATTACK_CARRIER: Mod = mkMod({
    id: "MetaCannotRollAttack",
    type: "MetaCannotRollAttack",
    gen: "suffix",
    minLevel: 1,
    spawn: [spawn(TAG_DEFAULT, known(0))],
    effects: [{ kind: "poolRestrict", allows: (m) => !m.implicitTags.has(TagId("attack")) }],
    text: "cannot roll attack modifiers",
});

/** "Can have up to 3 crafted modifiers" (multimod): a SUFFIX craftedCap carrier. */
export const MULTIMOD_CARRIER: Mod = mkMod({
    id: "MetaMultimod",
    type: "MetaMultimod",
    gen: "suffix",
    minLevel: 1,
    spawn: [spawn(TAG_DEFAULT, known(0))],
    effects: [{ kind: "craftedCap", cap: 3 }],
    text: "can have up to 3 crafted modifiers",
});

/** An attack-tagged prefix, for testing that "cannot roll attack" excludes it. */
export const ATTACK_PREFIX: Mod = mkMod({
    id: "AddedAttack1",
    type: "AddedAttackDamage",
    gen: "prefix",
    minLevel: 1,
    families: ["AddedPhysical"],
    spawn: [spawn(TAG_DEFAULT, known(500))],
    implicitTags: ["attack", "physical"],
    text: "adds physical attack damage",
});

// --- veiled crafting fixtures ---------------------------------------------
// Two placeholders (added by veiled orbs) and four unveiled result mods
// rollable on a ring, one sharing the Life family so a benched life mod blocks it.

export const VEILED_PREFIX_MOD: Mod = mkMod({
    id: "VeiledPrefix",
    type: "VeiledPrefix",
    gen: "prefix",
    minLevel: 1,
    spawn: [],
    source: "veiled",
});
export const VEILED_SUFFIX_MOD: Mod = mkMod({
    id: "VeiledSuffix",
    type: "VeiledSuffix",
    gen: "suffix",
    minLevel: 1,
    spawn: [],
    source: "veiled",
});
const DOMAIN_VEILED = Domain("veiled");
const mkVeiled = (
    id: string,
    gen: Gen,
    families: readonly string[],
    text: string,
    tag: TagId = TAG_DEFAULT,
): Mod =>
    mkMod({
        id,
        type: id,
        gen,
        minLevel: 1,
        domain: DOMAIN_VEILED, // the veiled domain keeps these out of the normal pool
        families,
        spawn: [spawn(tag, known(100))],
        source: "veiled",
        text,
    });
// A, B, C roll everywhere (default tag) → a ring's pool is exactly these three.
export const VEILED_A: Mod = mkVeiled(
    "VeiledDoubleDamage",
    "suffix",
    ["VDoubleDamage"],
    "veiled double damage",
);
export const VEILED_B: Mod = mkVeiled(
    "VeiledCastSpeed",
    "suffix",
    ["VCastSpeed"],
    "veiled cast speed",
);
export const VEILED_C: Mod = mkVeiled(
    "VeiledArmourAndLife",
    "prefix",
    ["VArmourLife"],
    "veiled armour and life",
);
// D is amulet-only and shares the Life family, so an amulet's pool is four and a
// benched life mod blocks D back out.
export const VEILED_D: Mod = mkVeiled(
    "VeiledLifeHybrid",
    "prefix",
    ["Life"],
    "veiled life hybrid",
    TAG_AMULET,
);

/** All veiled fixtures (placeholders + results), to append to a test catalog. */
export const VEILED_CATALOG: readonly Mod[] = [
    VEILED_PREFIX_MOD,
    VEILED_SUFFIX_MOD,
    VEILED_A,
    VEILED_B,
    VEILED_C,
    VEILED_D,
];

/** Approx-zero-weight suffix, ineligible (provably zero, PoE2 estimate). */
export const APPROX_ZERO_MOD: Mod = mkMod({
    id: "ApproxZero1",
    type: "ApproxZeroThing",
    gen: "suffix",
    minLevel: 1,
    spawn: [spawn(TAG_DEFAULT, approx(0))],
});

// --- Tiered fixtures (with text, for fuzzy + tier tests) ------------------
// Three tiers of one "maximum life" ModType and one fire-resist type, all
// rollable on a ring. Kept in a SEPARATE catalog so the exact-count pool tests
// over CATALOG are undisturbed.

export const MAXLIFE_T3: Mod = mkMod({
    id: "MaxLifeLow",
    type: "MaxLife",
    gen: "prefix",
    minLevel: 1,
    families: ["MaxLife"],
    spawn: [spawn(TAG_DEFAULT, known(1000))],
    text: "+(10-24) to maximum Life",
    name: "Healthy",
});
export const MAXLIFE_T2: Mod = mkMod({
    id: "MaxLifeMid",
    type: "MaxLife",
    gen: "prefix",
    minLevel: 30,
    families: ["MaxLife"],
    spawn: [spawn(TAG_DEFAULT, known(1000))],
    text: "+(70-84) to maximum Life",
    name: "Robust",
});
export const MAXLIFE_T1: Mod = mkMod({
    id: "MaxLifeHigh",
    type: "MaxLife",
    gen: "prefix",
    minLevel: 60,
    families: ["MaxLife"],
    spawn: [spawn(TAG_DEFAULT, known(1000))],
    text: "+(115-129) to maximum Life",
    name: "Virile",
});
export const FIRE_RES_TIERED: Mod = mkMod({
    id: "FireResTiered1",
    type: "FireResistTiered",
    gen: "suffix",
    minLevel: 1,
    families: ["ResistFireT"],
    spawn: [spawn(TAG_DEFAULT, known(500))],
    text: "+(6-11)% to Fire Resistance",
    name: "of the Salamander",
});

/** Catalog for fuzzy/tier tests: a 3-tier life type + a fire resist, on rings. */
export const TIERED_CATALOG: readonly Mod[] = [MAXLIFE_T1, MAXLIFE_T2, MAXLIFE_T3, FIRE_RES_TIERED];

/** The full mini catalog. */
export const CATALOG: readonly Mod[] = [
    LIFE_T1,
    LIFE_T2,
    INCREASED_MANA,
    INCREASED_ARMOUR,
    FIRE_RESIST,
    FIRE_CHAOS_RESIST,
    COLD_RESIST,
    LIGHTNING_RESIST,
    AMULET_ONLY,
    RING_DISABLED,
    FLASK_MOD,
    JEWEL_ONLY_SPAWN,
    UNKNOWN_WEIGHT_MOD,
    APPROX_ZERO_MOD,
];

// --- Item builder ---------------------------------------------------------

interface ItemSpec {
    readonly base?: Base; // defaults to RING_BASE
    readonly game?: Game; // defaults to poe1
    readonly ilvl?: number; // defaults to 100 (ungated)
    readonly rarity: Rarity;
    readonly prefixes?: readonly Mod[];
    readonly suffixes?: readonly Mod[];
}

export function mkItem(spec: ItemSpec): Item {
    return {
        game: spec.game ?? "poe1",
        base: spec.base ?? RING_BASE,
        ilvl: spec.ilvl ?? 100,
        rarity: spec.rarity,
        prefixes: spec.prefixes ?? [],
        suffixes: spec.suffixes ?? [],
    };
}

/** Convenience: candidate mod ids from a pool result, as a Set for easy assertions. */
export function idsOf(candidates: readonly { readonly mod: Mod }[]): Set<string> {
    return new Set(candidates.map((c) => c.mod.id));
}
