/**
 * Currency transfer functions: each operation is `AItem → (AItem | precondition
 * failure)`, folding the op's outcome summary straight into the abstract state
 * — the checker never holds a concrete item or an enumerated union. `forcedGen`
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
    excludedTypes,
    guaranteedTypes,
    normalize,
    presenceFacts,
    rarityCap,
    suffixRange,
} from "./astate.js";

/** Why an operation's precondition fails on the current state. */
export type PreconditionFailure =
    | { readonly kind: "wrongRarity"; readonly needed: Rarity; readonly actual: Rarity }
    | { readonly kind: "noOpenSlot"; readonly gen?: Gen }
    | { readonly kind: "modConflict"; readonly group: string }
    | { readonly kind: "nothingToRemove"; readonly gen?: Gen }
    | { readonly kind: "essenceRarity"; readonly tier: number; readonly actual: Rarity }
    | { readonly kind: "essenceClass"; readonly essence: string; readonly itemClass: ClassId };

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
    return ok(addOne(a, undefined, "rare", registry));
}

export function exalt(a: AItem, forcedGen: Gen | undefined, registry: Registry): TransferResult {
    if (a.rarity !== "rare") return wrongRarity("rare", a.rarity);
    if (!hasOpenSlot(a, forcedGen))
        return fail({ kind: "noOpenSlot", ...(forcedGen && { gen: forcedGen }) });
    return ok(addOne(a, forcedGen, "rare", registry));
}

export function annul(a: AItem, forcedGen: Gen | undefined, registry: Registry): TransferResult {
    // No rarity gate — annul works on anything with a removable mod, and a
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
    return ok(reroll(a, "rare", [4, 6], registry));
}

/** Chaos Orb: reforge a Rare item (4–6 fresh mods). */
export function chaos(a: AItem, registry: Registry): TransferResult {
    if (a.rarity !== "rare") return wrongRarity("rare", a.rarity);
    return ok(reroll(a, "rare", [4, 6], registry));
}

/** Orb of Scouring: strip every mod, returning the item to Normal. Scouring an
 *  item with no mods is wasted currency, so that fails the precondition. */
export function scour(a: AItem): TransferResult {
    if (!hasRemovable(a, undefined)) return fail({ kind: "nothingToRemove" });
    const next: AItem = {
        ...a,
        rarity: "normal",
        total: [0, 0],
        prefix: [0, 0],
        presence: a.bdd.TRUE,
        possible: new Set(),
        tiers: new Map(),
    };
    return ok(normalize(next) ?? next);
}

/**
 * Apply an essence: reforge to Rare with one guaranteed mod (fixed per item
 * class) plus a random fill. Preconditions: Normal always, Rare only for ladder
 * tier ≥ 5, never Magic; the essence must cover the item's class. There is no
 * item-level gate — the guaranteed mod lands at its fixed tier regardless of
 * ilvl; only the random fill respects level caps.
 */
export function essence(a: AItem, spec: EssenceSpec, registry: Registry): TransferResult {
    if (a.rarity === "magic" || (a.rarity === "rare" && spec.tier < 5)) {
        return fail({ kind: "essenceRarity", tier: spec.tier, actual: a.rarity });
    }
    const modId = spec.grants.get(a.base.itemClass);
    const guaranteedMod = modId && registry.catalog.find((m) => m.id === modId);
    if (!guaranteedMod) {
        return fail({ kind: "essenceClass", essence: spec.name, itemClass: a.base.itemClass });
    }

    // The random fill: reforge to a full Rare (4–6 mods) from the normal pool,
    // capped by both the item level and the essence's max random-mod level.
    const cap = rarityCap("rare");
    const total: Range = [4, 2 * cap];
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
        total,
        prefix: [Math.max(0, total[0] - cap), Math.min(cap, total[1])],
        presence: a.bdd.TRUE,
        possible,
        tiers,
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
    const total: Range = [Math.max(a.total[0], 1), a.total[1]];
    const prefix: Range =
        mod.gen === "prefix"
            ? [Math.max(a.prefix[0], 1), a.prefix[1]] // ≥ 1 prefix
            : [a.prefix[0], Math.min(a.prefix[1], total[1] - 1)]; // ≥ 1 suffix
    const next: AItem = { ...a, presence, tiers, possible, total, prefix };
    return normalize(next) ?? next;
}

/**
 * Apply a crafting-bench mod: add the specific `mod`, guaranteed and pinned.
 * Preconditions: an open slot in its generation (a Normal item, cap 0,
 * naturally has none), and the mod's group not already possibly present. Class
 * fit is enforced upstream by `resolveBench`; the one-crafted-mod limit is not
 * modelled yet.
 */
export function bench(a: AItem, mod: Mod, registry: Registry): TransferResult {
    if (!hasOpenSlot(a, mod.gen)) return fail({ kind: "noOpenSlot", gen: mod.gen });
    // If any possibly-present type shares a family with the bench mod, the add
    // isn't provably safe (an item holds one mod per group). A conflict hidden
    // behind an anonymous "random" affix is not caught — known modelling gap.
    if (sharesFamilyWithPossible(a, mod, registry)) {
        return fail({ kind: "modConflict", group: registry.typeLabel(mod.type) });
    }
    const total: Range = [a.total[0] + 1, a.total[1] + 1];
    const prefix: Range = mod.gen === "prefix" ? [a.prefix[0] + 1, a.prefix[1] + 1] : a.prefix;
    return ok(withGuaranteed({ ...a, total, prefix }, mod));
}

/** Does any possibly-present type share a family (mod group) with `mod`? */
function sharesFamilyWithPossible(a: AItem, mod: Mod, registry: Registry): boolean {
    for (const type of a.possible) {
        const fams = registry.familiesOfType(type);
        for (const f of mod.families) if (fams.has(f)) return true;
    }
    return false;
}

/**
 * A reforge: discard every current mod and lay down a fresh set of the given
 * rarity and count range. Nothing stays guaranteed; the base's full add-pool
 * becomes `possible`; exclusions clear. Shared by alteration/alchemy/chaos.
 */
function reroll(a: AItem, rarity: Rarity, total: Range, registry: Registry): AItem {
    const cap = rarityCap(rarity);
    const prefix: Range = [Math.max(0, total[0] - cap), Math.min(cap, total[1])];
    // An empty item of this base has the widest pool — a sound over-approximation.
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
        total,
        prefix,
        presence: a.bdd.TRUE, // reforge: nothing guaranteed, nothing excluded
        possible,
        tiers,
    };
    return normalize(next) ?? next;
}

// --- precondition predicates (must hold in EVERY arm) ---------------------

function hasOpenSlot(a: AItem, forcedGen: Gen | undefined): boolean {
    const cap = rarityCap(a.rarity);
    if (forcedGen === "prefix") return a.prefix[1] < cap; // prefix full in no arm
    if (forcedGen === "suffix") return suffixRange(a)[1] < cap;
    return a.total[1] < 2 * cap; // some slot open in every arm
}

function hasRemovable(a: AItem, forcedGen: Gen | undefined): boolean {
    if (forcedGen === "prefix") return a.prefix[0] >= 1; // a prefix present in every arm
    if (forcedGen === "suffix") return suffixRange(a)[0] >= 1;
    return a.total[0] >= 1;
}

// --- the add / remove summaries -------------------------------------------

function addOne(a: AItem, forcedGen: Gen | undefined, rarity: Rarity, registry: Registry): AItem {
    const total: Range = [a.total[0] + 1, a.total[1] + 1];
    const prefix: Range =
        forcedGen === "prefix"
            ? [a.prefix[0] + 1, a.prefix[1] + 1]
            : forcedGen === "suffix"
              ? a.prefix
              : [a.prefix[0], a.prefix[1] + 1]; // could land in either generation

    // Additive: every prior mod survives, so guarantees and tier constraints
    // hold. Each pool type becomes `possible`; and since a random add could be
    // any of them, no type can stay excluded — rebuild presence from the
    // guarantees alone.
    const added = addableMods(a, forcedGen, registry);
    const possible = new Set(a.possible);
    const tiers = new Map(a.tiers);
    for (const m of added) {
        possible.add(m.type);
        const cur = tiers.get(m.type);
        tiers.set(m.type, cur ? new Set([...cur, m.id]) : new Set([m.id]));
    }
    const presence = presenceFacts(a.bdd, guaranteedTypes(a), []);
    const next: AItem = { ...a, rarity, total, prefix, presence, possible, tiers };
    return normalize(next) ?? next;
}

function removeOne(a: AItem, forcedGen: Gen | undefined, registry: Registry): AItem {
    const total: Range = [Math.max(0, a.total[0] - 1), Math.max(0, a.total[1] - 1)];
    const prefix: Range =
        forcedGen === "prefix"
            ? [Math.max(0, a.prefix[0] - 1), Math.max(0, a.prefix[1] - 1)]
            : forcedGen === "suffix"
              ? a.prefix
              : [Math.max(0, a.prefix[0] - 1), a.prefix[1]];

    // A guarantee survives only if the removed affix could not have been it:
    // a gen-forced removal spares the other generation; an unforced one could
    // take anything. Exclusions always survive (a removal never adds a mod).
    const presence = presenceFacts(
        a.bdd,
        survivingGuarantees(a, forcedGen, registry),
        excludedTypes(a),
    );
    const next: AItem = { ...a, total, prefix, presence };
    return normalize(next) ?? next;
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
