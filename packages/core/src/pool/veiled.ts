/**
 * `veiledPool`: which unveiled modifiers a veiled mod on an item can reveal. A
 * sibling of `pool` (§3) restricted to the unveiled result mods, filtered by the
 * base (class + ilvl + spawn eligibility) and by the families already present —
 * the last of these is "blocking": a mod whose group is on the item is not an
 * offered choice, so bench-crafting a conflicting mod removes it.
 */
import type { Base } from "../model/base.js";
import type { GroupId } from "../model/ids.js";
import type { Mod } from "../model/mod.js";
import { isUnveiledResult } from "../model/veiled.js";
import { isNonzero } from "../model/weight.js";
import { lookupWeight } from "./pool.js";

/** The unveiled mods this item could reveal, each carrying its generation so a
 *  caller can split prefixes from suffixes. */
export function veiledPool(
    catalog: readonly Mod[],
    base: Base,
    ilvl: number,
    presentFamilies: ReadonlySet<GroupId>,
): readonly Mod[] {
    const out: Mod[] = [];
    for (const m of catalog) {
        if (!isUnveiledResult(m)) continue;
        if (m.minLevel > ilvl) continue; // tier gate
        if (m.classRestriction && !m.classRestriction.has(base.itemClass)) continue;
        if (!disjoint(m.families, presentFamilies)) continue; // blocking
        const weight = lookupWeight(m, base.tags); // eligibility on this base
        if (weight === null || !isNonzero(weight)) continue;
        out.push(m);
    }
    return out;
}

function disjoint<T>(a: ReadonlySet<T>, b: ReadonlySet<T>): boolean {
    for (const x of a) if (b.has(x)) return false;
    return true;
}
