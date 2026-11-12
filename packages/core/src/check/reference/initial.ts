/**
 * The items an item block describes, listed one at a time: every choice of a
 * row and a value for each declared affix, the marks as declared, an item kept
 * where it is well-formed and each `"random"` on it is a row the pool of the
 * declared item offers. The definition check/initial.ts is held to; a block
 * with a fault is not one it reads. Test support.
 *
 * What `"random"` may be is check/initial.ts `anonymousRows`, restated here
 * row by row. A natural row of the side, of the base's domain and class, at most the item's
 * level, of a type and groups no declared modifier has, with room on its side
 * at Rare caps beside the declared modifiers, allowed by the declared
 * metamods, and weighed under the base's tags, the influences' and those the
 * declared modifiers add, a tag a row so offered adds being read wherever it
 * admits a row (`lookupWeight`'s optimistic reading, to a fixpoint).
 */
import type { ItemBlock } from "../../ast/ast.js";
import type { ItemDecl } from "../item-block.js";
import { declareItem } from "../item-block.js";
import { rollRange } from "../values.js";
import { maxTotal, sideCap } from "../../model/capacity.js";
import type { Effect } from "../../model/effects.js";
import type { Gen, GroupId, TagId, TypeId } from "../../model/ids.js";
import { type EldritchSide, influenceKey } from "../../model/marks.js";
import type { Mod } from "../../model/mod.js";
import { lookupWeight } from "../../pool/pool.js";
import { rollableGen } from "../../resolve/tiers.js";
import { type CEldritch, type CItem, type CMod, cItem, NO_IMPLICIT, type RefCtx } from "./item.js";
import { CItemSet } from "./sets.js";
import { isWellFormed } from "./wellformed.js";

/** Each value of the row's span, or none for a row with no number. */
function valuesOf(row: Mod): (number | undefined)[] {
    const span = row.text === undefined ? undefined : rollRange(row.text);
    if (span === undefined) return [undefined];
    const out: number[] = [];
    for (let v = span[0]; v <= span[1]; v++) out.push(v);
    return out;
}

/** Does the pool of the declared item offer this row to a `"random"` of its side. */
function offeredBy(ctx: RefCtx, decl: ItemDecl): (row: Mod, gen: Gen) => boolean {
    const { registry } = ctx;
    const { base, ilvl } = decl;
    const types = new Set<TypeId>(decl.present);
    const families = new Set<GroupId>();
    const tags = new Set<TagId>(base.tags);
    for (const i of decl.influences) for (const t of registry.influenceTags(base, i)) tags.add(t);
    const count: Record<Gen, number> = { prefix: 0, suffix: 0 };
    const restricts: Extract<Effect, { kind: "poolRestrict" }>[] = [];
    for (const t of types) {
        count[rollableGen(registry.catalog, base, ilvl, t) ?? "prefix"]++;
        for (const f of registry.familiesOfType(t)) families.add(f);
        for (const tag of registry.addsTagsOfType(t)) tags.add(tag);
        for (const e of registry.effectsOfType(t)) if (e.kind === "poolRestrict") restricts.push(e);
    }
    const room = (gen: Gen): boolean =>
        count[gen] < sideCap(gen, "rare", base) &&
        count.prefix + count.suffix < maxTotal("rare", base);
    const fits = (m: Mod): boolean =>
        m.domain === base.domain &&
        m.minLevel <= ilvl &&
        (m.classRestriction === undefined || m.classRestriction.has(base.itemClass)) &&
        !types.has(m.type) &&
        ![...m.families].some((f) => families.has(f)) &&
        room(m.gen) &&
        restricts.every((e) => e.allows(m));
    const maybe = new Set<TagId>();
    const weighed = (m: Mod): boolean => (lookupWeight(m, tags, maybe) ?? 0) > 0;
    for (;;) {
        const before = maybe.size;
        for (const m of registry.catalog) {
            if (fits(m) && weighed(m)) for (const t of m.addsTags) maybe.add(t);
        }
        if (maybe.size === before) break;
    }
    return (row, gen) => row.gen === gen && fits(row) && weighed(row);
}

export function initialItems(ctx: RefCtx, block: ItemBlock): CItemSet {
    const faults: string[] = [];
    const decl = declareItem(block, ctx.registry, (m) => faults.push(m));
    if (decl === null || faults.length > 0) {
        throw new Error(`the block has faults: ${faults.join(" ")}`);
    }
    const c: RefCtx = { ...ctx, base: decl.base, ilvl: decl.ilvl };
    const bench = ctx.registry.benchModsFor(decl.base.itemClass);
    const choices: CMod[][] = decl.affixes.map((a) => {
        const rows =
            a.kind === "named"
                ? a.rows!
                : ctx.registry.catalog.filter(
                      (m) => m.gen === a.gen && (a.kind !== "bench" || bench.has(m.id)),
                  );
        return rows.flatMap((row) =>
            valuesOf(row).map((value) => ({
                row: row.id,
                value,
                fractured: a.fractured,
                crafted: row.source === "bench",
            })),
        );
    });
    const implicits = (side: EldritchSide): CEldritch[] => {
        const d = decl[side];
        if (d === undefined) return [NO_IMPLICIT];
        const types = [
            ...new Set(ctx.registry.eldritchRows(decl.base, side, d.tier).map((e) => e.type)),
        ];
        if (types.length === 0) return [{ tier: d.tier, type: undefined }];
        const named = d.types === undefined ? types : types.filter((t) => d.types!.has(t));
        return (named.length > 0 ? named : types).map((type) => ({ tier: d.tier, type }));
    };
    const offered = offeredBy(c, decl);
    /** Each `"random"` of the list a row the declared item's pool offers. */
    const randomsOffered = (mods: readonly CMod[]): boolean =>
        decl.affixes.every(
            (a, i) => a.kind !== "anonymous" || offered(c.rows.get(mods[i]!.row)!, a.gen),
        );
    let lists: CMod[][] = [[]];
    for (const options of choices) {
        lists = lists.flatMap((mods) =>
            options.filter((o) => !mods.some((x) => x.row === o.row)).map((o) => [...mods, o]),
        );
    }
    const out: CItem[] = [];
    for (const mods of lists) {
        if (!randomsOffered(mods)) continue;
        for (const exarch of implicits("exarch")) {
            for (const eater of implicits("eater")) {
                const item = cItem({
                    rarity: decl.rarity,
                    mods,
                    influences: influenceKey(decl.influences),
                    corrupted: decl.corrupted,
                    exarch,
                    eater,
                    strands: decl.strands ?? 0,
                });
                if (isWellFormed(item, c)) out.push(item);
            }
        }
    }
    return CItemSet.of(out);
}
