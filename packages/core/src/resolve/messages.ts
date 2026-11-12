/**
 * A name that did not resolve, in the game's words, for every reader of a
 * craft: the checker's diagnostics, the method table's refusals, the exact
 * checker.
 */
import type { ResolveError } from "./registry.js";

export function resolveMessage(error: ResolveError): string {
    switch (error.kind) {
        case "unknownBase":
            return `Unknown base "${error.name}".`;
        case "uncraftedBase":
            return `"${error.name}" is not an item a guide crafts on here — a base is a weapon, a piece of armour or jewellery, a quiver, a jewel, a flask, a tincture, a charm, a relic, an idol, a Thief's Trinket or a piece of Rogue's equipment.`;
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
        case "unknownEldritch":
            return `No ${error.side === "exarch" ? "Searing Exarch" : "Eater of Worlds"} implicit reads "${error.name}".`;
        case "unknownAspect":
            return `Unknown Aspect "${error.name}" — the Bestiary crafts cat, avian, spider or crab.`;
        case "unknownHarvestTag":
            return `"${error.name}" is not a harvest modifier type.`;
        case "unknownEnchant":
            return `"${error.name}" is not a cluster jewel enchantment — name the stat its small passives grant ("lightning damage", "minion damage").`;
        case "noSuchTier":
            return error.best === error.worst
                ? `"${error.name}" has no tier ${error.tier} — it has the one tier, t${error.best}.`
                : `"${error.name}" has no tier ${error.tier} — it has t${error.best} to t${error.worst}.`;
        case "ambiguous":
            // A hybrid modifier's wording is two lines.
            return `Ambiguous name "${error.name}" — candidates: ${error.candidates.map((c) => c.replace(/\s*\n\s*/g, " / ")).join(", ")}.`;
    }
}

export function withArticle(noun: string): string {
    return `${/^[aeiou]/i.test(noun) ? "an" : "a"} ${noun}`;
}
