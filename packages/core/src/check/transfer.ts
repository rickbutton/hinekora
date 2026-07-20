/**
 * Currency transfer functions: each operation is `AItem → (AItem | precondition
 * failure)`, folding the op's outcome summary straight into the abstract state
 *, the checker never holds a concrete item or an enumerated union. `forcedGen`
 * (set by an active omen) constrains an add/remove to one generation, which
 * tightens counts and changes which guarantees survive.
 */
import type { ClassId, Gen, ModId, Rarity, TypeId } from "../model/ids.js";
import type { Item } from "../model/item.js";
import type { Mod } from "../model/mod.js";
import type { EssenceSpec } from "../model/sources.js";
import { pool } from "../pool/pool.js";
import type { Registry } from "../resolve/registry.js";
import {
    type AItem,
    type Range,
    admitAdd,
    canBeRare,
    excludedTypes,
    guaranteedTypes,
    maxTotal,
    presenceFacts,
    settled,
    sideCap,
    suffixRange,
} from "./astate.js";
import { CountDomain } from "./counts.js";

/** Why an operation's precondition fails on the current state. */
export type PreconditionFailure =
    | { readonly kind: "wrongRarity"; readonly needed: Rarity; readonly actual: Rarity }
    | { readonly kind: "noOpenSlot"; readonly gen?: Gen }
    | { readonly kind: "modConflict"; readonly group: string }
    | { readonly kind: "nothingToRemove"; readonly gen?: Gen }
    | { readonly kind: "essenceRarity"; readonly tier: number; readonly actual: Rarity }
    | { readonly kind: "essenceClass"; readonly essence: string; readonly itemClass: ClassId }
    | { readonly kind: "rarityUnsupported"; readonly rarity: Rarity }
    | { readonly kind: "craftedLimit" };

export type TransferResult =
    | { readonly ok: true; readonly state: AItem }
    | { readonly ok: false; readonly failure: PreconditionFailure };

const ok = (state: AItem): TransferResult => ({ ok: true, state });
const fail = (failure: PreconditionFailure): TransferResult => ({ ok: false, failure });

// --- the four base currencies ---------------------------------------------

export function transmute(a: AItem, registry: Registry): TransferResult {
    if (a.rarity !== "normal") return wrongRarity("normal", a.rarity);
    return ok(addOne(a, undefined, "magic", registry));
}

export function regal(a: AItem, registry: Registry): TransferResult {
    if (a.rarity !== "magic") return wrongRarity("magic", a.rarity);
    if (!canBeRare(a.base)) return fail({ kind: "rarityUnsupported", rarity: "rare" });
    return ok(addOne(a, undefined, "rare", registry));
}

export function exalt(a: AItem, forcedGen: Gen | undefined, registry: Registry): TransferResult {
    if (a.rarity !== "rare") return wrongRarity("rare", a.rarity);
    if (!hasOpenSlot(a, forcedGen))
        return fail({ kind: "noOpenSlot", ...(forcedGen && { gen: forcedGen }) });
    return ok(addOne(a, forcedGen, "rare", registry));
}

export function annul(a: AItem, forcedGen: Gen | undefined, registry: Registry): TransferResult {
    // No rarity gate, annul works on anything with a removable mod, and a
    // Normal item already fails `hasRemovable` with the accurate reason.
    if (!hasRemovable(a, forcedGen))
        return fail({ kind: "nothingToRemove", ...(forcedGen && { gen: forcedGen }) });
    return ok(removeOne(a, forcedGen, registry));
}

const wrongRarity = (needed: Rarity, actual: Rarity): TransferResult =>
    fail({ kind: "wrongRarity", needed, actual });

// --- the other common currencies ------------------------------------------
//
// All ops reduce to two primitives: an ADDITIVE add (`addOne`) and a REFORGE
// (`reroll`). Semantics are hand-modelled; the currency catalog only supplies
// display text.

/** Orb of Augmentation: add a mod to a Magic item (needs an open slot). */
export function augment(a: AItem, registry: Registry): TransferResult {
    if (a.rarity !== "magic") return wrongRarity("magic", a.rarity);
    if (!hasOpenSlot(a, undefined)) return fail({ kind: "noOpenSlot" });
    return ok(addOne(a, undefined, "magic", registry));
}

/** Orb of Alteration: reforge a Magic item (1–2 fresh mods). */
export function alteration(a: AItem, registry: Registry): TransferResult {
    if (a.rarity !== "magic") return wrongRarity("magic", a.rarity);
    return ok(reroll(a, "magic", [1, 2], registry));
}

/** Orb of Alchemy: upgrade a Normal item to a Rare with 4–6 fresh mods. */
export function alchemy(a: AItem, registry: Registry): TransferResult {
    if (a.rarity !== "normal") return wrongRarity("normal", a.rarity);
    if (!canBeRare(a.base)) return fail({ kind: "rarityUnsupported", rarity: "rare" });
    return ok(reroll(a, "rare", [4, 6], registry));
}

/** Chaos Orb: reforge a Rare item (4–6 fresh mods). */
export function chaos(a: AItem, registry: Registry): TransferResult {
    if (a.rarity !== "rare") return wrongRarity("rare", a.rarity);
    return ok(reroll(a, "rare", [4, 6], registry));
}

/** Orb of Scouring: strip every mod, returning the item to Normal. Wasted only
 *  on an already-Normal item, a Magic base with zero affixes (e.g. a magic
 *  Simplex) still drops to Normal, so rarity, not mod count, is the gate. */
export function scour(a: AItem): TransferResult {
    if (a.rarity === "normal") return fail({ kind: "nothingToRemove" });
    const next: AItem = {
        ...a,
        rarity: "normal",
        counts: CountDomain.empty(),
        presence: a.bdd.TRUE,
        possible: new Set(),
        tiers: new Map(),
        crafted: [0, 0],
    };
    return ok(settled(next));
}

/**
 * Apply an essence: reforge to Rare with one guaranteed mod (fixed per item
 * class) plus a random fill. Preconditions: Normal always, Rare only for ladder
 * tier ≥ 5, never Magic; the essence must cover the item's class. There is no
 * item-level gate, the guaranteed mod lands at its fixed tier regardless of
 * ilvl; only the random fill respects level caps.
 */
export function essence(a: AItem, spec: EssenceSpec, registry: Registry): TransferResult {
    if (a.rarity === "magic" || (a.rarity === "rare" && spec.tier < 5)) {
        return fail({ kind: "essenceRarity", tier: spec.tier, actual: a.rarity });
    }
    if (!canBeRare(a.base)) return fail({ kind: "rarityUnsupported", rarity: "rare" });
    const modId = spec.grants.get(a.base.itemClass);
    const guaranteedMod = modId && registry.catalog.find((m) => m.id === modId);
    if (!guaranteedMod) {
        return fail({ kind: "essenceClass", essence: spec.name, itemClass: a.base.itemClass });
    }

    // The random fill: reforge to a full Rare (4–6 mods) from the normal pool,
    // capped by both the item level and the essence's max random-mod level. On a
    // reduced-cap base the count clamps to what fits (Simplex: always 3).
    const maxT = maxTotal("rare", a.base);
    const total: Range = [Math.min(4, maxT), Math.min(6, maxT)];
    const pCap = sideCap("prefix", "rare", a.base);
    const sCap = sideCap("suffix", "rare", a.base);
    const fillCap = Math.min(a.ilvl, spec.maxRandomModLevel ?? Infinity);
    const fill = addableMods({ ...a, presence: a.bdd.TRUE }, undefined, registry).filter(
        (m) => m.minLevel <= fillCap,
    );
    const possible = new Set<TypeId>();
    const tiers = new Map<TypeId, ReadonlySet<ModId>>();
    for (const m of fill) {
        possible.add(m.type);
        const cur = tiers.get(m.type);
        tiers.set(m.type, cur ? new Set([...cur, m.id]) : new Set([m.id]));
    }
    const reforged: AItem = {
        ...a,
        rarity: "rare",
        counts: { total, prefix: [Math.max(0, total[0] - sCap), Math.min(pCap, total[1])] },
        presence: a.bdd.TRUE,
        possible,
        tiers,
        crafted: [0, 0], // a reforge discards any crafted mod
    };
    return ok(withGuaranteed(reforged, guaranteedMod));
}

/**
 * Force a specific mod present: guaranteed, pinned to its exact tier, in
 * `possible`, with ≥1 affix in its generation. The total count is the caller's
 * to set (essence reforges to a range first; bench bumps by one).
 */
function withGuaranteed(a: AItem, mod: Mod): AItem {
    const presence = a.bdd.and(a.presence, a.bdd.variable(mod.type));
    const tiers = new Map(a.tiers).set(mod.type, new Set([mod.id]));
    const possible = new Set(a.possible).add(mod.type);
    // ≥1 affix, and ≥1 in the mod's generation, the same count fact `has` learns.
    const counts = CountDomain.learnPresent(a.counts, mod.gen);
    return settled({ ...a, presence, tiers, possible, counts });
}

/**
 * Apply a crafting-bench mod: add the specific `mod`, guaranteed and pinned.
 * Preconditions: an open slot in its generation (a Normal item, cap 0, naturally
 * has none); no more than one crafted mod (the "can have multiple crafted mods"
 * metacraft is not modelled); and the mod's group not already possibly present.
 * Class fit is enforced upstream by `resolveBench`.
 */
export function bench(a: AItem, mod: Mod, registry: Registry): TransferResult {
    if (!hasOpenSlot(a, mod.gen)) return fail({ kind: "noOpenSlot", gen: mod.gen });
    // An item holds at most one bench-crafted mod. If one might already be present
    // (crafted could be ≥ 1), a second isn't provably safe.
    if (a.crafted[1] >= 1) return fail({ kind: "craftedLimit" });
    // If the item may already carry a mod in the bench mod's group, the add isn't
    // provably safe (an item holds one mod per group). A conflict hidden behind an
    // anonymous "random" affix is not caught, known modelling gap.
    if (sharesFamilyWithPresent(a, mod, registry)) {
        return fail({ kind: "modConflict", group: registry.typeLabel(mod.type) });
    }
    const total: Range = [a.counts.total[0] + 1, a.counts.total[1] + 1];
    const prefix: Range =
        mod.gen === "prefix" ? [a.counts.prefix[0] + 1, a.counts.prefix[1] + 1] : a.counts.prefix;
    const crafted: Range = [a.crafted[0] + 1, a.crafted[1] + 1];
    return ok(withGuaranteed({ ...a, counts: { total, prefix }, crafted }, mod));
}

/**
 * Could a mod in `mod`'s group already sit on the item? A guaranteed same-group
 * type definitely conflicts. A merely POSSIBLE one conflicts only when its
 * generation still holds an unidentified affix that could be it, a generation
 * whose count is fully accounted for by guaranteed types rules it out (so a
 * proven "2 suffixes, 0 prefixes" item can still take a benched prefix).
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
        for (const t of guaranteed) if ((registry.genOfType(t) ?? "prefix") === gen) named++;
        const max = gen === "prefix" ? a.counts.prefix[1] : suffixRange(a)[1];
        return max - named;
    };
    for (const type of a.possible) {
        if (guaranteed.has(type) || !shares(type)) continue;
        if (unidentifiedIn(registry.genOfType(type) ?? "prefix") > 0) return true;
    }
    return false;
}

/**
 * A reforge: discard every current mod and lay down a fresh set of the given
 * rarity and count range. Nothing stays guaranteed; the base's full add-pool
 * becomes `possible`; exclusions clear. Shared by alteration/alchemy/chaos.
 */
function reroll(a: AItem, rarity: Rarity, want: Range, registry: Registry): AItem {
    // Clamp the fresh count to what this base can actually hold at that rarity:
    // a reduced-cap base fills to fewer mods (chaos on a rare Simplex: 3, not 4–6).
    const maxT = maxTotal(rarity, a.base);
    const total: Range = [Math.min(want[0], maxT), Math.min(want[1], maxT)];
    const pCap = sideCap("prefix", rarity, a.base);
    const sCap = sideCap("suffix", rarity, a.base);
    const prefix: Range = [Math.max(0, total[0] - sCap), Math.min(pCap, total[1])];
    // An empty item of this base has the widest pool, a sound over-approximation.
    const fresh = addableMods({ ...a, presence: a.bdd.TRUE }, undefined, registry);
    const possible = new Set<TypeId>();
    const tiers = new Map<TypeId, ReadonlySet<ModId>>();
    for (const m of fresh) {
        possible.add(m.type);
        const cur = tiers.get(m.type);
        tiers.set(m.type, cur ? new Set([...cur, m.id]) : new Set([m.id]));
    }
    const next: AItem = {
        ...a,
        rarity,
        counts: { total, prefix },
        presence: a.bdd.TRUE, // reforge: nothing guaranteed, nothing excluded
        possible,
        tiers,
        crafted: [0, 0], // a reforge discards any crafted mod
    };
    return settled(next);
}

// --- precondition predicates (must hold in EVERY arm) ---------------------

function hasOpenSlot(a: AItem, forcedGen: Gen | undefined): boolean {
    if (forcedGen === "prefix") return a.counts.prefix[1] < sideCap("prefix", a.rarity, a.base);
    if (forcedGen === "suffix") return suffixRange(a)[1] < sideCap("suffix", a.rarity, a.base);
    return a.counts.total[1] < maxTotal(a.rarity, a.base); // some slot open in every arm
}

function hasRemovable(a: AItem, forcedGen: Gen | undefined): boolean {
    if (forcedGen === "prefix") return a.counts.prefix[0] >= 1; // a prefix present in every arm
    if (forcedGen === "suffix") return suffixRange(a)[0] >= 1;
    return a.counts.total[0] >= 1;
}

// --- the add / remove summaries -------------------------------------------

function addOne(a: AItem, forcedGen: Gen | undefined, rarity: Rarity, registry: Registry): AItem {
    // A slot-gated caller (exalt/augment) has already ensured room; transmute
    // has NOT, on a base whose target-rarity total cap is 0 (a magic Simplex),
    // it adds nothing and just changes rarity (a blue base with no modifiers).
    const maxT = maxTotal(rarity, a.base);
    if (a.counts.total[0] >= maxT) return settled({ ...a, rarity });

    const total: Range = [a.counts.total[0] + 1, Math.min(a.counts.total[1] + 1, maxT)];
    const prefix: Range =
        forcedGen === "prefix"
            ? [a.counts.prefix[0] + 1, a.counts.prefix[1] + 1]
            : forcedGen === "suffix"
              ? a.counts.prefix
              : [a.counts.prefix[0], a.counts.prefix[1] + 1]; // could land in either generation

    // Additive: every prior mod survives, so guarantees, disjunctions and tier
    // pins all hold. Each addable type becomes `possible`; and since the new mod
    // could be any of them, only THOSE types' exclusions are relaxed (`admitAdd`)
    //, the rest of the presence knowledge is kept.
    const added = addableMods(a, forcedGen, registry);
    const possible = new Set(a.possible);
    const tiers = new Map(a.tiers);
    for (const m of added) {
        possible.add(m.type);
        const cur = tiers.get(m.type);
        tiers.set(m.type, cur ? new Set([...cur, m.id]) : new Set([m.id]));
    }
    const presence = admitAdd(a, added);
    const next: AItem = { ...a, rarity, counts: { total, prefix }, presence, possible, tiers };
    return settled(next);
}

function removeOne(a: AItem, forcedGen: Gen | undefined, registry: Registry): AItem {
    const total: Range = [Math.max(0, a.counts.total[0] - 1), Math.max(0, a.counts.total[1] - 1)];
    const prefix: Range =
        forcedGen === "prefix"
            ? [Math.max(0, a.counts.prefix[0] - 1), Math.max(0, a.counts.prefix[1] - 1)]
            : forcedGen === "suffix"
              ? a.counts.prefix
              : [Math.max(0, a.counts.prefix[0] - 1), a.counts.prefix[1]];

    // A guarantee survives only if the removed affix could not have been it:
    // a gen-forced removal spares the other generation; an unforced one could
    // take anything. Exclusions always survive (a removal never adds a mod).
    const presence = presenceFacts(
        a.bdd,
        survivingGuarantees(a, forcedGen, registry),
        excludedTypes(a),
    );
    // The removed affix might have been the crafted mod, so the lower bound drops.
    const crafted: Range = [Math.max(0, a.crafted[0] - 1), a.crafted[1]];
    const next: AItem = { ...a, counts: { total, prefix }, presence, crafted };
    return settled(next);
}

function survivingGuarantees(
    a: AItem,
    forcedGen: Gen | undefined,
    registry: Registry,
): ReadonlySet<TypeId> {
    if (forcedGen === undefined) return new Set();
    const safeGen: Gen = forcedGen === "prefix" ? "suffix" : "prefix";
    const out = new Set<TypeId>();
    for (const t of guaranteedTypes(a)) if (registry.genOfType(t) === safeGen) out.add(t);
    return out;
}

// --- abstract pool (which types an add could introduce) -------------------

/**
 * Over-approximate the mods an add could introduce: run the real `pool` on a
 * synthetic item carrying only the guaranteed mods at rare caps (fewer present
 * mods ⇒ a superset of every arm's real pool). Returns mods, not just types,
 * so the tier overlay can record which tiers.
 */
function addableMods(a: AItem, forcedGen: Gen | undefined, registry: Registry): Mod[] {
    const synthetic = syntheticItem(a, registry);
    const out: Mod[] = [];
    for (const c of pool(registry.catalog, synthetic)) {
        if (forcedGen === undefined || c.mod.gen === forcedGen) out.push(c.mod);
    }
    return out;
}

function syntheticItem(a: AItem, registry: Registry): Item {
    const prefixes: Mod[] = [];
    const suffixes: Mod[] = [];
    for (const t of guaranteedTypes(a)) {
        const rep = representative(registry, t);
        if (!rep) continue;
        (rep.gen === "prefix" ? prefixes : suffixes).push(rep);
    }
    return { game: a.game, base: a.base, ilvl: a.ilvl, rarity: "rare", prefixes, suffixes };
}

function representative(registry: Registry, type: TypeId): Mod | undefined {
    return registry.catalog.find((m) => m.type === type);
}
