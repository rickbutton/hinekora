/**
 * Value cells: the parts of a row's span (its first number, `check/values.ts`)
 * on which every value comparison a craft makes is constant, so a modifier's
 * value is kept only as finely as some condition reads it.
 */
import type { Cmp } from "../ast/ast.js";
import type { Range } from "./range.js";

/** An interval of a row's span. A whole span (both ends whole numbers) rolls
 *  whole numbers only, so its cells are closed runs of whole numbers. */
export interface Cell {
    readonly lo: number;
    readonly hi: number;
    readonly loOpen: boolean;
    readonly hiOpen: boolean;
    readonly whole: boolean;
}

export function isWholeSpan(span: Range): boolean {
    return Number.isInteger(span[0]) && Number.isInteger(span[1]);
}

/** The span cut at the thresholds: the coarsest partition on which `v < t`,
 *  `v == t` and `v > t` are each constant for every threshold `t`. */
export function cellsOf(span: Range, thresholds: Iterable<number>): Cell[] {
    const [a, b] = span;
    const whole = isWholeSpan(span);
    const inside = [...new Set(thresholds)].filter((t) => t >= a && t <= b).sort((x, y) => x - y);
    if (whole) {
        // Each cell starts where some comparison changes its answer.
        const starts = new Set<number>([a]);
        for (const t of inside) {
            if (Number.isInteger(t)) {
                starts.add(t);
                starts.add(t + 1);
            } else starts.add(Math.ceil(t));
        }
        const sorted = [...starts].filter((s) => s >= a && s <= b).sort((x, y) => x - y);
        return sorted.map((s, i) => ({
            lo: s,
            hi: i + 1 < sorted.length ? sorted[i + 1]! - 1 : b,
            loOpen: false,
            hiOpen: false,
            whole: true,
        }));
    }
    if (a === b) return [{ lo: a, hi: b, loOpen: false, hiOpen: false, whole: false }];
    const cuts = new Set(inside);
    const points = [...new Set([a, b, ...inside])].sort((x, y) => x - y);
    const out: Cell[] = [];
    for (let i = 0; i < points.length; i++) {
        const p = points[i]!;
        if (cuts.has(p)) out.push({ lo: p, hi: p, loOpen: false, hiOpen: false, whole: false });
        const q = points[i + 1];
        if (q === undefined) continue;
        out.push({ lo: p, hi: q, loOpen: cuts.has(p), hiOpen: cuts.has(q), whole: false });
    }
    return out;
}

export function cellHas(cell: Cell, v: number): boolean {
    if (cell.whole && !Number.isInteger(v)) return false;
    const aboveLo = cell.loOpen ? v > cell.lo : v >= cell.lo;
    const belowHi = cell.hiOpen ? v < cell.hi : v <= cell.hi;
    return aboveLo && belowHi;
}

/** Every value of a whole cell; a cell of fractions has too many to list. */
export function cellValues(cell: Cell): number[] {
    if (!cell.whole) {
        throw new Error(`the values ${cellLabel(cell)} are fractions and cannot be listed`);
    }
    const out: number[] = [];
    for (let v = cell.lo; v <= cell.hi; v++) out.push(v);
    return out;
}

/** One value of the cell. */
export function cellSample(cell: Cell): number {
    if (cell.whole || !cell.loOpen) return cell.lo;
    if (!cell.hiOpen) return cell.hi;
    return (cell.lo + cell.hi) / 2;
}

/** Where the cell lies against `t`, or undefined when it straddles it. */
function regionOf(cell: Cell, t: number): "lt" | "eq" | "gt" | undefined {
    if (cell.hi < t || (cell.hi === t && cell.hiOpen)) return "lt";
    if (cell.lo > t || (cell.lo === t && cell.loOpen)) return "gt";
    if (cell.lo === t && cell.hi === t) return "eq";
    return undefined;
}

/** `v op t` for every value of the cell, or undefined when it differs between
 *  them: the threshold was not one the cells were cut at. */
export function cellCompare(cell: Cell, op: Cmp, t: number): boolean | undefined {
    const r = regionOf(cell, t);
    if (r === undefined) return undefined;
    switch (op) {
        case "==":
            return r === "eq";
        case "!=":
            return r !== "eq";
        case "<":
            return r === "lt";
        case "<=":
            return r !== "gt";
        case ">":
            return r === "gt";
        case ">=":
            return r !== "lt";
    }
}

export function cellLabel(cell: Cell): string {
    if (cell.lo === cell.hi) return `${cell.lo}`;
    return `${cell.loOpen ? "(" : "["}${cell.lo}-${cell.hi}${cell.hiOpen ? ")" : "]"}`;
}
