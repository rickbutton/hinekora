/**
 * The abstract item as a player reads an item: a view model shaped like the
 * game's item tooltip, and its text form in the game's copy-to-clipboard
 * layout (`Item Class:` / `Rarity:` / the base / `--------` sections). Each
 * modifier line carries what the game's advanced tooltip shows, the affix
 * name, the tier and the tags, when the state knows them.
 *
 * Where a state is less than concrete the view extends the layout rather than
 * hiding the uncertainty: a tier range instead of a tier, a roll span across
 * the tiers the modifier may be, "one of" groups for a disjunction, a line for
 * the modifiers whose identity is unknown, "possibly" marks, and the modifiers
 * proven absent. The checker's single-line summary for diagnostics stays
 * `renderState`; this is the full view.
 */
import {
    type AItem,
    cardinalityGuarantees,
    disjunctiveTier,
    excludedTypes,
    guaranteedTypes,
    isFractured,
    suffixRange,
} from "../check/astate.js";
import type { Range } from "../check/domain.js";
import { influenceTagsAny } from "../check/ops.js";
import type { Gen, ModId, Rarity, TypeId } from "../model/ids.js";
import {
    ELDRITCH_SIDES,
    type EldritchSide,
    ELDRITCH_TIERS,
    eldritchOf,
    type Influence,
    influenceSetLabel,
    influencesOf,
    NO_ELDRITCH,
    NO_INFLUENCE,
} from "../model/marks.js";
import type { Mod } from "../model/mod.js";
import type { Registry } from "../resolve/registry.js";
import { rollableGen, rollableTiers } from "../resolve/tiers.js";
import { baseLabel } from "./render.js";

export interface ModView {
    readonly gen: Gen;
    /** The stat text: the exact roll span when the tier is known, else the span across the tiers it may be. */
    readonly text: string;
    /** The affix name ("Virile"), when the tier is known. */
    readonly name?: string;
    /** The tier numbers the modifier may be, T1 the best, when it rolls here. */
    readonly tier?: Range;
    /** The modifier's category tags, as the advanced tooltip shows them. */
    readonly tags: readonly string[];
    readonly fractured: boolean;
    /** Every row it may be is a bench row. */
    readonly crafted: boolean;
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
    /** The wordings it may be; one when known, empty when any. */
    readonly texts: readonly string[];
}

export interface Mark {
    readonly text: string;
    /** On some path only. */
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
    readonly rarities: readonly Rarity[];
    readonly implicits: readonly ImplicitView[];
    readonly prefixes: readonly ModGroup[];
    readonly suffixes: readonly ModGroup[];
    /** Groups whose members span both generations. */
    readonly either: readonly ModGroup[];
    readonly remainder?: Remainder;
    readonly marks: readonly Mark[];
    /** The modifiers proven absent, by wording. */
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

/** The game's class label, which it writes in the plural. */
const CLASS_PLURAL: Readonly<Record<string, string>> = {
    Staff: "Staves",
    Warstaff: "Warstaves",
    Boots: "Boots",
    Gloves: "Gloves",
    "Body Armour": "Body Armours",
};
export function itemClassLabel(itemClass: string): string {
    return CLASS_PLURAL[itemClass] ?? (itemClass.endsWith("s") ? itemClass : `${itemClass}s`);
}

/** A category tag as the tooltip writes it: `physical_damage` → `Physical Damage`. */
function tagLabel(tag: string): string {
    return tag
        .split("_")
        .map((w) => w[0]!.toUpperCase() + w.slice(1))
        .join(" ");
}

const RANGE = /\((\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)\)/g;

/**
 * Several tiers' texts as one roll span: "+(70-84) …" and "+(20-29) …" ⇒
 * "+(20-84) …". Falls back to the first text when the tiers do not share a
 * range structure.
 */
export function rollSpan(texts: readonly string[]): string {
    if (texts.length === 1) return texts[0]!;
    const nums = (s: string): [number, number][] =>
        [...s.matchAll(RANGE)].map((m) => [Number(m[1]), Number(m[2])]);
    const perTier = texts.map(nums);
    const n = perTier[0]!.length;
    if (n === 0 || perTier.some((r) => r.length !== n)) return texts[0]!;
    const lo = Array.from({ length: n }, (_, i) => Math.min(...perTier.map((r) => r[i]![0])));
    const hi = Array.from({ length: n }, (_, i) => Math.max(...perTier.map((r) => r[i]![1])));
    let i = 0;
    return texts[0]!.replace(RANGE, () => `(${lo[i]}-${hi[i++]})`);
}

const oneLine = (text: string): string => text.replace(/\n/g, " / ");

/** The modifier view for a present type, pinned to `pin` when a disjunction names its tier. */
function modView(a: AItem, type: TypeId, gen: Gen, registry: Registry, pin?: ModId): ModView {
    const tags = influenceTagsAny(a, registry);
    const rollable = rollableTiers(registry.catalog, a.base, a.ilvl, type, tags);
    const pinned = pin !== undefined ? new Set([pin]) : a.tiers.get(type);
    const mods: Mod[] =
        pinned !== undefined && pinned.size > 0
            ? [...pinned].flatMap((id) => {
                  const r = registry.resolveMod(id);
                  return r.ok ? [r.value] : [];
              })
            : [...rollable];
    const texts = mods.map((m) => m.text).filter((t): t is string => t !== undefined);
    const numbers = mods
        .map((m) => rollable.findIndex((r) => r.id === m.id) + 1)
        .filter((n) => n > 0);
    const tagSet = new Set<string>();
    for (const m of mods) for (const t of m.implicitTags) tagSet.add(tagLabel(t));
    return {
        gen,
        text: texts.length > 0 ? oneLine(rollSpan(texts)) : registry.typeLabel(type),
        ...(mods.length === 1 && mods[0]!.name !== undefined && { name: mods[0]!.name }),
        ...(numbers.length > 0 && {
            tier: [Math.min(...numbers), Math.max(...numbers)] as Range,
        }),
        tags: [...tagSet],
        fractured: isFractured(a, type),
        crafted: mods.length > 0 && mods.every((m) => m.source === "bench"),
    };
}

function tierName(n: number): string {
    const name = ELDRITCH_TIERS[n - 1] ?? "";
    return name[0]!.toUpperCase() + name.slice(1);
}

export function itemView(a: AItem, registry: Registry): ItemView {
    const tags = influenceTagsAny(a, registry);
    const genOf = (t: TypeId): Gen =>
        rollableGen(registry.catalog, a.base, a.ilvl, t, tags) ?? "prefix";

    const known: Record<Gen, TypeId[]> = { prefix: [], suffix: [] };
    for (const t of guaranteedTypes(a)) known[genOf(t)].push(t);
    const genHi = { prefix: a.counts.prefix[1], suffix: suffixRange(a)[1] };

    // A cardinality guarantee is ≥k; it is exactly k when no more could fit:
    // its generation (or, spanning both, the whole item) has only k open slots.
    const knownTotal = known.prefix.length + known.suffix.length;
    const cardinalities = cardinalityGuarantees(a).map((c) => {
        const gens = new Set(c.types.map(genOf));
        const gen = gens.size === 1 ? [...gens][0]! : undefined;
        const slots = gen ? genHi[gen] - known[gen].length : a.counts.total[1] - knownTotal;
        return { ...c, gen, exact: slots <= c.atLeast };
    });
    const oneOf = (c: (typeof cardinalities)[number]): ModGroup => {
        const pins = disjunctiveTier(a, c.types);
        return {
            kind: "oneOf",
            atLeast: c.atLeast,
            exact: c.exact,
            members: c.types.map((t) => modView(a, t, genOf(t), registry, pins.get(t))),
        };
    };
    const groups = (gen: Gen): ModGroup[] => [
        ...known[gen].map((t): ModGroup => ({ kind: "mod", mod: modView(a, t, gen, registry) })),
        ...cardinalities.filter((c) => c.gen === gen).map(oneOf),
    ];

    // The modifiers whose identity is unknown, counted once against the
    // coupled total so they never read as independent per-side ranges.
    const cardSlots = (g?: Gen): number =>
        cardinalities.filter((x) => x.gen === g).reduce((s, x) => s + x.atLeast, 0);
    const accounted = knownTotal + cardinalities.reduce((s, x) => s + x.atLeast, 0);
    const extraHi = a.counts.total[1] - accounted;
    let remainder: Remainder | undefined;
    if (extraHi > 0) {
        const extraLo = Math.max(0, a.counts.total[0] - accounted);
        const prefCap = a.counts.prefix[1] - known.prefix.length - cardSlots("prefix");
        const sufCap = genHi.suffix - known.suffix.length - cardSlots("suffix");
        const where = sufCap <= 0 ? "prefix" : prefCap <= 0 ? "suffix" : "either";
        remainder = { count: [extraLo, extraHi], where };
    }

    const implicits: ImplicitView[] = [];
    for (const side of ELDRITCH_SIDES) {
        const tiers = [...new Set([...a.eldritch].map((k) => eldritchOf(k)[side]))]
            .filter((n) => n > 0)
            .sort((x, y) => x - y);
        if (tiers.length === 0) continue;
        const types = a.eldritchTypes[side];
        const texts =
            types === "any"
                ? []
                : [...new Set([...types].map((t) => oneLine(registry.eldritchTextOf(t) ?? t)))];
        implicits.push({ side, tiers: tiers.map(tierName), texts });
    }

    const marks: Mark[] = [];
    const influenceSets = [...a.influences].filter((k) => k !== NO_INFLUENCE).sort();
    const mayLackInfluence = a.influences.has(NO_INFLUENCE);
    if (influenceSets.length === 1 && !mayLackInfluence) {
        for (const i of influencesOf(influenceSets[0]!)) {
            marks.push({ text: `${INFLUENCE_NAME[i]} Item`, maybe: false });
        }
    } else if (influenceSets.length > 0) {
        const named = influenceSets.map(influenceSetLabel).join(", or ");
        marks.push({ text: `${named}${mayLackInfluence ? ", or no influence" : ""}`, maybe: true });
    }
    if ([...a.eldritch].some((k) => k !== NO_ELDRITCH)) {
        const sure = (side: EldritchSide): boolean =>
            [...a.eldritch].every((k) => eldritchOf(k)[side] > 0);
        const some = (side: EldritchSide): boolean =>
            [...a.eldritch].some((k) => eldritchOf(k)[side] > 0);
        if (some("exarch")) marks.push({ text: "Searing Exarch Item", maybe: !sure("exarch") });
        if (some("eater")) marks.push({ text: "Eater of Worlds Item", maybe: !sure("eater") });
    }
    if (a.fractures[1] > 0) marks.push({ text: "Fractured Item", maybe: a.fractures[0] === 0 });
    if (a.corrupted.has(true)) marks.push({ text: "Corrupted", maybe: a.corrupted.has(false) });

    return {
        base: baseLabel(a.base),
        itemClass: itemClassLabel(a.base.itemClass),
        ilvl: a.ilvl,
        rarities: RARITY_ORDER.filter((r) => a.rarities.has(r)),
        implicits,
        prefixes: groups("prefix"),
        suffixes: groups("suffix"),
        either: cardinalities.filter((c) => c.gen === undefined).map(oneOf),
        ...(remainder !== undefined && { remainder }),
        marks,
        without: [...excludedTypes(a)].map((t) => registry.typeLabel(t)),
    };
}

// --- the text form ------------------------------------------------------------

const SEPARATOR = "--------";
const RARITY_WORD: Readonly<Record<Rarity, string>> = {
    normal: "Normal",
    magic: "Magic",
    rare: "Rare",
};
const NUMBER_WORDS = ["zero", "one", "two", "three", "four", "five", "six"];
const numberWord = (n: number): string => NUMBER_WORDS[n] ?? String(n);
const SIDE_NAME: Readonly<Record<EldritchSide, string>> = {
    exarch: "Searing Exarch",
    eater: "Eater of Worlds",
};

function rangeText(r: Range): string {
    return r[0] === r[1] ? String(r[0]) : `${r[0]}-${r[1]}`;
}

/** The game's advanced-tooltip header for a modifier: `{ Prefix Modifier "Virile" (Tier: 1) — Life }`. */
function modHeader(m: ModView): string {
    const kind = `${m.gen[0]!.toUpperCase()}${m.gen.slice(1)} Modifier`;
    const name = m.name !== undefined ? ` "${m.name}"` : "";
    const tier = m.tier !== undefined ? ` (Tier: ${rangeText(m.tier)})` : "";
    const tags = m.tags.length > 0 ? ` — ${m.tags.join(", ")}` : "";
    return `{ ${kind}${name}${tier}${tags} }`;
}

function modLines(m: ModView): string[] {
    const suffix = m.fractured ? " (fractured)" : m.crafted ? " (crafted)" : "";
    return [modHeader(m), `${m.text}${suffix}`];
}

function groupLines(gen: Gen | undefined, g: ModGroup): string[] {
    if (g.kind === "mod") return modLines(g.mod);
    const kind = gen === undefined ? "modifiers" : `${gen} modifiers`;
    const head = `{ ${g.exact ? "Exactly" : "At least"} ${numberWord(g.atLeast)} of these ${kind} }`;
    return [head, ...g.members.flatMap((m) => modLines(m).map((l) => `    ${l}`))];
}

/**
 * The item as the game's copy-to-clipboard text lays it out, with this
 * project's extensions where the state is not concrete.
 */
export function renderItemText(v: ItemView): string {
    const sections: string[][] = [];
    sections.push([
        `Item Class: ${v.itemClass}`,
        `Rarity: ${v.rarities.map((r) => RARITY_WORD[r]).join(" or ")}`,
        v.base,
    ]);
    sections.push([`Item Level: ${v.ilvl}`]);

    if (v.implicits.length > 0) {
        sections.push(
            v.implicits.flatMap((i) => {
                const tier = i.tiers.length === 1 ? i.tiers[0]! : i.tiers.join(" to ");
                const head = `{ ${SIDE_NAME[i.side]} Implicit Modifier (Tier: ${tier}) }`;
                const tag = ` (${i.side} implicit)`;
                if (i.texts.length === 1) return [head, `${i.texts[0]!}${tag}`];
                if (i.texts.length === 0) return [head, `an implicit of that tier${tag}`];
                return [head, `one of ${i.texts.length}:${tag}`, ...i.texts.map((t) => `    ${t}`)];
            }),
        );
    }

    const mods = [
        ...v.prefixes.flatMap((g) => groupLines("prefix", g)),
        ...v.suffixes.flatMap((g) => groupLines("suffix", g)),
        ...v.either.flatMap((g) => groupLines(undefined, g)),
    ];
    if (v.remainder !== undefined) {
        const n = v.remainder.count;
        const noun = n[1] === 1 ? "modifier" : "modifiers";
        const where =
            v.remainder.where === "either"
                ? n[1] === 1
                    ? "a prefix or a suffix"
                    : "prefixes and/or suffixes"
                : v.remainder.where === "prefix"
                  ? n[1] === 1
                      ? "a prefix"
                      : "prefixes"
                  : n[1] === 1
                    ? "a suffix"
                    : "suffixes";
        mods.push(`{ ${rangeText(n)} more ${noun}, ${where} }`);
    }
    if (mods.length > 0) sections.push(mods);

    if (v.marks.length > 0) {
        sections.push(v.marks.map((m) => (m.maybe ? `Possibly: ${m.text}` : m.text)));
    }
    if (v.without.length > 0) {
        sections.push([`Without: ${v.without.join(", ")}`]);
    }
    return sections.map((s) => s.join("\n")).join(`\n${SEPARATOR}\n`);
}
