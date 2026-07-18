/**
 * Well-formedness (typing rules §2.1) — the invariant every item must satisfy:
 * slot caps (effect-adjusted), distinct affix ModTypes, pairwise-disjoint
 * families, the tier gate, and domain match. Tags appear NOWHERE here — they
 * are an eligibility concern (spawn weights), not a coexistence rule. We
 * return a structured violation list rather than a boolean so the same data
 * powers rendering, errors, and tests.
 */
import type { Gen, GroupId, TypeId } from "./ids.js";
import { slotDelta } from "./effects.js";
import type { Item } from "./item.js";
import { affixes, prefixCount, suffixCount } from "./item.js";
import type { Mod } from "./mod.js";

/** Base slot caps before any effect adjustment: Normal 0, Magic 1, Rare 3 (per gen). */
function baseSlotCap(it: Item): number {
    switch (it.rarity) {
        case "normal":
            return 0;
        case "magic":
            return 1;
        case "rare":
            return 3;
    }
}

/** Effect-adjusted cap for one generation; `SlotDelta` effects shift it. */
export function slotCap(it: Item, gen: Gen): number {
    return baseSlotCap(it) + slotDelta(it, gen);
}

export const maxPre = (it: Item): number => slotCap(it, "prefix");
export const maxSuf = (it: Item): number => slotCap(it, "suffix");

/** Is there room for another affix of generation `gen`? */
export function slotOpen(it: Item, gen: Gen): boolean {
    const count = gen === "prefix" ? prefixCount(it) : suffixCount(it);
    return count < slotCap(it, gen);
}

/** A single well-formedness violation, tagged by which clause failed. */
export type WfViolation =
    | { readonly kind: "prefixOverCap"; readonly count: number; readonly cap: number }
    | { readonly kind: "suffixOverCap"; readonly count: number; readonly cap: number }
    | { readonly kind: "duplicateType"; readonly type: TypeId }
    | { readonly kind: "familyCollision"; readonly family: GroupId }
    | {
          readonly kind: "ilvlGate";
          readonly mod: Mod;
          readonly minLevel: number;
          readonly ilvl: number;
      }
    | { readonly kind: "domainMismatch"; readonly mod: Mod };

/** Every way in which `it` violates well-formedness; empty ⇔ wf. All checks
 *  run so every violation is reported at once. */
export function wfViolations(it: Item): readonly WfViolation[] {
    const violations: WfViolation[] = [];
    const all = affixes(it);

    // Slot caps.
    const preCap = maxPre(it);
    if (prefixCount(it) > preCap) {
        violations.push({ kind: "prefixOverCap", count: prefixCount(it), cap: preCap });
    }
    const sufCap = maxSuf(it);
    if (suffixCount(it) > sufCap) {
        violations.push({ kind: "suffixOverCap", count: suffixCount(it), cap: sufCap });
    }

    // (1) No duplicate ModType.
    const seenTypes = new Set<TypeId>();
    for (const m of all) {
        if (seenTypes.has(m.type)) {
            violations.push({ kind: "duplicateType", type: m.type });
        }
        seenTypes.add(m.type);
    }

    // (2) Families pairwise disjoint: no family may be claimed by two affixes.
    const seenFamilies = new Set<GroupId>();
    for (const m of all) {
        for (const f of m.families) {
            if (seenFamilies.has(f)) {
                violations.push({ kind: "familyCollision", family: f });
            }
            seenFamilies.add(f);
        }
    }

    // Tier gate and domain match, per affix.
    for (const m of all) {
        if (m.minLevel > it.ilvl) {
            violations.push({ kind: "ilvlGate", mod: m, minLevel: m.minLevel, ilvl: it.ilvl });
        }
        if (m.domain !== it.base.domain) {
            violations.push({ kind: "domainMismatch", mod: m });
        }
    }

    return violations;
}

/** True iff the item is well-formed. */
export function isWf(it: Item): boolean {
    return wfViolations(it).length === 0;
}
