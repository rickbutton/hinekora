/**
 * A reduced, hash-consed, ordered multi-valued decision diagram over a fixed list of slots.
 *
 * Slot `i` takes the values `0..domains[i]-1` and slots are tested in index order. A diagram
 * denotes a set of total assignments. A node whose children are all equal is never built, so a
 * slot a path skips holds any value of its domain, and two diagrams of one manager denoting the
 * same set are the same object.
 *
 * A node is held only by the diagrams above it and by the caller; the manager's unique table
 * holds it weakly, so the garbage collector frees what no one holds. A `WeakRef` keeps its
 * target alive until the current job ends, so memory comes back only once the caller yields to
 * the event loop. A conjunction over many slots is best built by `automaton`, or by `and` from
 * the last slot to the first: from the first slot, each step rebuilds the whole diagram above it.
 */
declare const brand: unique symbol;

/** A diagram; compare two with `===`. */
export interface Dd {
    readonly [brand]: true;
}

/**
 * A relation on one slot's values: what `from` may become, or `undefined` for no change.
 * Returning one array object for every value with the same image is the fast path: each
 * distinct array is read once per call, and its sources are united once per node.
 */
export type DdRelation = (slot: number, from: number) => readonly number[] | undefined;

/**
 * A deterministic automaton reading the slots in order. States that share a `key` must accept
 * the same continuations: the build shares them.
 */
export interface DdAutomaton<S> {
    readonly init: S;
    /** The slots the automaton reads; the others stay unconstrained. All slots when absent. */
    readonly slots?: Iterable<number>;
    /** The next state, or `undefined` to reject. */
    step(slot: number, value: number, state: S): S | undefined;
    accept(state: S): boolean;
    key(state: S): string | number;
}

export interface DdOptions {
    /**
     * The most entries the unique table may hold; making a node past it throws `DdBudgetError`.
     * An entry stays until a collection and its finalisers have run, which happens only after
     * a macrotask yield, so within one synchronous run the budget counts every node the run
     * made, dead or alive. A check is meant to be one synchronous run on its own manager, and
     * its count is then deterministic.
     */
    readonly maxNodes?: number;
}

export class DdBudgetError extends Error {
    constructor(readonly maxNodes: number) {
        super(`the decision diagram grew past its budget of ${maxNodes} nodes`);
        this.name = "DdBudgetError";
    }
}

class Node implements Dd {
    declare readonly [brand]: true;
    constructor(
        readonly owner: DdManager,
        readonly slot: number,
        readonly kids: readonly Node[],
        readonly id: number,
    ) {}
}

const AND = 1;
const OR = 2;
const DIFF = 3;

const MIN_CACHE = 1 << 10;
const MAX_CACHE = 1 << 18;

/** Source values of one slot that share one image; a target may lie in several groups. */
interface RelationGroup {
    readonly sources: readonly number[];
    readonly targets: readonly number[];
}

/** Per-slot tables of a relation, built once per call so the relation is asked once per value. */
interface RelationTable {
    /**
     * For each slot, its source values grouped by image, so that a dense relation's union over
     * its sources is taken once per group and not once per target.
     */
    readonly groups: (readonly RelationGroup[])[];
    /** For each slot, which target values some source value reaches. */
    readonly reached: Uint8Array[];
    /** For each slot, whether the relation is defined for some value of it. */
    readonly touched: Uint8Array;
}

export class DdManager {
    readonly EMPTY: Dd;
    readonly ALL: Dd;
    readonly domains: readonly number[];
    readonly numSlots: number;
    readonly maxNodes: number;

    private readonly empty: Node;
    private readonly all: Node;
    private readonly table = new Map<number, WeakRef<Node>[]>();
    private readonly registry = new FinalizationRegistry<number>((h) => this.sweep(h));
    private live = 0;
    private nextId = 2;
    private applies = 0;

    // The operation cache holds nodes strongly, so it lives only for the outermost public call
    // or `batch` under way (`depth` counts them), whose end clears the entries in `used`.
    private depth = 0;
    private used: number[] = [];
    private cacheOp = new Uint8Array(MIN_CACHE);
    private cacheA = new Array<Node | undefined>(MIN_CACHE).fill(undefined);
    private cacheB = new Array<Node | undefined>(MIN_CACHE).fill(undefined);
    private cacheR = new Array<Node | undefined>(MIN_CACHE).fill(undefined);

    constructor(domains: readonly number[], options: DdOptions = {}) {
        for (const d of domains) {
            if (!Number.isInteger(d) || d < 1) {
                throw new RangeError(`a slot's domain must hold at least one value, not ${d}`);
            }
        }
        this.domains = [...domains];
        this.numSlots = domains.length;
        this.maxNodes = options.maxNodes ?? 2_000_000;
        this.empty = new Node(this, this.numSlots, [], 0);
        this.all = new Node(this, this.numSlots, [], 1);
        this.EMPTY = this.empty;
        this.ALL = this.all;
    }

    /** Internal nodes made over the manager's life. */
    get nodeCount(): number {
        return this.nextId - 2;
    }

    /** Entries of the unique table, which `maxNodes` bounds: live nodes and dead ones not yet swept. */
    get tableEntryCount(): number {
        return this.live;
    }

    /** Binary set operations asked for, trivial ones included, for tests and diagnostics. */
    get applyCount(): number {
        return this.applies;
    }

    /** The slot a diagram's root tests; `numSlots` for `EMPTY` and `ALL`. */
    top(a: Dd): number {
        return this.own(a).slot;
    }

    /** The diagram reached from `a` when its top slot holds `value`; `a` itself when `a` is a terminal. */
    child(a: Dd, value: number): Dd {
        const n = this.own(a);
        if (n === this.empty || n === this.all) return n;
        this.checkValue(n.slot, value);
        return n.kids[value]!;
    }

    /**
     * Runs `fn` with the operation cache kept across the calls it makes, so a repeated
     * operation is answered from the cache; the outermost batch clears it however it ends.
     * Outside a batch the cache lasts one call, since it holds the nodes it caches.
     */
    batch<T>(fn: () => T): T {
        return this.run(fn);
    }

    clearCaches(): void {
        for (const i of this.used) {
            this.cacheOp[i] = 0;
            this.cacheA[i] = undefined;
            this.cacheB[i] = undefined;
            this.cacheR[i] = undefined;
        }
        this.used = [];
    }

    // ---- set algebra ---------------------------------------------------------------------

    and(a: Dd, b: Dd): Dd {
        return this.run(() => this.apply(AND, this.own(a), this.own(b)));
    }

    or(a: Dd, b: Dd): Dd {
        return this.run(() => this.apply(OR, this.own(a), this.own(b)));
    }

    diff(a: Dd, b: Dd): Dd {
        return this.run(() => this.apply(DIFF, this.own(a), this.own(b)));
    }

    not(a: Dd): Dd {
        return this.run(() => this.apply(DIFF, this.all, this.own(a)));
    }

    isEmpty(a: Dd): boolean {
        return this.own(a) === this.empty;
    }

    implies(a: Dd, b: Dd): boolean {
        return this.run(() => this.apply(DIFF, this.own(a), this.own(b))) === this.empty;
    }

    slotIn(slot: number, values: Iterable<number>): Dd {
        const d = this.domainOf(slot);
        const kids = new Array<Node>(d).fill(this.empty);
        for (const v of values) {
            this.checkValue(slot, v);
            kids[v] = this.all;
        }
        return this.mk(slot, kids);
    }

    /**
     * The assignments where each pair of slots holds the same value. The two slots of a pair
     * should be adjacent in the order (interleaved copies): a pair far apart makes a diagram
     * that grows with the product of the domains between its slots.
     */
    equate(pairs: readonly (readonly [number, number])[]): Dd {
        return this.run(() => {
            let r = this.all;
            for (const [x, y] of pairs) {
                const p = Math.min(x, y);
                const q = Math.max(x, y);
                const d = this.domainOf(p);
                if (this.domainOf(q) !== d) {
                    throw new RangeError(`slots ${p} and ${q} have different domains`);
                }
                if (p === q) continue;
                const kids = new Array<Node>(d);
                for (let v = 0; v < d; v++) kids[v] = this.slotIn(q, [v]) as Node;
                r = this.apply(AND, r, this.mk(p, kids));
            }
            return r;
        });
    }

    // ---- quantification and transformation ------------------------------------------------

    /** Existential quantification: the slots are left free. */
    forget(a: Dd, slots: Iterable<number>): Dd {
        const mask = new Uint8Array(this.numSlots);
        let last = -1;
        for (const s of slots) {
            this.domainOf(s);
            mask[s] = 1;
            if (s > last) last = s;
        }
        const memo = new Map<Node, Node>();
        const go = (n: Node): Node => {
            const s = n.slot;
            if (s > last) return n;
            const hit = memo.get(n);
            if (hit !== undefined) return hit;
            const d = n.kids.length;
            let r: Node;
            if (mask[s] === 1) {
                r = this.empty;
                for (let v = 0; v < d && r !== this.all; v++) r = this.apply(OR, r, go(n.kids[v]!));
            } else {
                const kids = new Array<Node>(d);
                for (let v = 0; v < d; v++) kids[v] = go(n.kids[v]!);
                r = this.mk(s, kids);
            }
            memo.set(n, r);
            return r;
        };
        return this.run(() => go(this.own(a)));
    }

    /** Forget the slot, then fix it to `value`. */
    set(a: Dd, slot: number, value: number): Dd {
        return this.run(() => this.and(this.forget(a, [slot]), this.slotIn(slot, [value])));
    }

    /**
     * Exactly one slot changes, by `rel`, and every other slot keeps its value. A slot whose
     * relation gives `from` itself may be the one chosen and leave the assignment as it was.
     */
    mapOne(a: Dd, rel: DdRelation): Dd {
        const N = this.numSlots;
        const t = this.relationTable(rel, false);
        const nextActive = this.nextMarked(t.touched);
        const memo = new Map<number, Node>();
        // `go(from, n)`: the slots before `from` are fixed and unchanged; one slot at or after
        // `from` changes. Slots between `from` and `n`'s top are skipped by `n`, so they hold
        // any value and may be the one that changes.
        const go = (from: number, n: Node): Node => {
            if (n === this.empty) return n;
            const lv = n.slot;
            const s = nextActive[from]!;
            if (s >= N) return this.empty;
            const at = s < lv ? s : lv;
            const key = n.id * (N + 1) + at;
            const hit = memo.get(key);
            if (hit !== undefined) return hit;
            const d = this.domains[at]!;
            const kids = new Array<Node>(d);
            if (s < lv) {
                const rest = go(s + 1, n);
                const moved = this.apply(OR, n, rest);
                const reached = t.reached[s]!;
                for (let w = 0; w < d; w++) kids[w] = reached[w] === 1 ? moved : rest;
            } else {
                for (let w = 0; w < d; w++) kids[w] = go(lv + 1, n.kids[w]!);
                for (const g of t.groups[lv]!) {
                    let moved = this.empty;
                    for (const v of g.sources) moved = this.apply(OR, moved, n.kids[v]!);
                    if (moved === this.empty) continue;
                    for (const w of g.targets) kids[w] = this.apply(OR, kids[w]!, moved);
                }
            }
            const r = this.mk(at, kids);
            memo.set(key, r);
            return r;
        };
        return this.run(() => go(0, this.own(a)));
    }

    /**
     * Every slot changes independently: by `rel` where it is defined for the slot's value,
     * kept otherwise. An empty image for a value means an assignment holding it has no image.
     */
    mapEach(a: Dd, rel: DdRelation): Dd {
        const N = this.numSlots;
        const t = this.relationTable(rel, true);
        const nextTouched = this.nextMarked(t.touched);
        const restricting = new Uint8Array(N);
        for (let s = 0; s < N; s++) restricting[s] = t.reached[s]!.includes(0) ? 1 : 0;
        const nextRestricting = this.nextMarked(restricting);
        const memo = new Map<number, Node>();
        // Slots `n` skips hold every value; their image is whatever the relation reaches.
        const go = (from: number, n: Node): Node => {
            if (n === this.empty || nextTouched[from]! >= N) return n;
            const lv = n.slot;
            const s = nextRestricting[from]!;
            if (s >= lv && n === this.all) return n;
            const at = s < lv ? s : lv;
            const key = n.id * (N + 1) + at;
            const hit = memo.get(key);
            if (hit !== undefined) return hit;
            const d = this.domains[at]!;
            const kids = new Array<Node>(d).fill(this.empty);
            if (s < lv) {
                const rest = go(s + 1, n);
                const reached = t.reached[s]!;
                for (let w = 0; w < d; w++) if (reached[w] === 1) kids[w] = rest;
            } else {
                const images = new Array<Node>(d);
                for (let v = 0; v < d; v++) images[v] = go(lv + 1, n.kids[v]!);
                for (const g of t.groups[lv]!) {
                    let r = this.empty;
                    for (const v of g.sources) r = this.apply(OR, r, images[v]!);
                    for (const w of g.targets) kids[w] = this.apply(OR, kids[w]!, r);
                }
            }
            const r = this.mk(at, kids);
            memo.set(key, r);
            return r;
        };
        return this.run(() => go(0, this.own(a)));
    }

    /**
     * Moves each slot `s` of the diagram's support to `map(s)`; the support's old slots are
     * left free unless they are targets. The map must be strictly increasing on the support
     * (so the result stays ordered) and keep each slot's domain. Copying slots X into X' is
     * `and(forget(a, X'), equate(pairs))`; replacing X by X' is `rename(forget(a, X), X' -> X)`.
     */
    rename(a: Dd, map: (slot: number) => number): Dd {
        const target = new Int32Array(this.numSlots);
        let prev = -1;
        for (const s of this.support(a)) {
            const t = map(s);
            if (!Number.isInteger(t) || t < 0 || t >= this.numSlots) {
                throw new RangeError(`slot ${s} is renamed to ${t}, which is not a slot`);
            }
            if (t <= prev) throw new RangeError("a rename must keep the order of the slots");
            if (this.domains[t] !== this.domains[s]) {
                throw new RangeError(`slots ${s} and ${t} have different domains`);
            }
            prev = t;
            target[s] = t;
        }
        const memo = new Map<Node, Node>();
        const go = (n: Node): Node => {
            if (n === this.empty || n === this.all) return n;
            const hit = memo.get(n);
            if (hit !== undefined) return hit;
            const r = this.mk(
                target[n.slot]!,
                n.kids.map((c) => go(c)),
            );
            memo.set(n, r);
            return r;
        };
        return go(this.own(a));
    }

    /** A diagram from an automaton over the slots, sharing states by their key at each slot. */
    automaton<S>(spec: DdAutomaton<S>): Dd {
        const slots =
            spec.slots === undefined
                ? Array.from({ length: this.numSlots }, (_, i) => i)
                : [...new Set(spec.slots)].sort((x, y) => x - y);
        for (const s of slots) this.domainOf(s);
        const memo = slots.map(() => new Map<string | number, Node>());
        const go = (i: number, state: S): Node => {
            const s = slots[i];
            if (s === undefined) return spec.accept(state) ? this.all : this.empty;
            const seen = memo[i]!;
            const key = spec.key(state);
            const hit = seen.get(key);
            if (hit !== undefined) return hit;
            const d = this.domains[s]!;
            const kids = new Array<Node>(d);
            for (let v = 0; v < d; v++) {
                const next = spec.step(s, v, state);
                kids[v] = next === undefined ? this.empty : go(i + 1, next);
            }
            const r = this.mk(s, kids);
            seen.set(key, r);
            return r;
        };
        return go(0, spec.init);
    }

    // ---- reads ---------------------------------------------------------------------------

    contains(a: Dd, assignment: readonly number[]): boolean {
        if (assignment.length !== this.numSlots) {
            throw new RangeError(
                `an assignment holds one value per slot: ${this.numSlots}, not ${assignment.length}`,
            );
        }
        for (let s = 0; s < this.numSlots; s++) this.checkValue(s, assignment[s]!);
        let n = this.own(a);
        while (n !== this.empty && n !== this.all) n = n.kids[assignment[n.slot]!]!;
        return n === this.all;
    }

    /** One assignment of `a`; a slot the path skips holds 0. */
    witness(a: Dd): number[] | undefined {
        if (a === this.empty) return undefined;
        const out = new Array<number>(this.numSlots).fill(0);
        let n = this.own(a);
        while (n !== this.all) {
            let v = 0;
            while (n.kids[v] === this.empty) v++;
            out[n.slot] = v;
            n = n.kids[v]!;
        }
        return out;
    }

    /** The values `slot` takes over the assignments of `a`, ascending. */
    valuesOf(a: Dd, slot: number): number[] {
        const d = this.domainOf(slot);
        const found = new Uint8Array(d);
        const seen = new Set<Node>();
        const visit = (n: Node): void => {
            if (n === this.empty || seen.has(n)) return;
            seen.add(n);
            if (n.slot > slot) {
                found.fill(1);
                return;
            }
            for (let v = 0; v < n.kids.length; v++) {
                const c = n.kids[v]!;
                if (n.slot === slot) {
                    if (c !== this.empty) found[v] = 1;
                } else visit(c);
            }
        };
        visit(this.own(a));
        const out: number[] = [];
        for (let v = 0; v < d; v++) if (found[v] === 1) out.push(v);
        return out;
    }

    /**
     * The least and greatest sum of `weight(slot, value)` over the assignments of `a`. The
     * weights must be integers whose sums stay safe integers: the sums over skipped slots are
     * differences of running totals, exact only then.
     */
    extent(a: Dd, weight: (slot: number, value: number) => number): [number, number] | undefined {
        if (a === this.empty) return undefined;
        const N = this.numSlots;
        const w: number[][] = [];
        const lowBefore = new Float64Array(N + 1);
        const highBefore = new Float64Array(N + 1);
        for (let s = 0; s < N; s++) {
            const row: number[] = [];
            let lo = Infinity;
            let hi = -Infinity;
            for (let v = 0; v < this.domains[s]!; v++) {
                const x = weight(s, v);
                row.push(x);
                if (x < lo) lo = x;
                if (x > hi) hi = x;
            }
            w.push(row);
            lowBefore[s + 1] = lowBefore[s]! + lo;
            highBefore[s + 1] = highBefore[s]! + hi;
        }
        const memo = new Map<Node, [number, number]>();
        // Over the slots from `n`'s top to the end.
        const go = (n: Node): [number, number] => {
            if (n === this.all) return [0, 0];
            const hit = memo.get(n);
            if (hit !== undefined) return hit;
            const s = n.slot;
            const row = w[s]!;
            let lo = Infinity;
            let hi = -Infinity;
            for (let v = 0; v < row.length; v++) {
                const c = n.kids[v]!;
                if (c === this.empty) continue;
                const [clo, chi] = go(c);
                const l = row[v]! + lowBefore[c.slot]! - lowBefore[s + 1]! + clo;
                const h = row[v]! + highBefore[c.slot]! - highBefore[s + 1]! + chi;
                if (l < lo) lo = l;
                if (h > hi) hi = h;
            }
            const r: [number, number] = [lo, hi];
            memo.set(n, r);
            return r;
        };
        const n = this.own(a);
        const [lo, hi] = go(n);
        return [lowBefore[n.slot]! + lo, highBefore[n.slot]! + hi];
    }

    /** The number of assignments of `a`. */
    count(a: Dd): bigint {
        const N = this.numSlots;
        const after: bigint[] = new Array<bigint>(N + 1);
        after[N] = 1n;
        for (let s = N - 1; s >= 0; s--) after[s] = after[s + 1]! * BigInt(this.domains[s]!);
        const memo = new Map<Node, bigint>();
        // Assignments to the slots from `n`'s top to the end.
        const go = (n: Node): bigint => {
            if (n === this.empty) return 0n;
            if (n === this.all) return 1n;
            const hit = memo.get(n);
            if (hit !== undefined) return hit;
            let r = 0n;
            for (const c of n.kids) {
                if (c !== this.empty) r += go(c) * (after[n.slot + 1]! / after[c.slot]!);
            }
            memo.set(n, r);
            return r;
        };
        const n = this.own(a);
        return go(n) * (after[0]! / after[n.slot]!);
    }

    /** The internal nodes reachable from `a`. */
    size(a: Dd): number {
        return this.reachable(this.own(a)).length;
    }

    /** The slots `a` tests, ascending: exactly the slots its set depends on. */
    support(a: Dd): number[] {
        const slots = new Set<number>();
        for (const n of this.reachable(this.own(a))) slots.add(n.slot);
        return [...slots].sort((x, y) => x - y);
    }

    // ---- internals -----------------------------------------------------------------------

    private run<T>(f: () => T): T {
        this.depth++;
        try {
            return f();
        } finally {
            if (--this.depth === 0) this.clearCaches();
        }
    }

    private reachable(a: Node): Node[] {
        const seen = new Set<Node>();
        const stack = [a];
        while (stack.length > 0) {
            const n = stack.pop()!;
            if (n === this.empty || n === this.all || seen.has(n)) continue;
            seen.add(n);
            for (const c of n.kids) stack.push(c);
        }
        return [...seen];
    }

    private own(a: Dd): Node {
        if (!(a instanceof Node) || a.owner !== this) {
            throw new RangeError("the diagram belongs to another manager");
        }
        return a;
    }

    private domainOf(slot: number): number {
        const d = this.domains[slot];
        if (d === undefined || !Number.isInteger(slot)) {
            throw new RangeError(`${slot} is not a slot`);
        }
        return d;
    }

    private checkValue(slot: number, value: number): void {
        if (!Number.isInteger(value) || value < 0 || value >= this.domains[slot]!) {
            throw new RangeError(`${value} is not a value of slot ${slot}`);
        }
    }

    /** `next[i]`: the first marked slot at or after `i`, `numSlots` when none. */
    private nextMarked(marked: Uint8Array): Int32Array {
        const N = this.numSlots;
        const next = new Int32Array(N + 1);
        next[N] = N;
        for (let s = N - 1; s >= 0; s--) next[s] = marked[s] === 1 ? s : next[s + 1]!;
        return next;
    }

    private relationTable(rel: DdRelation, keepUndefined: boolean): RelationTable {
        const N = this.numSlots;
        const groups: RelationGroup[][] = [];
        const reached: Uint8Array[] = [];
        const touched = new Uint8Array(N);
        for (let s = 0; s < N; s++) {
            const d = this.domains[s]!;
            const hit = new Uint8Array(d);
            const list: { sources: number[]; targets: readonly number[] }[] = [];
            // A relation usually hands back one array for many values: it is read once.
            const byArray = new Map<readonly number[], { sources: number[] }>();
            const byContent = new Map<string, { sources: number[] }>();
            for (let v = 0; v < d; v++) {
                const image = rel(s, v);
                if (image === undefined) {
                    if (keepUndefined) {
                        list.push({ sources: [v], targets: [v] });
                        hit[v] = 1;
                    }
                    continue;
                }
                touched[s] = 1;
                let g = byArray.get(image);
                if (g === undefined) {
                    const key = image.join(",");
                    g = byContent.get(key);
                    if (g === undefined) {
                        for (const w of image) {
                            this.checkValue(s, w);
                            hit[w] = 1;
                        }
                        const made = { sources: [], targets: image };
                        if (image.length > 0) list.push(made);
                        g = made;
                        byContent.set(key, g);
                    }
                    byArray.set(image, g);
                }
                g.sources.push(v);
            }
            groups.push(list);
            reached.push(hit);
        }
        return { groups, reached, touched };
    }

    private apply(op: number, a: Node, b: Node): Node {
        this.applies++;
        const empty = this.empty;
        const all = this.all;
        if (op === AND) {
            if (a === empty || b === empty) return empty;
            if (a === all || a === b) return b;
            if (b === all) return a;
        } else if (op === OR) {
            if (a === all || b === all) return all;
            if (a === empty || a === b) return b;
            if (b === empty) return a;
        } else {
            if (a === empty || b === all || a === b) return empty;
            if (b === empty) return a;
        }
        if (op !== DIFF && a.id > b.id) {
            const t = a;
            a = b;
            b = t;
        }
        const i = cacheIndex(op, a, b, this.cacheOp.length);
        if (this.cacheOp[i] === op && this.cacheA[i] === a && this.cacheB[i] === b) {
            return this.cacheR[i]!;
        }
        const s = a.slot < b.slot ? a.slot : b.slot;
        const d = this.domains[s]!;
        const kids = new Array<Node>(d);
        for (let v = 0; v < d; v++) {
            kids[v] = this.apply(op, a.slot === s ? a.kids[v]! : a, b.slot === s ? b.kids[v]! : b);
        }
        const r = this.mk(s, kids);
        // The cache may have grown during the recursion.
        const j = cacheIndex(op, a, b, this.cacheOp.length);
        if (this.cacheOp[j] === 0) this.used.push(j);
        this.cacheOp[j] = op;
        this.cacheA[j] = a;
        this.cacheB[j] = b;
        this.cacheR[j] = r;
        return r;
    }

    /** Takes ownership of `kids`. */
    private mk(slot: number, kids: Node[]): Node {
        const first = kids[0]!;
        let same = true;
        for (let v = 1; v < kids.length; v++) {
            if (kids[v] !== first) {
                same = false;
                break;
            }
        }
        if (same) return first;

        let h = Math.imul(slot + 1, 0x9e3779b1);
        for (const k of kids) {
            h = Math.imul(h ^ k.id, 0x85ebca6b);
            h ^= h >>> 15;
        }
        const bucket = this.table.get(h);
        if (bucket !== undefined) {
            for (let i = 0; i < bucket.length; i++) {
                const n = bucket[i]!.deref();
                if (n === undefined) {
                    bucket[i] = bucket[bucket.length - 1]!;
                    bucket.pop();
                    this.live--;
                    i--;
                    continue;
                }
                if (n.slot !== slot) continue;
                let equal = true;
                for (let v = 0; v < kids.length; v++) {
                    if (n.kids[v] !== kids[v]) {
                        equal = false;
                        break;
                    }
                }
                if (equal) return n;
            }
        }

        if (this.live >= this.maxNodes) throw new DdBudgetError(this.maxNodes);
        const n = new Node(this, slot, kids, this.nextId++);
        const ref = new WeakRef(n);
        if (bucket === undefined) this.table.set(h, [ref]);
        else bucket.push(ref);
        this.registry.register(n, h);
        this.live++;
        if (this.live > this.cacheOp.length * 4 && this.cacheOp.length < MAX_CACHE) {
            this.growCache();
        }
        return n;
    }

    private sweep(h: number): void {
        const bucket = this.table.get(h);
        if (bucket === undefined) return;
        const kept = bucket.filter((r) => r.deref() !== undefined);
        this.live -= bucket.length - kept.length;
        if (kept.length === 0) this.table.delete(h);
        else this.table.set(h, kept);
    }

    private growCache(): void {
        const size = this.cacheOp.length * 2;
        this.cacheOp = new Uint8Array(size);
        this.cacheA = new Array<Node | undefined>(size).fill(undefined);
        this.cacheB = new Array<Node | undefined>(size).fill(undefined);
        this.cacheR = new Array<Node | undefined>(size).fill(undefined);
        this.used = [];
    }
}

function cacheIndex(op: number, a: Node, b: Node, size: number): number {
    return (Math.imul(a.id, 0x9e3779b1) ^ Math.imul(b.id, 0x85ebca6b) ^ op) & (size - 1);
}
