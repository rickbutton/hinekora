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
import type { ClassId, Gen, GroupId, ModId, Rarity, TagId, TypeId } from "../model/ids.js";
import type { ItemFacts } from "../model/item.js";
import type { Mod } from "../model/mod.js";
import type { EssenceSpec } from "../model/sources.js";
import { VEILED_PREFIX, VEILED_SUFFIX } from "../model/veiled.js";
import { pool } from "../pool/pool.js";
import { veiledPool } from "../pool/veiled.js";
import type { Registry } from "../resolve/registry.js";
import { rollableGen } from "../resolve/tiers.js";
import {
    type AItem,
    type Range,
    admitAdd,
    assertFractureDisjunction,
    canBeRare,
    excludedTypes,
    fractureProjection,
    fracturedTypes,
    guaranteedTypes,
    hasFracture,
    isExcluded,
    maxTotal,
    presenceFacts,
    settled,
    sideCap,
    suffixRange,
} from "./astate.js";
import { CountDomain } from "./counts.js";

// --- the operations --------------------------------------------------------

/** A pool: which rows a `fill` draws from, resolved against the state it runs on. */
export type PoolSpec =
    /** The natural pool of the base at the item's level, optionally capped lower. */
    | { readonly kind: "natural"; readonly maxLevel?: number }
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
    | { readonly kind: "unveil"; readonly target?: TypeId };

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

/** Which present modifiers a `remove` may reach. */
export interface Selector {
    /** Only the Orb of Annulment honours a cannot-roll metamod's shield. */
    readonly honourCannotRoll: boolean;
}

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
    | { readonly kind: "noVeiled" }
    | { readonly kind: "noBlockingMetamod" }
    | { readonly kind: "essenceRarity"; readonly tier: number }
    | { readonly kind: "essenceGrant"; readonly spec: EssenceSpec }
    | { readonly kind: "craftedBelowCap" }
    | { readonly kind: "noGroupConflict"; readonly mod: Mod }
    | { readonly kind: "poolNonEmpty"; readonly pool: PoolSpec; readonly tag: TagId }
    | { readonly kind: "unveilTarget"; readonly type: TypeId; readonly name: string };

export type Op =
    | { readonly kind: "require"; readonly check: Check }
    /** Every modifier goes but the protected sides' and the fractured one. */
    | { readonly kind: "strip" }
    | { readonly kind: "fill"; readonly pool: PoolSpec; readonly count: FillCount }
    | { readonly kind: "remove"; readonly selector: Selector }
    | { readonly kind: "rarity"; readonly rarity: Rarity | "lowest" }
    /** One random present modifier becomes fractured. */
    | { readonly kind: "lock" };

/** Why an operation's precondition fails on the current state. */
export type PreconditionFailure =
    | { readonly kind: "wrongRarity"; readonly needed: Rarity; readonly actual: Rarity }
    | { readonly kind: "noOpenSlot"; readonly gen?: Gen }
    | { readonly kind: "modConflict"; readonly group: string }
    | { readonly kind: "nothingToRemove" }
    | { readonly kind: "essenceRarity"; readonly tier: number; readonly actual: Rarity }
    | { readonly kind: "essenceClass"; readonly essence: string; readonly itemClass: ClassId }
    | { readonly kind: "rarityUnsupported"; readonly rarity: Rarity }
    | { readonly kind: "craftedLimit"; readonly cap: number }
    | { readonly kind: "harvestEmptyPool"; readonly tag: TagId }
    | { readonly kind: "metamodBlocks" }
    | { readonly kind: "tooFewMods"; readonly needed: number }
    | { readonly kind: "alreadyFractured" }
    | { readonly kind: "noVeiledMod" }
    | { readonly kind: "alreadyVeiled" }
    | { readonly kind: "unveilNotAvailable"; readonly mod: string }
    | { readonly kind: "unveilNotGuaranteed"; readonly mod: string; readonly options: number }
    | { readonly kind: "scourRarityUnknown"; readonly lower: Rarity; readonly upper: Rarity };

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
            return removeOne(a, allowedGens(rules), shieldFor(op.selector, rules), registry);
        case "rarity":
            return settled({
                ...a,
                rarity: op.rarity === "lowest" ? lowestRarity(a0, rules, registry) : op.rarity,
            });
        case "lock":
            return lock(a);
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

/** The generations a removal may draw from: both, minus the protected ones. */
function allowedGens(rules: Rules): ReadonlySet<Gen> {
    return new Set(ALL_GENS.filter((g) => !rules.protected.has(g)));
}

function shieldFor(selector: Selector, rules: Rules): Shield | null {
    return selector.honourCannotRoll ? rules.cannotRoll : null;
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
            return a.rarity === check.rarity
                ? null
                : { kind: "wrongRarity", needed: check.rarity, actual: a.rarity };
        case "canBeRare":
            return canBeRare(a.base) ? null : { kind: "rarityUnsupported", rarity: "rare" };
        case "openSlot":
            return hasOpenSlot(a, check.gen)
                ? null
                : check.gen === undefined
                  ? { kind: "noOpenSlot" }
                  : { kind: "noOpenSlot", gen: check.gen };
        case "removable":
            return hasRemovable(a, allowedGens(rules), shieldFor(check.selector, rules), registry)
                ? null
                : { kind: "nothingToRemove" };
        case "strippable": {
            // A Magic base with zero affixes (a magic Simplex) still drops to Normal,
            // so rarity, not mod count, is the gate; both sides protected and no
            // fractured mod means nothing would go.
            if (a.rarity === "normal") return { kind: "nothingToRemove" };
            if (rules.protected.size === ALL_GENS.length && !hasFracture(a)) {
                return { kind: "nothingToRemove" };
            }
            // The rarity the scour leaves is one value; when the kept side's count
            // is uncertain it may be either of two, so the scour waits for a
            // narrowing of the count.
            const kept = keptBounds(a, rules, registry);
            const unprovenLock = hasFracture(a) && fracturedTypes(a).size === 0;
            const lower = rarityFor(kept.prefix[0], kept.suffix[0], unprovenLock);
            const upper = rarityFor(kept.prefix[1], kept.suffix[1], unprovenLock);
            if (lower !== upper) return { kind: "scourRarityUnknown", lower, upper };
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
        case "noBlockingMetamod":
            return rules.blocksSourced ? { kind: "metamodBlocks" } : null;
        case "essenceRarity":
            // Normal always, Rare only for ladder tier ≥ 5, never Magic.
            return a.rarity === "magic" || (a.rarity === "rare" && check.tier < 5)
                ? { kind: "essenceRarity", tier: check.tier, actual: a.rarity }
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
        case "poolNonEmpty":
            // Read from the add-pool, which over-approximates: a tagged pool a
            // possibly present mod would empty is not caught; a subset pool would.
            return resolvePool(a, check.pool, registry).types.length > 0
                ? null
                : { kind: "harvestEmptyPool", tag: check.tag };
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
    if (a.counts.total[1] >= maxTotal(a.rarity, a.base)) return false; // full in some arm
    if (gen === "prefix") return a.counts.prefix[1] < sideCap("prefix", a.rarity, a.base);
    if (gen === "suffix") return suffixRange(a)[1] < sideCap("suffix", a.rarity, a.base);
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
        if (guaranteed.has(type) || !shares(type)) continue;
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
function mayHaveVeiled(a: AItem, registry: Registry): boolean {
    for (const t of a.possible) {
        if (isExcluded(a, t)) continue;
        if (t === VEILED_PREFIX || t === VEILED_SUFFIX) return true;
        // Many unveiled rows share their type with natural rows, so the rows the
        // type may be (its tier overlay, else every row) decide, not the first row.
        if (rowsOf(a, t, registry).some((m) => m.source === "veiled")) return true;
    }
    return false;
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
 * Counts fall to what is kept; guarantees, tier pins and `possible` survive only
 * for kept types; exclusions stay (nothing is added); the fracture facts are
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
    // With a kept side the unproven lock may sit on one of its mods, so it adds
    // to the floor only what the kept side cannot already account for.
    const total: Range = [
        keep.size === 0
            ? keptPrefix[0] + keptSuffix[0] + unprovenLock
            : Math.max(keptPrefix[0] + keptSuffix[0], unprovenLock),
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

/** The lowest rarity whose per-side caps hold `p` prefixes and `s` suffixes:
 *  none → Normal, at most one each → Magic, otherwise Rare (Orb of Scouring);
 *  an unproven lock keeps one mod, so never Normal. */
function rarityFor(p: number, s: number, unprovenLock: boolean): Rarity {
    if (p + s === 0) return unprovenLock ? "magic" : "normal";
    if (p <= 1 && s <= 1) return "magic";
    return "rare";
}

/** The rarity a scour leaves: the lowest that holds what the strip keeps. The
 *  rarity is one value, so the kept bounds must agree (`strippable` refuses the
 *  scour when they do not); this reads the upper bound. */
function lowestRarity(a0: AItem, rules: Rules, registry: Registry): Rarity {
    const kept = keptBounds(a0, rules, registry);
    const unprovenLock = hasFracture(a0) && fracturedTypes(a0).size === 0;
    return rarityFor(kept.prefix[1], kept.suffix[1], unprovenLock);
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
            const mods = addableMods(a, registry).filter((m) => m.minLevel <= cap);
            return { mods, types: typesOf(mods), assert: [], gen: undefined };
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
    const maxT = maxTotal(a.rarity, a.base);
    const pCap = sideCap("prefix", a.rarity, a.base);
    const sCap = sideCap("suffix", a.rarity, a.base);
    // Nothing fits on any path (a magic Simplex): the fill lays down nothing.
    if (count.kind === "add" && a.counts.total[0] >= maxT) return settled(a);

    const drawn = resolvePool(a, spec, registry);
    const one = drawn.mods.length === 1 ? drawn.mods[0] : undefined;

    let counts = a.counts;
    switch (count.kind) {
        case "add": {
            const [lo, hi] = count.n;
            const total: Range = [
                Math.min(a.counts.total[0] + lo, maxT),
                Math.min(a.counts.total[1] + hi, maxT),
            ];
            const prefix: Range =
                drawn.gen === "prefix"
                    ? [a.counts.prefix[0] + lo, Math.min(a.counts.prefix[1] + hi, pCap)]
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
    if (count.kind === "add" && spec.kind === "bench") {
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
function addableMods(a: AItem, registry: Registry): Mod[] {
    const facts = guaranteedFacts(a, registry);
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

/** The state's guaranteed mods as the facts the pool reads, at rare caps. */
function guaranteedFacts(a: AItem, registry: Registry): ItemFacts {
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
        ilvl: a.ilvl,
        rarity: "rare",
        prefixCount,
        suffixCount,
        types,
        families,
        tags,
        effects: activeEffects(a, registry),
    };
}
