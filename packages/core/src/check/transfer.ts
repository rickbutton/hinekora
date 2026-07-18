/**
 * Currency transfer functions over the abstract state (brief §5).
 *
 * Each operation is a function `AItem → (AItem | precondition failure)`. These
 * are the abstract counterparts of the concrete currency library (§4 typing
 * rules / the M2 `currency` module): where M2 produced a symbolic `Outcome` from
 * a concrete item, these fold that outcome's *summary* straight into the
 * threaded `AItem`, so the checker never holds a concrete item or an enumerated
 * union.
 *
 * `forcedGen` is set by an active omen (§10.2): it constrains an add/remove to a
 * single generation, which both tightens the counts and changes which
 * guarantees survive.
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
    // Annulment works on any item with a removable mod — Magic OR Rare. There is
    // no rarity gate: a Normal item has no mods, so `hasRemovable` fails for it
    // with the accurate "nothing to remove" reason on its own.
    if (!hasRemovable(a, forcedGen))
        return fail({ kind: "nothingToRemove", ...(forcedGen && { gen: forcedGen }) });
    return ok(removeOne(a, forcedGen, registry));
}

const wrongRarity = (needed: Rarity, actual: Rarity): TransferResult =>
    fail({ kind: "wrongRarity", needed, actual });

// --- the other common currencies ------------------------------------------
//
// These reuse the same two primitives as the base four — an ADDITIVE add
// (`addOne`) and a REFORGE (`reroll`, below) — so nothing here enumerates
// outcomes; each folds into the same symbolic summary. Semantics are hand-
// modelled (the intent, from the game descriptions); the currency catalog only
// supplies display text.

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

/**
 * Orb of Scouring: strip every mod, returning the item to Normal. Precondition
 * is "has a removable mod" (`nothingToRemove` otherwise) — scouring an item with
 * no mods is wasted currency, which is exactly what the checker exists to catch.
 */
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
 * Apply an essence: reforge to Rare with one GUARANTEED mod (fixed per item
 * class) plus a random fill. Preconditions: **Normal** always, **Rare** only for
 * ladder tier ≥ 5, **never Magic**; the essence must cover the item's class.
 * There is NO item-level gate — the guaranteed mod is forced at its fixed tier
 * regardless of ilvl. This is the first op that grows `guaranteed`.
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

    // Reforge to a full Rare (4–6 mods) — the RANDOM fill — from the normal pool,
    // capped by BOTH the item level and the essence's max random-mod level.
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
    // …then FORCE the essence's guaranteed mod present, pinned to its exact tier.
    return ok(withGuaranteed(reforged, guaranteedMod));
}

/**
 * Force a SPECIFIC mod present on a state: it becomes guaranteed (`presence`),
 * pinned to that exact tier (the overlay), added to `possible`, and its
 * generation gets ≥ 1 affix (and total ≥ 1). The total count is the caller's to
 * set — an essence reforges to a range first; a bench add bumps it by one.
 * Shared by `essence()` and `bench()`.
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
 * Apply a crafting-bench mod: add the specific `mod` (guaranteed, pinned to its
 * exact tier) in its generation. Preconditions: (1) an OPEN slot in that
 * generation — which a Normal item (cap 0) never has, so it naturally can't be
 * benched; (2) the mod's GROUP is not already (possibly) present, since an item
 * holds at most one mod per group. The mod's class fit is enforced upstream by
 * `resolveBench`. (The one-crafted-mod limit is not modelled yet.)
 */
export function bench(a: AItem, mod: Mod, registry: Registry): TransferResult {
    if (!hasOpenSlot(a, mod.gen)) return fail({ kind: "noOpenSlot", gen: mod.gen });
    // Group exclusivity: if any type that MAY be present shares a family with the
    // bench mod, the item might already carry that group — so the add isn't
    // provably safe. (An anonymous "random" affix carries no type, so a conflict
    // hidden behind one is not caught — a known modelling gap.)
    if (sharesFamilyWithPossible(a, mod, registry)) {
        return fail({ kind: "modConflict", group: registry.typeLabel(mod.type) });
    }
    // Additive: +1 in the mod's generation, then force it present & pinned.
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
 * A REFORGE: discard every current mod and lay down a fresh set of the given
 * rarity and affix-count range. Nothing stays `guaranteed`; the base's full
 * add-pool becomes `possible` (with the tier overlay recording which specific
 * mods each type could be), and `excluded` clears. Shared by alteration /
 * alchemy / chaos — the counterpart of `addOne` for the "all new mods" ops.
 */
function reroll(a: AItem, rarity: Rarity, total: Range, registry: Registry): AItem {
    const cap = rarityCap(rarity);
    const prefix: Range = [Math.max(0, total[0] - cap), Math.min(cap, total[1])];
    // Over-approximate the pool from an EMPTY item of this base (no present mods
    // ⇒ the widest pool), exactly as `addableMods` does for an add.
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

    // ADDITIVE: every prior mod survives, so existing guarantees (and tier
    // constraints) hold. The added mod is one of the pool, so each pool type
    // becomes `possible` and its tier overlay gains the specific pool mods it
    // could be; a random add means we can no longer be sure any type is absent, so
    // rebuild presence from the guarantees alone (exclusions dropped).
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

    // A guarantee survives a removal only if the removed affix could not have
    // been it: under a gen-forced removal, the OTHER generation's guarantees are
    // safe; an unforced removal could take any affix, so nothing stays guaranteed.
    // Exclusions survive (a removal never adds a mod), so they carry over.
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
 * Over-approximate the specific mods an add could introduce. Built by running
 * the real `pool` against a synthetic item carrying only the guaranteed mods
 * (fewer present mods ⇒ a superset of every arm's real pool), at the maximal
 * (rare) slot caps. Restricted to `forcedGen` when the add is omen-directed.
 * Returns mods (not just types) so the tier overlay can record which tiers.
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
