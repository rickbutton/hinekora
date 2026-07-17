/**
 * The adapter: RePoE JSON entries → normalized core `Mod` / `Base`.
 *
 * This is the seam the brief calls out (§3 `/data/adapter`): it isolates the
 * source data's shape from the core model, so a different source (PoE2 community
 * data, raw dat-schema dumps) becomes a different adapter feeding the SAME core
 * types. PoE1 weights are ground-truth, so every spawn weight is tagged `Known`
 * (including `Known 0`, which disables a mod on bases carrying that tag).
 */
import {
    type Base,
    BaseId,
    type BenchCraft,
    ClassId,
    Domain,
    type EssenceSpec,
    type Gen,
    GroupId,
    known,
    type Mod,
    ModId,
    type ModSource,
    TagId,
    TypeId,
} from "@hinekora/core";
import type { RepoeBase, RepoeBench, RepoeEssence, RepoeMod } from "./repoe/schema.js";

/** Only prefix/suffix mods are modelled; other generation types (essence,
 * corrupted, …) are skipped by returning `null`. */
function toGen(generationType: string): Gen | null {
    return generationType === "prefix" || generationType === "suffix" ? generationType : null;
}

/**
 * Classify a mod's acquisition source from the raw fields (surface §2 / model
 * `ModSource`). This makes explicit what `pool` enforces implicitly: only
 * `natural` mods roll via chaos/exalt; the rest come from their own currencies
 * and live in their own domains.
 */
export function classifySource(m: RepoeMod): ModSource {
    if (m.generation_type !== "prefix" && m.generation_type !== "suffix") {
        switch (m.generation_type) {
            case "unique":
                return "unique";
            case "corrupted":
                return "corrupted";
            case "enchantment":
                return "enchant";
            case "eater_of_worlds_implicit":
            case "searing_exarch_implicit":
                return "eldritch";
            default:
                return "other";
        }
    }
    if (m.is_essence_only) return "essence";
    switch (m.domain) {
        case "crafted":
            return "bench";
        case "unveiled":
        case "veiled":
            return "veiled";
        case "delve":
        case "delve_area":
            return "fossil";
        case "synthesis_a":
        case "synthesis_globals":
        case "synthesis_bonus":
            return "synthesis";
        default:
            // item / flask / jewel domains: natural if it can spawn, else other.
            return m.spawn_weights.some((w) => w.weight > 0) ? "natural" : "other";
    }
}

export function adaptMod(id: string, m: RepoeMod): Mod | null {
    const gen = toGen(m.generation_type);
    if (gen === null) return null;

    return {
        id: ModId(id),
        type: TypeId(m.type),
        families: new Set(m.groups.map((g) => GroupId(g))),
        gen,
        domain: Domain(m.domain),
        minLevel: m.required_level,
        addsTags: new Set(m.adds_tags.map((t) => TagId(t))),
        spawn: m.spawn_weights.map((w) => ({ tag: TagId(w.tag), weight: known(w.weight) })),
        source: classifySource(m),
        // Human-readable fields (omit empties so the field stays absent).
        ...(m.name ? { name: m.name } : {}),
        ...(m.text ? { text: m.text } : {}),
    };
}

export function adaptEssence(id: string, e: RepoeEssence): EssenceSpec {
    const grants = new Map<ClassId, ModId>();
    for (const [cls, modId] of Object.entries(e.grants)) grants.set(ClassId(cls), ModId(modId));
    return { id, name: e.name, tier: e.tier, itemLevel: e.itemLevel, grants };
}

export function adaptBench(b: RepoeBench): BenchCraft {
    return {
        mod: ModId(b.mod),
        tier: b.tier,
        itemClasses: new Set(b.item_classes.map((c) => ClassId(c))),
        ...(b.master ? { master: b.master } : {}),
    };
}

export function adaptBase(key: string, b: RepoeBase): Base {
    // The metadata-path key is the id (unique); the display name is separate,
    // because names collide across the full catalog (maps, gems, …).
    return {
        id: BaseId(key),
        name: b.name,
        itemClass: ClassId(b.item_class),
        domain: Domain(b.domain),
        tags: new Set(b.tags.map((t) => TagId(t))),
    };
}
