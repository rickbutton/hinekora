/**
 * The surface's methods as one table: the words that open a statement, the
 * argument slots that follow, a line of help, and how the arguments become the
 * operations the checker runs. The parser, completion, hover and the checker's
 * dispatch read this table and know no method themselves; adding a method is
 * an entry here on top of its sequence in `library.ts`.
 */
import type { Base } from "../model/base.js";
import { type Gen, type ModId, TagId, type TypeId } from "../model/ids.js";
import {
    dominantOf,
    ELDRITCH_SIDES,
    ELDRITCH_TIERS,
    type EldritchSide,
    type EldritchTierName,
    type EldritchKey,
    eldritchLabel,
    eldritchTierOf,
    INFLUENCE_ORB,
    type InfluenceKey,
    influenceKey,
    INFLUENCES,
    influenceSetLabel,
    influencesOf,
    isInfluence,
} from "../model/marks.js";
import type { Mod } from "../model/mod.js";
import { type FossilSpec, isCorruptedEssence } from "../model/sources.js";
import { lookupWeight } from "../pool/pool.js";
import { resolveMessage } from "../resolve/messages.js";
import { HARVEST_AUGMENT_TAGS, type Registry, STANDARD_CURRENCIES } from "../resolve/registry.js";
import { tierLadder, tierLadders } from "../resolve/tiers.js";
import {
    ANY_BEAST_LEVEL,
    beastFractureOps,
    BEAST_IMPRINT,
    BEAST_METAMOD,
    BENCH_REMOVE,
    CONFLICT,
    DOMINANCE,
    eldritchAnnulOps,
    eldritchChaosOps,
    eldritchExaltOps,
    eldritchImplicitOps,
    beastAddInfluenceOps,
    beastAddOps,
    beastAspectOps,
    benchOps,
    currencyOps,
    essenceOps,
    foulbornOps,
    HARVEST_INFLUENCE_REFORGE,
    HARVEST_RANDOMISE,
    harvestAugmentOps,
    harvestChangeOps,
    harvestReforgeOps,
    influenceExaltOps,
    locusOps,
    resonatorOps,
    TAINTED_CHAOS,
    TAINTED_DIVINE,
    TAINTED_EXALT,
    vaalOps,
    RESTORE,
    unveilOps,
    VEILED_CHAOS,
    VEILED_EXALT,
} from "./library.js";
import type { Op } from "./ops/types.js";

/** What a quoted name in an argument slot names in the catalog. */
export type NameKind = "mod" | "essence" | "bench" | "fossil" | "aspect" | "tag";

/**
 * An argument slot. Slots are filled in order and an optional slot is always
 * last, so the i-th argument always belongs to the i-th slot (a `names` slot
 * takes every remaining argument).
 */
export type Slot =
    | { readonly kind: "name"; readonly of: NameKind; readonly optional?: true }
    | { readonly kind: "names"; readonly of: NameKind; readonly max: number }
    | { readonly kind: "word"; readonly oneOf: readonly string[] }
    | { readonly kind: "int"; readonly optional?: true }
    | { readonly kind: "tier"; readonly optional?: true };

/** A literal argument, every parameter bound. */
export type Literal =
    | { readonly kind: "string"; readonly value: string }
    | { readonly kind: "word"; readonly value: string }
    | { readonly kind: "int"; readonly value: number }
    | { readonly kind: "tier"; readonly value: number };

/**
 * What a method's builder reads of the items the statement reaches, from the
 * checker's views (check/build.ts `methodItemOf`). The fields are what the
 * items may be.
 */
export interface MethodItem {
    readonly base: Base;
    readonly ilvl: number;
    /** The influence sets the item may have. */
    readonly influences: ReadonlySet<InfluenceKey>;
    /** The pairs of eldritch tiers it may have. */
    readonly eldritch: ReadonlySet<EldritchKey>;
    /** The rows a modifier type may be at, where they are known; a type with
     *  no entry may be at any of its rows. */
    readonly tiers: ReadonlyMap<TypeId, ReadonlySet<ModId>>;
}

/** The influence tags the item carries on any path: what a name written
 *  against it may mean. */
export function influenceTagsOfItem(a: MethodItem, registry: Registry): ReadonlySet<TagId> {
    const out = new Set<TagId>();
    for (const key of a.influences) {
        for (const i of influencesOf(key)) {
            for (const t of registry.influenceTags(a.base, i)) out.add(t);
        }
    }
    return out;
}

/** Why a method could not be built from its arguments, in the game's words. */
export interface Refusal {
    readonly refused: string;
}

export interface Method {
    /** The words that open the statement: `chaos`, `beast add`, `harvest change`. */
    readonly words: readonly string[];
    readonly args: readonly Slot[];
    /** One line of help for the editor. */
    readonly doc: string;
    /** The operations for these arguments, against the catalog and the state
     *  the statement reaches. */
    readonly build: (
        args: readonly Literal[],
        a: MethodItem,
        registry: Registry,
    ) => readonly Op[] | Refusal;
}

const name = (of: NameKind, optional?: true): Slot =>
    optional ? { kind: "name", of, optional } : { kind: "name", of };
const word = (...oneOf: string[]): Slot => ({ kind: "word", oneOf });
const refuse = (refused: string): Refusal => ({ refused });

const text = (l: Literal | undefined): string =>
    l === undefined ? "" : l.kind === "string" || l.kind === "word" ? l.value : String(l.value);
const num = (l: Literal | undefined): number | undefined =>
    l === undefined ? undefined : l.kind === "int" || l.kind === "tier" ? l.value : undefined;

const DEFAULT_TAG = TagId("default");

/** The affix names of the Incursion modifiers: the game names each after the
 *  architect whose room makes it, and no other modifier carries those names. */
const INCURSION_AFFIXES = new Set([
    "Citaqualotl's",
    "Guatelitzi's",
    "Matatl's",
    "Tacati's",
    "Topotante's",
    "Xopec's",
    "of Citaqualotl",
    "of Guatelitzi",
    "of Matatl",
    "of Puhuarte",
    "of Tacati",
]);

const isNatural = (m: Mod): boolean => (m.source ?? "natural") === "natural";

/**
 * The rows of `type` that stand to a placed row as its counterpart: the same
 * source, level, side and domain, and a row that source puts on this item.
 * The bench and the essences say which classes take a row. Any other row
 * that rolls somewhere is on the item where its spawn table, read first entry
 * first (item-model.md §5 "Spawn table"), weighs it under the base's tags and
 * its influences': an unveiled two-handed row is no counterpart on a wand,
 * whose own tag zeroes it. A row that rolls nowhere says it by the tags it
 * names, a row naming only other items' tags being theirs. A tag in `maybe`
 * is one the item may carry, read wherever it admits the row
 * (`lookupWeight`'s optimistic reading).
 */
export function isTwinOn(
    was: Mod,
    m: Mod,
    base: Base,
    registry: Registry,
    tags: ReadonlySet<TagId>,
    maybe?: ReadonlySet<TagId>,
): boolean {
    const cls = base.itemClass;
    switch (was.source) {
        case "bench":
            return registry.benchModsFor(cls).has(m.id);
        case "essence":
            return registry.essences.some((e) => e.grants.get(cls) === m.id);
        default: {
            if (m.spawn.some((w) => w.weight > 0)) {
                return (lookupWeight(m, new Set([...base.tags, ...tags]), maybe) ?? 0) > 0;
            }
            const named = (t: TagId): boolean =>
                base.tags.has(t) || tags.has(t) || maybe?.has(t) === true;
            return (
                m.spawn.every((w) => w.tag === DEFAULT_TAG) ||
                m.spawn.some((w) => w.tag !== DEFAULT_TAG && named(w.tag))
            );
        }
    }
}

function twinRows(
    was: Mod,
    type: TypeId,
    a: MethodItem,
    tags: ReadonlySet<TagId>,
    registry: Registry,
): readonly Mod[] {
    // The paths' influences together are no one item's, so they belong in
    // `maybe`; read as sure they let an early zero of one influence stop a row
    // another path's influence weighs. The exact checker builds per influence.
    const onThisItem = (m: Mod): boolean => isTwinOn(was, m, a.base, registry, tags);
    return registry.catalog.filter(
        (m) =>
            m.type === type &&
            m.source === was.source &&
            m.minLevel === was.minLevel &&
            m.domain === was.domain &&
            m.gen === was.gen &&
            onThisItem(m),
    );
}

/** The Harvest change: both names resolved, the pair one the grove offers. */
function harvestChange(
    fromName: string,
    toName: string,
    a: MethodItem,
    registry: Registry,
): readonly Op[] | Refusal {
    const tags = influenceTagsOfItem(a, registry);
    const ctx = { base: a.base, ilvl: a.ilvl, tags };
    const from = registry.resolveModType(fromName, ctx);
    if (!from.ok) return refuse(resolveMessage(from.error));
    const to = registry.resolveModType(toName, ctx);
    if (!to.ok) return refuse(resolveMessage(to.error));
    const catalog = registry.catalog;
    // The grove offers the craft for the three elemental resistances among
    // themselves and the three elemental damages among themselves (the Sacred
    // Grove's twelve "Change a modifier that grants …" options), each for the
    // modifier types its own list names.
    const source = registry.harvestChangeOf(from.value);
    const target = registry.harvestChangeOf(to.value);
    if (
        source === undefined ||
        target === undefined ||
        source.kind !== target.kind ||
        source.element === target.element
    ) {
        return refuse(
            `The grove changes a fire, cold or lightning resistance into another of the three, or a fire, cold or lightning damage modifier likewise — not "${fromName}" into "${toName}".`,
        );
    }
    // The modifier becomes its counterpart of the other element, not any
    // modifier of that element: the data's table pairs them, and leaves out
    // the pairs the grove refuses.
    const counterpart = registry.harvestChangeTarget(from.value, target.element);
    if (counterpart === undefined) {
        return refuse(
            `The grove has no ${target.element} modifier to change "${fromName}" into: it changes no critical strike multiplier, nor a modifier the other element has no form of.`,
        );
    }
    if (counterpart !== to.value) {
        return refuse(
            `The grove changes "${fromName}" into "${registry.typeLabel(counterpart)}", not "${toName}".`,
        );
    }
    // The result is what each row the source may be would become, together:
    // its recorded rows, or with none recorded any row of its ladder, any row
    // another source places and any natural row an essence places on the
    // item's class. The ladders are whole, whatever the item's level: an
    // essence or an earlier change may have left a row above it.
    const wholeFrom = tierLadder(catalog, a.base, from.value, tags);
    // An influence's rows are a ladder of their own, numbered apart, and a
    // modifier is taken to stay within it: the game has not been seen to
    // change one on an item with two influences (`QUESTIONS.md` Q101).
    const laddersFrom = tierLadders(catalog, a.base, from.value, tags);
    const laddersTo = tierLadders(catalog, a.base, to.value, tags);
    // The natural rows a row of another source may become: any of them, since
    // a changed modifier is not held to the item's level.
    const targets = tierLadder(catalog, a.base, to.value, tags);
    // The rows the essences place on an item of this class. Many are natural
    // rows, some of a modifier the base does not roll (docs/item-model.md §8).
    const essenceRows = new Set(
        registry.essences.flatMap((e) => e.grants.get(a.base.itemClass) ?? []),
    );
    // The ladder of a row the base does not roll: the natural rows of `type`
    // that roll on the items `row` rolls on, best first.
    const elsewhere = (type: TypeId, row: Mod): readonly Mod[] => {
        const rollsOn = (m: Mod): string =>
            m.spawn
                .filter((w) => w.weight > 0)
                .map((w) => w.tag)
                .sort()
                .join();
        return catalog
            .filter(
                (m) =>
                    m.type === type &&
                    isNatural(m) &&
                    m.gen === row.gen &&
                    m.domain === row.domain &&
                    rollsOn(m) === rollsOn(row),
            )
            .sort((x, y) => y.minLevel - x.minLevel);
    };
    const pinned = a.tiers.get(from.value);
    const mayBe =
        pinned === undefined
            ? [
                  ...wholeFrom,
                  ...catalog.filter(
                      (m) =>
                          m.type === from.value &&
                          !wholeFrom.includes(m) &&
                          (!isNatural(m) || essenceRows.has(m.id)),
                  ),
              ]
            : [...pinned].flatMap((id) => {
                  const row = registry.resolveMod(id);
                  return row.ok ? [row.value] : [];
              });
    const rows = new Set<Mod>();
    // What each row the modifier may be becomes, for the exact checker.
    const bySource = new Map<ModId, Mod[]>();
    const becomes = (was: Mod, m: Mod): void => {
        rows.add(m);
        const to = bySource.get(was.id);
        if (to === undefined) bySource.set(was.id, [m]);
        else if (!to.includes(m)) to.push(m);
    };
    // A row the modifier may be has no row of the target to become.
    let stuck = false;
    for (const was of mayBe) {
        // A row it gives none for has an empty entry: no target, said so.
        if (!bySource.has(was.id)) bySource.set(was.id, []);
        if (!isNatural(was)) {
            // A row another source placed becomes that source's counterpart row,
            // and that alone for an Incursion modifier (Modifier § Harvest
            // Crafting) and a bench craft (seen in game: the result is the
            // bench's modifier, crafted still). Of any other the natural rows
            // stay possible beside it (`QUESTIONS.md` Q52). Where the source
            // has no counterpart for the item the natural rows are the result,
            // which no one has observed. Such a source places its rows whatever
            // the item's level, so a counterpart above it is still a result,
            // and so is a natural row above it.
            const twins = twinRows(was, to.value, a, tags, registry);
            for (const m of twins) becomes(was, m);
            const alone =
                was.source === "bench" ||
                (was.name !== undefined && INCURSION_AFFIXES.has(was.name));
            if (twins.length === 0 || !alone) for (const m of targets) becomes(was, m);
            continue;
        }
        // The tier is kept (Modifier § Harvest Crafting): the target's row at
        // the source's rank on the whole ladder, among the rows of the source's
        // own influence, whatever the item's level. Seen in game: on an item
        // of level 25 the level-24 fire resistance became the level-26 cold.
        const own = [...laddersFrom].find(([, ladder]) => ladder.some((m) => m.id === was.id));
        const onBase = own !== undefined;
        const [ladderFrom, ladderTo] = onBase
            ? [own[1], laddersTo.get(own[0]) ?? []]
            : [elsewhere(from.value, was), elsewhere(to.value, was)];
        if (ladderFrom.length === ladderTo.length) {
            const same = ladderTo[ladderFrom.findIndex((m) => m.id === was.id)];
            // A row the base does not roll is an essence's, and becomes one
            // an essence places on the item's class.
            if (same === undefined || (!onBase && !essenceRows.has(same.id))) stuck = true;
            else becomes(was, same);
        } else if (!onBase || ladderTo.length === 0) {
            stuck = true;
        } else {
            // The rank names no one row: any of the ladder's.
            for (const m of ladderTo) becomes(was, m);
        }
    }
    if (stuck || rows.size === 0) return refuse(`"${toName}" cannot roll on this item.`);
    return harvestChangeOps(from.value, registry.typeLabel(from.value), [...rows]).map((op) =>
        op.kind === "fill" && op.pool.kind === "rows" && op.pool.replacing === from.value
            ? { ...op, pool: { ...op.pool, bySource } }
            : op,
    );
}

/** A resonator: the fossils resolved, distinct, at most four, their rows looked up. */
function resonator(
    names: readonly string[],
    a: MethodItem,
    registry: Registry,
): readonly Op[] | Refusal {
    const fossils: FossilSpec[] = [];
    for (const n of names) {
        const fossil = registry.resolveFossil(n);
        if (!fossil.ok) return refuse(resolveMessage(fossil.error));
        fossils.push(fossil.value);
    }
    if (new Set(fossils.map((f) => f.id)).size < fossils.length) {
        return refuse("A resonator cannot hold the same fossil twice.");
    }
    if (fossils.length > 4) return refuse("A resonator holds at most four fossils.");
    let missing: string | undefined;
    const rows = (ids: readonly ModId[]): Mod[] =>
        ids.flatMap((id) => {
            const r = registry.resolveMod(id);
            if (!r.ok) missing ??= `The catalog has no modifier "${id}" for this fossil.`;
            return r.ok ? [r.value] : [];
        });
    const added = rows(fossils.flatMap((f) => f.addedMods));
    const forced = rows(fossils.flatMap((f) => f.forcedMods));
    const corrupted = registry.essences.filter(isCorruptedEssence).flatMap((e) => {
        const id = e.grants.get(a.base.itemClass);
        return id === undefined ? [] : rows([id]);
    });
    if (missing !== undefined) return refuse(missing);
    return resonatorOps({ fossils, added, forced, corrupted });
}

/** The side an Eldritch orb acts on: the dominant implicit. The checker
 *  builds the step on each dominant side apart (build.ts `partsFor`); an item
 *  that may have either is one the cost layer reads whole, and is refused. */
function dominantSide(
    a: MethodItem,
    orb: string,
    ops: (side: EldritchSide) => readonly Op[],
): readonly Op[] | Refusal {
    const sides = new Set([...a.eldritch].map(dominantOf));
    const [side] = sides;
    if (sides.size === 1 && side !== undefined) return ops(side);
    return refuse(
        `An ${orb} needs an item where the Searing Exarch or the Eater of Worlds is dominant — this item has ${eldritchLabel(a.eldritch)}.`,
    );
}

const CURRENCIES: readonly Method[] = STANDARD_CURRENCIES.map((c) => ({
    words: [c.name],
    args: [],
    doc: `${c.displayName} — ${c.description}`,
    build: (_args, _a, registry) => {
        const r = registry.resolveCurrency(c.name);
        return r.ok ? currencyOps(r.value.kind) : refuse(resolveMessage(r.error));
    },
}));

export const METHODS: readonly Method[] = [
    ...CURRENCIES,
    ...INFLUENCES.map((target): Method => ({
        words: ["exalt", target],
        args: [],
        doc: `exalt ${target} — ${INFLUENCE_ORB[target]}: add ${influenceSetLabel(influenceKey([target]))} influence and one of its modifiers to a Rare item with an open slot, no influence, no fractured modifier and no eldritch implicit.`,
        build: () => influenceExaltOps(target),
    })),
    ...ELDRITCH_SIDES.map((side): Method => {
        const item = side === "exarch" ? "ember" : "ichor";
        const what = side === "exarch" ? "Searing Exarch" : "Eater of Worlds";
        return {
            words: [item],
            args: [word(...ELDRITCH_TIERS.slice(0, 4))],
            doc: `${item} <tier> — an Eldritch ${side === "exarch" ? "Ember" : "Ichor"}: set the ${what} implicit of a body armour, boots, gloves or helmet to that tier (lesser to exceptional); needs item level 75 or more and no influence.`,
            build: ([tier], a, registry) => {
                const t = eldritchTierOf(text(tier) as EldritchTierName);
                const types = registry.eldritchPool(a.base, side, t).map((e) => e.type);
                return eldritchImplicitOps(side, t, types);
            },
        };
    }),
    {
        words: ["eldritch", "chaos"],
        args: [],
        doc: "eldritch chaos — Eldritch Chaos Orb: reroll a Rare item's prefixes when the Exarch is dominant, its suffixes when the Eater is, keeping the other side.",
        build: (_args, a) => dominantSide(a, "Eldritch Chaos Orb", eldritchChaosOps),
    },
    {
        words: ["eldritch", "exalt"],
        args: [],
        doc: "eldritch exalt — Eldritch Exalted Orb: add a prefix to a Rare item when the Exarch is dominant, a suffix when the Eater is; needs an open slot on that side.",
        build: (_args, a) => dominantSide(a, "Eldritch Exalted Orb", eldritchExaltOps),
    },
    {
        words: ["eldritch", "annul"],
        args: [],
        doc: "eldritch annul — Eldritch Orb of Annulment: remove a prefix from a Magic or Rare item when the Exarch is dominant, a suffix when the Eater is; needs a removable modifier on that side, and no metamod keeping that side from changing.",
        build: (_args, a) => dominantSide(a, "Eldritch Orb of Annulment", eldritchAnnulOps),
    },
    {
        words: ["dominance"],
        args: [],
        doc: "dominance — Orb of Dominance: on a body armour, boots, gloves or helmet with two influenced modifiers on sides no metamod protects, remove one and raise another a tier, to its elevated form at the top.",
        build: () => DOMINANCE,
    },
    {
        words: ["conflict"],
        args: [],
        doc: "conflict — Orb of Conflict: on an item with both eldritch implicits, raise one a tier and lower the other; a lowered Lesser is removed, and which is dominant may differ between paths.",
        build: () => CONFLICT,
    },
    {
        words: ["vaal"],
        args: [],
        doc: "vaal — Vaal Orb: corrupt the item; it may stay as it is or become a Rare with six modifiers, and takes no craft but the Tainted currency and an unveil afterwards.",
        build: (_args, a) => vaalOps(a.base),
    },
    {
        words: ["locus"],
        args: [],
        doc: "locus — the Corruption Altar: corrupt the item; it may stay as it is, be reforged into a Rare with any one influence and four to six new modifiers, or be destroyed, ending the craft.",
        build: (_args, a) => locusOps(a.base),
    },
    {
        words: ["tainted", "chaos"],
        args: [],
        doc: "tainted chaos — Tainted Chaos Orb: reforge a corrupted Rare, or strip it to the rarity its survivors allow.",
        build: () => TAINTED_CHAOS,
    },
    {
        words: ["tainted", "exalt"],
        args: [],
        doc: "tainted exalt — Tainted Exalted Orb: add a modifier to a corrupted Rare, or remove one.",
        build: () => TAINTED_EXALT,
    },
    {
        words: ["tainted", "divine"],
        args: [],
        doc: "tainted divine — Tainted Divine Teardrop: each modifier of a corrupted Rare may move a tier either way, the crafted ones excepted.",
        build: () => TAINTED_DIVINE,
    },
    {
        words: ["essence"],
        args: [name("essence"), { kind: "tier", optional: true }],
        doc: 'essence "<name>" [t1] — reforge with a guaranteed modifier: a full essence name, or a type with its tier (t1 = Deafening; a corrupted essence takes t1 or none). Needs a Normal item, or a Rare one from Screaming up, on a base that can be Rare, an essence with a modifier for the item\'s class, and no metamod that keeps a side from changing or a modifier from rolling.',
        build: ([n, t], a, registry) => {
            const spec = registry.resolveEssence(text(n), num(t));
            return spec.ok ? essenceOps(spec.value, a.ilvl) : refuse(resolveMessage(spec.error));
        },
    },
    {
        words: ["bench"],
        args: [name("bench"), { kind: "tier", optional: true }],
        doc: 'bench "<mod>" [t1] — craft a modifier at the bench. Needs an open slot on its side, no modifier of its group, and room under the crafted-modifier limit (one, three with the multimod); under the limit of one, the crafted modifier already there is replaced, and the bench refuses when that one is fractured.',
        build: ([n, t], a, registry) => {
            const craft = registry.resolveBench(text(n), a.base.itemClass, num(t));
            if (!craft.ok) return refuse(resolveMessage(craft.error));
            const mod = registry.resolveMod(craft.value.mod);
            return mod.ok ? benchOps(mod.value) : refuse(resolveMessage(mod.error));
        },
    },
    {
        words: ["bench", "remove"],
        args: [],
        doc: "bench remove — clear the item's crafted modifiers at the bench (a fractured one stays); needs one on the item.",
        build: () => BENCH_REMOVE,
    },
    {
        words: ["harvest", "reforge"],
        args: [name("tag")],
        doc: 'harvest reforge "<tag>" — reforge a Rare item with a modifier of that type guaranteed, a type some modifier of the base carries; "influence" guarantees one of an influenced item\'s influence modifiers.',
        build: ([t], _a, registry) => {
            const name = text(t).trim().toLowerCase();
            if (name === "influence") return HARVEST_INFLUENCE_REFORGE;
            const tag = registry.resolveHarvestTag(text(t));
            return tag.ok ? harvestReforgeOps(tag.value) : refuse(resolveMessage(tag.error));
        },
    },
    {
        words: ["harvest", "randomise"],
        args: [],
        doc: "harvest randomise — reroll which influences an influenced item has, keeping how many, and reforge it at its rarity.",
        build: () => HARVEST_RANDOMISE,
    },
    {
        words: ["harvest", "augment"],
        args: [name("tag")],
        doc: 'harvest augment "<tag>" — add a fire, cold, lightning, physical, life, defence, chaos, attack, caster, speed or critical modifier to a Rare item with no influence, then remove another at random. The modifier is added first, so the item needs an open slot one of that type fits, and another modifier the removal can take.',
        build: ([t], _a, registry) => {
            const tag = registry.resolveHarvestTag(text(t));
            if (!tag.ok) return refuse(resolveMessage(tag.error));
            if (!HARVEST_AUGMENT_TAGS.has(tag.value)) {
                return refuse(
                    `The grove has no craft that adds a "${text(t)}" modifier — it adds a fire, cold, lightning, physical, life, defence, chaos, attack, caster, speed or critical modifier.`,
                );
            }
            return harvestAugmentOps(tag.value);
        },
    },
    {
        words: ["harvest", "change"],
        args: [name("mod"), name("mod")],
        doc: 'harvest change "<mod>" "<mod>" — change a fire, cold or lightning resistance or damage modifier (a penetration or a damage over time multiplier too) into the same modifier of another element, at the same tier, even one the item\'s level does not roll. Refused for a critical strike multiplier, for a modifier the other element has no form of, for a fractured modifier or one on a side a metamod protects, and where another modifier of the new one\'s group is on the item.',
        build: ([from, to], a, registry) => harvestChange(text(from), text(to), a, registry),
    },
    {
        words: ["veiled", "chaos"],
        args: [],
        doc: "veiled chaos — reforge a Rare item with one modifier veiled, to unveil later.",
        build: () => VEILED_CHAOS,
    },
    {
        words: ["veiled", "exalt"],
        args: [],
        doc: "veiled exalt — remove a modifier from a Rare item and add a veiled one, to unveil later; needs a removable modifier and no veiled modifier already.",
        build: () => VEILED_EXALT,
    },
    {
        words: ["unveil"],
        args: [name("mod", true)],
        doc: 'unveil ["<mod>"] — reveal the veiled modifier; with a name, that option, guaranteed only when three or fewer are offered (bench a modifier of an option\'s group to block it).',
        build: ([n], a, registry) => {
            if (n === undefined) return unveilOps(undefined);
            const type = registry.resolveModType(text(n), {
                base: a.base,
                ilvl: a.ilvl,
                tags: influenceTagsOfItem(a, registry),
            });
            if (!type.ok) return refuse(resolveMessage(type.error));
            return unveilOps({ type: type.value, name: text(n) });
        },
    },
    ...(["augment", "regal", "exalt"] as const).map((verb): Method => ({
        words: ["foulborn", verb],
        args: [],
        doc: `foulborn ${verb} — the plain orb, but only the top tiers of each modifier can roll: of two one, of four two, of six three, of eight five. On an item with memory strands it counts as thirty more strands instead.`,
        build: () => foulbornOps(verb),
    })),
    {
        words: ["fossil"],
        args: [{ kind: "names", of: "fossil", max: 4 }],
        doc: 'fossil "<name>" … — socket one to four fossils (each by its first word or full name) in a resonator and reforge a Normal or Rare item, on a base every fossil allows, with no metamod that keeps a side from changing or a modifier from rolling. The fossils change the odds, which only the cost estimate reads; the Fractured Fossil needs an item with no fractured modifier and no influence, and the Bloodstained Fossil corrupts it.',
        build: (names, a, registry) =>
            resonator(
                names.map((n) => text(n)),
                a,
                registry,
            ),
    },
    {
        words: ["beast", "add"],
        args: [word("prefix", "suffix", ...INFLUENCES), { kind: "int", optional: true }],
        doc: "beast add prefix|suffix [<level>] — add a modifier of that side, drawn at the beast's level, and remove a random one of the other (none when that side cannot be changed); needs a Rare item with an open slot on the added side. beast add <influence> — add a modifier, drawn at the item's level, to an open slot of a Rare item with that influence.",
        build: ([side, level]) => {
            const what = text(side);
            if (!isInfluence(what)) return beastAddOps(what as Gen, num(level) ?? ANY_BEAST_LEVEL);
            // Only the add-a-prefix and add-a-suffix recipes read the beast's level.
            return level === undefined
                ? beastAddInfluenceOps(what)
                : refuse(
                      `The Bestiary's recipe that adds a modifier to an influenced item draws at the item's level, whatever the beast's — write 'beast add ${what}' with no level.`,
                  );
        },
    },
    {
        words: ["beast", "fracture"],
        args: [{ kind: "int", optional: true }],
        doc: "beast fracture [2] — fracture one modifier of a Rare talisman with at least four, or two of one with at least six; needs no fractured modifier and no influence.",
        build: ([n]) => {
            const count = num(n) ?? 1;
            if (count !== 1 && count !== 2) {
                return refuse(`The Bestiary fractures one modifier or two, not ${count}.`);
            }
            return beastFractureOps(count);
        },
    },
    {
        words: ["beast", "metamod"],
        args: [],
        doc: "beast metamod — craft a random metamod among those that fit under the crafted-modifier limit; on every path the item needs an open slot that a metamod not yet on it can take.",
        build: () => BEAST_METAMOD,
    },
    {
        words: ["beast", "aspect"],
        args: [name("aspect"), { kind: "int", optional: true }],
        doc: 'beast aspect "<animal>" [20] — craft that Aspect skill\'s suffix: cat, avian, spider or crab, at level 30, or at level 20 for the recipe without the Black Mórrigan. Needs an open suffix slot and no other skill-granting modifier; it does not count as a crafted modifier.',
        build: ([n, l], _a, registry) => {
            const level = num(l) ?? 30;
            if (level !== 20 && level !== 30) {
                return refuse(
                    `The Bestiary crafts an Aspect skill at level 20 or 30, not ${level}.`,
                );
            }
            const row = registry.resolveAspect(text(n), level);
            return row.ok ? beastAspectOps(row.value) : refuse(resolveMessage(row.error));
        },
    },
    {
        words: ["beast", "imprint"],
        args: [],
        doc: "beast imprint — hold an imprint of a Magic item or a Rare talisman, not fractured, for restore; one imprint is held at a time.",
        build: () => BEAST_IMPRINT,
    },
    {
        words: ["restore"],
        args: [],
        doc: "restore — apply the held imprint: the item becomes what it was at beast imprint, and the imprint is used up.",
        build: () => RESTORE,
    },
];

/** The method a statement's opening words name, if any. */
export function findMethod(words: readonly string[]): Method | undefined {
    return METHODS.find(
        (m) => m.words.length === words.length && m.words.every((w, i) => w === words[i]),
    );
}

/** The methods whose words begin with `words` (all of them for an empty prefix). */
export function methodsAfter(words: readonly string[]): readonly Method[] {
    return METHODS.filter(
        (m) => m.words.length > words.length && words.every((w, i) => m.words[i] === w),
    );
}

/** The slot the i-th argument of a method fills (a `names` slot takes the rest). */
export function slotAt(method: Method, i: number): Slot | undefined {
    const last = method.args[method.args.length - 1];
    if (i < method.args.length) return method.args[i];
    return last?.kind === "names" ? last : undefined;
}

/** Every word that opens or continues a method statement, and every word a word slot accepts. */
export const METHOD_WORDS: readonly string[] = [
    ...new Set(
        METHODS.flatMap((m) => [
            ...m.words,
            ...m.args.flatMap((s) => (s.kind === "word" ? s.oneOf : [])),
        ]),
    ),
];
