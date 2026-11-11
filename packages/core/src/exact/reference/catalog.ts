/**
 * Seeded tiny catalogues: a handful of real `Mod` rows on one base, built into
 * a real `Registry`, small enough that every item over them can be listed.
 * Every random choice comes from the seed, so a failing property test names
 * the catalogue it failed on.
 */
import {
    AMULET_BASE,
    BOOTS_BASE,
    DOMAIN_ITEM,
    FLASK_BASE,
    JEWEL_BASE,
    RATCHETING_BASE,
    RING_BASE,
    SIMPLEX_BASE,
    TAG_DEFAULT,
} from "../../__fixtures__/mods.js";
import type { Base } from "../../model/base.js";
import { type ClassId, Domain, type Gen, GroupId, ModId, TagId, TypeId } from "../../model/ids.js";
import {
    canHaveEldritch,
    ELDRITCH_ITEM_LEVEL,
    type EldritchSide,
    INFLUENCE_STEMS,
} from "../../model/marks.js";
import type { Mod, SpawnEntry } from "../../model/mod.js";
import type {
    BenchCraft,
    EldritchImplicitSpec,
    EssenceSpec,
    ModSource,
} from "../../model/sources.js";
import { VEILED_PREFIX, VEILED_SUFFIX } from "../../model/veiled.js";
import { buildRegistry, type Registry } from "../../resolve/registry.js";
import { refCtx, type RefCtx } from "./item.js";

import { type Rng, rng } from "./rng.js";

export { rng, type Rng };

// --- rows ---------------------------------------------------------------------

export interface RowSpec {
    readonly id: string;
    readonly type: string;
    readonly gen: Gen;
    readonly minLevel?: number;
    readonly families?: readonly string[];
    readonly text?: string;
    readonly spawn?: readonly SpawnEntry[];
    readonly domain?: Domain;
    readonly source?: ModSource;
    readonly implicitTags?: readonly string[];
    readonly addsTags?: readonly string[];
}

/** A `Mod` row: by default a natural item-domain row that rolls on every base. */
export function modRow(spec: RowSpec): Mod {
    return {
        id: ModId(spec.id),
        type: TypeId(spec.type),
        families: new Set((spec.families ?? [spec.type]).map(GroupId)),
        gen: spec.gen,
        domain: spec.domain ?? DOMAIN_ITEM,
        minLevel: spec.minLevel ?? 1,
        addsTags: new Set((spec.addsTags ?? []).map(TagId)),
        implicitTags: new Set((spec.implicitTags ?? []).map(TagId)),
        spawn: spec.spawn ?? [{ tag: TAG_DEFAULT, weight: 1000 }],
        generation: [],
        ...(spec.source !== undefined && { source: spec.source }),
        ...(spec.text !== undefined && { text: spec.text }),
    };
}

const CRAFTED = Domain("crafted");
const VEILED = Domain("veiled");
const UNVEILED = Domain("unveiled");

/** A bench row of an existing type, as the game's bench rows mostly are. */
export function benchRow(id: string, of: Mod, text: string): Mod {
    return modRow({
        id,
        type: of.type,
        gen: of.gen,
        families: [...of.families],
        text,
        spawn: [],
        domain: CRAFTED,
        source: "bench",
    });
}

/** The two veiled placeholders, each in a group of its own as in the data. */
export const VEILED_PLACEHOLDERS: readonly Mod[] = [
    modRow({
        id: "VeiledPrefix",
        type: VEILED_PREFIX,
        gen: "prefix",
        spawn: [],
        domain: VEILED,
        source: "veiled",
    }),
    modRow({
        id: "VeiledSuffix",
        type: VEILED_SUFFIX,
        gen: "suffix",
        spawn: [],
        domain: VEILED,
        source: "veiled",
    }),
];

export type MetamodKind =
    | "multimod"
    | "prefixesCannotChange"
    | "suffixesCannotChange"
    | "cannotRollAttack"
    | "cannotRollCaster";

/** The five metamods by the data's ids, types and sides; the registry attaches
 *  their effects by id (model/metamods.ts). */
const METAMOD_ROWS: Readonly<Record<MetamodKind, Mod>> = {
    multimod: metamodRow(
        "StrIntMasterItemGenerationCanHaveMultipleCraftedMods",
        "ItemGenerationCanHaveMultipleCraftedMods",
        "suffix",
        "Can have up to 3 Crafted Modifiers",
    ),
    prefixesCannotChange: metamodRow(
        "StrMasterItemGenerationCannotChangePrefixes",
        "ItemGenerationCannotChangePrefixes",
        "suffix",
        "Prefixes Cannot Be Changed",
    ),
    suffixesCannotChange: metamodRow(
        "DexMasterItemGenerationCannotChangeSuffixes",
        "ItemGenerationCannotChangeSuffixes",
        "prefix",
        "Suffixes Cannot Be Changed",
    ),
    cannotRollAttack: metamodRow(
        "IntMasterItemGenerationCannotRollAttackAffixes",
        "ItemGenerationCannotRollAttackAffixes",
        "suffix",
        "Cannot roll Attack Modifiers",
    ),
    cannotRollCaster: metamodRow(
        "StrDexMasterItemGenerationCannotRollCasterAffixes",
        "ItemGenerationCannotRollCasterAffixes",
        "suffix",
        "Cannot roll Caster Modifiers",
    ),
};

function metamodRow(id: string, type: string, gen: Gen, text: string): Mod {
    return modRow({ id, type, gen, text, spawn: [], domain: CRAFTED, source: "bench" });
}

export function metamod(kind: MetamodKind): Mod {
    return METAMOD_ROWS[kind];
}

/** A bench craft of `mod` for one item class. */
export function benchCraft(mod: Mod, itemClass: ClassId): BenchCraft {
    return { mod: mod.id, tier: 1, itemClasses: new Set([itemClass]) };
}

// --- the catalogue ------------------------------------------------------------

/** The kinds of base: an ordinary ring, amulet, boots and jewel (a Rare holding
 *  four), a flask (Magic at most), and the experimented ring and amulet whose
 *  caps a delta shifts (model/capacity.ts). */
export type BaseKind = "ring" | "amulet" | "boots" | "jewel" | "flask" | "ratcheting" | "simplex";

const BASES: Readonly<Record<BaseKind, Base>> = {
    ring: RING_BASE,
    amulet: AMULET_BASE,
    boots: BOOTS_BASE,
    jewel: JEWEL_BASE,
    flask: FLASK_BASE,
    ratcheting: RATCHETING_BASE,
    simplex: SIMPLEX_BASE,
};

/** The class tag an eldritch implicit row names for each base that takes one. */
const ELDRITCH_CLASS_TAG: Readonly<Partial<Record<BaseKind, string>>> = {
    amulet: "amulet",
    boots: "boots",
    simplex: "amulet",
};

export interface CatalogOptions {
    readonly base?: BaseKind;
    readonly ilvl?: number;
    /** How many natural modifier types, 4 to 8 by default. */
    readonly types?: number;
    /** Rows whose text has no number: at least one unless false. */
    readonly unnumbered?: boolean;
    /** Two types that share a group. */
    readonly sharedFamily?: boolean;
    /** One natural row that the base's own tag gives no weight. */
    readonly zeroWeight?: boolean;
    /** A bench row of a natural type, with its bench craft. */
    readonly bench?: boolean;
    /** A row only an essence places, with the essence: of a type of its own,
     *  or with `"ladder"` a row above the top of a natural type's ladder. */
    readonly essenceOnly?: boolean | "ladder";
    /** A Hunter row: it rolls only on a Hunter item of the base's class. */
    readonly influence?: boolean;
    /** The two veiled placeholders and an unveiled row of each side. */
    readonly veiled?: boolean;
    /** Metamod rows, each with its bench craft. */
    readonly metamods?: readonly MetamodKind[];
    /** Eldritch implicit rows of both sides at every tier (amulet or boots). */
    readonly eldritch?: boolean;
}

export interface Catalog {
    readonly seed: number;
    readonly registry: Registry;
    readonly base: Base;
    readonly ilvl: number;
    readonly ctx: RefCtx;
    /** Every row, as the registry holds them (metamods with their effects). */
    readonly mods: readonly Mod[];
    readonly natural: readonly Mod[];
    readonly bench: Mod | undefined;
    readonly essence: Mod | undefined;
    readonly influence: Mod | undefined;
    readonly veiled: readonly Mod[];
    readonly metamods: readonly Mod[];
    readonly eldritch: readonly EldritchImplicitSpec[];
}

const STATS = ["Alpha", "Bravo", "Charlie", "Delta", "Echo", "Foxtrot", "Golf", "Hotel"];
const LEVELS = [1, 20, 45, 68, 82, 86];

/** The text of a row: a span of one to three whole values, or no number. */
function rowText(r: Rng, stat: string, tier: number, numbered: boolean): string {
    if (!numbered) return `Grants ${stat}`;
    const lo = 1 + 5 * tier + r.int(0, 3);
    const hi = lo + r.int(0, 2);
    return lo === hi ? `+${lo} to ${stat}` : `+(${lo}-${hi}) to ${stat}`;
}

/** A natural type before its rows are built: its ladder's levels, lowest
 *  first, and which of its rows have a number. */
interface TypeSpec {
    readonly stat: string;
    readonly gen: Gen;
    readonly families: string[];
    readonly tags: readonly string[];
    readonly levels: number[];
    readonly numbered: boolean[];
}

export function generateCatalog(seed: number, options: CatalogOptions = {}): Catalog {
    const r = rng(seed);
    const kind = options.base ?? "ring";
    const base = BASES[kind];
    const ilvl = options.ilvl ?? (options.eldritch ? r.pick([75, 84]) : r.pick([40, 75, 84]));
    const n = options.types ?? r.int(4, 8);
    if (n < 2 || n > STATS.length) throw new Error(`2 to ${STATS.length} types, not ${n}`);
    const numbered = (): boolean => options.unnumbered === false || !r.chance(0.15);

    const specs: TypeSpec[] = [];
    for (let i = 0; i < n; i++) {
        const stat = STATS[i]!;
        const families = [`Fam${stat}`];
        if (options.sharedFamily !== false && i >= 1 && r.chance(0.3)) {
            families.push(`Fam${STATS[r.int(0, i - 1)]!}`);
        }
        const levels = r.sample(LEVELS, r.int(1, 3));
        specs.push({
            stat,
            gen: i === 0 ? "prefix" : i === 1 ? "suffix" : r.pick(["prefix", "suffix"]),
            families,
            tags: [...(r.chance(0.3) ? ["attack"] : []), ...(r.chance(0.3) ? ["caster"] : [])],
            levels,
            numbered: levels.map(numbered),
        });
    }
    // Some row the item's level rolls, and some it stops short of; the second
    // fix only raises or adds a row at the top of a ladder, so keeps the first.
    if (!specs.some((t) => t.levels[0]! <= ilvl)) r.pick(specs).levels[0] = 1;
    if (!specs.some((t) => t.levels.some((l) => l > ilvl))) {
        const t = r.pick(specs);
        if (t.levels.length < 3) {
            t.levels.push(ilvl + 1);
            t.numbered.push(numbered());
        } else t.levels[2] = ilvl + 1;
    }
    if (options.unnumbered !== false && specs.every((t) => t.numbered.every(Boolean))) {
        const t = r.pick(specs);
        t.numbered[r.int(0, t.numbered.length - 1)] = false;
    }
    // Groups are a type's whole ladder's, so a shared group joins every row.
    if (options.sharedFamily !== false) {
        const owners = new Map<string, number>();
        for (const t of specs) for (const f of t.families) owners.set(f, (owners.get(f) ?? 0) + 1);
        if (![...owners.values()].some((k) => k > 1))
            specs[n - 1]!.families.push(`Fam${STATS[0]!}`);
    }
    const rowsOfSpecs = specs.flatMap((t) => t.levels.map((_, k) => [t, k] as const));
    const zero = options.zeroWeight ? r.pick(rowsOfSpecs) : undefined;
    const ownTag = [...base.tags].find((t) => t !== TAG_DEFAULT) ?? TAG_DEFAULT;

    const natural: Mod[] = [];
    for (const [t, k] of rowsOfSpecs) {
        const weight = 100 * r.int(1, 10);
        const zeroed = zero !== undefined && zero[0] === t && zero[1] === k;
        natural.push(
            modRow({
                id: `${t.stat}${k + 1}`,
                type: `Type${t.stat}`,
                gen: t.gen,
                minLevel: t.levels[k]!,
                families: t.families,
                implicitTags: t.tags,
                text: rowText(r, t.stat, k, t.numbered[k]!),
                domain: base.domain,
                // The first entry the base matches decides (item-model.md §5).
                spawn: zeroed
                    ? [
                          { tag: ownTag, weight: 0 },
                          { tag: TAG_DEFAULT, weight },
                      ]
                    : [{ tag: TAG_DEFAULT, weight }],
            }),
        );
    }

    const extra: Mod[] = [];
    const benchCrafts: BenchCraft[] = [];
    const essences: EssenceSpec[] = [];
    let bench: Mod | undefined;
    if (options.bench) {
        const of = r.pick(natural);
        bench = benchRow(`Bench${of.type}`, of, rowText(r, of.type.slice(4), 0, true));
        extra.push(bench);
        benchCrafts.push(benchCraft(bench, base.itemClass));
    }
    let essence: Mod | undefined;
    if (options.essenceOnly) {
        const of = options.essenceOnly === "ladder" ? r.pick(specs) : undefined;
        const stat = of?.stat ?? "Essence";
        essence = modRow({
            id: `EssenceOnly${stat}`,
            type: `Type${stat}`,
            gen: of?.gen ?? r.pick(["prefix", "suffix"]),
            ...(of !== undefined && {
                families: of.families,
                implicitTags: of.tags,
                minLevel: Math.max(...of.levels) + 1,
            }),
            text: rowText(r, stat, of?.levels.length ?? 2, true),
            spawn: [{ tag: TAG_DEFAULT, weight: 0 }],
            domain: base.domain,
            source: "essence",
        });
        extra.push(essence);
        essences.push({
            id: "TestEssence",
            name: "Deafening Essence of Testing",
            tier: 7,
            grants: new Map([[base.itemClass, essence.id]]),
        });
    }
    let influence: Mod | undefined;
    if (options.influence) {
        const stem = INFLUENCE_STEMS[base.itemClass];
        if (stem === undefined) throw new Error(`no influence marks a ${base.itemClass}`);
        influence = modRow({
            id: "Hunter1",
            type: "TypeHunter",
            gen: r.pick(["prefix", "suffix"]),
            text: rowText(r, "Hunting", 1, true),
            domain: base.domain,
            spawn: [
                { tag: TagId(`${stem}_basilisk`), weight: 500 },
                { tag: TAG_DEFAULT, weight: 0 },
            ],
            implicitTags: ["influence_only"],
        });
        extra.push(influence);
    }
    const veiled: Mod[] = [];
    if (options.veiled) {
        veiled.push(...VEILED_PLACEHOLDERS);
        for (const gen of ["prefix", "suffix"] as const) {
            const side = gen === "prefix" ? "Prefix" : "Suffix";
            veiled.push(
                modRow({
                    id: `Unveiled${side}1`,
                    type: `TypeUnveiled${side}`,
                    gen,
                    text: rowText(r, `Unveiled${side}`, 1, true),
                    domain: UNVEILED,
                    source: "veiled",
                    spawn: [{ tag: TAG_DEFAULT, weight: 100 }],
                }),
            );
        }
        extra.push(...veiled);
    }
    for (const k of options.metamods ?? []) {
        extra.push(metamod(k));
        benchCrafts.push(benchCraft(metamod(k), base.itemClass));
    }
    const eldritch: EldritchImplicitSpec[] = [];
    if (options.eldritch) {
        const tag = ELDRITCH_CLASS_TAG[kind];
        if (tag === undefined || !canHaveEldritch(base) || ilvl < ELDRITCH_ITEM_LEVEL) {
            throw new Error(`a ${kind} of item level ${ilvl} takes no eldritch implicit`);
        }
        for (const side of ["exarch", "eater"] as const) {
            const names = side === "exarch" ? ["Blaze", "Ember"] : ["Gloom", "Ichor"];
            eldritch.push(...eldritchLadders(side, names.slice(0, r.int(1, 2)), tag));
        }
    }

    const registry = buildRegistry({
        bases: [base],
        mods: [...natural, ...extra],
        benchCrafts,
        essences,
        eldritch,
    });
    const byId = new Map(registry.catalog.map((m) => [m.id, m]));
    const held = (m: Mod): Mod => byId.get(m.id)!;
    return {
        seed,
        registry,
        base,
        ilvl,
        ctx: refCtx(registry, base, ilvl),
        mods: registry.catalog,
        natural: natural.map(held),
        bench: bench && held(bench),
        essence: essence && held(essence),
        influence: influence && held(influence),
        veiled: veiled.map(held),
        metamods: (options.metamods ?? []).map((k) => held(metamod(k))),
        eldritch,
    };
}

/** One implicit per name, `Implicit<name>`, with a row at each of the six tiers
 *  on the bases carrying `classTag`. */
export function eldritchLadders(
    side: EldritchSide,
    names: readonly string[],
    classTag: string,
): EldritchImplicitSpec[] {
    return names.flatMap((name) =>
        [1, 2, 3, 4, 5, 6].map((tier) => ({
            id: ModId(`${name}${tier}`),
            side,
            tier,
            type: TypeId(`Implicit${name}`),
            classes: new Set([TagId(classTag)]),
            weights: new Map([[TagId(classTag), 100]]),
            implicitTags: new Set<TagId>(),
            text: `${tier}% increased ${name}`,
        })),
    );
}
