import { describe, expect, it } from "vitest";
import { ModId } from "../model/ids.js";
import { chain, type ChainAtom, type ChainState } from "./chain.js";

const at = (prefix: number, suffix: number, rows: (string | null)[] = []): ChainState => ({
    prefix,
    suffix,
    rows: rows.map((r) => (r === null ? null : ModId(r))),
});
const CAPS = { prefix: 3, suffix: 3 };
const NONE = { prefix: 0, suffix: 0 };

describe("a loop as a chain over the counts and the named modifiers", () => {
    it("annuls a full item until a prefix is open", () => {
        // From 3/3 each annul takes a prefix with chance 3/6, then 3/5, 3/4, 1:
        // the loop always exits, after 1 + 1/2 + 1/5 + 1/20 rounds on average.
        const solved = chain({
            atoms: [],
            body: [{ id: 0, kind: "remove" }],
            starts: [{ state: at(3, 3), weight: 1 }],
            caps: CAPS,
            exit: (s) => s.prefix <= 2,
        })!;
        expect(solved.exit).toBeCloseTo(1, 9);
        expect(solved.restart).toBeCloseTo(0, 9);
        expect(solved.passes).toBeCloseTo(1 + 1 / 2 + 1 / 5 + 1 / 20, 9);
        expect(solved.reached.get(0)).toBeCloseTo(solved.passes, 9);
    });

    it("a restart goes back to the loop's head with the item as it is", () => {
        // 2/3 with one kept suffix; exit when a suffix is gone. The first annul
        // takes a suffix with chance 3/5 and the kept one with chance 1/5: the
        // branch restarts then, and the head finds a suffix open and leaves,
        // the kept modifier gone.
        const kept: ChainAtom = { gen: "suffix", rows: [{ id: ModId("K"), weight: 1 }], weight: 1 };
        const solved = chain({
            atoms: [kept],
            body: [
                { id: 0, kind: "remove" },
                {
                    id: 1,
                    kind: "branch",
                    holds: (s) => s.rows[0] === null,
                    body: [{ id: 2, kind: "restart" }],
                },
            ],
            starts: [{ state: at(2, 3, ["K"]), weight: 1 }],
            caps: CAPS,
            exit: (s) => s.suffix <= 2,
        })!;
        expect(solved.exit).toBeCloseTo(1, 9);
        expect(solved.taken.get(1)).toBeCloseTo(solved.restart, 9);
        expect(solved.reached.get(2)).toBeCloseTo(solved.restart, 9);
        expect(solved.restart).toBeGreaterThan(0.2);
        const lost = solved.exits.filter((e) => e.state.rows[0] === null);
        expect(lost.reduce((sum, e) => sum + e.prob, 0)).toBeCloseTo(solved.restart, 9);
    });

    it("a restart in a loop inside another goes back to the inner loop's head", () => {
        // The inner loop annuls a full item until a suffix is open; each round
        // restarts, so the bench step after the branch never runs, and the
        // rounds are those of the same loop without the restart.
        const inner = (restarts: boolean) =>
            chain({
                atoms: [],
                body: [
                    {
                        id: 0,
                        kind: "loop",
                        exit: (s) => s.suffix <= 2,
                        body: [
                            { id: 1, kind: "remove" },
                            ...(restarts
                                ? ([
                                      { id: 2, kind: "restart" },
                                      { id: 3, kind: "bench", gen: "prefix" },
                                  ] as const)
                                : []),
                        ],
                    },
                    { id: 4, kind: "remove", gen: "prefix" },
                ],
                starts: [{ state: at(3, 3), weight: 1 }],
                caps: CAPS,
                exit: (s) => s.prefix <= 1,
            })!;
        const solved = inner(true);
        expect(solved.exit).toBeCloseTo(1, 9);
        expect(solved.reached.get(3) ?? 0).toBe(0);
        expect(solved.rounds.get(0)).toBeCloseTo(inner(false).rounds.get(0)!, 9);
        expect(solved.passes).toBeCloseTo(inner(false).passes, 9);
    });

    it("a removal limited to one side leaves the other alone", () => {
        const solved = chain({
            atoms: [],
            body: [{ id: 0, kind: "remove", gen: "prefix" }],
            starts: [{ state: at(3, 3), weight: 1 }],
            caps: CAPS,
            exit: (s) => s.prefix <= 2,
        })!;
        expect(solved.passes).toBeCloseTo(1, 9);
        expect(solved.exit).toBeCloseTo(1, 9);
    });

    it("starts already at the exit take no round", () => {
        const solved = chain({
            atoms: [],
            body: [{ id: 0, kind: "remove" }],
            starts: [
                { state: at(2, 3), weight: 3 },
                { state: at(3, 3), weight: 1 },
            ],
            caps: CAPS,
            exit: (s) => s.prefix <= 2,
        })!;
        expect(solved.passes).toBeCloseTo((1 + 1 / 2 + 1 / 5 + 1 / 20) / 4, 9);
    });

    it("an exalt into the last open prefix lands the wanted modifier by its share", () => {
        // One prefix slot left, the life group a quarter of the whole prefix
        // pool, the two unnamed prefixes closing two average groups: the draw
        // is life with chance 100 / (400 - 200), else the item is full and the
        // loop can never end as written.
        const life: ChainAtom = {
            gen: "prefix",
            rows: [{ id: ModId("L1"), weight: 1 }],
            weight: 100,
        };
        const solved = chain({
            atoms: [life],
            body: [
                {
                    id: 0,
                    kind: "add",
                    weight: { prefix: 400, suffix: 0 },
                    known: NONE,
                    mean: { prefix: 100, suffix: 1 },
                },
            ],
            starts: [{ state: at(2, 3, [null]), weight: 1 }],
            caps: CAPS,
            exit: (s) => s.rows[0] !== null,
        })!;
        expect(solved.exit).toBeCloseTo(0.5, 9);
        expect(solved.unresolved).toBeCloseTo(0.5, 9);
    });

    it("annul and exalt until the modifier is there, the counts carried round", () => {
        // 3/3 full of unnamed modifiers; each round removes one of six and
        // draws one back. The removal opens a prefix half the time, and the
        // draw then lands life with its share of the prefix pool less the
        // two unnamed groups still closed: 100 / (400 - 2·100) = 1/2.
        const life: ChainAtom = {
            gen: "prefix",
            rows: [{ id: ModId("L1"), weight: 1 }],
            weight: 100,
        };
        const solved = chain({
            atoms: [life],
            body: [
                { id: 0, kind: "remove" },
                {
                    id: 1,
                    kind: "add",
                    weight: { prefix: 400, suffix: 300 },
                    known: NONE,
                    mean: { prefix: 100, suffix: 100 },
                },
            ],
            starts: [{ state: at(3, 3, [null]), weight: 1 }],
            caps: CAPS,
            exit: (s) => s.rows[0] !== null,
        })!;
        // Each round succeeds with 1/2 · 1/2 and otherwise returns to 3/3.
        expect(solved.exit).toBeCloseTo(1, 6);
        expect(solved.passes).toBeCloseTo(4, 6);
        expect(solved.reached.get(1)).toBeCloseTo(solved.passes, 6);
    });

    it("a bench craft inside a branch fills the gap it tests for", () => {
        const life: ChainAtom = {
            gen: "prefix",
            rows: [{ id: ModId("L1"), weight: 1 }],
            weight: 100,
        };
        const solved = chain({
            atoms: [life],
            body: [
                {
                    id: 0,
                    kind: "branch",
                    holds: (s) => s.rows[0] === null,
                    body: [{ id: 1, kind: "bench", gen: "prefix", atom: 0, row: ModId("B") }],
                },
            ],
            starts: [{ state: at(1, 1, [null]), weight: 1 }],
            caps: CAPS,
            exit: (s) => s.rows[0] === ModId("B"),
        })!;
        expect(solved.exit).toBeCloseTo(1, 9);
        expect(solved.passes).toBeCloseTo(1, 9);
        expect(solved.taken.get(0)).toBeCloseTo(1, 9);
    });

    it("a reforge inside the body starts the item over, the else arm taking the other mass", () => {
        // While the kept modifier is there an annul runs; once it is lost the
        // reforge rolls it back with chance 1/4, so an attempt costs a reforge
        // round whenever the annul takes it.
        const kept: ChainAtom = { gen: "prefix", rows: [{ id: ModId("K"), weight: 1 }], weight: 1 };
        const solved = chain({
            atoms: [kept],
            body: [
                {
                    id: 0,
                    kind: "branch",
                    holds: (s) => s.rows[0] !== null,
                    body: [{ id: 1, kind: "remove", gen: "prefix" }],
                    otherwise: [
                        {
                            id: 2,
                            kind: "reforge",
                            outcomes: [
                                { prob: 0.25, state: at(3, 0, ["K"]) },
                                { prob: 0.75, state: at(3, 0, [null]) },
                            ],
                        },
                    ],
                },
            ],
            starts: [{ state: at(3, 0, ["K"]), weight: 1 }],
            caps: CAPS,
            exit: (s) => s.rows[0] !== null && s.prefix <= 2,
        })!;
        // The first annul takes the kept one in a third of the rounds; each such
        // loss costs four reforge rounds on average before another try.
        expect(solved.exit).toBeCloseTo(1, 6);
        expect(solved.reached.get(2)).toBeCloseTo(((1 / 3) * 4) / (2 / 3), 3);
        expect(solved.taken.get(0)).toBeCloseTo(1.5, 3);
    });

    it("says which states the exit leaves the item in", () => {
        // From 3/3 the first prefix taken ends it: after no suffix (1/2), one
        // (1/2 · 3/5), two (1/2 · 2/5 · 3/4) or all three.
        const solved = chain({
            atoms: [],
            body: [{ id: 0, kind: "remove" }],
            starts: [{ state: at(3, 3), weight: 1 }],
            caps: CAPS,
            exit: (s) => s.prefix <= 2,
        })!;
        const share = (suffix: number): number =>
            solved.exits.find((e) => e.state.prefix === 2 && e.state.suffix === suffix)?.prob ?? 0;
        expect(share(3)).toBeCloseTo(1 / 2, 9);
        expect(share(2)).toBeCloseTo(3 / 10, 9);
        expect(share(1)).toBeCloseTo(3 / 20, 9);
        expect(share(0)).toBeCloseTo(1 / 20, 9);
    });

    it("a rare exit is followed to its end, not cut off", () => {
        // A reforge that lands the exit one time in 10 000: 10 000 rounds on
        // average, far more than the rounds the chain follows one by one.
        const p = 1e-4;
        const solved = chain({
            atoms: [],
            body: [
                {
                    id: 0,
                    kind: "reforge",
                    outcomes: [
                        { state: at(1, 0), prob: p },
                        { state: at(0, 1), prob: 1 - p },
                    ],
                },
            ],
            starts: [{ state: at(0, 1), weight: 1 }],
            caps: CAPS,
            exit: (s) => s.prefix === 1,
        })!;
        expect(solved.unresolved).toBeCloseTo(0, 9);
        expect(solved.exit).toBeCloseTo(1, 9);
        expect(solved.passes / (1 / p)).toBeCloseTo(1, 6);
        expect(solved.reached.get(0)! / (1 / p)).toBeCloseTo(1, 6);
    });

    it("a chain that has not settled within the rounds followed is solved over its states", () => {
        // From A the item reaches B one round in ten thousand; from B the exit
        // comes one round in a thousand. The decay is still climbing after the
        // rounds the chain follows; the rounds to come are then the expected
        // visits to the two states, solved for outright.
        const A = at(0, 1);
        const B = at(1, 1);
        const solved = chain({
            atoms: [],
            body: [
                {
                    id: 0,
                    kind: "branch",
                    holds: (s) => s.prefix === 0,
                    body: [
                        {
                            id: 1,
                            kind: "reforge",
                            outcomes: [
                                { state: B, prob: 1e-4 },
                                { state: A, prob: 1 - 1e-4 },
                            ],
                        },
                    ],
                    otherwise: [
                        {
                            id: 2,
                            kind: "reforge",
                            outcomes: [
                                { state: at(2, 1), prob: 1e-3 },
                                { state: B, prob: 1 - 1e-3 },
                            ],
                        },
                    ],
                },
            ],
            starts: [{ state: A, weight: 1 }],
            caps: CAPS,
            exit: (s) => s.prefix === 2,
        })!;
        expect(solved.unresolved).toBeCloseTo(0, 9);
        expect(solved.exit).toBeCloseTo(1, 9);
        expect(solved.estimated).toBe(false);
        // 10 000 rounds in A and 1 000 in B on average.
        expect(solved.passes / 11000).toBeCloseTo(1, 9);
        expect(solved.reached.get(1)! / 10000).toBeCloseTo(1, 9);
        expect(solved.reached.get(2)! / 1000).toBeCloseTo(1, 9);
    });

    /** Two kinds of item that never turn into one another, each leaving for
     *  the exit at its own rate. */
    const twoKinds = (rateA: number, rateB: number, weightA: number, weightB: number) => {
        const [E, A, B] = [at(0, 0), at(1, 0), at(2, 0)];
        const from = (s: ChainState, rate: number) =>
            [
                { state: E, prob: rate },
                { state: s, prob: 1 - rate },
            ].filter((o) => o.prob > 0);
        const [outA, outB] = [from(A, rateA), from(B, rateB)];
        return chain({
            atoms: [],
            body: [{ id: 0, kind: "transition", next: (s) => (s.prefix === 1 ? outA : outB) }],
            starts: [
                { state: A, weight: weightA },
                { state: B, weight: weightB },
            ],
            caps: CAPS,
            exit: (s) => s.prefix === 0,
        })!;
    };

    it("items that leave slowly beside ones that leave slower still all leave", () => {
        // One round in a thousand and one in twenty thousand, half each: the
        // shape moves as fast as the mass goes for longer than the rounds
        // followed, yet every item can reach the exit.
        const solved = twoKinds(1e-3, 5e-5, 1, 1);
        expect(solved.exit).toBeCloseTo(1, 9);
        expect(solved.unresolved).toBeCloseTo(0, 9);
        expect(solved.undecided).toBe(0);
        expect(solved.passes / (0.5 * 1000 + 0.5 * 20000)).toBeCloseTo(1, 9);
        expect(solved.estimated).toBe(false);
    });

    it("items that never leave are not summed with the ones draining beside them", () => {
        // A tenth of the items cannot reach the exit; the rest leave one
        // round in ten thousand.
        const solved = twoKinds(1e-4, 0, 9, 1);
        expect(solved.exit).toBeCloseTo(0.9, 9);
        expect(solved.unresolved).toBeCloseTo(0.1, 9);
        expect(solved.undecided).toBe(0);
        // However small the share, and however fast the rest drains.
        const few = twoKinds(0.5, 0, 996, 4);
        expect(few.exit).toBeCloseTo(0.996, 9);
        expect(few.unresolved).toBeCloseTo(0.004, 9);
        // The rounds are the two the leaving items take, not the rounds the
        // stuck ones were followed for.
        expect(few.passes).toBeGreaterThan(1.99);
        expect(few.passes).toBeLessThan(2.3);
    });

    it("items that drift away from the exit for longer than any count of rounds are solved all the same", () => {
        // A walk on eighteen states, a step away from the exit nine times in
        // ten and a wall at the far end: every item comes back, after some
        // 10^17 rounds. Taking each state's chance of moving on as one less
        // its chance of staying loses it to rounding here.
        const n = 18;
        const states = Array.from({ length: n + 1 }, (_x, i) => at(i, 0));
        const next = states.map((s, i) => [
            { state: states[i - 1] ?? s, prob: 0.1 },
            { state: states[i + 1] ?? s, prob: 0.9 },
        ]);
        const solved = chain({
            atoms: [],
            body: [{ id: 0, kind: "transition", next: (s) => next[s.prefix]! }],
            starts: [{ state: states[1]!, weight: 1 }],
            caps: CAPS,
            exit: (s) => s.prefix === 0,
        })!;
        let truth = 0;
        for (let k = 1; k <= n; k++) truth += 10 * 9 ** (k - 1);
        expect(solved.exit).toBeCloseTo(1, 9);
        expect(solved.undecided).toBe(0);
        expect(solved.passes / truth).toBeCloseTo(1, 9);
    });

    it("an item that may turn into one that never leaves counts by its chance of doing so", () => {
        // Each round: the exit one time in ten thousand, a dead end as often.
        const [E, A, dead] = [at(0, 0), at(1, 0), at(2, 0)];
        const out = [
            { state: E, prob: 1e-4 },
            { state: dead, prob: 1e-4 },
            { state: A, prob: 1 - 2e-4 },
        ];
        const solved = chain({
            atoms: [],
            body: [
                {
                    id: 0,
                    kind: "transition",
                    next: (s) => (s.prefix === 1 ? out : [{ state: s, prob: 1 }]),
                },
            ],
            starts: [{ state: A, weight: 1 }],
            caps: CAPS,
            exit: (s) => s.prefix === 0,
        })!;
        expect(solved.exit).toBeCloseTo(0.5, 9);
        expect(solved.unresolved).toBeCloseTo(0.5, 9);
    });

    it("past the states it solves for, the rest is the next round's tail, an estimate", () => {
        // A ring of six hundred states walked one a round, the exit one round
        // in ten thousand from any of them: the shape never settles.
        const ring = 600;
        const solved = chain({
            atoms: [],
            body: [
                {
                    id: 0,
                    kind: "transition",
                    next: (s) => [
                        { state: at(0, 0), prob: 1e-4 },
                        { state: at(1, (s.suffix % ring) + 1), prob: 1 - 1e-4 },
                    ],
                },
            ],
            starts: [{ state: at(1, 1), weight: 1 }],
            caps: { prefix: 3, suffix: ring },
            exit: (s) => s.prefix === 0,
        })!;
        expect(solved.estimated).toBe(true);
        expect(solved.exit).toBeCloseTo(1, 9);
        expect(solved.undecided).toBe(0);
        expect(solved.passes / 10000).toBeCloseTo(1, 6);
    });

    it("says so where the states are too many to tell which can leave", () => {
        // Every round a state not seen before, none of them the exit.
        const solved = chain({
            atoms: [],
            body: [
                {
                    id: 0,
                    kind: "transition",
                    next: (s) => [{ state: at(1, s.suffix + 1), prob: 1 }],
                },
            ],
            starts: [{ state: at(1, 0), weight: 1 }],
            caps: { prefix: 3, suffix: 1e9 },
            exit: (s) => s.prefix === 0,
        })!;
        expect(solved.exit).toBe(0);
        expect(solved.unresolved).toBe(0);
        expect(solved.undecided).toBeCloseTo(1, 9);
    });

    it("waits for the distribution's shape to settle, not only the share that leaves", () => {
        // From A and from B the exit comes with chance p each round, so the
        // mass leaves at one steady rate from the first round; but A drifts to
        // B, and a branch taken in A alone counts the rounds spent there.
        const p = 1e-3;
        const q = 0.01;
        const A = at(0, 1);
        const B = at(1, 1);
        const E = at(2, 1);
        const solved = chain({
            atoms: [],
            body: [
                {
                    id: 0,
                    kind: "branch",
                    holds: (s) => s.prefix === 0,
                    body: [
                        {
                            id: 1,
                            kind: "reforge",
                            outcomes: [
                                { state: E, prob: p },
                                { state: B, prob: q },
                                { state: A, prob: 1 - p - q },
                            ],
                        },
                    ],
                    otherwise: [
                        {
                            id: 2,
                            kind: "reforge",
                            outcomes: [
                                { state: E, prob: p },
                                { state: B, prob: 1 - p },
                            ],
                        },
                    ],
                },
            ],
            starts: [{ state: A, weight: 1 }],
            caps: CAPS,
            exit: (s) => s.prefix === 2,
        })!;
        expect(solved.estimated).toBe(false);
        // Taken from the first round's mix these would be off by a tenth.
        expect(solved.passes * p).toBeCloseTo(1, 3);
        expect(solved.taken.get(0)! * (p + q)).toBeCloseTo(1, 3);
    });

    it("a loop that cannot end is left unresolved", () => {
        // Exalts on a 3/3 item: nothing ever changes, the exit never comes.
        const solved = chain({
            atoms: [],
            body: [
                {
                    id: 0,
                    kind: "add",
                    weight: { prefix: 100, suffix: 100 },
                    known: NONE,
                    mean: { prefix: 1, suffix: 1 },
                },
            ],
            starts: [{ state: at(3, 3), weight: 1 }],
            caps: CAPS,
            exit: (s) => s.prefix === 4,
        })!;
        expect(solved.unresolved).toBeCloseTo(1, 9);
        expect(solved.exit).toBeCloseTo(0, 9);
    });

    it("counts apart the attempts that hold the exit before any round", () => {
        const solved = chain({
            atoms: [],
            body: [{ id: 0, kind: "remove" }],
            starts: [
                { state: at(2, 3), weight: 3 },
                { state: at(3, 3), weight: 1 },
            ],
            caps: CAPS,
            exit: (s) => s.prefix <= 2,
        })!;
        expect(solved.exitAtStart).toBeCloseTo(3 / 4, 9);
        expect(solved.exit).toBeCloseTo(1, 9);
    });

    it("a transition takes each state where its function says", () => {
        // From any state, the exit with chance 1/4: four rounds on average.
        const solved = chain({
            atoms: [],
            body: [
                {
                    id: 0,
                    kind: "transition",
                    next: (s) => [
                        { state: at(9, 9), prob: 1 / 4 },
                        { state: s, prob: 3 / 4 },
                    ],
                },
            ],
            starts: [{ state: at(0, 0), weight: 1 }],
            caps: CAPS,
            exit: (s) => s.prefix === 9,
        })!;
        expect(solved.exit).toBeCloseTo(1, 9);
        expect(solved.passes).toBeCloseTo(4, 6);
    });

    it("a loop inside the loop goes round until its own exit each time it is reached", () => {
        // Inside: annul the prefixes away, three rounds from three. Then the
        // outer exit half the time, else the prefixes back: two outer rounds,
        // six inner ones.
        const solved = chain({
            atoms: [],
            body: [
                {
                    id: 0,
                    kind: "loop",
                    exit: (s) => s.prefix === 0,
                    body: [{ id: 1, kind: "remove", gen: "prefix" }],
                },
                {
                    id: 2,
                    kind: "transition",
                    next: () => [
                        { state: at(9, 0), prob: 1 / 2 },
                        { state: at(3, 0), prob: 1 / 2 },
                    ],
                },
            ],
            starts: [{ state: at(3, 0), weight: 1 }],
            caps: { prefix: 9, suffix: 9 },
            exit: (s) => s.prefix === 9,
        })!;
        expect(solved.passes).toBeCloseTo(2, 6);
        expect(solved.rounds.get(0)).toBeCloseTo(6, 6);
        expect(solved.reached.get(1)).toBeCloseTo(6, 6);
        expect(solved.reached.get(0)).toBeCloseTo(2, 6);
    });

    it("a loop inside a loop shares the outer loop's bound on the work done", () => {
        // Neither loop settles: the item walks a ring of a hundred states,
        // leaving it for the inner exit one round in ten thousand and for the
        // outer one in a thousand. Each inner loop alone would carry its full
        // bound, once per outer round.
        let calls = 0;
        const step = (s: ChainState) => at(s.prefix, (s.suffix % 100) + 1);
        const solved = chain({
            atoms: [],
            body: [
                {
                    id: 0,
                    kind: "loop",
                    exit: (s) => s.prefix === 2,
                    body: [
                        {
                            id: 1,
                            kind: "transition",
                            next: (s) => {
                                calls++;
                                const on = step(s);
                                const p = s.prefix === 0 ? 1e-4 : 1e-3;
                                return [
                                    { state: at(s.prefix + 1, on.suffix), prob: p },
                                    { state: on, prob: 1 - p },
                                ];
                            },
                        },
                    ],
                },
                {
                    id: 2,
                    kind: "transition",
                    next: (s) => [
                        { state: at(3, s.suffix), prob: 1e-3 },
                        { state: at(0, s.suffix), prob: 1 - 1e-3 },
                    ],
                },
            ],
            starts: [{ state: at(0, 1), weight: 1 }],
            caps: { prefix: 9, suffix: 100 },
            exit: (s) => s.prefix === 3,
        })!;
        expect(calls).toBeLessThan(1_000_000);
        expect(solved.exit).toBeCloseTo(1, 6);
    });

    /**
     * Kinds of item on a ring, each round opening with a loop inside. The
     * round ends the outer loop with chance `leave`; otherwise the item is
     * the next kind half the time, and either way back at suffix `from`,
     * short of the inner exit at suffix zero. `inner` is one inner round:
     * the suffixes it may leave and their chances.
     */
    const ring = (
        kinds: number,
        leave: number,
        from: number,
        inner: (kind: number, suffix: number) => [suffix: number, prob: number][],
    ) => {
        const states = new Map<string, ChainState>();
        const st = (p: number, s: number): ChainState => {
            const k = `${p}/${s}`;
            const hit = states.get(k) ?? at(p, s);
            states.set(k, hit);
            return hit;
        };
        const outs = new Map<ChainState, { state: ChainState; prob: number }[]>();
        const memo = (s: ChainState, make: () => { state: ChainState; prob: number }[]) => {
            const out = outs.get(s) ?? make();
            outs.set(s, out);
            return out;
        };
        return chain({
            atoms: [],
            body: [
                {
                    id: 1,
                    kind: "loop",
                    exit: (s) => s.suffix === 0,
                    body: [
                        {
                            id: 2,
                            kind: "transition",
                            next: (s) =>
                                memo(s, () =>
                                    inner(s.prefix, s.suffix).map(([suffix, prob]) => ({
                                        state: st(s.prefix, suffix),
                                        prob,
                                    })),
                                ),
                        },
                    ],
                },
                {
                    id: 3,
                    kind: "transition",
                    next: (s) =>
                        memo(s, () => [
                            { state: st(0, 0), prob: leave },
                            { state: st((s.prefix % kinds) + 1, from), prob: 0.5 },
                            { state: st(s.prefix, from), prob: 0.5 - leave },
                        ]),
                },
            ],
            starts: [{ state: st(1, from), weight: 1 }],
            caps: CAPS,
            exit: (s) => s.prefix === 0,
        })!;
    };

    /**
     * How often each kind of a ring is at the outer head, from kind one. A
     * kind keeps the item with chance 1/2 - leave and gets the one before
     * it with chance 1/2, so each is visited r = (1/2) / (1/2 + leave) times
     * as often as the one before, and kind one once more than the last kind
     * hands it: v1 (1/2 + leave) = 1 + v1 r^(kinds - 1) / 2.
     */
    const ringVisits = (kinds: number, leave: number): ((kind: number) => number) => {
        const r = 0.5 / (0.5 + leave);
        const first = 1 / ((0.5 + leave) * (1 - r ** kinds));
        return (kind) => first * r ** (kind - 1);
    };

    /** The inner rounds of a ring whose kind k takes `perEntry(k)` each time. */
    const ringRounds = (kinds: number, leave: number, perEntry: (kind: number) => number) => {
        const visits = ringVisits(kinds, leave);
        let rounds = 0;
        for (let kind = 1; kind <= kinds; kind++) rounds += visits(kind) * perEntry(kind);
        return rounds;
    };

    /** Odd kinds leave their inner loop one round in four, even ones one in
     *  two thousand, both hopping between `states` inner states meanwhile. */
    const quick = (kind: number) => (kind % 2 === 1 ? 0.5 : 1e-3);
    const hopping =
        (states: number) =>
        (kind: number, suffix: number): [number, number][] => [
            [0, quick(kind) / 2],
            [(suffix % states) + 1, quick(kind) / 2],
            [suffix, 1 - quick(kind)],
        ];
    const countdown =
        (step: number) =>
        (_kind: number, suffix: number): [number, number][] => [
            [suffix - 1, step],
            [suffix, 1 - step],
        ];

    it.each([1e-2, 1e-4])(
        "a loop inside is solved for each kind of item entering it, not for every kind at once (outer exit %f)",
        (leave) => {
            // Three hundred kinds, two inner states each. The kinds never
            // mix inside, so what all of them together lose in a round says
            // nothing of the rounds to come: the quick kinds are gone at once
            // and the slow ones stay two thousand rounds.
            const solved = ring(300, leave, 1, hopping(2));
            const rounds = ringRounds(300, leave, (kind) => 2 / quick(kind));
            expect(solved.rounds.get(1)! / rounds).toBeCloseTo(1, 6);
            expect(solved.passes * leave).toBeCloseTo(1, 6);
            expect(solved.exit).toBeCloseTo(1, 6);
            expect(solved.undecided).toBeCloseTo(0, 6);
            expect(solved.estimated).toBe(false);
            expect(solved.estimatedLoops.size).toBe(0);
        },
    );

    it("kinds with a single inner state each are solved the same way", () => {
        const solved = ring(450, 1e-2, 1, hopping(1));
        const rounds = ringRounds(450, 1e-2, (kind) => 2 / quick(kind));
        expect(solved.rounds.get(1)! / rounds).toBeCloseTo(1, 6);
        expect(solved.passes / 100).toBeCloseTo(1, 6);
        expect(solved.undecided).toBeCloseTo(0, 6);
        expect(solved.estimated).toBe(false);
    });

    it("an inner countdown entered from a hundred kinds is five states for each, not five hundred", () => {
        // Five steps down at one round in two: ten inner rounds each time.
        const solved = ring(100, 1e-2, 5, countdown(0.5));
        expect(solved.rounds.get(1)! / ringRounds(100, 1e-2, () => 5 / 0.5)).toBeCloseTo(1, 6);
        expect(solved.passes / 100).toBeCloseTo(1, 6);
        expect(solved.undecided).toBeCloseTo(0, 6);
        expect(solved.estimated).toBe(false);
    });

    it("an outer loop over more kinds than are solved outright is estimated from its own rounds", () => {
        // A thousand kinds: the loops inside are solved kind by kind and
        // leave the outer loop the work to follow its own rounds, whose decay
        // then stands for the rest.
        const solved = ring(1000, 1e-5, 5, countdown(0.01));
        expect(solved.rounds.get(1)! / ringRounds(1000, 1e-5, () => 5 / 0.01)).toBeCloseTo(1, 6);
        expect(solved.passes / 1e5).toBeCloseTo(1, 6);
        expect(solved.undecided).toBeCloseTo(0, 6);
        expect(solved.estimated).toBe(true);
        expect(solved.estimatedLoops.size).toBe(0);
    });

    it("a loop inside that cannot say where its items go leaves the outer loop undecided, as a share", () => {
        // Each kind's loop inside walks five hundred states, more than are
        // solved outright; followed round by round instead, the first one
        // takes the work and the rest are not followed at all.
        const [kinds, far] = [30, 500];
        const cache = new Map<string, ChainState>();
        const st = (p: number, s: number): ChainState => {
            const k = `${p}/${s}`;
            const hit = cache.get(k) ?? at(p, s);
            cache.set(k, hit);
            return hit;
        };
        const inner = new Map<ChainState, { state: ChainState; prob: number }[]>();
        const walk = (s: ChainState) => {
            let out = inner.get(s);
            if (out === undefined) {
                out =
                    s.suffix >= far
                        ? [
                              { state: st(s.prefix, s.suffix - 1), prob: 0.5 },
                              { state: s, prob: 0.5 },
                          ]
                        : [
                              { state: st(s.prefix, s.suffix - 1), prob: 0.3 },
                              { state: st(s.prefix, s.suffix + 1), prob: 0.3 },
                              { state: s, prob: 0.4 },
                          ];
                inner.set(s, out);
            }
            return out;
        };
        const solved = chain({
            atoms: [],
            body: [
                {
                    id: 1,
                    kind: "loop",
                    exit: (s) => s.suffix === 0,
                    body: [{ id: 2, kind: "transition", next: walk }],
                },
                {
                    id: 3,
                    kind: "transition",
                    next: (s) => [
                        { state: st(0, 0), prob: 1e-5 },
                        { state: st((s.prefix % kinds) + 1, 5), prob: 0.5 },
                        { state: st(s.prefix, 3), prob: 0.5 - 1e-5 },
                    ],
                },
            ],
            starts: [{ state: st(1, 3), weight: 1 }],
            caps: CAPS,
            exit: (s) => s.prefix === 0,
        })!;
        expect(solved.undecided).toBeGreaterThan(0.5);
        expect(solved.undecided).toBeLessThanOrEqual(1);
        expect(solved.exit + solved.stop + solved.unresolved + solved.undecided).toBeCloseTo(1, 6);
    });

    it("a loop cut short by the work of the loops inside is left undecided, not estimated", () => {
        // Each kind's loop inside is a sure countdown one state longer than
        // is solved outright, so it is followed round by round and takes its
        // length in work. That runs out with the outer loop a few hundred
        // rounds in and the items on the first kinds only: those rounds'
        // decay says nothing of the rest.
        const solved = ring(450, 1e-5, 401, (_kind, suffix) => [[suffix - 1, 1]]);
        expect(solved.estimated).toBe(false);
        expect(solved.undecided).toBeGreaterThan(0.99);
        expect(solved.undecided).toBeLessThanOrEqual(1);
    });

    it("a way on too faint to follow leaves the loop undecided, not stuck", () => {
        // One round in 2^50 reaches the exit: the loop does end, after more
        // rounds than are followed, and "never" would be wrong of it.
        const A = at(1, 0);
        const out = [
            { state: at(0, 0), prob: 2 ** -50 },
            { state: A, prob: 1 - 2 ** -50 },
        ];
        const solved = chain({
            atoms: [],
            body: [{ id: 0, kind: "transition", next: () => out }],
            starts: [{ state: A, weight: 1 }],
            caps: CAPS,
            exit: (s) => s.prefix === 0,
        })!;
        expect(solved.unresolved).toBe(0);
        expect(solved.undecided).toBeCloseTo(1, 9);
    });

    it("says the same of such a way out of a loop inside", () => {
        const solved = ring(1, 1e-2, 1, (_kind, suffix) => [
            [0, 2 ** -50],
            [suffix, 1 - 2 ** -50],
        ]);
        expect(solved.unresolved).toBe(0);
        expect(solved.stuckInside).toBe(0);
        expect(solved.undecided).toBeCloseTo(1, 9);
    });

    it("the last of the mass, too little to follow further, is not counted as never leaving", () => {
        // A loop inside too long to solve outright is followed until a
        // billionth of the items is left in it. Over the outer loop's hundred
        // thousand rounds that adds up, and none of it is stuck.
        const solved = ring(1, 1e-5, 401, countdown(0.9));
        expect(solved.unresolved).toBe(0);
        expect(solved.stuckInside).toBe(0);
        expect(solved.undecided).toBeGreaterThan(0);
        expect(solved.undecided).toBeLessThan(1e-3);
        expect(solved.passes / 1e5).toBeCloseTo(1, 3);
    });

    it("says when the mass that never leaves is held by a loop inside", () => {
        // Inside: a loop waiting for no prefix while nothing in it removes one.
        const solved = chain({
            atoms: [],
            body: [
                {
                    id: 0,
                    kind: "loop",
                    exit: (s) => s.prefix === 0,
                    body: [{ id: 1, kind: "transition", next: (s) => [{ state: s, prob: 1 }] }],
                },
                { id: 2, kind: "remove", gen: "prefix" },
            ],
            starts: [{ state: at(1, 0), weight: 1 }],
            caps: CAPS,
            exit: (s) => s.suffix === 1,
        })!;
        expect(solved.unresolved).toBeCloseTo(1, 6);
        expect(solved.stuckInside).toBeCloseTo(1, 6);
    });

    it("an outcome that ends the craft counts as a stop", () => {
        // Each round: the item destroyed one time in four, the exit as often.
        const solved = chain({
            atoms: [],
            body: [
                {
                    id: 0,
                    kind: "transition",
                    next: (s) => [
                        { state: s, prob: 1 / 4, ends: true },
                        { state: at(0, 0), prob: 1 / 4 },
                        { state: s, prob: 1 / 2 },
                    ],
                },
            ],
            starts: [{ state: at(1, 0), weight: 1 }],
            caps: CAPS,
            exit: (s) => s.prefix === 0,
        })!;
        expect(solved.stop).toBeCloseTo(1 / 2, 9);
        expect(solved.exit).toBeCloseTo(1 / 2, 9);
        expect(solved.passes).toBeCloseTo(2, 9);
        expect(solved.unresolved).toBeCloseTo(0, 9);
    });

    it("a body that changes nothing is not a chain", () => {
        expect(
            chain({
                atoms: [],
                body: [{ id: 0, kind: "other" }],
                starts: [{ state: at(3, 3), weight: 1 }],
                caps: CAPS,
                exit: () => false,
            }),
        ).toBeUndefined();
    });
});
