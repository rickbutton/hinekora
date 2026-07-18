/**
 * Outcomes — the symbolic tagged-union machinery (typing rules §4). An
 * `Outcome` is a description of how an item changed ("prior item + one mod
 * drawn from `candidates`"), never a materialized list of the concrete states
 * it could become; the summary queries below answer without enumerating.
 * `arms()` does enumerate, but only on the on-demand rendering/probability
 * path — chaining consumes a description, not an expansion.
 */
import type { Gen, Rarity, TypeId } from "../model/ids.js";
import type { Item } from "../model/item.js";
import { presentTypes } from "../model/item.js";
import type { Mod } from "../model/mod.js";
import type { PoolCandidate } from "../pool/pool.js";

/** A deterministic result: exactly one possible item (one-arm degenerate union). */
export interface CertainOutcome {
    readonly kind: "certain";
    readonly item: Item;
}

/**
 * "Add one mod drawn from `candidates` to `base`." `base` already carries the
 * RESULT rarity (see the currency module's promotion note), so every arm is
 * `base` plus one candidate; every mod already on `base` survives.
 */
export interface AddOneOutcome {
    readonly kind: "addOne";
    readonly base: Item;
    readonly candidates: readonly PoolCandidate[];
}

/** "Remove exactly one affix drawn from `removables` from `base`" (uniform). */
export interface RemoveOneOutcome {
    readonly kind: "removeOne";
    readonly base: Item;
    readonly removables: readonly Mod[];
}

export type Outcome = CertainOutcome | AddOneOutcome | RemoveOneOutcome;

// --- Constructors ---------------------------------------------------------

export const certain = (item: Item): CertainOutcome => ({ kind: "certain", item });

export const addOne = (base: Item, candidates: readonly PoolCandidate[]): AddOneOutcome => ({
    kind: "addOne",
    base,
    candidates,
});

export const removeOne = (base: Item, removables: readonly Mod[]): RemoveOneOutcome => ({
    kind: "removeOne",
    base,
    removables,
});

// --- Small pure item edits (arm construction) -----------------------------

function withMod(it: Item, m: Mod): Item {
    return m.gen === "prefix"
        ? { ...it, prefixes: [...it.prefixes, m] }
        : { ...it, suffixes: [...it.suffixes, m] };
}

function withoutMod(it: Item, m: Mod): Item {
    return m.gen === "prefix"
        ? { ...it, prefixes: it.prefixes.filter((x) => x.id !== m.id) }
        : { ...it, suffixes: it.suffixes.filter((x) => x.id !== m.id) };
}

// --- Enumeration (on-demand: render / probability, not the hot path) -------

/** Materialize every arm. Bounded by |candidates| or |removables|. */
export function arms(o: Outcome): readonly Item[] {
    switch (o.kind) {
        case "certain":
            return [o.item];
        case "addOne":
            return o.candidates.map((c) => withMod(o.base, c.mod));
        case "removeOne":
            return o.removables.map((m) => withoutMod(o.base, m));
    }
}

/** Number of arms, without building them. */
export function armCount(o: Outcome): number {
    switch (o.kind) {
        case "certain":
            return 1;
        case "addOne":
            return o.candidates.length;
        case "removeOne":
            return o.removables.length;
    }
}

/** An outcome is inhabited iff it has at least one arm (empty pool / nothing
 *  removable ⇒ uninhabited, which the checker reports as an error). */
export function isInhabited(o: Outcome): boolean {
    return armCount(o) > 0;
}

/** The rarity shared by every arm (every op fixes the result rarity). */
export function outcomeRarity(o: Outcome): Rarity {
    return o.kind === "certain" ? o.item.rarity : o.base.rarity;
}

// --- Presence queries (the intensional floor / possibility) ---------------

/**
 * ModTypes guaranteed present in EVERY arm — the floor narrowing can rely on.
 * addOne keeps the base's whole present set (why exalt preserves a mod);
 * removeOne subtracts every removable type (why annul risks one).
 */
export function guaranteedPresent(o: Outcome): ReadonlySet<TypeId> {
    switch (o.kind) {
        case "certain":
            return presentTypes(o.item);
        case "addOne":
            return presentTypes(o.base);
        case "removeOne": {
            const removableTypes = new Set(o.removables.map((m) => m.type));
            return new Set([...presentTypes(o.base)].filter((t) => !removableTypes.has(t)));
        }
    }
}

/**
 * ModTypes present in AT LEAST ONE arm — "could this outcome have X". With
 * exactly one removable affix, its type is removed in the sole arm and so
 * cannot survive.
 */
export function possiblePresent(o: Outcome): ReadonlySet<TypeId> {
    switch (o.kind) {
        case "certain":
            return presentTypes(o.item);
        case "addOne": {
            const acc = new Set<TypeId>(presentTypes(o.base));
            for (const c of o.candidates) acc.add(c.mod.type);
            return acc;
        }
        case "removeOne": {
            const present = presentTypes(o.base);
            if (o.removables.length === 1) {
                const soleType = o.removables[0]?.type;
                return new Set([...present].filter((t) => t !== soleType));
            }
            return present;
        }
    }
}

/** Is `type` present in EVERY arm? (Narrowing's "provably has X".) */
export function guarantees(o: Outcome, type: TypeId): boolean {
    return guaranteedPresent(o).has(type);
}

/** Is `type` present in SOME arm? (Does a `has X` branch exist to narrow into?) */
export function mayHave(o: Outcome, type: TypeId): boolean {
    return possiblePresent(o).has(type);
}

// --- Count ranges (symbolic, no arm construction) -------------------------

type Range = readonly [min: number, max: number];

function countRange(o: Outcome, gen: Gen): Range {
    const base = o.kind === "certain" ? o.item : o.base;
    const have = gen === "prefix" ? base.prefixes.length : base.suffixes.length;

    switch (o.kind) {
        case "certain":
            return [have, have];
        case "addOne": {
            if (o.candidates.length === 0) return [have, have];
            const some = o.candidates.some((c) => c.mod.gen === gen);
            const every = o.candidates.every((c) => c.mod.gen === gen);
            // An arm adds to `gen` iff its candidate is of `gen`.
            return [have + (every ? 1 : 0), have + (some ? 1 : 0)];
        }
        case "removeOne": {
            if (o.removables.length === 0) return [have, have];
            const some = o.removables.some((m) => m.gen === gen);
            const every = o.removables.every((m) => m.gen === gen);
            // An arm subtracts from `gen` iff the removed affix is of `gen`.
            return [have - (some ? 1 : 0), have - (every ? 1 : 0)];
        }
    }
}

export const prefixCountRange = (o: Outcome): Range => countRange(o, "prefix");
export const suffixCountRange = (o: Outcome): Range => countRange(o, "suffix");
