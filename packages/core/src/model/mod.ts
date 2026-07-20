/**
 * `Mod`, one row per TIER of the Mods table (typing rules §1).
 *
 * A "mod" here is a single tier: "increased Life (T3)" is a different `Mod`
 * value from "increased Life (T1)", but both share a `type` (ModType) so they
 * collide under the no-duplicate rule. Grounded field-for-field in dat-schema.
 */
import type { Effect } from "./effects.js";
import type { ClassId, Domain, Gen, GroupId, ModId, TagId, TypeId } from "./ids.js";
import type { ModSource } from "./sources.js";
import type { Weight } from "./weight.js";

/** One (tag, weight) entry of a mod's spawn-weight array. */
export interface SpawnEntry {
    readonly tag: TagId;
    readonly weight: Weight;
}

export interface Mod {
    /** `Mods.Id`, the tier's unique id. */
    readonly id: ModId;
    /** `Mods.ModType`, the tier bucket; identity for the no-dup-type rule. */
    readonly type: TypeId;
    /** `Mods.Families`, mutual-exclusion groups this mod belongs to. */
    readonly families: ReadonlySet<GroupId>;
    /** `Mods.GenerationType`, prefix or suffix (the slot it occupies). */
    readonly gen: Gen;
    /** `Mods.Domain`, must equal the base's domain for the mod to apply. */
    readonly domain: Domain;
    /** `Mods.Level`, the tier's ilvl gate: item.ilvl must be >= this. */
    readonly minLevel: number;
    /** `Mods.TagsKeys`, tags this mod ADDS to the item once present. */
    readonly addsTags: ReadonlySet<TagId>;
    /**
     * `SpawnWeight_TagsKeys ‖ _Values`, ordered spawn table. Eligibility and
     * weight are resolved by first-match against the BASE item's tags
     * (see `lookupWeight`). Order matters: earlier entries win, which is how a
     * zero-weight entry can DISABLE a mod for bases carrying that tag.
     */
    readonly spawn: readonly SpawnEntry[];

    /**
     * `CraftingItemClassRestrictions`, if present, the mod may only appear on
     * bases of these item classes. Absent means unrestricted. Optional so the
     * common (unrestricted) case needs no field.
     */
    readonly classRestriction?: ReadonlySet<ClassId>;

    /**
     * Effects this mod carries while present (typing rules §9). Absent for the
     * vast majority of mods, only carriers (bench metamods, effect-essences,
     * delirium slot mods, …) have any. Read via `effectsOf`; folded into `pool`
     * and `wf` through the derived `effects(it)` projection.
     */
    readonly effects?: readonly Effect[];

    /** Affix name (e.g. "Robust"). Present for ingested data; used for resolution. */
    readonly name?: string;
    /**
     * Human-readable stat text (e.g. "+(70-84) to maximum Life"). The basis for
     * fuzzy name resolution (matched range-stripped) and for readable rendering.
     */
    readonly text?: string;
    /** How this mod can be obtained (stamped at ingest); see `ModSource`. */
    readonly source?: ModSource;
}
