/**
 * Checker diagnostics. Precondition messages follow the surface doc's §6
 * stance: render the item's state at that point, then what the op needed,
 * no lecturing.
 */
import type { Pred } from "../ast/ast.js";
import type { SourceSpan } from "../ast/span.js";
import type { Rarity } from "../model/ids.js";
import {
    eldritchLabel,
    influenceKey,
    influenceLabel,
    influenceSetLabel,
    NO_ELDRITCH,
    NO_INFLUENCE,
} from "../model/marks.js";
import type { ResolveError } from "../resolve/registry.js";
import { baseLabel } from "../render/render.js";
import { type AItem, type Range, suffixRange } from "./astate.js";
import type { PreconditionFailure } from "./ops.js";

export interface CheckDiagnostic {
    readonly message: string;
    readonly span: SourceSpan;
}

const RARITY_LABEL: Record<Rarity, string> = {
    normal: "Normal",
    magic: "Magic",
    rare: "Rare",
};

/** "Magic or Rare": the rarities the item may have, in the game's order. */
export function rarityLabel(rarities: ReadonlySet<Rarity>): string {
    return (["normal", "magic", "rare"] as const)
        .filter((r) => rarities.has(r))
        .map((r) => RARITY_LABEL[r])
        .join(" or ");
}

function plural(noun: string, n: number): string {
    if (n === 1) return noun;
    return /(?:s|x|z|ch|sh)$/.test(noun) ? `${noun}es` : `${noun}s`;
}

function renderRange(range: Range, noun: string): string {
    const [min, max] = range;
    return min === max ? `${min} ${plural(noun, min)}` : `${min}–${max} ${plural(noun, 2)}`;
}

/**
 * The one-line item-state summary shown in errors and hover. It leads with the
 * total affix range because the side-ranges alone read as independent (after a
 * transmute both show 0–1, implying an impossible (0,0)/(1,1)); the total
 * restores the correlation.
 */
export function renderState(a: AItem): string {
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
export function marksLabel(a: AItem): string[] {
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
            return `has "${val(pred.mod)}"${tier}`;
        }
        case "fractured":
            return `fractured "${val(pred.mod)}"`;
        case "influenced":
            return pred.influence === undefined ? "influenced" : `influenced ${pred.influence}`;
        case "corrupted":
            return "corrupted";
        case "eldritch":
            return pred.tier === undefined ? pred.side : `${pred.side} ${pred.tier}`;
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
                }
            };
            return `${pred.name}(${pred.args.map(argText).join(", ")})`;
        }
    }
}

// --- message builders ------------------------------------------------------

/** A precondition failure: state first, then what the op required. */
export function preconditionMessage(state: AItem, failure: PreconditionFailure): string {
    const need = ((): string => {
        switch (failure.kind) {
            case "wrongRarity":
                return `Requires a ${RARITY_LABEL[failure.needed]} item — this item ${failure.actual.size === 1 ? "is" : "may be"} ${rarityLabel(failure.actual)}.`;
            case "noOpenSlot":
                return failure.gen === undefined
                    ? "Requires an open affix slot — the item may be full."
                    : `Requires an open ${failure.gen} slot — none is guaranteed open here.`;
            case "modConflict":
                return `The item may already carry a "${failure.group}" modifier — an item holds at most one per group, so this can't be benched.`;
            case "nothingToRemove":
                return "Requires a removable affix — the item may have none.";
            case "essenceRarity":
                return failure.actual.has("magic")
                    ? `Essences cannot be used on a Magic item — this item ${failure.actual.size === 1 ? "is" : "may be"} ${rarityLabel(failure.actual)}.`
                    : `Requires a Normal item — this item ${failure.actual.size === 1 ? "is" : "may be"} ${rarityLabel(failure.actual)}, and only Screaming-tier and higher essences reforge a Rare.`;
            case "essenceClass":
                return `This essence grants no mod for a ${failure.itemClass}, so it cannot be used on this item.`;
            case "rarityUnsupported":
                return `A ${state.base.name ?? "flask"} cannot be made ${RARITY_LABEL[failure.rarity]} — it can only be Normal or Magic.`;
            case "craftedLimit":
                return `The item may already have ${failure.cap} crafted modifier${failure.cap === 1 ? "" : "s"} — that is the limit here, so this can't be benched.`;
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
            case "typeNotRemovable":
                switch (failure.why) {
                    case "absent":
                        return `"${failure.mod}" isn't guaranteed on the item, so it can't be changed.`;
                    case "fractured":
                        return `"${failure.mod}" may be fractured, so it can't be changed.`;
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
            case "notCorruptedItem":
                return `${failure.what} needs a corrupted item — this item ${failure.sure ? "is not" : "may not be"} corrupted.`;
            case "fossilBaseRestricted":
                return `A ${failure.fossil} cannot be used on ${withArticle(state.base.name ?? "base like this")}.`;
            case "metamodBlocks":
                return "This currency can't be used while a metacraft modifier is on the item — remove it first.";
            case "tooFewMods":
                return `A Fracturing Orb needs at least ${failure.needed} modifiers on the item.`;
            case "alreadyFractured":
                return "The item already has a fractured modifier — it can hold only one.";
            case "corrupted":
                return `The item ${failure.sure ? "is" : "may be"} corrupted — a corrupted item takes no further craft, only the Tainted currency.`;
            case "eldritchPresent":
                return `${failure.what} cannot be used on an item with an eldritch implicit — this item ${failure.sure ? "has" : "may have"} ${eldritchLabel(state.eldritch)}.`;
            case "notDominant":
                return `${failure.what} needs an item where ${failure.side === "exarch" ? "The Searing Exarch" : "The Eater of Worlds"} is dominant — this item has ${eldritchLabel(state.eldritch)}.`;
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
            case "awakenerTarget":
                return `An Awakener's Orb needs an item with exactly one influence other than the donor's ${influenceSetLabel(influenceKey([failure.donor]))} — this item ${failure.sure ? "has" : "may have"} ${influenceLabel(state.influences)}.`;
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
        }
    })();
    return `at this point the item is: ${renderState(state)}\n${need}`;
}

export function resolveMessage(error: ResolveError): string {
    switch (error.kind) {
        case "unknownBase":
            return `Unknown base "${error.name}".`;
        case "unknownMod":
            return `Unknown mod "${error.name}".`;
        case "unknownCurrency":
            return `Unknown currency "${error.name}".`;
        case "unknownEssence":
            return `Unknown essence "${error.name}".`;
        case "unknownBench":
            return `No bench craft adds "${error.name}" to this item.`;
        case "unknownFossil":
            return `Unknown fossil "${error.name}".`;
        case "unknownAspect":
            return `Unknown Aspect "${error.name}" — the Bestiary crafts cat, avian, spider or crab.`;
        case "unknownHarvestTag":
            return `"${error.name}" is not a harvest modifier type.`;
        case "ambiguous":
            return `Ambiguous name "${error.name}" — candidates: ${error.candidates.join(", ")}.`;
    }
}

function withArticle(noun: string): string {
    return `${/^[aeiou]/i.test(noun) ? "an" : "a"} ${noun}`;
}

function capitalise(s: string): string {
    return s.charAt(0).toUpperCase() + s.slice(1);
}
