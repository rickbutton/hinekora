/**
 * A loop whose rounds change the item one modifier at a time: random removals
 * (an Orb of Annulment, an Eldritch Orb of Annulment), single draws (an Exalted
 * Orb, an Orb of Augmentation), bench crafts, and the branches that catch a
 * kept modifier's loss or fill a gap, repeated until the counts and the named
 * modifiers allow; a reforge inside the body (an essence spammed again once a
 * kept modifier is lost) starts the item over from its roll's outcomes. Such a loop is not a sequence of independent attempts: each
 * round starts from where the last one left the item. It is a Markov chain
 * over a small state, the (prefix, suffix) counts and, for each modifier the
 * loop's conditions name, whether it is on the item and at which row, solved by
 * carrying the distribution over that state through the body round after round
 * until the mass has left. The named modifiers are the only ones tracked; the
 * rest of the item is counted, never listed.
 */
import type { Gen, ModId } from "../model/ids.js";

/** A modifier the loop's conditions name. */
export interface ChainAtom {
    readonly gen: Gen;
    /** The rows it may land as, each with its weight among them. */
    readonly rows: readonly { readonly id: ModId; readonly weight: number }[];
    /** Its group's weight in its side's pool while it is absent. */
    readonly weight: number;
}

/** The item as the chain sees it: the counts and, per atom, the row on the item or none. */
export interface ChainState {
    readonly prefix: number;
    readonly suffix: number;
    readonly rows: readonly (ModId | null)[];
}

export type ChainStep =
    /** A random removal from one side, or from either in proportion to its count. */
    | { readonly id: number; readonly kind: "remove"; readonly gen?: Gen }
    /** One draw into an open side. `weight` is each side's whole pool weight
     *  with every atom's group open; `known` how many modifiers of the side are
     *  on the item throughout and already out of that weight; `mean` the weight
     *  an unnamed modifier's group closes. */
    | {
          readonly id: number;
          readonly kind: "add";
          readonly weight: Readonly<Record<Gen, number>>;
          readonly known: Readonly<Record<Gen, number>>;
          readonly mean: Readonly<Record<Gen, number>>;
      }
    /** A bench craft: a named atom at a row, or an unnamed modifier of a side. */
    | {
          readonly id: number;
          readonly kind: "bench";
          readonly gen: Gen;
          readonly atom?: number;
          readonly row?: ModId;
      }
    /** A branch: the body runs where the condition holds, `otherwise` where not. */
    | {
          readonly id: number;
          readonly kind: "branch";
          readonly holds: (s: ChainState) => boolean;
          readonly body: readonly ChainStep[];
          readonly otherwise?: readonly ChainStep[];
      }
    /** A reforge: the item starts over as one of the roll's outcomes, whatever
     *  it held, each outcome the counts and the atoms' rows it leaves. */
    | { readonly id: number; readonly kind: "reforge"; readonly outcomes: readonly Outcome[] }
    /** The attempt ends; the craft ends. */
    | { readonly id: number; readonly kind: "restart" }
    | { readonly id: number; readonly kind: "stop" }
    /** A step the chain's state does not depend on. */
    | { readonly id: number; readonly kind: "other" };

/** One way a reforge leaves the item, with its probability. */
export interface Outcome {
    readonly prob: number;
    readonly state: ChainState;
}

export interface ChainInput {
    readonly atoms: readonly ChainAtom[];
    readonly body: readonly ChainStep[];
    /** The states the loop may start in, each with its weight. */
    readonly starts: readonly { readonly state: ChainState; readonly weight: number }[];
    readonly caps: Readonly<Record<Gen, number>>;
    readonly exit: (s: ChainState) => boolean;
}

export interface Chain {
    /** How one attempt ends: in the exit, a restart or a stop. */
    readonly exit: number;
    /** The part of `exit` that holds before the first round. */
    readonly exitAtStart: number;
    readonly restart: number;
    readonly stop: number;
    /** Expected passes through the body in one attempt. */
    readonly passes: number;
    /** Per step id, how often it is reached in one attempt, and for a branch
     *  how often its body is entered. */
    readonly reached: ReadonlyMap<number, number>;
    readonly taken: ReadonlyMap<number, number>;
    /** Mass that never leaves: a loop the chain cannot see ending, the item
     *  full and nothing removing. */
    readonly unresolved: number;
    /** The states the exit leaves the item in, their probabilities summing to `exit`. */
    readonly exits: readonly { readonly state: ChainState; readonly prob: number }[];
}

/** Rounds after which the chain stops following the mass still going round. */
const MAX_PASSES = 2000;
const EPSILON = 1e-9;
/** How close two rounds' decay must be for the rest to be taken as their
 *  geometric tail, and how close to one a decay counts as none. */
const SETTLED = 1e-10;
const STUCK = 1e-9;

type Dist = Map<string, { state: ChainState; prob: number }>;

interface Totals {
    exit: number;
    restart: number;
    stop: number;
    passes: number;
    reached: Map<number, number>;
    taken: Map<number, number>;
}

function key(s: ChainState): string {
    return `${s.prefix}/${s.suffix}/${s.rows.map((r) => r ?? "-").join(",")}`;
}

function put(d: Dist, state: ChainState, prob: number): void {
    if (prob <= 0) return;
    const k = key(state);
    const hit = d.get(k);
    if (hit) hit.prob += prob;
    else d.set(k, { state, prob });
}

function massOf(d: Dist): number {
    let m = 0;
    for (const e of d.values()) m += e.prob;
    return m;
}

function add(m: Map<number, number>, id: number, by: number): void {
    m.set(id, (m.get(id) ?? 0) + by);
}

function changes(steps: readonly ChainStep[]): boolean {
    return steps.some(
        (s) =>
            s.kind === "remove" ||
            s.kind === "add" ||
            s.kind === "bench" ||
            s.kind === "reforge" ||
            (s.kind === "branch" && (changes(s.body) || changes(s.otherwise ?? []))),
    );
}

/** Solve the chain; undefined when no step changes the state. */
export function chain(input: ChainInput): Chain | undefined {
    if (!changes(input.body)) return undefined;
    const total = input.starts.reduce((s, x) => s + x.weight, 0);
    if (!(total > 0)) return undefined;
    const t: Totals = {
        exit: 0,
        restart: 0,
        stop: 0,
        passes: 0,
        reached: new Map(),
        taken: new Map(),
    };
    let head: Dist = new Map();
    const exits: Dist = new Map();
    for (const { state, weight } of input.starts) {
        if (input.exit(state)) {
            t.exit += weight / total;
            put(exits, state, weight / total);
        } else put(head, state, weight / total);
    }
    const exitAtStart = t.exit;
    // A rare exit leaves mass going round for thousands of rounds. Once the
    // share each round keeps has settled, the distribution keeps its shape and
    // only shrinks, so every later round is this one scaled by that share: the
    // rest is a geometric tail, added at once.
    let lastDecay: number | undefined;
    for (let round = 0; round < MAX_PASSES && massOf(head) > EPSILON; round++) {
        const mass = massOf(head);
        const was = snapshot(t);
        t.passes += mass;
        const alive = run(input.body, head, input, t);
        head = new Map();
        const leaving: Dist = new Map();
        for (const { state, prob } of alive.values()) {
            if (input.exit(state)) {
                t.exit += prob;
                put(leaving, state, prob);
            } else put(head, state, prob);
        }
        const decay = massOf(head) / mass;
        // A chain that mixes slowly may not settle within the rounds followed;
        // its last round's decay is then the best guess at the rest.
        const last = round === MAX_PASSES - 1;
        const settled =
            decay < 1 - STUCK &&
            (last || (lastDecay !== undefined && Math.abs(decay - lastDecay) < SETTLED));
        const factor = settled ? 1 + decay / (1 - decay) : 1;
        for (const { state, prob } of leaving.values()) put(exits, state, prob * factor);
        if (settled) {
            addScaled(t, was, decay / (1 - decay));
            head = new Map();
            break;
        }
        lastDecay = decay;
    }
    return { ...t, exitAtStart, unresolved: massOf(head), exits: [...exits.values()] };
}

function snapshot(t: Totals): Totals {
    return { ...t, reached: new Map(t.reached), taken: new Map(t.taken) };
}

/** Add `factor` times what the totals gained since `was`. */
function addScaled(t: Totals, was: Totals, factor: number): void {
    t.exit += (t.exit - was.exit) * factor;
    t.restart += (t.restart - was.restart) * factor;
    t.stop += (t.stop - was.stop) * factor;
    t.passes += (t.passes - was.passes) * factor;
    for (const [m, before] of [
        [t.reached, was.reached],
        [t.taken, was.taken],
    ] as const) {
        for (const [id, n] of m) m.set(id, n + (n - (before.get(id) ?? 0)) * factor);
    }
}

function run(steps: readonly ChainStep[], alive: Dist, input: ChainInput, t: Totals): Dist {
    let current = alive;
    for (const step of steps) {
        if (current.size === 0) break;
        add(t.reached, step.id, massOf(current));
        current = apply(step, current, input, t);
    }
    return current;
}

function apply(step: ChainStep, alive: Dist, input: ChainInput, t: Totals): Dist {
    switch (step.kind) {
        case "other":
            return alive;
        case "restart":
            t.restart += massOf(alive);
            return new Map();
        case "stop":
            t.stop += massOf(alive);
            return new Map();
        case "branch": {
            const inside: Dist = new Map();
            const outside: Dist = new Map();
            for (const { state, prob } of alive.values()) {
                put(step.holds(state) ? inside : outside, state, prob);
            }
            add(t.taken, step.id, massOf(inside));
            const out = run(step.body, inside, input, t);
            const rest =
                step.otherwise === undefined ? outside : run(step.otherwise, outside, input, t);
            for (const { state, prob } of out.values()) put(rest, state, prob);
            return rest;
        }
        case "reforge": {
            const next: Dist = new Map();
            const mass = massOf(alive);
            for (const o of step.outcomes) put(next, o.state, mass * o.prob);
            return next;
        }
        case "bench": {
            const next: Dist = new Map();
            for (const { state, prob } of alive.values()) {
                if (state[step.gen] >= input.caps[step.gen]) {
                    put(next, state, prob);
                    continue;
                }
                const rows = [...state.rows];
                if (step.atom !== undefined) {
                    if (rows[step.atom] !== null) {
                        put(next, state, prob);
                        continue;
                    }
                    rows[step.atom] = step.row ?? input.atoms[step.atom]?.rows[0]?.id ?? null;
                }
                put(next, bump(state, step.gen, 1, rows), prob);
            }
            return next;
        }
        case "remove":
            return removeStep(step.gen, alive, input);
        case "add":
            return addStep(step, alive, input);
    }
}

function bump(s: ChainState, gen: Gen, by: number, rows: readonly (ModId | null)[]): ChainState {
    return {
        prefix: gen === "prefix" ? s.prefix + by : s.prefix,
        suffix: gen === "suffix" ? s.suffix + by : s.suffix,
        rows,
    };
}

/** A removal takes one of the modifiers on the sides it reaches, each equally
 *  likely: a named one goes, or one of the unnamed count. */
function removeStep(gen: Gen | undefined, alive: Dist, input: ChainInput): Dist {
    const next: Dist = new Map();
    const sides: readonly Gen[] = gen === undefined ? ["prefix", "suffix"] : [gen];
    for (const { state, prob } of alive.values()) {
        let n = 0;
        for (const g of sides) n += state[g];
        if (n <= 0) {
            put(next, state, prob);
            continue;
        }
        const named = { prefix: 0, suffix: 0 };
        input.atoms.forEach((atom, i) => {
            if (state.rows[i] !== null && sides.includes(atom.gen)) {
                named[atom.gen]++;
                const rows = [...state.rows];
                rows[i] = null;
                put(next, bump(state, atom.gen, -1, rows), prob / n);
            }
        });
        for (const g of sides) {
            const unnamed = Math.max(0, state[g] - named[g]);
            if (unnamed > 0) put(next, bump(state, g, -1, state.rows), (prob * unnamed) / n);
        }
    }
    return next;
}

/**
 * A draw lands on an open side in proportion to what is left of the sides'
 * pools (a present atom's group closed, an unnamed modifier closing an
 * average group), then on an absent atom by its share or on an unnamed one.
 */
function addStep(step: Extract<ChainStep, { kind: "add" }>, alive: Dist, input: ChainInput): Dist {
    const next: Dist = new Map();
    for (const { state, prob } of alive.values()) {
        const weight = { prefix: step.weight.prefix, suffix: step.weight.suffix };
        const present = { prefix: 0, suffix: 0 };
        input.atoms.forEach((atom, i) => {
            if (state.rows[i] !== null) {
                weight[atom.gen] -= atom.weight;
                present[atom.gen]++;
            }
        });
        for (const g of ["prefix", "suffix"] as const) {
            const unnamed = Math.max(0, state[g] - present[g] - step.known[g]);
            weight[g] = Math.max(0, weight[g] - unnamed * step.mean[g]);
        }
        const open = (["prefix", "suffix"] as const).filter(
            (g) => state[g] < input.caps[g] && weight[g] > 0,
        );
        const totalWeight = open.reduce((s, g) => s + weight[g], 0);
        if (open.length === 0 || totalWeight <= 0) {
            put(next, state, prob);
            continue;
        }
        for (const g of open) {
            const sideProb = (prob * weight[g]) / totalWeight;
            let namedShare = 0;
            input.atoms.forEach((atom, i) => {
                if (atom.gen !== g || state.rows[i] !== null || atom.weight <= 0) return;
                const share = Math.min(1, atom.weight / weight[g]);
                namedShare += share;
                const rowTotal = atom.rows.reduce((s, r) => s + r.weight, 0);
                for (const r of atom.rows) {
                    const rows = [...state.rows];
                    rows[i] = r.id;
                    const rowShare = rowTotal > 0 ? r.weight / rowTotal : 1 / atom.rows.length;
                    put(next, bump(state, g, 1, rows), sideProb * share * rowShare);
                }
            });
            const unnamed = Math.max(0, 1 - namedShare);
            if (unnamed > 0) put(next, bump(state, g, 1, state.rows), sideProb * unnamed);
        }
    }
    return next;
}
