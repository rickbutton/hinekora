/**
 * The rules the metamods impose on a method (operations.md §2, Metamod §
 * Rules and Exceptions): read once, from the modifiers an item carries when
 * the method starts, and changed for the rest of the method only by
 * `unprotect` and `keep`. One record for the symbolic frame and the
 * reference, so the two read the same rules.
 */
import type { Op } from "./ops/types.js";
import { craftedCapOf, type Effect } from "../model/effects.js";
import type { Gen } from "../model/ids.js";
import type { Mod } from "../model/mod.js";

export type CannotRoll = Extract<Effect, { kind: "poolRestrict" }>;

export interface Rules {
    /** Sides shielded from removal and reroll by "cannot be changed". */
    readonly protected: ReadonlySet<Gen>;
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

/** The rules under the effects an item's modifiers carry. */
export function rulesOf(effects: readonly Effect[], ops: readonly Op[]): Rules {
    const protectedGens = new Set<Gen>();
    for (const e of effects) if (e.kind === "protect") protectedGens.add(e.gen);
    return {
        protected: protectedGens,
        craftedCap: craftedCapOf(effects),
        blocksSourced: protectedGens.size > 0 || effects.some((e) => e.kind === "poolRestrict"),
        governed: true,
        strands: usesStrands(ops),
    };
}

function usesStrands(ops: readonly Op[]): boolean {
    return ops.some(
        (op) => op.kind === "strands" || (op.kind === "either" && op.branches.some(usesStrands)),
    );
}

/** After `unprotect`. */
export function unprotected(r: Rules): Rules {
    return { ...r, protected: new Set(), governed: false };
}

/** After `keep`: that side alone is kept, in place of the item's protections
 *  (Metamod § Rules and Exceptions: the Eldritch Chaos Orb). */
export function keeping(r: Rules, gen: Gen): Rules {
    return { ...r, protected: new Set([gen]) };
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
