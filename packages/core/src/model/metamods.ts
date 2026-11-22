/**
 * The bench meta-crafting modifiers ("metamods") and the effects they carry.
 * The data carries no effects, so they are curated here by mod id and attached to the catalog
 * when the registry is built. The effects are then derived from the present
 * mods (item-model.md §6) by the pool and the checker.
 *
 * The legacy "required level above 28" metamod is intentionally omitted.
 */
import type { Effect } from "./effects.js";
import { ModId, TagId } from "./ids.js";
import type { Mod } from "./mod.js";
import type { ImplicitSpec } from "./sources.js";

const ATTACK = TagId("attack");
const CASTER = TagId("caster");

const carrying =
    (effects: readonly Effect[]) =>
    (id: string): readonly [ModId, readonly Effect[]] => [ModId(id), effects];

/**
 * Real RePoE metamod id → the effects that mod carries. Each full protection
 * has a bench row per group of item classes, each its own cost (Version
 * 3.30.0 § Endgame Changes): weapons, then armour and quivers (`B`), then
 * jewellery (`C`).
 */
export const METAMOD_EFFECTS: ReadonlyMap<ModId, readonly Effect[]> = new Map<
    ModId,
    readonly Effect[]
>([
    ...[
        "StrMasterItemGenerationCannotChangePrefixes",
        "StrMasterItemGenerationCannotChangePrefixesB",
        "StrMasterItemGenerationCannotChangePrefixesC",
    ].map(carrying([{ kind: "protect", gen: "prefix" }])),
    ...[
        "DexMasterItemGenerationCannotChangeSuffixes",
        "DexMasterItemGenerationCannotChangeSuffixesB",
        "DexMasterItemGenerationCannotChangeSuffixesC",
    ].map(carrying([{ kind: "protect", gen: "suffix" }])),
    [
        ModId("IntMasterItemGenerationCannotRollAttackAffixes"),
        [{ kind: "poolRestrict", tag: ATTACK }],
    ],
    [
        ModId("StrDexMasterItemGenerationCannotRollCasterAffixes"),
        [{ kind: "poolRestrict", tag: CASTER }],
    ],
    [
        ModId("StrIntMasterItemGenerationCanHaveMultipleCraftedMods"),
        [{ kind: "craftedCap", cap: 3 }],
    ],
]);

/**
 * The partial protections, "1 Prefix Modifier cannot be changed" and its three
 * siblings (Version 3.30.0 § Endgame Changes), by their mod ids, in the full
 * protections' three groups of item classes. The load tests fail on a bench
 * craft of theirs that this table does not list, so a data refresh cannot
 * load one as a plain crafted modifier.
 */
export const PARTIAL_PROTECTION_EFFECTS: ReadonlyMap<ModId, readonly Effect[]> = new Map<
    ModId,
    readonly Effect[]
>([
    ...[
        "StrMasterItemGenerationCannotChangeOnePrefixes",
        "StrMasterItemGenerationCannotChangeOnePrefixesB",
        "StrMasterItemGenerationCannotChangeOnePrefixesC",
    ].map(carrying([{ kind: "protectSome", gen: "prefix", count: 1 }])),
    ...[
        "StrMasterItemGenerationCannotChangeTwoPrefixes",
        "StrMasterItemGenerationCannotChangeTwoPrefixesB",
        "StrMasterItemGenerationCannotChangeTwoPrefixesC",
    ].map(carrying([{ kind: "protectSome", gen: "prefix", count: 2 }])),
    ...[
        "DexMasterItemGenerationCannotChangeOneSuffixes",
        "DexMasterItemGenerationCannotChangeOneSuffixesB",
        "DexMasterItemGenerationCannotChangeOneSuffixesC",
    ].map(carrying([{ kind: "protectSome", gen: "suffix", count: 1 }])),
    ...[
        "DexMasterItemGenerationCannotChangeTwoSuffixes",
        "DexMasterItemGenerationCannotChangeTwoSuffixesB",
        "DexMasterItemGenerationCannotChangeTwoSuffixesC",
    ].map(carrying([{ kind: "protectSome", gen: "suffix", count: 2 }])),
]);

/** The bench craft text of a partial protection: a count, in digits or words,
 *  then the side, so a refresh that rewords one still matches; the full
 *  protection, which names no count, does not. */
export const PARTIAL_PROTECTION_TEXT =
    /\b(?:\d+|an?|one|two|three) (?:Prefix(?:es)?|Suffix(?:es)?)(?: Modifiers?)? cannot be changed/i;

/**
 * Attach curated metamod effects to matching catalog mods. Mods that already
 * carry effects (e.g. test fixtures) are left untouched, so the two sources of
 * effect-carriers do not fight.
 */
export function withMetamodEffects(catalog: readonly Mod[]): readonly Mod[] {
    return catalog.map((m) => {
        const effects = METAMOD_EFFECTS.get(m.id) ?? PARTIAL_PROTECTION_EFFECTS.get(m.id);
        return effects && m.effects === undefined ? { ...m, effects } : m;
    });
}

/**
 * The implicits whose words bar modifiers from rolling, each with the
 * cannot-roll restrictions it carries:
 * - a cannot-roll metamod's words, its restriction: the attack wands'
 *   "Cannot roll Caster Modifiers" bars from a roll what the metamod bars;
 * - "Cannot roll Modifiers of Non-Cold Damage Types" (the Breach rings'), a
 *   restriction of each damage-type tag but the named one (QUESTIONS.md Q138).
 * Matched on a line's text, so the implicit and the metamod share one effect.
 */
export function withImplicitEffects(
    implicits: readonly ImplicitSpec[],
    catalog: readonly Mod[],
): readonly ImplicitSpec[] {
    const byText = new Map<string, readonly Effect[]>();
    for (const m of catalog) {
        const restricts = (m.effects ?? []).filter((e) => e.kind === "poolRestrict");
        if (m.text !== undefined && restricts.length > 0) byText.set(wordsOf(m.text), restricts);
    }
    return implicits.map((i) => {
        if (i.effects !== undefined) return i;
        const effects = i.text
            .split("\n")
            .flatMap((line) => byText.get(wordsOf(line)) ?? damageTypeRestricts(line));
        return effects.length === 0 ? i : { ...i, effects };
    });
}

/** The tags a modifier "of a damage type" carries (QUESTIONS.md Q138). */
const DAMAGE_TYPE_TAGS: readonly TagId[] = ["fire", "cold", "lightning", "physical", "chaos"].map(
    TagId,
);

const NON_DAMAGE_TYPE = /^cannot roll modifiers of non-(\w+) damage types$/;

/** "Cannot roll Modifiers of Non-<type> Damage Types": a restriction of each
 *  other damage type's tag; none for words of another kind. */
function damageTypeRestricts(line: string): readonly Effect[] {
    const kept = NON_DAMAGE_TYPE.exec(wordsOf(line))?.[1];
    if (kept === undefined || !DAMAGE_TYPE_TAGS.includes(TagId(kept))) return [];
    return DAMAGE_TYPE_TAGS.filter((t) => t !== kept).map((tag) => ({
        kind: "poolRestrict" as const,
        tag,
    }));
}

const wordsOf = (text: string): string => text.trim().toLowerCase().replace(/\s+/g, " ");
