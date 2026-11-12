/**
 * The item block read and checked (language.md §1): the base, its level and
 * rarity, each declared affix resolved to the rows it may be, the marks; every
 * fault reported in the game's words. What it declares is construction-free:
 * the checker builds its first set of items from it (check/initial.ts).
 */
import type { AffixDecl, EldritchDecl, ItemBlock, ItemField } from "../ast/ast.js";
import type { SourceSpan } from "../ast/span.js";
import type { Base } from "../model/base.js";
import { canBeRare, maxTotal, sideCap } from "../model/capacity.js";
import {
    type Gen,
    type GroupId,
    type ModId,
    type Rarity,
    TagId,
    type TypeId,
} from "../model/ids.js";
import {
    AMULET_ELDRITCH_TOP_TIER,
    canHaveEldritch,
    ELDRITCH_ITEM_LEVEL,
    type EldritchSide,
    eldritchTierLabel,
    eldritchTierOf,
    type Influence,
    INFLUENCE_STEMS,
    INFLUENCES,
    isEldritchAmulet,
} from "../model/marks.js";
import type { Mod } from "../model/mod.js";
import { MAX_STRANDS } from "../model/strands.js";
import { resolveMessage, withArticle } from "../resolve/messages.js";
import type { ClusterSize, Registry } from "../resolve/registry.js";
import {
    rollableGen,
    tierCount,
    type TierLadders,
    tierLadders,
    tierRows,
} from "../resolve/tiers.js";
import { plural } from "../words.js";
import type { Diag } from "./defs.js";

/** Item-block affix names that mean "some unspecified affix". */
export const PLACEHOLDERS = /^random\b|^\?$/;

/** How many passive skills a cluster jewel of each size adds (Cluster jewel). */
const CLUSTER_PASSIVES: Readonly<Record<ClusterSize, readonly [number, number]>> = {
    small: [2, 3],
    medium: [4, 6],
    large: [8, 12],
};

/** The size of a cluster jewel base, from the tag that marks it; undefined for any other base. */
function clusterSize(base: Base): ClusterSize | undefined {
    for (const size of ["small", "medium", "large"] as const) {
        if (base.tags.has(TagId(`expansion_jewel_${size}`))) return size;
    }
    return undefined;
}

/**
 * One declared affix, in the order the block lists it.
 * - `named`: a modifier the block names; `rows` are those it may be (one, or
 *   one under each of two influences that share the tier), or undefined where
 *   the block gives no tier the item can hold (reported), any row of `type`.
 * - `anonymous`: `"random"`, some natural modifier of its side.
 * - `bench`: `bench "random"`, some bench modifier of its side.
 * - `unknown`: a name that did not resolve (reported); it is counted.
 */
export interface DeclaredAffix {
    /** The side the block lists it under. */
    readonly gen: Gen;
    readonly kind: "named" | "anonymous" | "bench" | "unknown";
    readonly type?: TypeId;
    readonly rows?: readonly Mod[];
    readonly fractured: boolean;
    /** A crafted modifier: a bench row, named or not. */
    readonly crafted: boolean;
}

/** A declared eldritch implicit: its tier, and the implicits its wording names. */
export interface DeclaredImplicit {
    readonly tier: number;
    readonly types?: ReadonlySet<TypeId>;
}

/** What the item block declares, its faults reported. */
export interface ItemDecl {
    /** The base, a cluster jewel's with its enchantment's tag. */
    readonly base: Base;
    readonly ilvl: number;
    readonly rarity: Rarity;
    readonly affixes: readonly DeclaredAffix[];
    /** Every influence on the Astrolabe Amulet. */
    readonly influences: readonly Influence[];
    readonly corrupted: boolean;
    readonly exarch?: DeclaredImplicit;
    readonly eater?: DeclaredImplicit;
    /** Within 0 to 100; absent for none. */
    readonly strands?: number;
    /** The affixes of each side as counted, held to the rarity's caps. */
    readonly prefixCount: number;
    readonly suffixCount: number;
    /** The types the block names. */
    readonly present: ReadonlySet<TypeId>;
    /** The one row a named type is at, where the block says which. */
    readonly pinned: ReadonlyMap<TypeId, ModId>;
    /** A named tier two rows share, one under each of two influences. */
    readonly oneOf: ReadonlyMap<TypeId, ReadonlySet<ModId>>;
    /** The declared fractured modifiers' types. */
    readonly fracturedTypes: readonly TypeId[];
    /** How many anonymous affixes are fractured. */
    readonly fracturedAnonymous: number;
    /** How many declared modifiers are crafted, and the types they may be. */
    readonly crafted: number;
    readonly craftedTypes: ReadonlySet<TypeId>;
    /** How many anonymous natural affixes each side has. */
    readonly anonymousBy: Readonly<Record<Gen, number>>;
}

/** The item block read, every fault reported through `diag`; null when the
 *  base does not resolve, without which no pool can be computed. */
export function declareItem(item: ItemBlock, registry: Registry, diag: Diag): ItemDecl | null {
    const at = (...fields: readonly ItemField[]): SourceSpan =>
        fields.map((f) => item.fields?.[f]).find((s) => s !== undefined) ?? item.span;
    // The declared modifier being read, which its errors point at.
    let affixAt = item.span;
    const baseRes = registry.resolveBase(item.base);
    if (!baseRes.ok) {
        diag(resolveMessage(baseRes.error), at("base"));
        return null;
    }
    let base = baseRes.value;
    // A cluster jewel's notables roll under its enchantment's tag (Cluster
    // jewel: the enchantment that determines what bonuses the passives
    // give decides which modifiers it can roll), so the enchant is read as
    // a tag of the base.
    const size = clusterSize(base);
    if (item.enchant !== undefined) {
        if (size === undefined) {
            diag("Only a cluster jewel has an enchant.", at("enchant"));
        } else {
            const [lo, hi] = CLUSTER_PASSIVES[size];
            if (item.enchant.passives < lo || item.enchant.passives > hi) {
                diag(
                    `A ${size} cluster jewel adds ${lo} to ${hi} passive skills, not ${item.enchant.passives}.`,
                    at("enchant"),
                );
            }
            const tag = registry.resolveClusterEnchant(item.enchant.text);
            if (!tag.ok) diag(resolveMessage(tag.error), at("enchant"));
            else {
                // An enchantment belongs to the jewels of one size, and so do
                // its notables: read off the game's list of each size's
                // small passives, not stated by the wiki (QUESTIONS.md Q98).
                const sizes = registry.clusterSizesOf(tag.value);
                if (sizes !== undefined && !sizes.has(size)) {
                    diag(
                        `A ${size} cluster jewel cannot have the "${item.enchant.text}" enchant — it is a ${[...sizes].join(" or ")} cluster jewel's.`,
                        at("enchant"),
                    );
                }
                base = registry.enchantedBase(base, tag.value);
            }
        }
    } else if (size !== undefined) {
        diag(
            'A cluster jewel\'s modifiers depend on its enchant: add `enchant: <passives> "<stat>"`.',
            at("base"),
        );
    }
    const present = new Set<TypeId>();
    // Named mods pin an exact tier so the starting item is fully concrete;
    // placeholders (`"random"`) stay anonymous.
    const pinned = new Map<TypeId, ModId>();
    // A named tier that two rows share, one under each of two influences.
    const oneOf = new Map<TypeId, Set<ModId>>();
    const fracturedTypes: TypeId[] = [];
    let fracturedAnonymous = 0;
    let crafted = 0;
    // An Astrolabe Amulet counts as having every influence (Influenced item §
    // Mechanics), so none is declared and all six are read.
    if (base.allInfluences && item.influences.length > 0) {
        diag(
            "This base has every influence by its implicit; leave `influences:` out.",
            at("influences"),
        );
    }
    const influences = base.allInfluences ? [...INFLUENCES] : item.influences;
    // The class must be one an influence can mark (a jewel or a flask is not).
    if (item.influences.length > 0 && INFLUENCE_STEMS[base.itemClass] === undefined) {
        diag(
            `${base.name ?? "This base"} is of a class that cannot be influenced — leave \`influences:\` out.`,
            at("influences"),
        );
    }
    // A declared influence's rows roll on the item, so they resolve and tier here.
    const tags = new Set(influences.flatMap((i) => [...registry.influenceTags(base, i)]));
    const ctx = { base, ilvl: item.ilvl, tags };

    const checkGen = (name: string, modGen: Gen | undefined, gen: Gen): void => {
        if (modGen !== undefined && modGen !== gen) {
            diag(`"${name}" is a ${modGen}, but it is listed under ${gen}es.`, affixAt);
        }
    };

    // Two declared modifiers cannot share an item when they are the same
    // modifier or claim the same group (Modifier § Group/family).
    const claimed = new Map<GroupId, string>();
    const declaredAs = new Map<TypeId, string>();
    const claim = (name: string, type: TypeId): void => {
        const earlier = declaredAs.get(type);
        if (earlier !== undefined) {
            diag(
                earlier === name
                    ? `"${name}" is declared twice; an item holds it once.`
                    : `"${name}" and "${earlier}" are tiers of one modifier; an item holds one of them.`,
                affixAt,
            );
            return;
        }
        declaredAs.set(type, name);
        for (const family of registry.familiesOfType(type)) {
            const other = claimed.get(family);
            if (other !== undefined) {
                diag(
                    `"${name}" and "${other}" cannot both be on an item; they are modifiers of the same group.`,
                    affixAt,
                );
                break;
            }
            claimed.set(family, name);
        }
        present.add(type);
    };

    /** The rows at a tier that a name means: where modifiers that share the
     *  type share the tier, the one the name words. */
    const rowsAt = (ladders: TierLadders, tier: number, name: string): readonly Mod[] =>
        tierRows(ladders, tier, (rows) => registry.rowsNamed(name, rows));

    // What the affix being read resolves to, for the exact checker.
    let entry: { type?: TypeId; rows?: readonly Mod[]; crafted: boolean } = { crafted: false };

    // A named mod pins a tier via an exact id/alias, or a stat description
    // plus `t<n>`; a bare description is accepted only where a single tier of
    // the modifier rolls. Returns the resolved type (for the fractured
    // marker), or undefined when resolution failed.
    const craftedTypes = new Set<TypeId>();
    const pinAffix = (affix: AffixDecl, gen: Gen): TypeId | undefined => {
        const byId = registry.resolveMod(affix.mod);
        if (byId.ok) {
            const mod = byId.value;
            checkGen(affix.mod, mod.gen, gen);
            // A naturally rolled row must fit the base's domain; a row
            // another mechanic placed (bench, essence, unveiled, fossil) is
            // exempt (item-model.md §3). Its level may be above the item's:
            // an essence or a Harvest change leaves such a row.
            if ((mod.source ?? "natural") === "natural" && mod.domain !== base.domain) {
                diag(
                    `"${affix.mod}" cannot roll on ${base.name === undefined ? "this item" : withArticle(base.name)}.`,
                    affixAt,
                );
            }
            claim(affix.mod, mod.type);
            pinned.set(mod.type, mod.id);
            entry = { type: mod.type, rows: [mod], crafted: mod.source === "bench" };
            if (mod.source === "bench") {
                crafted++;
                craftedTypes.add(mod.type);
            }
            return mod.type;
        }
        const typeRes = registry.resolveModType(affix.mod, ctx);
        if (!typeRes.ok) {
            diag(resolveMessage(typeRes.error), affixAt);
            return undefined;
        }
        const type = typeRes.value;
        entry = { type, crafted: false };
        checkGen(affix.mod, rollableGen(registry.catalog, base, item.ilvl, type, tags), gen);
        // The number is the game's, counted over the whole ladder. A tier
        // above the item's level is taken as declared: an essence places
        // its row whatever the level, and a Harvest change keeps the tier.
        const ladders = tierLadders(registry.catalog, base, type, tags);
        const count = tierCount(ladders);
        const rolls = (m: Mod): boolean => m.minLevel <= item.ilvl;
        const reachable: number[] = [];
        for (let n = 1; n <= count; n++) {
            if (tierRows(ladders, n).some(rolls)) reachable.push(n);
        }
        // Unnamed, it is the one tier the item's level rolls, or the
        // modifier's only tier.
        const single = reachable.length === 1 ? reachable[0] : count === 1 ? 1 : undefined;
        if (affix.tier === undefined && single === undefined && count > 0) {
            const why =
                reachable.length > 1
                    ? `${reachable.length} roll at this item level`
                    : `none of its ${count} rolls at this item level`;
            diag(
                `declare the tier of "${affix.mod}" (e.g. \`"${affix.mod}" t${reachable[0] ?? count}\`), a starting item's mods must name a specific tier and ${why}.`,
                affixAt,
            );
            claim(affix.mod, type); // still present, just untiered
            return type;
        }
        const tier = affix.tier ?? single ?? 1;
        const atTier = rowsAt(ladders, tier, affix.mod);
        if (atTier.length === 0) {
            const benched = count === 0 && registry.resolveBench(affix.mod, base.itemClass).ok;
            diag(
                count === 0
                    ? `"${affix.mod}" cannot roll on ${base.name === undefined ? "this item" : withArticle(base.name)}${benched ? ` — a bench craft is declared as \`bench "${affix.mod}"\`` : ""}.`
                    : `tier ${tier} is out of range for "${affix.mod}" (it has ${count} ${plural(count, "tier")} on this base).`,
                affixAt,
            );
            claim(affix.mod, type);
            return type;
        }
        // Two influences may each have a row at the tier, and which the
        // item holds is not said. A tier read off the item's level is a
        // row that level rolls.
        const rolled = affix.tier === undefined ? atTier.filter(rolls) : [];
        const rows = rolled.length > 0 ? rolled : atTier;
        claim(affix.mod, type);
        if (rows.length === 1) pinned.set(type, rows[0]!.id);
        else oneOf.set(type, new Set(rows.map((m) => m.id)));
        entry = { type, rows, crafted: false };
        return type;
    };

    // A bench affix is the bench's row for the item's class, named by the
    // modifier the bench adds; anonymous, it is one of the bench's rows of its
    // side, counted toward the crafted limit all the same.
    const pinCrafted = (affix: AffixDecl, gen: Gen): TypeId | undefined => {
        const res = registry.resolveBench(affix.mod, base.itemClass, affix.tier);
        if (!res.ok) {
            diag(resolveMessage(res.error), affixAt);
            return undefined;
        }
        const mod = registry.resolveMod(res.value.mod);
        if (!mod.ok) return undefined;
        checkGen(affix.mod, mod.value.gen, gen);
        craftedTypes.add(mod.value.type);
        claim(affix.mod, mod.value.type);
        pinned.set(mod.value.type, mod.value.id);
        crafted++;
        entry = { type: mod.value.type, rows: [mod.value], crafted: true };
        return mod.value.type;
    };

    const affixes: DeclaredAffix[] = [];
    const anonymousBy = { prefix: 0, suffix: 0 };
    const craftedAnonymousBy = { prefix: 0, suffix: 0 };
    const countAffixes = (list: readonly AffixDecl[], gen: Gen): number => {
        for (const affix of list) {
            affixAt = affix.span ?? at(gen === "prefix" ? "prefixes" : "suffixes");
            const anonymous = PLACEHOLDERS.test(affix.mod.trim().toLowerCase());
            if (anonymous && affix.bench) {
                craftedAnonymousBy[gen]++;
                crafted++;
            } else if (anonymous) anonymousBy[gen]++;
            entry = { crafted: false };
            const type = anonymous
                ? undefined
                : affix.bench
                  ? pinCrafted(affix, gen)
                  : pinAffix(affix, gen);
            const fractured = affix.fractured === true;
            affixes.push(
                anonymous
                    ? {
                          gen,
                          kind: affix.bench ? "bench" : "anonymous",
                          fractured,
                          crafted: !!affix.bench,
                      }
                    : entry.type === undefined
                      ? { gen, kind: "unknown", fractured: false, crafted: false }
                      : { gen, kind: "named", ...entry, fractured },
            );
            if (!affix.fractured) continue;
            if (type !== undefined) fracturedTypes.push(type);
            else if (anonymous) fracturedAnonymous++; // a lock on a mod no type is known to carry
        }
        return list.length;
    };

    let prefixCount = countAffixes(item.prefixes, "prefix");
    let suffixCount = countAffixes(item.suffixes, "suffix");

    if (item.rarity === "rare" && !canBeRare(base)) {
        diag(
            `a ${base.name ?? "flask"} cannot be Rare; its kind of item is Magic at most`,
            at("rarity"),
        );
    }

    const pCap = sideCap("prefix", item.rarity, base);
    const sCap = sideCap("suffix", item.rarity, base);
    if (prefixCount > pCap) {
        diag(
            `too many prefixes for a ${item.rarity} ${base.name ?? "item"}: ${prefixCount} (max ${pCap})`,
            at("prefixes"),
        );
        prefixCount = pCap;
    }
    if (suffixCount > sCap) {
        diag(
            `too many suffixes for a ${item.rarity} ${base.name ?? "item"}: ${suffixCount} (max ${sCap})`,
            at("suffixes"),
        );
        suffixCount = sCap;
    }
    // The two sides together are held to the rarity's total, which a
    // +delta side cap can exceed (a magic Ratcheting Ring holds two suffixes).
    const tCap = maxTotal(item.rarity, base);
    if (prefixCount + suffixCount > tCap) {
        diag(
            `too many modifiers for a ${item.rarity} ${base.name ?? "item"}: ${prefixCount + suffixCount} (max ${tCap})`,
            item.span,
        );
        suffixCount = Math.max(0, Math.min(suffixCount, tCap - prefixCount));
        prefixCount = Math.min(prefixCount, tCap - suffixCount);
    }

    // A declared implicit's wording names which implicit it is.
    const implicitTypes = (
        side: EldritchSide,
        decl: EldritchDecl | undefined,
    ): ReadonlySet<TypeId> | undefined => {
        if (decl?.text === undefined) return undefined;
        const types = registry.resolveEldritch(decl.text, side, base);
        if (!types.ok) {
            diag(resolveMessage(types.error), at(side));
            return undefined;
        }
        return new Set(types.value);
    };
    const exarchTypes = implicitTypes("exarch", item.exarch);
    const eaterTypes = implicitTypes("eater", item.eater);
    if (item.strands !== undefined && (item.strands < 0 || item.strands > MAX_STRANDS)) {
        diag(
            `An item holds 0 to ${MAX_STRANDS} memory strands, not ${item.strands}.`,
            at("strands"),
        );
    }

    // An influenced item cannot be fractured (Influenced item § Mechanics)
    // nor carry an eldritch implicit (Eldritch implicit modifier).
    if (influences.length > 0 && (item.exarch !== undefined || item.eater !== undefined)) {
        diag("An influenced item cannot have an eldritch implicit.", at("exarch", "eater"));
    }
    if ((item.exarch !== undefined || item.eater !== undefined) && !canHaveEldritch(base)) {
        diag(
            "Only a body armour, boots, gloves, a helmet or an amulet can have an eldritch implicit.",
            at("exarch", "eater"),
        );
    }
    if (isEldritchAmulet(base)) {
        if (item.exarch !== undefined && item.eater !== undefined) {
            diag(
                "An amulet has one eldritch implicit, the Searing Exarch's or the Eater of Worlds', not both.",
                at("eater"),
            );
        }
        for (const side of ["exarch", "eater"] as const) {
            const decl = item[side];
            if (decl !== undefined && eldritchTierOf(decl.tier) > AMULET_ELDRITCH_TOP_TIER) {
                diag(
                    `An amulet's eldritch implicit is Lesser to ${eldritchTierLabel(AMULET_ELDRITCH_TOP_TIER)}, not ${eldritchTierLabel(eldritchTierOf(decl.tier))}.`,
                    at(side),
                );
            }
        }
    }
    if (
        (item.exarch !== undefined || item.eater !== undefined) &&
        item.ilvl < ELDRITCH_ITEM_LEVEL
    ) {
        diag(
            `An eldritch implicit needs item level ${ELDRITCH_ITEM_LEVEL} or more — this item is item level ${item.ilvl}.`,
            at("exarch", "eater"),
        );
    }
    if (influences.length > 0 && fracturedTypes.length + fracturedAnonymous > 0) {
        diag("An influenced item cannot have a fractured modifier.", at("influences"));
    }
    // An anonymous bench affix is some bench row of its side.
    for (const gen of ["prefix", "suffix"] as const) {
        if (craftedAnonymousBy[gen] === 0) continue;
        for (const t of registry.benchTypesFor(base.itemClass)) {
            if (registry.genOfType(t) === gen) craftedTypes.add(t);
        }
    }
    const implicit = (
        decl: EldritchDecl | undefined,
        types: ReadonlySet<TypeId> | undefined,
    ): DeclaredImplicit | undefined =>
        decl === undefined
            ? undefined
            : { tier: eldritchTierOf(decl.tier), ...(types !== undefined && { types }) };
    const exarch = implicit(item.exarch, exarchTypes);
    const eater = implicit(item.eater, eaterTypes);
    return {
        base,
        ilvl: item.ilvl,
        rarity: item.rarity,
        affixes,
        influences,
        corrupted: item.corrupted,
        ...(exarch !== undefined && { exarch }),
        ...(eater !== undefined && { eater }),
        ...(item.strands !== undefined && {
            strands: Math.max(0, Math.min(MAX_STRANDS, item.strands)),
        }),
        prefixCount,
        suffixCount,
        present,
        pinned,
        oneOf,
        fracturedTypes,
        fracturedAnonymous,
        crafted,
        craftedTypes,
        anonymousBy,
    };
}
