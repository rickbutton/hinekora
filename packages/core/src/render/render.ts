/**
 * The state renderer: item state → plain text, for errors and inspection.
 * Errors render state, they don't teach (surface doc §6). Unions render from
 * the symbolic queries (count ranges, guaranteed floor, candidate lists) —
 * never by walking arms.
 */
import type { Base } from "../model/base.js";
import type { Rarity } from "../model/ids.js";
import type { Item } from "../model/item.js";
import type { Mod } from "../model/mod.js";
import type { WfViolation } from "../model/wf.js";
import type { OpError } from "../currency/result.js";
import type { Outcome } from "../outcome/outcome.js";
import {
    armCount,
    guaranteedPresent,
    prefixCountRange,
    suffixCountRange,
} from "../outcome/outcome.js";

// --- Small text helpers ---------------------------------------------------

/** The label shown for a mod — the single seam to swap for display names later. */
export function modLabel(m: Mod): string {
    return m.id;
}

/** The label shown for a base: its display name if it has one, else its id. */
export function baseLabel(base: Base): string {
    return base.name ?? base.id;
}

const RARITY_LABEL: Record<Rarity, string> = {
    normal: "Normal",
    magic: "Magic",
    rare: "Rare",
};

/** Pluralize: sibilant endings take `-es` (`prefix`→`prefixes`), else `-s`. */
function plural(noun: string, n: number): string {
    if (n === 1) return noun;
    return /(?:s|x|z|ch|sh)$/.test(noun) ? `${noun}es` : `${noun}s`;
}

/** "2 prefixes", "1 suffix". */
function renderCount(n: number, noun: string): string {
    return `${n} ${plural(noun, n)}`;
}

/** "2 prefixes" for a point range, "0–1 prefixes" for a spread (always plural). */
function renderRange(range: readonly [number, number], noun: string): string {
    const [min, max] = range;
    // A spread (min !== max) is inherently plural, even when max is 1 ("0–1").
    return min === max ? renderCount(min, noun) : `${min}–${max} ${plural(noun, 2)}`;
}

/** Comma-joined mod labels, or "(none)". */
function renderModList(mods: readonly Mod[]): string {
    return mods.length === 0 ? "(none)" : mods.map(modLabel).join(", ");
}

// --- Item rendering -------------------------------------------------------

/** The one-line summary: "IronRing · Magic · 1 prefix · 1 suffix · ilvl 82". */
export function renderItemSummary(it: Item): string {
    return [
        baseLabel(it.base),
        RARITY_LABEL[it.rarity],
        renderCount(it.prefixes.length, "prefix"),
        renderCount(it.suffixes.length, "suffix"),
        `ilvl ${it.ilvl}`,
    ].join(" · ");
}

/** The full multi-line item view: summary plus the prefix/suffix mod lists. */
export function renderItem(it: Item): string {
    return [
        renderItemSummary(it),
        `  prefixes: ${renderModList(it.prefixes)}`,
        `  suffixes: ${renderModList(it.suffixes)}`,
    ].join("\n");
}

// --- Outcome / union rendering (no enumeration) ---------------------------

/**
 * Summarize an outcome: a `certain` outcome renders as its item; a union
 * renders from the symbolic queries without materializing any arm.
 */
export function renderOutcome(o: Outcome): string {
    if (o.kind === "certain") {
        return renderItem(o.item);
    }

    const base = o.base;
    const summary = [
        baseLabel(base.base),
        RARITY_LABEL[base.rarity],
        renderRange(prefixCountRange(o), "prefix"),
        renderRange(suffixCountRange(o), "suffix"),
        `ilvl ${base.ilvl}`,
        `one of ${renderCount(armCount(o), "outcome")}`,
    ].join(" · ");

    const kept = renderModList([...base.prefixes, ...base.suffixes]);

    const variation =
        o.kind === "addOne"
            ? `  adds one of: ${renderModList(o.candidates.map((c) => c.mod))}`
            : `  removes one of: ${renderModList(o.removables)}`;

    // Which present types are guaranteed to survive across every arm.
    const floor = guaranteedPresent(o);
    const keepsLine =
        o.kind === "addOne"
            ? `  keeps: ${kept}` // additive: everything present is kept
            : `  guaranteed to remain: ${floor.size === 0 ? "(nothing)" : [...floor].join(", ")}`;

    return [summary, keepsLine, variation].join("\n");
}

// --- Error rendering (state + what was needed) ----------------------------

/** Render one well-formedness violation as a single line. */
export function renderWfViolation(v: WfViolation): string {
    switch (v.kind) {
        case "prefixOverCap":
            return `too many prefixes: ${v.count} (max ${v.cap})`;
        case "suffixOverCap":
            return `too many suffixes: ${v.count} (max ${v.cap})`;
        case "duplicateType":
            return `duplicate mod type: ${v.type}`;
        case "familyCollision":
            return `conflicting mods in family: ${v.family}`;
        case "ilvlGate":
            return `${modLabel(v.mod)} requires ilvl ${v.minLevel} (item is ilvl ${v.ilvl})`;
        case "domainMismatch":
            return `${modLabel(v.mod)} cannot apply to this base (wrong domain)`;
    }
}

/** What the failed operation needed — the second half of the error. */
function renderNeed(e: OpError): string {
    switch (e.kind) {
        case "wrongRarity":
            return `Requires a ${RARITY_LABEL[e.needed]} item — this item is ${RARITY_LABEL[e.actual]}.`;
        case "noOpenSlot":
            return `Requires an open affix slot — this item is full (${renderCount(
                e.prefixCount,
                "prefix",
            )}, ${renderCount(e.suffixCount, "suffix")}).`;
        case "nothingToRemove":
            return `Requires a removable affix — this item has none.`;
        case "notWellFormed":
            return [
                "Item is not well-formed:",
                ...e.violations.map((v) => `  - ${renderWfViolation(v)}`),
            ].join("\n");
    }
}

/** A full precondition error: the item's current state, then what the op needed. */
export function renderOpError(it: Item, e: OpError): string {
    return [`at this point the item is: ${renderItemSummary(it)}`, renderNeed(e)].join("\n");
}
