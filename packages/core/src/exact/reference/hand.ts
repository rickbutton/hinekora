/**
 * A hand-built catalogue whose items the tests write out by hand: each row is
 * shaped to isolate one well-formedness rule or one condition.
 */
import {
    AMULET_BASE,
    BOOTS_BASE,
    DOMAIN_ITEM,
    RING_BASE,
    TAG_DEFAULT,
} from "../../__fixtures__/mods.js";
import type { Base } from "../../model/base.js";
import { BaseId, ClassId, Domain, TagId } from "../../model/ids.js";
import type { Mod } from "../../model/mod.js";
import type { EldritchImplicitSpec } from "../../model/sources.js";
import { buildRegistry, type Registry } from "../../resolve/registry.js";
import {
    benchCraft,
    benchRow,
    eldritchLadders,
    metamod,
    modRow,
    VEILED_PLACEHOLDERS,
} from "./catalog.js";
import { refCtx, type RefCtx } from "./item.js";

export const LIFE1 = modRow({
    id: "Life1",
    type: "TypeLife",
    gen: "prefix",
    families: ["Life"],
    text: "+(10-12) to maximum Life",
});
export const LIFE2 = modRow({
    id: "Life2",
    type: "TypeLife",
    gen: "prefix",
    families: ["Life"],
    minLevel: 50,
    text: "+(20-21) to maximum Life",
});
export const MANA = modRow({
    id: "Mana1",
    type: "TypeMana",
    gen: "prefix",
    families: ["Mana"],
    text: "+(5-6) to maximum Mana",
});
export const ARMOUR = modRow({
    id: "Armour1",
    type: "TypeArmour",
    gen: "prefix",
    families: ["Defences"],
    text: "+3 to Armour",
});
export const BLANK = modRow({
    id: "Blank1",
    type: "TypeBlank",
    gen: "prefix",
    families: ["Blank"],
    text: "Grants Blankness",
});
export const FIRE = modRow({
    id: "Fire1",
    type: "TypeFire",
    gen: "suffix",
    families: ["ResFire"],
    text: "+(7-9)% to Fire Resistance",
});
export const FIRE_CHAOS = modRow({
    id: "FireChaos1",
    type: "TypeFireChaos",
    gen: "suffix",
    families: ["ResFire", "ResChaos"],
    text: "+(4-5)% to Fire and Chaos Resistances",
});
export const COLD = modRow({
    id: "Cold1",
    type: "TypeCold",
    gen: "suffix",
    families: ["ResCold"],
    text: "+(7-8)% to Cold Resistance",
});
export const LIGHTNING = modRow({
    id: "Lightning1",
    type: "TypeLightning",
    gen: "suffix",
    families: ["ResLightning"],
    text: "+(7-8)% to Lightning Resistance",
});
export const FLASKY = modRow({
    id: "Flasky1",
    type: "TypeFlasky",
    gen: "prefix",
    domain: Domain("flask"),
    text: "+(1-2) to Flasking",
});
export const HUNTER = modRow({
    id: "Hunter1",
    type: "TypeHunter",
    gen: "suffix",
    text: "+(1-2) to Hunting",
    spawn: [{ tag: TagId("ring_basilisk"), weight: 500 }],
});
export const BENCH_LIFE = benchRow("BenchLife1", LIFE1, "+(15-16) to maximum Life");
export const BENCH_MANA = benchRow("BenchMana1", MANA, "+(7-8) to maximum Mana");
export const BENCH_COLD = benchRow("BenchCold1", COLD, "+(9-10)% to Cold Resistance");
export const MULTIMOD = metamod("multimod");
export const [VEILED_P, VEILED_S] = VEILED_PLACEHOLDERS as [Mod, Mod];

export const HAND_MODS: readonly Mod[] = [
    LIFE1,
    LIFE2,
    MANA,
    ARMOUR,
    BLANK,
    FIRE,
    FIRE_CHAOS,
    COLD,
    LIGHTNING,
    FLASKY,
    HUNTER,
    BENCH_LIFE,
    BENCH_MANA,
    BENCH_COLD,
    MULTIMOD,
    VEILED_P,
    VEILED_S,
];

/** A helmet: it takes an eldritch implicit, but the catalogue names none. */
export const HELMET_BASE: Base = {
    id: BaseId("IronHat"),
    itemClass: ClassId("Helmet"),
    domain: DOMAIN_ITEM,
    tags: new Set([TAG_DEFAULT, TagId("helmet")]),
};

/** Full ladders: two Exarch implicits and one Eater on boots, one of each on amulets. */
const HAND_ELDRITCH: readonly EldritchImplicitSpec[] = [
    ...eldritchLadders("exarch", ["MoveSpeed", "LifeRegen"], "boots"),
    ...eldritchLadders("eater", ["ChaosRes"], "boots"),
    ...eldritchLadders("exarch", ["AmuletExarch"], "amulet"),
    ...eldritchLadders("eater", ["AmuletEater"], "amulet"),
];

export const HAND_REGISTRY: Registry = buildRegistry({
    bases: [RING_BASE, AMULET_BASE, BOOTS_BASE, HELMET_BASE],
    mods: HAND_MODS,
    benchCrafts: [BENCH_LIFE, BENCH_MANA, BENCH_COLD, MULTIMOD].flatMap((m) => [
        benchCraft(m, RING_BASE.itemClass),
        benchCraft(m, BOOTS_BASE.itemClass),
    ]),
    eldritch: HAND_ELDRITCH,
});

export function handCtx(base: Base = RING_BASE, ilvl = 84): RefCtx {
    return refCtx(HAND_REGISTRY, base, ilvl);
}
