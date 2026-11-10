/**
 * A loop whose body the cost walk can follow (methods read as transitions of
 * the tracked state, branches, loops nested inside, restarts and stops) is not
 * a sequence of independent attempts: each round starts from where the last
 * one left the item, and a reforge inside the body (an essence spammed again
 * once a kept modifier is lost) starts it over from its roll's outcomes. It is
 * a Markov chain over a small state, the (prefix, suffix) counts and, for each
 * tracked modifier, whether it is on the item and at which row, solved by
 * carrying the distribution over that state through the body round after round
 * until the mass has left. The modifiers no one tracks are counted, never
 * listed.
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
    /** The item an imprint holds, as it was when the imprint was taken. */
    readonly held?: ChainState;
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
    /** Back to the head of the loop around it, the item as it is. */
    | { readonly id: number; readonly kind: "restart" }
    /** The craft ends. */
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

/** One way a step leaves the item, with its probability. */
export interface Outcome {
    readonly prob: number;
    readonly state: ChainState;
    /** The craft ends on this outcome: the item is destroyed, or no longer
     *  the one being crafted. */
    readonly ends?: true;
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
    /** How the loop ends: in its exit or a stop. */
    readonly exit: number;
    /** The part of `exit` that holds before the first round. */
    readonly exitAtStart: number;
    /** The mass a `restart` sent back to a loop's head, over all rounds. */
    readonly restart: number;
    readonly stop: number;
    /** Expected passes through the body in one attempt. */
    readonly passes: number;
    /** Per step id, how often it is reached in one attempt; for a branch how
     *  often its body is entered, for a loop inside how often it is entered at
     *  its exit. */
    readonly reached: ReadonlyMap<number, number>;
    readonly taken: ReadonlyMap<number, number>;
    /** Mass that never leaves: on states from which no run of rounds reaches
     *  the exit or a stop (the item full and nothing removing). */
    readonly unresolved: number;
    /** The part of `unresolved` a loop inside never let go. */
    readonly stuckInside: number;
    /** Mass still going round when the rounds were cut off, on states the
     *  chain could not tell from ones that never leave. */
    readonly undecided: number;
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
/** How close in shape two rounds' distributions must be, against the share of
 *  the mass a round loses, for the rest to be taken as a geometric tail (the
 *  tail's relative error is that ratio), and how close to one a decay counts
 *  as none. */
const SETTLED = 1e-7;
/** The mass an unsettled tail must carry for the figures to count as estimated. */
const UNSETTLED_MASS = 0.01;
const STUCK = 1e-9;
/** The least chance that counts as a way from one state to another: below it
 *  is what the race's quadrature leaves on outcomes that cannot happen. */
const EDGE = 1e-12;
/** The states and the ways between them followed to tell which states can
 *  reach the exit, and the states whose rounds are solved for outright. */
const MAX_EXPLORED = 4000;
const MAX_EDGES = 400_000;
const MAX_SOLVED = 400;
/** How much of the mass that set out a solved round may leave unaccounted for. */
const BALANCE = 1e-6;

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
    /** Mass a loop inside never let go, and mass it could not say that of. */
    stuck: number;
    undecided: number;
    /** The states carried through rounds so far, by this loop and every loop
     *  inside it alike, against `MAX_WORK`. */
    work: number;
    /** The states a `restart` sent back to the head of the loop being run. */
    again: Dist;
}

const keys = new WeakMap<ChainState, string>();

function key(s: ChainState): string {
    let k = keys.get(s);
    if (k === undefined) {
        k = `${s.prefix}/${s.suffix}/${s.rows.map((r) => r ?? "-").join(",")}`;
        if (s.held !== undefined) k += `|${key(s.held)}`;
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
        unresolved: r.never + t.stuck,
        stuckInside: t.stuck,
        undecided: r.undecided + t.undecided,
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
        undecided: 0,
        work: 0,
        again: new Map(),
    };
}

interface Rounds {
    readonly passes: number;
    readonly exits: Dist;
    /** Mass on states that never leave, and mass the chain could not say that of. */
    readonly never: number;
    readonly undecided: number;
    readonly estimated: boolean;
}

/** One round of a body from the states at its head: the states that meet the
 *  exit after it and the ones at the head again. A restart inside the body is
 *  back at this loop's head, as the states that fall off the body's end are. */
function oneRound(
    body: readonly ChainStep[],
    head: Dist,
    exit: (s: ChainState) => boolean,
    input: ChainInput,
    t: Totals,
): { leaving: Dist; next: Dist } {
    const outer = t.again;
    t.again = new Map();
    const alive = run(body, head, input, t);
    const back = t.again;
    t.again = outer;
    const next: Dist = new Map();
    const leaving: Dist = new Map();
    for (const { state, prob } of [...alive.values(), ...back.values()])
        put(exit(state) ? leaving : next, state, prob);
    return { leaving, next };
}

/**
 * Carry states round a body until they meet the exit. A rare exit leaves mass
 * going round for thousands of rounds; once a round hands the next one a
 * distribution of the same shape, only smaller, every later round is this one
 * scaled by the share it keeps, so the rest is a geometric tail, added at once.
 * A chain that has not settled within the rounds followed is finished by
 * `beyond`. The body's counts go into `t`.
 */
function iterate(
    body: readonly ChainStep[],
    start: Dist,
    exit: (s: ChainState) => boolean,
    input: ChainInput,
    t: Totals,
): Rounds {
    let head = start;
    const exits: Dist = new Map();
    let passes = 0;
    for (let round = 0; massOf(head) > EPSILON; round++) {
        if (round >= MAX_PASSES || t.work >= MAX_WORK) {
            const tail = true;
            const rest = beyond(body, head, exit, input, t, exits, tail);
            return { ...rest, passes: passes + rest.passes, exits };
        }
        const mass = massOf(head);
        const was = snapshot(t);
        passes += mass;
        const { leaving, next } = oneRound(body, head, exit, input, t);
        const decay = massOf(next) / mass;
        t.work += next.size;
        const distance = shapeDistance(head, mass, next, massOf(next));
        // Items that never leave, beside a few still draining, hand on almost
        // the same shape too, but there the shape moves as fast as the mass
        // goes: only a shape that has stopped moving against it is a tail.
        const settled = decay < 1 - STUCK && distance < SETTLED * (1 - decay);
        const factor = settled ? 1 / (1 - decay) : 1;
        for (const { state, prob } of leaving.values()) put(exits, state, prob * factor);
        head = next;
        if (settled) {
            addScaled(t, was, decay / (1 - decay));
            passes += (mass * decay) / (1 - decay);
            head = new Map();
        }
    }
    return { passes, exits, never: massOf(head), undecided: 0, estimated: false };
}

/** What one round does to one state: where it may be at the head again, and
 *  whether it may leave, by the exit or a stop. */
interface Node {
    readonly state: ChainState;
    readonly next: ReadonlyMap<string, number>;
    /** The chance the round does not hand the state back to the head at all. */
    readonly gone: number;
    readonly ends: boolean;
    /** A loop inside could not say whether the item leaves it. */
    readonly unsure: boolean;
}

type Fate = "leaves" | "never" | "undecided";

/**
 * Which of the states going round can reach the exit at all: each is followed
 * one round on its own, and the states that round may hand on likewise, until
 * no new state turns up. A state leaves if some run of rounds from it ends in
 * the exit or a stop; it never does if none can; and where the states were too
 * many to follow to the end, a state that may reach one not followed is left
 * undecided. Rates play no part: a state that leaves once in a million rounds
 * leaves.
 */
function fates(
    body: readonly ChainStep[],
    head: Dist,
    exit: (s: ChainState) => boolean,
    input: ChainInput,
    work: number,
): { nodes: Map<string, Node>; fate: (key: string) => Fate } {
    const nodes = new Map<string, Node>();
    const queue = [...head.values()].map((e) => e.state);
    const seen = new Set(queue.map(key));
    let edges = 0;
    for (let i = 0; i < queue.length && i < MAX_EXPLORED && edges < MAX_EDGES; i++) {
        const state = queue[i]!;
        const scratch = totals();
        scratch.work = work;
        const point: Dist = new Map([[key(state), { state, prob: 1 }]]);
        const { leaving, next } = oneRound(body, point, exit, input, scratch);
        const to = new Map<string, number>();
        for (const [k, e] of next) {
            if (e.prob <= EDGE) continue;
            to.set(k, e.prob);
            edges++;
            if (!seen.has(k)) {
                seen.add(k);
                queue.push(e.state);
            }
        }
        nodes.set(key(state), {
            state,
            next: to,
            gone: massOf(leaving) + scratch.stop + scratch.stuck + scratch.undecided,
            ends: massOf(leaving) + scratch.stop > EDGE,
            unsure: scratch.undecided > EDGE,
        });
    }
    const into = new Map<string, string[]>();
    for (const [k, n] of nodes) {
        for (const to of n.next.keys()) {
            const list = into.get(to);
            if (list) list.push(k);
            else into.set(to, [k]);
        }
    }
    // The states that can reach one of `from`, those included.
    const reaching = (from: (n: Node | undefined) => boolean): Set<string> => {
        const out = new Set([...seen].filter((k) => from(nodes.get(k))));
        const stack = [...out];
        for (let k = stack.pop(); k !== undefined; k = stack.pop()) {
            for (const prev of into.get(k) ?? []) {
                if (out.has(prev)) continue;
                out.add(prev);
                stack.push(prev);
            }
        }
        return out;
    };
    const leaves = reaching((n) => n?.ends === true);
    const open = reaching((n) => n === undefined || n.unsure);
    return {
        nodes,
        fate: (k) =>
            leaves.has(k) ? "leaves" : open.has(k) || !seen.has(k) ? "undecided" : "never",
    };
}

/**
 * The rounds past those followed one by one. The mass on states that cannot
 * reach the exit never leaves. For the states that can, how often each is
 * expected at the head from here on is a linear system over them, solved
 * outright while they are few; one round from those visits is then every round
 * to come, and is kept only if it accounts for all the mass that set out.
 * Otherwise, where `tail` allows it, the next round's decay stands for the
 * rest and the figures are an estimate; failing both, the mass is undecided.
 */
function beyond(
    body: readonly ChainStep[],
    head: Dist,
    exit: (s: ChainState) => boolean,
    input: ChainInput,
    t: Totals,
    exits: Dist,
    tail: boolean,
): Omit<Rounds, "exits"> {
    const { nodes, fate } = fates(body, head, exit, input, t.work);
    let never = 0;
    let undecided = 0;
    const live: Dist = new Map();
    for (const [k, e] of head) {
        const f = fate(k);
        if (f === "leaves") live.set(k, e);
        else if (f === "never") never += e.prob;
        else undecided += e.prob;
    }
    const mass = massOf(live);
    if (!(mass > 0)) return { passes: 0, never, undecided, estimated: false };
    // What a round from the states that leave hands to ones that do not.
    const lost = (next: Dist): { never: number; undecided: number } => {
        const out = { never: 0, undecided: 0 };
        for (const [k, e] of next) {
            const f = fate(k);
            if (f !== "leaves") out[f] += e.prob;
        }
        return out;
    };
    const was = snapshot(t);
    const visits = expectedVisits(nodes, live, fate);
    if (visits !== undefined) {
        const { leaving, next } = oneRound(body, visits, exit, input, t);
        const gone = lost(next);
        // Every item that set out ends somewhere. A solve that lost mass, or
        // a loop inside that could not say where its own went (its share is
        // then weighted by visits, not by chance), is no answer.
        const ended = massOf(leaving) + (t.stop - was.stop) + (t.stuck - was.stuck) + gone.never;
        const unsure = t.undecided - was.undecided + gone.undecided;
        if (unsure <= BALANCE * mass && Math.abs(ended - mass) <= BALANCE * mass) {
            for (const { state, prob } of leaving.values()) put(exits, state, prob);
            return {
                passes: massOf(visits),
                never: never + gone.never,
                undecided,
                estimated: false,
            };
        }
        Object.assign(t, was);
    }
    if (!tail) return { passes: 0, never, undecided: undecided + mass, estimated: false };
    const { leaving, next } = oneRound(body, live, exit, input, t);
    let kept = 0;
    for (const [k, e] of next) if (fate(k) === "leaves") kept += e.prob;
    const decay = kept / mass;
    if (!(decay < 1 - STUCK)) {
        // Hardly any of it left in a round: there is no tail to speak of.
        Object.assign(t, was);
        return { passes: 0, never, undecided: undecided + mass, estimated: false };
    }
    const factor = 1 / (1 - decay);
    for (const { state, prob } of leaving.values()) put(exits, state, prob * factor);
    const gone = lost(next);
    addScaled(t, was, factor - 1);
    return {
        passes: mass * factor,
        never: never + gone.never * factor,
        undecided: undecided + gone.undecided * factor,
        // A tail over little mass moves the figures little.
        estimated: mass > UNSETTLED_MASS,
    };
}

/**
 * How often each state that can leave is expected at the head over every round
 * to come, as a distribution whose weights are those visits: v = h + vQ for
 * the head's mass h and the chances Q of one such state handing on to another.
 * Solved by taking the states out one at a time (state reduction, as Grassmann,
 * Taksar and Heyman do for a chain's stationary law): with a state gone, the
 * others hand on to each other through it as well, and what a state does not
 * keep is summed from where it goes, never taken as one less what it keeps.
 * No step subtracts, so a chain whose items drift away from the exit for
 * 10^17 rounds is solved as closely as one that leaves at once. Undefined past
 * `MAX_SOLVED` states, or where one of them was not followed.
 */
function expectedVisits(
    nodes: ReadonlyMap<string, Node>,
    head: Dist,
    fate: (key: string) => Fate,
): Dist | undefined {
    const order: string[] = [];
    const at = new Map<string, number>();
    const stack = [...head.keys()];
    for (let k = stack.pop(); k !== undefined; k = stack.pop()) {
        if (at.has(k)) continue;
        const node = nodes.get(k);
        if (node === undefined || order.length >= MAX_SOLVED) return undefined;
        at.set(k, order.length);
        order.push(k);
        for (const to of node.next.keys()) if (fate(to) === "leaves") stack.push(to);
    }
    const n = order.length;
    // q[i][j]: the chance state i hands on to state j, its own row's share of
    // staying left out; away[i]: the chance it goes anywhere else for good.
    const q = new Float64Array(n * n);
    const away = new Float64Array(n);
    const h = new Float64Array(n);
    order.forEach((k, i) => {
        const node = nodes.get(k)!;
        h[i] = head.get(k)?.prob ?? 0;
        away[i] = node.gone;
        for (const [to, p] of node.next) {
            const j = at.get(to);
            if (j === undefined) away[i] += p;
            else if (j !== i) q[i * n + j] = p;
        }
    });
    // out[k]: the chance state k, once the states after it are gone, moves on
    // rather than stays.
    const out = new Float64Array(n);
    for (let k = n - 1; k >= 0; k--) {
        let s = away[k]!;
        for (let j = 0; j < k; j++) s += q[k * n + j]!;
        out[k] = s;
        if (!(s > 0)) return undefined;
        for (let j = 0; j < k; j++) h[j] = h[j]! + (h[k]! * q[k * n + j]!) / s;
        for (let i = 0; i < k; i++) {
            const through = q[i * n + k]! / s;
            if (through === 0) continue;
            away[i] = away[i]! + through * away[k]!;
            for (let j = 0; j < k; j++) {
                if (j !== i) q[i * n + j] = q[i * n + j]! + through * q[k * n + j]!;
            }
        }
    }
    const visits: Dist = new Map();
    const v = new Float64Array(n);
    for (let k = 0; k < n; k++) {
        let arrivals = h[k]!;
        for (let i = 0; i < k; i++) arrivals += v[i]! * q[i * n + k]!;
        v[k] = arrivals / out[k]!;
        if (v[k]! > 0) visits.set(order[k]!, { state: nodes.get(order[k]!)!.state, prob: v[k]! });
    }
    return visits;
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
    t.undecided += (t.undecided - was.undecided) * factor;
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
 * carried, and the weight on which it ends the craft. A restart, a stop or a
 * branch is the walk's to split, not a step's.
 */
export function advance(
    step: ChainStep,
    states: readonly { readonly state: ChainState; readonly weight: number }[],
    atoms: readonly ChainAtom[],
    caps: Readonly<Record<Gen, number>>,
): { states: { state: ChainState; weight: number }[]; ended: number } {
    const alive: Dist = new Map();
    for (const { state, weight } of states) put(alive, state, weight);
    const input: ChainInput = { atoms, body: [], starts: [], caps, exit: () => false };
    const t = totals();
    const out = [...apply(step, alive, input, t).values()].map((e) => ({
        state: e.state,
        weight: e.prob,
    }));
    return { states: out, ended: t.stop };
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
            for (const { state, prob } of alive.values()) put(t.again, state, prob);
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
            t.stuck += r.never;
            t.undecided += r.undecided;
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
            for (const [out, mass] of byOutcomes) spread(out, mass, next, t);
            return next;
        }
        case "reforge": {
            const next: Dist = new Map();
            spread(step.outcomes, massOf(alive), next, t);
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

/** `mass` over a step's outcomes: the ones that end the craft count as a stop. */
function spread(out: readonly Outcome[], mass: number, next: Dist, t: Totals): void {
    for (const o of out) {
        if (o.ends) t.stop += mass * o.prob;
        else put(next, o.state, mass * o.prob);
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
