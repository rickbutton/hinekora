/**
 * Well-formedness (typing rules §2.1) — the refinement invariant every item
 * must satisfy at all times.
 *
 *   wf(it) :=
 *        |prefixes| <= maxPre(rarity, effects)   -- slot caps, effect-adjusted
 *     && |suffixes| <= maxSuf(rarity, effects)
 *     && all affix ModTypes distinct             -- (1) no duplicate mod
 *     && all affix Families pairwise disjoint     -- (2) mutual exclusion
 *     && every affix.minLevel <= ilvl             -- tier gate
 *     && every affix.domain == base.domain        -- domain match
 *
 * Crucially, TAGS APPEAR NOWHERE here. Coexistence is ModType-distinct +
 * Family-disjoint + slot counts + tier gate + domain match. Tags are an
 * eligibility concern (spawn weights), not a coexistence rule — a correction
 * the design calls out explicitly.
 *
 * The design discharges wf to an SMT solver; the constraints are small linear
 * arithmetic over counts plus set membership, so M1 hand-rolls the decision
 * procedure (brief §7 "start hand-rolled"). We return a structured list of
 * violations rather than a bare boolean: the same data powers the state
 * renderer, precondition errors, and precise tests.
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

/** Effect-adjusted cap for one generation. `SlotDelta` effects (§9.4) shift it. */
export function slotCap(it: Item, gen: Gen): number {
    return baseSlotCap(it) + slotDelta(it, gen);
}

export const maxPre = (it: Item): number => slotCap(it, "prefix");
export const maxSuf = (it: Item): number => slotCap(it, "suffix");

/**
 * Is there room for another affix of generation `gen`? Used by `pool`'s slot
 * rule and by the currency-op preconditions later.
 */
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

/**
 * Every way in which `it` violates well-formedness. Empty ⇔ the item is wf.
 * Checks are independent, so all violations are reported at once (better errors
 * than failing on the first).
 */
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
