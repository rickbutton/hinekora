/**
 * Checker diagnostics. Precondition messages follow language.md's §6
 * stance: render the item's state at that point, then what the op needed,
 * no lecturing.
 */
import type { Pred } from "../ast/ast.js";
import type { SourceSpan } from "../ast/span.js";
import type { Base } from "../model/base.js";
import { caps } from "../model/capacity.js";
import type { Rarity } from "../model/ids.js";
import {
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
import { CountDomain, type Counts } from "./counts.js";
import type { Range } from "./domain.js";
import type { PreconditionFailure } from "./ops.js";
import { capitalise, plural, RARITY_WORD, rangeText, rarityText } from "../words.js";

export interface CheckDiagnostic {
    readonly message: string;
    readonly span: SourceSpan;
    /** A refused step's item that breaks it, where the step is used on more
     *  than one item and the message alone cannot say which. */
    readonly example?: ItemView;
}

/**
 * What an error's words read of the item, over every item the step may be
 * used on: the present checker's state is one, and so is a view of the exact
 * checker's (exact/views.ts `summaryOf`), so both checkers' errors are worded
 * by the same functions.
 */
export interface ItemSummary {
    readonly base: Base;
    readonly ilvl: number;
    readonly rarities: ReadonlySet<Rarity>;
    /** The least and greatest number of affixes, prefixes and suffixes. */
    readonly counts: Counts;
    readonly influences: ReadonlySet<InfluenceKey>;
    readonly corrupted: ReadonlySet<boolean>;
    readonly eldritch: ReadonlySet<EldritchKey>;
}

/** The suffix range, no looser than the total less the prefixes and the
 *  loosest cap of the rarities; an exact count is unchanged by it. */
function suffixRange(a: ItemSummary): Range {
    const all = [...a.rarities].map((r) => caps(r, a.base));
    return CountDomain.suffix(a.counts, {
        prefix: Math.max(...all.map((c) => c.prefix)),
        suffix: Math.max(...all.map((c) => c.suffix)),
        total: Math.max(...all.map((c) => c.total)),
    });
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
        renderRange(suffixRange(a), "suffix"),
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
    if (a.corrupted.has(true)) out.push(a.corrupted.has(false) ? "maybe corrupted" : "corrupted");
    if (!(a.eldritch.size === 1 && a.eldritch.has(NO_ELDRITCH)))
        out.push(eldritchLabel(a.eldritch));
    return out;
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

/** A precondition failure: state first, then what the op required. */
export function preconditionMessage(state: ItemSummary, failure: PreconditionFailure): string {
    const need = ((): string => {
        switch (failure.kind) {
            case "wrongRarity":
                return `Requires a ${RARITY_WORD[failure.needed]} item — this item ${failure.actual.size === 1 ? "is" : "may be"} ${rarityLabel(failure.actual)}.`;
            case "normalRefused":
                return `Requires a Magic or Rare item — this item ${failure.actual.size === 1 ? "is" : "may be"} ${rarityLabel(failure.actual)}.`;
            case "magicRefused":
                return `Requires a Normal or Rare item — this item ${failure.actual.size === 1 ? "is" : "may be"} ${rarityLabel(failure.actual)}.`;
            case "noOpenSlot": {
                const why = failure.normal
                    ? "a Normal item has none"
                    : failure.gen === undefined
                      ? "the item may be full"
                      : "none is guaranteed open here";
                return failure.gen === undefined
                    ? `Requires an open affix slot — ${why}.`
                    : `Requires an open ${failure.gen} slot — ${why}.`;
            }
            case "modConflict":
                return `The item ${failure.sure ? "already carries" : "may already carry"} ${/^[aeiou]/i.test(failure.group) ? "an" : "a"} "${failure.group}" modifier${
                    failure.among.length > 0
                        ? ` or one of its group (${failure.among.map((n) => `"${n}"`).join(", ")})`
                        : ""
                } — an item holds at most one per group, so ${failure.refusal ?? "this can't be benched"}.`;
            case "nothingToRemove":
                return "Requires a removable affix — the item may have none.";
            case "essenceRarity":
                return failure.actual.has("magic")
                    ? `Essences cannot be used on a Magic item — this item ${failure.actual.size === 1 ? "is" : "may be"} ${rarityLabel(failure.actual)}.`
                    : `Requires a Normal item — this item ${failure.actual.size === 1 ? "is" : "may be"} ${rarityLabel(failure.actual)}, and only Screaming-tier and higher essences reforge a Rare.`;
            case "essenceClass":
                return `This essence grants no mod for a ${failure.itemClass}, so it cannot be used on this item.`;
            case "rarityUnsupported":
                return `A ${state.base.name ?? "flask"} cannot be made ${RARITY_WORD[failure.rarity]} — it can only be Normal or Magic.`;
            case "craftedLimit":
                return `The item may already have ${failure.cap} crafted ${plural(failure.cap, "modifier")} — that is the limit here, so ${failure.refusal ?? "this can't be benched"}.`;
            case "noCraftedToRemove":
                return "No crafted modifier is guaranteed on the item for the bench to remove.";
            case "craftedFractured":
                return "The item's crafted modifier may be fractured — the bench can't replace it.";
            case "craftedMultiple":
                return "The item may have more than one crafted modifier — the bench can't replace them.";
            case "craftedCapUnknown":
                return "The item may carry 'can have up to 3 crafted modifiers' — the bench would add beside the crafted modifier on that path and replace it otherwise, so narrow it with an if first.";
            case "harvestEmptyPool":
                return `No ${failure.tag} modifier can appear on ${withArticle(state.base.name ?? "item")} at this item level.`;
            case "harvestNoRoom":
                return `${capitalise(withArticle(`${failure.tag} modifier`))} has no slot on some path — the side it would take may be full.`;
            case "harvestBlocked":
                return `Every ${failure.tag} modifier may be blocked on some path — one of them, or one of its group, may already be on the item, or it needs an influence the item may not have.`;
            case "harvestCannotRoll":
                return `No ${failure.tag} modifier can be added while the item ${failure.tag === "attack" || failure.tag === "caster" ? `cannot roll ${failure.tag} modifiers` : "has a modifier that keeps them from rolling"} — remove that crafted modifier first.`;
            case "typeNotRemovable":
                switch (failure.why) {
                    case "absent":
                        return `"${failure.mod}" isn't guaranteed on the item, so it can't be changed.`;
                    case "fractured":
                        return `"${failure.mod}" ${failure.sure ? "is" : "may be"} fractured, so it can't be changed.`;
                    case "protected":
                        return `"${failure.mod}" sits on a side a metamod protects, so it can't be changed.`;
                }
                break;
            case "noImprint":
                return "No imprint of the item is held on every path — create one with 'beast imprint' first.";
            case "notImprintable":
                return "The Bestiary imprints a Magic item or a Rare talisman, nothing else.";
            case "noMetamodFits":
                return "No metamod fits: the item may have no open slot, or every metamod is already on it.";
            case "wrongBase":
                return `Needs a ${failure.needed}.`;
            case "itemLevelTooLow":
                return `${failure.what} needs item level ${failure.level} or more — this item is item level ${state.ilvl}.`;
            case "notCorruptedItem":
                return `${failure.what} needs a corrupted item — this item ${failure.sure ? "is not" : "may not be"} corrupted.`;
            case "fossilBaseRestricted":
                return `A ${failure.fossil} cannot be used on ${withArticle(state.base.name ?? "base like this")}.`;
            case "metamodBlocks":
                return "This currency can't be used while a metacraft modifier is on the item — remove it first.";
            case "tooFewMods":
                return `${failure.what ?? "A Fracturing Orb"} needs at least ${failure.needed} modifiers on the item.`;
            case "alreadyFractured":
                return failure.what === undefined
                    ? "The item already has a fractured modifier — nothing fractures an item twice."
                    : `The item ${failure.sure ? "has" : "may have"} a fractured modifier — ${failure.what}.`;
            case "corrupted":
                return `The item ${failure.sure ? "is" : "may be"} corrupted — a corrupted item takes only the Tainted currency and an unveil.`;
            case "eldritchPresent":
                return `${failure.what} cannot be used on an item with an eldritch implicit — this item ${failure.sure ? "has" : "may have"} ${eldritchLabel(state.eldritch)}.`;
            case "notDominant":
                return `${failure.what} needs an item where ${failure.side === "exarch" ? "The Searing Exarch" : "The Eater of Worlds"} is dominant — this item has ${eldritchLabel(state.eldritch)}.`;
            case "tooFewInfluenced":
                return `An Orb of Dominance needs ${failure.needed} influenced modifiers on sides a metamod does not protect — ${failure.have === 0 ? "none is" : failure.have === 1 ? "only one is" : `only ${failure.have} are`} guaranteed here.`;
            case "sideProtected":
                return `${failure.what} removes a ${failure.gen}, but the ${failure.gen}es cannot be changed here.`;
            case "notBothEldritch":
                return `An Orb of Conflict needs both a Searing Exarch and an Eater of Worlds implicit — this item ${failure.sure ? "has" : "may have"} ${eldritchLabel(state.eldritch)}.`;
            case "influenced":
                return `${capitalise(withArticle(failure.what))} cannot be used on an influenced item — this item ${failure.sure ? "has" : "may have"} ${influenceLabel(state.influences)}.`;
            case "notInfluenced":
                return `${failure.what} needs ${failure.influence === undefined ? "an influenced" : `a ${influenceSetLabel(influenceKey([failure.influence]))}`} item — this item ${failure.sure ? "has" : "may have"} ${influenceLabel(state.influences)}.`;
            case "notInfluenceable":
                return `A ${failure.what} cannot be used on ${withArticle(state.base.name ?? "base like this")} — its class cannot be influenced.`;
            case "influencedOnProtected":
                return `${failure.what} is not offered while the ${failure.gen}es cannot be changed and one of them may be an influence modifier.`;
            case "noVeiledMod":
                return "There is no veiled modifier on the item to unveil.";
            case "alreadyVeiled":
                return "The item may already carry a veiled or unveiled modifier — a veiled orb can't be used on it.";
            case "veiledWouldSurvive":
                return "A veiled or unveiled modifier would survive the reforge (on a protected side, or fractured) — the item can't take a second one.";
            case "unveilNotAvailable":
                return `"${failure.mod}" is not an available unveil option on this item.`;
            case "unveilNotGuaranteed":
                return `"${failure.mod}" isn't guaranteed — ${failure.options} options can be offered, so block the pool to 3 or fewer first.`;
            case "noOutcome": {
                const may = failure.sure ? "has" : "may have";
                switch (failure.op) {
                    case "fill":
                    case "addAnother":
                        return `No modifier can be added here — the item ${may} none left that fits.`;
                    case "remove":
                        return `No modifier can be removed here — the item ${may} none this can take.`;
                    case "elevate":
                        return `No influenced modifier can be upgraded here — the item ${may} none left to upgrade.`;
                    case "change":
                        return `The modifier can't be changed here — the item ${may} no room for what it becomes.`;
                    case "lock":
                        return `No modifier can be fractured here — the item ${may} too few that are not fractured.`;
                    default:
                        return failure.sure
                            ? "This step has nothing to act on."
                            : "This step may have nothing to act on.";
                }
            }
        }
    })();
    return `at this point the item is: ${renderState(state)}\n${need}`;
}

export { resolveMessage, withArticle } from "../resolve/messages.js";
