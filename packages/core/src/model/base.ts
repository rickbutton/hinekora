/**
 * `Base` — a BaseItemTypes row (typing rules §1).
 *
 * The base item is physical ground truth: its class, its domain, and its tags.
 * Tags here play the eligibility role — they are matched against each mod's
 * spawn table to decide whether (and how heavily) a mod can roll on this base.
 */
import type { BaseId, ClassId, Domain, TagId } from "./ids.js";

export interface Base {
    /**
     * A stable unique id. For ingested data this is the metadata path
     * (`Metadata/Items/Rings/Ring1`), which is unique where display names are
     * not (hundreds of bases share a name — maps, gems, …).
     */
    readonly id: BaseId;
    /**
     * Human display name (`Iron Ring`). Optional: some internal bases have none,
     * and hand-built fixtures may omit it. The renderer falls back to `id`.
     * Names are NOT unique, so resolution treats a collision as ambiguous.
     */
    readonly name?: string;
    /** `BaseItemTypes.ItemClassesKey` — checked against mods' class restrictions. */
    readonly itemClass: ClassId;
    /** `BaseItemTypes.ModDomain` — must match each present/candidate mod's domain. */
    readonly domain: Domain;
    /** `BaseItemTypes.TagsKeys` — matched against mod spawn tables for eligibility. */
    readonly tags: ReadonlySet<TagId>;
}
