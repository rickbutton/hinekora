/**
 * The primitive operations (operations.md §2) and their interpreter. A crafting
 * method is an ordered sequence of these; `runMethod` folds each into the
 * abstract item without enumerating outcomes, and a failed `require` anywhere
 * fails the whole method with the item unchanged. The metamods in force are read
 * once, when the method is applied, and govern every operation in it: a reforge
 * that rerolls the carrier of "prefixes cannot be changed" still keeps the
 * prefixes.
 */
import { craftedCapOf, type Effect } from "../model/effects.js";
import {
    type ClassId,
    type Gen,
    type GroupId,
    type ModId,
    type Rarity,
    TagId,
    type TypeId,
} from "../model/ids.js";
import type { ItemFacts } from "../model/item.js";
import type { Mod } from "../model/mod.js";
import type { EssenceSpec, FossilSpec } from "../model/sources.js";
import { VEILED_PREFIX, VEILED_SUFFIX } from "../model/veiled.js";
import { lookupWeight, pool } from "../pool/pool.js";
import { veiledPool } from "../pool/veiled.js";
import type { Registry } from "../resolve/registry.js";
import { rollableGen } from "../resolve/tiers.js";
import {
    admitAdd,
    assertFractureDisjunction,
    canBeRare,
    capsOver,
    excludedTypes,
    fracturedTypes,
    fractureProjection,
    guaranteedTypes,
    hasFracture,
    isExcluded,
    presenceFacts,
    rarityOf,
    settled,
    suffixRange,
    type AItem,
    type Range,
} from "./astate.js";
import { CountDomain } from "./counts.js";

// --- the operations --------------------------------------------------------

/** A pool: which rows a `fill` draws from, resolved against the state it runs on. */
export type PoolSpec =
    /** The natural pool of the base at the item's level, or at `level` (a beast's);
     *  optionally capped lower, limited to one side, or culled to the top half
     *  of each type's eligible tiers (`topTiers`, Foulborn). */
    | {
          readonly kind: "natural";
          readonly maxLevel?: number;
          readonly topTiers?: true;
          readonly gen?: Gen;
          readonly level?: number;
      }
    /** The natural pool's rows carrying a category tag (harvest). */
    | { readonly kind: "tagged"; readonly tag: TagId }
    /** The row a bench craft places; it counts as a crafted modifier. */
    | { readonly kind: "bench"; readonly mod: Mod }
    /** The row an essence grants to the item's class. */
    | { readonly kind: "essenceGrant"; readonly spec: EssenceSpec }
    /** The veiled placeholder, a modifier of either side awaiting its unveil. */
    | { readonly kind: "veiledPlaceholder" }
    /** The unveil results the item's placeholder may become; the fill replaces
     *  the placeholder. A target names the one the player picks. */
    | { readonly kind: "unveil"; readonly target?: TypeId }
    /** The natural pool under a resonator: rows carrying a blocked category tag
     *  are out, the fossils' own rows join, and a corrupted essence's modifier
     *  may land when a fossil gives it a chance. */
    | {
          readonly kind: "fossil";
          readonly blocked: ReadonlySet<TagId>;
          readonly added: readonly Mod[];
          readonly essence: readonly Mod[];
      }
    /** One of these rows, guaranteed: a fossil's forced row, the Glyphic Fossil's
     *  corrupted-essence modifier. */
    | { readonly kind: "rows"; readonly mods: readonly Mod[] }
    /** One of the metamods not yet on the item whose side may have a slot (the
     *  Bestiary's random metamod); crafted. */
    | { readonly kind: "metamods" };

/** How many modifiers a `fill` lays down. */
export type FillCount =
    /** `n` more modifiers, on top of what is present, clamped to the caps. */
    | { readonly kind: "add"; readonly n: Range }
    /** A reforge: the total lands in `n` when no side was kept; with a kept side
     *  the rerolled side takes any number up to its cap and open kept-side slots
     *  may fill (Metamod § Rules and Exceptions: "0 to 3 suffixes"). */
    | { readonly kind: "reforge"; readonly n: Range }
    /** One of the modifiers already counted: an essence's grant, a harvest
     *  reforge's tagged modifier, a veiled chaos's placeholder, an unveil. */
    | { readonly kind: "within" };

/** Which present modifiers a removal may reach. */
export type Selector =
    /** One random modifier, of one side when `gen` is given; only the Orb of
     *  Annulment honours a cannot-roll metamod's shield. A side-limited removal
     *  whose side is protected is skipped rather than refused (Metamod § Rules
     *  and Exceptions: "will add without removing"). */
    | { readonly kind: "random"; readonly honourCannotRoll: boolean; readonly gen?: Gen }
    /** The crafted modifiers the bench can clear; a fractured one stays. When
     *  `replacing`, only under a limit of one: a craft replaces the single crafted
     *  modifier, while under the multimod it adds beside them (Crafting Bench §
     *  Using the crafting bench). */
    | { readonly kind: "crafted"; readonly replacing: boolean }
    /** Exactly this modifier (a harvest change). */
    | { readonly kind: "type"; readonly type: TypeId };

/** A check a `require` must prove on every path. */
export type Check =
    | { readonly kind: "rarity"; readonly rarity: Rarity }
    | { readonly kind: "canBeRare" }
    | { readonly kind: "openSlot"; readonly gen?: Gen }
    | { readonly kind: "removable"; readonly selector: Selector }
    /** Something to strip: not Normal, and not every side protected. */
    | { readonly kind: "strippable" }
    | { readonly kind: "atLeast"; readonly count: number }
    | { readonly kind: "noFracture" }
    | { readonly kind: "veiledPresent" }
    /** No veiled or unveiled modifier at all (the Veiled Exalted Orb). */
    | { readonly kind: "noVeiled" }
    /** No veiled or unveiled modifier the strip would keep (the Veiled Chaos Orb
     *  reforges the rest away). */
    | { readonly kind: "noVeiledKept" }
    | { readonly kind: "noBlockingMetamod" }
    /** The modifier is guaranteed present, not fractured, and on an unprotected side. */
    | { readonly kind: "typeRemovable"; readonly type: TypeId; readonly label: string }
    /** An imprint is held on every path. */
    | { readonly kind: "hasImprint" }
    /** The Bestiary imprints a Magic item or a Rare talisman. */
    | { readonly kind: "imprintable" }
    /** Some metamod fits the item (the Bestiary's random metamod). */
    | { readonly kind: "metamodFits" }
    /** The base carries the tag (a talisman for the Bestiary fractures). */
    | { readonly kind: "baseHasTag"; readonly tag: TagId; readonly what: string }
    /** The fossil's base restriction admits this item. */
    | { readonly kind: "fossilAllowed"; readonly fossil: FossilSpec }
    | { readonly kind: "essenceRarity"; readonly tier: number }
    | { readonly kind: "essenceGrant"; readonly spec: EssenceSpec }
    | { readonly kind: "craftedBelowCap" }
    /** A crafted modifier the bench can remove is present on every path. */
    | { readonly kind: "craftedRemovable" }
    /** A craft that would replace the crafted modifier can: it is not fractured. */
    | { readonly kind: "craftedReplaceable" }
    | { readonly kind: "noGroupConflict"; readonly mod: Mod }
    | { readonly kind: "poolNonEmpty"; readonly pool: PoolSpec; readonly tag: TagId }
    | { readonly kind: "unveilTarget"; readonly type: TypeId; readonly name: string };

export type Op =
    | { readonly kind: "require"; readonly check: Check }
    /** Every modifier goes but the protected sides' and the fractured one. */
    | { readonly kind: "strip" }
    | { readonly kind: "fill"; readonly pool: PoolSpec; readonly count: FillCount }
    | { readonly kind: "remove"; readonly selector: Selector }
    /** `survivors`: the rarity a scour leaves, by how many modifiers remain. */
    | { readonly kind: "rarity"; readonly rarity: Rarity | "survivors" }
    /** One random present modifier becomes fractured. */
    | { readonly kind: "lock" }
    /** Hold the item as it is now, to restore later. */
    | { readonly kind: "imprint" }
    /** Replace the item with the held imprint, consuming it. */
    | { readonly kind: "restore" };

/** Why an operation's precondition fails on the current state. */
export type PreconditionFailure =
    | {
          readonly kind: "wrongRarity";
          readonly needed: Rarity;
          readonly actual: ReadonlySet<Rarity>;
      }
    | { readonly kind: "noOpenSlot"; readonly gen?: Gen }
    | { readonly kind: "modConflict"; readonly group: string }
    | { readonly kind: "nothingToRemove" }
    | {
          readonly kind: "essenceRarity";
          readonly tier: number;
          readonly actual: ReadonlySet<Rarity>;
      }
    | { readonly kind: "essenceClass"; readonly essence: string; readonly itemClass: ClassId }
    | { readonly kind: "rarityUnsupported"; readonly rarity: Rarity }
    | { readonly kind: "craftedLimit"; readonly cap: number }
    | { readonly kind: "noCraftedToRemove" }
    | { readonly kind: "craftedFractured" }
    | { readonly kind: "craftedMultiple" }
    | { readonly kind: "craftedCapUnknown" }
    | { readonly kind: "harvestEmptyPool"; readonly tag: TagId }
    | { readonly kind: "harvestNoRoom"; readonly tag: TagId }
    | { readonly kind: "harvestBlocked"; readonly tag: TagId }
    | { readonly kind: "metamodBlocks" }
    | { readonly kind: "fossilBaseRestricted"; readonly fossil: string }
    | { readonly kind: "fossilCorrupts"; readonly fossil: string }
    | { readonly kind: "wrongBase"; readonly needed: string }
    | { readonly kind: "noMetamodFits" }
    | { readonly kind: "noImprint" }
    | { readonly kind: "notImprintable" }
    | {
          readonly kind: "typeNotRemovable";
          readonly mod: string;
          readonly why: "absent" | "fractured" | "protected";
      }
    | { readonly kind: "tooFewMods"; readonly needed: number }
    | { readonly kind: "alreadyFractured" }
    | { readonly kind: "noVeiledMod" }
    | { readonly kind: "alreadyVeiled" }
    | { readonly kind: "veiledWouldSurvive" }
    | { readonly kind: "unveilNotAvailable"; readonly mod: string }
    | { readonly kind: "unveilNotGuaranteed"; readonly mod: string; readonly options: number };

export type TransferResult =
    | { readonly ok: true; readonly state: AItem }
    | { readonly ok: false; readonly failure: PreconditionFailure };

/**
 * Run a method: the operations in order, each on the state the previous one
 * produced. A failed `require` fails the method as a whole; the caller keeps the
 * state before it, as the game never applies part of a currency.
 */
export function runMethod(a0: AItem, ops: readonly Op[], registry: Registry): TransferResult {
    const rules = rulesInForce(a0, registry);
    let a = a0;
    for (const op of ops) {
        if (op.kind === "require") {
            const failure = failing(a, op.check, rules, registry);
            if (failure) return { ok: false, failure };
            continue;
        }
        a = apply(a, a0, op, rules, registry);
    }
    return { ok: true, state: a };
}

function apply(
    a: AItem,
    a0: AItem,
    op: Exclude<Op, { kind: "require" }>,
    rules: Rules,
    registry: Registry,
): AItem {
    switch (op.kind) {
        case "strip":
            return strip(a, rules, registry);
        case "fill":
            return fill(a, op.pool, op.count, rules, registry);
        case "remove":
            switch (op.selector.kind) {
                case "crafted":
                    return removeCrafted(a, rules, registry, op.selector.replacing);
                case "type":
                    return removeType(a, op.selector.type, registry);
                case "random": {
                    const allowed = allowedFor(op.selector, rules);
                    if (allowed.size === 0 && op.selector.gen !== undefined) return a;
                    return removeOne(a, allowed, shieldFor(op.selector, rules), registry);
                }
            }
            break;
        case "rarity":
            return settled({
                ...a,
                rarities:
                    op.rarity === "survivors"
                        ? scouredRarities(a0, rules, registry)
                        : new Set([op.rarity]),
            });
        case "lock":
            return lock(a);
        case "imprint": {
            const { imprint: _held, ...now } = a;
            return { ...a, imprint: now };
        }
        case "restore":
            // `hasImprint` ran first; a missing imprint here is unreachable.
            return a.imprint ?? a;
    }
}

// --- the metamods in force ---------------------------------------------------
//
// A metamod's effect is active iff its carrier type is GUARANTEED present
// (item-model.md §6): a merely-possible carrier is treated as absent, which is
// sound in every direction — protection that preserves guarantees, and
// restrictions that would constrain or reject a method, all require the carrier
// to be provably there.

const ALL_GENS: readonly Gen[] = ["prefix", "suffix"];
/** The base tag of a talisman, the one Rare the Bestiary imprints. */
const TALISMAN = TagId("talisman");

/** The rules the metamods impose on a method, read once when it is applied. */
interface Rules {
    /** Generations shielded from removal and reroll by "cannot be changed". */
    readonly protected: ReadonlySet<Gen>;
    /** The types a cannot-roll metamod shields from an Orb of Annulment. */
    readonly cannotRoll: Shield | null;
    /** The crafted-mod limit, raised by "can have up to 3 crafted modifiers". */
    readonly craftedCap: number;
    /** Protection and cannot-roll prevent an essence or a fossil; multimod does not. */
    readonly blocksSourced: boolean;
}

function rulesInForce(a: AItem, registry: Registry): Rules {
    const effects = activeEffects(a, registry);
    const protectedGens = new Set<Gen>();
    for (const e of effects) if (e.kind === "protect") protectedGens.add(e.gen);
    return {
        protected: protectedGens,
        cannotRoll: cannotRollShield(a, effects, registry),
        craftedCap: craftedCapOf(effects),
        blocksSourced: effects.some((e) => e.kind === "protect" || e.kind === "poolRestrict"),
    };
}

/** The effects active right now: the union over guaranteed effect-carriers. */
function activeEffects(a: AItem, registry: Registry): readonly Effect[] {
    const out: Effect[] = [];
    for (const t of guaranteedTypes(a)) out.push(...registry.effectsOfType(t));
    return out;
}

/**
 * What an active cannot-roll metamod shields from a removal: its tagged types.
 * Only the Orb of Annulment honours it ("will not remove attack/caster-tagged
 * mods", Orb of Annulment § Mechanics); the Veiled Exalted Orb's and the harvest
 * augment's removals ignore it (Metamod § Rules and Exceptions).
 */
interface Shield {
    readonly types: ReadonlySet<TypeId>;
}
function cannotRollShield(a: AItem, effects: readonly Effect[], registry: Registry): Shield | null {
    const restricts = effects.filter((e) => e.kind === "poolRestrict");
    if (restricts.length === 0) return null;
    const types = new Set<TypeId>();
    for (const t of guaranteedTypes(a)) {
        const rep = registry.catalog.find((m) => m.type === t);
        if (rep && restricts.some((e) => !e.allows(rep))) types.add(t);
    }
    return { types };
}

/** The sides a random removal may reach: its own side, if any, minus the protected. */
function allowedFor(selector: Selector, rules: Rules): ReadonlySet<Gen> {
    const sides =
        selector.kind === "random" && selector.gen !== undefined ? [selector.gen] : ALL_GENS;
    return new Set(sides.filter((g) => !rules.protected.has(g)));
}

function shieldFor(selector: Selector, rules: Rules): Shield | null {
    return selector.kind === "random" && selector.honourCannotRoll ? rules.cannotRoll : null;
}

/** The side `type` occupies on this item's base (`rollableGen`). */
function genOf(a: AItem, registry: Registry, type: TypeId): Gen {
    return rollableGen(registry.catalog, a.base, a.ilvl, type) ?? "prefix";
}

// --- require ------------------------------------------------------------------

function failing(
    a: AItem,
    check: Check,
    rules: Rules,
    registry: Registry,
): PreconditionFailure | null {
    switch (check.kind) {
        case "rarity":
            return rarityOf(a) === check.rarity
                ? null
                : { kind: "wrongRarity", needed: check.rarity, actual: a.rarities };
        case "canBeRare":
            return canBeRare(a.base) ? null : { kind: "rarityUnsupported", rarity: "rare" };
        case "openSlot":
            return hasOpenSlot(a, check.gen)
                ? null
                : check.gen === undefined
                  ? { kind: "noOpenSlot" }
                  : { kind: "noOpenSlot", gen: check.gen };
        case "removable": {
            const allowed = allowedFor(check.selector, rules);
            if (
                check.selector.kind === "random" &&
                check.selector.gen !== undefined &&
                allowed.size === 0
            ) {
                return null; // the side is protected: the method adds without removing
            }
            return hasRemovable(a, allowed, shieldFor(check.selector, rules), registry)
                ? null
                : { kind: "nothingToRemove" };
        }
        case "craftedRemovable":
            return a.crafted[0] - fracturedCrafted(a, registry) >= 1
                ? null
                : { kind: "noCraftedToRemove" };
        case "craftedReplaceable": {
            if (rules.craftedCap > 1 || a.crafted[1] === 0) return null;
            if (a.crafted[1] >= 2) return { kind: "craftedMultiple" };
            if (fracturedCrafted(a, registry) >= 1) return { kind: "craftedFractured" };
            // A multimod that may be on the item would make the craft add on its
            // path and replace on the other, so which happens is not settled.
            return mayCarryCraftedCap(a, registry) ? { kind: "craftedCapUnknown" } : null;
        }
        case "strippable": {
            // A Magic base with zero affixes (a magic Simplex) still drops to Normal,
            // so rarity, not mod count, is the gate; both sides protected and no
            // fractured mod means nothing would go.
            if (a.rarities.has("normal")) return { kind: "nothingToRemove" };
            if (rules.protected.size === ALL_GENS.length && !hasFracture(a)) {
                return { kind: "nothingToRemove" };
            }
            return null;
        }
        case "atLeast":
            return a.counts.total[0] >= check.count
                ? null
                : { kind: "tooFewMods", needed: check.count };
        case "noFracture":
            return hasFracture(a) ? { kind: "alreadyFractured" } : null;
        case "veiledPresent":
            return hasVeiledPlaceholder(a) ? null : { kind: "noVeiledMod" };
        case "noVeiled":
            return mayHaveVeiled(a, registry) ? { kind: "alreadyVeiled" } : null;
        case "noVeiledKept": {
            const fractured = fracturedTypes(a);
            const unprovenLock = hasFracture(a) && fractured.size === 0;
            const kept = (t: TypeId): boolean =>
                unprovenLock || fractured.has(t) || rules.protected.has(sideOf(a, registry, t));
            return mayHaveVeiled(a, registry, kept) ? { kind: "veiledWouldSurvive" } : null;
        }
        case "typeRemovable": {
            const { type, label } = check;
            if (!guaranteedTypes(a).has(type))
                return { kind: "typeNotRemovable", mod: label, why: "absent" };
            const fractured = fracturedTypes(a);
            if (fractured.has(type) || (hasFracture(a) && fractured.size === 0)) {
                return { kind: "typeNotRemovable", mod: label, why: "fractured" };
            }
            if (rules.protected.has(genOf(a, registry, type))) {
                return { kind: "typeNotRemovable", mod: label, why: "protected" };
            }
            return null;
        }
        case "hasImprint":
            return a.imprint === undefined ? { kind: "noImprint" } : null;
        case "imprintable":
            return [...a.rarities].every(
                (r) => r === "magic" || (r === "rare" && a.base.tags.has(TALISMAN)),
            )
                ? null
                : { kind: "notImprintable" };
        case "metamodFits":
            // Some one carrier must fit on every path: its side provably open and
            // itself not possibly on the item. The fill then draws from the wider
            // set of carriers that fit on some path.
            return metamodRows(a, registry).some(
                (m) => hasOpenSlot(a, m.gen) && !(a.possible.has(m.type) && !isExcluded(a, m.type)),
            )
                ? null
                : { kind: "noMetamodFits" };
        case "baseHasTag":
            return a.base.tags.has(check.tag) ? null : { kind: "wrongBase", needed: check.what };
        case "fossilAllowed": {
            // A corrupted item takes no further craft, and the state has no
            // corruption yet, so the resonator is refused rather than followed.
            if (check.fossil.corrupts) return { kind: "fossilCorrupts", fossil: check.fossil.name };
            const allowed = check.fossil.allowedTags;
            if (allowed === undefined) return null;
            for (const t of a.base.tags) if (allowed.has(t)) return null;
            return { kind: "fossilBaseRestricted", fossil: check.fossil.name };
        }
        case "noBlockingMetamod":
            return rules.blocksSourced ? { kind: "metamodBlocks" } : null;
        case "essenceRarity":
            // Normal always, Rare only for ladder tier ≥ 5, never Magic.
            return [...a.rarities].some((r) => r === "magic" || (r === "rare" && check.tier < 5))
                ? { kind: "essenceRarity", tier: check.tier, actual: a.rarities }
                : null;
        case "essenceGrant":
            return essenceGrant(a, check.spec, registry)
                ? null
                : { kind: "essenceClass", essence: check.spec.name, itemClass: a.base.itemClass };
        case "craftedBelowCap":
            // If that many might already be present, another isn't provably safe.
            return a.crafted[1] >= rules.craftedCap
                ? { kind: "craftedLimit", cap: rules.craftedCap }
                : null;
        case "noGroupConflict":
            return sharesFamilyWithPresent(a, check.mod, registry)
                ? { kind: "modConflict", group: registry.typeLabel(check.mod.type) }
                : null;
        case "poolNonEmpty": {
            // A fill reads a superset of every path's pool; this must read a
            // subset, so a path on which the tagged pool is empty is caught.
            if (check.pool.kind !== "tagged") {
                return resolvePool(a, check.pool, registry).mods.length > 0
                    ? null
                    : { kind: "harvestEmptyPool", tag: check.tag };
            }
            const tag = check.tag;
            const hasTag = (m: Mod): boolean => m.implicitTags.has(tag);
            const tagged = (p: number, s: number): boolean =>
                subsetMods(a, registry, p, s).some(hasTag);
            if (!tagged(0, 0)) {
                // Either no tagged row rolls here at all, or one does but a
                // modifier the item may carry blocks it (its type, its group).
                return resolvePool(a, check.pool, registry).mods.some(hasTag)
                    ? { kind: "harvestBlocked", tag }
                    : { kind: "harvestEmptyPool", tag };
            }
            // Every realisable pair of side counts must leave a tagged row room:
            // the sides are coupled through the total, so each path's pair is
            // judged on its own rather than both sides at their fullest at once.
            for (const [p, s] of sidePairs(a)) {
                if (!tagged(p, s)) return { kind: "harvestNoRoom", tag };
            }
            return null;
        }
        case "unveilTarget": {
            const offered = resolvePool(a, { kind: "unveil" }, registry).types;
            if (!offered.includes(check.type)) {
                return { kind: "unveilNotAvailable", mod: check.name };
            }
            // Three options are offered, so a pick is a guarantee only among ≤ 3.
            if (offered.length > 3) {
                return { kind: "unveilNotGuaranteed", mod: check.name, options: offered.length };
            }
            return null;
        }
    }
}

/** Is a slot provably open (in `gen`, or anywhere)? A side's cap is not enough
 *  on its own: the two sides together are also held to the rarity's total (a
 *  magic Ratcheting Ring may take four suffixes by its side cap but two by its
 *  total), so a named side must also leave the total under its cap. */
function hasOpenSlot(a: AItem, gen: Gen | undefined): boolean {
    // Open on every path: the counts' upper bounds against the tightest caps.
    const tight = capsOver(a, Math.min);
    if (a.counts.total[1] >= tight.total) return false; // full in some arm
    if (gen === "prefix") return a.counts.prefix[1] < tight.prefix;
    if (gen === "suffix") return suffixRange(a)[1] < tight.suffix;
    return true;
}

function hasRemovable(
    a: AItem,
    allowed: ReadonlySet<Gen>,
    shield: Shield | null,
    registry: Registry,
): boolean {
    if (allowed.size === 0) return false; // every side protected → nothing to remove
    // A fractured mod is locked, so it doesn't count toward what's removable; an
    // unproven fracture likewise locks one mod (of unknown generation).
    const fractured = fracturedTypes(a);
    const unprovenLock = hasFracture(a) && fractured.size === 0 ? 1 : 0;
    // Under a shield an anonymous mod may be a shielded tagged one, so only the
    // guaranteed, unshielded, unlocked mods on allowed sides prove a removal (one
    // more than the unproven lock, which may sit on any of them).
    if (shield !== null) {
        let provable = 0;
        for (const t of guaranteedTypes(a)) {
            if (shield.types.has(t) || fractured.has(t)) continue;
            if (allowed.has(genOf(a, registry, t))) provable++;
        }
        return provable - unprovenLock >= 1;
    }
    const fracIn = (g: Gen): number => fracturedIn(a, registry, g);
    if (allowed.size === 2) {
        return a.counts.total[0] - fractured.size - unprovenLock >= 1; // any non-locked affix
    }
    const g: Gen = allowed.has("prefix") ? "prefix" : "suffix";
    const lower = g === "prefix" ? a.counts.prefix[0] : suffixRange(a)[0];
    return lower - fracIn(g) - unprovenLock >= 1;
}

/**
 * Could a mod in `mod`'s group already sit on the item? A guaranteed same-group
 * type definitely conflicts. A merely POSSIBLE one conflicts only when its
 * generation still holds an unidentified affix that could be it, a generation
 * whose count is fully accounted for by guaranteed types rules it out (so a
 * proven "2 suffixes, 0 prefixes" item can still take a benched prefix). A
 * conflict hidden behind an anonymous "random" affix is not caught.
 */
function sharesFamilyWithPresent(a: AItem, mod: Mod, registry: Registry): boolean {
    const guaranteed = guaranteedTypes(a);
    const shares = (type: TypeId): boolean => {
        const fams = registry.familiesOfType(type);
        for (const f of mod.families) if (fams.has(f)) return true;
        return false;
    };
    for (const type of guaranteed) if (shares(type)) return true; // definitely present

    // Affixes in a generation not pinned to a guaranteed type: if none, no
    // non-guaranteed member of that generation can be present.
    const unidentifiedIn = (gen: Gen): number => {
        let named = 0;
        for (const t of guaranteed) if (genOf(a, registry, t) === gen) named++;
        const max = gen === "prefix" ? a.counts.prefix[1] : suffixRange(a)[1];
        return max - named;
    };
    for (const type of a.possible) {
        if (guaranteed.has(type) || isExcluded(a, type) || !shares(type)) continue;
        if (unidentifiedIn(genOf(a, registry, type)) > 0) return true;
    }
    return false;
}

/** Is a veiled placeholder present (a mod awaiting unveil)? */
function hasVeiledPlaceholder(a: AItem): boolean {
    const clause = a.bdd.or(a.bdd.variable(VEILED_PREFIX), a.bdd.variable(VEILED_SUFFIX));
    return a.bdd.entails(a.presence, clause);
}

/** Might the item carry a veiled placeholder or an unveiled result mod? A veiled
 *  orb refuses both ("an item with a veiled modifier or its craftable versions",
 *  Veiled Exalted Orb; "cannot be used to obtain multiple veiled modifiers",
 *  Crafting), and the precondition must hold on every path, so a possible one
 *  is enough to refuse. */
function mayHaveVeiled(a: AItem, registry: Registry, among?: (t: TypeId) => boolean): boolean {
    for (const t of a.possible) {
        if (isExcluded(a, t)) continue;
        if (among && !among(t)) continue;
        if (t === VEILED_PREFIX || t === VEILED_SUFFIX) return true;
        // Many unveiled rows share their type with natural rows, so the rows the
        // type may be (its tier overlay, else every row) decide, not the first row.
        if (rowsOf(a, t, registry).some((m) => m.source === "veiled")) return true;
    }
    return false;
}

/** The side a type sits on; the veiled placeholders name theirs. */
function sideOf(a: AItem, registry: Registry, t: TypeId): Gen {
    if (t === VEILED_PREFIX) return "prefix";
    if (t === VEILED_SUFFIX) return "suffix";
    return genOf(a, registry, t);
}

/** The rows a present type may be: its tier overlay, else every row of the type. */
function rowsOf(a: AItem, type: TypeId, registry: Registry): readonly Mod[] {
    const pinned = a.tiers.get(type);
    return pinned
        ? [...pinned].map((id) => registry.resolveMod(id)).flatMap((r) => (r.ok ? [r.value] : []))
        : registry.catalog.filter((m) => m.type === type);
}

function essenceGrant(a: AItem, spec: EssenceSpec, registry: Registry): Mod | undefined {
    const modId = spec.grants.get(a.base.itemClass);
    return modId === undefined ? undefined : registry.catalog.find((m) => m.id === modId);
}

// --- strip ---------------------------------------------------------------------

/**
 * Every modifier goes but those on a protected side and the fractured one.
 * Counts fall to what is kept; guarantees survive only for kept types, tier pins
 * and `possible` for kept types and, under an unproven lock, for every current
 * type; exclusions stay (nothing is added); the fracture facts are
 * permanent; the crafted range keeps only what the kept side could hold.
 */
function strip(a: AItem, rules: Rules, registry: Registry): AItem {
    const keep = rules.protected;
    const genOfT = (t: TypeId): Gen => genOf(a, registry, t);
    const fractured = fracturedTypes(a);
    const isKept = (t: TypeId): boolean => keep.has(genOfT(t)) || fractured.has(t);
    const fracIn = (g: Gen): number => fracturedIn(a, registry, g);
    // An unproven fracture keeps one mod of unknown generation.
    const unprovenLock = hasFracture(a) && fractured.size === 0 ? 1 : 0;

    // Kept counts per side: the whole side if protected, else just its fractured mod.
    const keptPrefix: Range = keep.has("prefix")
        ? a.counts.prefix
        : [fracIn("prefix"), fracIn("prefix")];
    const keptSuffix: Range = keep.has("suffix")
        ? suffixRange(a)
        : [fracIn("suffix"), fracIn("suffix")];
    const prefix: Range = [keptPrefix[0], keptPrefix[1] + unprovenLock];
    // The unproven lock may sit on a kept mod, so it adds to the floor only
    // what the kept side cannot already account for.
    const total: Range = [
        Math.max(keptPrefix[0] + keptSuffix[0], unprovenLock),
        keptPrefix[1] + keptSuffix[1] + unprovenLock,
    ];

    const keptGuarantees = new Set<TypeId>();
    for (const t of guaranteedTypes(a)) if (keep.has(genOfT(t))) keptGuarantees.add(t);
    // Under an unproven lock the surviving mod may be any current one.
    const mayRemain = (t: TypeId): boolean => isKept(t) || unprovenLock > 0;
    const possible = new Set<TypeId>();
    for (const t of a.possible) if (mayRemain(t)) possible.add(t);
    const tiers = new Map<TypeId, ReadonlySet<ModId>>();
    for (const [t, s] of a.tiers) if (mayRemain(t)) tiers.set(t, s);

    // A guaranteed metamod carrier on the stripped side is provably crafted and
    // provably gone; a kept (protected or fractured) one may survive, and an
    // unproven lock may have kept one of the carriers counted as stripped.
    let strippedCarriers = 0;
    for (const t of guaranteedTypes(a)) {
        if (!isKept(t) && registry.effectsOfType(t).length > 0) strippedCarriers++;
    }
    const crafted: Range =
        keep.size === 0
            ? [0, fracturedCrafted(a, registry)] // nothing kept but the fractured mod
            : [0, Math.max(0, a.crafted[1] - Math.max(0, strippedCarriers - unprovenLock))];

    const presence = a.bdd.and(
        presenceFacts(a.bdd, keptGuarantees, excludedTypes(a)),
        fractureProjection(a),
    );
    return settled({ ...a, counts: { total, prefix }, presence, possible, tiers, crafted });
}

/** How many of the fractured (locked, so reforge-proof) mods are bench rows: the
 *  crafted count a reforge cannot clear (a crafted mod can be fractured,
 *  Crafting Bench § Using the crafting bench). */
function fracturedCrafted(a: AItem, registry: Registry): number {
    const fractured = fracturedTypes(a);
    // An unproven lock may sit on any current mod, a crafted one included.
    if (fractured.size === 0) return hasFracture(a) ? Math.min(1, a.crafted[1]) : 0;
    let n = 0;
    for (const t of fractured) {
        if (rowsOf(a, t, registry).some((m) => m.source === "bench")) n++;
    }
    return Math.min(n, a.crafted[1]);
}

/** The fractured mods on one side. */
function fracturedIn(a: AItem, registry: Registry, gen: Gen): number {
    let n = 0;
    for (const t of fracturedTypes(a)) if (genOf(a, registry, t) === gen) n++;
    return n;
}

/**
 * What a strip keeps, per side: the protected sides' counts and the fractured
 * mod, read from the state the method started on (after the strip the suffix
 * range is derived from the total and carries the prefix uncertainty).
 */
function keptBounds(a0: AItem, rules: Rules, registry: Registry): { prefix: Range; suffix: Range } {
    const fp = fracturedIn(a0, registry, "prefix");
    const fs = fracturedIn(a0, registry, "suffix");
    return {
        prefix: rules.protected.has("prefix") ? a0.counts.prefix : [fp, fp],
        suffix: rules.protected.has("suffix") ? suffixRange(a0) : [fs, fs],
    };
}

/** How many modifiers a strip leaves, as a range: the kept sides' counts plus
 *  the fractured mod, which under an unproven lock may be one of the kept ones. */
function survivorsOf(a0: AItem, rules: Rules, registry: Registry): Range {
    const kept = keptBounds(a0, rules, registry);
    const unprovenLock = hasFracture(a0) && fracturedTypes(a0).size === 0 ? 1 : 0;
    return [
        Math.max(kept.prefix[0] + kept.suffix[0], unprovenLock),
        kept.prefix[1] + kept.suffix[1] + unprovenLock,
    ];
}

/** The rarity a scour leaves by survivor count (Orb of Scouring): none → Normal,
 *  one → Magic, two or more → Rare, whichever sides they sit on. */
function rarityForSurvivors(n: number): Rarity {
    if (n === 0) return "normal";
    if (n === 1) return "magic";
    return "rare";
}

/** The rarities a scour may leave: one per survivor count the strip allows. */
function scouredRarities(a0: AItem, rules: Rules, registry: Registry): ReadonlySet<Rarity> {
    const [lo, hi] = survivorsOf(a0, rules, registry);
    const out = new Set<Rarity>();
    for (let n = lo; n <= hi; n++) out.add(rarityForSurvivors(n));
    return out;
}

// --- fill ---------------------------------------------------------------------

/** A pool resolved against a state: its rows, the types a draw may be, and
 *  whether the draw is narrow enough to assert "at least one of these". */
interface ResolvedPool {
    readonly mods: readonly Mod[];
    readonly types: readonly TypeId[];
    /** The types "at least one of" is asserted over; empty for the natural pool. */
    readonly assert: readonly TypeId[];
    /** The side every row of the pool occupies, when they agree. */
    readonly gen: Gen | undefined;
}

function resolvePool(a: AItem, spec: PoolSpec, registry: Registry): ResolvedPool {
    switch (spec.kind) {
        case "natural": {
            const cap = spec.maxLevel ?? Infinity;
            const eligible = addableMods(a, registry, spec.level).filter(
                (m) => m.minLevel <= cap && (spec.gen === undefined || m.gen === spec.gen),
            );
            const mods = spec.topTiers ? foulbornTiers(eligible, a, registry) : eligible;
            return { mods, types: typesOf(mods), assert: [], gen: spec.gen };
        }
        case "tagged": {
            const mods = addableMods(a, registry).filter((m) => m.implicitTags.has(spec.tag));
            const types = typesOf(mods);
            return { mods, types, assert: types, gen: undefined };
        }
        case "bench":
            return {
                mods: [spec.mod],
                types: [spec.mod.type],
                assert: [spec.mod.type],
                gen: spec.mod.gen,
            };
        case "essenceGrant": {
            const mod = essenceGrant(a, spec.spec, registry);
            const mods = mod ? [mod] : [];
            return { mods, types: typesOf(mods), assert: typesOf(mods), gen: mod?.gen };
        }
        case "veiledPlaceholder":
            return {
                mods: [],
                types: [VEILED_PREFIX, VEILED_SUFFIX],
                assert: [VEILED_PREFIX, VEILED_SUFFIX],
                gen: undefined,
            };
        case "fossil": {
            const natural = addableMods(a, registry).filter((m) => !carriesAny(m, spec.blocked));
            // A fossil's own rows are outside the natural pool's domain, so they
            // are admitted by their own weight on the base; an essence's row by
            // the essence's class table, already applied.
            const tags = a.base.tags;
            const added = spec.added.filter(
                (m) => m.minLevel <= a.ilvl && (lookupWeight(m, tags) ?? 0) > 0,
            );
            const mods = [...natural, ...added, ...spec.essence];
            return { mods, types: typesOf(mods), assert: [], gen: undefined };
        }
        case "rows":
            return oneOf(spec.mods);
        case "metamods":
            return oneOf(metamodRows(a, registry));
        case "unveil": {
            // Blocking is folded in: an unveiled mod whose family a guaranteed
            // present one claims is not offered.
            const presentFamilies = new Set<GroupId>();
            for (const t of guaranteedTypes(a)) {
                for (const f of registry.familiesOfType(t)) presentFamilies.add(f);
            }
            const mods = veiledPool(registry.catalog, a.base, a.ilvl, presentFamilies);
            const types = typesOf(mods);
            return {
                mods,
                types,
                assert: spec.target === undefined ? types : [spec.target],
                gen: undefined,
            };
        }
    }
}

/** How many of a type's `n` eligible tiers a Foulborn orb lets roll, the top ones
 *  (Foulborn currency § Mechanics). */
function foulbornKept(n: number): number {
    return n <= 6 ? Math.ceil(n / 2) : Math.floor(n / 2) + 1;
}

/**
 * The Foulborn cull of an add-pool. The pool may hold rows that only a possibly
 * present modifier's tag enables, so a type's eligible count is known only to
 * lie between the count without those rows and with them; a row stays when
 * some count in that range would keep it, which is when its rank by level
 * among all the rows is within the sure count's allowance plus the number of
 * uncertain rows (each of which may rank above it). This rests on a tag only
 * ever adding rows (`lookupWeight`): a sure row never becomes ineligible.
 */
function foulbornTiers(mods: readonly Mod[], a: AItem, registry: Registry): Mod[] {
    const sure = new Set<ModId>();
    for (const c of pool(registry.catalog, guaranteedFacts(a, registry))) sure.add(c.mod.id);
    const byType = new Map<TypeId, Mod[]>();
    for (const m of mods) {
        const rows = byType.get(m.type);
        if (rows) rows.push(m);
        else byType.set(m.type, [m]);
    }
    const out: Mod[] = [];
    for (const rows of byType.values()) {
        const sureCount = rows.filter((m) => sure.has(m.id)).length;
        const allowance = foulbornKept(sureCount) + (rows.length - sureCount);
        for (const m of rows) {
            const rank = 1 + rows.filter((r) => r.minLevel > m.minLevel).length;
            if (rank <= allowance) out.push(m);
        }
    }
    return out;
}

/** A pool of given rows, one of which lands: asserted as a disjunction. */
function oneOf(mods: readonly Mod[]): ResolvedPool {
    const gens = new Set(mods.map((m) => m.gen));
    return {
        mods,
        types: typesOf(mods),
        assert: typesOf(mods),
        gen: gens.size === 1 ? mods[0]!.gen : undefined,
    };
}

/** The metamods the Bestiary recipe may craft: the bench's effect carriers not
 *  guaranteed on the item whose side may have a slot on some path (Beastcrafting,
 *  "Add a crafted Meta-modifier"). Wider than what the game draws from on any
 *  one path, so the disjunction the fill asserts holds on each. */
function metamodRows(a: AItem, registry: Registry): Mod[] {
    const guaranteed = guaranteedTypes(a);
    return registry.catalog.filter(
        (m) =>
            m.source === "bench" &&
            registry.effectsOfType(m.type).length > 0 &&
            !guaranteed.has(m.type) &&
            mayHaveSlot(a, m.gen),
    );
}

/** Might this side have an open slot on some path? */
function mayHaveSlot(a: AItem, gen: Gen): boolean {
    const loose = capsOver(a, Math.max);
    if (a.counts.total[0] >= loose.total) return false;
    const lower = gen === "prefix" ? a.counts.prefix[0] : suffixRange(a)[0];
    return lower < loose[gen];
}

function carriesAny(m: Mod, tags: ReadonlySet<TagId>): boolean {
    for (const t of m.implicitTags) if (tags.has(t)) return true;
    return false;
}

function typesOf(mods: readonly Mod[]): TypeId[] {
    return [...new Set(mods.map((m) => m.type))];
}

/**
 * Lay down modifiers drawn from `pool`. Counts rise by the fill count, clamped to
 * the caps; the pool's types join `possible` and its rows the tier overlay (a
 * one-row pool pins the tier); exclusions on the pool's types are relaxed, since
 * the draw may be any of them; a pool narrow enough to name asserts "at least
 * one of its types is present". A bench craft raises the crafted count.
 */
function fill(a: AItem, spec: PoolSpec, count: FillCount, rules: Rules, registry: Registry): AItem {
    // Upper bounds may reach the loosest caps over the rarities, lower bounds
    // only the tightest: a lower bound holds on the tightest path too.
    const { total: maxT, prefix: pCap, suffix: sCap } = capsOver(a, Math.max);
    const tight = capsOver(a, Math.min);
    // Nothing fits on any path (a magic Simplex): the fill lays down nothing.
    if (count.kind === "add" && a.counts.total[0] >= maxT) return settled(a);

    const drawn = resolvePool(a, spec, registry);
    const one = drawn.mods.length === 1 ? drawn.mods[0] : undefined;

    let counts = a.counts;
    switch (count.kind) {
        case "add": {
            const [lo, hi] = count.n;
            const total: Range = [
                Math.min(a.counts.total[0] + lo, tight.total),
                Math.min(a.counts.total[1] + hi, maxT),
            ];
            const prefix: Range =
                drawn.gen === "prefix"
                    ? [
                          Math.min(a.counts.prefix[0] + lo, tight.prefix),
                          Math.min(a.counts.prefix[1] + hi, pCap),
                      ]
                    : drawn.gen === "suffix"
                      ? a.counts.prefix
                      : [a.counts.prefix[0], Math.min(a.counts.prefix[1] + hi, pCap)];
            counts = { total, prefix };
            break;
        }
        case "reforge": {
            if (rules.protected.size === 0) {
                const total: Range = [Math.min(count.n[0], maxT), Math.min(count.n[1], maxT)];
                counts = {
                    total,
                    prefix: [Math.max(0, total[0] - sCap), Math.min(pCap, total[1])],
                };
            } else {
                counts = { total: [a.counts.total[0], maxT], prefix: [a.counts.prefix[0], pCap] };
            }
            break;
        }
        case "within":
            if (one) counts = CountDomain.learnPresent(counts, one.gen);
            break;
    }

    const possible = new Set(a.possible);
    const tiers = new Map(a.tiers);
    let presence = a.presence;
    if (spec.kind === "unveil") {
        // The unveiled row replaces the placeholder.
        presence = a.bdd.exists(a.bdd.exists(presence, VEILED_PREFIX), VEILED_SUFFIX);
        for (const t of [VEILED_PREFIX, VEILED_SUFFIX]) {
            possible.delete(t);
            tiers.delete(t);
        }
    }
    for (const t of drawn.types) possible.add(t);
    for (const m of drawn.mods) {
        const cur = tiers.get(m.type);
        tiers.set(m.type, one ? new Set([m.id]) : cur ? new Set([...cur, m.id]) : new Set([m.id]));
    }
    // The draw may be any of the pool's types, rows or not (the veiled
    // placeholders have no row), so an exclusion on any of them is relaxed.
    presence = admitAdd({ ...a, presence }, [
        ...drawn.mods,
        ...drawn.types.map((type) => ({ type })),
    ]);
    if (drawn.assert.length > 0) {
        let clause = a.bdd.FALSE;
        for (const t of drawn.assert) clause = a.bdd.or(clause, a.bdd.variable(t));
        presence = a.bdd.and(presence, clause);
    }

    let crafted = a.crafted;
    if (count.kind === "add" && (spec.kind === "bench" || spec.kind === "metamods")) {
        crafted = [a.crafted[0] + count.n[0], a.crafted[1] + count.n[1]];
    }
    return settled({ ...a, counts, presence, possible, tiers, crafted });
}

// --- remove ---------------------------------------------------------------------

function removeOne(
    a: AItem,
    allowed: ReadonlySet<Gen>,
    shield: Shield | null,
    registry: Registry,
): AItem {
    const total: Range = [Math.max(0, a.counts.total[0] - 1), Math.max(0, a.counts.total[1] - 1)];
    const onlyPrefix = allowed.size === 1 && allowed.has("prefix");
    const onlySuffix = allowed.size === 1 && allowed.has("suffix");
    const prefix: Range = onlyPrefix
        ? [Math.max(0, a.counts.prefix[0] - 1), Math.max(0, a.counts.prefix[1] - 1)]
        : onlySuffix
          ? a.counts.prefix
          : [Math.max(0, a.counts.prefix[0] - 1), a.counts.prefix[1]];

    // A guarantee survives only if the removed affix could not have been it: one
    // in a generation the removal cannot reach (protected), one the shield covers,
    // or a fractured (locked) one. Exclusions always survive (a removal never adds
    // a mod), and so do the fracture facts.
    const surviving = new Set<TypeId>();
    for (const t of guaranteedTypes(a)) {
        if (!allowed.has(genOf(a, registry, t))) surviving.add(t);
    }
    if (shield) for (const t of shield.types) surviving.add(t);
    for (const t of fracturedTypes(a)) surviving.add(t);
    const presence = a.bdd.and(
        presenceFacts(a.bdd, surviving, excludedTypes(a)),
        fractureProjection(a),
    );
    // The removed affix might have been the crafted mod, so the lower bound drops.
    const crafted: Range = [Math.max(0, a.crafted[0] - 1), a.crafted[1]];
    return settled({ ...a, counts: { total, prefix }, presence, crafted });
}

/** Remove one named, guaranteed modifier: it is gone, everything else stays. */
function removeType(a: AItem, type: TypeId, registry: Registry): AItem {
    const gen = genOf(a, registry, type);
    const total: Range = [Math.max(0, a.counts.total[0] - 1), Math.max(0, a.counts.total[1] - 1)];
    const prefix: Range =
        gen === "prefix"
            ? [Math.max(0, a.counts.prefix[0] - 1), Math.max(0, a.counts.prefix[1] - 1)]
            : a.counts.prefix;
    const surviving = guaranteedTypes(a);
    surviving.delete(type);
    const gone = excludedTypes(a);
    gone.add(type);
    const presence = a.bdd.and(presenceFacts(a.bdd, surviving, gone), fractureProjection(a));
    const tiers = new Map(a.tiers);
    tiers.delete(type);
    // The named modifier may have been the crafted one.
    const crafted: Range = rowsOf(a, type, registry).some((m) => m.source === "bench")
        ? [Math.max(0, a.crafted[0] - 1), a.crafted[1]]
        : a.crafted;
    return settled({ ...a, counts: { total, prefix }, presence, tiers, crafted });
}

/** Might a crafted-limit carrier be on the item without being guaranteed? */
function mayCarryCraftedCap(a: AItem, registry: Registry): boolean {
    const guaranteed = guaranteedTypes(a);
    for (const t of a.possible) {
        if (guaranteed.has(t) || isExcluded(a, t)) continue;
        if (registry.effectsOfType(t).some((e) => e.kind === "craftedCap")) return true;
    }
    return false;
}

/**
 * Clear the crafted modifiers the bench can reach. A type is a crafted modifier
 * when its rows are bench rows (a benched or declared one pins to its row); a
 * type with a bench row among others may be one, so it keeps its presence but
 * not its guarantee. A fractured crafted modifier stays, and under an unproven
 * lock any of them may be the fractured one.
 */
function removeCrafted(a: AItem, rules: Rules, registry: Registry, replacing: boolean): AItem {
    if (replacing && rules.craftedCap > 1) return a;
    if (a.crafted[1] === 0) return a;
    const fractured = fracturedTypes(a);
    const unprovenLock = hasFracture(a) && fractured.size === 0;
    const isBench = (m: Mod): boolean => m.source === "bench";
    let fracturedLower = 0;
    for (const t of fractured) if (rowsOf(a, t, registry).every(isBench)) fracturedLower++;
    const fracturedUpper = fracturedCrafted(a, registry);
    const removedLower = Math.max(0, a.crafted[0] - fracturedUpper);
    const removedUpper = Math.max(0, a.crafted[1] - fracturedLower);

    const guaranteed = guaranteedTypes(a);
    const excluded = excludedTypes(a);
    const surviving = new Set<TypeId>();
    const gone = new Set(excluded);
    const tiers = new Map(a.tiers);
    const sure = { prefix: 0, suffix: 0 };
    for (const t of a.possible) {
        if (excluded.has(t)) continue;
        const rows = rowsOf(a, t, registry);
        if (!rows.some(isBench) || fractured.has(t)) {
            if (guaranteed.has(t)) surviving.add(t);
            continue;
        }
        tiers.delete(t);
        if (rows.every(isBench) && !unprovenLock) {
            if (guaranteed.has(t)) sure[genOf(a, registry, t)]++;
            gone.add(t);
        }
    }
    const sureRemoved = Math.max(removedLower, sure.prefix + sure.suffix);
    const total: Range = [
        Math.max(0, a.counts.total[0] - removedUpper),
        Math.max(0, a.counts.total[1] - sureRemoved),
    ];
    const prefix: Range = [
        Math.max(0, a.counts.prefix[0] - removedUpper),
        Math.max(0, a.counts.prefix[1] - sure.prefix),
    ];
    const presence = a.bdd.and(presenceFacts(a.bdd, surviving, gone), fractureProjection(a));
    const crafted: Range = [
        Math.min(a.crafted[0], fracturedLower),
        Math.min(a.crafted[1], fracturedUpper),
    ];
    return settled({ ...a, counts: { total, prefix }, presence, tiers, crafted });
}

// --- lock -----------------------------------------------------------------------

/** One random modifier becomes fractured. The target is random, so no specific
 *  mod is proven fractured yet: every present named mod becomes a candidate a
 *  `fractured X` branch can pin, and when they account for every mod the lock
 *  provably landed among them. A metamod is an ordinary candidate. */
function lock(a: AItem): AItem {
    const candidates = [...guaranteedTypes(a)];
    const exhaustive = a.counts.total[1] <= candidates.length;
    return settled({
        ...a,
        presence: assertFractureDisjunction(a.bdd, a.presence, candidates, exhaustive),
    });
}

// --- the add-pool (which rows a draw could be) --------------------------------

/**
 * Over-approximate the mods a draw could introduce: run the real `pool` on the
 * facts of the guaranteed mods alone, at rare caps (fewer present mods ⇒ a
 * superset of every arm's real pool). Returns mods, not just types, so the tier
 * overlay can record which tiers.
 */
function addableMods(a: AItem, registry: Registry, level = a.ilvl): Mod[] {
    const facts = guaranteedFacts(a, registry, level);
    // Tags a possibly present mod would add may enable a row (the staff jewel mods
    // on a Strength jewel), so the pool admits what they would: the tags of the
    // state's possible mods, then, to a fixpoint, the tags of every row the pool
    // itself admits, since a reforge lays its rolls down one after another and a
    // later roll sees the tags of an earlier one. A maybe tag only ever admits,
    // so the closure is monotone. (The set views scan the allocated variables;
    // asking per type would allocate one per possible type and flood the BDD.)
    const maybeTags = new Set<TagId>();
    const guaranteed = guaranteedTypes(a);
    const excluded = excludedTypes(a);
    for (const t of a.possible) {
        if (guaranteed.has(t) || excluded.has(t)) continue;
        for (const tag of registry.addsTagsOfType(t)) maybeTags.add(tag);
    }
    let candidates = pool(registry.catalog, facts, maybeTags);
    for (;;) {
        const before = maybeTags.size;
        for (const c of candidates) for (const tag of c.mod.addsTags) maybeTags.add(tag);
        if (maybeTags.size === before) break;
        candidates = pool(registry.catalog, facts, maybeTags);
    }
    return candidates.map((c) => c.mod);
}

/**
 * Under-approximate the mods a draw could introduce on a path holding `prefixCount`
 * prefixes and `suffixCount` suffixes: the pool as if every possibly present
 * modifier were present (its type, its groups, its restrictions), with the
 * tags it may add read pessimistically. A subset of that path's real pool, so
 * an empty one means the draw is empty there.
 */
function subsetMods(a: AItem, registry: Registry, prefixCount: number, suffixCount: number): Mod[] {
    const facts = guaranteedFacts(a, registry);
    const types = new Set(facts.types);
    const families = new Set(facts.families);
    const effects = [...facts.effects];
    const maybeTags = new Set<TagId>();
    for (const t of a.possible) {
        if (isExcluded(a, t) || types.has(t)) continue;
        types.add(t);
        for (const f of registry.familiesOfType(t)) families.add(f);
        for (const tag of registry.addsTagsOfType(t)) maybeTags.add(tag);
        effects.push(...registry.effectsOfType(t));
    }
    return pool(
        registry.catalog,
        { ...facts, prefixCount, suffixCount, types, families, effects },
        maybeTags,
        true,
    ).map((c) => c.mod);
}

/** The (prefix, suffix) pairs the counts allow: a count enumeration over two
 *  small ranges, never a listing of outcomes. */
function sidePairs(a: AItem): [number, number][] {
    const pairs: [number, number][] = [];
    const [t0, t1] = a.counts.total;
    const [p0, p1] = a.counts.prefix;
    const [s0, s1] = suffixRange(a);
    for (let p = p0; p <= p1; p++) {
        for (let t = t0; t <= t1; t++) {
            const s = t - p;
            if (s >= s0 && s <= s1) pairs.push([p, s]);
        }
    }
    return pairs;
}

/** The state's guaranteed mods as the facts the pool reads, at rare caps. */
function guaranteedFacts(a: AItem, registry: Registry, level = a.ilvl): ItemFacts {
    const types = guaranteedTypes(a);
    const families = new Set<GroupId>();
    const tags = new Set(a.base.tags);
    let prefixCount = 0;
    let suffixCount = 0;
    for (const t of types) {
        if (genOf(a, registry, t) === "prefix") prefixCount++;
        else suffixCount++;
        for (const f of registry.familiesOfType(t)) families.add(f);
        for (const tag of registry.addsTagsOfType(t)) tags.add(tag);
    }
    return {
        base: a.base,
        ilvl: level,
        rarity: "rare",
        prefixCount,
        suffixCount,
        types,
        families,
        tags,
        effects: activeEffects(a, registry),
    };
}
