/**
 * The marks: rarity, corruption, influence and the implicits, and
 * the checks that read them.
 */
import { canBeRare, maxTotal, sideCap } from "../../../model/capacity.js";
import type { Rarity, TypeId } from "../../../model/ids.js";
import {
    type EldritchSide,
    INFLUENCES,
    type Influence,
    type InfluenceKey,
    influenceKey,
    influencesOf,
    NO_INFLUENCE,
} from "../../../model/marks.js";
import { InternalError } from "../../ops/handler.js";
import { RARITIES } from "../../universe.js";
import { type CEldritch, type CItem, countsOf, NO_IMPLICIT, type RefCtx } from "../item.js";
import { isWellFormed } from "../wellformed.js";
import type { RefCheckTable, RefCompoundTable, RefTransformTable } from "./handler.js";

const rank = (r: Rarity): number => RARITIES.indexOf(r);

/** Do the item's modifiers fit the caps of `r` (model/capacity.ts)? */
function holds(ctx: RefCtx, item: CItem, r: Rarity): boolean {
    if (r === "rare" && !canBeRare(ctx.base)) return false;
    const c = countsOf(ctx, item);
    return (
        c.prefix <= sideCap("prefix", r, ctx.base) &&
        c.suffix <= sideCap("suffix", r, ctx.base) &&
        c.total <= maxTotal(r, ctx.base)
    );
}

/**
 * The rarity a scour leaves: none left is Normal, one Magic, two or more Rare
 * (Orb of Scouring), never above the rarity the item had. Assumed, the wiki
 * silent: where that rarity cannot hold what is left (a side a base's delta
 * closes), the next one up that can.
 */
export function survivorsRarity(ctx: RefCtx, item: CItem): Rarity {
    const n = item.mods.length;
    const byCount: Rarity = n === 0 ? "normal" : n === 1 ? "magic" : "rare";
    let r = Math.min(rank(byCount), rank(item.rarity));
    while (r < rank(item.rarity) && !holds(ctx, item, RARITIES[r]!)) r++;
    return RARITIES[r]!;
}

/** Every canonical set of `n` influences. */
function setsOfSize(n: number): InfluenceKey[] {
    const out: InfluenceKey[] = [];
    const go = (from: number, chosen: Influence[]): void => {
        if (chosen.length === n) {
            out.push(influenceKey(chosen));
            return;
        }
        for (let i = from; i < INFLUENCES.length; i++) go(i + 1, [...chosen, INFLUENCES[i]!]);
    };
    go(0, []);
    return out;
}

/** The outcome must be an item the game allows; the method's checks see to it. */
function wellFormed(out: CItem, ctx: RefCtx, what: string): CItem {
    if (!isWellFormed(out, ctx)) throw new InternalError(`${what} leaves an ill-formed item`);
    return out;
}

/** The implicits an ember or ichor of that tier may give: its pool where it
 *  names one, else those of that tier it can roll on the base (an unrollable
 *  row is reached only by lowering, model/sources.ts); unnamed when the
 *  catalogue names none (check/item.ts `CEldritch`). */
function emberTypes(
    ctx: RefCtx,
    side: EldritchSide,
    tier: number,
    pool: readonly TypeId[],
): (TypeId | undefined)[] {
    const named = new Set(ctx.registry.eldritchRows(ctx.base, side, tier).map((e) => e.type));
    if (named.size === 0) return [undefined];
    const rollable = ctx.registry
        .eldritchRows(ctx.base, side, tier)
        .filter((e) => !e.unrollable)
        .map((e) => e.type);
    return [...new Set(pool.length > 0 ? pool : rollable)].filter((t) => named.has(t));
}

/** One step of an Orb of Conflict on a side: up, or down, a Lesser lowered
 *  being removed (Orb of Conflict). Assumed, the wiki silent: a Perfect raised
 *  stays Perfect. The wording, so the type, does not change with the tier. */
function stepped(e: CEldritch, up: boolean): CEldritch {
    if (up) return { ...e, tier: Math.min(e.tier + 1, 6) };
    return e.tier === 1 ? NO_IMPLICIT : { ...e, tier: e.tier - 1 };
}

export const transforms: RefTransformTable = {
    corrupt: {
        reads: [],
        apply: (_op, item) => [{ ...item, corrupted: item.corrupted === false ? true : "twice" }],
    },
    rarity: {
        reads: [],
        apply: (op, item, { ctx }) => {
            if (op.rarity === "survivors") return [{ ...item, rarity: survivorsRarity(ctx, item) }];
            const out = { ...item, rarity: op.rarity };
            if (!isWellFormed(out, ctx)) {
                throw new InternalError(`an item holds more than a ${op.rarity} item can`);
            }
            return [out];
        },
    },
    influence: {
        reads: [],
        apply: (op, item, { ctx }) => {
            const c = op.change;
            switch (c.kind) {
                case "set":
                    return [wellFormed({ ...item, influences: c.key }, ctx, "an influence")];
                case "add": {
                    const key = influenceKey([...influencesOf(item.influences), c.influence]);
                    return [wellFormed({ ...item, influences: key }, ctx, "an added influence")];
                }
                case "randomise":
                    // As many influences as it had, any set of that size (QUESTIONS.md Q27).
                    return setsOfSize(influencesOf(item.influences).length).map((key) =>
                        wellFormed({ ...item, influences: key }, ctx, "a randomised influence"),
                    );
            }
        },
    },
    eldritch: {
        reads: [],
        apply: (op, item, { ctx }) => {
            const c = op.change;
            switch (c.kind) {
                case "set":
                    // It replaces the base's implicit (Eldritch implicit modifier).
                    return emberTypes(ctx, c.side, c.tier, c.types).map((type) =>
                        wellFormed(
                            { ...item, baseImplicit: false, [c.side]: { tier: c.tier, type } },
                            ctx,
                            "an eldritch implicit",
                        ),
                    );
                case "conflict": {
                    if (item.exarch.tier === 0 || item.eater.tier === 0) return [];
                    return [true, false].map((exarchUp) =>
                        wellFormed(
                            {
                                ...item,
                                exarch: stepped(item.exarch, exarchUp),
                                eater: stepped(item.eater, !exarchUp),
                            },
                            ctx,
                            "an Orb of Conflict",
                        ),
                    );
                }
            }
        },
    },
    corruptionImplicit: {
        reads: [],
        apply: (_op, item, { ctx }) => {
            // A row of the base's pool at its item level (Corrupted § Corrupted
            // implicit modifiers). With two corruption implicits, or beside
            // another implicit, one implicit the item holds is replaced at
            // random; otherwise the new one is added (Vaal Orb § Equipment;
            // Locus of Corruption § Possible outcomes; Version 3.30.0 §
            // Incursion and Atziri; QUESTIONS.md Q32). It never shares a group
            // with a corruption implicit that stays. One that cannot be
            // changed stays, and keeps the others (Cogwork Ring § Mechanics;
            // QUESTIONS.md Q134).
            const pool = ctx.registry.corruptionPool(ctx.base, ctx.ilvl).map((c) => c.row);
            const own = ctx.registry.baseImplicits(ctx.base).some((v) => v.length > 0);
            if ((own && ctx.base.implicitLocked === true) || pool.length === 0) return [item];
            const others =
                (item.baseImplicit ? 1 : 0) +
                (item.exarch.tier > 0 ? 1 : 0) +
                (item.eater.tier > 0 ? 1 : 0);
            const left: CItem[] = [];
            if (item.corruption.length === 2 || others > 0) {
                for (const id of item.corruption) {
                    left.push({ ...item, corruption: item.corruption.filter((x) => x !== id) });
                }
                if (item.baseImplicit) left.push({ ...item, baseImplicit: false });
                if (item.exarch.tier > 0) left.push({ ...item, exarch: NO_IMPLICIT });
                if (item.eater.tier > 0) left.push({ ...item, eater: NO_IMPLICIT });
            } else left.push(item);
            const byId = new Map(pool.map((c) => [c.id, c]));
            return left.flatMap((x) => {
                const kept = new Set(x.corruption.flatMap((id) => [...byId.get(id)!.groups]));
                return pool
                    .filter((c) => ![...c.groups].some((g) => kept.has(g)))
                    .map((c) =>
                        wellFormed(
                            { ...x, corruption: [...x.corruption, c.id] },
                            ctx,
                            "a corruption implicit",
                        ),
                    );
            });
        },
    },
};

export const compounds: RefCompoundTable = {};

const both = (item: CItem): boolean => item.exarch.tier > 0 && item.eater.tier > 0;

export const checks: RefCheckTable = {
    rarity: {
        reads: [],
        pass: (check, item) => item.rarity === check.rarity,
        repair: (check, item, { ctx }) => {
            const out = { ...item, rarity: check.rarity };
            return isWellFormed(out, ctx) ? [out] : [];
        },
    },
    notMagic: { reads: [], pass: (_check, item) => item.rarity !== "magic" },
    notNormal: { reads: [], pass: (_check, item) => item.rarity !== "normal" },
    canBeRare: { reads: [], pass: (_check, _item, { ctx }) => canBeRare(ctx.base) },
    notCorrupted: { reads: [], pass: (_check, item) => item.corrupted === false },
    corruptedItem: { reads: [], pass: (_check, item) => item.corrupted !== false },
    notTwiceCorrupted: { reads: [], pass: (_check, item) => item.corrupted !== "twice" },
    noInfluence: { reads: [], pass: (_check, item) => item.influences === NO_INFLUENCE },
    influenced: {
        reads: [],
        pass: (check, item) =>
            check.influence === undefined
                ? item.influences !== NO_INFLUENCE
                : influencesOf(item.influences).includes(check.influence),
    },
    // A class some influence's rows spawn under (model/marks.ts `influenceTags`).
    influenceable: {
        reads: [],
        pass: (check, _item, { ctx }) =>
            ctx.registry.influenceTags(ctx.base, check.influence).size > 0,
    },
    noEldritch: {
        reads: [],
        pass: (_check, item) => item.exarch.tier === 0 && item.eater.tier === 0,
    },
    // The higher tier dominates; equal tiers, none (Eldritch implicit modifier).
    dominant: {
        reads: [],
        pass: (check, item) => {
            const mine = item[check.side].tier;
            const other = item[check.side === "exarch" ? "eater" : "exarch"].tier;
            return mine > other;
        },
    },
    bothEldritch: { reads: [], pass: (_check, item) => both(item) },
    baseHasTag: { reads: [], pass: (check, _item, { ctx }) => ctx.base.tags.has(check.tag) },
    baseHasAnyTag: {
        reads: [],
        pass: (check, _item, { ctx }) => check.tags.some((t) => ctx.base.tags.has(t)),
    },
    minItemLevel: { reads: [], pass: (check, _item, { ctx }) => ctx.ilvl >= check.level },
};
