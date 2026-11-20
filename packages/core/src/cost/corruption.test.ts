import { describe, expect, it } from "vitest";
import { runMethod } from "../check/method.js";
import { fromItems } from "../check/state.js";
import { type BaseKind, type Catalog, generateCatalog } from "../check/reference/catalog.js";
import { harnessUniverse } from "../check/reference/harness.js";
import { type CEldritch, type CItem, cItem, NO_IMPLICIT } from "../check/reference/item.js";
import { listItems } from "../check/reference/listing.js";
import { violations } from "../check/reference/wellformed.js";
import type { ModId } from "../model/ids.js";
import { ELDRITCH_SIDES, type EldritchSide } from "../model/marks.js";
import { corruptionCases, corruptionDraw, corruptionWeights } from "./roll.js";

// The cost layer's reading of where a corruption implicit lands
// (`corruptionCases`, `corruptionDraw`) is a second copy of the checker's
// (check/ops/marks.ts `corruptionImplicit`): on every well-formed holding of a
// catalogue's implicits, the outcomes the cases give a chance are the items
// the handler leaves.

/** An item's implicits, as a corruption changes them. */
function implicitsOf(x: CItem): string {
    const vaal = [...x.corruption].sort().join("+");
    return `${x.baseImplicit ? "base" : "-"} ${x.exarch.tier}/${x.eater.tier} ${vaal}`;
}

/** The items the cases give a chance, by their implicits. */
function byCases(cat: Catalog, x: CItem): string[] {
    const pool = corruptionWeights(cat.registry, cat.base, cat.ilvl);
    if (pool.length === 0) return [implicitsOf(x)];
    const others: ("base" | EldritchSide)[] = [];
    if (x.baseImplicit) others.push("base");
    for (const side of ELDRITCH_SIDES) if (x[side].tier > 0) others.push(side);
    const out = new Set<string>();
    for (const c of corruptionCases(others, x.corruption)) {
        if (c.prob <= 0) continue;
        const kept = c.kept[0];
        const row = kept === undefined ? undefined : pool.find((r) => r.id === kept);
        for (const [id, p] of corruptionDraw(pool, row)) {
            if (p <= 0) continue;
            out.add(
                implicitsOf({
                    ...x,
                    baseImplicit: x.baseImplicit && c.gone !== "base",
                    exarch: c.gone === "exarch" ? NO_IMPLICIT : x.exarch,
                    eater: c.gone === "eater" ? NO_IMPLICIT : x.eater,
                    corruption: [...c.kept, id],
                }),
            );
        }
    }
    return [...out].sort();
}

/** The items the checker's handler leaves, by their implicits. */
function byHandler(cat: Catalog, x: CItem): string[] {
    const u = harnessUniverse(cat);
    const r = runMethod(fromItems(u, [x])!, [{ kind: "corrupt" }, { kind: "corruptionImplicit" }]);
    const out = listItems(u, r.state.dd, { lowest: true }).items();
    return [...new Set(out.map(implicitsOf))].sort();
}

/** Every well-formed holding of the catalogue's implicits. */
function holdings(cat: Catalog): CItem[] {
    const rows = cat.registry.corruptionPool(cat.base, cat.ilvl).map((c) => c.row.id);
    const sets: ModId[][] = [[], ...rows.map((r) => [r])];
    rows.forEach((a, i) => rows.slice(i + 1).forEach((b) => sets.push([a, b])));
    const eldritch = (side: EldritchSide): CEldritch[] => {
        const type = cat.eldritch.find((e) => e.side === side)?.type;
        return type === undefined ? [NO_IMPLICIT] : [NO_IMPLICIT, { tier: 2, type }];
    };
    const out: CItem[] = [];
    for (const baseImplicit of [false, true])
        for (const exarch of eldritch("exarch"))
            for (const eater of eldritch("eater"))
                for (const corruption of sets) {
                    const x = cItem({
                        baseImplicit,
                        exarch,
                        eater,
                        corruption,
                        corrupted: [false, true, "twice"][corruption.length] as CItem["corrupted"],
                    });
                    if (violations(x, cat.ctx).length === 0) out.push(x);
                }
    return out;
}

describe("a corruption implicit's cases, held to the checker's", () => {
    const configs: readonly [BaseKind, Parameters<typeof generateCatalog>[1]][] = [
        ["ring", { implicit: "own" }],
        ["boots", { eldritch: true, implicit: "own", ilvl: 84 }],
        ["amulet", { eldritch: true, ilvl: 84 }],
        ["jewel", {}],
        ["simplex", { implicit: "locked" }],
    ];
    configs.forEach(([base, options], i) => {
        it(`on ${base}`, () => {
            const cat = generateCatalog(8500 + i, {
                base,
                types: 2,
                corruption: true,
                ...options,
            });
            const items = holdings(cat);
            expect(items.length).toBeGreaterThan(0);
            for (const x of items)
                expect(byCases(cat, x), implicitsOf(x)).toEqual(byHandler(cat, x));
        });
    });
});
