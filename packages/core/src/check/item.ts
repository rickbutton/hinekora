/**
 * The concrete item of the exact checker's model (docs/EXACT.md §2): one item
 * on a fixed base and item level, every fact about it known. The state is a
 * set of these held symbolically; one is read out of it to name an item that
 * breaks a step.
 */
import type { ModId, Rarity, TypeId } from "../model/ids.js";
import type { InfluenceKey } from "../model/marks.js";

/** One modifier on the item. `value` is the first number of the row's text
 *  (`check/values.ts`), undefined for a row whose text has none. `crafted` is a
 *  mark of its own: a bench row is always crafted, and a Harvest change keeps
 *  the mark on the natural row it puts in a crafted modifier's place. */
export interface CMod {
    readonly row: ModId;
    readonly value: number | undefined;
    readonly fractured: boolean;
    readonly crafted: boolean;
}

/** An eldritch implicit: tier 0 is none. `type` is which implicit it is,
 *  undefined only where it is absent or the catalogue names no implicit of
 *  that side and tier on the base. */
export interface CEldritch {
    readonly tier: number;
    readonly type: TypeId | undefined;
}

export interface CItem {
    readonly rarity: Rarity;
    /** Order carries no meaning. */
    readonly mods: readonly CMod[];
    readonly influences: InfluenceKey;
    readonly corrupted: boolean;
    readonly exarch: CEldritch;
    readonly eater: CEldritch;
    readonly strands: number;
    /** The held imprint, itself an item with no imprint. */
    readonly imprint: CItem | undefined;
}
