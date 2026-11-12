/**
 * The rules the metamods impose on a method (operations.md §2, Metamod §
 * Rules and Exceptions): read once, from the modifiers an item carries when
 * the method starts, and changed for the rest of the method only by
 * `unprotect` and `keep`. The reference states them apart
 * (reference/rules.ts), so its exactness tests check these too.
 */
import type { Op } from "./ops/types.js";
import { craftedCapOf, type Effect } from "../model/effects.js";
import type { Gen, TypeId } from "../model/ids.js";
import type { Mod } from "../model/mod.js";

export type CannotRoll = Extract<Effect, { kind: "poolRestrict" }>;

/** What the protections keep from removal and reroll. */
export interface Protection {
    /** Sides kept whole: "Prefixes Cannot Be Changed", or a partial protection
     *  on a side holding no more modifiers than it keeps. */
    readonly sides: ReadonlySet<Gen>;
    /** The modifiers a partial protection keeps one by one, by type: the
     *  choice made for this use of the method, where the side holds more. */
    readonly types: ReadonlySet<TypeId>;
    /** The partial protections behind that choice (`partialProtections`): a
     *  removal after an add in the same method chooses afresh among the
     *  modifiers then present (`QUESTIONS.md` Q128). */
    readonly partial: ReadonlyMap<Gen, readonly number[]>;
}

export const UNPROTECTED: Protection = { sides: new Set(), types: new Set(), partial: new Map() };

/** Does a protection keep the modifier on this row? */
export function keeps(p: Protection, row: Mod): boolean {
    return p.sides.has(row.gen) || p.types.has(row.type);
}

/** A name for all that `keeps` reads of a protection: a relation built on
 *  `keeps` can be shared by the protections of one name. */
export function keptKey(p: Protection): string {
    return `${[...p.sides].sort().join(",")}/${[...p.types].sort().join(",")}`;
}

export interface Rules {
    readonly protected: Protection;
    /** The crafted-modifier limit (one, or three under the multimod). */
    readonly craftedCap: number;
    /** A protection or cannot-roll metamod prevents an essence or a fossil.
     *  No other rule reads a cannot-roll metamod: a fill honours the carriers
     *  on the item as it draws (one a reforge strips restricts nothing, Metamod
     *  § Rules and Exceptions, the Chaos Orb's row), and no removal spares
     *  what one bars (`Selector`). */
    readonly blocksSourced: boolean;
    /** Whether the metamods govern the method: false after `unprotect`, which
     *  then also empties `protected` (a Tainted Chaos Orb, `QUESTIONS.md`
     *  Q33). It says nothing to a fill, which reads the carriers on the item
     *  as it draws either way. */
    readonly governed: boolean;
    /** The method uses memory strands up, so its fills lay down only the
     *  tiers the strands allow (Memory strand § Crafting methods consuming
     *  memory strands). */
    readonly strands: boolean;
}

export type RuleField = keyof Rules;

/** How a use of the method settles the item's partial protections: the sides
 *  kept whole for holding no more than they keep, and the modifiers chosen on
 *  the others. */
export interface Choice {
    readonly sides: readonly Gen[];
    readonly types: readonly TypeId[];
}

export const NO_CHOICE: Choice = { sides: [], types: [] };

/** The rules under the effects an item's modifiers carry, its partial
 *  protections settled by `choice`. */
export function rulesOf(effects: readonly Effect[], ops: readonly Op[], choice = NO_CHOICE): Rules {
    const sides = new Set<Gen>(choice.sides);
    for (const e of effects) if (e.kind === "protect") sides.add(e.gen);
    return {
        protected: { sides, types: new Set(choice.types), partial: partialProtections(effects) },
        craftedCap: craftedCapOf(effects),
        // A partial protection prevents what a full one does (QUESTIONS.md Q128).
        blocksSourced: effects.some((e) => e.kind !== "craftedCap"),
        governed: true,
        strands: usesStrands(ops),
    };
}

/** By side, the counts of modifiers the effects' partial protections may
 *  keep, ascending; none on a side a full protection keeps whole. Two on one
 *  side may keep the count of either or their sum: the wiki does not say, and
 *  each reading is an outcome (`QUESTIONS.md` Q128). */
export function partialProtections(
    effects: readonly Effect[],
): ReadonlyMap<Gen, readonly number[]> {
    const whole = new Set(effects.flatMap((e) => (e.kind === "protect" ? [e.gen] : [])));
    const carried = new Map<Gen, number[]>();
    for (const e of effects) {
        if (e.kind !== "protectSome" || whole.has(e.gen)) continue;
        carried.set(e.gen, [...(carried.get(e.gen) ?? []), e.count]);
    }
    const out = new Map<Gen, readonly number[]>();
    for (const [gen, counts] of carried) {
        const sum = counts.length > 1 ? [counts.reduce((a, b) => a + b, 0)] : [];
        out.set(
            gen,
            [...new Set([...counts, ...sum])].sort((a, b) => a - b),
        );
    }
    return out;
}

function usesStrands(ops: readonly Op[]): boolean {
    return ops.some(
        (op) => op.kind === "strands" || (op.kind === "either" && op.branches.some(usesStrands)),
    );
}

/** After `unprotect`. */
export function unprotected(r: Rules): Rules {
    return { ...r, protected: UNPROTECTED, governed: false };
}

/** After `keep`: that side alone is kept, in place of the item's protections
 *  (Metamod § Rules and Exceptions: the Eldritch Chaos Orb). */
export function keeping(r: Rules, gen: Gen): Rules {
    return { ...r, protected: { sides: new Set([gen]), types: new Set(), partial: new Map() } };
}

/** Every choice of `n` of the items, in order. */
export function subsetsOf<T>(xs: readonly T[], n: number): T[][] {
    if (n === 0) return [[]];
    return xs.flatMap((x, i) => subsetsOf(xs.slice(i + 1), n - 1).map((rest) => [x, ...rest]));
}

// --- what a method reads -------------------------------------------------------------

/** The effects that decide the fields a method reads; the rest change nothing it does. */
export function relevantEffects(
    effects: readonly Effect[],
    reads: ReadonlySet<RuleField>,
): Effect[] {
    const sourced = reads.has("blocksSourced");
    return effects.filter((e) => {
        switch (e.kind) {
            case "protect":
            case "protectSome":
                return reads.has("protected") || sourced;
            case "poolRestrict":
                return sourced;
            case "craftedCap":
                return reads.has("craftedCap");
        }
    });
}

const restricts = new WeakMap<(m: Mod) => boolean, number>();
let restrictCount = 0;

/** A name for an effect by what it does: two rows carrying equal effects share it. */
export function effectKey(e: Effect): string {
    switch (e.kind) {
        case "protect":
            return `protect:${e.gen}`;
        case "protectSome":
            return `protect:${e.gen}:${e.count}`;
        case "craftedCap":
            return `cap:${e.cap}`;
        case "poolRestrict": {
            let id = restricts.get(e.allows);
            if (id === undefined) restricts.set(e.allows, (id = ++restrictCount));
            return `restrict:${id}`;
        }
    }
}

export function effectsKey(effects: readonly Effect[]): string {
    return [...new Set(effects.map(effectKey))].sort().join("|");
}
