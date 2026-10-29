/**
 * The library (operations.md §3): every crafting method as its sequence of
 * primitive operations. A method's preconditions are `require` operations,
 * placed where the check belongs: usually first, after a removal or a reforge
 * when the check reads the state those produce.
 */
import { type Gen, type Rarity, TagId, type TypeId } from "../model/ids.js";
import type { Mod } from "../model/mod.js";
import type { EssenceSpec, FossilSpec } from "../model/sources.js";
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
const anyMod: Selector = { kind: "random", honourCannotRoll: false };
/** The Orb of Annulment's removal, which spares a cannot-roll metamod's tagged mods. */
const unshielded: Selector = { kind: "random", honourCannotRoll: true };

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
        case "binding":
            // The Orb of Binding is an alchemy that also sets sockets, which the
            // item does not model (Orb of Binding § Mechanics).
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
        require({ kind: "craftedReplaceable" }),
        remove({ kind: "crafted", replacing: true }),
        openSlot(mod.gen),
        require({ kind: "craftedBelowCap" }),
        require({ kind: "noGroupConflict", mod }),
        fill({ kind: "bench", mod }, add([1, 1])),
    ];
}

/** The bench's "remove crafted modifiers" (Crafting Bench § Using the crafting bench). */
export const BENCH_REMOVE: readonly Op[] = [
    require({ kind: "craftedRemovable" }),
    remove({ kind: "crafted", replacing: false }),
];

/** Harvest "reforge including a <tag> modifier": a rare reforge, one of whose
 *  modifiers carries the tag; greyed out when none can roll here. */
export function harvestReforgeOps(tag: TagId): readonly Op[] {
    return [
        isRare,
        strip(),
        require({ kind: "poolNonEmpty", pool: tagged(tag), tag }),
        fill(natural, reforge(RARE_REFORGE)),
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

/** A Foulborn orb is its plain counterpart drawing from the top half of each
 *  type's tiers (Foulborn currency § Mechanics). */
export function foulbornOps(verb: "augment" | "regal" | "exalt"): readonly Op[] {
    return currencyOps(verb).map((op) =>
        op.kind === "fill" && op.pool.kind === "natural"
            ? { ...op, pool: { ...op.pool, topTiers: true } }
            : op,
    );
}

/** The level a beast of unknown level is read at: the pool at the top of the
 *  ladder holds every row a beast of any level could add. */
export const ANY_BEAST_LEVEL = 100;

/** Beastcraft "add a prefix, remove a random suffix" and its mirror
 *  (Beastcrafting): the added modifier is drawn at the beast's level rather than
 *  the item's; under the other side's protection it adds without removing
 *  (Metamod § Rules and Exceptions). */
export function beastAddOps(gen: Gen, level: number): readonly Op[] {
    const other: Gen = gen === "prefix" ? "suffix" : "prefix";
    const victim: Selector = { kind: "random", honourCannotRoll: false, gen: other };
    return [
        isRare,
        openSlot(gen),
        removable(victim),
        remove(victim),
        fill({ kind: "natural", gen, level }, add([1, 1])),
    ];
}

/** Beastcraft "craft an Aspect skill onto an item": the Aspect's row in an open
 *  slot of its side, no other skill-granting modifier possibly present
 *  (Beastcrafting). */
export function beastAspectOps(row: Mod): readonly Op[] {
    return [
        openSlot(row.gen),
        require({ kind: "noGroupConflict", mod: row }),
        fill({ kind: "rows", mods: [row] }, add([1, 1])),
    ];
}

/** Beastcraft "create an imprint" of a Magic item or a Rare talisman
 *  (Beastcrafting, Imprint): the item as it stands is held, so long as it is
 *  not fractured. */
export const BEAST_IMPRINT: readonly Op[] = [
    require({ kind: "imprintable" }),
    require({ kind: "noFracture" }),
    { kind: "imprint" },
];

/** Apply the held imprint (Imprint § Mechanics): the item becomes what it was
 *  when imprinted; an item fractured since cannot take it. */
export const RESTORE: readonly Op[] = [
    require({ kind: "hasImprint" }),
    require({ kind: "noFracture" }),
    { kind: "restore" },
];

/** Beastcraft "add a crafted meta-modifier": one of the five metamods, random
 *  among those that fit, within the crafted limit (Beastcrafting). */
export const BEAST_METAMOD: readonly Op[] = [
    require({ kind: "craftedBelowCap" }),
    require({ kind: "metamodFits" }),
    fill({ kind: "metamods" }, add([1, 1])),
];

/** Beastcraft "fracture a modifier on a Rare Talisman with at least 4 modifiers"
 *  (Beastcrafting): the Fracturing Orb's rule on a talisman. */
export const BEAST_FRACTURE: readonly Op[] = [
    isRare,
    require({ kind: "baseHasTag", tag: TagId("talisman"), what: "talisman" }),
    require({ kind: "noFracture" }),
    require({ kind: "atLeast", count: 4 }),
    lock(),
];

/** Harvest "change a modifier into a similar tier modifier of another element"
 *  (Harvest crafting): the named modifier goes and one of the target's rows at
 *  its tier takes the slot; both protections are respected (Metamod § Rules and
 *  Exceptions, "Change Element of Resistance"). */
export function harvestChangeOps(from: TypeId, label: string, to: readonly Mod[]): readonly Op[] {
    return [
        require({ kind: "typeRemovable", type: from, label }),
        ...to.slice(0, 1).map((mod) => require({ kind: "noGroupConflict", mod })),
        remove({ kind: "type", type: from }),
        fill({ kind: "rows", mods: to }, add([1, 1])),
    ];
}

/** A socketed resonator, its fossils' rows resolved against the catalog. */
export interface Resonator {
    readonly fossils: readonly FossilSpec[];
    /** The fossil-only rows the fossils add to the pool. */
    readonly added: readonly Mod[];
    /** The rows the fossils force, each guaranteed. */
    readonly forced: readonly Mod[];
    /** The corrupted essences' modifiers for the item's class. */
    readonly corrupted: readonly Mod[];
}

/** A resonator: a rare reforge shaped by its fossils (Fossil § Mechanics,
 *  Resonator § Mechanics): blocked category tags leave the pool, the fossils'
 *  rows join it, a forced row or a corrupted-essence modifier is guaranteed,
 *  and the Fractured Fossil fractures one of the rolled modifiers. */
export function resonatorOps(r: Resonator): readonly Op[] {
    const blocked = new Set<TagId>();
    for (const f of r.fossils) for (const t of f.blockedTags) blocked.add(t);
    const unblocked = (m: Mod): boolean => ![...m.implicitTags].some((t) => blocked.has(t));
    const essenceChance = Math.max(0, ...r.fossils.map((f) => f.corruptedEssenceChance));
    const essence = essenceChance > 0 ? r.corrupted.filter(unblocked) : [];
    const fractures = r.fossils.some((f) => f.fractures);
    return [
        isRare,
        require({ kind: "noBlockingMetamod" }),
        ...r.fossils.map((fossil) => require({ kind: "fossilAllowed", fossil })),
        ...(fractures ? [require({ kind: "noFracture" })] : []),
        strip(),
        rarity("rare"),
        fill(
            { kind: "fossil", blocked, added: r.added.filter(unblocked), essence },
            reforge(RARE_REFORGE),
        ),
        ...r.forced.filter(unblocked).map((mod) => fill({ kind: "rows", mods: [mod] }, within)),
        ...(essenceChance === 100 ? [fill({ kind: "rows", mods: essence }, within)] : []),
        ...(fractures ? [lock()] : []),
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
