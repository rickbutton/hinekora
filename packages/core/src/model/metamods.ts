/**
 * The bench meta-crafting modifiers ("metamods") and the effects they carry.
 * These effects cannot be ingested from data — a `poolRestrict` is a predicate,
 * not a datum — so they are curated here by mod id and attached to the catalog
 * when the registry is built. The effects then flow through the same derived
 * `effects(it)` path (§9) that `pool` / `wf` / `removable` already consume.
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
    [
        ModId("StrMasterItemGenerationCannotChangePrefixes"),
        [{ kind: "protect", target: { by: "gen", gen: "prefix" } }],
    ],
    [
        ModId("DexMasterItemGenerationCannotChangeSuffixes"),
        [{ kind: "protect", target: { by: "gen", gen: "suffix" } }],
    ],
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
 * Attach curated metamod effects to matching catalog mods. Mods that already
 * carry effects (e.g. test fixtures) are left untouched, so the two sources of
 * effect-carriers do not fight.
 */
export function withMetamodEffects(catalog: readonly Mod[]): readonly Mod[] {
    return catalog.map((m) => {
        const effects = METAMOD_EFFECTS.get(m.id);
        return effects && m.effects === undefined ? { ...m, effects } : m;
    });
}
