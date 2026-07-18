/**
 * A tiny reduced, ordered Binary Decision Diagram (ROBDD) over named boolean
 * variables — the checker's presence domain (why a BDD: docs/HANDOFF.md §8). Nodes
 * are hash-consed into canonical form, so structurally-equal functions share
 * one integer id and equality is `===`. Variables are ordered by first-seen;
 * ordering affects size, never correctness. No complement edges — `not` is an
 * explicit, memoized traversal.
 */

/** A handle to a boolean function. 0 = false, 1 = true; larger ids are nodes. */
export type Bdd = number;

interface Node {
    readonly level: number; // variable ordering index (lower = tested first)
    readonly lo: Bdd; // cofactor when the variable is false
    readonly hi: Bdd; // cofactor when the variable is true
}

export class BddManager {
    readonly FALSE: Bdd = 0;
    readonly TRUE: Bdd = 1;

    private readonly nodes: Node[] = [];
    private readonly unique = new Map<string, Bdd>();
    private readonly varLevel = new Map<string, number>();
    private readonly andMemo = new Map<string, Bdd>();
    private readonly orMemo = new Map<string, Bdd>();
    private readonly notMemo = new Map<Bdd, Bdd>();

    /** The function "variable `name` is true". Allocates the variable if new. */
    variable(name: string): Bdd {
        let level = this.varLevel.get(name);
        if (level === undefined) {
            level = this.varLevel.size;
            this.varLevel.set(name, level);
        }
        return this.mk(level, this.FALSE, this.TRUE);
    }

    /** Every variable name allocated so far (in allocation order). */
    variables(): string[] {
        return [...this.varLevel.keys()];
    }

    and(a: Bdd, b: Bdd): Bdd {
        return this.apply("and", a, b);
    }

    or(a: Bdd, b: Bdd): Bdd {
        return this.apply("or", a, b);
    }

    not(a: Bdd): Bdd {
        if (a === this.FALSE) return this.TRUE;
        if (a === this.TRUE) return this.FALSE;
        const memo = this.notMemo.get(a);
        if (memo !== undefined) return memo;
        const n = this.node(a);
        const res = this.mk(n.level, this.not(n.lo), this.not(n.hi));
        this.notMemo.set(a, res);
        return res;
    }

    /** `a` with variable `name` fixed to `value` (no-op if the var is unknown). */
    restrict(a: Bdd, name: string, value: boolean): Bdd {
        const level = this.varLevel.get(name);
        return level === undefined ? a : this.restrictLevel(a, level, value);
    }

    /** Existentially quantify `name` out of `a` (`∃x. a`). No-op if unknown. */
    exists(a: Bdd, name: string): Bdd {
        return this.or(this.restrict(a, name, false), this.restrict(a, name, true));
    }

    /** Does `a` entail `b` — is every model of `a` also a model of `b`? */
    entails(a: Bdd, b: Bdd): boolean {
        return this.and(a, this.not(b)) === this.FALSE;
    }

    isFalse(a: Bdd): boolean {
        return a === this.FALSE;
    }

    isTrue(a: Bdd): boolean {
        return a === this.TRUE;
    }

    // --- internals ---------------------------------------------------------

    private node(id: Bdd): Node {
        const n = this.nodes[id - 2];
        if (n === undefined) throw new Error(`bdd: invalid node id ${id}`);
        return n;
    }

    private levelOf(id: Bdd): number {
        return id <= this.TRUE ? Infinity : this.node(id).level;
    }

    /** Canonicalize: drop a redundant test (`lo === hi`), else hash-cons. */
    private mk(level: number, lo: Bdd, hi: Bdd): Bdd {
        if (lo === hi) return lo;
        const key = `${level}:${lo}:${hi}`;
        const existing = this.unique.get(key);
        if (existing !== undefined) return existing;
        const id = this.nodes.length + 2; // ids 0/1 are the terminals
        this.nodes.push({ level, lo, hi });
        this.unique.set(key, id);
        return id;
    }

    private apply(op: "and" | "or", a: Bdd, b: Bdd): Bdd {
        // Terminal shortcuts.
        if (op === "and") {
            if (a === this.FALSE || b === this.FALSE) return this.FALSE;
            if (a === this.TRUE) return b;
            if (b === this.TRUE) return a;
        } else {
            if (a === this.TRUE || b === this.TRUE) return this.TRUE;
            if (a === this.FALSE) return b;
            if (b === this.FALSE) return a;
        }
        if (a === b) return a;

        // Memoize (the operators are commutative, so normalize the key order).
        const key = a < b ? `${a},${b}` : `${b},${a}`;
        const memo = op === "and" ? this.andMemo : this.orMemo;
        const hit = memo.get(key);
        if (hit !== undefined) return hit;

        // Split on the topmost variable appearing in either operand, recurse into
        // both cofactors, and rebuild.
        const level = Math.min(this.levelOf(a), this.levelOf(b));
        const [alo, ahi] = this.cofactor(a, level);
        const [blo, bhi] = this.cofactor(b, level);
        const res = this.mk(level, this.apply(op, alo, blo), this.apply(op, ahi, bhi));
        memo.set(key, res);
        return res;
    }

    /** The (lo, hi) cofactors of `id` at `level`, or (id, id) if it doesn't test it. */
    private cofactor(id: Bdd, level: number): readonly [Bdd, Bdd] {
        if (id > this.TRUE) {
            const n = this.node(id);
            if (n.level === level) return [n.lo, n.hi];
        }
        return [id, id];
    }

    private restrictLevel(a: Bdd, level: number, value: boolean): Bdd {
        if (a <= this.TRUE) return a;
        const n = this.node(a);
        if (n.level > level) return a; // the target variable doesn't appear here
        if (n.level === level) return value ? n.hi : n.lo;
        return this.mk(
            n.level,
            this.restrictLevel(n.lo, level, value),
            this.restrictLevel(n.hi, level, value),
        );
    }
}
