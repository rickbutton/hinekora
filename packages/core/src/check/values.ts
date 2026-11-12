/**
 * Modifier values. A row's text carries its roll span ("+(70-84) to maximum
 * Life"); the checker reads the first number of the text as the modifier's
 * value, so a craft's "life 75 or more" is a question about that span.
 */
import type { Cmp } from "../ast/ast.js";
import type { Range } from "./range.js";

/** The first number of a text: a rolled span "(70-84)" or a fixed "3". */
const FIRST_NUMBER = /\((\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)\)|(\d+(?:\.\d+)?)/;

/** The span of a row's first number: "+(70-84) to maximum Life" is [70, 84],
 *  "+1 to Level of all Skill Gems" is [1, 1] and so is the fixed 3 of "Adds 3
 *  to (46-53) Lightning Damage"; a text with no number has none. A "reduced"
 *  row writes its span high to low, "(30-27)% reduced", which reads [27, 30]. */
export function rollRange(text: string): Range | undefined {
    const m = FIRST_NUMBER.exec(text);
    if (m === null) return undefined;
    if (m[3] !== undefined) return [Number(m[3]), Number(m[3])];
    const a = Number(m[1]);
    const b = Number(m[2]);
    return [Math.min(a, b), Math.max(a, b)];
}

/** The part of `span` whose values compare so, or null when none does. Whole
 *  bounds and a whole threshold make a strict comparison exact; otherwise the
 *  threshold itself stays in. */
export function narrowRange(span: Range, op: Cmp, v: number): Range | null {
    const [lo, hi] = span;
    const whole = Number.isInteger(lo) && Number.isInteger(hi) && Number.isInteger(v);
    const below = whole ? v - 1 : v;
    const above = whole ? v + 1 : v;
    switch (op) {
        case "==":
            return lo <= v && v <= hi ? [v, v] : null;
        case "!=":
            return lo === v && hi === v ? null : span;
        case "<":
            return lo < v ? [lo, Math.min(hi, below)] : null;
        case "<=":
            return lo <= v ? [lo, Math.min(hi, v)] : null;
        case ">":
            return hi > v ? [Math.max(lo, above), hi] : null;
        case ">=":
            return hi >= v ? [Math.max(lo, v), hi] : null;
    }
}
