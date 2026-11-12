/**
 * Which family implements each operation (a fill by its pool, a removal by
 * its selector), each compound run and each check, in the symbolic frame
 * (exact/ops/) and the reference (exact/reference/ops/) alike. The frame
 * itself runs `require`, `unprotect`, `keep`, `either` and `end`.
 */
import type { Check } from "../../check/ops.js";
import type { DispatchKey } from "./handler.js";
import type { CompoundKind } from "./steps.js";

export type Family = "frame" | "marks" | "fill" | "remove" | "crafted" | "misc";
export type FrameKind = "require" | "unprotect" | "keep" | "either" | "end";

export const OP_OWNERS = {
    require: "frame",
    unprotect: "frame",
    keep: "frame",
    either: "frame",
    end: "frame",
    corrupt: "marks",
    rarity: "marks",
    influence: "marks",
    eldritch: "marks",
    "fill:natural": "fill",
    "fill:tagged": "fill",
    "fill:fossil": "fill",
    "fill:essenceGrant": "fill",
    "fill:influence": "fill",
    "fill:rows": "fill",
    "fill:bench": "crafted",
    "fill:veiledPlaceholder": "crafted",
    "fill:unveil": "crafted",
    "fill:metamods": "crafted",
    "remove:crafted": "crafted",
    lock: "crafted",
    strip: "remove",
    "remove:random": "remove",
    "remove:influenced": "remove",
    elevate: "remove",
    "remove:type": "misc",
    reroll: "misc",
    relax: "misc",
    strands: "misc",
    imprint: "misc",
    restore: "misc",
} as const satisfies Readonly<Record<FrameKind | DispatchKey, Family>>;

export const COMPOUND_OWNERS = {
    reforgeWith: "fill",
    addAnother: "remove",
    change: "misc",
} as const satisfies Readonly<Record<CompoundKind, Family>>;

export const CHECK_OWNERS = {
    rarity: "marks",
    notMagic: "marks",
    notNormal: "marks",
    canBeRare: "marks",
    notCorrupted: "marks",
    corruptedItem: "marks",
    noInfluence: "marks",
    influenced: "marks",
    influenceable: "marks",
    noEldritch: "marks",
    dominant: "marks",
    bothEldritch: "marks",
    baseHasTag: "marks",
    baseHasAnyTag: "marks",
    minItemLevel: "marks",
    openSlot: "fill",
    poolNonEmpty: "fill",
    noBlockingMetamod: "fill",
    fossilAllowed: "fill",
    essenceRarity: "fill",
    essenceGrant: "fill",
    removable: "remove",
    strippable: "remove",
    unprotectedSide: "remove",
    influencedAtLeast: "remove",
    noInfluencedOnProtected: "remove",
    typeRemovable: "misc",
    atLeast: "crafted",
    noFracture: "crafted",
    craftedBelowCap: "crafted",
    craftedRemovable: "crafted",
    craftedReplaceable: "crafted",
    noGroupConflict: "crafted",
    metamodFits: "crafted",
    veiledPresent: "crafted",
    noVeiled: "crafted",
    noVeiledKept: "crafted",
    unveilTarget: "crafted",
    hasImprint: "misc",
    imprintable: "misc",
} as const satisfies Readonly<Record<Check["kind"], Family>>;
