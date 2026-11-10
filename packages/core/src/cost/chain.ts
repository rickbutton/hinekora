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
    /** A random removal from one side, or from either in proportion to its
     *  count; a side is out of reach while a guarding atom (a metamod that
     *  protects it) is on the item. */
    | {
          readonly id: number;
          readonly kind: "remove";
          readonly gen?: Gen;
          readonly guards?: readonly { readonly atom: number; readonly side: Gen }[];
      }
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
    /** A method read on the item as each state has it: where it takes the
     *  state, with each outcome's chance (`track.ts` asks the checker). */
    | {
          readonly id: number;
          readonly kind: "transition";
          readonly next: (state: ChainState) => readonly Outcome[];
      }
    /** A loop inside the loop: the states that reach it go round its body
     *  until its exit holds, and go on from there. */
    | {
          readonly id: number;
          readonly kind: "loop";
          readonly exit: (s: ChainState) => boolean;
          readonly body: readonly ChainStep[];
      }
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
    /** Per step id, how often it is reached in one attempt; for a branch how
     *  often its body is entered, for a loop inside how often it is entered at
     *  its exit. */
    readonly reached: ReadonlyMap<number, number>;
    readonly taken: ReadonlyMap<number, number>;
    /** Mass that never leaves: a loop the chain cannot see ending, the item
     *  full and nothing removing. */
    readonly unresolved: number;
    /** The states the exit leaves the item in, their probabilities summing to `exit`. */
    readonly exits: readonly { readonly state: ChainState; readonly prob: number }[];
    /** The rounds were cut off before the distribution settled, and the rest
     *  was taken as the last round's tail: the figures are an estimate. */
    readonly estimated: boolean;
    /** Per loop inside, its rounds over one attempt of this one, and the
     *  loops whose rounds were estimated. */
    readonly rounds: ReadonlyMap<number, number>;
    readonly estimatedLoops: ReadonlySet<number>;
}

/** Rounds after which the chain stops following the mass still going round,
 *  and the states it carries through rounds before then, so a chain of many
 *  states stops sooner: a hover cannot wait on thousands of rounds of them. */
const MAX_PASSES = 2000;
const MAX_WORK = 200_000;
const EPSILON = 1e-9;
/** How close in shape two rounds' distributions must be for the rest to be
 *  taken as a geometric tail, and how close to one a decay counts as none. */
const SETTLED = 1e-7;
/** The mass an unsettled tail must carry for the figures to count as estimated. */
const UNSETTLED_MASS = 0.01;
const STUCK = 1e-9;

type Dist = Map<string, { state: ChainState; prob: number }>;

interface Totals {
    exit: number;
    restart: number;
    stop: number;
    passes: number;
    reached: Map<number, number>;
    taken: Map<number, number>;
    rounds: Map<number, number>;
    estimatedLoops: Set<number>;
    /** Mass a loop inside never let go. */
    stuck: number;
}

const keys = new WeakMap<ChainState, string>();

function key(s: ChainState): string {
    let k = keys.get(s);
    if (k === undefined) {
        k = `${s.prefix}/${s.suffix}/${s.rows.map((r) => r ?? "-").join(",")}`;
        keys.set(s, k);
    }
    return k;
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
            s.kind === "transition" ||
            (s.kind === "loop" && changes(s.body)) ||
            (s.kind === "branch" && (changes(s.body) || changes(s.otherwise ?? []))),
    );
}

/** Solve the chain; undefined when no step changes the state. */
export function chain(input: ChainInput): Chain | undefined {
    if (!changes(input.body)) return undefined;
    const total = input.starts.reduce((s, x) => s + x.weight, 0);
    if (!(total > 0)) return undefined;
    const t = totals();
    const head: Dist = new Map();
    const exits: Dist = new Map();
    for (const { state, weight } of input.starts) {
        if (input.exit(state)) {
            t.exit += weight / total;
            put(exits, state, weight / total);
        } else put(head, state, weight / total);
    }
    const exitAtStart = t.exit;
    const r = iterate(input.body, head, input.exit, input, t);
    t.passes += r.passes;
    for (const { state, prob } of r.exits.values()) {
        t.exit += prob;
        put(exits, state, prob);
    }
    return {
        exit: t.exit,
        restart: t.restart,
        stop: t.stop,
        passes: t.passes,
        reached: t.reached,
        taken: t.taken,
        rounds: t.rounds,
        estimatedLoops: t.estimatedLoops,
        exitAtStart,
        unresolved: massOf(r.left) + t.stuck,
        exits: [...exits.values()],
        estimated: r.estimated,
    };
}

function totals(): Totals {
    return {
        exit: 0,
        restart: 0,
        stop: 0,
        passes: 0,
        reached: new Map(),
        taken: new Map(),
        rounds: new Map(),
        estimatedLoops: new Set(),
        stuck: 0,
    };
}

/**
 * Carry states round a body until they meet the exit. A rare exit leaves mass
 * going round for thousands of rounds; once a round hands the next one a
 * distribution of the same shape, only smaller, every later round is this one
 * scaled by the share it keeps, so the rest is a geometric tail, added at once.
 * The body's counts go into `t`; the rounds, the exits and the mass left
 * going round come back.
 */
function iterate(
    body: readonly ChainStep[],
    start: Dist,
    exit: (s: ChainState) => boolean,
    input: ChainInput,
    t: Totals,
): { passes: number; exits: Dist; left: Dist; estimated: boolean } {
    let head = start;
    const exits: Dist = new Map();
    let passes = 0;
    let estimated = false;
    let work = 0;
    for (let round = 0; round < MAX_PASSES && massOf(head) > EPSILON; round++) {
        const mass = massOf(head);
        const shapeIn = head;
        const was = snapshot(t);
        passes += mass;
        const alive = run(body, head, input, t);
        head = new Map();
        const leaving: Dist = new Map();
        for (const { state, prob } of alive.values())
            put(exit(state) ? leaving : head, state, prob);
        const decay = massOf(head) / mass;
        // A chain that mixes slowly may not settle within the rounds followed;
        // its last round's decay is then the best guess at the rest, and the
        // figures are an estimate.
        work += head.size;
        const last = round === MAX_PASSES - 1 || work >= MAX_WORK;
        const settled = shapeDistance(shapeIn, mass, head, massOf(head)) < SETTLED;
        const tail = decay < 1 - STUCK && (settled || last);
        const factor = tail ? 1 / (1 - decay) : 1;
        for (const { state, prob } of leaving.values()) put(exits, state, prob * factor);
        if (tail) {
            // A tail over little mass moves the figures little, settled or not.
            estimated = !settled && massOf(head) > UNSETTLED_MASS;
            addScaled(t, was, decay / (1 - decay));
            passes += (mass * decay) / (1 - decay);
            head = new Map();
            break;
        }
    }
    return { passes, exits, left: head, estimated };
}

/** How far apart two distributions are in shape: the summed difference of
 *  their states' shares. */
function shapeDistance(a: Dist, aMass: number, b: Dist, bMass: number): number {
    if (!(aMass > 0) || !(bMass > 0)) return Infinity;
    let d = 0;
    for (const [k, e] of a) d += Math.abs(e.prob / aMass - (b.get(k)?.prob ?? 0) / bMass);
    for (const [k, e] of b) if (!a.has(k)) d += e.prob / bMass;
    return d;
}

function snapshot(t: Totals): Totals {
    return {
        ...t,
        reached: new Map(t.reached),
        taken: new Map(t.taken),
        rounds: new Map(t.rounds),
    };
}

/** Add `factor` times what the totals gained since `was`. */
function addScaled(t: Totals, was: Totals, factor: number): void {
    t.exit += (t.exit - was.exit) * factor;
    t.restart += (t.restart - was.restart) * factor;
    t.stop += (t.stop - was.stop) * factor;
    t.passes += (t.passes - was.passes) * factor;
    t.stuck += (t.stuck - was.stuck) * factor;
    for (const [m, before] of [
        [t.reached, was.reached],
        [t.taken, was.taken],
        [t.rounds, was.rounds],
    ] as const) {
        for (const [id, n] of m) m.set(id, n + (n - (before.get(id) ?? 0)) * factor);
    }
}

/**
 * One step outside a loop: where it takes each of the states, their weights
 * carried. A restart, a stop or a branch is the walk's to split, not a step's.
 */
export function advance(
    step: ChainStep,
    states: readonly { readonly state: ChainState; readonly weight: number }[],
    atoms: readonly ChainAtom[],
    caps: Readonly<Record<Gen, number>>,
): { state: ChainState; weight: number }[] {
    const alive: Dist = new Map();
    for (const { state, weight } of states) put(alive, state, weight);
    const input: ChainInput = { atoms, body: [], starts: [], caps, exit: () => false };
    const t = totals();
    return [...apply(step, alive, input, t).values()].map((e) => ({
        state: e.state,
        weight: e.prob,
    }));
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
        case "loop": {
            const done: Dist = new Map();
            const head: Dist = new Map();
            for (const { state, prob } of alive.values())
                put(step.exit(state) ? done : head, state, prob);
            // A loop entered at its exit takes no round: `taken` counts it.
            add(t.taken, step.id, massOf(done));
            const r = iterate(step.body, head, step.exit, input, t);
            add(t.rounds, step.id, r.passes);
            if (r.estimated) t.estimatedLoops.add(step.id);
            t.stuck += massOf(r.left);
            for (const { state, prob } of r.exits.values()) put(done, state, prob);
            return done;
        }
        case "transition": {
            // States that lead to the same outcomes (a reforge's, shared by
            // every state it strips alike) are spread once, their mass summed.
            const byOutcomes = new Map<readonly Outcome[], number>();
            for (const { state, prob } of alive.values()) {
                const out = step.next(state);
                byOutcomes.set(out, (byOutcomes.get(out) ?? 0) + prob);
            }
            const next: Dist = new Map();
            for (const [out, mass] of byOutcomes) {
                for (const o of out) put(next, o.state, mass * o.prob);
            }
            return next;
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
            return removeStep(step, alive, input);
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
function removeStep(
    step: Extract<ChainStep, { kind: "remove" }>,
    alive: Dist,
    input: ChainInput,
): Dist {
    const next: Dist = new Map();
    const reach: readonly Gen[] = step.gen === undefined ? ["prefix", "suffix"] : [step.gen];
    for (const { state, prob } of alive.values()) {
        const sides = reach.filter(
            (g) => !(step.guards ?? []).some((x) => x.side === g && state.rows[x.atom] !== null),
        );
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
