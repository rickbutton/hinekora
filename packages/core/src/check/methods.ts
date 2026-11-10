/**
 * The surface's methods as one table: the words that open a statement, the
 * argument slots that follow, a line of help, and how the arguments become the
 * operations the checker runs. The parser, completion, hover and the checker's
 * dispatch read this table and know no method themselves; adding a method is
 * an entry here on top of its sequence in `library.ts`.
 */
import { type Gen, type ModId, TagId, type TypeId } from "../model/ids.js";
import {
    dominantOf,
    ELDRITCH_SIDES,
    ELDRITCH_TIERS,
    type EldritchSide,
    type EldritchTierName,
    eldritchLabel,
    eldritchTierOf,
    INFLUENCE_ORB,
    influenceKey,
    INFLUENCES,
    influenceSetLabel,
    isInfluence,
} from "../model/marks.js";
import type { Mod } from "../model/mod.js";
import { type FossilSpec, isCorruptedEssence } from "../model/sources.js";
import { HARVEST_AUGMENT_TAGS, type Registry, STANDARD_CURRENCIES } from "../resolve/registry.js";
import { rollableTiers } from "../resolve/tiers.js";
import type { AItem } from "./astate.js";
import { resolveMessage } from "./diagnostics.js";
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
import { influenceTagsAny, type Op } from "./ops.js";

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
        a: AItem,
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

const CRITICAL = TagId("critical");
/** The item level at which every row of a ladder rolls. */
const TOP_ITEM_LEVEL = 100;

const DOT_MULTI = TagId("dot_multi");

/** The game's list is not the whole filter. The damage change takes no
 *  critical strike multiplier, though the list still names them (Harvest
 *  crafting § Version history, 3.28.0 Hotfix 8); and players disagree on
 *  whether it takes a damage over time multiplier, also listed, so that is
 *  refused until it is probed (`QUESTIONS.md` Q74). */
function listedButRefused(catalog: readonly Mod[], type: TypeId): boolean {
    return catalog.some(
        (m) => m.type === type && (m.implicitTags.has(CRITICAL) || m.implicitTags.has(DOT_MULTI)),
    );
}

const DEFAULT_TAG = TagId("default");

/**
 * The rows of `type` that stand to a placed row as its counterpart: the same
 * source, level, side and domain, and a row that source puts on this item.
 * The bench and the essences say which classes take a row; any other row says
 * it by the tags of its spawn table, a row that names only other bases' tags
 * being theirs.
 */
function twinRows(was: Mod, type: TypeId, a: AItem, registry: Registry): readonly Mod[] {
    const cls = a.base.itemClass;
    const onThisItem = (m: Mod): boolean => {
        switch (was.source) {
            case "bench":
                return registry.benchModsFor(cls).has(m.id);
            case "essence":
                return registry.essences.some((e) => e.grants.get(cls) === m.id);
            default:
                return (
                    m.spawn.every((w) => w.tag === DEFAULT_TAG) ||
                    m.spawn.some((w) => w.tag !== DEFAULT_TAG && a.base.tags.has(w.tag))
                );
        }
    };
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
    a: AItem,
    registry: Registry,
): readonly Op[] | Refusal {
    const tags = influenceTagsAny(a, registry);
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
        source.element === target.element ||
        (source.kind === "damage" && listedButRefused(catalog, from.value))
    ) {
        return refuse(
            `The grove changes a fire, cold or lightning resistance into another of the three, or a fire, cold or lightning damage modifier likewise, and no critical strike multiplier or damage over time multiplier — not "${fromName}" into "${toName}".`,
        );
    }
    // The modifier becomes its counterpart of the other element, not any
    // modifier of that element.
    const counterpart = registry.harvestChangeTarget(from.value, target.element);
    if (counterpart === undefined) {
        return refuse(
            `"${fromName}" has no ${target.element} counterpart for the grove to change it into.`,
        );
    }
    if (counterpart !== to.value) {
        return refuse(
            `The grove changes "${fromName}" into "${registry.typeLabel(counterpart)}", not "${toName}".`,
        );
    }
    const whole = (type: TypeId): readonly Mod[] =>
        rollableTiers(catalog, a.base, TOP_ITEM_LEVEL, type, tags);
    const pinned = a.tiers.get(from.value);
    const targets = rollableTiers(catalog, a.base, a.ilvl, to.value, tags);
    // A modifier another source placed is no row of the ladder that rolls
    // here. An Incursion architect's resistance becomes the counterpart's row
    // of that source and level, the page's own example. For a bench, essence,
    // fossil or unveiled row the page says nothing, so the result is that
    // counterpart row or any of the target's natural rows (`QUESTIONS.md` Q52).
    const was = pinned?.size === 1 ? registry.resolveMod([...pinned][0]!) : undefined;
    if (was?.ok && (was.value.source ?? "natural") !== "natural") {
        const twins = twinRows(was.value, to.value, a, registry);
        if (twins.length > 0) {
            const rows = was.value.source === "other" ? twins : [...twins, ...targets];
            return harvestChangeOps(from.value, registry.typeLabel(from.value), rows);
        }
    }
    if (targets.length === 0) return refuse(`"${toName}" cannot roll on this item.`);
    // The tier is kept (Modifier § Harvest Crafting): the target's row at the
    // source's rank, where the two ladders have as many rows at the item's
    // level and as many in all, so the rank is the same tier however it is
    // counted. Which row the game picks otherwise is unknown (`QUESTIONS.md`
    // Q22), so any of the target's rows that roll here, and the row at the
    // source's rank in the whole ladder, which "preserves the tier" read
    // literally, though the item's level is below it.
    const sources = rollableTiers(catalog, a.base, a.ilvl, from.value, tags);
    const [wholeFrom, wholeTo] = [whole(from.value), whole(to.value)];
    const alike = wholeFrom.length === wholeTo.length;
    const parallel = sources.length === targets.length && alike;
    const rank = parallel && pinned?.size === 1 ? sources.findIndex((m) => pinned.has(m.id)) : -1;
    if (rank >= 0) {
        return harvestChangeOps(from.value, registry.typeLabel(from.value), [targets[rank]!]);
    }
    // The source may be any of its recorded rows, or with none recorded any
    // row of its ladder; each brings the target's row at its own rank.
    const rows = new Set(targets);
    if (alike) {
        wholeFrom.forEach((m, i) => {
            if (pinned === undefined || pinned.has(m.id)) rows.add(wholeTo[i]!);
        });
    }
    return harvestChangeOps(from.value, registry.typeLabel(from.value), [...rows]);
}

/** A resonator: the fossils resolved, distinct, at most four, their rows looked up. */
function resonator(
    names: readonly string[],
    a: AItem,
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

/** The side an Eldritch orb acts on: the dominant implicit, which must be the
 *  same on every path for the orb to have one meaning. */
function dominantSide(
    a: AItem,
    orb: string,
    ops: (side: EldritchSide) => readonly Op[],
): readonly Op[] | Refusal {
    const sides = new Set([...a.eldritch].map(dominantOf));
    if (sides.size === 1 && !sides.has(undefined)) return ops([...sides][0]!);
    if (sides.has(undefined) && sides.size === 1) {
        return refuse(
            `An ${orb} needs an item where the Searing Exarch or the Eater of Worlds is dominant — this item has ${eldritchLabel(a.eldritch)}.`,
        );
    }
    return refuse(
        `An ${orb} acts on the dominant implicit's side, which differs between paths here (${eldritchLabel(a.eldritch)}); narrow it with 'if dominant exarch' first.`,
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
        doc: 'harvest change "<mod>" "<mod>" — change a fire, cold or lightning resistance or damage modifier into the same modifier of another element, at the same tier (any of its tiers that roll, or the same tier above the item level, where fewer or more of them roll than of the first). It takes a penetration as a damage modifier, and no critical strike multiplier, damage over time multiplier or resistance shared with chaos. The first must be on an item of any rarity, not fractured, on a side no metamod protects; the second must roll on the base, unless the first is a modifier no currency rolls (an Incursion or a crafted one) with a counterpart of its own kind, and share no group with a present modifier.',
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
                tags: influenceTagsAny(a, registry),
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
