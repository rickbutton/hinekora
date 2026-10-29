/**
 * The surface's methods as one table: the words that open a statement, the
 * argument slots that follow, a line of help, and how the arguments become the
 * operations the checker runs. The parser, completion, hover and the checker's
 * dispatch read this table and know no method themselves; adding a method is
 * an entry here on top of its sequence in `library.ts`.
 */
import type { Gen, ModId, TypeId } from "../model/ids.js";
import {
    type Influence,
    INFLUENCE_ORB,
    influenceKey,
    INFLUENCES,
    influenceSetLabel,
    isInfluence,
} from "../model/marks.js";
import type { Mod } from "../model/mod.js";
import { type FossilSpec, isCorruptedEssence } from "../model/sources.js";
import { type Registry, STANDARD_CURRENCIES } from "../resolve/registry.js";
import { rollableTiers } from "../resolve/tiers.js";
import type { AItem } from "./astate.js";
import { resolveMessage } from "./diagnostics.js";
import {
    ANY_BEAST_LEVEL,
    awakenerOps,
    BEAST_FRACTURE,
    BEAST_IMPRINT,
    BEAST_METAMOD,
    BENCH_REMOVE,
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
    resonatorOps,
    RESTORE,
    unveilOps,
    VEILED_CHAOS,
    VEILED_EXALT,
} from "./library.js";
import { influenceTagsOf, type Op } from "./ops.js";

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

const ELEMENTS = ["fire", "cold", "lightning"] as const;

/** Which elemental resistance or damage a modifier type grants, by its rows' tags. */
function elementalKind(
    catalog: readonly Mod[],
    type: TypeId,
): { element: string; kind: "resistance" | "damage" } | null {
    const tags = new Set<string>();
    for (const m of catalog) if (m.type === type) for (const t of m.implicitTags) tags.add(t);
    const elements = ELEMENTS.filter((e) => tags.has(e));
    if (elements.length !== 1) return null;
    const kind = tags.has("resistance") ? "resistance" : tags.has("damage") ? "damage" : null;
    return kind === null ? null : { element: elements[0]!, kind };
}

/** The Harvest change: both names resolved, the pair one the grove offers. */
function harvestChange(
    fromName: string,
    toName: string,
    a: AItem,
    registry: Registry,
): readonly Op[] | Refusal {
    const tags = influenceTagsOf(a, registry).sure;
    const ctx = { base: a.base, ilvl: a.ilvl, tags };
    const from = registry.resolveModType(fromName, ctx);
    if (!from.ok) return refuse(resolveMessage(from.error));
    const to = registry.resolveModType(toName, ctx);
    if (!to.ok) return refuse(resolveMessage(to.error));
    const catalog = registry.catalog;
    // The grove offers the craft for the three elemental resistances among
    // themselves and the three elemental damages among themselves (the Sacred
    // Grove's twelve "Change a modifier that grants …" options).
    const source = elementalKind(catalog, from.value);
    const target = elementalKind(catalog, to.value);
    if (
        source === null ||
        target === null ||
        source.kind !== target.kind ||
        source.element === target.element
    ) {
        return refuse(
            `The grove changes a fire, cold or lightning resistance into another of the three, or a fire, cold or lightning damage modifier likewise — not "${fromName}" into "${toName}".`,
        );
    }
    const targets = rollableTiers(catalog, a.base, a.ilvl, to.value, tags);
    if (targets.length === 0) return refuse(`"${toName}" cannot roll on this item.`);
    // A similar tier: the target's row at the source's rank when the source is
    // pinned to one row, else any of the target's rows.
    const pinned = a.tiers.get(from.value);
    const sources = rollableTiers(catalog, a.base, a.ilvl, from.value, tags);
    const rank = pinned?.size === 1 ? sources.findIndex((m) => pinned.has(m.id)) : -1;
    const rows = rank >= 0 && rank < targets.length ? [targets[rank]!] : targets;
    return harvestChangeOps(from.value, registry.typeLabel(from.value), rows);
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
        doc: `exalt ${target} — ${INFLUENCE_ORB[target]}: add ${influenceSetLabel(influenceKey([target]))} influence and one of its modifiers to a Rare item with no influence.`,
        build: () => influenceExaltOps(target),
    })),
    {
        words: ["awakener"],
        args: [word(...INFLUENCES)],
        doc: "awakener <influence> — Awakener's Orb, the donor item's influence given: reforge the item Rare with both influences.",
        build: ([donor]) => awakenerOps(text(donor) as Influence),
    },
    {
        words: ["essence"],
        args: [name("essence"), { kind: "tier", optional: true }],
        doc: 'essence "<name>" [t1] — reforge with a guaranteed modifier: a full essence name, or a type with its tier (t1 = Deafening).',
        build: ([n, t], a, registry) => {
            const spec = registry.resolveEssence(text(n), num(t));
            return spec.ok ? essenceOps(spec.value, a.ilvl) : refuse(resolveMessage(spec.error));
        },
    },
    {
        words: ["bench"],
        args: [name("bench"), { kind: "tier", optional: true }],
        doc: 'bench "<mod>" [t1] — craft a modifier at the bench, replacing the item\'s single crafted one.',
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
        doc: "bench remove — clear the item's crafted modifiers at the bench (a fractured one stays).",
        build: () => BENCH_REMOVE,
    },
    {
        words: ["harvest", "reforge"],
        args: [name("tag")],
        doc: 'harvest reforge "<tag>" — reforge a Rare item with a modifier of that type guaranteed; "influence" guarantees one of the item\'s influence modifiers.',
        build: ([t], _a, registry) => {
            if (text(t).trim().toLowerCase() === "influence") return HARVEST_INFLUENCE_REFORGE;
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
        doc: 'harvest augment "<tag>" — add a modifier of that type and remove another at random.',
        build: ([t], _a, registry) => {
            const tag = registry.resolveHarvestTag(text(t));
            return tag.ok ? harvestAugmentOps(tag.value) : refuse(resolveMessage(tag.error));
        },
    },
    {
        words: ["harvest", "change"],
        args: [name("mod"), name("mod")],
        doc: 'harvest change "<mod>" "<mod>" — change a fire, cold or lightning resistance or damage modifier into another element at a similar tier.',
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
        doc: "veiled exalt — remove a modifier and add a veiled one, to unveil later.",
        build: () => VEILED_EXALT,
    },
    {
        words: ["unveil"],
        args: [name("mod", true)],
        doc: 'unveil ["<mod>"] — reveal the veiled modifier; with a name, that option, guaranteed only when three or fewer are offered.',
        build: ([n], a, registry) => {
            if (n === undefined) return unveilOps(undefined);
            const type = registry.resolveModType(text(n), {
                base: a.base,
                ilvl: a.ilvl,
                tags: influenceTagsOf(a, registry).sure,
            });
            if (!type.ok) return refuse(resolveMessage(type.error));
            return unveilOps({ type: type.value, name: text(n) });
        },
    },
    ...(["augment", "regal", "exalt"] as const).map((verb): Method => ({
        words: ["foulborn", verb],
        args: [],
        doc: `foulborn ${verb} — the plain orb, but only the top half of each modifier's tiers can roll.`,
        build: () => foulbornOps(verb),
    })),
    {
        words: ["fossil"],
        args: [{ kind: "names", of: "fossil", max: 4 }],
        doc: 'fossil "<name>" … — socket one to four fossils in a resonator and reforge a Rare item.',
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
        doc: "beast add prefix|suffix [<level>] — add a modifier of that side, drawn at the beast's level, and remove a random one of the other; beast add <influence> [<level>] — add a modifier to a Rare item with that influence.",
        build: ([side, level]) => {
            const what = text(side);
            const beastLevel = num(level) ?? ANY_BEAST_LEVEL;
            return isInfluence(what)
                ? beastAddInfluenceOps(what, beastLevel)
                : beastAddOps(what as Gen, beastLevel);
        },
    },
    {
        words: ["beast", "fracture"],
        args: [],
        doc: "beast fracture — fracture one modifier of a Rare talisman with at least four.",
        build: () => BEAST_FRACTURE,
    },
    {
        words: ["beast", "metamod"],
        args: [],
        doc: "beast metamod — craft a random metamod among those that fit.",
        build: () => BEAST_METAMOD,
    },
    {
        words: ["beast", "aspect"],
        args: [name("aspect")],
        doc: 'beast aspect "<animal>" — craft that Aspect skill\'s modifier: cat, avian, spider or crab.',
        build: ([n], _a, registry) => {
            const row = registry.resolveAspect(text(n));
            return row.ok ? beastAspectOps(row.value) : refuse(resolveMessage(row.error));
        },
    },
    {
        words: ["beast", "imprint"],
        args: [],
        doc: "beast imprint — hold an imprint of a Magic item or a Rare talisman, for restore.",
        build: () => BEAST_IMPRINT,
    },
    {
        words: ["restore"],
        args: [],
        doc: "restore — apply the held imprint: the item becomes what it was at beast imprint.",
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
