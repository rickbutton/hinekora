/**
 * The item block as the exact checker's first state: the set of concrete
 * items it describes (language.md §1), read from what check/item-block.ts
 * `declareItem` declares.
 *
 * - The base, level, rarity, corruption, influences, eldritch implicits and
 *   memory strands are one value each; an implicit named by its wording is
 *   one of the implicits that wording covers at its tier, else any.
 * - A named affix is at one of its rows, any value of the row, fractured
 *   where the block says so and crafted where its row is the bench's.
 * - A `"random"` affix is some natural modifier of its side the item could
 *   roll (`anonymousRows`), a `bench "random"` some bench modifier of its
 *   side; each distinct from every other modifier, the groups and caps held
 *   by the well-formed items.
 *
 * Where the block has a fault (reported by `declareItem`), the items are
 * those the craft can go on from: affixes past the caps and those clashing
 * with an earlier one left out, a name that did not resolve read as a
 * `"random"` of its side, a mark the item cannot carry dropped. That is
 * recovery, not a fact of the game (docs/ARCHITECTURE.md §4.4).
 */
import type { Craft } from "../ast/ast.js";
import type { Diag } from "./defs.js";
import { declareItem, type DeclaredAffix, type ItemDecl } from "./item-block.js";
import { canBeRare } from "../model/capacity.js";
import type { Effect } from "../model/effects.js";
import type { Gen, GroupId, TagId, TypeId } from "../model/ids.js";
import type { ItemFacts } from "../model/item.js";
import {
    AMULET_ELDRITCH_TOP_TIER,
    canHaveEldritch,
    ELDRITCH_ITEM_LEVEL,
    type EldritchSide,
    influenceKey,
    isEldritchAmulet,
    NO_INFLUENCE,
} from "../model/marks.js";
import type { Mod } from "../model/mod.js";
import { pool } from "../pool/pool.js";
import type { Registry } from "../resolve/registry.js";
import { rollableGen } from "../resolve/tiers.js";
import { craftReach, shapeKey } from "./craft.js";
import type { Dd } from "./dd.js";
import { stateOf, type XItem } from "./state.js";
import {
    buildUniverse,
    type ModValue,
    type Universe,
    universeFor,
    type UniverseOptions,
} from "./universe.js";

/**
 * The rows a `"random"` affix of the side may be: the natural pool of the
 * item the block declares, at its level: the declared modifiers'
 * types, groups, tags and metamods held as present, at Rare caps, a tag a row
 * of the pool may add read wherever it admits another (to a fixpoint). The
 * declared types are `types`, by default every type the block names; a block
 * past its caps reads those of the affixes it holds (`heldAffixes`).
 */
export function anonymousRows(
    registry: Registry,
    decl: ItemDecl,
    gen: Gen,
    types: ReadonlySet<TypeId> = decl.present,
): readonly Mod[] {
    const { base, ilvl } = decl;
    const families = new Set<GroupId>();
    const tags = new Set<TagId>(base.tags);
    for (const i of decl.influences) for (const t of registry.influenceTags(base, i)) tags.add(t);
    let prefixCount = 0;
    let suffixCount = 0;
    const effects: Effect[] = [];
    for (const t of types) {
        if ((rollableGen(registry.catalog, base, ilvl, t) ?? "prefix") === "prefix") prefixCount++;
        else suffixCount++;
        for (const f of registry.familiesOfType(t)) families.add(f);
        for (const tag of registry.addsTagsOfType(t)) tags.add(tag);
        effects.push(...registry.effectsOfType(t));
    }
    const facts: ItemFacts = {
        base,
        ilvl,
        rarity: "rare",
        prefixCount,
        suffixCount,
        types,
        families,
        tags,
        effects,
    };
    const maybe = new Set<TagId>();
    let candidates = pool(registry.catalog, facts, maybe);
    for (;;) {
        const before = maybe.size;
        for (const c of candidates) for (const tag of c.mod.addsTags) maybe.add(tag);
        if (maybe.size === before) break;
        candidates = pool(registry.catalog, facts, maybe);
    }
    return candidates.map((c) => c.mod).filter((m) => m.gen === gen);
}

/** The bench's rows for the item's class on the side: what `bench "random"` may be. */
export function benchRowsOf(registry: Registry, decl: ItemDecl, gen: Gen): readonly Mod[] {
    const ids = registry.benchModsFor(decl.base.itemClass);
    return registry.catalog.filter((m) => ids.has(m.id) && m.gen === gen);
}

/**
 * The affixes the items hold, in the block's order: those within the caps
 * as `declareItem` counted them, an affix whose type or group an earlier one
 * claims left out, a name that did not resolve as a `"random"` of its side.
 * Each with the rows it may be.
 */
export function heldAffixes(
    registry: Registry,
    decl: ItemDecl,
): { readonly affix: DeclaredAffix; readonly rows: readonly Mod[] }[] {
    const kept = { prefix: decl.prefixCount, suffix: decl.suffixCount };
    const types = new Set<TypeId>();
    const families = new Set<GroupId>();
    const held: DeclaredAffix[] = [];
    for (const affix of decl.affixes) {
        if (kept[affix.gen] === 0) continue;
        kept[affix.gen]--;
        if (affix.kind === "named") {
            const type = affix.type!;
            const fams = registry.familiesOfType(type);
            if (types.has(type) || [...fams].some((f) => families.has(f))) continue;
            types.add(type);
            for (const f of fams) families.add(f);
            held.push(affix);
        } else held.push(affix.kind === "unknown" ? { ...affix, kind: "anonymous" } : affix);
    }
    return held.map((affix) => ({
        affix,
        rows:
            affix.kind === "named"
                ? (affix.rows ?? registry.catalog.filter((m) => m.type === affix.type))
                : affix.kind === "bench"
                  ? benchRowsOf(registry, decl, affix.gen)
                  : anonymousRows(registry, decl, affix.gen, types),
    }));
}

/** The influences the items carry: none where the class takes none. */
function influenceValue(u: Universe, decl: ItemDecl): number {
    return u.influenceValue(influenceKey(decl.influences)) ?? u.influenceValue(NO_INFLUENCE)!;
}

/** The set of items the item block describes, over a universe built for it;
 *  null when there are none (a block whose faults leave no item). */
export function initialItem(u: Universe, decl: ItemDecl): XItem | null {
    const m = u.dd;
    const { registry } = u;
    const influence = influenceValue(u, decl);
    const influenced = u.influenceKeys[influence] !== NO_INFLUENCE;
    const held = heldAffixes(registry, decl);
    const heldTypes = new Set(
        held.flatMap(({ affix }) => (affix.kind === "named" ? [affix.type!] : [])),
    );
    // A fractured modifier on an influenced item is reported; the influence stays.
    const fracture = (a: DeclaredAffix): boolean => a.fractured && !influenced;

    // The values each affix may take, by slot.
    const optionsOf = (a: DeclaredAffix, rows: readonly Mod[]): Map<number, Set<number>> => {
        const keep = (v: ModValue): boolean =>
            v.fractured === fracture(a) && v.crafted === (v.row.source === "bench");
        const out = new Map<number, Set<number>>();
        for (const [slot, values] of u.rowValues(
            rows.map((r) => r.id),
            false,
            keep,
        )) {
            out.set(slot, new Set(values));
        }
        return out;
    };
    const named = new Map<number, Set<number>>();
    const anonymous: Map<number, Set<number>>[] = [];
    for (const { affix, rows } of held) {
        const options = optionsOf(affix, rows);
        const slot = affix.kind === "named" ? u.slotOfType(affix.type!) : undefined;
        if (slot !== undefined && options.has(slot) && !named.has(slot)) {
            named.set(slot, options.get(slot)!);
        } else if (affix.kind === "named") {
            // A named row no item of the base can hold: a natural row of another
            // domain, reported. Read as a modifier of its side.
            anonymous.push(
                optionsOf(
                    { ...affix, kind: "anonymous" },
                    anonymousRows(registry, decl, affix.gen, heldTypes),
                ),
            );
        } else anonymous.push(options);
    }
    let dd = m.and(modsDiagram(u, named, anonymous), scalars(u, decl, influence, influenced));
    dd = m.and(dd, u.wfWithImprint);
    if (u.held !== undefined) dd = m.and(dd, m.slotIn(u.held, [0]));
    return stateOf(u, dd);
}

/**
 * The modifier slots: each named slot one of its values, every other slot
 * absent or holding one of the anonymous affixes, each of those placed once.
 * Which anonymous affix a value is may be open, so the automaton keeps every
 * way the affixes still unplaced can be counted.
 */
function modsDiagram(
    u: Universe,
    named: ReadonlyMap<number, ReadonlySet<number>>,
    anonymous: readonly ReadonlyMap<number, ReadonlySet<number>>[],
): Dd {
    // Affixes with the same options are interchangeable: one count each.
    const classes: { options: ReadonlyMap<number, ReadonlySet<number>>; count: number }[] = [];
    const keyOf = (o: ReadonlyMap<number, ReadonlySet<number>>): string =>
        [...o]
            .sort(([a], [b]) => a - b)
            .map(([s, vs]) => `${s}:${[...vs].sort((x, y) => x - y).join(",")}`)
            .join("|");
    const byKey = new Map<string, number>();
    for (const o of anonymous) {
        const k = keyOf(o);
        const i = byKey.get(k);
        if (i === undefined) {
            byKey.set(k, classes.length);
            classes.push({ options: o, count: 1 });
        } else classes[i]!.count++;
    }
    type Counts = readonly number[];
    const vecKey = (v: Counts): string => v.join(",");
    return u.dd.automaton<readonly Counts[]>({
        init: [classes.map((c) => c.count)],
        slots: u.modSlots(),
        step: (slot, value, state) => {
            const fixed = named.get(slot);
            if (fixed !== undefined) return fixed.has(value) ? state : undefined;
            if (value === 0) return state;
            const next = new Map<string, Counts>();
            for (const v of state) {
                classes.forEach((c, i) => {
                    if (v[i]! > 0 && c.options.get(slot)?.has(value) === true) {
                        const w = v.map((n, j) => (j === i ? n - 1 : n));
                        next.set(vecKey(w), w);
                    }
                });
            }
            return next.size === 0 ? undefined : [...next.values()];
        },
        accept: (state) => state.some((v) => v.every((n) => n === 0)),
        key: (state) => state.map(vecKey).sort().join(";"),
    });
}

/** The rarity, the marks and the strands, each fixed. */
function scalars(u: Universe, decl: ItemDecl, influence: number, influenced: boolean): Dd {
    const m = u.dd;
    const { base, ilvl, registry } = u;
    // A rarity the base cannot have is reported; the item is read as Magic.
    const rarity = decl.rarity === "rare" && !canBeRare(base) ? "magic" : decl.rarity;
    let dd = m.and(
        m.slotIn(u.scalar("rarity"), [u.rarityValue(rarity)]),
        m.slotIn(u.scalar("corrupted"), [decl.corrupted ? 1 : 0]),
    );
    dd = m.and(dd, m.slotIn(u.scalar("influences"), [influence]));
    dd = m.and(dd, m.slotIn(u.scalar("strands"), [decl.strands ?? 0]));
    const takes = canHaveEldritch(base) && ilvl >= ELDRITCH_ITEM_LEVEL && !influenced;
    for (const side of ["exarch", "eater"] as const satisfies readonly EldritchSide[]) {
        const implicit = decl[side];
        let tier = takes && implicit !== undefined ? implicit.tier : 0;
        if (isEldritchAmulet(base)) {
            if (side === "eater" && decl.exarch !== undefined) tier = 0;
            tier = Math.min(tier, AMULET_ELDRITCH_TOP_TIER);
        }
        dd = m.and(dd, m.slotIn(u.scalar(`${side}Tier`), [tier]));
        const names = u.eldritchTypes(side);
        const atTier = new Set(registry.eldritchRows(base, side, tier).map((e) => e.type));
        const wanted = implicit?.types;
        // A wording that names no implicit of the tier on the base is read as
        // any implicit of the tier.
        const named =
            tier > 0 && wanted !== undefined && [...wanted].some((t) => atTier.has(t))
                ? wanted
                : undefined;
        if (named !== undefined) {
            const values: number[] = [];
            names.forEach((t, i) => {
                if (t !== undefined && named.has(t)) values.push(i);
            });
            dd = m.and(dd, m.slotIn(u.scalar(`${side}Type`), values));
        }
    }
    return dd;
}

/** The universe and the first state of a craft. */
export interface CraftStart {
    readonly u: Universe;
    readonly decl: ItemDecl;
    /** Null where the block's faults leave no item. */
    readonly state: XItem | null;
}

/**
 * The item block read, its universe built and its items: what the exact
 * checker starts a craft from. The block's faults are reported through
 * `diag`; null when its base does not resolve. With no options the universe
 * of an earlier check that reads the same is reused (`universeFor`), and the
 * items of an item block met on it before.
 */
export function startOf(
    registry: Registry,
    craft: Craft,
    diag: Diag,
    options: UniverseOptions = {},
): CraftStart | null {
    const decl = declareItem(craft.item, registry, diag);
    if (decl === null) return null;
    if (options.maxNodes !== undefined || options.imprint !== undefined) {
        const reach = craftReach(craft);
        const u = buildUniverse(registry, decl.base, decl.ilvl, craft, {
            fractures: reach.fractures,
            craftedNatural: reach.changes,
            ...options,
        });
        return { u, decl, state: initialItem(u, decl) };
    }
    const u = universeFor(registry, decl.base, decl.ilvl, craft);
    let byBlock = initials.get(u);
    if (byBlock === undefined) initials.set(u, (byBlock = new Map<string, XItem | null>()));
    const key = shapeKey(craft.item);
    let state = byBlock.get(key);
    if (state === undefined) byBlock.set(key, (state = initialItem(u, decl)));
    return { u, decl, state };
}

const initials = new WeakMap<Universe, Map<string, XItem | null>>();
