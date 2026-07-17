/**
 * Name resolution (brief §3 `/core/resolve`, surface doc §2).
 *
 * The parser leaves every name as a raw string (`"exalt"`, `"T1 Life"`,
 * `"Cobalt Jewel"`). Resolution turns those into internal entities — a
 * `CurrencySpec`, a `Mod`, a `Base` — against a `Registry` of known data.
 *
 * Resolution failures are a DISTINCT error class from type errors (surface §2):
 * they happen during elaboration of text → entities, before the checker runs.
 *
 * Resolution tiers (surface §2): (1) exact id, (2) curated alias, (3) fuzzy
 * text match. Mods additionally support fuzzy resolution to a ModTYPE via
 * `resolveModType` (see `fuzzy.ts`), since a human writes a stat description
 * ("maximum life"), not a tier id ("IncreasedLife5").
 */
import type { Base } from "../model/base.js";
import type { Game, Gen, TypeId } from "../model/ids.js";
import type { Mod } from "../model/mod.js";
import { buildTypeIndex, matchTypes, normalizeText } from "./fuzzy.js";
import { rollableTiers } from "./tiers.js";

/** A stat-description completion suggestion. */
export interface StatSuggestion {
    /** The clean, normalized form a user types (e.g. "maximum life"). */
    readonly label: string;
    /** A representative full stat text (e.g. "+(10-24) to maximum Life"). */
    readonly detail: string;
    /** The ModType this suggestion resolves to — lets completion filter by rollability. */
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
 * A currency in the catalog. `name`/`kind` drive the language (the DSL alias and
 * which hand-written transfer function governs it); `displayName`/`description`
 * are pure DISPLAY metadata for the editor (hover + completion), NOT used by the
 * checker. This is the split the catalog exists for: we curate the real in-game
 * name and description (RePoE ships neither for currencies), while the semantics
 * stay hand-modelled and are linked only by `kind`.
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
 * A PoE2 omen that directs an operation (typing rules §10.2). Dextral = right =
 * suffix; Sinistral = left = prefix. Each omen forces a specific operation to a
 * specific generation.
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
    | { readonly kind: "ambiguous"; readonly name: string; readonly candidates: readonly string[] };

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
     * Fuzzy-resolve a stat description (or an exact mod id) to its ModType.
     * When `ctx` (the item's base + ilvl) is given, candidates are narrowed to
     * types that can actually roll there — which resolves the common case where
     * several distinct ModTypes share identical wording but only one is
     * rollable on the item at hand.
     */
    resolveModType(name: string, ctx?: ModTypeContext): Resolved<TypeId>;
    resolveCurrency(name: string): Resolved<CurrencySpec>;
    resolveOmen(name: string): Resolved<OmenSpec>;
    /** The generation (prefix/suffix) a ModType always occupies, if known. */
    genOfType(type: TypeId): Gen | undefined;
    /**
     * A human-readable label for a ModType — the canonical stat wording
     * (range-stripped, e.g. "maximum life"), for display in hover/diagnostics.
     * Falls back to the raw TypeId when the type carries no rollable text.
     */
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
}

/**
 * The default currency catalog (the base ops, shared across games). `displayName`
 * and `description` are the curated in-game text — RePoE does not export currency
 * descriptions, so these are authored here. Adding a new currency means adding a
 * transfer function for its `kind` AND an entry here.
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

/** The default omen table (the four Dextral/Sinistral directors we model in M5). */
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
}

/**
 * Build a registry from loaded data. Lookups are case-insensitive on the whole
 * name; ids and aliases are both accepted (surface §2 tiers 1 and 2).
 */
export function buildRegistry(data: RegistryData): Registry {
    const norm = (s: string): string => s.trim().toLowerCase();

    const baseById = new Map(data.bases.map((b) => [norm(b.id), b] as const));
    const baseAlias = new Map(
        Object.entries(data.baseAliases ?? {}).map(
            ([alias, id]) => [norm(alias), norm(id)] as const,
        ),
    );
    // Display names are NOT unique (hundreds of bases share one — maps, gems, …),
    // so a name maps to a LIST; a lookup that hits more than one is ambiguous.
    const baseByName = new Map<string, Base[]>();
    for (const b of data.bases) {
        if (b.name === undefined) continue;
        const nk = norm(b.name);
        const bucket = baseByName.get(nk);
        if (bucket) bucket.push(b);
        else baseByName.set(nk, [b]);
    }

    const modById = new Map(data.mods.map((m) => [norm(m.id), m] as const));
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

    const typeGen = new Map<TypeId, Gen>();
    for (const m of data.mods) if (!typeGen.has(m.type)) typeGen.set(m.type, m.gen);

    const typeIndex = buildTypeIndex(data.mods);

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
        catalog: data.mods,
        currencyNames,
        currencies,
        baseNames,
        statSuggestions,

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
                    (m) =>
                        rollableTiers(data.mods, ctx.game, ctx.base, ctx.ilvl, m.type).length > 0,
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

        genOfType(type) {
            return typeGen.get(type);
        },

        typeLabel(type) {
            const entry = typeIndex.get(type);
            return entry ? normalizeText(entry.text).join(" ") : type;
        },
    };
}
