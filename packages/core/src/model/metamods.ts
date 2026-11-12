/**
 * The bench meta-crafting modifiers ("metamods") and the effects they carry.
 * These effects cannot be ingested from data — a `poolRestrict` is a predicate,
 * not a datum — so they are curated here by mod id and attached to the catalog
 * when the registry is built. The effects are then derived from the present
 * mods (item-model.md §6) by the pool and the checker.
 *
 * The legacy "required level above 28" metamod is intentionally omitted.
 */
import type { Effect } from "./effects.js";
import { ModId, TagId } from "./ids.js";
import type { Mod } from "./mod.js";

const ATTACK = TagId("attack");
const CASTER = TagId("caster");

/** Real RePoE metamod id → the effects that mod carries. */
export const METAMOD_EFFECTS: ReadonlyMap<ModId, readonly Effect[]> = new Map<
    ModId,
    readonly Effect[]
>([
    [ModId("StrMasterItemGenerationCannotChangePrefixes"), [{ kind: "protect", gen: "prefix" }]],
    [ModId("DexMasterItemGenerationCannotChangeSuffixes"), [{ kind: "protect", gen: "suffix" }]],
    [
        ModId("IntMasterItemGenerationCannotRollAttackAffixes"),
        [{ kind: "poolRestrict", allows: (m) => !m.implicitTags.has(ATTACK) }],
    ],
    [
        ModId("StrDexMasterItemGenerationCannotRollCasterAffixes"),
        [{ kind: "poolRestrict", allows: (m) => !m.implicitTags.has(CASTER) }],
    ],
    [
        ModId("StrIntMasterItemGenerationCanHaveMultipleCraftedMods"),
        [{ kind: "craftedCap", cap: 3 }],
    ],
]);

/**
 * The partial protections, "1 Prefix Modifier cannot be changed" and its three
 * siblings (Version 3.30.0, Endgame Changes), by their mod ids. The game data this
 * repository holds predates them, so the table names none yet; the load tests
 * fail on a bench craft of theirs that it does not list, so a data refresh
 * cannot load one as a plain crafted modifier. Each entry is
 * `[{ kind: "protectSome", gen, count }]`, `gen` the side it protects.
 */
export const PARTIAL_PROTECTION_EFFECTS: ReadonlyMap<ModId, readonly Effect[]> = new Map<
    ModId,
    readonly Effect[]
>([]);

/** The bench craft text of a partial protection: a count, in digits or words,
 *  then the side. The data's wording is not known yet, so the variants a
 *  refresh may bring match; the full protection, which names no count, does not. */
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
