/**
 * Removing modifiers on one concrete item: the definition the symbolic
 * removals (check/ops/remove.ts) are held equal to.
 *
 * - A fractured modifier is never removed (Fractured item: "cannot be
 *   removed (by Orb of Annulment or Orb of Scouring, etc.)"), and a modifier
 *   on a side `Rules.protected` names is kept (Metamod § Rules and
 *   Exceptions). A modifier's side is its row's.
 * - `strip`: every other modifier goes; the rarity is the next operation's.
 * - `remove` "random": one modifier goes, any one in reach: on its side (both
 *   without `gen`) and not fractured. A cannot-roll metamod spares nothing:
 *   it does not keep an Orb of Annulment off a caster or attack modifier
 *   (Version 3.30.0, Item Changes), and the Metamod table's "Ignored" and
 *   "Does not protect" say the same of the Orb of Dominance, the Veiled Orb,
 *   the Harvest augment's removal and the beastcraft recipes. That the
 *   Eldritch Orb of Annulment follows the Orb of Annulment is the project's
 *   owner's ruling on the 3.30 notes, which name only "some Currencies …
 *   such as Orbs of Annulment"; the wiki's Metamod table still lists it as
 *   "Respected". For the Tainted Exalted Orb, which neither names, it is
 *   assumed (QUESTIONS.md Q122). The
 *   protections are reference/rules.ts's. A removal limited to a
 *   protected side leaves the item as it is: the Metamod table's rule for
 *   the two beastcraft recipes ("Will add without removing"); the Eldritch
 *   Orb of Annulment, the other removal of one side, the library refuses
 *   there (`unprotectedSide`). With nothing in reach the item is stuck
 *   (`removable` is the library's check).
 * - `addAnother`: one draw as `add` lays it (reference/ops/fill.ts), on the
 *   item as it stands, then one modifier in reach goes that is not the one
 *   just laid (Harvest crafting, the lead; Metamod § Rules and Exceptions:
 *   "Add a new [Type] modifier and remove another random modifier"). That
 *   the add comes first is the library's observation in game
 *   (check/library.ts `harvestAugmentOps`); a partial protection chooses for
 *   the removal afresh (reference/rules.ts `rechosen`). An item whose rarity
 *   holds no modifier has nothing to remove and is stuck.
 * - `remove` "influenced" and `elevate`, the Orb of Dominance (Orb of
 *   Dominance § Mechanics): one influenced modifier in reach goes, then one
 *   in reach is upgraded (ops/remove.ts `elevations`), so they are different
 *   modifiers. Assumed, the wiki silent: the removal comes first and the
 *   upgrade takes one of those left; a fractured influenced modifier is out
 *   of reach; a modifier whose upgrade the item could not hold (an elevated
 *   row of the other side, that side full) is not one the orb can upgrade,
 *   and an item with none it can upgrade is stuck.
 */
import type { Selector } from "../../ops/types.js";
import { rollRange } from "../../values.js";
import type { Gen } from "../../../model/ids.js";
import type { Mod } from "../../../model/mod.js";
import { addDraws } from "../../ops/fill.js";
import { InternalError, NotImplementedError } from "../../ops/handler.js";
import {
    elevations,
    influenceView,
    type InfluenceView,
    isInfluenced,
    PROTECTED,
    AUGMENT_READS,
} from "../../ops/remove.js";
import type { Protection, Rules } from "../../rules.js";
import { keeps, reachSides, rechosen } from "../rules.js";
import { type CItem, type CMod, type RefCtx, rowOf } from "../item.js";
import { isWellFormed } from "../wellformed.js";
import type { RefCheckTable, RefCompoundTable, RefTransformTable } from "./handler.js";
import { drawOne, eligible } from "./pools.js";

type Random = Extract<Selector, { kind: "random" }>;

/** The view of the item an influence test reads. */
function viewOf(ctx: RefCtx, item: CItem): InfluenceView {
    return influenceView(
        ctx,
        item.influences,
        item.mods.flatMap((m) => [...rowOf(ctx, m).addsTags]),
    );
}

function sideOf(ctx: RefCtx, m: CMod): Gen {
    return rowOf(ctx, m).gen;
}

/** May a removal limited to these sides take the modifier: on one, not
 *  fractured, and not one a partial protection keeps? */
function inReach(ctx: RefCtx, m: CMod, sides: readonly Gen[], p: Protection): boolean {
    return !m.fractured && sides.includes(sideOf(ctx, m)) && !keeps(p, rowOf(ctx, m));
}

/** The modifiers a random removal reaches on the item, `spared` excepted. */
function randomReach(ctx: RefCtx, item: CItem, sel: Random, p: Protection, spared?: CMod): CMod[] {
    const sides = reachSides(sel.gen, p);
    return item.mods.filter((m) => m !== spared && inReach(ctx, m, sides, p));
}

const without = (item: CItem, m: CMod): CItem => ({
    ...item,
    mods: item.mods.filter((x) => x !== m),
});

function removeRandom(
    ctx: RefCtx,
    item: CItem,
    sel: Random,
    p: Protection,
    spared?: CMod,
): CItem[] {
    if (sel.gen !== undefined && reachSides(sel.gen, p).length === 0) return [item];
    return randomReach(ctx, item, sel, p, spared).map((m) => without(item, m));
}

/** The influenced modifiers the Orb of Dominance reaches: on a side no
 *  metamod protects, not fractured. */
function influencedReach(ctx: RefCtx, item: CItem, rules: Rules): CMod[] {
    const v = viewOf(ctx, item);
    const sides = reachSides(undefined, rules.protected);
    return item.mods.filter(
        (m) => inReach(ctx, m, sides, rules.protected) && isInfluenced(rowOf(ctx, m), v),
    );
}

/** Every value of a row's span (whole numbers, as the catalogues hold);
 *  none for a row with no number. */
function valuesOfRow(row: Mod): (number | undefined)[] {
    const span = row.text === undefined ? undefined : rollRange(row.text);
    if (span === undefined) return [undefined];
    const out: number[] = [];
    for (let x = span[0]; x <= span[1]; x++) out.push(x);
    return out;
}

/** The modifier upgraded, at any value of what it becomes (Orb of Dominance:
 *  "Attempting to upgrade an Elevated Modifier rerolls its values"), its
 *  marks kept, where the item holds what it becomes. */
function elevate(ctx: RefCtx, item: CItem, rules: Rules): CItem[] {
    const v = viewOf(ctx, item);
    const out: CItem[] = [];
    for (const m of influencedReach(ctx, item, rules)) {
        for (const to of elevations(ctx, rowOf(ctx, m), v)) {
            for (const value of valuesOfRow(to)) {
                const next: CItem = {
                    ...item,
                    mods: item.mods.map((x) => (x === m ? { ...m, row: to.id, value } : x)),
                };
                if (isWellFormed(next, ctx)) out.push(next);
            }
        }
    }
    return out;
}

export const transforms: RefTransformTable = {
    strip: {
        reads: ["protected"],
        apply: (_op, item, { ctx, rules }) => {
            const sides = reachSides(undefined, rules.protected);
            return [
                {
                    ...item,
                    mods: item.mods.filter((m) => !inReach(ctx, m, sides, rules.protected)),
                },
            ];
        },
    },
    "remove:random": {
        reads: PROTECTED,
        apply: (op, item, { ctx, rules }) => removeRandom(ctx, item, op.selector, rules.protected),
    },
    "remove:influenced": {
        reads: ["protected"],
        apply: (_op, item, { ctx, rules }) =>
            influencedReach(ctx, item, rules).map((m) => without(item, m)),
    },
    elevate: {
        reads: ["protected"],
        apply: (_op, item, { ctx, rules }) => elevate(ctx, item, rules),
    },
};

export const compounds: RefCompoundTable = {
    addAnother: {
        reads: AUGMENT_READS,
        apply: (run, item, { ctx, rules, pools }) => {
            const n = run.fill.count.n;
            if (n[0] !== 1 || n[1] !== 1) {
                throw new InternalError(`an add of ${n.join(" to ")} before a removal`);
            }
            const sel = run.remove.selector;
            if (addDraws(n, item.rarity, ctx.base)[1] === 0) return [];
            const rows = eligible(run.fill.pool, item, ctx, rules.strands, pools);
            // `drawOne` lays the row last: that is the modifier the removal
            // spares. A partial protection chooses afresh among the modifiers
            // the item then holds; a draw and choice that leave nothing to
            // remove leave the item stuck.
            const ways = drawOne(item, rows).flatMap((x) =>
                rechosen(ctx, x, rules.protected).map((p) =>
                    removeRandom(ctx, x, sel, p, x.mods[x.mods.length - 1]),
                ),
            );
            return ways.some((w) => w.length === 0) ? [] : ways.flat();
        },
    },
};

export const checks: RefCheckTable = {
    removable: {
        reads: PROTECTED,
        pass: (check, item, { ctx, rules }) => {
            const sel = check.selector;
            switch (sel.kind) {
                case "random":
                    return (
                        (sel.gen !== undefined &&
                            reachSides(sel.gen, rules.protected).length === 0) ||
                        randomReach(ctx, item, sel, rules.protected).length > 0
                    );
                case "influenced":
                    return influencedReach(ctx, item, rules).length > 0;
                default:
                    throw new NotImplementedError(`"removable" of a ${sel.kind} removal`);
            }
        },
    },
    // Something a scour takes or turns Normal: not Normal, and a side not
    // protected (QUESTIONS.md Q83).
    strippable: {
        reads: ["protected"],
        pass: (_check, item, { rules }) =>
            item.rarity !== "normal" && rules.protected.sides.size < 2,
    },
    unprotectedSide: {
        reads: ["protected"],
        pass: (check, _item, { rules }) => !rules.protected.sides.has(check.gen),
    },
    influencedAtLeast: {
        reads: ["protected"],
        pass: (check, item, { ctx, rules }) =>
            influencedReach(ctx, item, rules).length >= check.count,
    },
    // Metamod § Rules and Exceptions, the grove's randomise: "usage is
    // prevented if any prefix is influenced" under the prefix protection; a
    // modifier a partial protection keeps prevents it alike (QUESTIONS.md Q128).
    noInfluencedOnProtected: {
        reads: ["protected"],
        pass: (_check, item, { ctx, rules }) => {
            const v = viewOf(ctx, item);
            return !item.mods.some(
                (m) => keeps(rules.protected, rowOf(ctx, m)) && isInfluenced(rowOf(ctx, m), v),
            );
        },
    },
};
