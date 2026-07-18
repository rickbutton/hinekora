/**
 * Checker diagnostics. Precondition messages follow the surface doc's §6
 * stance: render the item's state at that point, then what the op needed —
 * no lecturing.
 */
import type { Pred } from "../ast/ast.js";
import type { SourceSpan } from "../ast/span.js";
import type { Rarity } from "../model/ids.js";
import type { ResolveError } from "../resolve/registry.js";
import { baseLabel } from "../render/render.js";
import { type AItem, type Range, suffixRange } from "./astate.js";
import type { PreconditionFailure } from "./transfer.js";

export interface CheckDiagnostic {
    readonly message: string;
    readonly span: SourceSpan;
}

const RARITY_LABEL: Record<Rarity, string> = { normal: "Normal", magic: "Magic", rare: "Rare" };

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
        RARITY_LABEL[a.rarity],
        renderRange(a.total, "affix"),
        renderRange(a.prefix, "prefix"),
        renderRange(suffixRange(a), "suffix"),
        `ilvl ${a.ilvl}`,
    ].join(" · ");
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
                return `Requires a ${RARITY_LABEL[failure.needed]} item — this item is ${RARITY_LABEL[failure.actual]}.`;
            case "noOpenSlot":
                return failure.gen === undefined
                    ? "Requires an open affix slot — the item may be full."
                    : `Requires an open ${failure.gen} slot — none is guaranteed open here.`;
            case "modConflict":
                return `The item may already carry a "${failure.group}" modifier — an item holds at most one per group, so this can't be benched.`;
            case "nothingToRemove":
                return failure.gen === undefined
                    ? "Requires a removable affix — the item may have none."
                    : `Requires a removable ${failure.gen} — none is guaranteed present here.`;
            case "essenceRarity":
                return failure.actual === "magic"
                    ? "Essences cannot be used on a Magic item."
                    : "Requires a Normal item — only Screaming-tier and higher essences reforge a Rare.";
            case "essenceClass":
                return `This essence grants no mod for a ${failure.itemClass}, so it cannot be used on this item.`;
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
        case "unknownOmen":
            return `Unknown omen "${error.name}".`;
        case "unknownEssence":
            return `Unknown essence "${error.name}".`;
        case "unknownBench":
            return `No bench craft adds "${error.name}" to this item.`;
        case "ambiguous":
            return `Ambiguous name "${error.name}" — candidates: ${error.candidates.join(", ")}.`;
    }
}
