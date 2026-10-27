/**
 * The library (operations.md §3): every crafting method as its sequence of
 * primitive operations. A method's preconditions are `require` operations,
 * placed where the check belongs: usually first, after a removal or a reforge
 * when the check reads the state those produce.
 */
import type { Gen, Rarity, TagId, TypeId } from "../model/ids.js";
import type { Mod } from "../model/mod.js";
import type { EssenceSpec } from "../model/sources.js";
import type { CurrencyKind } from "../resolve/registry.js";
import type { Range } from "./astate.js";
import type { Check, FillCount, Op, PoolSpec, Selector } from "./ops.js";

const require = (check: Check): Op => ({ kind: "require", check });
const rarity = (rarity: Rarity | "survivors"): Op => ({ kind: "rarity", rarity });
const strip = (): Op => ({ kind: "strip" });
const fill = (pool: PoolSpec, count: FillCount): Op => ({ kind: "fill", pool, count });
const remove = (selector: Selector): Op => ({ kind: "remove", selector });
const lock = (): Op => ({ kind: "lock" });

const add = (n: Range): FillCount => ({ kind: "add", n });
const reforge = (n: Range): FillCount => ({ kind: "reforge", n });
const within: FillCount = { kind: "within" };
const natural: PoolSpec = { kind: "natural" };
const tagged = (tag: TagId): PoolSpec => ({ kind: "tagged", tag });
const veiledPlaceholder: PoolSpec = { kind: "veiledPlaceholder" };

const isRare = require({ kind: "rarity", rarity: "rare" });
const isMagic = require({ kind: "rarity", rarity: "magic" });
const isNormal = require({ kind: "rarity", rarity: "normal" });
const canBeRare = require({ kind: "canBeRare" });
const openSlot = (gen?: Gen): Op =>
    require(gen === undefined ? { kind: "openSlot" } : { kind: "openSlot", gen });
const removable = (selector: Selector): Op => require({ kind: "removable", selector });

/** A random removal that ignores a cannot-roll metamod (every one but the Orb of Annulment). */
const anyMod: Selector = { honourCannotRoll: false };
/** The Orb of Annulment's removal, which spares a cannot-roll metamod's tagged mods. */
const unshielded: Selector = { honourCannotRoll: true };

/** A rare reforge lays down four to six modifiers (Chaos Orb § Mechanics). */
const RARE_REFORGE: Range = [4, 6];
/** A magic reforge lays down one or two. */
const MAGIC_REFORGE: Range = [1, 2];

/** The currencies by name (Crafting § Currency). */
export function currencyOps(kind: CurrencyKind): readonly Op[] {
    switch (kind) {
        case "transmute":
            // A prefix, a suffix or both (Orb of Transmutation § Spending).
            return [isNormal, rarity("magic"), fill(natural, add(MAGIC_REFORGE))];
        case "augment":
            return [isMagic, openSlot(), fill(natural, add([1, 1]))];
        case "alteration":
            return [isMagic, strip(), fill(natural, reforge(MAGIC_REFORGE))];
        case "regal":
            return [isMagic, canBeRare, rarity("rare"), fill(natural, add([1, 1]))];
        case "alchemy":
            return [
                isNormal,
                canBeRare,
                strip(),
                rarity("rare"),
                fill(natural, reforge(RARE_REFORGE)),
            ];
        case "chaos":
            return [isRare, strip(), fill(natural, reforge(RARE_REFORGE))];
        case "exalt":
            return [isRare, openSlot(), fill(natural, add([1, 1]))];
        case "annul":
            // No rarity gate: it works on anything with a removable mod, and a
            // Normal item already fails the check with the accurate reason.
            return [removable(unshielded), remove(unshielded)];
        case "scour":
            return [require({ kind: "strippable" }), strip(), rarity("survivors")];
        case "fracture":
            return [
                isRare,
                require({ kind: "noFracture" }),
                require({ kind: "atLeast", count: 4 }),
                lock(),
            ];
    }
}

/**
 * An essence: reforge to Rare with the row the essence grants the item's class,
 * the random fill capped by the item level and the essence's own level cap
 * (Essence § Crafting). Blocked by a protection or cannot-roll metamod.
 */
export function essenceOps(spec: EssenceSpec, ilvl: number): readonly Op[] {
    const maxLevel = Math.min(ilvl, spec.maxRandomModLevel ?? Infinity);
    return [
        require({ kind: "noBlockingMetamod" }),
        require({ kind: "essenceRarity", tier: spec.tier }),
        canBeRare,
        require({ kind: "essenceGrant", spec }),
        strip(),
        rarity("rare"),
        fill({ kind: "natural", maxLevel }, reforge(RARE_REFORGE)),
        fill({ kind: "essenceGrant", spec }, within),
    ];
}

/** A bench craft: the row, in an open slot of its side, within the crafted limit
 *  and with no modifier of its group already present (Crafting Bench). */
export function benchOps(mod: Mod): readonly Op[] {
    return [
        openSlot(mod.gen),
        require({ kind: "craftedBelowCap" }),
        require({ kind: "noGroupConflict", mod }),
        fill({ kind: "bench", mod }, add([1, 1])),
    ];
}

/** Harvest "reforge including a <tag> modifier": a rare reforge, one of whose
 *  modifiers carries the tag; greyed out when none can roll here. */
export function harvestReforgeOps(tag: TagId): readonly Op[] {
    return [
        isRare,
        strip(),
        fill(natural, reforge(RARE_REFORGE)),
        require({ kind: "poolNonEmpty", pool: tagged(tag), tag }),
        fill(tagged(tag), within),
    ];
}

/** Harvest "add a <tag> modifier, remove another random modifier": the removal
 *  first, then a tagged modifier into the freed slot. */
export function harvestAugmentOps(tag: TagId): readonly Op[] {
    return [
        isRare,
        removable(anyMod),
        remove(anyMod),
        require({ kind: "poolNonEmpty", pool: tagged(tag), tag }),
        fill(tagged(tag), add([1, 1])),
    ];
}

/** Veiled Chaos Orb: a rare reforge, one of whose modifiers is veiled. It is
 *  refused only when a veiled or unveiled modifier would survive the reforge. */
export const VEILED_CHAOS: readonly Op[] = [
    isRare,
    require({ kind: "noVeiledKept" }),
    strip(),
    fill(natural, reforge(RARE_REFORGE)),
    fill(veiledPlaceholder, within),
];

/** Veiled Exalted Orb: remove a random modifier and add a veiled one. */
export const VEILED_EXALT: readonly Op[] = [
    isRare,
    require({ kind: "noVeiled" }),
    removable(anyMod),
    remove(anyMod),
    fill(veiledPlaceholder, add([1, 1])),
];

/** Unveil the veiled modifier: one of the results offered, or the named one when
 *  the offer is small enough to be sure of it. */
export function unveilOps(
    target: { readonly type: TypeId; readonly name: string } | undefined,
): readonly Op[] {
    const ops: Op[] = [require({ kind: "veiledPresent" })];
    if (target) ops.push(require({ kind: "unveilTarget", type: target.type, name: target.name }));
    ops.push(fill(target ? { kind: "unveil", target: target.type } : { kind: "unveil" }, within));
    return ops;
}
