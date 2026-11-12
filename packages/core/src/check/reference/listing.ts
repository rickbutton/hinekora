/**
 * The concrete items of a diagram over a universe. Test support only: the
 * core invariant forbids listing items anywhere else.
 */
import { cellValues } from "../cells.js";
import type { Dd } from "../dd.js";
import type { CItem } from "../item.js";
import type { ModValue, Universe } from "../universe.js";
import { CItemSet } from "./sets.js";

export interface ListOptions {
    /** Read each cell at its lowest value only, to keep a listing small. */
    readonly lowest?: boolean;
}

/** Every assignment of `dd`, a slot the diagram skips taking each of its values. */
export function assignmentsOf(u: Universe, dd: Dd): number[][] {
    const m = u.dd;
    const out: number[][] = [];
    const x = new Array<number>(m.numSlots).fill(0);
    const walk = (n: Dd, slot: number): void => {
        if (n === m.EMPTY) return;
        if (slot === m.numSlots) {
            out.push([...x]);
            return;
        }
        const tested = m.top(n) === slot;
        for (let v = 0; v < m.domains[slot]!; v++) {
            x[slot] = v;
            walk(tested ? m.child(n, v) : n, slot + 1);
        }
    };
    walk(dd, 0);
    return out;
}

/** Every concrete item of an assignment: a cell stands for each value in it. */
export function decode(u: Universe, a: readonly number[], options: ListOptions = {}): CItem[] {
    const slots = [...u.modSlots(), ...(u.imprint && a[u.held!] === 1 ? u.modSlots(true) : [])];
    const choices: { slot: number; values: number[] }[] = [];
    for (const slot of slots) {
        const v = u.modValue(slot, a[slot] ?? 0);
        if (v?.cell === undefined) continue;
        const values = cellValues(v.cell);
        choices.push({ slot, values: options.lowest ? values.slice(0, 1) : values });
    }
    let picks = [new Map<number, number>()];
    for (const { slot, values } of choices) {
        picks = picks.flatMap((p) => values.map((n) => new Map(p).set(slot, n)));
    }
    return picks.map((p) => u.decodeOne(a, (_v: ModValue, slot) => p.get(slot)!));
}

export function listItems(u: Universe, dd: Dd, options: ListOptions = {}): CItemSet {
    return CItemSet.of(assignmentsOf(u, dd).flatMap((a) => decode(u, a, options)));
}
