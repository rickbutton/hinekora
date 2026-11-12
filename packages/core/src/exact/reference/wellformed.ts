/**
 * The items the game allows on a base at an item level: the model's
 * well-formedness (item-model.md §8) as executable rules over one concrete
 * item. Each rule cites where the model states it.
 */
import { canBeRare, maxTotal, sideCap } from "../../model/capacity.js";
import type { GroupId, TypeId } from "../../model/ids.js";
import {
    AMULET_ELDRITCH_TOP_TIER,
    canHaveEldritch,
    ELDRITCH_ITEM_LEVEL,
    ELDRITCH_TIERS,
    type EldritchSide,
    INFLUENCE_STEMS,
    INFLUENCES,
    influenceKey,
    influencesOf,
    isEldritchAmulet,
    isInfluence,
    NO_INFLUENCE,
} from "../../model/marks.js";
import { MAX_STRANDS } from "../../model/strands.js";
import { isVeiledPlaceholder } from "../../model/veiled.js";
import { rollRange } from "../../check/values.js";
import { type CItem, countsOf, type RefCtx } from "./item.js";

/** Every rule the item breaks, in words; empty when it is well-formed. */
export function violations(item: CItem, ctx: RefCtx): string[] {
    const out: string[] = [];
    const { base } = ctx;

    // item-model.md §8 "Rarity within class ceiling" (Rarity § Rare).
    if (item.rarity === "rare" && !canBeRare(base)) out.push("this base cannot be Rare");

    const unknown = item.mods.filter((m) => !ctx.rows.has(m.row));
    if (unknown.length > 0) {
        // The rest of the rules read the rows; an unknown one ends the judgement.
        out.push(`rows not in the catalogue: ${unknown.map((m) => m.row).join(", ")}`);
        return out;
    }
    const rows = item.mods.map((m) => ({ m, row: ctx.rows.get(m.row)! }));

    // item-model.md §8 "Distinct mod types": two rows of one tier bucket never share an item.
    const types = new Set<TypeId>();
    // item-model.md §8 "Disjoint families" (Modifier § Group/family).
    const families = new Set<GroupId>();
    for (const { row } of rows) {
        if (types.has(row.type)) out.push(`two modifiers of type ${row.type}`);
        types.add(row.type);
        for (const f of row.families) {
            if (families.has(f)) out.push(`two modifiers of group ${f}`);
            families.add(f);
        }
    }

    // item-model.md §7 "Affix capacity" and §8 "within capacity" (model/capacity.ts).
    const counts = countsOf(ctx, item);
    const pCap = sideCap("prefix", item.rarity, base);
    const sCap = sideCap("suffix", item.rarity, base);
    const tCap = maxTotal(item.rarity, base);
    if (counts.prefix > pCap) out.push(`${counts.prefix} prefixes, at most ${pCap}`);
    if (counts.suffix > sCap) out.push(`${counts.suffix} suffixes, at most ${sCap}`);
    if (counts.total > tCap) out.push(`${counts.total} modifiers, at most ${tCap}`);

    // A natural row above the item level is no fault: an essence places one and
    // a Harvest change keeps one (item-model.md §8 "Natural affix tiers").
    for (const { m, row } of rows) {
        // item-model.md §8 "Natural affix domain matches base"; other sources are exempt (§3).
        if ((row.source ?? "natural") === "natural" && row.domain !== base.domain) {
            out.push(`${row.id} is of domain ${row.domain}, the base of ${base.domain}`);
        }
        // The value is the first number of the row's text, within its span
        // (check/values.ts `rollRange`); a whole span rolls whole numbers.
        const span = row.text === undefined ? undefined : rollRange(row.text);
        if (span === undefined) {
            if (m.value !== undefined) out.push(`${row.id} has no number, yet a value`);
        } else if (m.value === undefined) {
            out.push(`${row.id} has no value`);
        } else {
            const whole = Number.isInteger(span[0]) && Number.isInteger(span[1]);
            if (m.value < span[0] || m.value > span[1] || (whole && !Number.isInteger(m.value))) {
                out.push(`${row.id} value ${m.value} outside ${span[0]}-${span[1]}`);
            }
        }
        // A bench row is a crafted modifier (check/ops.ts PoolSpec "bench").
        if (row.source === "bench" && !m.crafted) out.push(`${row.id} is a bench row, not crafted`);
    }

    // The crafted limit is the bench's precondition, not the item's: an Orb of
    // Annulment that takes the multimod leaves its crafts standing (Crafting
    // Bench § Using the crafting bench; check/ops.ts `craftedReplaceable`).

    // item-model.md §8 "At most one veiled placeholder", Hinekora's restriction.
    const veiled = rows.filter(({ row }) => isVeiledPlaceholder(row.type)).length;
    if (veiled > 1) out.push(`${veiled} veiled modifiers, at most one`);

    // Influences: a canonical key of known influences (model/marks.ts).
    const influences = influencesOf(item.influences);
    if (
        !influences.every(isInfluence) ||
        influenceKey(influences) !== item.influences ||
        new Set(influences).size !== influences.length
    ) {
        out.push(`influence key "${item.influences}" is not canonical`);
    } else if (base.allInfluences) {
        // The Astrolabe Amulet counts as having every influence (Influenced item §
        // Mechanics), as check/item-block.ts `declareItem` reads it.
        if (item.influences !== influenceKey(INFLUENCES)) {
            out.push("this base has every influence");
        }
    } else {
        // item-model.md §8 "Influence limit" (Influenced item § Mechanics).
        if (influences.length > 2) out.push(`${influences.length} influences, at most two`);
        // A class no influence marks (check/item-block.ts `declareItem`, model/marks.ts INFLUENCE_STEMS).
        if (influences.length > 0 && INFLUENCE_STEMS[base.itemClass] === undefined) {
            out.push(`class ${base.itemClass} cannot be influenced`);
        }
    }
    const influenced = item.influences !== NO_INFLUENCE;

    // item-model.md §8 "Influence excludes fracture" (Fractured item § Mechanics);
    // the number of fractures has no limit ("no hard limit", same section).
    if (influenced && counts.fractured > 0) out.push("an influenced item cannot be fractured");

    // item-model.md §8 "Eldritch implicits" (Eldritch implicit modifier).
    const sides: readonly EldritchSide[] = ["exarch", "eater"];
    for (const side of sides) {
        const { tier, type } = item[side];
        if (!Number.isInteger(tier) || tier < 0 || tier > ELDRITCH_TIERS.length) {
            out.push(`${side} tier ${tier} outside 0-${ELDRITCH_TIERS.length}`);
            continue;
        }
        if (tier === 0) {
            if (type !== undefined) out.push(`${side} has a type but no tier`);
            continue;
        }
        if (!canHaveEldritch(base)) out.push(`this base cannot have an ${side} implicit`);
        if (ctx.ilvl < ELDRITCH_ITEM_LEVEL)
            out.push(`an ${side} implicit needs item level ${ELDRITCH_ITEM_LEVEL}`);
        if (influenced) out.push(`an influenced item cannot have an ${side} implicit`);
        // Which implicit it is: a row the catalogue has at that tier on the base
        // (resolve/registry.ts `eldritchRows`); none to name when it has none.
        const named = new Set(ctx.registry.eldritchRows(base, side, tier).map((e) => e.type));
        if (type === undefined ? named.size > 0 : !named.has(type)) {
            out.push(`${side} implicit ${type ?? "unnamed"} is not one of tier ${tier}`);
        }
        // An amulet's implicit is Lesser to Exceptional (Ukatoa's Ducat § Mechanics).
        if (isEldritchAmulet(base) && tier > AMULET_ELDRITCH_TOP_TIER) {
            out.push(`an amulet's ${side} implicit is at most tier ${AMULET_ELDRITCH_TOP_TIER}`);
        }
    }
    // An amulet has one implicit of either pool (Ukatoa's Ducat § Mechanics).
    if (isEldritchAmulet(base) && item.exarch.tier > 0 && item.eater.tier > 0) {
        out.push("an amulet has one eldritch implicit");
    }

    // item-model.md §7 "Memory strands", 0 to 100 (Memory strand § Mechanics).
    if (!Number.isInteger(item.strands) || item.strands < 0 || item.strands > MAX_STRANDS) {
        out.push(`${item.strands} memory strands, 0 to ${MAX_STRANDS}`);
    }

    // The held imprint is the item as it was, without an imprint of its own
    // (check/ops.ts "imprint").
    if (item.imprint !== undefined) {
        if (item.imprint.imprint !== undefined) out.push("an imprint holds an imprint");
        for (const v of violations(item.imprint, ctx)) out.push(`imprint: ${v}`);
    }
    return out;
}

export function isWellFormed(item: CItem, ctx: RefCtx): boolean {
    return violations(item, ctx).length === 0;
}
