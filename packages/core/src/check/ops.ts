/**
 * The primitive operations (operations.md §2) and their interpreter. The
 * protections in force are read once, when the method is applied, and govern
 * every operation in it: a reforge that rerolls the carrier of "prefixes cannot
 * be changed" still keeps the prefixes. A cannot-roll metamod restricts a pool
 * only while its carrier is on the item the fill draws for, so one the strip
 * removed restricts nothing (Metamod § Rules and Exceptions, the Chaos Orb's
 * "when used with Suffixes Cannot Be Changed").
 */
import { holdsFour } from "../model/capacity.js";
import { craftedCapOf, type Effect } from "../model/effects.js";
import { dropValues, keepValues } from "./values.js";
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
import {
    dominantOf,
    type EldritchKey,
    type EldritchSide,
    eldritchKey,
    eldritchOf,
    type Influence,
    type InfluenceKey,
    influenceKey,
    influenceOfTag,
    influenceSetsOfSize,
    influencesOf,
    NO_ELDRITCH,
    NO_INFLUENCE,
} from "../model/marks.js";
import type { Mod } from "../model/mod.js";
import type { EssenceSpec, FossilSpec } from "../model/sources.js";
import { FOULBORN_AS_STRANDS } from "../model/strands.js";
import { VEILED_PREFIX, VEILED_SUFFIX } from "../model/veiled.js";
import { lookupWeight, pool } from "../pool/pool.js";
import { veiledPool } from "../pool/veiled.js";
import type { Registry } from "../resolve/registry.js";
import { rollableGen } from "../resolve/tiers.js";
import {
    admitAdd,
    assertFractureDisjunction,
    assertOneRemovedAmong,
    canBeRare,
    capsOver,
    excludedTypes,
    forgetTypes,
    fracturedTypes,
    fractureProjection,
    guaranteedTypes,
    isExcluded,
    join,
    presenceFacts,
    rarityOf,
    refine,
    relaxTiers,
    settled,
    suffixRange,
    unprovenFractures,
    type AItem,
    type Range,
} from "./astate.js";
import type { Bdd } from "./bdd.js";
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
    | { readonly kind: "essenceGrant"; readonly spec: EssenceSpec }
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
          /** Rows with no category tag are out too (the Opulent Fossil). */
          readonly noTagless: boolean;
          readonly added: readonly Mod[];
          readonly essence: readonly Mod[];
          /** The fossils socketed, for the weights they give the rows (the
           *  cost layer reads them; the checker reads only the tags above). */
          readonly fossils: readonly FossilSpec[];
      }
    /** One of these rows, guaranteed: a fossil's forced row, the Glyphic Fossil's
     *  corrupted-essence modifier. */
    | {
          readonly kind: "rows";
          readonly mods: readonly Mod[];
          /** The type these rows replace (a Harvest change); if it may be a
           *  crafted modifier, so may they (QUESTIONS.md Q52). */
          readonly replacing?: TypeId;
      }
    /** One of the metamods not yet on the item whose side may have a slot (the
     *  Bestiary's random metamod); crafted. */
    | { readonly kind: "metamods" }
    /** The rows the item's influences admit and nothing else would: what an
     *  influence orb or the grove's influence reforge guarantees one of. */
    | { readonly kind: "influence" };

/** How many modifiers a `fill` lays down. */
export type FillCount =
    /** `n` more modifiers, on top of what is present, clamped to the caps. */
    | { readonly kind: "add"; readonly n: Range }
    /** A reforge: the total lands in `n` when no side was kept; with a kept side
     *  the rerolled side takes any number up to its cap and open kept-side slots
     *  may fill (Metamod § Rules and Exceptions: "0 to 3 suffixes"). `n` may be
     *  left to the item's rarity: none on Normal, one or two on Magic, four to
     *  six on Rare, the loosest over the rarities the item may have. A rare
     *  count on a base whose Rare holds four is three or four (`rareCountOn`). */
    | { readonly kind: "reforge"; readonly n: Range | "byRarity" }
    /** One of the modifiers already counted: an essence's grant, a harvest
     *  reforge's tagged modifier, a veiled chaos's placeholder, an unveil. */
    | { readonly kind: "within" };

/** Which present modifiers a removal may reach. */
export type Selector =
    /** One random modifier, of one side when `gen` is given; only the Orb of
     *  Annulment honours a cannot-roll metamod's shield. A side-limited removal
     *  whose side is protected is skipped rather than refused (Metamod § Rules
     *  and Exceptions: "will add without removing"). */
    | {
          readonly kind: "random";
          readonly honourCannotRoll: boolean;
          readonly gen?: Gen;
          /** The pool the method filled from just before: the modifier that fill
           *  laid down is out of the removal's reach ("remove another"). */
          readonly sparing?: PoolSpec;
      }
    /** The crafted modifiers the bench can clear; a fractured one stays. When
     *  `replacing`, only under a limit of one: a craft replaces the single crafted
     *  modifier, while under the multimod it adds beside them (Crafting Bench §
     *  Using the crafting bench). */
    | { readonly kind: "crafted"; readonly replacing: boolean }
    /** Exactly this modifier (a harvest change). */
    | { readonly kind: "type"; readonly type: TypeId }
    /** One of the item's influenced modifiers on an unprotected side (the Orb
     *  of Dominance); the other modifiers' guarantees survive. */
    | { readonly kind: "influenced" };

/** A check a `require` must prove on every path. */
export type Check =
    | { readonly kind: "rarity"; readonly rarity: Rarity }
    | { readonly kind: "notMagic" }
    | { readonly kind: "notNormal" }
    | { readonly kind: "canBeRare" }
    | { readonly kind: "openSlot"; readonly gen?: Gen }
    | { readonly kind: "removable"; readonly selector: Selector }
    /** Something to strip: not Normal, and not every side protected. */
    | { readonly kind: "strippable" }
    /** `what` names the craft when it is not the Fracturing Orb. */
    | { readonly kind: "atLeast"; readonly count: number; readonly what?: string }
    /** No fractured modifier on any path; `what` says, for a craft that is not
     *  itself a fracture, why it refuses one. */
    | { readonly kind: "noFracture"; readonly what?: string }
    /** The item is not corrupted on any path; every method but the Tainted
     *  currency and an unveil requires it (Corrupted § Modifying corrupted items). */
    | { readonly kind: "notCorrupted" }
    /** The item is corrupted on every path (the Tainted currency). */
    | { readonly kind: "corruptedItem"; readonly what: string }
    /** The item has no influence on any path (a fracture, an influence orb). */
    | { readonly kind: "noInfluence"; readonly what: string }
    /** The item has no eldritch implicit on any path (an influence orb). */
    | { readonly kind: "noEldritch"; readonly what: string }
    /** That eldritch implicit is dominant on every path (the Eldritch orbs). */
    | { readonly kind: "dominant"; readonly side: EldritchSide; readonly what: string }
    /** Both eldritch implicits are present on every path (an Orb of Conflict). */
    | { readonly kind: "bothEldritch" }
    /** That side is not protected by a metamod (an Eldritch Orb of Annulment
     *  would otherwise remove nothing). */
    | { readonly kind: "unprotectedSide"; readonly gen: Gen; readonly what: string }
    /** At least that many influenced modifiers are guaranteed on unprotected
     *  sides (the Orb of Dominance). */
    | { readonly kind: "influencedAtLeast"; readonly count: number }
    /** The item is influenced on every path, with that influence when one is named. */
    | { readonly kind: "influenced"; readonly what: string; readonly influence?: Influence }
    /** The item's class can carry that influence (a jewel or a flask cannot). */
    | { readonly kind: "influenceable"; readonly influence: Influence; readonly what: string }
    /** No modifier that may sit on a protected side is an influence modifier
     *  (the grove's randomise under "cannot be changed", Metamod § Rules and
     *  Exceptions). */
    | { readonly kind: "noInfluencedOnProtected"; readonly what: string }
    | { readonly kind: "veiledPresent" }
    /** No veiled or unveiled modifier at all (the Veiled Exalted Orb). */
    | { readonly kind: "noVeiled" }
    /** No veiled or unveiled modifier the strip would keep (the Veiled Chaos Orb
     *  reforges the rest away). */
    | { readonly kind: "noVeiledKept" }
    | { readonly kind: "noBlockingMetamod" }
    /** The modifier is guaranteed present, not fractured, and on an unprotected side. */
    | { readonly kind: "typeRemovable"; readonly type: TypeId; readonly label: string }
    | { readonly kind: "hasImprint" }
    /** The Bestiary imprints a Magic item or a Rare talisman. */
    | { readonly kind: "imprintable" }
    /** Some metamod fits the item (the Bestiary's random metamod). */
    | { readonly kind: "metamodFits" }
    /** The base carries the tag (a talisman for the Bestiary fractures). */
    | { readonly kind: "baseHasTag"; readonly tag: TagId; readonly what: string }
    /** The base carries one of the tags (the Corruption Altar's item types). */
    | { readonly kind: "baseHasAnyTag"; readonly tags: readonly TagId[]; readonly what: string }
    | { readonly kind: "minItemLevel"; readonly level: number; readonly what: string }
    | { readonly kind: "fossilAllowed"; readonly fossil: FossilSpec }
    | { readonly kind: "essenceRarity"; readonly tier: number }
    | { readonly kind: "essenceGrant"; readonly spec: EssenceSpec }
    /** `refusal` words what cannot be done at the limit, for a craft off the bench. */
    | { readonly kind: "craftedBelowCap"; readonly refusal?: string }
    /** A crafted modifier the bench can remove is present on every path. */
    | { readonly kind: "craftedRemovable" }
    /** A craft that would replace the crafted modifier can: it is not fractured. */
    | { readonly kind: "craftedReplaceable" }
    /** No modifier of the row's group may be present; `refusal` words what
     *  cannot be done then, for a craft that is not a bench craft. */
    | { readonly kind: "noGroupConflict"; readonly mod: Mod; readonly refusal?: string }
    | { readonly kind: "poolNonEmpty"; readonly pool: PoolSpec; readonly tag: TagId }
    | { readonly kind: "unveilTarget"; readonly type: TypeId; readonly name: string };

export type Op =
    | { readonly kind: "require"; readonly check: Check }
    /** Every modifier goes but the protected sides' and the fractured one. */
    | { readonly kind: "strip" }
    /** The metamods no longer govern the rest of the method (a Tainted Chaos
     *  Orb ignores them, `QUESTIONS.md` Q33). */
    | { readonly kind: "unprotect" }
    /** That side alone is kept through the rest of the method, in place of
     *  the item's own protections (an Eldritch Chaos Orb rerolls the other). */
    | { readonly kind: "keep"; readonly gen: Gen }
    /** Change the eldritch mark: one implicit set to a tier, or an Orb of
     *  Conflict's raise-one-lower-the-other. */
    | { readonly kind: "eldritch"; readonly change: EldritchChange }
    /** One of several outcomes: the join of running each branch, which holds
     *  effects only (a check or an `unprotect` belongs before it, at method
     *  level). A branch of `end` alone is an outcome on which the item is gone
     *  and the craft stops, so it adds nothing to the join; some branch must
     *  survive, since no method in the library ends on every outcome. */
    | { readonly kind: "either"; readonly branches: readonly (readonly Transform[])[] }
    | { readonly kind: "end" }
    | { readonly kind: "corrupt" }
    /** Forget which tier each present modifier is; a crafted one keeps its tier
     *  when `crafted` is false. */
    | { readonly kind: "relax"; readonly crafted: boolean }
    /** Every present modifier's value is rolled again within its tier, the
     *  fractured ones excepted (the Divine Orb). */
    | { readonly kind: "reroll" }
    /** One influenced modifier went up a tier, or to its elevated row at the
     *  top (the Orb of Dominance). */
    | { readonly kind: "elevate" }
    /** Change the influence mark: to one set, by adding an influence to every
     *  possible set, or to every set of the same size (the grove's randomise). */
    | { readonly kind: "influence"; readonly change: InfluenceChange }
    | { readonly kind: "fill"; readonly pool: PoolSpec; readonly count: FillCount }
    | { readonly kind: "remove"; readonly selector: Selector }
    /** `survivors`: the rarity a scour leaves, by how many modifiers remain.
     *  `lowest`: that, or the lowest rarity that holds them (a Tainted Chaos
     *  Orb's strip, `QUESTIONS.md` Q33). */
    | { readonly kind: "rarity"; readonly rarity: Rarity | "survivors" | "lowest" }
    /** `n` random present modifiers become fractured. */
    | { readonly kind: "lock"; readonly n: number }
    /** A list `consume` is indexed by the modifier count before the method, its
     *  last entry standing for every count beyond it. */
    | { readonly kind: "strands"; readonly consume: number | readonly number[] }
    | { readonly kind: "imprint" }
    /** Replace the item with the held imprint, consuming it. */
    | { readonly kind: "restore" };

/** An operation that changes the state: everything but a check or a rule change. */
export type Transform = Exclude<Op, { kind: "require" | "unprotect" | "keep" }>;

export type EldritchChange =
    /** That implicit set to a tier, one of `types` (the ember's pool). */
    | {
          readonly kind: "set";
          readonly side: EldritchSide;
          readonly tier: number;
          readonly types: readonly TypeId[];
      }
    /** One implicit up a tier, the other down; a Lesser lowered is removed
     *  (Orb of Conflict). */
    | { readonly kind: "conflict" }
    /** A corruption implicit replaces one of the item's implicits (a Vaal Orb)
     *  or two (the Corruption Altar): that many eldritch implicits may go. */
    | { readonly kind: "replaced"; readonly count: 1 | 2 };

export type InfluenceChange =
    | { readonly kind: "set"; readonly key: InfluenceKey }
    | { readonly kind: "add"; readonly influence: Influence }
    /** Every set of the size the item has (the grove's randomise). */
    | { readonly kind: "randomise" }
    /** Any one influence, whatever the item had (the Corruption Altar). */
    | { readonly kind: "anyOne" };

/** Why an operation's precondition fails on the current state. */
export type PreconditionFailure =
    | {
          readonly kind: "wrongRarity";
          readonly needed: Rarity;
          readonly actual: ReadonlySet<Rarity>;
      }
    | { readonly kind: "noOpenSlot"; readonly gen?: Gen; readonly normal?: true }
    | { readonly kind: "magicRefused"; readonly actual: ReadonlySet<Rarity> }
    | { readonly kind: "normalRefused"; readonly actual: ReadonlySet<Rarity> }
    | {
          readonly kind: "modConflict";
          readonly group: string;
          /** The other modifiers of the group the item may carry, named so a guide
           *  can rule them out one by one. */
          readonly among: readonly string[];
          /** What cannot be done then, when it is not a bench craft. */
          readonly refusal?: string;
      }
    | { readonly kind: "nothingToRemove" }
    | {
          readonly kind: "essenceRarity";
          readonly tier: number;
          readonly actual: ReadonlySet<Rarity>;
      }
    | { readonly kind: "essenceClass"; readonly essence: string; readonly itemClass: ClassId }
    | { readonly kind: "rarityUnsupported"; readonly rarity: Rarity }
    | { readonly kind: "craftedLimit"; readonly cap: number; readonly refusal?: string }
    | { readonly kind: "noCraftedToRemove" }
    | { readonly kind: "craftedFractured" }
    | { readonly kind: "craftedMultiple" }
    | { readonly kind: "craftedCapUnknown" }
    | { readonly kind: "harvestEmptyPool"; readonly tag: TagId }
    | { readonly kind: "harvestNoRoom"; readonly tag: TagId }
    | { readonly kind: "harvestBlocked"; readonly tag: TagId }
    /** Every tagged row is one a cannot-roll metamod on the item bars. */
    | { readonly kind: "harvestCannotRoll"; readonly tag: TagId }
    | { readonly kind: "metamodBlocks" }
    | { readonly kind: "fossilBaseRestricted"; readonly fossil: string }
    | { readonly kind: "wrongBase"; readonly needed: string }
    | { readonly kind: "itemLevelTooLow"; readonly level: number; readonly what: string }
    | { readonly kind: "noMetamodFits" }
    | { readonly kind: "noImprint" }
    | { readonly kind: "notImprintable" }
    | {
          readonly kind: "typeNotRemovable";
          readonly mod: string;
          readonly why: "absent" | "fractured" | "protected";
      }
    | { readonly kind: "tooFewMods"; readonly needed: number; readonly what?: string }
    | { readonly kind: "alreadyFractured"; readonly sure: boolean; readonly what?: string }
    | { readonly kind: "corrupted"; readonly sure: boolean }
    | { readonly kind: "notCorruptedItem"; readonly what: string; readonly sure: boolean }
    | { readonly kind: "influenced"; readonly what: string; readonly sure: boolean }
    | {
          readonly kind: "notInfluenced";
          readonly what: string;
          readonly influence?: Influence;
          readonly sure: boolean;
      }
    | { readonly kind: "notInfluenceable"; readonly influence: Influence; readonly what: string }
    | { readonly kind: "eldritchPresent"; readonly what: string; readonly sure: boolean }
    | { readonly kind: "notDominant"; readonly side: EldritchSide; readonly what: string }
    | { readonly kind: "notBothEldritch"; readonly sure: boolean }
    | { readonly kind: "sideProtected"; readonly gen: Gen; readonly what: string }
    | { readonly kind: "tooFewInfluenced"; readonly needed: number; readonly have: number }
    | { readonly kind: "influencedOnProtected"; readonly what: string; readonly gen: Gen }
    | { readonly kind: "noVeiledMod" }
    | { readonly kind: "alreadyVeiled" }
    | { readonly kind: "veiledWouldSurvive" }
    | { readonly kind: "unveilNotAvailable"; readonly mod: string }
    | { readonly kind: "unveilNotGuaranteed"; readonly mod: string; readonly options: number };

export type TransferResult =
    | { readonly ok: true; readonly state: AItem }
    | {
          readonly ok: false;
          readonly failure: PreconditionFailure;
          readonly state: AItem;
          /** The possibly present metamods the item must carry for the method to
           *  be refused, when it goes through without them. */
          readonly under?: readonly TypeId[];
      };

/**
 * On a failed `require`, the state returned is the one the method leaves where
 * its preconditions hold, not the input (operations.md §2).
 *
 * A metamod that may or may not be on the item changes what the method does,
 * so the method runs once per case (`metamodCases`) and the results are
 * joined: a check must hold in every case, and the state is what any of them
 * leaves.
 */
export function runMethod(a0: AItem, ops: readonly Op[], registry: Registry): TransferResult {
    let state: AItem | undefined;
    let failed: { failure: PreconditionFailure; under: readonly TypeId[] } | undefined;
    let passed = false;
    for (const c of metamodCases(a0, registry)) {
        const r = runCase(c.state, ops, registry);
        state = state === undefined ? r.state : join(state, r.state);
        if (r.ok) passed = true;
        else failed ??= { failure: r.failure, under: c.present };
    }
    state ??= a0;
    if (failed === undefined) return { ok: true, state };
    return {
        ok: false,
        failure: failed.failure,
        state,
        ...(passed && failed.under.length > 0 && { under: failed.under }),
    };
}

interface MetamodCase {
    readonly state: AItem;
    /** The possibly present carriers this case takes as present. */
    readonly present: readonly TypeId[];
}

/**
 * The item split by which of its possibly present protecting and cannot-roll
 * metamods it carries: in each case every such carrier is guaranteed or
 * excluded, so the rules read off the guaranteed types are that case's rules.
 * The case with none of them comes first. At most four carriers split (the
 * multimod's limit is read where the bench needs it, `mayCarryCraftedCap`),
 * and a case holding more crafted modifiers than the item can is dropped.
 */
function metamodCases(a: AItem, registry: Registry): readonly MetamodCase[] {
    const guaranteed = guaranteedTypes(a);
    const uncertain = [...a.possible].filter(
        (t) =>
            !guaranteed.has(t) &&
            registry.effectsOfType(t).some((e) => e.kind !== "craftedCap") &&
            !isExcluded(a, t) &&
            mayBePresentUnnamed(a, registry, t),
    );
    let cases: MetamodCase[] = [{ state: a, present: [] }];
    for (const type of uncertain) {
        const has = { kind: "has", type, gen: genOf(a, registry, type) } as const;
        const next: MetamodCase[] = [];
        for (const c of cases) {
            const without = refine(c.state, has, false);
            if (without !== null) next.push({ state: without, present: c.present });
        }
        for (const c of cases) {
            const present = refine(c.state, has, true);
            const withIt = present === null ? null : holdingItsNamed(present, registry);
            if (withIt !== null && sureCrafted(withIt, registry) <= withIt.crafted[1]) {
                next.push({ state: withIt, present: [...c.present, type] });
            }
        }
        cases = next;
    }
    // No case left means the state itself is contradictory; run it as it is.
    return cases.length > 0 ? cases : [{ state: a, present: [] }];
}

/** The state with each side holding at least the guaranteed modifiers that sit
 *  only there, or null when the counts cannot: a carrier taken as present
 *  fills a slot of its side, which decides what a kept side holds. */
function holdingItsNamed(a: AItem, registry: Registry): AItem | null {
    let s: AItem | null = a;
    for (const gen of ALL_GENS) {
        let named = 0;
        for (const t of guaranteedTypes(a)) {
            const sides = sidesOf(a, registry, t);
            if (sides.size === 1 && sides.has(gen)) named++;
        }
        if (s === null || named === 0) continue;
        s = refine(s, {
            kind: "compare",
            projection: gen === "prefix" ? "prefixCount" : "suffixCount",
            op: ">=",
            value: named,
        });
    }
    return s;
}

function runCase(a0: AItem, ops: readonly Op[], registry: Registry): TransferResult {
    let rules = rulesInForce(a0, registry, ops);
    let a = a0;
    let failure: PreconditionFailure | null = null;
    for (const op of ops) {
        if (op.kind === "require") {
            failure ??= failing(a, op.check, rules, registry);
            continue;
        }
        if (op.kind === "unprotect") {
            rules = { ...rules, protected: new Set(), cannotRoll: null };
            continue;
        }
        if (op.kind === "keep") {
            // The kept side replaces the item's own protections, which the
            // method ignores (Metamod § Rules and Exceptions: the Eldritch Chaos
            // Orb ignores "cannot be changed", respects "cannot roll").
            rules = { ...rules, protected: new Set([op.gen]) };
            continue;
        }
        a = apply(a, a0, op, rules, registry);
    }
    return failure === null ? { ok: true, state: a } : { ok: false, failure, state: a };
}

function apply(a: AItem, a0: AItem, op: Transform, rules: Rules, registry: Registry): AItem {
    switch (op.kind) {
        case "strip":
            return strip(a, rules, registry);
        case "influence": {
            const change = op.change;
            const influences = new Set<InfluenceKey>();
            for (const key of a.influences) {
                switch (change.kind) {
                    case "set":
                        influences.add(change.key);
                        break;
                    case "add":
                        influences.add(influenceKey([...influencesOf(key), change.influence]));
                        break;
                    case "randomise":
                        for (const k of influenceSetsOfSize(influencesOf(key).length)) {
                            influences.add(k);
                        }
                        break;
                    case "anyOne":
                        // What an already influenced item keeps is unsettled, so
                        // the sets the item had stay beside the six.
                        influences.add(key);
                        for (const k of influenceSetsOfSize(1)) influences.add(k);
                        break;
                }
            }
            return { ...a, influences };
        }
        case "fill":
            return fill(a, a0, op.pool, op.count, rules, registry);
        case "remove":
            switch (op.selector.kind) {
                case "crafted":
                    return removeCrafted(a, rules, registry, op.selector.replacing);
                case "type":
                    return removeType(a, op.selector.type, registry);
                case "random": {
                    const allowed = allowedFor(op.selector, rules);
                    if (allowed.size === 0 && op.selector.gen !== undefined) return a;
                    const shield = shieldFor(op.selector, rules);
                    return op.selector.sparing === undefined
                        ? removeOne(a, allowed, shield, registry)
                        : removeAnother(a, a0, op.selector.sparing, allowed, shield, registry);
                }
                case "influenced":
                    return removeOne(
                        a,
                        allowedFor(op.selector, rules),
                        influenceShield(a, registry),
                        registry,
                    );
            }
            break;
        case "elevate":
            return elevate(a, a0, rules, registry);
        case "rarity":
            return settled({
                ...a,
                rarities:
                    op.rarity === "survivors" || op.rarity === "lowest"
                        ? scouredRarities(a0, rules, registry, op.rarity === "lowest")
                        : new Set([op.rarity]),
            });
        case "lock":
            return lock(a, op.n);
        case "strands": {
            const most =
                typeof op.consume === "number"
                    ? op.consume
                    : (op.consume[Math.min(op.consume.length - 1, a0.counts.total[1])] ?? 0);
            return { ...a, strands: [Math.max(0, a.strands[0] - most), a.strands[1]] };
        }
        case "imprint": {
            const { imprint: _held, ...now } = a;
            return { ...a, imprint: now };
        }
        case "restore":
            // `hasImprint` ran first; a missing imprint here is unreachable.
            return a.imprint ?? a;
        case "either": {
            const outcomes: AItem[] = [];
            for (const branch of op.branches) {
                if (branch.some((o) => o.kind === "end")) continue;
                let s = a;
                for (const o of branch) s = apply(s, a0, o, rules, registry);
                outcomes.push(s);
            }
            return outcomes.reduce((x, y) => join(x, y), outcomes[0] ?? a);
        }
        case "end":
            return a;
        case "corrupt":
            return { ...a, corrupted: new Set([true]) };
        case "eldritch": {
            const change = op.change;
            const eldritch = new Set<EldritchKey>();
            // A wording never changes with the tier, so only an ember's draw
            // replaces what the side may be; an empty pool leaves it unknown.
            const eldritchTypes =
                change.kind === "set"
                    ? {
                          ...a.eldritchTypes,
                          [change.side]: change.types.length > 0 ? new Set(change.types) : "any",
                      }
                    : a.eldritchTypes;
            for (const key of a.eldritch) {
                const { exarch, eater } = eldritchOf(key);
                if (change.kind === "set") {
                    eldritch.add(
                        change.side === "exarch"
                            ? eldritchKey(change.tier, eater)
                            : eldritchKey(exarch, change.tier),
                    );
                    continue;
                }
                if (change.kind === "replaced") {
                    // Which implicit the corruption replaces is random, and an
                    // item with no implicit of its own only gains one.
                    eldritch.add(key);
                    if (change.count === 2) eldritch.add(NO_ELDRITCH);
                    else {
                        eldritch.add(eldritchKey(0, eater));
                        eldritch.add(eldritchKey(exarch, 0));
                    }
                    continue;
                }
                // The orb refuses an item without both implicits, so that path
                // keeps its pair. A lowered Lesser (tier 1) is removed (tier
                // 0); the raised one tops out at Perfect.
                if (exarch === 0 || eater === 0) {
                    eldritch.add(key);
                    continue;
                }
                eldritch.add(eldritchKey(Math.min(exarch + 1, 6), eater - 1));
                eldritch.add(eldritchKey(exarch - 1, Math.min(eater + 1, 6)));
            }
            return { ...a, eldritch, eldritchTypes };
        }
        case "reroll": {
            // A Divine Orb leaves a fractured modifier alone and respects a side
            // that cannot be changed (Metamod § Rules and Exceptions).
            const fractured = fracturedTypes(a);
            const untouched = (t: TypeId): boolean =>
                fractured.has(t) ||
                [...sidesOf(a, registry, t)].every((g) => rules.protected.has(g));
            return { ...a, values: keepValues(a.values, untouched) };
        }
        case "relax":
            // A modifier keeps its tier only when it is provably crafted: every
            // row it may be is a bench row. An unpinned type may be any row.
            return relaxTiers(a, (t) => {
                if (op.crafted) return true;
                const pinned = a.tiers.get(t);
                return (
                    pinned === undefined ||
                    !rowsOf(a, t, registry).every((m) => m.source === "bench")
                );
            });
    }
}

// --- the metamods in force ---------------------------------------------------
//
// A metamod's effect is active iff its carrier is on the item (item-model.md
// §6). The rules are read off the guaranteed types, which is exact because
// `runMethod` has split the item on every protecting or cannot-roll carrier
// that is only possibly present; reading such a carrier as absent would accept
// a reforge that the game answers by keeping a side.

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
    /** The method uses memory strands up (a currency orb, an essence), so its
     *  fills lay down only the tiers the strands allow; Harvest, the Bestiary
     *  and a resonator use none and are not cut (Memory strand § Crafting
     *  methods consuming memory strands). */
    readonly strands: boolean;
}

function rulesInForce(a: AItem, registry: Registry, ops: readonly Op[]): Rules {
    const effects = activeEffects(a, registry);
    const protectedGens = new Set<Gen>();
    for (const e of effects) if (e.kind === "protect") protectedGens.add(e.gen);
    return {
        protected: protectedGens,
        cannotRoll: cannotRollShield(a, effects, registry),
        craftedCap: craftedCapOf(effects),
        blocksSourced: effects.some((e) => e.kind === "protect" || e.kind === "poolRestrict"),
        strands: ops.some((op) => op.kind === "strands"),
    };
}

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
        case "notMagic":
            return a.rarities.has("magic") ? { kind: "magicRefused", actual: a.rarities } : null;
        case "notNormal":
            return a.rarities.has("normal") ? { kind: "normalRefused", actual: a.rarities } : null;
        case "canBeRare":
            return canBeRare(a.base) ? null : { kind: "rarityUnsupported", rarity: "rare" };
        case "openSlot": {
            if (hasOpenSlot(a, check.gen)) return null;
            // A Normal item has no slot at all, which is worth saying as such.
            const normal = a.rarities.size === 1 && a.rarities.has("normal");
            return {
                kind: "noOpenSlot",
                ...(check.gen !== undefined && { gen: check.gen }),
                ...(normal && { normal: true as const }),
            };
        }
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
        case "influencedAtLeast": {
            const have = [...guaranteedTypes(a)].filter(
                (t) =>
                    isInfluenceType(a, t, registry) && !rules.protected.has(genOf(a, registry, t)),
            ).length;
            return have >= check.count
                ? null
                : { kind: "tooFewInfluenced", needed: check.count, have };
        }
        case "craftedRemovable":
            // A guaranteed type that is only ever a bench row is a crafted
            // modifier, whatever the count's lower bound knows.
            return Math.max(a.crafted[0], sureCrafted(a, registry)) -
                fracturedCrafted(a, registry) >=
                1
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
            // so rarity, not mod count, is the gate. Both sides protected means
            // nothing would go, a fractured mod or not: a scour never takes one.
            // Whether the game refuses such a scour is QUESTIONS.md Q83.
            if (a.rarities.has("normal")) return { kind: "nothingToRemove" };
            if (rules.protected.size === ALL_GENS.length) return { kind: "nothingToRemove" };
            return null;
        }
        case "atLeast":
            return a.counts.total[0] >= check.count
                ? null
                : {
                      kind: "tooFewMods",
                      needed: check.count,
                      ...(check.what !== undefined && { what: check.what }),
                  };
        case "noFracture":
            // A fracture on any path refuses: the orb and the recipes take none.
            return a.fractures[1] > 0
                ? {
                      kind: "alreadyFractured",
                      sure: a.fractures[0] > 0,
                      ...(check.what !== undefined && { what: check.what }),
                  }
                : null;
        case "notCorrupted":
            return a.corrupted.has(true)
                ? { kind: "corrupted", sure: !a.corrupted.has(false) }
                : null;
        case "corruptedItem":
            return a.corrupted.has(false)
                ? { kind: "notCorruptedItem", what: check.what, sure: !a.corrupted.has(true) }
                : null;
        case "noInfluence":
            return a.influences.has(NO_INFLUENCE) && a.influences.size === 1
                ? null
                : { kind: "influenced", what: check.what, sure: !a.influences.has(NO_INFLUENCE) };
        case "influenced": {
            const wanted = check.influence;
            const holds = (key: InfluenceKey): boolean =>
                wanted === undefined ? key !== NO_INFLUENCE : influencesOf(key).includes(wanted);
            const keys = [...a.influences];
            if (keys.every(holds)) return null;
            return {
                kind: "notInfluenced",
                what: check.what,
                ...(wanted !== undefined && { influence: wanted }),
                sure: !keys.some(holds),
            };
        }
        case "influenceable":
            return registry.influenceTags(a.base, check.influence).size > 0
                ? null
                : { kind: "notInfluenceable", influence: check.influence, what: check.what };
        case "noEldritch":
            return a.eldritch.has(NO_ELDRITCH) && a.eldritch.size === 1
                ? null
                : { kind: "eldritchPresent", what: check.what, sure: !a.eldritch.has(NO_ELDRITCH) };
        case "dominant":
            return [...a.eldritch].every((k) => dominantOf(k) === check.side)
                ? null
                : { kind: "notDominant", side: check.side, what: check.what };
        case "bothEldritch": {
            const both = (k: EldritchKey): boolean => {
                const { exarch, eater } = eldritchOf(k);
                return exarch > 0 && eater > 0;
            };
            const keys = [...a.eldritch];
            return keys.every(both) ? null : { kind: "notBothEldritch", sure: !keys.some(both) };
        }
        case "unprotectedSide":
            return rules.protected.has(check.gen)
                ? { kind: "sideProtected", gen: check.gen, what: check.what }
                : null;
        case "noInfluencedOnProtected": {
            // Pessimistic: every modifier that may sit on a protected side must
            // be a known type that is no influence modifier, so a side holding
            // more than its guaranteed types may hold one and refuses.
            for (const gen of rules.protected) {
                const known = [...guaranteedTypes(a)].filter((t) => genOf(a, registry, t) === gen);
                const most = gen === "prefix" ? a.counts.prefix[1] : suffixRange(a)[1];
                if (most > known.length || known.some((t) => isInfluenceType(a, t, registry))) {
                    return { kind: "influencedOnProtected", what: check.what, gen };
                }
            }
            return null;
        }
        case "veiledPresent":
            return hasVeiledPlaceholder(a) ? null : { kind: "noVeiledMod" };
        case "noVeiled":
            return mayHaveVeiled(a, registry, undefined, true) ? { kind: "alreadyVeiled" } : null;
        case "noVeiledKept": {
            const fractured = fracturedTypes(a);
            const unprovenLock = unprovenFractures(a)[1] > 0;
            const kept = (t: TypeId): boolean =>
                unprovenLock || fractured.has(t) || rules.protected.has(sideOf(a, registry, t));
            return mayHaveVeiled(a, registry, kept) ? { kind: "veiledWouldSurvive" } : null;
        }
        case "typeRemovable": {
            const { type, label } = check;
            if (!guaranteedTypes(a).has(type))
                return { kind: "typeNotRemovable", mod: label, why: "absent" };
            const fractured = fracturedTypes(a);
            if (fractured.has(type) || unprovenFractures(a)[1] > 0) {
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
            return metamodFits(a, registry) ? null : { kind: "noMetamodFits" };
        case "baseHasTag":
            return a.base.tags.has(check.tag) ? null : { kind: "wrongBase", needed: check.what };
        case "baseHasAnyTag":
            return check.tags.some((t) => a.base.tags.has(t))
                ? null
                : { kind: "wrongBase", needed: check.what };
        case "minItemLevel":
            return a.ilvl >= check.level
                ? null
                : { kind: "itemLevelTooLow", level: check.level, what: check.what };
        case "fossilAllowed": {
            const allowed = check.fossil.allowedTags;
            if (allowed === undefined) return null;
            for (const t of a.base.tags) if (allowed.has(t)) return null;
            return { kind: "fossilBaseRestricted", fossil: check.fossil.name };
        }
        case "noBlockingMetamod":
            return rules.blocksSourced ? { kind: "metamodBlocks" } : null;
        case "essenceRarity":
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
                ? {
                      kind: "craftedLimit",
                      cap: rules.craftedCap,
                      ...(check.refusal !== undefined && { refusal: check.refusal }),
                  }
                : null;
        case "noGroupConflict": {
            const clashing = typesSharingFamilyWithPresent(a, check.mod, registry);
            return clashing.length > 0
                ? {
                      kind: "modConflict",
                      group: registry.typeLabel(check.mod.type),
                      among: clashing
                          .filter((t) => t !== check.mod.type)
                          .map((t) => registry.typeLabel(t)),
                      ...(check.refusal !== undefined && { refusal: check.refusal }),
                  }
                : null;
        }
        case "poolNonEmpty": {
            // A fill reads a superset of every path's pool; this must read a
            // subset, so a path on which the tagged pool is empty is caught.
            if (check.pool.kind !== "tagged" && check.pool.kind !== "influence") {
                return resolvePool(a, check.pool, registry).mods.length > 0
                    ? null
                    : { kind: "harvestEmptyPool", tag: check.tag };
            }
            const tag = check.tag;
            // The influence pool differs per possible influence set, so each
            // set is judged on its own path rather than through the shared tags.
            const paths =
                check.pool.kind === "influence"
                    ? [...a.influences].map((key) => ({ ...a, influences: new Set([key]) }))
                    : [a];
            for (const path of paths) {
                const hasTag =
                    check.pool.kind === "tagged"
                        ? (m: Mod): boolean => m.implicitTags.has(tag)
                        : influenceRowTest(path, registry);
                // A pair of side counts is open when the pessimistic pool has a
                // tagged row, or when the few unnamed modifiers of that path
                // cannot block every tagged row the guaranteed facts leave.
                const plain = (p: number, s: number): Mod[] =>
                    taggedUnderGuaranteed(path, registry, p, s, hasTag);
                const open = (p: number, s: number): boolean =>
                    subsetMods(path, registry, p, s).some(hasTag) ||
                    taggedRowSurvives(path, registry, p, s, plain(p, s));
                if (!open(0, 0)) {
                    // Either no tagged row rolls on the base at all, or one does
                    // but a modifier the item carries or may carry blocks it
                    // (its type, its group).
                    const bare = pool(
                        registry.catalog,
                        {
                            ...guaranteedFacts(path, registry),
                            prefixCount: 0,
                            suffixCount: 0,
                            types: new Set(),
                            families: new Set(),
                        },
                        influenceTagsOf(path, registry).maybe,
                    );
                    if (bare.some((c) => hasTag(c.mod))) return { kind: "harvestBlocked", tag };
                    return cannotRollBars(path, registry, hasTag)
                        ? { kind: "harvestCannotRoll", tag }
                        : { kind: "harvestEmptyPool", tag };
                }
                // Every realisable pair of side counts must leave a tagged row
                // room: the sides are coupled through the total, so each path's
                // pair is judged on its own rather than both sides at their
                // fullest at once.
                for (const [p, s] of sidePairs(path)) {
                    if (!open(p, s)) {
                        if (plain(p, s).length > 0) return { kind: "harvestBlocked", tag };
                        return cannotRollBars(path, registry, hasTag)
                            ? { kind: "harvestCannotRoll", tag }
                            : { kind: "harvestNoRoom", tag };
                    }
                }
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

/** Is it a cannot-roll metamod that leaves no row of the test in the pool: the
 *  empty item would roll one without the metamods the item carries or may carry. */
function cannotRollBars(a: AItem, registry: Registry, test: (m: Mod) => boolean): boolean {
    const carried = [...a.possible].some(
        (t) =>
            !isExcluded(a, t) && registry.effectsOfType(t).some((e) => e.kind === "poolRestrict"),
    );
    if (!carried) return false;
    const free = pool(
        registry.catalog,
        {
            ...guaranteedFacts(a, registry),
            prefixCount: 0,
            suffixCount: 0,
            types: new Set(),
            families: new Set(),
            effects: [],
        },
        influenceTagsOf(a, registry).maybe,
    );
    const restrict = [...a.possible]
        .filter((t) => !isExcluded(a, t))
        .flatMap((t) => registry.effectsOfType(t))
        .filter((e) => e.kind === "poolRestrict");
    const rows = free.map((c) => c.mod).filter(test);
    return rows.length > 0 && rows.every((m) => restrict.some((e) => !e.allows(m)));
}

/** How many guaranteed types are crafted for sure: every row they may be is a bench row. */
function sureCrafted(a: AItem, registry: Registry): number {
    let n = 0;
    for (const t of guaranteedTypes(a)) {
        if (a.craftedTypes.has(t) && rowsOf(a, t, registry).every((m) => m.source === "bench")) n++;
    }
    return n;
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
    if (allowed.size === 0) return false;
    // A fractured mod is locked, so it doesn't count toward what's removable; an
    // unproven fracture likewise locks a mod of unknown generation.
    const fractured = fracturedTypes(a);
    const unprovenLock = unprovenFractures(a)[1];
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
 * The types of `mod`'s group the item may carry; empty when none can be present,
 * which is what lets the bench add it. A guaranteed same-group type definitely
 * conflicts and is returned alone. A merely possible one conflicts only when its
 * generation still holds an unidentified affix that could be it: a generation
 * whose count is fully accounted for by guaranteed types rules it out, so a
 * proven "2 suffixes, 0 prefixes" item can still take a benched prefix.
 */
function typesSharingFamilyWithPresent(a: AItem, mod: Mod, registry: Registry): TypeId[] {
    const guaranteed = guaranteedTypes(a);
    const shares = (type: TypeId): boolean => {
        const fams = registry.familiesOfType(type);
        for (const f of mod.families) if (fams.has(f)) return true;
        return false;
    };
    for (const type of guaranteed) if (shares(type)) return [type];

    const clashing: TypeId[] = [];
    for (const type of a.possible) {
        if (guaranteed.has(type) || isExcluded(a, type) || !shares(type)) continue;
        if (mayBePresentUnnamed(a, registry, type)) clashing.push(type);
    }
    return clashing;
}

function hasVeiledPlaceholder(a: AItem): boolean {
    const clause = a.bdd.or(a.bdd.variable(VEILED_PREFIX), a.bdd.variable(VEILED_SUFFIX));
    return a.bdd.entails(a.presence, clause);
}

/** The category tag of a bench row that is the craftable version of a veiled
 *  modifier (the data's; every such row is one of Jun's crafts). */
const UNVEILED_CRAFT = TagId("unveiled_mod");

/** Might the item carry a veiled placeholder or an unveiled result mod? A veiled
 *  orb refuses both ("cannot be used to obtain multiple veiled modifiers",
 *  Crafting), and the precondition must hold on every path, so a possible one
 *  is enough to refuse. With `craftable`, a bench-crafted version counts too
 *  ("an item with a veiled modifier or its craftable versions", Veiled Exalted
 *  Orb § Mechanics). */
function mayHaveVeiled(
    a: AItem,
    registry: Registry,
    among?: (t: TypeId) => boolean,
    craftable = false,
): boolean {
    const guaranteed = guaranteedTypes(a);
    for (const t of a.possible) {
        if (isExcluded(a, t)) continue;
        if (among && !among(t)) continue;
        // Many unveiled rows share their type with natural rows, so the rows the
        // type may be (its tier overlay, else every row) decide, not the first row.
        const veiled =
            t === VEILED_PREFIX ||
            t === VEILED_SUFFIX ||
            rowsOf(a, t, registry).some(
                (m) =>
                    m.source === "veiled" ||
                    (craftable && m.source === "bench" && m.implicitTags.has(UNVEILED_CRAFT)),
            );
        if (!veiled) continue;
        if (guaranteed.has(t) || mayBePresentUnnamed(a, registry, t)) return true;
    }
    return false;
}

function sideOf(a: AItem, registry: Registry, t: TypeId): Gen {
    if (t === VEILED_PREFIX) return "prefix";
    if (t === VEILED_SUFFIX) return "suffix";
    return genOf(a, registry, t);
}

/** The sides a present type may sit on: those of the rows it may be. Most
 *  types have one; some (movement speed, spell damage) roll as a prefix on one
 *  base and a suffix on another, or are unveiled on the other side. */
function sidesOf(a: AItem, registry: Registry, t: TypeId): ReadonlySet<Gen> {
    if (t === VEILED_PREFIX || t === VEILED_SUFFIX) return new Set([sideOf(a, registry, t)]);
    const sides = new Set(rowsOf(a, t, registry).map((m) => m.gen));
    return sides.size > 0 ? sides : new Set([genOf(a, registry, t)]);
}

/**
 * Affixes of a side not pinned to a guaranteed type: with none, no other type
 * can be present on that side. A guaranteed type counts toward a side only
 * when every row it may be sits there, and a candidate is ruled out only when
 * every side it may sit on is fully named, so a type that may be on either
 * side never ends up excluded by the count of one of them.
 */
function mayBePresentUnnamed(a: AItem, registry: Registry, t: TypeId): boolean {
    const guaranteed = guaranteedTypes(a);
    const unidentifiedIn = (gen: Gen): number => {
        let named = 0;
        for (const g of guaranteed) {
            const sides = sidesOf(a, registry, g);
            if (sides.size === 1 && sides.has(gen)) named++;
        }
        const max = gen === "prefix" ? a.counts.prefix[1] : suffixRange(a)[1];
        return max - named;
    };
    for (const side of sidesOf(a, registry, t)) if (unidentifiedIn(side) > 0) return true;
    return false;
}

/** The rows a present type may be: its tier overlay, else every row of the type. */
export function rowsOf(a: AItem, type: TypeId, registry: Registry): readonly Mod[] {
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

/** Beyond operations.md §2: under an unproven lock, `possible` and the tier pins
 *  survive for every current type, since the lock may sit on any of them. */
function strip(a: AItem, rules: Rules, registry: Registry): AItem {
    const keep = rules.protected;
    const genOfT = (t: TypeId): Gen => genOf(a, registry, t);
    const fractured = fracturedTypes(a);
    const isKept = (t: TypeId): boolean => keep.has(genOfT(t)) || fractured.has(t);
    const fracIn = (g: Gen): number => fracturedIn(a, registry, g);
    // The unproven fractures keep as many mods, of unknown generation.
    const unprovenLock = unprovenFractures(a)[1];

    const keptPrefix: Range = keep.has("prefix")
        ? a.counts.prefix
        : [fracIn("prefix"), fracIn("prefix")];
    const keptSuffix: Range = keep.has("suffix")
        ? suffixRange(a)
        : [fracIn("suffix"), fracIn("suffix")];
    const prefix: Range = [keptPrefix[0], keptPrefix[1] + unprovenLock];
    const suffix: Range = [keptSuffix[0], keptSuffix[1] + unprovenLock];
    // An unproven lock may sit on a kept mod, so the floor is the kept counts or
    // the locks, whichever is more, never their sum.
    const total: Range = [
        Math.max(keptPrefix[0] + keptSuffix[0], a.fractures[0]),
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
    const values = keepValues(a.values, mayRemain);

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
    const craftedTypes = new Set([...a.craftedTypes].filter(mayRemain));
    return settled({
        ...a,
        counts: { total, prefix, suffix },
        presence,
        possible,
        tiers,
        values,
        crafted,
        craftedTypes,
    });
}

/** How many of the fractured (locked, so reforge-proof) mods are bench rows: the
 *  crafted count a reforge cannot clear (a crafted mod can be fractured,
 *  Crafting Bench § Using the crafting bench). */
function fracturedCrafted(a: AItem, registry: Registry): number {
    const fractured = fracturedTypes(a);
    // An unproven lock may sit on any current mod, a crafted one included.
    const unprovenHi = unprovenFractures(a)[1];
    let n = 0;
    for (const t of fractured) {
        if (rowsOf(a, t, registry).some((m) => m.source === "bench")) n++;
    }
    return Math.min(n + unprovenHi, a.crafted[1]);
}

function fracturedIn(a: AItem, registry: Registry, gen: Gen): number {
    let n = 0;
    for (const t of fracturedTypes(a)) if (genOf(a, registry, t) === gen) n++;
    return n;
}

/**
 * What a strip keeps, per side: the protected sides' counts and the fractured
 * mod, read from the state the method started on, before the strip moved them.
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
 *  the fractured mods, which under an unproven lock may be among the kept ones. */
function survivorsOf(a0: AItem, rules: Rules, registry: Registry): Range {
    const kept = keptBounds(a0, rules, registry);
    const unprovenHi = unprovenFractures(a0)[1];
    return [
        Math.max(kept.prefix[0] + kept.suffix[0], a0.fractures[0]),
        kept.prefix[1] + kept.suffix[1] + unprovenHi,
    ];
}

/** The rarity a scour leaves by survivor count (Orb of Scouring): none → Normal,
 *  one → Magic, two or more → Rare, whichever sides they sit on. */
function rarityForSurvivors(n: number): Rarity {
    if (n === 0) return "normal";
    if (n === 1) return "magic";
    return "rare";
}

const RARITY_RANK: Readonly<Record<Rarity, number>> = { normal: 0, magic: 1, rare: 2 };

/** A scour only ever lowers the rarity: a Magic item keeping two fractured
 *  modifiers, one a side, stays Magic. With `lowest`, two survivors that may
 *  sit one a side may also leave Magic, "the lowest eligible rarity" (Tainted
 *  Chaos Orb § Mechanics), where the Orb of Scouring's page has Rare. */
function scouredRarities(
    a0: AItem,
    rules: Rules,
    registry: Registry,
    lowest = false,
): ReadonlySet<Rarity> {
    const [lo, hi] = survivorsOf(a0, rules, registry);
    const kept = keptBounds(a0, rules, registry);
    const oneASide = kept.prefix[0] <= 1 && kept.suffix[0] <= 1;
    const out = new Set<Rarity>();
    for (const had of a0.rarities) {
        const lowered = (left: Rarity): Rarity =>
            RARITY_RANK[left] < RARITY_RANK[had] ? left : had;
        for (let n = lo; n <= hi; n++) {
            out.add(lowered(rarityForSurvivors(n)));
            if (lowest && n === 2 && oneASide) out.add(lowered("magic"));
        }
    }
    return out;
}

// --- fill ---------------------------------------------------------------------

/** The rows an anonymous affix (a declared `"random"`) on `gen` may be: every
 *  natural modifier that rolls on the item, those a declared modifier's group
 *  rules out excluded. */
export function anonymousRows(a: AItem, registry: Registry, gen: Gen): readonly Mod[] {
    return resolvePool(a, { kind: "natural", gen }, registry).mods;
}

interface ResolvedPool {
    readonly mods: readonly Mod[];
    readonly types: readonly TypeId[];
    /** The types "at least one of" is asserted over; empty for the natural pool. */
    readonly assert: readonly TypeId[];
    /** The side every row of the pool occupies, when they agree. */
    readonly gen: Gen | undefined;
}

function resolvePool(a: AItem, spec: PoolSpec, registry: Registry, strands = false): ResolvedPool {
    switch (spec.kind) {
        case "natural": {
            const cap = spec.maxLevel ?? Infinity;
            // On an item holding strands a Foulborn orb is one cut, the strands'
            // at thirty more, not its own cut after theirs (Memory strand §
            // Mechanics). Where the item may hold none, its own cut is read:
            // it is the wider of the two.
            const asStrands = spec.topTiers && strands && a.strands[0] > 0;
            const eligible = addableMods(
                a,
                registry,
                spec.level,
                strands,
                asStrands ? FOULBORN_AS_STRANDS : 0,
            ).filter((m) => m.minLevel <= cap && (spec.gen === undefined || m.gen === spec.gen));
            const mods =
                spec.topTiers && !asStrands ? foulbornTiers(eligible, a, registry) : eligible;
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
            const natural = addableMods(a, registry).filter(
                (m) =>
                    !carriesAny(m, spec.blocked) && !(spec.noTagless && m.implicitTags.size === 0),
            );
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
        case "influence": {
            const mods = addableMods(a, registry, a.ilvl, strands).filter(
                influenceRowTest(a, registry),
            );
            const types = typesOf(mods);
            return { mods, types, assert: types, gen: undefined };
        }
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

/**
 * Does some metamod fit on every path (Beastcrafting: "Requires an empty affix
 * slot")? Each pair of side counts the item may have is a path of its own, and
 * may be served by a different metamod: a full suffix side by the prefix one.
 * A side with an open slot takes a metamod when one of its carriers is surely
 * not on the item, or when the side's unnamed modifiers are too few to be
 * every carrier that may be. The fill then draws from the carriers that fit
 * on some path.
 */
function metamodFits(a: AItem, registry: Registry): boolean {
    const tight = capsOver(a, Math.min);
    const guaranteed = guaranteedTypes(a);
    const carriers = new Map<TypeId, Gen>();
    for (const m of registry.catalog) {
        if (m.source === "bench" && registry.effectsOfType(m.type).length > 0) {
            carriers.set(m.type, m.gen);
        }
    }
    const fitsSide = (gen: Gen, count: number): boolean => {
        if (count >= tight[gen]) return false;
        let maybe = 0;
        for (const [type, side] of carriers) {
            if (side !== gen || guaranteed.has(type)) continue;
            if (!a.possible.has(type) || isExcluded(a, type)) return true;
            maybe++;
        }
        let named = 0;
        for (const t of guaranteed) {
            const sides = sidesOf(a, registry, t);
            if (sides.size === 1 && sides.has(gen)) named++;
        }
        return count - named < maybe;
    };
    const pairs = sidePairs(a);
    return (
        pairs.length > 0 &&
        pairs.every(
            ([p, s]) => p + s < tight.total && (fitsSide("prefix", p) || fitsSide("suffix", s)),
        )
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

/** Beyond operations.md §2: a one-row pool pins the tier, and a bench or
 *  metamod craft raises the crafted count. */
function fill(
    a: AItem,
    a0: AItem,
    spec: PoolSpec,
    count: FillCount,
    rules: Rules,
    registry: Registry,
): AItem {
    // Upper bounds may reach the loosest caps over the rarities, lower bounds
    // only the tightest: a lower bound holds on the tightest path too.
    const { total: maxT, prefix: pCap, suffix: sCap } = capsOver(a, Math.max);
    const tight = capsOver(a, Math.min);
    // Nothing fits on any path (a magic Simplex): the fill lays down nothing.
    if (count.kind === "add" && a.counts.total[0] >= maxT) return settled(a);

    const drawn = resolvePool(a, spec, registry, rules.strands);
    const one = drawn.mods.length === 1 ? drawn.mods[0] : undefined;
    // Likewise when the pool's one side is full on every path: the step was
    // refused, and adding past the cap would leave counts no item has.
    if (count.kind === "add" && drawn.gen !== undefined) {
        const held = drawn.gen === "prefix" ? a.counts.prefix[0] : suffixRange(a)[0];
        if (held >= (drawn.gen === "prefix" ? pCap : sCap)) return settled(a);
    }

    let counts = a.counts;
    switch (count.kind) {
        case "add": {
            const [lo, hi] = count.n;
            const total: Range = [
                Math.min(a.counts.total[0] + lo, tight.total),
                Math.min(a.counts.total[1] + hi, maxT),
            ];
            const gen = drawn.gen;
            const grown = (side: Range, tightCap: number, cap: number): Range => [
                Math.min(side[0] + lo, tightCap),
                Math.min(side[1] + hi, cap),
            ];
            const maybeGrown = (side: Range, cap: number): Range => [
                side[0],
                Math.min(side[1] + hi, cap),
            ];
            const prefix: Range =
                gen === "prefix"
                    ? grown(a.counts.prefix, tight.prefix, pCap)
                    : gen === "suffix"
                      ? a.counts.prefix
                      : maybeGrown(a.counts.prefix, pCap);
            const suffix: Range =
                gen === "suffix"
                    ? grown(a.counts.suffix, tight.suffix, sCap)
                    : gen === "prefix"
                      ? a.counts.suffix
                      : maybeGrown(a.counts.suffix, sCap);
            counts = { total, prefix, suffix };
            break;
        }
        case "reforge": {
            const n = count.n === "byRarity" ? reforgeCountByRarity(a) : rareCountOn(a, count.n);
            if (rules.protected.size === 0) {
                const total: Range = [Math.min(n[0], maxT), Math.min(n[1], maxT)];
                counts = {
                    total,
                    prefix: [Math.max(0, total[0] - sCap), Math.min(pCap, total[1])],
                    suffix: [Math.max(0, total[0] - pCap), Math.min(sCap, total[1])],
                };
            } else {
                // A pool of one side cannot fill the other: the kept side holds
                // exactly what the strip left it (an Eldritch Chaos Orb).
                const rolls = (gen: Gen): boolean => drawn.gen === undefined || drawn.gen === gen;
                const prefix: Range = rolls("prefix")
                    ? [a.counts.prefix[0], pCap]
                    : a.counts.prefix;
                const suffix: Range = rolls("suffix") ? [a.counts.suffix[0], sCap] : suffixRange(a);
                counts = {
                    total: [a.counts.total[0], Math.min(maxT, prefix[1] + suffix[1])],
                    prefix,
                    suffix,
                };
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
    // A drawn modifier is a fresh roll, whatever was known of the type's value.
    const values = dropValues(a.values, drawn.types);
    // A type the item may already carry with no rows recorded is any row, and
    // stays so: the drawn rows would otherwise stand for a modifier that was
    // there before the draw (a declared bench affix, a branch's unknown).
    const anyRow = (t: TypeId): boolean =>
        !a.tiers.has(t) && a.counts.total[1] > 0 && a.possible.has(t) && !isExcluded(a, t);
    for (const m of drawn.mods) {
        if (one) tiers.set(m.type, new Set([m.id]));
        else if (!anyRow(m.type)) tiers.set(m.type, new Set([...(tiers.get(m.type) ?? []), m.id]));
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
    let craftedTypes = a.craftedTypes;
    if (count.kind === "add" && (spec.kind === "bench" || spec.kind === "metamods")) {
        crafted = [a.crafted[0] + count.n[0], a.crafted[1] + count.n[1]];
        craftedTypes = new Set([...a.craftedTypes, ...drawn.types]);
    } else if (
        spec.kind === "rows" &&
        spec.replacing !== undefined &&
        a.craftedTypes.has(spec.replacing)
    ) {
        // The replacement is crafted exactly when the modifier it replaces was,
        // so the count is the one the change started from; the removal between
        // the two had let it fall.
        craftedTypes = new Set([...a.craftedTypes, ...drawn.types]);
        crafted = a0.crafted;
    }
    return settled({ ...a, counts, presence, possible, tiers, values, crafted, craftedTypes });
}

/** Is a row an influence modifier here: one no tag of the item's own admits,
 *  so only an influence tag does. */
function influenceRowTest(a: AItem, registry: Registry): (m: Mod) => boolean {
    const facts = guaranteedFacts(a, registry);
    const sure = influenceTagsOf(a, registry).sure;
    const own = new Set([...facts.tags].filter((t) => !sure.has(t)));
    return (m) =>
        (lookupWeight(m, own) ?? 0) <= 0 &&
        m.spawn.some((w) => influenceOfTag(w.tag) !== undefined);
}

/** The guaranteed modifiers that are not influenced: what a removal of an
 *  influenced modifier cannot reach. */
function influenceShield(a: AItem, registry: Registry): Shield {
    const types = new Set<TypeId>();
    for (const t of guaranteedTypes(a)) if (!isInfluenceType(a, t, registry)) types.add(t);
    return { types };
}

/**
 * The Orb of Dominance's upgrade (Orb of Dominance § Mechanics): one of the
 * influenced modifiers went a tier up, or, at the top tier, became its
 * elevated row, a type of its own sharing its group. Which one is unknown, so
 * every influenced modifier the item may have loses its tier and may be its
 * elevated row; one of them remains, since only one was removed.
 */
function elevate(a: AItem, a0: AItem, rules: Rules, registry: Registry): AItem {
    const { sure, maybe } = influenceTagsOf(a, registry);
    const tags = new Set([...sure, ...maybe]);
    // A modifier on a protected side is not affected (Metamod § Rules and Exceptions).
    const influenced = [...a.possible].filter(
        (t) =>
            !isExcluded(a, t) &&
            isInfluenceType(a, t, registry) &&
            !rules.protected.has(genOf(a, registry, t)),
    );
    const elevated = new Map<TypeId, Mod[]>();
    for (const t of influenced) {
        const families = registry.familiesOfType(t);
        const rows = registry.catalog.filter(
            (m) =>
                m.source === "elevated" &&
                [...m.families].some((f) => families.has(f)) &&
                m.spawn.some((w) => tags.has(w.tag)),
        );
        if (rows.length > 0) elevated.set(t, rows);
    }
    const exact = upgradedSurvivor(a, a0, influenced, elevated, tags, registry);
    if (exact !== null) return exact;
    const s = relaxTiers(a, (t) => influenced.includes(t));
    const possible = new Set(s.possible);
    const tiers = new Map(s.tiers);
    const rows: Mod[] = [];
    for (const list of elevated.values()) {
        for (const m of list) {
            possible.add(m.type);
            // An elevated row of a type the item already carries joins that
            // type's relaxed tiers (any row); a type of its own is pinned to it.
            if (!influenced.includes(m.type)) {
                tiers.set(m.type, new Set([...(tiers.get(m.type) ?? []), m.id]));
            }
            rows.push(m);
        }
    }
    // What the removal before it left of the influenced modifiers is restated
    // below with their elevated rows, since the survivor may have changed type.
    let presence = admitAdd(
        { ...s, possible, presence: forgetTypes(s, new Set(influenced)) },
        rows,
    );
    if (influenced.length > 0) {
        let clause = a.bdd.FALSE;
        for (const t of influenced) clause = a.bdd.or(clause, a.bdd.variable(t));
        for (const list of elevated.values()) {
            for (const m of list) clause = a.bdd.or(clause, a.bdd.variable(m.type));
        }
        presence = a.bdd.and(presence, clause);
    }
    return settled({ ...s, possible, tiers, presence });
}

/**
 * The upgrade where the orb had exactly two influenced modifiers to choose
 * from, both at a known row: it removed one and upgraded the other, so the
 * one left is a higher row of its type or, from the top row, its elevated row
 * ("If it selects a tier 1 mod to upgrade, it will replace it with a new
 * 'elevated' mod"), and never the row it was. `null` where the item does not
 * settle that much: more influenced modifiers than two, an unknown row, an
 * elevated modifier among them, or a higher row above the item's level, which
 * the page does not say the orb reaches.
 */
function upgradedSurvivor(
    a: AItem,
    a0: AItem,
    influenced: readonly TypeId[],
    elevated: ReadonlyMap<TypeId, readonly Mod[]>,
    tags: ReadonlySet<TagId>,
    registry: Registry,
): AItem | null {
    if (influenced.length !== 2) return null;
    const guaranteed = guaranteedTypes(a0);
    const isRow = influenceRowTest(a0, registry);
    const forms: (readonly Mod[])[] = [];
    for (const t of influenced) {
        const pinned = a0.tiers.get(t);
        if (!guaranteed.has(t) || pinned?.size !== 1) return null;
        const was = registry.resolveMod([...pinned][0]!);
        if (!was.ok || was.value.source === "elevated") return null;
        const above = registry.catalog.filter(
            (m) =>
                m.type === t &&
                m.domain === a.base.domain &&
                m.source !== "elevated" &&
                m.minLevel > was.value.minLevel &&
                isRow(m) &&
                m.spawn.some((w) => tags.has(w.tag) && w.weight > 0),
        );
        if (above.some((m) => m.minLevel > a.ilvl)) return null;
        const rows = above.length > 0 ? above : elevated.get(t);
        if (rows === undefined) return null;
        forms.push(rows);
    }
    const touched = new Set(influenced);
    for (const rows of forms) for (const m of rows) touched.add(m.type);
    const possible = new Set(a.possible);
    const tiers = new Map(a.tiers);
    for (const t of touched) tiers.delete(t);
    let presence = forgetTypes(a, touched);
    const left: Bdd[] = [];
    forms.forEach((rows, i) => {
        let some = a.bdd.FALSE;
        for (const m of rows) {
            possible.add(m.type);
            tiers.set(m.type, new Set([...(tiers.get(m.type) ?? []), m.id]));
            some = a.bdd.or(some, a.bdd.variable(m.type));
        }
        left.push(some);
        // Upgraded into another type, the modifier is no longer its own.
        const own = influenced[i]!;
        if (!rows.some((m) => m.type === own)) {
            presence = a.bdd.and(presence, a.bdd.not(a.bdd.variable(own)));
        }
    });
    const [first, second] = [left[0]!, left[1]!];
    presence = a.bdd.and(
        presence,
        a.bdd.or(a.bdd.and(first, a.bdd.not(second)), a.bdd.and(second, a.bdd.not(first))),
    );
    return settled({
        ...a,
        possible,
        tiers,
        values: dropValues(a.values, touched),
        presence,
    });
}

/** Is a modifier type an influence modifier on this item: some row of it is
 *  one, under any influence the item may have. */
function isInfluenceType(a: AItem, type: TypeId, registry: Registry): boolean {
    const isRow = influenceRowTest(a, registry);
    const { sure, maybe } = influenceTagsOf(a, registry);
    const tags = new Set([...sure, ...maybe]);
    // The row's spawn table naming the influence's tag is what makes it an
    // influence modifier; an elevated row names it with no weight at all.
    return registry.catalog.some(
        (m) =>
            m.type === type &&
            m.domain === a.base.domain &&
            isRow(m) &&
            m.spawn.some((w) => tags.has(w.tag)),
    );
}

/** A rare reforge's count on this base: a base whose Rare holds four takes
 *  three or four, not the four its cap would clamp four-to-six down to (Orb of
 *  Alchemy § Spending: "three to four if used on jewels"). */
function rareCountOn(a: AItem, n: Range): Range {
    return holdsFour(a.base) && n[0] >= 4 ? [3, 4] : n;
}

/** The `byRarity` count (Orb of Transmutation § Spending, Chaos Orb § Mechanics). */
function reforgeCountByRarity(a: AItem): Range {
    const byRarity: Record<Rarity, Range> = {
        normal: [0, 0],
        magic: [1, 2],
        rare: rareCountOn(a, [4, 6]),
    };
    const ranges = [...a.rarities].map((r) => byRarity[r]);
    return [Math.min(...ranges.map((r) => r[0])), Math.max(...ranges.map((r) => r[1]))];
}

// --- remove ---------------------------------------------------------------------

function removeOne(
    a: AItem,
    allowed: ReadonlySet<Gen>,
    shield: Shield | null,
    registry: Registry,
): AItem {
    // A guarantee survives only if the removed affix could not have been it: one
    // in a generation the removal cannot reach (protected), one the shield covers,
    // or a fractured (locked) one. Exclusions always survive (a removal never adds
    // a mod), and so do the fracture facts.
    const guaranteed = guaranteedTypes(a);
    const surviving = new Set<TypeId>();
    for (const t of guaranteed) {
        if (!allowed.has(genOf(a, registry, t))) surviving.add(t);
    }
    if (shield) for (const t of shield.types) surviving.add(t);
    for (const t of fracturedTypes(a)) surviving.add(t);

    // A side loses a modifier only where it holds one the removal can reach: a
    // side whose every modifier is a surviving one (shielded, fractured) keeps
    // its count, so an annul under "Cannot roll Caster Modifiers" on a wand
    // whose one prefix is a caster modifier can only take the metamod itself.
    const mayLose = (gen: Gen): boolean => {
        if (!allowed.has(gen)) return false;
        const max = gen === "prefix" ? a.counts.prefix[1] : suffixRange(a)[1];
        let kept = 0;
        for (const t of surviving) {
            if (!guaranteed.has(t)) continue;
            const sides = sidesOf(a, registry, t);
            if (sides.size === 1 && sides.has(gen)) kept++;
        }
        return max - kept > 0;
    };
    const losable = (["prefix", "suffix"] as const).filter(mayLose);
    const lessOne = (r: Range): Range => [Math.max(0, r[0] - 1), Math.max(0, r[1] - 1)];
    const maybeLessOne = (r: Range): Range => [Math.max(0, r[0] - 1), r[1]];
    const side = (gen: Gen, r: Range): Range =>
        losable.length === 2 ? maybeLessOne(r) : losable[0] === gen ? lessOne(r) : r;
    const total: Range = losable.length === 0 ? a.counts.total : lessOne(a.counts.total);
    const prefix = side("prefix", a.counts.prefix);
    const suffix = side("suffix", a.counts.suffix);
    // Of the guaranteed modifiers the removal can reach, all but one remain; and
    // when every modifier it can reach is one of them, one of them is gone.
    const atRisk = [...guaranteedTypes(a)].filter((t) => !surviving.has(t));
    let reachable = 0;
    for (const gen of allowed)
        reachable += gen === "prefix" ? a.counts.prefix[1] : suffixRange(a)[1];
    // A kept type counts toward the reachable sides only when every row it
    // may be sits on one of them.
    let keptThere = 0;
    for (const t of surviving) {
        const sides = sidesOf(a, registry, t);
        if ([...sides].every((g) => allowed.has(g))) keptThere++;
    }
    const presence = assertOneRemovedAmong(
        a.bdd,
        a.bdd.and(presenceFacts(a.bdd, surviving, excludedTypes(a)), fractureProjection(a)),
        atRisk,
        reachable - keptThere <= atRisk.length,
    );
    // The removed affix might have been the crafted mod, so the lower bound drops.
    const crafted: Range = [Math.max(0, a.crafted[0] - 1), a.crafted[1]];
    return settled({ ...a, counts: { total, prefix, suffix }, presence, crafted });
}

/** A removal after a fill that cannot take the modifier the fill added: what
 *  the fill asserted of its pool, read on the item the method started on,
 *  holds after the removal as before it. */
function removeAnother(
    a: AItem,
    a0: AItem,
    sparing: PoolSpec,
    allowed: ReadonlySet<Gen>,
    shield: Shield | null,
    registry: Registry,
): AItem {
    const added = resolvePool(a0, sparing, registry).assert;
    const spared = new Set(shield?.types);
    if (added.length === 1) spared.add(added[0]!);
    const s = removeOne(a, allowed, { types: spared }, registry);
    if (added.length === 0) return s;
    let clause = a.bdd.FALSE;
    for (const t of added) clause = a.bdd.or(clause, a.bdd.variable(t));
    return settled({ ...s, presence: a.bdd.and(s.presence, clause) });
}

/** Remove one named, guaranteed modifier: it is gone, everything else stays. */
function removeType(a: AItem, type: TypeId, registry: Registry): AItem {
    const gen = genOf(a, registry, type);
    const lessOne = (r: Range): Range => [Math.max(0, r[0] - 1), Math.max(0, r[1] - 1)];
    const total = lessOne(a.counts.total);
    const prefix = gen === "prefix" ? lessOne(a.counts.prefix) : a.counts.prefix;
    const suffix = gen === "suffix" ? lessOne(a.counts.suffix) : a.counts.suffix;
    const surviving = guaranteedTypes(a);
    surviving.delete(type);
    const gone = excludedTypes(a);
    gone.add(type);
    const presence = a.bdd.and(presenceFacts(a.bdd, surviving, gone), fractureProjection(a));
    const tiers = new Map(a.tiers);
    tiers.delete(type);
    const values = dropValues(a.values, [type]);
    // The named modifier may have been the crafted one; it stays among the
    // crafted types, excluded, so a Harvest change that replaces it can read
    // that it was one.
    const crafted: Range = a.craftedTypes.has(type)
        ? [Math.max(0, a.crafted[0] - 1), a.crafted[1]]
        : a.crafted;
    return settled({ ...a, counts: { total, prefix, suffix }, presence, tiers, values, crafted });
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
    const unprovenLock = unprovenFractures(a)[1] > 0;
    const isBench = (m: Mod): boolean => m.source === "bench";
    let fracturedLower = 0;
    for (const t of fractured) if (rowsOf(a, t, registry).every(isBench)) fracturedLower++;
    const fracturedUpper = fracturedCrafted(a, registry);
    const removedLower = Math.max(0, a.crafted[0] - fracturedUpper);
    const removedUpper = Math.max(0, a.crafted[1] - fracturedLower);

    const guaranteed = guaranteedTypes(a);
    const excluded = excludedTypes(a);
    // The types the removal may touch are forgotten; what the presence knows of
    // the others, a pending veiled modifier or a disjunction among them, stays.
    const forgotten = new Set<TypeId>();
    const gone = new Set<TypeId>();
    const tiers = new Map(a.tiers);
    const sure = { prefix: 0, suffix: 0 };
    for (const t of a.possible) {
        if (excluded.has(t) || !a.craftedTypes.has(t) || fractured.has(t)) continue;
        const rows = rowsOf(a, t, registry);
        forgotten.add(t);
        tiers.delete(t);
        if (rows.every(isBench) && !unprovenLock) {
            if (guaranteed.has(t)) sure[genOf(a, registry, t)]++;
            gone.add(t);
        }
    }
    const sureRemoved = Math.max(removedLower, sure.prefix + sure.suffix);
    // A side loses at most one modifier per crafted type it may carry: a
    // metamod prefix that may be present cannot cost the item a suffix.
    const may = { prefix: 0, suffix: 0 };
    for (const t of forgotten) for (const g of sidesOf(a, registry, t)) may[g]++;
    const total: Range = [
        Math.max(0, a.counts.total[0] - removedUpper),
        Math.max(0, a.counts.total[1] - sureRemoved),
    ];
    const prefix: Range = [
        Math.max(0, a.counts.prefix[0] - Math.min(removedUpper, may.prefix)),
        Math.max(0, a.counts.prefix[1] - sure.prefix),
    ];
    const suffix: Range = [
        Math.max(0, a.counts.suffix[0] - Math.min(removedUpper, may.suffix)),
        Math.max(0, a.counts.suffix[1] - sure.suffix),
    ];
    const presence = a.bdd.and(forgetTypes(a, forgotten), presenceFacts(a.bdd, [], gone));
    const crafted: Range = [
        Math.min(a.crafted[0], fracturedLower),
        Math.min(a.crafted[1], fracturedUpper),
    ];
    const craftedTypes = new Set(
        [...a.craftedTypes].filter((t) => fractured.has(t) || unprovenLock),
    );
    return settled({
        ...a,
        counts: { total, prefix, suffix },
        presence,
        tiers,
        values: dropValues(a.values, forgotten),
        crafted,
        craftedTypes,
    });
}

// --- lock -----------------------------------------------------------------------

/** The targets are random, so no specific mod is proven fractured yet: every
 *  present named mod becomes a candidate a `fractured X` branch can pin, and
 *  the locks the anonymous mods cannot account for provably landed among them.
 *  A metamod is an ordinary candidate. */
function lock(a: AItem, n: number): AItem {
    const already = fracturedTypes(a);
    const candidates = [...guaranteedTypes(a)].filter((t) => !already.has(t));
    const anonymous = Math.max(0, a.counts.total[1] - guaranteedTypes(a).size);
    return settled({
        ...a,
        fractures: [a.fractures[0] + n, a.fractures[1] + n],
        presence: assertFractureDisjunction(a.bdd, a.presence, candidates, n, n - anonymous),
    });
}

// --- the add-pool (which rows a draw could be) --------------------------------

/**
 * Over-approximate the mods a draw could introduce: run the real `pool` on the
 * facts of the guaranteed mods alone, at rare caps (fewer present mods ⇒ a
 * superset of every arm's real pool). Returns mods, not just types, so the tier
 * overlay can record which tiers.
 */
function addableMods(
    a: AItem,
    registry: Registry,
    level = a.ilvl,
    strands = false,
    moreStrands = 0,
): Mod[] {
    const facts = guaranteedFacts(a, registry, level, strands, moreStrands);
    // Tags a possibly present mod would add may enable a row (the staff jewel mods
    // on a Strength jewel), so the pool admits what they would: the tags of the
    // state's possible mods, then, to a fixpoint, the tags of every row the pool
    // itself admits, since a reforge lays its rolls down one after another and a
    // later roll sees the tags of an earlier one. A maybe tag only ever admits,
    // so the closure is monotone. (The set views scan the allocated variables;
    // asking per type would allocate one per possible type and flood the BDD.)
    // An influence the item has on some path only is a maybe tag too.
    const maybeTags = influenceTagsOf(a, registry).maybe;
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
    const maybeTags = influenceTagsOf(a, registry).maybe;
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

/**
 * Does a tagged row provably survive on every path with these side counts,
 * though the pessimistic pool is empty? That pool takes every possibly present
 * modifier as present, but a path holds at most `k` of them, the affixes no
 * guaranteed type accounts for. Each possibly present type blocks the rows that
 * share a family with it, or that a tag it adds zeroes, so when `k` such types
 * cannot cover the signatures the tagged rows span under the guaranteed facts
 * alone, some row is open on every path: one unknown suffix cannot block both a
 * life leech and a mana leech.
 */
function taggedUnderGuaranteed(
    a: AItem,
    registry: Registry,
    prefixCount: number,
    suffixCount: number,
    hasTag: (m: Mod) => boolean,
): Mod[] {
    const facts = guaranteedFacts(a, registry);
    const guaranteed = new Set(facts.types);
    // The restrictions a possibly present carrier imposes are read as in force.
    const effects = [...facts.effects];
    for (const t of a.possible) {
        if (!isExcluded(a, t) && !guaranteed.has(t)) effects.push(...registry.effectsOfType(t));
    }
    return pool(
        registry.catalog,
        { ...facts, prefixCount, suffixCount, effects },
        influenceTagsOf(a, registry).maybe,
        true,
    )
        .map((c) => c.mod)
        .filter(hasTag);
}

function taggedRowSurvives(
    a: AItem,
    registry: Registry,
    prefixCount: number,
    suffixCount: number,
    rows: readonly Mod[],
): boolean {
    if (rows.length === 0) return false;
    const guaranteed = guaranteedTypes(a);
    const unnamed = [...a.possible].filter((t) => !isExcluded(a, t) && !guaranteed.has(t));
    const k = prefixCount + suffixCount - guaranteed.size;
    if (k <= 0) return true;
    // Rows blocked alike share a signature: their families, and the tags a zero
    // weight of theirs answers to, which a possibly present modifier may add.
    const signatures = new Map<
        string,
        { families: ReadonlySet<GroupId>; zeroTags: ReadonlySet<TagId> }
    >();
    for (const r of rows) {
        const zeroTags = new Set(
            [...r.spawn, ...r.generation].filter((e) => e.weight === 0).map((e) => e.tag),
        );
        const key = `${[...r.families].sort().join(" ")}|${[...zeroTags].sort().join(" ")}`;
        signatures.set(key, { families: r.families, zeroTags });
    }
    let widest = 0;
    for (const t of unnamed) {
        const fams = registry.familiesOfType(t);
        const adds = registry.addsTagsOfType(t);
        let cover = 0;
        for (const sig of signatures.values()) {
            if (
                [...sig.families].some((f) => fams.has(f)) ||
                [...sig.zeroTags].some((g) => adds.has(g))
            ) {
                cover++;
            }
        }
        widest = Math.max(widest, cover);
    }
    return k * widest < signatures.size;
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

/**
 * The influence tags the item carries: `sure` on every path (the influences
 * every possible set shares), `maybe` on some path only. A row an influence
 * admits is in the pool on the paths that have it, so `maybe` reads
 * optimistically where the pool over-approximates and pessimistically where it
 * under-approximates, like a possibly present modifier's tags.
 */
export function influenceTagsOf(
    a: AItem,
    registry: Registry,
): { sure: Set<TagId>; maybe: Set<TagId> } {
    const sets = [...a.influences].map(influencesOf);
    const sure = new Set<TagId>();
    const maybe = new Set<TagId>();
    for (const influence of new Set(sets.flat())) {
        const onEveryPath = sets.every((s) => s.includes(influence));
        for (const tag of registry.influenceTags(a.base, influence)) {
            (onEveryPath ? sure : maybe).add(tag);
        }
    }
    return { sure, maybe };
}

/** The influence tags the item carries on any path: what a name or a tier
 *  written against the item may mean. */
export function influenceTagsAny(a: AItem, registry: Registry): ReadonlySet<TagId> {
    const { sure, maybe } = influenceTagsOf(a, registry);
    return new Set([...sure, ...maybe]);
}

/** The state's guaranteed mods as the facts the pool reads, at rare caps.
 *  `strands`: the facts carry the item's memory strands, for the fill of a
 *  method that uses them up, `moreStrands` on top for a Foulborn orb; other
 *  pools are not cut by them. */
export function guaranteedFacts(
    a: AItem,
    registry: Registry,
    level = a.ilvl,
    strands = false,
    moreStrands = 0,
): ItemFacts {
    const types = guaranteedTypes(a);
    const families = new Set<GroupId>();
    const tags = new Set([...a.base.tags, ...influenceTagsOf(a, registry).sure]);
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
        ...(strands && a.strands[0] > 0 && { strands: a.strands[0] + moreStrands }),
    };
}
