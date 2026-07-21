/**
 * Currency transfer functions: each operation is `AItem → (AItem | precondition
 * failure)`, folding the op's outcome summary straight into the abstract state
 *, the checker never holds a concrete item or an enumerated union. `forcedGen`
 * (set by an active omen) constrains an add/remove to one generation, which
 * tightens counts and changes which guarantees survive.
 */
import { craftedCapOf, type Effect } from "../model/effects.js";
import type { ClassId, Gen, ModId, Rarity, TagId, TypeId } from "../model/ids.js";
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
    | { readonly kind: "craftedLimit"; readonly cap: number }
    | { readonly kind: "harvestEmptyPool"; readonly tag: TagId }
    | { readonly kind: "metamodBlocks" };

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
    // Normal item already fails `hasRemovable` with the accurate reason. A
    // protection metamod shields its generation, so the removal draws only from
    // the unprotected side.
    const allowed = removalGens(a, forcedGen, registry);
    if (!hasRemovable(a, allowed))
        return fail({ kind: "nothingToRemove", ...(forcedGen && { gen: forcedGen }) });
    return ok(removeOne(a, allowed, registry));
}

const wrongRarity = (needed: Rarity, actual: Rarity): TransferResult =>
    fail({ kind: "wrongRarity", needed, actual });

// --- metamod effects (derived from guaranteed carriers) -------------------
//
// A metamod's effect is active iff its carrier type is GUARANTEED present.
// Mirrors the concrete derived-effects model (§9): a merely-possible carrier is
// treated as absent, which is sound in every direction — protection that
// preserves guarantees, and restrictions/blocks that would constrain or reject a
// later op, all require the carrier to be provably there.

const ALL_GENS: readonly Gen[] = ["prefix", "suffix"];

/** The effects active right now: the union over guaranteed effect-carriers. */
function activeEffects(a: AItem, registry: Registry): readonly Effect[] {
    const out: Effect[] = [];
    for (const t of guaranteedTypes(a)) out.push(...registry.effectsOfType(t));
    return out;
}

/** Generations shielded from removal by an active `protect(gen)` metamod. */
function protectedGens(a: AItem, registry: Registry): ReadonlySet<Gen> {
    const out = new Set<Gen>();
    for (const e of activeEffects(a, registry)) {
        if (e.kind === "protect" && e.target.by === "gen") out.add(e.target.gen);
    }
    return out;
}

/** The crafted-mod limit here, raised by an active "multimod" metamod. */
function craftedCapOfState(a: AItem, registry: Registry): number {
    return craftedCapOf(activeEffects(a, registry));
}

/** Do the active metamods block a sourced craft (essence/fossil)? Protection and
 *  cannot-roll prevent it; multimod alone does not. */
function metamodBlocksSourced(a: AItem, registry: Registry): boolean {
    return activeEffects(a, registry).some(
        (e) => e.kind === "protect" || e.kind === "poolRestrict",
    );
}

/** The generations a removal may draw from: the omen-forced gen (or both),
 *  minus any protected by a metamod. Empty ⇒ nothing is removable. */
function removalGens(a: AItem, forcedGen: Gen | undefined, registry: Registry): ReadonlySet<Gen> {
    const shielded = protectedGens(a, registry);
    const base = forcedGen ? [forcedGen] : ALL_GENS;
    return new Set(base.filter((g) => !shielded.has(g)));
}

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

/** Chaos Orb: reforge a Rare item (4–6 fresh mods). A "cannot be changed" metamod
 *  makes it keep that side and reroll only the other (see `keepProtectedReroll`). */
export function chaos(a: AItem, registry: Registry): TransferResult {
    if (a.rarity !== "rare") return wrongRarity("rare", a.rarity);
    const shielded = protectedGens(a, registry);
    if (shielded.size > 0) return ok(keepProtectedReroll(a, shielded, registry));
    return ok(reroll(a, "rare", [4, 6], registry));
}

/** Orb of Scouring: strip every mod, returning the item to Normal. Wasted only
 *  on an already-Normal item, a Magic base with zero affixes (e.g. a magic
 *  Simplex) still drops to Normal, so rarity, not mod count, is the gate.
 *  A protection metamod makes scour keep its side (see `scourKeeping`). */
export function scour(a: AItem, registry: Registry): TransferResult {
    if (a.rarity === "normal") return fail({ kind: "nothingToRemove" });
    const shielded = protectedGens(a, registry);
    if (shielded.size > 0) {
        // With a "cannot be changed" metamod, scour removes the WHOLE unprotected
        // side (including the metamod) and keeps the protected side; the item
        // stays Rare. Both sides protected ⇒ nothing to remove (wasted scour).
        if (ALL_GENS.every((g) => shielded.has(g))) return fail({ kind: "nothingToRemove" });
        return ok(scourKeeping(a, shielded, registry));
    }
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

/** Scour that respects protection: keep the protected generations (guarantees,
 *  counts, tiers, pool) and clear the rest, staying at the current rarity. */
function scourKeeping(a: AItem, keep: ReadonlySet<Gen>, registry: Registry): AItem {
    const genOf = (t: TypeId): Gen => registry.genOfType(t) ?? "prefix";
    const prefix: Range = keep.has("prefix") ? a.counts.prefix : [0, 0];
    const suffix: Range = keep.has("suffix") ? suffixRange(a) : [0, 0];
    const total: Range = [prefix[0] + suffix[0], prefix[1] + suffix[1]];

    const keptGuarantees = new Set<TypeId>();
    for (const t of guaranteedTypes(a)) if (keep.has(genOf(t))) keptGuarantees.add(t);
    const possible = new Set<TypeId>();
    for (const t of a.possible) if (keep.has(genOf(t))) possible.add(t);
    const tiers = new Map<TypeId, ReadonlySet<ModId>>();
    for (const [t, s] of a.tiers) if (keep.has(genOf(t))) tiers.set(t, s);

    // Every guaranteed metamod carrier on the stripped side is provably crafted
    // and provably gone, so drop it from the crafted count; any crafted mod on the
    // kept side may survive, so the lower bound falls to zero.
    let strippedCarriers = 0;
    for (const t of guaranteedTypes(a)) {
        if (!keep.has(genOf(t)) && registry.effectsOfType(t).length > 0) strippedCarriers++;
    }
    const crafted: Range = [0, Math.max(0, a.crafted[1] - strippedCarriers)];
    const presence = presenceFacts(a.bdd, keptGuarantees, excludedTypes(a));
    return settled({ ...a, counts: { total, prefix }, presence, possible, tiers, crafted });
}

/**
 * Apply an essence: reforge to Rare with one guaranteed mod (fixed per item
 * class) plus a random fill. Preconditions: Normal always, Rare only for ladder
 * tier ≥ 5, never Magic; the essence must cover the item's class. There is no
 * item-level gate, the guaranteed mod lands at its fixed tier regardless of
 * ilvl; only the random fill respects level caps.
 */
export function essence(a: AItem, spec: EssenceSpec, registry: Registry): TransferResult {
    // Essences (like fossils) cannot be used while a protection or cannot-roll
    // metamod is on the item; the multimod metamod alone does not block them.
    if (metamodBlocksSourced(a, registry)) return fail({ kind: "metamodBlocks" });
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
 * has none); the crafted-mod count below the limit (one, or three under an active
 * "Can have up to 3 Crafted Modifiers" metamod); and the mod's group not already
 * possibly present. Class fit is enforced upstream by `resolveBench`.
 */
export function bench(a: AItem, mod: Mod, registry: Registry): TransferResult {
    if (!hasOpenSlot(a, mod.gen)) return fail({ kind: "noOpenSlot", gen: mod.gen });
    // An item holds at most `cap` bench-crafted mods (1, or 3 under multimod). If
    // that many might already be present, another isn't provably safe.
    const cap = craftedCapOfState(a, registry);
    if (a.crafted[1] >= cap) return fail({ kind: "craftedLimit", cap });
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

// --- harvest (tag-directed crafting) --------------------------------------
//
// A harvest craft targets mods by category tag (`Mod.implicitTags`): fire,
// caster, life, … The guarantee it produces is DISJUNCTIVE — "at least one mod
// of the tag" — which folds into the presence BDD as one OR clause over the
// tagged types, never an enumerated outcome union. A tag spans many types, so
// that clause can be wide; `disjunctiveGuarantees`' variable guard simply skips
// extracting it (sound: it only under-claims).

/**
 * Harvest reforge: reroll to a fresh Rare (like chaos), guaranteeing at least
 * one mod carrying `tag`. Precondition: Rare, and at least one mod of the tag
 * can roll on this base/ilvl (an empty tagged pool is the grayed-out case in the
 * crafting UI).
 */
export function harvestReforge(a: AItem, tag: TagId, registry: Registry): TransferResult {
    if (a.rarity !== "rare") return wrongRarity("rare", a.rarity);
    // Tagged types the fresh reforge could lay down, drawn from the empty-item
    // pool (the widest, matching what `reroll` fills from).
    const tagged = taggedTypes(
        addableMods({ ...a, presence: a.bdd.TRUE }, undefined, registry),
        tag,
    );
    if (tagged.length === 0) return fail({ kind: "harvestEmptyPool", tag });
    // A "cannot be changed" metamod keeps its side; otherwise a full reforge.
    const shielded = protectedGens(a, registry);
    const rerolled =
        shielded.size > 0
            ? keepProtectedReroll(a, shielded, registry)
            : reroll(a, "rare", [4, 6], registry);
    return ok(withTaggedDisjunction(rerolled, tagged));
}

/**
 * Harvest augment (Craft of Exile's "Add/Remove"): add a mod carrying `tag` and
 * remove a random OTHER mod. Net affix count unchanged; no open slot needed
 * (the remove precedes the add). The removed mod is a random REMOVABLE one, so
 * every removable guarantee could be it and drops; the only surviving new fact
 * is "at least one mod of the tag" (the added mod, which is not the removed
 * "other"). Precondition: Rare, a removable mod present, and a non-empty tagged
 * pool.
 */
export function harvestAugment(a: AItem, tag: TagId, registry: Registry): TransferResult {
    if (a.rarity !== "rare") return wrongRarity("rare", a.rarity);
    // Remove a random removable mod, drawn only from the unprotected side: a
    // "prefixes cannot be changed" spares every prefix guarantee here. `annul`
    // and this share one removal notion, so protection folds in for free.
    const allowed = removalGens(a, undefined, registry);
    if (!hasRemovable(a, allowed)) return fail({ kind: "nothingToRemove" });
    const removed = removeOne(a, allowed, registry);
    // The tagged pool is taken AFTER the removal frees a slot.
    const addable = addableMods(removed, undefined, registry).filter((m) =>
        m.implicitTags.has(tag),
    );
    if (addable.length === 0) return fail({ kind: "harvestEmptyPool", tag });
    return ok(addTagged(removed, addable, tag));
}

/** The distinct ModTypes among `mods` carrying `tag`. */
function taggedTypes(mods: readonly Mod[], tag: TagId): TypeId[] {
    const out = new Set<TypeId>();
    for (const m of mods) if (m.implicitTags.has(tag)) out.add(m.type);
    return [...out];
}

/** AND "at least one of `types` is present" into the presence BDD. */
function withTaggedDisjunction(a: AItem, types: readonly TypeId[]): AItem {
    let clause = a.bdd.FALSE;
    for (const t of types) clause = a.bdd.or(clause, a.bdd.variable(t));
    return settled({ ...a, presence: a.bdd.and(a.presence, clause) });
}

/**
 * Additively lay down one mod drawn only from `added` (all carrying `tag`):
 * bump the count by one, admit the tagged types into `possible`/`tiers`, and
 * assert the tagged disjunction. Used by harvest augment after its removal.
 */
function addTagged(a: AItem, added: readonly Mod[], tag: TagId): AItem {
    const maxT = maxTotal("rare", a.base);
    const total: Range = [
        Math.min(a.counts.total[0] + 1, maxT),
        Math.min(a.counts.total[1] + 1, maxT),
    ];
    // The added mod could land in either generation, so the prefix range widens up.
    const prefix: Range = [a.counts.prefix[0], Math.min(a.counts.prefix[1] + 1, maxT)];
    const possible = new Set(a.possible);
    const tiers = new Map(a.tiers);
    for (const m of added) {
        possible.add(m.type);
        const cur = tiers.get(m.type);
        tiers.set(m.type, cur ? new Set([...cur, m.id]) : new Set([m.id]));
    }
    // An add removes nothing, so relax exclusions on the added types, then assert
    // that at least one of them is now present.
    const presence = admitAdd(a, added);
    return withTaggedDisjunction(
        { ...a, counts: { total, prefix }, presence, possible, tiers },
        taggedTypes(added, tag),
    );
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

/**
 * A reforge that respects protection (chaos / harvest reforge on a "cannot be
 * changed" item): keep the protected side's mods — guarantees, tier pins, and a
 * count floor — and reroll the unprotected side, with open protected slots free
 * to fill from the fresh pool. The metamod sits on the rerolled side, so it goes.
 */
function keepProtectedReroll(a: AItem, keep: ReadonlySet<Gen>, registry: Registry): AItem {
    const genOf = (t: TypeId): Gen => registry.genOfType(t) ?? "prefix";
    const pCap = sideCap("prefix", a.rarity, a.base);

    // A kept side keeps its floor (existing mods survive) and may fill to cap; a
    // rerolled side ranges over the whole 0..cap.
    const prefix: Range = [keep.has("prefix") ? a.counts.prefix[0] : 0, pCap];
    const suffixLo = keep.has("suffix") ? suffixRange(a)[0] : 0;
    const total: Range = [prefix[0] + suffixLo, maxTotal(a.rarity, a.base)];

    // Guarantees on the kept side survive; exclusions clear (a reforge or an
    // open-slot fill can introduce any mod).
    const kept = new Set<TypeId>();
    for (const t of guaranteedTypes(a)) if (keep.has(genOf(t))) kept.add(t);
    const presence = presenceFacts(a.bdd, kept, new Set());

    // The fresh pool feeds the rerolled side and any open kept-side slots.
    const fresh = addableMods({ ...a, presence: a.bdd.TRUE }, undefined, registry);
    const possible = new Set<TypeId>();
    const tiers = new Map<TypeId, ReadonlySet<ModId>>();
    for (const t of a.possible) if (keep.has(genOf(t))) possible.add(t);
    for (const [t, s] of a.tiers) if (keep.has(genOf(t))) tiers.set(t, s);
    for (const m of fresh) {
        possible.add(m.type);
        if (kept.has(m.type)) continue; // keep the kept side's pinned tier
        const cur = tiers.get(m.type);
        tiers.set(m.type, cur ? new Set([...cur, m.id]) : new Set([m.id]));
    }

    // The metamod (on the rerolled side) is gone; a crafted mod on the kept side
    // may survive — the same accounting as `scourKeeping`.
    let strippedCarriers = 0;
    for (const t of guaranteedTypes(a)) {
        if (!keep.has(genOf(t)) && registry.effectsOfType(t).length > 0) strippedCarriers++;
    }
    const crafted: Range = [0, Math.max(0, a.crafted[1] - strippedCarriers)];

    return settled({ ...a, counts: { total, prefix }, presence, possible, tiers, crafted });
}

// --- precondition predicates (must hold in EVERY arm) ---------------------

function hasOpenSlot(a: AItem, forcedGen: Gen | undefined): boolean {
    if (forcedGen === "prefix") return a.counts.prefix[1] < sideCap("prefix", a.rarity, a.base);
    if (forcedGen === "suffix") return suffixRange(a)[1] < sideCap("suffix", a.rarity, a.base);
    return a.counts.total[1] < maxTotal(a.rarity, a.base); // some slot open in every arm
}

function hasRemovable(a: AItem, allowed: ReadonlySet<Gen>): boolean {
    if (allowed.size === 0) return false; // every side protected → nothing to remove
    if (allowed.size === 2) return a.counts.total[0] >= 1; // any affix in every arm
    // A single allowed generation: that side must hold an affix in every arm.
    return allowed.has("prefix") ? a.counts.prefix[0] >= 1 : suffixRange(a)[0] >= 1;
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

function removeOne(a: AItem, allowed: ReadonlySet<Gen>, registry: Registry): AItem {
    const total: Range = [Math.max(0, a.counts.total[0] - 1), Math.max(0, a.counts.total[1] - 1)];
    const onlyPrefix = allowed.size === 1 && allowed.has("prefix");
    const onlySuffix = allowed.size === 1 && allowed.has("suffix");
    const prefix: Range = onlyPrefix
        ? [Math.max(0, a.counts.prefix[0] - 1), Math.max(0, a.counts.prefix[1] - 1)]
        : onlySuffix
          ? a.counts.prefix
          : [Math.max(0, a.counts.prefix[0] - 1), a.counts.prefix[1]];

    // A guarantee survives only if the removed affix could not have been it: a
    // guarantee in a generation the removal cannot reach (protected, or spared by
    // an omen) holds. Exclusions always survive (a removal never adds a mod).
    const presence = presenceFacts(
        a.bdd,
        survivingGuarantees(a, allowed, registry),
        excludedTypes(a),
    );
    // The removed affix might have been the crafted mod, so the lower bound drops.
    const crafted: Range = [Math.max(0, a.crafted[0] - 1), a.crafted[1]];
    const next: AItem = { ...a, counts: { total, prefix }, presence, crafted };
    return settled(next);
}

/** Guarantees the removal cannot reach: a guaranteed type whose generation is not
 *  in the removable set (protected, or the omen-spared side) survives. */
function survivingGuarantees(
    a: AItem,
    allowed: ReadonlySet<Gen>,
    registry: Registry,
): ReadonlySet<TypeId> {
    const out = new Set<TypeId>();
    for (const t of guaranteedTypes(a)) {
        if (!allowed.has(registry.genOfType(t) ?? "prefix")) out.add(t);
    }
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
