/**
 * The adapter: RePoE JSON entries → normalized core `Mod` / `Base`. It
 * isolates the source data's shape from the core model, so a different source
 * becomes a different adapter feeding the same types.
 */
import {
    type Base,
    BaseId,
    type BenchCraft,
    ClassId,
    Domain,
    type EssenceSpec,
    type FossilSpec,
    type Gen,
    GroupId,
    type Mod,
    ModId,
    type ModSource,
    TagId,
    TypeId,
} from "@hinekora/core";
import type { RepoeBase, RepoeBench, RepoeEssence, RepoeFossil, RepoeMod } from "./repoe/schema.js";

/** Only prefix/suffix mods are modelled; other generation types (essence,
 * corrupted, …) are skipped by returning `null`. */
function toGen(generationType: string): Gen | null {
    return generationType === "prefix" || generationType === "suffix" ? generationType : null;
}

/** Classify a mod's acquisition source (`ModSource`) from the raw fields, the
 *  reading of a row item-model.md §5 states. Only affix rows reach here. */
export function classifySource(m: RepoeMod): ModSource {
    if (m.generation_type !== "prefix" && m.generation_type !== "suffix") return "other";
    if (m.is_essence_only) return "essence";
    switch (m.domain) {
        case "crafted":
            return "bench";
        case "unveiled":
        case "veiled":
            return "veiled";
        case "delve":
            return "fossil";
        default:
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
        implicitTags: new Set((m.implicit_tags ?? []).map((t) => TagId(t))),
        spawn: m.spawn_weights.map((w) => ({ tag: TagId(w.tag), weight: w.weight })),
        source: classifySource(m),
        // Human-readable fields (omit empties so the field stays absent).
        ...(m.name ? { name: m.name } : {}),
        ...(m.text ? { text: m.text } : {}),
    };
}

export function adaptEssence(id: string, e: RepoeEssence): EssenceSpec {
    const grants = new Map<ClassId, ModId>();
    for (const [cls, modId] of Object.entries(e.grants)) grants.set(ClassId(cls), ModId(modId));
    return {
        id,
        name: e.name,
        tier: e.tier,
        ...(e.maxRandomModLevel != null && { maxRandomModLevel: e.maxRandomModLevel }),
        grants,
    };
}

export function adaptFossil(id: string, f: RepoeFossil): FossilSpec {
    return {
        id,
        name: f.name,
        blockedTags: new Set(f.blocked_tags.map((t) => TagId(t))),
        addedMods: f.added_mods.map((m) => ModId(m)),
        forcedMods: f.forced_mods.map((m) => ModId(m)),
        ...(f.allowed_tags && { allowedTags: new Set(f.allowed_tags.map((t) => TagId(t))) }),
        corruptedEssenceChance: f.corrupted_essence_chance,
        fractures: f.fractures,
    };
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
        ...(b.capDelta && { capDelta: b.capDelta }),
    };
}
