/**
 * The rules the metamods set for one use of a method on one concrete item,
 * stated apart from check/rules.ts so the exactness tests hold that statement
 * to this one (operations.md §2, Metamod § Rules and Exceptions). Test
 * support.
 *
 * - A full protection keeps its side whole.
 * - A partial protection keeps that many of its side's modifiers, chosen at
 *   random each use (`QUESTIONS.md` Q128): every choice is a way the method
 *   may run, and a side holding no more than it keeps is kept whole. Two on
 *   one side may keep the count of either or both together, each a way the
 *   method may run. A full protection on the side leaves nothing to choose.
 * - A removal after an add in the same method may fall under a choice made
 *   among the modifiers present then (`QUESTIONS.md` Q128): `rechosen`.
 */
import type { Effect } from "../../model/effects.js";
import type { Gen } from "../../model/ids.js";
import type { Mod } from "../../model/mod.js";
import type { Op } from "../ops/types.js";
import type { Choice, Protection, Rules } from "../rules.js";
import { type CItem, effectsOn, type RefCtx, rowOf } from "./item.js";

const GENS: readonly Gen[] = ["prefix", "suffix"];

/** By side, each count of modifiers the item's partial protections may keep. */
function partialCounts(effects: readonly Effect[]): Map<Gen, number[]> {
    const out = new Map<Gen, number[]>();
    for (const gen of GENS) {
        if (effects.some((e) => e.kind === "protect" && e.gen === gen)) continue;
        const counts = effects.flatMap((e) =>
            e.kind === "protectSome" && e.gen === gen ? [e.count] : [],
        );
        if (counts.length === 0) continue;
        const total = counts.reduce((a, b) => a + b, 0);
        const all = counts.length > 1 ? [...counts, total] : counts;
        out.set(gen, [...new Set(all)]);
    }
    return out;
}

/** Every way to pick `n` of the items. */
function picks<T>(xs: readonly T[], n: number): T[][] {
    if (n === 0) return [[]];
    if (xs.length < n) return [];
    const [first, ...rest] = xs as [T, ...T[]];
    return [...picks(rest, n - 1).map((p) => [first, ...p]), ...picks(rest, n)];
}

/** The ways one use of a method may settle the item's partial protections,
 *  read from `partial` (a side's counts) and the item's modifiers. */
function choicesUnder(ctx: RefCtx, item: CItem, partial: ReadonlyMap<Gen, number[]>): Choice[] {
    let out: Choice[] = [{ sides: [], types: [] }];
    for (const [gen, counts] of partial) {
        const side = item.mods.map((m) => rowOf(ctx, m)).filter((r) => r.gen === gen);
        const next: Choice[] = [];
        for (const c of out) {
            for (const count of counts) {
                if (side.length <= count) next.push({ ...c, sides: [...c.sides, gen] });
                else {
                    for (const p of picks(side, count))
                        next.push({ ...c, types: [...c.types, ...p.map((r) => r.type)] });
                }
            }
        }
        const seen = new Set<string>();
        out = next.filter((c) => {
            const key = `${c.sides.join(",")}|${[...c.types].sort().join(",")}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
    }
    return out;
}

/** The ways one use of a method may settle the item's partial protections. */
export function choicesFor(ctx: RefCtx, item: CItem): Choice[] {
    return choicesUnder(ctx, item, partialCounts(effectsOn(ctx, item)));
}

function protectionOf(effects: readonly Effect[], choice: Choice): Protection {
    const full = effects.flatMap((e) => (e.kind === "protect" ? [e.gen] : []));
    return {
        sides: new Set([...full, ...choice.sides]),
        types: new Set(choice.types),
        partial: partialCounts(effects),
    };
}

function usesStrands(ops: readonly Op[]): boolean {
    return ops.some((op) =>
        op.kind === "either" ? op.branches.some(usesStrands) : op.kind === "strands",
    );
}

/** The rules of a use of the method on the item, under the choice. */
export function refRulesOf(
    ctx: RefCtx,
    item: CItem,
    ops: readonly Op[],
    choice: Choice = { sides: [], types: [] },
): Rules {
    const effects = effectsOn(ctx, item);
    return {
        protected: protectionOf(effects, choice),
        craftedCap: Math.max(
            1,
            ...effects.flatMap((e) => (e.kind === "craftedCap" ? [e.cap] : [])),
        ),
        // Any metamod but the multimod prevents an essence or a fossil
        // (Metamod § Rules and Exceptions; a partial one as a full one, Q128).
        blocksSourced: effects.some((e) => e.kind !== "craftedCap"),
        strands: usesStrands(ops),
    };
}

/** After `keep`: that side alone is kept. */
export function refKeeping(r: Rules, gen: Gen): Rules {
    return { ...r, protected: { sides: new Set([gen]), types: new Set(), partial: new Map() } };
}

/** Is the modifier on this row kept: its side whole, or its type chosen? */
export function keeps(p: Protection, row: Mod): boolean {
    return p.sides.has(row.gen) || p.types.has(row.type);
}

/** The sides a removal reaches: its own, or both, less those kept whole. */
export function reachSides(gen: Gen | undefined, p: Protection): Gen[] {
    return (gen === undefined ? GENS : [gen]).filter((g) => !p.sides.has(g));
}

/** The protections for a removal after an add, chosen among the modifiers
 *  the item holds then: the full ones, and each choice made afresh. */
export function rechosen(ctx: RefCtx, item: CItem, p: Protection): Protection[] {
    if (p.partial.size === 0) return [p];
    const full = [...p.sides].filter((g) => !p.partial.has(g));
    const partial = new Map([...p.partial].map(([g, cs]) => [g, [...cs]]));
    return choicesUnder(ctx, item, partial).map((c) => ({
        sides: new Set([...full, ...c.sides]),
        types: new Set(c.types),
        partial: p.partial,
    }));
}
