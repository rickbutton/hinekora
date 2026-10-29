/**
 * Which method statement a position belongs to. The editor features see a
 * flat token stream (or the pieces of a half-typed line), where statements
 * follow one another with no separator and sit inside `if` and `until`
 * bodies, so a statement does not open its line: the method is the nearest
 * run of words before the position that the table knows, provided its
 * argument slots reach that far.
 */
import { findMethod, type Method } from "@hinekora/core";

/** What the lookup needs of a token: its text when it is a word, and whether
 *  it ends a statement's reach (punctuation, a control or predicate word). */
export interface Atom {
    readonly word?: string;
    readonly stop?: boolean;
}

export interface MethodAt {
    readonly method: Method;
    /** Index of the method's first word. */
    readonly start: number;
    /** How many words the method takes. */
    readonly words: number;
}

/** Words that open a header, a control statement or a predicate; no method's argument. */
const STOP_WORDS = new Set([
    "craft",
    "item",
    "def",
    "if",
    "until",
    "else",
    "restart",
    "has",
    "fractured",
    "not",
    "and",
    "or",
]);

/** The most argument tokens a method can take. */
function argReach(method: Method): number {
    return method.args.reduce((n, s) => n + (s.kind === "names" ? s.max : 1), 0);
}

/**
 * The method statement that reaches position `i`: the atom at `i`, or the
 * position after the last atom when `i` is `atoms.length`.
 */
export function methodAt(atoms: readonly Atom[], i: number): MethodAt | undefined {
    for (let s = Math.min(i, atoms.length - 1); s >= 0; s--) {
        const a = atoms[s]!;
        if (a.stop || (a.word !== undefined && STOP_WORDS.has(a.word))) return undefined;
        if (a.word === undefined) continue;
        const found = methodStartingAt(atoms, s);
        if (found === undefined) continue;
        return i - found.start - found.words <= argReach(found.method) ? found : undefined;
    }
    return undefined;
}

/** The method whose last word is at `s`: a two-word method first, so that
 *  `veiled chaos` is not read as the Chaos Orb. */
function methodStartingAt(atoms: readonly Atom[], s: number): MethodAt | undefined {
    const word = atoms[s]!.word!;
    const prev = atoms[s - 1]?.word;
    const two = prev !== undefined ? findMethod([prev, word]) : undefined;
    if (two) return { method: two, start: s - 1, words: 2 };
    const one = findMethod([word]);
    return one ? { method: one, start: s, words: 1 } : undefined;
}
