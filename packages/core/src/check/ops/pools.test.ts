import { describe, expect, it } from "vitest";
import { type DrawCase, type DrawCtx, drawAtoms, drawCases } from "./pools.js";
import type { PoolSpec } from "./types.js";
import { craft, item, op } from "../../__fixtures__/ast.js";
import { CATALOG, RING_BASE } from "../../__fixtures__/mods.js";
import { ModId } from "../../model/ids.js";
import { buildRegistry } from "../../resolve/registry.js";
import { check } from "../check.js";
import type { Dd } from "../dd.js";
import { generateCatalog } from "../reference/catalog.js";
import { harnessStates, harnessUniverse, pickRows } from "../reference/harness.js";
import { fromItems } from "../state.js";
import type { Universe } from "../universe.js";

const NATURAL: PoolSpec = { kind: "natural" };

/** Every atom cut by every case in turn: what `drawAtoms` must make. */
function fullCut(state: Dd, cases: readonly DrawCase[], u: Universe): DrawCase[] {
    const m = u.dd;
    let atoms: DrawCase[] = [{ dd: state, rows: [] }];
    for (const c of cases) {
        const next: DrawCase[] = [];
        for (const a of atoms) {
            const yes = m.and(a.dd, c.dd);
            const no = m.diff(a.dd, c.dd);
            if (yes !== m.EMPTY) next.push({ dd: yes, rows: [...a.rows, ...c.rows] });
            if (no !== m.EMPTY) next.push({ dd: no, rows: a.rows });
        }
        atoms = next;
    }
    return atoms;
}

const named = (atoms: readonly DrawCase[]) =>
    atoms.map((a) => ({ dd: a.dd, rows: a.rows.map((r) => r.id) }));

/** Whether some case meets an earlier one, and some meets none. */
function overlaps(cases: readonly DrawCase[], u: Universe): { met: boolean; apart: boolean } {
    const m = u.dd;
    let covered = m.EMPTY;
    let met = false;
    let apart = false;
    for (const c of cases) {
        if (m.and(covered, c.dd) === m.EMPTY) apart = true;
        else met = true;
        covered = m.or(covered, c.dd);
    }
    return { met, apart };
}

describe("a draw's atoms", () => {
    it("are the full cut's, in its order, on items holding memory strands", () => {
        const registry = buildRegistry({
            bases: [RING_BASE],
            mods: [...CATALOG],
            baseAliases: { "Iron Ring": "IronRing" },
        });
        const ring = item({ base: "Iron Ring", ilvl: 100, rarity: "rare", strands: 82 });
        const r = check(craft(ring, [op("chaos"), op("chaos")]), { registry });
        const { u, dd } = r.finalState!;
        const dc: DrawCtx = { u, cut: true, pools: {} };
        const cases = drawCases(dd, NATURAL, dc);
        expect(cases.length).toBeGreaterThan(1);
        expect(overlaps(cases, u).apart).toBe(true);
        expect(named(drawAtoms(dd, NATURAL, dc))).toEqual(named(fullCut(dd, cases, u)));
    });

    it("are the full cut's, in its order, where the cases overlap", () => {
        let met = 0;
        for (let seed = 9300; seed < 9306; seed++) {
            const cat = generateCatalog(seed, { types: 4, addsTag: true, influence: true });
            const u = harnessUniverse(cat);
            const sets = harnessStates(u, cat.ctx, seed, {
                // Rows offered only beside the adder's tag, or only without it,
                // make cases that meet the case of the rows offered on all.
                bounds: { rows: pickRows(u, seed, 4, [ModId("Adder1")]), rarities: ["rare"] },
                random: 6,
                maxSize: 10,
            });
            const dc: DrawCtx = { u, cut: false, pools: {} };
            for (const s of sets) {
                const dd = fromItems(u, s)!.dd;
                const cases = drawCases(dd, NATURAL, dc);
                if (overlaps(cases, u).met) met++;
                expect(named(drawAtoms(dd, NATURAL, dc))).toEqual(named(fullCut(dd, cases, u)));
            }
        }
        expect(met).toBeGreaterThan(0);
    });
});
