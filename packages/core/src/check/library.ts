/**
 * The library (operations.md §3): every crafting method as its sequence of
 * primitive operations. A method's preconditions are `require` operations,
 * placed where the check belongs: usually first, after a removal or a reforge
 * when the check reads the state those produce.
 */
import type { Base } from "../model/base.js";
import { canBeRare as canBeRareBase } from "../model/capacity.js";
import { type Gen, type Rarity, TagId, type TypeId } from "../model/ids.js";
import type { Mod } from "../model/mod.js";
import type { EssenceSpec, FossilSpec } from "../model/sources.js";
import type { CurrencyKind } from "../resolve/registry.js";
import {
    type EldritchSide,
    type Influence,
    INFLUENCE_ORB,
    INFLUENCE_STEMS,
    influenceKey,
} from "../model/marks.js";
import type { Range } from "./astate.js";
import type {
    Check,
    FillCount,
    InfluenceChange,
    Op,
    PoolSpec,
    Selector,
    Transform,
} from "./ops.js";

const require = (check: Check): Op => ({ kind: "require", check });
const rarity = (rarity: Rarity | "survivors"): Transform => ({ kind: "rarity", rarity });
const strip = (): Transform => ({ kind: "strip" });
const fill = (pool: PoolSpec, count: FillCount): Transform => ({ kind: "fill", pool, count });
const remove = (selector: Selector): Transform => ({ kind: "remove", selector });
const lock = (): Transform => ({ kind: "lock" });

const add = (n: Range): FillCount => ({ kind: "add", n });
const reforge = (n: Range | "byRarity"): FillCount => ({ kind: "reforge", n });
const within: FillCount = { kind: "within" };
const natural: PoolSpec = { kind: "natural" };
const tagged = (tag: TagId): PoolSpec => ({ kind: "tagged", tag });
const veiledPlaceholder: PoolSpec = { kind: "veiledPlaceholder" };
const influencePool: PoolSpec = { kind: "influence" };
const influence = (change: InfluenceChange): Transform => ({ kind: "influence", change });

/** A corrupted item takes no craft but the Tainted currency (Corrupted §
 *  Modifying corrupted items), so every other method opens with this. */
const notCorrupted = require({ kind: "notCorrupted" });
/** An influenced item cannot be fractured (Influenced item § Mechanics). */
const noInfluence = (what: string): Op => require({ kind: "noInfluence", what });
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
            return [notCorrupted, isNormal, rarity("magic"), fill(natural, add(MAGIC_REFORGE))];
        case "augment":
            return [notCorrupted, isMagic, openSlot(), fill(natural, add([1, 1]))];
        case "alteration":
            return [notCorrupted, isMagic, strip(), fill(natural, reforge(MAGIC_REFORGE))];
        case "regal":
            return [notCorrupted, isMagic, canBeRare, rarity("rare"), fill(natural, add([1, 1]))];
        case "alchemy":
            return [
                notCorrupted,
                isNormal,
                canBeRare,
                strip(),
                rarity("rare"),
                fill(natural, reforge(RARE_REFORGE)),
            ];
        case "chaos":
            return [notCorrupted, isRare, strip(), fill(natural, reforge(RARE_REFORGE))];
        case "exalt":
            return [notCorrupted, isRare, openSlot(), fill(natural, add([1, 1]))];
        case "annul":
            // No rarity gate: it works on anything with a removable mod, and a
            // Normal item already fails the check with the accurate reason.
            return [notCorrupted, removable(unshielded), remove(unshielded)];
        case "scour":
            return [notCorrupted, require({ kind: "strippable" }), strip(), rarity("survivors")];
        case "fracture":
            return [
                notCorrupted,
                isRare,
                noInfluence("Fracturing Orb"),
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
        notCorrupted,
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
        notCorrupted,
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
    notCorrupted,
    require({ kind: "craftedRemovable" }),
    remove({ kind: "crafted", replacing: false }),
];

/** Harvest "reforge including a <tag> modifier": a rare reforge, one of whose
 *  modifiers carries the tag; greyed out when none can roll here. */
export function harvestReforgeOps(tag: TagId): readonly Op[] {
    return [
        notCorrupted,
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
        notCorrupted,
        isRare,
        // The grove offers each of these "from a non-Influenced item" only.
        noInfluence("harvest augment craft"),
        removable(anyMod),
        remove(anyMod),
        require({ kind: "poolNonEmpty", pool: tagged(tag), tag }),
        fill(tagged(tag), add([1, 1])),
    ];
}

/** Harvest "reforge an Influenced Rare item with random modifiers, including an
 *  Influence modifier" (Harvest crafting): a rare reforge with one of the
 *  influence's rows guaranteed. */
export const HARVEST_INFLUENCE_REFORGE: readonly Op[] = [
    notCorrupted,
    isRare,
    require({ kind: "influenced", what: "The grove's influence reforge" }),
    strip(),
    require({ kind: "poolNonEmpty", pool: influencePool, tag: TagId("influence") }),
    fill(natural, reforge(RARE_REFORGE)),
    fill(influencePool, within),
];

/** Harvest "randomise the Influence types on an Influenced Normal, Magic or
 *  Rare item, as well as reforging the item with new random modifiers": the
 *  item keeps as many influences as it had, any of them, and is reforged at its
 *  rarity (`QUESTIONS.md` Q27). */
export const HARVEST_RANDOMISE: readonly Op[] = [
    notCorrupted,
    require({ kind: "influenced", what: "The grove's randomise craft" }),
    // "usage is prevented if any prefix is influenced" under a prefix protection,
    // and likewise for suffixes (Metamod § Rules and Exceptions).
    require({ kind: "noInfluencedOnProtected", what: "The grove's randomise craft" }),
    strip(),
    influence({ kind: "randomise" }),
    fill(natural, reforge("byRarity")),
];

/** A conqueror's, Shaper's or Elder's Exalted Orb: an influence and one of its
 *  modifiers onto a Rare item that has no influence or fracture (Hunter's
 *  Exalted Orb § Mechanics, Influenced item § Mechanics). */
export function influenceExaltOps(target: Influence): readonly Op[] {
    return [
        notCorrupted,
        isRare,
        // An item with an eldritch implicit takes no influence (Eldritch implicit modifier).
        require({ kind: "noEldritch", what: `A ${INFLUENCE_ORB[target]}` }),
        require({ kind: "influenceable", influence: target, what: INFLUENCE_ORB[target] }),
        noInfluence(INFLUENCE_ORB[target]),
        require({ kind: "noFracture" }),
        openSlot(),
        influence({ kind: "set", key: influenceKey([target]) }),
        fill(influencePool, add([1, 1])),
    ];
}

/** An Awakener's Orb, the donor's influence given: the item, which has one
 *  other influence, is reforged Rare with both, the metamods ignored
 *  (Awakener's Orb § Mechanics). The influenced modifier the orb tries to keep
 *  from each item is not guaranteed. */
export function awakenerOps(donor: Influence): readonly Op[] {
    return [
        notCorrupted,
        require({ kind: "awakenerTarget", donor }),
        canBeRare,
        { kind: "unprotect" },
        strip(),
        rarity("rare"),
        influence({ kind: "add", influence: donor }),
        fill(natural, reforge(RARE_REFORGE)),
    ];
}

/** Beastcraft "add a mod to a <influence> item" (Beastcrafting): a modifier
 *  into an open slot of a Rare item with that influence, drawn at the beast's
 *  level, the influence's rows among them. */
export function beastAddInfluenceOps(target: Influence, level: number): readonly Op[] {
    return [
        notCorrupted,
        isRare,
        require({
            kind: "influenced",
            what: "The Bestiary's add-a-modifier recipe",
            influence: target,
        }),
        openSlot(),
        fill({ kind: "natural", level }, add([1, 1])),
    ];
}

const corrupt: Transform = { kind: "corrupt" };
const end: readonly Transform[] = [{ kind: "end" }];
const either = (...branches: readonly (readonly Transform[])[]): Op => ({
    kind: "either",
    branches,
});
const corruptedItem = (what: string): Op => require({ kind: "corruptedItem", what });

/** A Vaal Orb's one outcome that touches the modifiers: a Rare with six, the
 *  metamods respected (Vaal Orb § Equipment); the implicit and socket outcomes
 *  and "no effect" leave the modifiers as they are. */
function brickBranch(base: Base, influenced: boolean): readonly Transform[] {
    if (!canBeRareBase(base)) return [];
    // A class no influence can mark is reforged without one (`QUESTIONS.md` Q32).
    const marks = influenced && INFLUENCE_STEMS[base.itemClass] !== undefined;
    return [
        strip(),
        rarity("rare"),
        ...(marks ? [influence({ kind: "anyOne" })] : []),
        fill(natural, reforge([6, 6])),
    ];
}

/** The three jewels a Vaal Orb may turn into a corruption-exclusive unique
 *  (Vaal Orb § Jewels), on which the craft ends. */
const UNIQUE_JEWELS = new Set(["Cobalt Jewel", "Crimson Jewel", "Viridian Jewel"]);

/** A Vaal Orb: the item is corrupted, and either unchanged in what the checker
 *  tracks or reforged Rare with six modifiers (Vaal Orb § Equipment); one of
 *  the three basic jewels may become a unique instead (Vaal Orb § Jewels). */
export function vaalOps(base: Base): readonly Op[] {
    const brick = brickBranch(base, false);
    const unique = UNIQUE_JEWELS.has(base.name ?? "") ? [end] : [];
    // The implicit outcome replaces one of the item's implicits, an eldritch
    // one among them (Eldritch implicit modifier).
    const implicit: readonly Transform[] = [
        { kind: "eldritch", change: { kind: "replaced", count: 1 } },
    ];
    const outcomes = [implicit, ...(brick.length > 0 ? [brick] : []), ...unique];
    return [notCorrupted, corrupt, either([], ...outcomes)];
}

/** The item types the Corruption Altar takes: weapons, armour, jewellery,
 *  quivers and jewels (Locus of Corruption § Corruption Altar). */
const ALTAR_TAGS = ["weapon", "armour", "ring", "amulet", "belt", "quiver", "jewel"].map(TagId);

/** The Corruption Altar (Locus of Corruption § Possible outcomes): as a Vaal
 *  Orb, but the reforge makes an influenced Rare, and one outcome destroys the
 *  item, ending the craft on that path. Which influence is a probe, so the
 *  item may have any one or what it had (`QUESTIONS.md` Q32). */
export function locusOps(base: Base): readonly Op[] {
    const brick = brickBranch(base, true);
    return [
        notCorrupted,
        require({
            kind: "baseHasAnyTag",
            tags: ALTAR_TAGS,
            what: "weapon, armour, piece of jewellery, quiver or jewel",
        }),
        corrupt,
        // The double corruption replaces two implicits, both eldritch ones among them.
        either(
            [],
            [{ kind: "eldritch", change: { kind: "replaced", count: 2 } }],
            ...(brick.length > 0 ? [brick] : []),
            end,
        ),
    ];
}

/** A Tainted Chaos Orb: a corrupted Rare is reforged, or stripped to the
 *  rarity its survivors allow; a protected side is not kept, since the wiki
 *  names the fractured modifier as the one survivor (Tainted Chaos Orb §
 *  Mechanics; the reforge half is `QUESTIONS.md` Q33). */
export const TAINTED_CHAOS: readonly Op[] = [
    corruptedItem("A Tainted Chaos Orb"),
    isRare,
    { kind: "unprotect" },
    either([strip(), fill(natural, reforge(RARE_REFORGE))], [strip(), rarity("survivors")]),
];

/** A Tainted Exalted Orb: a corrupted Rare gains a modifier or loses one. */
export const TAINTED_EXALT: readonly Op[] = [
    corruptedItem("A Tainted Exalted Orb"),
    isRare,
    either([fill(natural, add([1, 1]))], [remove(anyMod)]),
];

/** A Tainted Divine Teardrop: each modifier of a corrupted Rare may move a
 *  tier either way, the crafted ones excepted (Tainted Divine Teardrop §
 *  Mechanics); the checker forgets their tiers. */
export const TAINTED_DIVINE: readonly Op[] = [
    corruptedItem("A Tainted Divine Teardrop"),
    isRare,
    { kind: "relax", crafted: false },
];

/** The classes an ember or ichor marks: body armour, boots, gloves and helmets. */
const ELDRITCH_TAGS = ["body_armour", "boots", "gloves", "helmet"].map(TagId);
const ELDRITCH_NAME: Readonly<Record<EldritchSide, string>> = {
    exarch: "Eldritch Ember",
    eater: "Eldritch Ichor",
};
const SIDE_OF: Readonly<Record<EldritchSide, Gen>> = { exarch: "prefix", eater: "suffix" };
const dominantOrb = (name: string, side: EldritchSide): Op =>
    require({ kind: "dominant", side, what: `An ${name}` });

/** An Eldritch Ember or Ichor: that implicit set to the tier the item comes
 *  in, on an armour piece of any rarity with no influence (the item's help
 *  text; Eldritch implicit modifier). */
export function eldritchImplicitOps(
    side: EldritchSide,
    tier: number,
    types: readonly TypeId[],
): readonly Op[] {
    return [
        notCorrupted,
        require({
            kind: "baseHasAnyTag",
            tags: ELDRITCH_TAGS,
            what: "body armour, boots, gloves or helmet",
        }),
        noInfluence(ELDRITCH_NAME[side]),
        { kind: "eldritch", change: { kind: "set", side, tier, types } },
    ];
}

/** An Eldritch Chaos Orb: the dominant implicit's side is rerolled, the
 *  other kept (Eldritch Chaos Orb). */
export function eldritchChaosOps(side: EldritchSide): readonly Op[] {
    const other: Gen = SIDE_OF[side] === "prefix" ? "suffix" : "prefix";
    return [
        notCorrupted,
        isRare,
        dominantOrb("Eldritch Chaos Orb", side),
        { kind: "keep", gen: other },
        strip(),
        fill({ kind: "natural", gen: SIDE_OF[side] }, reforge(RARE_REFORGE)),
    ];
}

/** An Eldritch Exalted Orb: a modifier added on the dominant implicit's side. */
export function eldritchExaltOps(side: EldritchSide): readonly Op[] {
    const gen = SIDE_OF[side];
    return [
        notCorrupted,
        isRare,
        dominantOrb("Eldritch Exalted Orb", side),
        openSlot(gen),
        fill({ kind: "natural", gen }, add([1, 1])),
    ];
}

/** An Eldritch Orb of Annulment: a modifier removed from the dominant
 *  implicit's side, on a Magic or Rare item. */
export function eldritchAnnulOps(side: EldritchSide): readonly Op[] {
    // Every metamod is respected (Metamod § Rules and Exceptions), the
    // cannot-roll shield as for the plain orb; a protected side is refused
    // rather than left alone, since the orb would be spent for nothing.
    const gen = SIDE_OF[side];
    const victim: Selector = { kind: "random", honourCannotRoll: true, gen };
    return [
        notCorrupted,
        dominantOrb("Eldritch Orb of Annulment", side),
        require({ kind: "unprotectedSide", gen, what: "An Eldritch Orb of Annulment" }),
        removable(victim),
        remove(victim),
    ];
}

/** An Orb of Conflict: one eldritch implicit up a tier, the other down, on an
 *  item that has both (Orb of Conflict). */
export const CONFLICT: readonly Op[] = [
    notCorrupted,
    require({ kind: "bothEldritch" }),
    { kind: "eldritch", change: { kind: "conflict" } },
];

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
        notCorrupted,
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
        notCorrupted,
        openSlot(row.gen),
        require({ kind: "noGroupConflict", mod: row }),
        fill({ kind: "rows", mods: [row] }, add([1, 1])),
    ];
}

/** Beastcraft "create an imprint" of a Magic item or a Rare talisman
 *  (Beastcrafting, Imprint): the item as it stands is held, so long as it is
 *  not fractured. */
export const BEAST_IMPRINT: readonly Op[] = [
    notCorrupted,
    require({ kind: "imprintable" }),
    require({ kind: "noFracture" }),
    { kind: "imprint" },
];

/** Apply the held imprint (Imprint § Mechanics): the item becomes what it was
 *  when imprinted; an item fractured since cannot take it. */
export const RESTORE: readonly Op[] = [
    notCorrupted,
    require({ kind: "hasImprint" }),
    require({ kind: "noFracture" }),
    { kind: "restore" },
];

/** Beastcraft "add a crafted meta-modifier": one of the five metamods, random
 *  among those that fit, within the crafted limit (Beastcrafting). */
export const BEAST_METAMOD: readonly Op[] = [
    notCorrupted,
    require({ kind: "craftedBelowCap" }),
    require({ kind: "metamodFits" }),
    fill({ kind: "metamods" }, add([1, 1])),
];

/** Beastcraft "fracture a modifier on a Rare Talisman with at least 4 modifiers"
 *  (Beastcrafting): the Fracturing Orb's rule on a talisman. */
export const BEAST_FRACTURE: readonly Op[] = [
    notCorrupted,
    isRare,
    require({ kind: "baseHasTag", tag: TagId("talisman"), what: "talisman" }),
    noInfluence("Bestiary fracture"),
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
        notCorrupted,
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
    const corrupts = r.fossils.some((f) => f.corrupts);
    return [
        notCorrupted,
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
        // The Bloodstained Fossil corrupts the item (Fossil § Version history 3.16.0).
        ...(corrupts ? [corrupt] : []),
    ];
}

/** Veiled Chaos Orb: a rare reforge, one of whose modifiers is veiled. It is
 *  refused only when a veiled or unveiled modifier would survive the reforge. */
export const VEILED_CHAOS: readonly Op[] = [
    notCorrupted,
    isRare,
    require({ kind: "noVeiledKept" }),
    strip(),
    fill(natural, reforge(RARE_REFORGE)),
    fill(veiledPlaceholder, within),
];

/** Veiled Exalted Orb: remove a random modifier and add a veiled one. */
export const VEILED_EXALT: readonly Op[] = [
    notCorrupted,
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
    const ops: Op[] = [notCorrupted, require({ kind: "veiledPresent" })];
    if (target) ops.push(require({ kind: "unveilTarget", type: target.type, name: target.name }));
    ops.push(fill(target ? { kind: "unveil", target: target.type } : { kind: "unveil" }, within));
    return ops;
}
