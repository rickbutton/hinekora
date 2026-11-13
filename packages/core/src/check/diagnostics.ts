/**
 * Checker diagnostics. Precondition messages follow language.md's §6
 * stance: render the item's state at that point, then what the op needed,
 * no lecturing.
 */
import type { Pred } from "../ast/ast.js";
import type { SourceSpan } from "../ast/span.js";
import type { Base } from "../model/base.js";
import type { Rarity } from "../model/ids.js";
import {
    type Corruption,
    type EldritchKey,
    eldritchLabel,
    influenceKey,
    influenceLabel,
    influenceSetLabel,
    type InfluenceKey,
    NO_ELDRITCH,
    NO_INFLUENCE,
} from "../model/marks.js";
import { withArticle } from "../resolve/messages.js";
import type { ItemView } from "../render/item.js";
import { baseLabel } from "../render/render.js";
import type { Range } from "./range.js";
import type { PreconditionFailure } from "./ops/types.js";
import { capitalise, plural, RARITY_WORD, rangeText, rarityText } from "../words.js";

export interface CheckDiagnostic {
    readonly message: string;
    readonly span: SourceSpan;
    /** A refused step's item that breaks it, where the step is used on more
     *  than one item and the message alone cannot say which. */
    readonly example?: ItemView;
}

/** What an error's words read of the items a step is used on
 *  (check/views.ts `summaryOf`). */
export interface ItemSummary {
    readonly base: Base;
    readonly ilvl: number;
    readonly rarities: ReadonlySet<Rarity>;
    /** The least and greatest number of affixes, prefixes and suffixes. */
    readonly counts: {
        readonly total: Range;
        readonly prefix: Range;
        readonly suffix: Range;
    };
    readonly influences: ReadonlySet<InfluenceKey>;
    readonly corrupted: ReadonlySet<Corruption>;
    readonly eldritch: ReadonlySet<EldritchKey>;
}

/** "Magic or Rare": the rarities the item may have, in the game's order. */
export function rarityLabel(rarities: ReadonlySet<Rarity>): string {
    return rarityText(rarities);
}

function renderRange(range: Range, noun: string): string {
    return range[0] === range[1]
        ? `${range[0]} ${plural(range[0], noun)}`
        : `${rangeText(range, "–")} ${plural(2, noun)}`;
}

/**
 * The one-line item-state summary shown in errors and hover. It leads with the
 * total affix range because the side-ranges alone read as independent (after a
 * transmute both show 0–1, implying an impossible (0,0)/(1,1)); the total
 * restores the correlation.
 */
export function renderState(a: ItemSummary): string {
    return [
        baseLabel(a.base),
        rarityLabel(a.rarities),
        renderRange(a.counts.total, "affix"),
        renderRange(a.counts.prefix, "prefix"),
        renderRange(a.counts.suffix, "suffix"),
        `ilvl ${a.ilvl}`,
        ...marksLabel(a),
    ].join(" · ");
}

/** The marks worth a word: an influence the item may have, a possible corruption. */
export function marksLabel(a: ItemSummary): string[] {
    const out: string[] = [];
    if (!(a.influences.size === 1 && a.influences.has(NO_INFLUENCE))) {
        out.push(influenceLabel(a.influences));
    }
    const corrupted = corruptionLabel(a.corrupted);
    if (corrupted !== undefined) out.push(corrupted);
    if (!(a.eldritch.size === 1 && a.eldritch.has(NO_ELDRITCH)))
        out.push(eldritchLabel(a.eldritch));
    return out;
}

function corruptionLabel(c: ReadonlySet<Corruption>): string | undefined {
    if (!c.has(true) && !c.has("twice")) return undefined;
    if (c.has(false)) return "maybe corrupted";
    if (!c.has(true)) return "twice corrupted";
    return c.has("twice") ? "corrupted, maybe twice" : "corrupted";
}

/** Human description of a surface predicate, for diagnostics and hover. */
export function describePred(pred: Pred): string {
    const val = (v: string | number | { param: string }): string =>
        typeof v === "object" ? v.param : String(v);
    // A mod literal prints quoted as written; a param prints bare, as its name.
    const modText = (v: string | { param: string }): string =>
        typeof v === "object" ? v.param : `"${v}"`;
    switch (pred.kind) {
        case "isRarity":
            return `is${pred.rarity[0]!.toUpperCase()}${pred.rarity.slice(1)}`;
        case "has": {
            // A literal tier prints as the `t1` shorthand; a param prints as its name.
            const tier =
                pred.tier === undefined
                    ? ""
                    : typeof pred.tier === "object"
                      ? ` ${pred.tier.param}`
                      : ` t${pred.tier}`;
            const value = pred.value === undefined ? "" : ` ${pred.value.op} ${pred.value.value}`;
            return `has ${pred.group ? "group " : ""}${modText(pred.mod)}${tier}${value}`;
        }
        case "fractured":
            return `fractured ${modText(pred.mod)}`;
        case "influenced":
            return pred.influence === undefined ? "influenced" : `influenced ${pred.influence}`;
        case "corrupted":
            return "corrupted";
        case "eldritch":
            return [
                pred.side,
                ...(pred.text !== undefined ? [`"${pred.text}"`] : []),
                ...(pred.tier !== undefined ? [pred.tier] : []),
            ].join(" ");
        case "dominant":
            return `dominant ${pred.side}`;
        case "compare":
            return `${pred.projection} ${pred.op} ${val(pred.value)}`;
        case "not":
            return `not ${describePred(pred.inner)}`;
        case "and":
            return `(${describePred(pred.left)} and ${describePred(pred.right)})`;
        case "or":
            return `(${describePred(pred.left)} or ${describePred(pred.right)})`;
        case "call": {
            const argText = (a: (typeof pred.args)[number]): string => {
                switch (a.kind) {
                    case "string":
                        return `"${a.value}"`;
                    case "param":
                        return a.param;
                    case "tier":
                        return `t${a.value}`;
                    case "int":
                        return String(a.value);
                    case "block":
                        return "{ … }";
                }
            };
            return `${pred.name}(${pred.args.map(argText).join(", ")})`;
        }
    }
}

// --- message builders ------------------------------------------------------

/** A statement whose words name no method: a currency's name is the common
 *  case, so that is what the message calls it. */
export function unknownOperation(words: readonly string[]): string {
    return words.length === 1
        ? `Unknown currency "${words[0]}".`
        : `Unknown operation "${words.join(" ")}".`;
}

/**
 * A precondition failure: state first, then what the op required. `sure`
 * where every item the step is used on breaks it: the words then state the
 * item's state as fact, and otherwise say what it may be.
 */
export function preconditionMessage(
    state: ItemSummary,
    failure: PreconditionFailure,
    sure: boolean,
): string {
    const is = sure ? "is" : "may be";
    const has = sure ? "has" : "may have";
    const need = ((): string => {
        switch (failure.kind) {
            case "wrongRarity":
                return `Requires a ${RARITY_WORD[failure.needed]} item — this item ${is} ${rarityLabel(failure.actual)}.`;
            case "normalRefused":
                return `Requires a Magic or Rare item — this item ${is} ${rarityLabel(failure.actual)}.`;
            case "magicRefused":
                return `Requires a Normal or Rare item — this item ${is} ${rarityLabel(failure.actual)}.`;
            case "noOpenSlot": {
                const why = failure.normal
                    ? "a Normal item has none"
                    : failure.gen === undefined
                      ? `the item ${is} full`
                      : `the item ${has} none open`;
                return failure.gen === undefined
                    ? `Requires an open affix slot — ${why}.`
                    : `Requires an open ${failure.gen} slot — ${why}.`;
            }
            case "modConflict":
                return `The item ${sure ? "already carries" : "may already carry"} ${/^[aeiou]/i.test(failure.group) ? "an" : "a"} "${failure.group}" modifier${
                    failure.among.length > 0
                        ? ` or one of its group (${failure.among.map((n) => `"${n}"`).join(", ")})`
                        : ""
                } — an item holds at most one per group, so ${failure.refusal ?? "this can't be benched"}.`;
            case "nothingToRemove":
                return `Requires a removable affix — the item ${has} none.`;
            case "essenceRarity":
                return failure.actual.has("magic")
                    ? `Essences cannot be used on a Magic item — this item ${is} ${rarityLabel(failure.actual)}.`
                    : `Requires a Normal item — this item ${is} ${rarityLabel(failure.actual)}, and only Screaming-tier and higher essences reforge a Rare.`;
            case "essenceClass":
                return `This essence grants no mod for a ${failure.itemClass}, so it cannot be used on this item.`;
            case "rarityUnsupported":
                return `A ${state.base.name ?? "flask"} cannot be made ${RARITY_WORD[failure.rarity]} — it can only be Normal or Magic.`;
            case "craftedLimit":
                return `The item ${sure ? "already has" : "may already have"} ${failure.cap} crafted ${plural(failure.cap, "modifier")} — that is the limit here, so ${failure.refusal ?? "this can't be benched"}.`;
            case "noCraftedToRemove":
                return `The item ${has} no crafted modifier for the bench to remove.`;
            case "craftedFractured":
                return `The item's crafted modifier ${is} fractured — the bench can't replace it.`;
            case "craftedMultiple":
                return `The item ${sure && failure.every === true ? "has" : "may have"} more than one crafted modifier — the bench can't replace them.`;
            case "harvestEmptyPool":
                return `No ${failure.tag} modifier can appear on ${withArticle(state.base.name ?? "item")} at this item level.`;
            case "harvestNoRoom":
                return sure
                    ? `${capitalise(withArticle(`${failure.tag} modifier`))} has no slot — the side it would take is full.`
                    : `${capitalise(withArticle(`${failure.tag} modifier`))} has no slot on some items — the side it would take may be full.`;
            case "harvestBlocked":
                return sure && failure.every === true
                    ? `Every ${failure.tag} modifier is blocked — one of them, or one of its group, is already on the item, or it needs an influence the item does not have.`
                    : `Every ${failure.tag} modifier may be blocked on some items — one of them, or one of its group, may already be on the item, or it needs an influence the item may not have.`;
            case "harvestCannotRoll":
                return `No ${failure.tag} modifier can be added while the item ${failure.tag === "attack" || failure.tag === "caster" ? `cannot roll ${failure.tag} modifiers` : "has a modifier that keeps them from rolling"} — remove that crafted modifier first.`;
            case "typeNotRemovable": {
                const every = sure && failure.every === true;
                switch (failure.why) {
                    case "absent":
                        return `The item ${every ? "does not" : "may not"} carry "${failure.mod}", so it can't be changed.`;
                    case "fractured":
                        return `"${failure.mod}" ${every ? "is" : "may be"} fractured, so it can't be changed.`;
                    case "protected":
                        return `"${failure.mod}" ${sure ? "sits" : "may sit"} on a side a metamod protects, so it can't be changed.`;
                    case "kept":
                        return `"${failure.mod}" ${sure ? "is" : "may be"} a modifier a metamod keeps, so it can't be changed.`;
                }
                break;
            }
            case "noImprint":
                return `The item ${has} no imprint — create one with 'beast imprint' first.`;
            case "notImprintable":
                return "The Bestiary imprints a Magic item or a Rare talisman, nothing else.";
            case "noMetamodFits":
                return sure
                    ? "No metamod fits: the item has no open slot, or every metamod is already on it."
                    : "A metamod may not fit: the item may have no open slot, or every metamod may already be on it.";
            case "wrongBase":
                return `Needs a ${failure.needed}.`;
            case "itemLevelTooLow":
                return `${failure.what} needs item level ${failure.level} or more — this item is item level ${state.ilvl}.`;
            case "notCorruptedItem":
                return `${failure.what} needs a corrupted item — this item ${sure ? "is not" : "may not be"} corrupted.`;
            case "twiceCorrupted":
                return `${failure.what} takes no twice-corrupted item — this item ${is} twice corrupted.`;
            case "fossilBaseRestricted":
                return `A ${failure.fossil} cannot be used on ${withArticle(state.base.name ?? "base like this")}.`;
            case "metamodBlocks":
                return "This currency can't be used while a metacraft modifier is on the item — remove it first.";
            case "tooFewMods":
                return `${failure.what ?? "A Fracturing Orb"} needs at least ${failure.needed} modifiers on the item.`;
            case "alreadyFractured":
                return failure.what === undefined
                    ? `The item ${sure ? "already has" : "may already have"} a fractured modifier — nothing fractures an item twice.`
                    : `The item ${has} a fractured modifier — ${failure.what}.`;
            case "corrupted":
                if (!state.corrupted.has(true)) {
                    return `The item ${is} twice corrupted — a twice-corrupted item takes no further craft.`;
                }
                return `The item ${is} corrupted — a corrupted item takes only an unveil and the Corruption Altar${state.corrupted.has("twice") ? ", and a twice-corrupted one neither of them" : ""}.`;
            case "eldritchPresent":
                return `${failure.what} cannot be used on an item with an eldritch implicit — this item ${has} ${eldritchLabel(state.eldritch)}.`;
            case "notDominant":
                return `${failure.what} needs an item where ${failure.side === "exarch" ? "The Searing Exarch" : "The Eater of Worlds"} is dominant — this item ${has} ${eldritchLabel(state.eldritch)}.`;
            case "tooFewInfluenced":
                return `An Orb of Dominance needs ${failure.needed} influenced modifiers on sides a metamod does not protect — the item ${has} ${failure.have === 0 ? "none" : `only ${failure.have === 1 ? "one" : failure.have}`}.`;
            case "sideProtected":
                return `${failure.what} removes a ${failure.gen}, but the ${failure.gen}es cannot be changed here.`;
            case "notBothEldritch":
                return `An Orb of Conflict needs both a Searing Exarch and an Eater of Worlds implicit — this item ${has} ${eldritchLabel(state.eldritch)}.`;
            case "influenced":
                return `${capitalise(withArticle(failure.what))} cannot be used on an influenced item — this item ${has} ${influenceLabel(state.influences)}.`;
            case "notInfluenced":
                return `${failure.what} needs ${failure.influence === undefined ? "an influenced" : `a ${influenceSetLabel(influenceKey([failure.influence]))}`} item — this item ${has} ${influenceLabel(state.influences)}.`;
            case "notInfluenceable":
                return `A ${failure.what} cannot be used on ${withArticle(state.base.name ?? "base like this")} — its class cannot be influenced.`;
            case "influencedOnProtected":
                return `${failure.what} is not offered while the ${failure.gen}es cannot be changed and one of them ${is} an influence modifier.`;
            case "noVeiledMod":
                return `The item ${has} no veiled modifier to unveil.`;
            case "alreadyVeiled":
                return `The item ${sure ? "already carries" : "may already carry"} a veiled or unveiled modifier — a veiled orb can't be used on it.`;
            case "veiledWouldSurvive":
                return `A veiled or unveiled modifier ${sure ? "would" : "may"} survive the reforge (on a protected side, or fractured) — the item can't take a second one.`;
            case "unveilNotAvailable":
                return `"${failure.mod}" ${sure ? "is not" : "may not be"} an available unveil option on this item.`;
            case "unveilNotGuaranteed":
                return `"${failure.mod}" isn't guaranteed — ${failure.options} options can be offered, so block the pool to 3 or fewer first.`;
            case "noOutcome":
                switch (failure.op) {
                    case "fill":
                    case "addAnother":
                        return `No modifier can be added here — the item ${has} none left that fits.`;
                    case "remove":
                        return `No modifier can be removed here — the item ${has} none this can take.`;
                    case "elevate":
                        return `No influenced modifier can be upgraded here — the item ${has} none left to upgrade.`;
                    case "change":
                        return `The modifier can't be changed here — the item ${has} no room for what it becomes.`;
                    case "lock":
                        return `No modifier can be fractured here — the item ${has} too few that are not fractured.`;
                    default:
                        return sure
                            ? "This step has nothing to act on."
                            : "This step may have nothing to act on.";
                }
        }
    })();
    return `at this point the item is: ${renderState(state)}\n${need}`;
}

export { resolveMessage, withArticle } from "../resolve/messages.js";
