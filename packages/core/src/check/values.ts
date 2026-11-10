/**
 * Modifier values. A row's text carries its roll span ("+(70-84) to maximum
 * Life"); the checker reads the first number of the text as the modifier's
 * value, so a guide's "life 75 or more" is a question about that span.
 */
import type { Cmp } from "../ast/ast.js";
import { type Domain, type Range, RangeDomain } from "./domain.js";
import type { Base } from "../model/base.js";
import type { Gen, TypeId } from "../model/ids.js";

const RANGE = /\((\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)\)/;
const NUMBER = /(\d+(?:\.\d+)?)/;

/** The span of a row's first number: "+(70-84) to maximum Life" is [70, 84],
 *  "+1 to Level of all Skill Gems" is [1, 1]; a text with no number has none. */
export function rollRange(text: string): Range | undefined {
    const r = RANGE.exec(text);
    if (r) return [Number(r[1]), Number(r[2])];
    const n = NUMBER.exec(text);
    return n ? [Number(n[1]), Number(n[1])] : undefined;
}

/** A row's span as the item shows it: an experimented base's magnitude implicit
 *  scales every value of its side (`QUESTIONS.md` Q69 on the rounding). */
export function spanOn(base: Base, gen: Gen, span: Range): Range {
    const percent = base.magnitude?.[gen] ?? 0;
    if (percent === 0) return span;
    const scale = 1 + percent / 100;
    return [span[0] * scale, span[1] * scale];
}

/** The part of `span` whose values compare so, or null when none does. Whole
 *  bounds and a whole threshold make a strict comparison exact; otherwise the
 *  threshold itself stays in, a sound over-approximation. */
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

/** The comparison that holds exactly when `op` does not. */
export const NEGATED_CMP: Readonly<Record<Cmp, Cmp>> = {
    "==": "!=",
    "!=": "==",
    "<": ">=",
    "<=": ">",
    ">": "<=",
    ">=": "<",
};

/** The value overlay: for a present type, the span its value is known to lie
 *  in, narrower than its rows' spans; absent means the rows' spans. Kept only
 *  while the roll stands, so every operation that rerolls or replaces a
 *  modifier drops its entry. */
export type Values = ReadonlyMap<TypeId, Range>;

export const ValueDomain = {
    /** A type constrained in only one branch drops to its rows' spans. */
    join(a: Values, b: Values): Values {
        const out = new Map<TypeId, Range>();
        for (const [type, ra] of a) {
            const rb = b.get(type);
            if (rb !== undefined) out.set(type, RangeDomain.join(ra, rb));
        }
        return out;
    },
    equal(a: Values, b: Values): boolean {
        if (a.size !== b.size) return false;
        for (const [t, ra] of a) {
            const rb = b.get(t);
            if (rb === undefined || !RangeDomain.equal(ra, rb)) return false;
        }
        return true;
    },
} satisfies Domain<Values>;

/** `values` without the given types: what an operation that rerolled or
 *  replaced them leaves. */
export function dropValues(values: Values, gone: Iterable<TypeId>): Values {
    const out = new Map(values);
    for (const t of gone) out.delete(t);
    return out;
}

/** `values` restricted to the types `keep` admits. */
export function keepValues(values: Values, keep: (type: TypeId) => boolean): Values {
    return new Map([...values].filter(([t]) => keep(t)));
}
