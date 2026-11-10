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

    it("a kept modifier caught by a branch restarts the attempt", () => {
        // 2/3 with one kept suffix; exit when a suffix is gone. The first annul
        // takes a suffix with chance 3/5 and the kept one with chance 1/5: the
        // branch fires then, the exit is reached with 2/5 by the first round.
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
        expect(solved.exit + solved.restart).toBeCloseTo(1, 9);
        expect(solved.taken.get(1)).toBeCloseTo(solved.restart, 9);
        expect(solved.reached.get(2)).toBeCloseTo(solved.restart, 9);
        expect(solved.restart).toBeGreaterThan(0.2);
        expect(solved.exit).toBeGreaterThan(0.5);
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
