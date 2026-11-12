/**
 * The items a point of the craft may hold, as a player reads an item: a view
 * model shaped like the game's item tooltip, and its text form in the game's
 * advanced copy-to-clipboard layout (`Item Class:` / `Rarity:` / the base /
 * `--------` sections). Each modifier carries the header the advanced copy
 * gives it, the affix name, the tier or bench rank and the tags, when every
 * item agrees on them.
 *
 * Where the items differ the view extends the layout rather than hiding it: a
 * tier range over the rows they hold, a roll span across those rows, "one of"
 * groups for what every item has some of, a line for the modifiers no name
 * covers, "possibly" marks, and the modifiers no item has. The checker's
 * single-line summary for diagnostics stays `renderState`; this is the full
 * view.
 *
 * The view reads the items only through the general views (check/views.ts),
 * never a handler per case: a new readable form is a new view there.
 */
import type { Craft } from "../ast/ast.js";
import type { Range } from "../check/range.js";
import { rollRange } from "../check/values.js";
import { type CraftNames, craftNames } from "../check/names.js";
import type { ItemSet } from "../check/state.js";
import {
    type CardinalityGuarantee,
    cardinalityGuarantees,
    clauseRows,
    corruptions,
    countOutside,
    counts,
    craftedTypes,
    eldritchPairs,
    eldritchTypes,
    fracturedCount,
    guaranteedTypes,
    influenceSets,
    influenceTagsAny,
    isCrafted,
    isFractured,
    possibleTypes,
    presentAmong,
    rarities,
    rowsOf,
    strandsRange,
    unnamedImplicit,
    valueSpan,
} from "../check/views.js";
import type { Gen, Rarity, TypeId } from "../model/ids.js";
import {
    ELDRITCH_SIDES,
    type EldritchSide,
    eldritchOf,
    eldritchTierLabel,
    type Influence,
    influenceSetLabel,
    influencesOf,
    NO_INFLUENCE,
} from "../model/marks.js";
import type { Mod } from "../model/mod.js";
import { isUnveiledResult } from "../model/veiled.js";
import type { Registry } from "../resolve/registry.js";
import { rollableGen, rollableTiers, tierLadders, tierNumber } from "../resolve/tiers.js";
import { baseLabel } from "./render.js";
import { capitalise, pluralRange, rangeText, rarityText } from "../words.js";

export interface ModView {
    readonly gen: Gen;
    /** The stat text: the exact roll span when the tier is known, else the span across the tiers it may be. */
    readonly text: string;
    /** The affix name ("Virile"), when the tier is known. */
    readonly name?: string;
    /** The tier numbers the modifier may be, as the game's advanced tooltip
     *  numbers them: over the modifier's whole ladder on the base. */
    readonly tier?: Range;
    /** The modifier's category tags, as the advanced tooltip shows them. */
    readonly tags: readonly string[];
    readonly fractured: boolean;
    /** Crafted on every item that carries it, which the game shows as master crafted. */
    readonly crafted: boolean;
    /** Crafted on some items that carry it and not on others. */
    readonly possiblyCrafted?: true;
    /** Every row it may be is an unveiled one, which is not a crafted modifier. */
    readonly veiled: boolean;
    /** The bench rank, when the modifier is one ranked bench craft. */
    readonly rank?: number;
}

export type ModGroup =
    | { readonly kind: "mod"; readonly mod: ModView }
    | {
          readonly kind: "oneOf";
          readonly atLeast: number;
          /** Exactly `atLeast`, since no more could fit. */
          readonly exact: boolean;
          readonly members: readonly ModView[];
      };

export interface ImplicitView {
    readonly side: EldritchSide;
    /** The tier names the implicit may be at, best last. */
    readonly tiers: readonly string[];
    /** The wordings it may be; one when known, empty when the game data names none. */
    readonly texts: readonly string[];
    /** How many implicits it may be: a wording per tier makes several of one. */
    readonly count: number;
    /** The category tags, when the wording is known. */
    readonly tags: readonly string[];
    /** On some of the items only. */
    readonly maybe: boolean;
}

/** Which line of the item's marks: the copy text places each kind in its own spot. */
export type MarkKind = "influence" | "eldritch" | "fractured" | "corrupted";

export interface Mark {
    readonly kind: MarkKind;
    readonly text: string;
    /** On some of the items only. */
    readonly maybe: boolean;
}

export interface Remainder {
    readonly count: Range;
    readonly where: Gen | "either";
}

export interface ItemView {
    readonly base: string;
    readonly itemClass: string;
    readonly ilvl: number;
    /** The memory strands the item may hold, fewest to most; absent when none. */
    readonly strands?: Range;
    readonly rarities: readonly Rarity[];
    readonly implicits: readonly ImplicitView[];
    readonly prefixes: readonly ModGroup[];
    readonly suffixes: readonly ModGroup[];
    /** Groups whose members span both generations. */
    readonly either: readonly ModGroup[];
    readonly remainder?: Remainder;
    /** How many modifiers in all, where the lines above do not settle it. */
    readonly total?: Range;
    readonly marks: readonly Mark[];
    /** The modifiers the craft names that no item carries, by wording. */
    readonly without: readonly string[];
}

const RARITY_ORDER: readonly Rarity[] = ["normal", "magic", "rare"];

/** The game's line for an influence: "Shaper Item", "Hunter Item". */
const INFLUENCE_NAME: Readonly<Record<Influence, string>> = {
    shaper: "Shaper",
    elder: "Elder",
    crusader: "Crusader",
    hunter: "Hunter",
    redeemer: "Redeemer",
    warlord: "Warlord",
};

/**
 * The game's class label for a data class id, written in the plural as the
 * `Item Class:` line is. The ids the game spells differently are listed; the
 * rest split their camel case and take an `s`. The spellings are what the
 * game shows for the craftable classes.
 */
const CLASS_LABEL: Readonly<Record<string, string>> = {
    Staff: "Staves",
    Warstaff: "Warstaves",
    Boots: "Boots",
    Gloves: "Gloves",
    "Body Armour": "Body Armours",
    AbyssJewel: "Abyss Jewels",
    LifeFlask: "Life Flasks",
    ManaFlask: "Mana Flasks",
    HybridFlask: "Hybrid Flasks",
    UtilityFlask: "Utility Flasks",
    FishingRod: "Fishing Rods",
    AnimalCharm: "Charms",
};
export function itemClassLabel(itemClass: string): string {
    const known = CLASS_LABEL[itemClass];
    if (known !== undefined) return known;
    const spaced = itemClass.replace(/([a-z])([A-Z])/g, "$1 $2");
    return spaced.endsWith("s") ? spaced : `${spaced}s`;
}

/** A category tag as the tooltip writes it: `physical_damage` → `Physical Damage`. */
function tagLabel(tag: string): string {
    return tag.split("_").map(capitalise).join(" ");
}

/** A number of a modifier's text: a roll span "(a-b)", or a fixed number,
 *  which is a span of one value. */
const NUMBER = /\((\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)\)|(\d+(?:\.\d+)?)/g;
const HOLE = "\u0000";

/** The line between two wordings a modifier may have. */
export const OR_LINE = "or";

/**
 * Several rows' texts as one roll span, number by number: "+(70-84) …" and
 * "+(20-29) …" ⇒ "+(20-84) …"; "35% increased …" and "10% increased …" ⇒
 * "(10-35)% increased …". Rows whose texts differ in more than their numbers
 * ("an additional Target", "2 additional Targets") are spanned apart, each
 * wording in the order of its first row, with a line `or` between them: no
 * one row's text stands for the others.
 */
export function rollSpan(texts: readonly string[]): string {
    return wordings(texts).join(`\n${OR_LINE}\n`);
}

/** The texts gathered by wording, each wording's numbers spanned. */
function wordings(texts: readonly string[]): string[] {
    const read = (text: string): { shape: string; spans: Range[] } => {
        const spans: Range[] = [];
        const shape = text.replace(
            NUMBER,
            (_m, a: string | undefined, b: string | undefined, n: string | undefined) => {
                const x = Number(n ?? a);
                const y = Number(n ?? b);
                spans.push([Math.min(x, y), Math.max(x, y)]);
                return HOLE;
            },
        );
        return { shape, spans };
    };
    const byShape = new Map<string, { text: string; spans: Range[] }[]>();
    for (const text of texts) {
        const r = read(text);
        byShape.set(r.shape, [...(byShape.get(r.shape) ?? []), { text, spans: r.spans }]);
    }
    return [...byShape].map(([shape, rows]) => {
        if (rows.length === 1) return rows[0]!.text;
        let i = 0;
        return shape.replace(new RegExp(HOLE, "g"), () => {
            const lo = Math.min(...rows.map((r) => r.spans[i]![0]));
            const hi = Math.max(...rows.map((r) => r.spans[i]![1]));
            i++;
            return lo === hi ? String(lo) : `(${lo}-${hi})`;
        });
    });
}

/**
 * The text with its first span narrowed to `value`: "+(70-84)" at [75, 90] is
 * "+(75-84)". The value is cut to the span shown, since the tiers can narrow
 * after the value was learnt and a value never widens what the rows roll.
 */
function withValue(text: string, value: Range): string {
    const re = /\((\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)\)/;
    const m = re.exec(text);
    if (m === null) return text;
    const lo = Math.max(value[0], Number(m[1]));
    const hi = Math.min(value[1], Number(m[2]));
    if (lo > hi) return text;
    return text.replace(re, lo === hi ? String(lo) : `(${lo}-${hi})`);
}

/** The modifier view for a type some item carries, at the rows the items
 *  hold it at, or at `pin` when a group rests on those rows. */
function modView(
    s: ItemSet,
    type: TypeId,
    gen: Gen,
    registry: Registry,
    pin: readonly Mod[] = [],
): ModView {
    const tags = influenceTagsAny(s);
    const held = rowsOf(s, type);
    const pinned = held.filter((m) => pin.includes(m));
    const mods: readonly Mod[] =
        pinned.length > 0
            ? pinned
            : held.length > 0
              ? held
              : [...rollableTiers(registry.catalog, s.u.base, s.u.ilvl, type, tags)];
    const texts = mods.map((m) => m.text).filter((t): t is string => t !== undefined);
    const span = texts.length > 0 ? rollSpan(texts) : textless(type, gen, mods, registry);
    // A value narrower than the rows roll (a condition on it) narrows the first span.
    const value =
        pinned.length > 0 ? hull(pinned.map((m) => valueSpan(s, type, m.id))) : valueSpan(s, type);
    const rolls = hull(mods.map((m) => (m.text === undefined ? undefined : rollRange(m.text))));
    const narrowed =
        value !== undefined && rolls !== undefined && (value[0] > rolls[0] || value[1] < rolls[1]);
    // A value narrows the one wording there is; beside another it would say
    // nothing of which.
    const worded = wordings(texts).length === 1;
    const text = narrowed && worded ? withValue(span, value) : span;
    const ladders = tierLadders(registry.catalog, s.u.base, type, tags);
    const numbers = mods.map((m) => tierNumber(ladders, m.id)).filter((n) => n !== undefined);
    const tagSet = new Set<string>();
    for (const m of mods) for (const t of m.implicitTags) tagSet.add(tagLabel(t));
    const one = mods.length === 1 ? mods[0]! : undefined;
    // A bench craft of one rank (0) shows none, as does an unveiled row.
    const rank = one?.source === "bench" ? (registry.benchTierOf(one.id) ?? 0) : 0;
    const crafted = isCrafted(s, type);
    return {
        gen,
        text,
        ...(one?.name !== undefined && { name: one.name }),
        ...(numbers.length > 0 && {
            tier: [Math.min(...numbers), Math.max(...numbers)] as Range,
        }),
        tags: [...tagSet],
        fractured: isFractured(s, type),
        crafted,
        ...(!crafted && craftedTypes(s).has(type) && { possiblyCrafted: true as const }),
        veiled: mods.length > 0 && mods.every(isUnveiledResult),
        ...(rank > 0 && { rank }),
    };
}

/**
 * The text of a modifier whose rows have none: its type's wording, else as
 * the wiki writes a veiled modifier's, its name and side ("Veiled (prefix)",
 * "of the Veil (suffix)": the `mods` Cargo table's `stat_text` of the
 * placeholders). Never the type's id.
 */
function textless(type: TypeId, gen: Gen, mods: readonly Mod[], registry: Registry): string {
    const label = registry.typeLabel(type);
    if (label !== type) return label;
    const name = mods.find((m) => m.name !== undefined && m.name !== "")?.name;
    return name === undefined ? `${capitalise(gen)} modifier` : `${name} (${gen})`;
}

function hull(ranges: readonly (Range | undefined)[]): Range | undefined {
    let lo = Infinity;
    let hi = -Infinity;
    for (const r of ranges) {
        if (r === undefined) return undefined;
        lo = Math.min(lo, r[0]);
        hi = Math.max(hi, r[1]);
    }
    return lo > hi ? undefined : [lo, hi];
}

interface Guarantee {
    readonly atLeast: number;
    readonly types: readonly TypeId[];
    readonly gen: Gen | undefined;
    /** No item carries more than `atLeast` of them. */
    readonly exact: boolean;
}

/**
 * The "at least k of these" groups: those the search over every item finds
 * (`cardinalityGuarantees`, of a bounded size), then each group the craft
 * names (one its conditions wait for, a pool a step guarantees one of), asked
 * of the items directly whatever its size, cut to the members it needs and
 * left out where a group already shown implies it.
 */
function guarantees(
    s: ItemSet,
    names: CraftNames | undefined,
    genOf: (t: TypeId) => Gen,
): Guarantee[] {
    const found: CardinalityGuarantee[] = [...cardinalityGuarantees(s)];
    const sure = guaranteedTypes(s);
    const possible = possibleTypes(s);
    for (const group of names?.groups ?? []) {
        if (group.some((t) => sure.has(t))) continue;
        let members = group.filter((t) => possible.has(t));
        const k = presentAmong(s, members)[0];
        if (k < 1) continue;
        for (const t of [...members]) {
            const fewer = members.filter((x) => x !== t);
            if (presentAmong(s, fewer)[0] >= k) members = fewer;
        }
        if (members.length < 2) continue;
        const kept = members;
        if (found.some((f) => f.atLeast - f.types.filter((t) => !kept.includes(t)).length >= k)) {
            continue;
        }
        found.push({ atLeast: k, types: members });
    }
    return found.map((c) => {
        const gens = new Set(c.types.map(genOf));
        return {
            ...c,
            gen: gens.size === 1 ? [...gens][0]! : undefined,
            exact: presentAmong(s, c.types)[1] === c.atLeast,
        };
    });
}

/**
 * The modifiers the craft names that no item carries, by wording: each type
 * the item can have a slot for, and a `has group` once by its own modifier's
 * wording where no item has any of the group's. A wording a modifier some
 * item carries also has is left out, as is a type with no wording of its own.
 * None where every item carries the same modifiers, all shown: it then lacks
 * every other.
 */
function absent(
    s: ItemSet,
    names: CraftNames,
    sure: ReadonlySet<TypeId>,
    registry: Registry,
): string[] {
    if (countOutside(s, sure)[1] === 0) return [];
    const possible = possibleTypes(s);
    const held = new Set([...possible].map((t) => registry.typeLabel(t)));
    const out = new Set<string>();
    const add = (type: TypeId): void => {
        const label = registry.typeLabel(type);
        if (label !== type && !held.has(label)) out.add(label);
    };
    for (const t of names.types) {
        if (s.u.slotOfType(t) !== undefined && !possible.has(t)) add(t);
    }
    for (const g of names.named) {
        const slotted = g.types.filter((t) => s.u.slotOfType(t) !== undefined);
        if (slotted.length > 0 && slotted.every((t) => !possible.has(t))) add(g.type);
    }
    return [...out];
}

/**
 * The items of the state as one tooltip: what every item carries by name, the
 * groups every item carries some of, the rest as a count, the marks. With the
 * craft, the modifiers it names that no item carries are listed as absent, and
 * the groups it names are shown however large.
 *
 * Within a side, the modifiers go in the order the item block declares them,
 * then by wording; a group's members likewise, and the groups by their first
 * member. The game's copy orders them by how it stores the item, which the
 * items here do not hold.
 */
export function itemView(s: ItemSet, registry: Registry, craft?: Craft): ItemView {
    const { base, ilvl } = s.u;
    const names = craft === undefined ? undefined : craftNames(craft, s.u);
    const tags = influenceTagsAny(s);
    const genOf = (t: TypeId): Gen => {
        const sides = new Set(rowsOf(s, t).map((m) => m.gen));
        if (sides.size === 1) return [...sides][0]!;
        return rollableGen(registry.catalog, base, ilvl, t, tags) ?? "prefix";
    };
    const wording = (t: TypeId): string => rowsOf(s, t)[0]?.text ?? registry.typeLabel(t);
    const declared = names?.declared ?? [];
    const rank = (t: TypeId): number => {
        const i = declared.indexOf(t);
        return i < 0 ? declared.length : i;
    };
    const byOrder = (a: TypeId, b: TypeId): number =>
        rank(a) - rank(b) || cmp(wording(a), wording(b)) || cmp(a, b);

    const sure = [...guaranteedTypes(s)].sort(byOrder);
    const known: Record<Gen, TypeId[]> = { prefix: [], suffix: [] };
    for (const t of sure) known[genOf(t)].push(t);

    const cardinalities = guarantees(s, names, genOf)
        .map((c) => ({ ...c, types: [...c.types].sort(byOrder) }))
        .sort((a, b) => byOrder(a.types[0]!, b.types[0]!));
    const oneOf = (c: Guarantee): ModGroup => {
        const pins = clauseRows(s, c.types, c.atLeast);
        return {
            kind: "oneOf",
            atLeast: c.atLeast,
            exact: c.exact,
            members: c.types.map((t) => modView(s, t, genOf(t), registry, pins.get(t))),
        };
    };
    const groups = (gen: Gen): ModGroup[] => [
        ...known[gen].map((t): ModGroup => ({ kind: "mod", mod: modView(s, t, gen, registry) })),
        ...cardinalities.filter((c) => c.gen === gen).map(oneOf),
    ];

    // The modifiers of no type shown by name, counted over the items, so a
    // group's members beyond its "at least" are never counted again here.
    const shown = new Set([...sure, ...cardinalities.flatMap((c) => c.types)]);
    const extra = countOutside(s, shown);
    let remainder: Remainder | undefined;
    if (extra[1] > 0) {
        const where =
            countOutside(s, shown, "suffix")[1] === 0
                ? "prefix"
                : countOutside(s, shown, "prefix")[1] === 0
                  ? "suffix"
                  : "either";
        remainder = { count: extra, where };
    }
    // The lines above give the count only where each group holds exactly its
    // number: a group of "at least" leaves the total to a line of its own.
    const total = counts(s).total;
    const counted = cardinalities.every((c) => c.exact);

    const pairs = [...eldritchPairs(s)];
    const sideTiers = (side: EldritchSide): number[] => pairs.map((k) => eldritchOf(k)[side]);
    const implicits: ImplicitView[] = [];
    for (const side of ELDRITCH_SIDES) {
        const all = sideTiers(side);
        const tiers = [...new Set(all)].filter((n) => n > 0).sort((x, y) => x - y);
        if (tiers.length === 0) continue;
        // The wordings are the rows of the known tiers, since a family's text
        // changes with the tier; a type with no row at them keeps its wording.
        const texts = new Set<string>();
        const tagSet = new Set<string>();
        const types = eldritchTypes(s, side);
        for (const t of types) {
            const rows = tiers.flatMap((n) =>
                registry.eldritchRows(base, side, n).filter((e) => e.type === t),
            );
            if (rows.length === 0) texts.add(registry.eldritchTextOf(t) ?? t);
            for (const e of rows) {
                texts.add(e.text);
                for (const tag of e.implicitTags) tagSet.add(tagLabel(tag));
            }
        }
        // An implicit the game data gives no wording for: alone it reads as
        // any; beside named ones, as one more of them.
        const unnamed = types.size > 0 && unnamedImplicit(s, side);
        if (unnamed) texts.add(UNNAMED_IMPLICIT);
        implicits.push({
            side,
            tiers: tiers.map(eldritchTierLabel),
            texts: [...texts],
            count: types.size + (unnamed ? 1 : 0),
            // Several wordings' tags together would describe no implicit.
            tags: texts.size === 1 ? [...tagSet] : [],
            maybe: all.some((n) => n === 0),
        });
    }

    const marks: Mark[] = [];
    const influences = influenceSets(s);
    const influenceKeys = [...influences].filter((k) => k !== NO_INFLUENCE).sort();
    const mayLackInfluence = influences.has(NO_INFLUENCE);
    if (influenceKeys.length === 1 && !mayLackInfluence) {
        for (const i of influencesOf(influenceKeys[0]!)) {
            marks.push({ kind: "influence", text: `${INFLUENCE_NAME[i]} Item`, maybe: false });
        }
    } else if (influenceKeys.length > 0) {
        const named = influenceKeys.map((k) => `${influenceSetLabel(k)} Item`).join(", or ");
        const text = `${named}${mayLackInfluence ? ", or no influence" : ""}`;
        marks.push({ kind: "influence", text, maybe: true });
    }
    for (const side of ELDRITCH_SIDES) {
        const all = sideTiers(side);
        if (all.some((n) => n > 0)) {
            const maybe = all.some((n) => n === 0);
            marks.push({ kind: "eldritch", text: `${SIDE_NAME[side]} Item`, maybe });
        }
    }
    const fractures = fracturedCount(s);
    if (fractures[1] > 0) {
        marks.push({ kind: "fractured", text: "Fractured Item", maybe: fractures[0] === 0 });
    }
    const corrupted = corruptions(s);
    if (corrupted.has(true)) {
        marks.push({ kind: "corrupted", text: "Corrupted", maybe: corrupted.has(false) });
    }

    const strands = strandsRange(s);
    const held = rarities(s);
    return {
        base: baseLabel(base),
        itemClass: itemClassLabel(base.itemClass),
        ilvl,
        ...(strands[1] > 0 && { strands }),
        rarities: RARITY_ORDER.filter((r) => held.has(r)),
        implicits,
        prefixes: groups("prefix"),
        suffixes: groups("suffix"),
        either: cardinalities.filter((c) => c.gen === undefined).map(oneOf),
        ...(remainder !== undefined && { remainder }),
        ...(!counted && { total }),
        marks,
        without: names === undefined ? [] : absent(s, names, new Set(sure), registry),
    };
}

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** The words an item that breaks a step is shown under. */
export const EXAMPLE_LEAD = "For example, this item:";

/** The line for an eldritch implicit the game data has no wording for. */
export const UNNAMED_IMPLICIT = "an implicit the game data has no wording for";

// --- the text form ------------------------------------------------------------

const SEPARATOR = "--------";
const NUMBER_WORDS = ["zero", "one", "two", "three", "four", "five", "six"];
export const numberWord = (n: number): string => NUMBER_WORDS[n] ?? String(n);
/** The game's name for each eldritch side, as its `… Item` line writes it. */
export const SIDE_NAME: Readonly<Record<EldritchSide, string>> = {
    exarch: "Searing Exarch",
    eater: "Eater of Worlds",
};

/** "82", or "40-82" when some may have been spent: the memory strands in words. */
export function strandsText(r: Range): string {
    return rangeText(r);
}

/** The short name players use for each side ("a Grand Exarch implicit"). */
export const SIDE_SHORT: Readonly<Record<EldritchSide, string>> = {
    exarch: "Exarch",
    eater: "Eater",
};

/** Past this many wordings an implicit is summarised as "one of n" rather than listed. */
export const IMPLICIT_LIST_LIMIT = 6;

/** "Grand", or "Lesser to Grand": the tier names an implicit may be at, in words. */
export function implicitTierText(i: ImplicitView, dash = " to "): string {
    return i.tiers.length === 1
        ? i.tiers[0]!
        : `${i.tiers[0]!}${dash}${i.tiers[i.tiers.length - 1]!}`;
}

/**
 * "1-3 additional prefix or suffix modifiers": the unknown modifiers in words.
 * A range is plural, as is any count but one.
 */
export function remainderText(r: Remainder, dash = "-"): string {
    const where = r.where === "either" ? "prefix or suffix" : r.where;
    return `${rangeText(r.count, dash)} additional ${where} ${pluralRange(r.count, "modifier")}`;
}

/** "4-6 modifiers in all": the item's count, where the lines do not settle it. */
export function totalText(r: Range, dash = "-"): string {
    return `${rangeText(r, dash)} ${pluralRange(r, "modifier")} in all`;
}

/** "at least one of" / "exactly two of": a disjunction group's header words. */
export function groupLabel(g: Extract<ModGroup, { kind: "oneOf" }>): string {
    return `${g.exact ? "exactly" : "at least"} ${numberWord(g.atLeast)} of`;
}

const tagsText = (tags: readonly string[]): string =>
    tags.length > 0 ? ` — ${tags.join(", ")}` : "";

/**
 * The game's advanced-copy header for a modifier: `{ Prefix Modifier "Virile"
 * (Tier: 1) — Life }`, `{ Fractured Prefix Modifier … }`, `{ Master Crafted
 * Suffix Modifier "of Craft" (Rank: 2) — … }`; an unveiled
 * modifier, which the game does not count as crafted, is headed `Veiled`.
 */
function modHeader(m: ModView): string {
    const marker = m.fractured
        ? "Fractured "
        : m.crafted
          ? "Master Crafted "
          : m.possiblyCrafted === true
            ? "Possibly Master Crafted "
            : m.veiled
              ? "Veiled "
              : "";
    const kind = `${marker}${capitalise(m.gen)} Modifier`;
    const name = m.name !== undefined ? ` "${m.name}"` : "";
    const tier =
        m.rank !== undefined
            ? ` (Rank: ${m.rank})`
            : m.tier !== undefined
              ? ` (Tier: ${rangeText(m.tier)})`
              : "";
    return `{ ${kind}${name}${tier}${tagsText(m.tags)} }`;
}

const lines = (text: string): string[] => text.split("\n");
const indent = (l: string): string => `    ${l}`;

function modLines(m: ModView): string[] {
    return [modHeader(m), ...lines(m.text)];
}

function groupLines(gen: Gen | undefined, g: ModGroup): string[] {
    if (g.kind === "mod") return modLines(g.mod);
    const kind = gen === undefined ? "modifiers" : `${gen} modifiers`;
    const label = groupLabel(g);
    const head = `{ ${capitalise(label)} these ${kind} }`;
    return [head, ...g.members.flatMap((m) => modLines(m).map(indent))];
}

function implicitLines(i: ImplicitView): string[] {
    const tier = implicitTierText(i);
    const maybe = i.maybe ? "Possibly: " : "";
    const name = SIDE_NAME[i.side];
    const head = `{ ${maybe}${name} Implicit Modifier (${tier})${tagsText(i.tags)} }`;
    if (i.texts.length === 1) return [head, ...lines(i.texts[0]!)];
    if (i.texts.length === 0) return [head, `any ${tier} ${name} implicit`];
    if (i.texts.length > IMPLICIT_LIST_LIMIT) {
        return [head, `one of ${i.count} ${name} implicits`];
    }
    return [head, `one of ${i.texts.length}:`, ...i.texts.flatMap(lines).map(indent)];
}

/**
 * The item as the game's advanced copy (Ctrl+Alt+C) lays it out, in the
 * format since 3.28, with this project's extensions where the state is not
 * concrete. The name, properties, requirements and sockets are left out, as
 * the state does not hold them. `Corrupted` comes before the influence
 * section, as a pasted corrupted Shaper shield has them; where it stands beside
 * `Fractured Item` no paste shows (`docs/QUESTIONS.md` Q100).
 */
export function renderItemText(v: ItemView): string {
    const sections: string[][] = [];
    sections.push([`Item Class: ${v.itemClass}`, `Rarity: ${rarityText(v.rarities)}`, v.base]);
    // The strands are the last of the properties, which come before the item level.
    if (v.strands !== undefined) sections.push([`Memory Strands: ${strandsText(v.strands)}`]);
    sections.push([`Item Level: ${v.ilvl}`]);

    if (v.implicits.length > 0) sections.push(v.implicits.flatMap(implicitLines));

    const markLines = (kind: MarkKind): string[] =>
        v.marks
            .filter((m) => m.kind === kind)
            .map((m) => (m.maybe ? `Possibly: ${m.text}` : m.text));
    const mods = [
        ...v.prefixes.flatMap((g) => groupLines("prefix", g)),
        ...v.suffixes.flatMap((g) => groupLines("suffix", g)),
        ...v.either.flatMap((g) => groupLines(undefined, g)),
    ];
    if (v.remainder !== undefined) mods.push(`{ ${remainderText(v.remainder)} }`);
    if (v.total !== undefined) mods.push(`{ ${totalText(v.total)} }`);
    // The eldritch marks close the modifier section, with no separator.
    mods.push(...markLines("eldritch"));
    const rest = [markLines("corrupted"), markLines("influence"), markLines("fractured")];
    for (const s of [mods, ...rest]) if (s.length > 0) sections.push(s);
    if (v.without.length > 0) {
        sections.push([`Without: ${v.without.join(", ")}`]);
    }
    return sections.map((s) => s.join("\n")).join(`\n${SEPARATOR}\n`);
}
