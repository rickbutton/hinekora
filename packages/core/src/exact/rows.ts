/**
 * The candidate rows: every modifier row that can be on an item of the base by
 * any source a craft can use. Too many only costs the state's size; one too
 * few would leave an item no slot can hold, so each source is read wide.
 */
import type { Craft } from "../ast/ast.js";
import type { Base } from "../model/base.js";
import { effectsOf } from "../model/effects.js";
import type { TagId } from "../model/ids.js";
import { INFLUENCES } from "../model/marks.js";
import type { Mod } from "../model/mod.js";
import { ELEMENTS } from "../model/sources.js";
import { isUnveiledResult, isVeiledPlaceholder } from "../model/veiled.js";
import { isTwinOn } from "../check/methods.js";
import { lookupWeight } from "../pool/pool.js";
import type { Registry } from "../resolve/registry.js";
import { tierLadder } from "../resolve/tiers.js";
import {
    ALL_REACH,
    type CraftReach,
    craftReach,
    declaredRows,
    nameTagSets,
    type ReachSource,
} from "./craft.js";

/** Which source admitted a row, for the measurements and the tests. */
export type RowSource =
    | "natural"
    | "bench"
    | "metamod"
    | "essence"
    | "veiled"
    | "fossil"
    | "elevated"
    | "aspect"
    | "declared"
    | "harvest";

const classPermitted = (m: Mod, base: Base): boolean =>
    m.classRestriction === undefined || m.classRestriction.has(base.itemClass);

/** Positive under the tags, reading a tag the item may carry as present
 *  wherever that admits the row (`lookupWeight`'s optimistic reading). */
const rolls = (m: Mod, tags: ReadonlySet<TagId>, maybe: ReadonlySet<TagId>): boolean =>
    (lookupWeight(m, tags, maybe) ?? 0) > 0;

/**
 * The rows, each with the first source that admits it, of the sources the
 * craft's steps and item block reach (`craftReach`; every source with no
 * craft), since a row no step can lay down is on no item of the check:
 * - natural rows of the base's domain that roll at some item level, under any
 *   influence the class takes and any tag a row so admitted adds (to a
 *   fixpoint, as `check/ops.ts` `addableMods` reads tags);
 * - the bench's rows for the class, and every metamod (the Bestiary crafts one
 *   on any class);
 * - every essence's row for the class, the corrupted essences' among them;
 * - the two plain veiled placeholders and the unveiled rows that roll on the base;
 * - the fossils' added and forced rows for the base;
 * - the elevated rows an influence of the class names (the Orb of Dominance);
 * - the Bestiary's Aspect rows;
 * - every row the item block declares;
 * - where the craft has a Harvest change, to a fixpoint, every row it can
 *   make of these.
 * A natural row of another domain is left out: no item holds one
 * (item-model.md §8 "Natural affix domain matches base").
 */
export function candidateRows(
    registry: Registry,
    base: Base,
    ilvl: number,
    craft: Craft | undefined,
): Map<Mod, RowSource> {
    const reach = craft === undefined ? ALL_REACH : craftReach(craft);
    const common = commonRows(registry, base);
    const reached = reachedRows(registry, base, common, reach);
    const out = new Map(reached);
    if (craft === undefined) return out;
    const add = adder(base, out);
    for (const m of declaredRows(craft, registry, base, ilvl)) add(m, "declared");
    if (reach.changes && out.size > reached.size) {
        closeUnderHarvestChange(registry, base, common.influenceTags, out, add, [
            ...reached.keys(),
        ]);
    }
    return out;
}

const adder =
    (base: Base, out: Map<Mod, RowSource>) =>
    (m: Mod | undefined, source: RowSource): void => {
        if (m === undefined || out.has(m)) return;
        if ((m.source ?? "natural") === "natural" && m.domain !== base.domain) return;
        out.set(m, source);
    };

/** The order the sources are read in, which names a row read by several. */
const SOURCES: readonly ReachSource[] = [
    "bench",
    "metamod",
    "essence",
    "veiled",
    "fossil",
    "elevated",
    "aspect",
];

interface CommonRows {
    readonly natural: readonly Mod[];
    readonly bySource: ReadonlyMap<ReachSource, readonly Mod[]>;
    readonly influenceTags: ReadonlySet<TagId>;
    /** By what a craft reaches, its rows: the sources it reaches, closed
     *  under the Harvest change where it changes one. */
    readonly reached: Map<string, ReadonlyMap<Mod, RowSource>>;
}

/** Every check on the base reads these, whatever its craft or item level:
 *  held per registry. */
const commonCache = new WeakMap<Registry, WeakMap<Base, CommonRows>>();

function reachedRows(
    registry: Registry,
    base: Base,
    common: CommonRows,
    reach: CraftReach,
): ReadonlyMap<Mod, RowSource> {
    const key = `${SOURCES.filter((x) => reach.sources.has(x)).join(",")}|${reach.changes ? 1 : 0}`;
    const hit = common.reached.get(key);
    if (hit !== undefined) return hit;
    const out = new Map<Mod, RowSource>();
    const add = adder(base, out);
    for (const m of common.natural) add(m, "natural");
    for (const x of SOURCES) {
        if (reach.sources.has(x)) for (const m of common.bySource.get(x) ?? []) add(m, x);
    }
    if (reach.changes) closeUnderHarvestChange(registry, base, common.influenceTags, out, add, []);
    common.reached.set(key, out);
    return out;
}

/** The rows of each source on the base. */
function commonRows(registry: Registry, base: Base): CommonRows {
    let byBase = commonCache.get(registry);
    if (byBase === undefined) commonCache.set(registry, (byBase = new WeakMap()));
    const hit = byBase.get(base);
    if (hit !== undefined) return hit;
    const catalog = registry.catalog;
    const byId = new Map(catalog.map((m) => [m.id as string, m]));
    const bySource = new Map<ReachSource, Mod[]>(SOURCES.map((x) => [x, []]));
    const add = (m: Mod | undefined, x: ReachSource): void => {
        if (m !== undefined) bySource.get(x)!.push(m);
    };

    const influenceTags = new Set<TagId>();
    for (const i of INFLUENCES)
        for (const t of registry.influenceTags(base, i)) influenceTags.add(t);
    const maybe = new Set<TagId>(influenceTags);
    let natural: Mod[] = [];
    for (;;) {
        natural = catalog.filter(
            (m) =>
                (m.source ?? "natural") === "natural" &&
                m.domain === base.domain &&
                classPermitted(m, base) &&
                rolls(m, base.tags, maybe),
        );
        const before = maybe.size;
        for (const m of natural) for (const t of m.addsTags) maybe.add(t);
        if (maybe.size === before) break;
    }

    for (const id of registry.benchModsFor(base.itemClass)) add(byId.get(id), "bench");
    for (const m of catalog) if (effectsOf(m).length > 0) add(m, "metamod");
    for (const e of registry.essences) {
        const id = e.grants.get(base.itemClass);
        if (id !== undefined) add(byId.get(id), "essence");
    }
    for (const m of catalog) {
        // The veiled orbs' pool names the placeholder types only (check/ops.ts
        // PoolSpec "veiledPlaceholder"); what they lay down is the plain row
        // whose id is its type's, not a Betrayal member's own placeholder.
        if (isVeiledPlaceholder(m.type)) {
            if ((m.id as string) === m.type) add(m, "veiled");
        } else if (isUnveiledResult(m) && classPermitted(m, base) && rolls(m, base.tags, maybe)) {
            add(m, "veiled");
        }
    }
    for (const name of registry.fossilNames) {
        const f = registry.resolveFossil(name);
        if (!f.ok) continue;
        for (const id of f.value.addedMods) {
            const m = byId.get(id);
            if (m !== undefined && rolls(m, base.tags, maybe)) add(m, "fossil");
        }
        const allowed = f.value.allowedTags;
        if (allowed === undefined || [...allowed].some((t) => base.tags.has(t))) {
            for (const id of f.value.forcedMods) add(byId.get(id), "fossil");
        }
    }
    for (const m of catalog) {
        if (m.source === "elevated" && m.spawn.some((w) => influenceTags.has(w.tag))) {
            add(m, "elevated");
        }
    }
    for (const name of registry.aspectNames) {
        for (const level of [20, 30] as const) {
            const r = registry.resolveAspect(name, level);
            if (r.ok) add(r.value, "aspect");
        }
    }
    const made: CommonRows = { natural, bySource, influenceTags, reached: new Map() };
    byBase.set(base, made);
    return made;
}

/**
 * Add what a Harvest change can make of every candidate row, to a fixpoint (a
 * row it makes may be changed again), by the row selection of check/methods.ts
 * `harvestChange`: a natural row becomes a row of the target's ladders on the
 * base; a row of another source becomes the target's rows of the same source,
 * level, side and domain that the source puts on the item (`isTwinOn`, under
 * any influence the class takes), and may also become a row of the target's
 * ladders. The rows of `closed` are already closed: what they make is in.
 */
function closeUnderHarvestChange(
    registry: Registry,
    base: Base,
    influenceTags: ReadonlySet<TagId>,
    out: ReadonlyMap<Mod, RowSource>,
    add: (m: Mod | undefined, source: RowSource) => void,
    closed: readonly Mod[],
): void {
    const none = new Set<TagId>();
    const tagSets = nameTagSets(registry, base);
    const done = new Set<Mod>(closed);
    for (;;) {
        const todo = [...out.keys()].filter((m) => !done.has(m));
        if (todo.length === 0) return;
        for (const was of todo) {
            done.add(was);
            const change = registry.harvestChangeOf(was.type);
            if (change === undefined) continue;
            for (const element of ELEMENTS) {
                if (element === change.element) continue;
                const to = registry.harvestChangeTarget(was.type, element);
                if (to === undefined) continue;
                for (const tags of tagSets) {
                    for (const m of tierLadder(registry.catalog, base, to, tags)) add(m, "harvest");
                }
                if ((was.source ?? "natural") === "natural") continue;
                for (const m of registry.catalog) {
                    if (
                        m.type === to &&
                        m.source === was.source &&
                        m.minLevel === was.minLevel &&
                        m.domain === was.domain &&
                        m.gen === was.gen &&
                        isTwinOn(was, m, base, registry, none, influenceTags)
                    ) {
                        add(m, "harvest");
                    }
                }
            }
        }
    }
}
