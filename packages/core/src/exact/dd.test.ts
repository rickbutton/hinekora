// eslint-disable-next-line no-restricted-imports -- test only: a deterministic collection
import * as v8 from "node:v8";
// eslint-disable-next-line no-restricted-imports -- test only: a deterministic collection
import * as vm from "node:vm";
import { describe, expect, it, vi } from "vitest";
import { type Dd, DdBudgetError, DdManager, type DdRelation } from "./dd.js";

// These compare against sets listed in full; beside the rest of the suite
// they run several times slower than alone.
vi.setConfig({ testTimeout: 60_000 });

function rng(seed: number): () => number {
    let s = seed >>> 0;
    return () => {
        s = (s + 0x6d2b79f5) >>> 0;
        let t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** Explicit sets of assignments, an assignment encoded in mixed radix with slot 0 first. */
class Universe {
    readonly size: number;
    constructor(readonly domains: readonly number[]) {
        this.size = domains.reduce((p, d) => p * d, 1);
    }
    decode(i: number): number[] {
        const x = new Array<number>(this.domains.length);
        for (let s = this.domains.length - 1; s >= 0; s--) {
            const d = this.domains[s]!;
            x[s] = i % d;
            i = Math.floor(i / d);
        }
        return x;
    }
    encode(x: readonly number[]): number {
        let i = 0;
        for (let s = 0; s < this.domains.length; s++) i = i * this.domains[s]! + x[s]!;
        return i;
    }
    filter(f: (x: number[]) => boolean): Set<number> {
        const out = new Set<number>();
        for (let i = 0; i < this.size; i++) if (f(this.decode(i))) out.add(i);
        return out;
    }
}

/** Lists a diagram's assignments by walking it; test code only. */
function toSet(m: DdManager, a: Dd): Set<number> {
    const u = new Universe(m.domains);
    const out = new Set<number>();
    const x = new Array<number>(m.numSlots).fill(0);
    const walk = (n: Dd, slot: number): void => {
        if (n === m.EMPTY) return;
        if (slot === m.numSlots) {
            out.add(u.encode(x));
            return;
        }
        const tested = m.top(n) === slot;
        for (let v = 0; v < m.domains[slot]!; v++) {
            x[slot] = v;
            walk(tested ? m.child(n, v) : n, slot + 1);
        }
    };
    walk(a, 0);
    return out;
}

/**
 * The diagram of an explicit set. It is built by `automaton`, itself under test; the check's
 * independence comes from `toSet`, which reads the diagram without any operation.
 */
function fromSet(m: DdManager, set: ReadonlySet<number>): Dd {
    return m.automaton<number>({
        init: 0,
        step: (s, v, st) => st * m.domains[s]! + v,
        accept: (st) => set.has(st),
        key: (st) => st,
    });
}

function sorted(set: ReadonlySet<number>): number[] {
    return [...set].sort((x, y) => x - y);
}

function randomDomains(r: () => number): number[] {
    const n = 3 + Math.floor(r() * 5);
    return Array.from({ length: n }, () => 1 + Math.floor(r() * 4));
}

function randomSubset(r: () => number, d: number, p = 0.5): number[] {
    const out: number[] = [];
    for (let v = 0; v < d; v++) if (r() < p) out.push(v);
    return out;
}

type Table = (readonly number[] | undefined)[][];

function randomRelation(r: () => number, domains: readonly number[]): Table {
    return domains.map((d) => {
        if (r() < 0.3) return new Array<undefined>(d).fill(undefined);
        return Array.from({ length: d }, () => {
            const p = r();
            if (p < 0.3) return undefined;
            if (p < 0.4) return [];
            const image = randomSubset(r, d, 0.4);
            // A value listed twice must count once.
            return r() < 0.2 && image.length > 0 ? [...image, image[0]!] : image;
        });
    });
}

function relOf(t: Table): DdRelation {
    return (s, v) => t[s]![v];
}

function expectMapOne(u: Universe, a: ReadonlySet<number>, t: Table): Set<number> {
    const out = new Set<number>();
    for (const i of a) {
        const x = u.decode(i);
        for (let s = 0; s < x.length; s++) {
            for (const w of t[s]![x[s]!] ?? []) {
                const y = [...x];
                y[s] = w;
                out.add(u.encode(y));
            }
        }
    }
    return out;
}

/** Slots change independently, so the image is the composition of the per-slot images. */
function expectMapEach(u: Universe, a: ReadonlySet<number>, t: Table): Set<number> {
    let cur = new Set(a);
    for (let s = 0; s < u.domains.length; s++) {
        const next = new Set<number>();
        for (const i of cur) {
            const x = u.decode(i);
            for (const w of t[s]![x[s]!] ?? [x[s]!]) {
                const y = [...x];
                y[s] = w;
                next.add(u.encode(y));
            }
        }
        cur = next;
    }
    return cur;
}

interface RandomAutomaton {
    slots: number[] | undefined;
    next: (number | undefined)[][][];
    accept: boolean[];
}

function randomAutomaton(r: () => number, domains: readonly number[]): RandomAutomaton {
    const k = 1 + Math.floor(r() * 4);
    const slots = r() < 0.5 ? undefined : domains.map((_, s) => s).filter(() => r() < 0.6);
    const next = domains.map((d) =>
        Array.from({ length: d }, () =>
            Array.from({ length: k }, () => (r() < 0.15 ? undefined : Math.floor(r() * k))),
        ),
    );
    const accept = Array.from({ length: k }, () => r() < 0.6);
    return { slots, next, accept };
}

function buildAutomaton(m: DdManager, a: RandomAutomaton): Dd {
    return m.automaton<number>({
        init: 0,
        ...(a.slots === undefined ? {} : { slots: a.slots }),
        step: (s, v, st) => a.next[s]![v]![st],
        accept: (st) => a.accept[st]!,
        key: (st) => st,
    });
}

function runAutomaton(a: RandomAutomaton, x: readonly number[]): boolean {
    let st: number | undefined = 0;
    for (let s = 0; s < x.length && st !== undefined; s++) {
        if (a.slots !== undefined && !a.slots.includes(s)) continue;
        st = a.next[s]![x[s]!]![st];
    }
    return st !== undefined && a.accept[st]!;
}

interface Entry {
    dd: Dd;
    set: Set<number>;
}

function checkEntry(m: DdManager, u: Universe, e: Entry, r: () => number): void {
    expect(sorted(toSet(m, e.dd))).toEqual(sorted(e.set));
    expect(fromSet(m, e.set)).toBe(e.dd);
    expect(m.isEmpty(e.dd)).toBe(e.set.size === 0);
    expect(m.count(e.dd)).toBe(BigInt(e.set.size));
    const w = m.witness(e.dd);
    if (e.set.size === 0) expect(w).toBeUndefined();
    else {
        expect(w).toHaveLength(m.numSlots);
        expect(e.set.has(u.encode(w!))).toBe(true);
    }
    const xs = [...e.set].map((i) => u.decode(i));
    for (let s = 0; s < m.numSlots; s++) {
        const values = new Set(xs.map((x) => x[s]!));
        expect(m.valuesOf(e.dd, s)).toEqual(sorted(values));
    }
    const weights = u.domains.map((d) => Array.from({ length: d }, () => Math.floor(r() * 7) - 2));
    const sums = xs.map((x) => x.reduce((acc, v, s) => acc + weights[s]![v]!, 0));
    const extent = m.extent(e.dd, (s, v) => weights[s]![v]!);
    if (sums.length === 0) expect(extent).toBeUndefined();
    else expect(extent).toEqual([Math.min(...sums), Math.max(...sums)]);
    const depends = u.domains
        .map((_, s) => s)
        .filter((s) =>
            xs.some((x) =>
                Array.from({ length: u.domains[s]! }, (_, v) => v).some((v) => {
                    const y = [...x];
                    y[s] = v;
                    return !e.set.has(u.encode(y));
                }),
            ),
        );
    expect(m.support(e.dd)).toEqual(depends);
    for (const x of xs.slice(0, 5)) expect(m.contains(e.dd, x)).toBe(true);
    const probe = u.decode(Math.floor(r() * u.size));
    const s = Math.floor(r() * m.numSlots);
    const outside = [...probe];
    outside[s] = r() < 0.5 ? -1 : u.domains[s]!;
    expect(() => m.contains(e.dd, outside)).toThrow(RangeError);
    expect(() => m.contains(e.dd, probe.slice(1))).toThrow(RangeError);
    expect(() => m.contains(e.dd, [...probe, 0])).toThrow(RangeError);
}

function randomStep(m: DdManager, u: Universe, pool: Entry[], r: () => number): Entry | undefined {
    const pick = (): Entry => pool[Math.floor(r() * pool.length)]!;
    const N = m.numSlots;
    const slot = (): number => Math.floor(r() * N);
    const a = pick();
    const b = pick();
    switch (Math.floor(r() * 13)) {
        case 0:
            return { dd: m.and(a.dd, b.dd), set: new Set([...a.set].filter((i) => b.set.has(i))) };
        case 1:
            return { dd: m.or(a.dd, b.dd), set: new Set([...a.set, ...b.set]) };
        case 2:
            return {
                dd: m.diff(a.dd, b.dd),
                set: new Set([...a.set].filter((i) => !b.set.has(i))),
            };
        case 3:
            return { dd: m.not(a.dd), set: u.filter((x) => !a.set.has(u.encode(x))) };
        case 4: {
            const s = slot();
            const values = randomSubset(r, u.domains[s]!);
            return { dd: m.slotIn(s, values), set: u.filter((x) => values.includes(x[s]!)) };
        }
        case 5: {
            const slots = u.domains.map((_, s) => s).filter(() => r() < 0.4);
            const keyOf = (x: readonly number[]): string =>
                x.map((v, s) => (slots.includes(s) ? "*" : v)).join(",");
            const keys = new Set([...a.set].map((i) => keyOf(u.decode(i))));
            return { dd: m.forget(a.dd, slots), set: u.filter((x) => keys.has(keyOf(x))) };
        }
        case 6: {
            const s = slot();
            const v = Math.floor(r() * u.domains[s]!);
            const set = new Set<number>();
            for (const i of a.set) {
                const y = u.decode(i);
                y[s] = v;
                set.add(u.encode(y));
            }
            return { dd: m.set(a.dd, s, v), set };
        }
        case 7: {
            const t = randomRelation(r, u.domains);
            return { dd: m.mapOne(a.dd, relOf(t)), set: expectMapOne(u, a.set, t) };
        }
        case 8: {
            const t = randomRelation(r, u.domains);
            return { dd: m.mapEach(a.dd, relOf(t)), set: expectMapEach(u, a.set, t) };
        }
        case 9: {
            const auto = randomAutomaton(r, u.domains);
            return { dd: buildAutomaton(m, auto), set: u.filter((x) => runAutomaton(auto, x)) };
        }
        case 10: {
            const pairs: [number, number][] = [];
            for (let s = 0; s + 1 < N; s++) {
                for (let t = s + 1; t < N; t++) {
                    if (u.domains[s] === u.domains[t] && r() < 0.25) pairs.push([s, t]);
                }
            }
            return {
                dd: m.equate(pairs),
                set: u.filter((x) => pairs.every(([p, q]) => x[p] === x[q])),
            };
        }
        case 11: {
            const support = m.support(a.dd);
            const map = new Map<number, number>();
            let prev = -1;
            for (const s of support) {
                const options = u.domains
                    .map((_, t) => t)
                    .filter((t) => t > prev && u.domains[t] === u.domains[s]);
                const t = options[Math.floor(r() * Math.min(options.length, 2))];
                if (t === undefined) return undefined;
                map.set(s, t);
                prev = t;
            }
            const project = (x: readonly number[], slots: readonly number[]): string =>
                slots.map((s) => x[s]).join(",");
            const keys = new Set([...a.set].map((i) => project(u.decode(i), support)));
            const targets = support.map((s) => map.get(s)!);
            return {
                dd: m.rename(a.dd, (s) => map.get(s) ?? s),
                set: u.filter((y) => keys.has(project(y, targets))),
            };
        }
        default: {
            expect(m.implies(a.dd, b.dd)).toBe([...a.set].every((i) => b.set.has(i)));
            return undefined;
        }
    }
}

describe("the decision-diagram engine", () => {
    it("agrees with explicit sets of assignments on every operation", () => {
        for (let seed = 1; seed <= 300; seed++) {
            const r = rng(seed);
            const domains = randomDomains(r);
            const m = new DdManager(domains);
            const u = new Universe(domains);
            const pool: Entry[] = [
                { dd: m.EMPTY, set: new Set() },
                { dd: m.ALL, set: u.filter(() => true) },
            ];
            for (let i = 0; i < 3; i++) {
                const s = Math.floor(r() * domains.length);
                const values = randomSubset(r, domains[s]!);
                pool.push({
                    dd: m.slotIn(s, values),
                    set: u.filter((x) => values.includes(x[s]!)),
                });
            }
            for (let step = 0; step < 25; step++) {
                const e = randomStep(m, u, pool, r);
                if (e === undefined) continue;
                checkEntry(m, u, e, r);
                pool.push(e);
            }
        }
    });

    it("gives equal sets built different ways the same diagram", () => {
        const m = new DdManager([3, 2, 4, 3]);
        const a = m.or(m.slotIn(0, [0, 1]), m.slotIn(2, [3]));
        const b = m.not(m.and(m.slotIn(0, [2]), m.slotIn(2, [0, 1, 2])));
        expect(a).toBe(b);
        expect(m.slotIn(1, [0, 1])).toBe(m.ALL);
        expect(m.slotIn(1, [])).toBe(m.EMPTY);
        expect(m.forget(a, [0, 2])).toBe(m.ALL);
        expect(m.diff(a, a)).toBe(m.EMPTY);
        expect(m.and(m.slotIn(3, [0]), m.slotIn(3, [1]))).toBe(m.EMPTY);
    });

    it("lets a slot the diagram skips be the one that changes in mapOne", () => {
        const m = new DdManager([3, 3, 3]);
        // Slot 1 is skipped: it holds any value, and any of them may move to 2.
        const a = m.and(m.slotIn(0, [0]), m.slotIn(2, [0]));
        const r = m.mapOne(a, (s, v) => (s === 1 && v !== 2 ? [2] : undefined));
        expect(r).toBe(m.and(a, m.slotIn(1, [2])));
        // From ALL, one slot moving to 2 leaves every assignment holding a 2.
        const any2 = m.mapOne(m.ALL, (_s, v) => (v === 0 ? [2] : undefined));
        expect(any2).toBe(m.or(m.or(m.slotIn(0, [2]), m.slotIn(1, [2])), m.slotIn(2, [2])));
        // A slot that may stay as it is leaves the assignment unchanged.
        expect(m.mapOne(a, (s, v) => (s === 0 ? [v] : undefined))).toBe(a);
        expect(m.mapOne(a, () => undefined)).toBe(m.EMPTY);
    });

    it("restricts a skipped slot to what mapEach reaches", () => {
        const m = new DdManager([3, 3]);
        const r = m.mapEach(m.slotIn(0, [1]), (s, v) =>
            s === 1 ? (v === 0 ? [] : [0]) : undefined,
        );
        expect(r).toBe(m.and(m.slotIn(0, [1]), m.slotIn(1, [0])));
        expect(m.mapEach(m.ALL, () => [])).toBe(m.EMPTY);
    });

    it("copies the item into the imprint slots and replaces the item by the imprint", () => {
        // Item slot i at 2i, its imprint slot at 2i + 1, and a last slot for "an imprint is held".
        const k = 4;
        const domains = [3, 3, 2, 2, 4, 4, 3, 3, 2];
        const m = new DdManager(domains);
        const item = Array.from({ length: k }, (_, i) => 2 * i);
        const imprint = item.map((s) => s + 1);
        const pairs = item.map((s) => [s, s + 1] as const);
        const held = 2 * k;
        const a = m.and(
            m.or(m.slotIn(0, [1]), m.and(m.slotIn(2, [0]), m.slotIn(4, [3]))),
            m.slotIn(6, [0, 2]),
        );
        const copied = m.and(m.set(m.forget(a, imprint), held, 1), m.equate(pairs));
        expect(m.forget(copied, [...imprint, held])).toBe(a);
        expect(m.rename(m.forget(copied, [...item, held]), (s) => s - 1)).toBe(a);

        const changed = m.set(m.set(copied, 0, 2), 6, 1);
        const viaRename = m.set(
            m.rename(m.forget(changed, [...item]), (s) => (s % 2 === 1 ? s - 1 : s)),
            held,
            0,
        );
        const viaEquate = m.set(
            m.forget(m.and(m.forget(changed, item), m.equate(pairs)), imprint),
            held,
            0,
        );
        expect(viaRename).toBe(viaEquate);
        expect(viaRename).toBe(m.set(a, held, 0));
    });

    it("refuses a rename that would break the slot order", () => {
        const m = new DdManager([2, 2, 2]);
        const a = m.and(m.slotIn(0, [0]), m.slotIn(1, [1]));
        expect(() => m.rename(a, (s) => 1 - s)).toThrow(RangeError);
    });

    it("throws past its node budget", () => {
        const m = new DdManager(new Array<number>(40).fill(2), { maxNodes: 50 });
        expect(() =>
            m.automaton<number>({
                init: 0,
                step: (_s, v, st) => st + v,
                accept: (st) => st % 7 === 0,
                key: (st) => st,
            }),
        ).toThrow(DdBudgetError);
    });

    it("rejects a value outside a slot's domain", () => {
        const m = new DdManager([2, 2]);
        const a = m.and(m.slotIn(0, [1]), m.slotIn(1, [0]));
        expect(m.contains(a, [1, 0])).toBe(true);
        expect(() => m.contains(a, [2, 0])).toThrow(RangeError);
        expect(() => m.contains(a, [-1, 0])).toThrow(RangeError);
        expect(() => m.contains(a, [0.5, 0])).toThrow(RangeError);
        expect(() => m.contains(a, [1])).toThrow(RangeError);
        expect(() => m.contains(a, [1, 0, 0])).toThrow(RangeError);
        expect(() => m.child(a, 2)).toThrow(RangeError);
        expect(() => m.child(a, -1)).toThrow(RangeError);
        expect(() => m.slotIn(0, [2])).toThrow(RangeError);
        expect(() => m.mapOne(a, () => [3])).toThrow(RangeError);
    });

    it("rejects a diagram of another manager", () => {
        const m = new DdManager([2, 2]);
        const other = new DdManager([2, 2]);
        const a = other.slotIn(0, [1]);
        expect(() => m.and(m.ALL, a)).toThrow(RangeError);
        expect(() => m.or(other.EMPTY, m.ALL)).toThrow(RangeError);
        expect(() => m.isEmpty(other.EMPTY)).toThrow(RangeError);
        expect(() => m.top(a)).toThrow(RangeError);
        expect(() => m.child(a, 0)).toThrow(RangeError);
        expect(() => m.contains(a, [1, 0])).toThrow(RangeError);
        expect(() => m.forget(a, [0])).toThrow(RangeError);
        expect(() => m.mapOne(a, () => undefined)).toThrow(RangeError);
        expect(() => m.rename(a, (s) => s)).toThrow(RangeError);
        expect(() => m.count(a)).toThrow(RangeError);
    });

    it("keeps the operation cache across the calls of a batch", () => {
        const m = new DdManager(new Array<number>(12).fill(3));
        const a = m.automaton<number>({
            init: 0,
            step: (_s, v, c) => (c + v) % 5,
            accept: (c) => c !== 2,
            key: (c) => c,
        });
        const b = m.automaton<number>({
            init: 0,
            step: (_s, v, c) => (v === 0 ? c : Math.min(c + 1, 4)),
            accept: (c) => c >= 3,
            key: (c) => c,
        });
        const cost = (f: () => Dd): number => {
            const before = m.applyCount;
            f();
            return m.applyCount - before;
        };
        const alone = cost(() => m.and(a, b));
        expect(alone).toBeGreaterThan(1);
        expect(cost(() => m.and(a, b))).toBe(alone);
        const used = (): number => (m as unknown as { used: number[] }).used.length;
        m.batch(() => {
            expect(cost(() => m.and(a, b))).toBe(alone);
            expect(cost(() => m.and(a, b))).toBe(1);
            m.batch(() => expect(cost(() => m.or(a, b))).toBeGreaterThan(1));
            expect(cost(() => m.or(a, b))).toBe(1);
            expect(cost(() => m.and(b, a))).toBe(1);
        });
        expect(used()).toBe(0);
        expect(cost(() => m.and(a, b))).toBe(alone);
        expect(() =>
            m.batch(() => {
                m.diff(a, b);
                throw new Error("stop");
            }),
        ).toThrow("stop");
        expect(used()).toBe(0);
        expect(cost(() => m.diff(a, b))).toBeGreaterThan(1);
    });

    it("unites a dense relation's sources once per group of targets", () => {
        const N = 30;
        const D = 20;
        const m = new DdManager(new Array<number>(N).fill(D));
        const atMost = (k: number): Dd =>
            m.automaton<number>({
                init: 0,
                step: (_s, v, c) => (v === 0 ? c : c + 1 > k ? undefined : c + 1),
                accept: () => true,
                key: (c) => c,
            });
        const a = m.and(atMost(3), m.not(atMost(1)));
        const present = Array.from({ length: D - 1 }, (_, i) => i + 1);
        const rel: DdRelation = (_s, v) => (v === 0 ? undefined : present);
        const before = m.applyCount;
        expect(m.mapOne(a, rel)).toBe(a);
        const one = m.applyCount - before;
        expect(m.mapEach(a, rel)).toBe(a);
        const each = m.applyCount - before - one;
        // A union per target would take about D times as many.
        expect(one).toBeLessThan(3 * m.size(a) * D);
        expect(each).toBeLessThan(3 * m.size(a) * D);
    });

    it("agrees with an explicit set of about 10^5 assignments", () => {
        for (let seed = 1; seed <= 3; seed++) {
            const r = rng(1000 + seed);
            let domains: number[];
            do domains = Array.from({ length: 9 }, () => 3 + Math.floor(r() * 3));
            while (domains.reduce((p, d) => p * d, 1) > 200_000);
            const u = new Universe(domains);
            const m = new DdManager(domains);
            const pool: { dd: Dd; bits: Uint8Array }[] = [
                { dd: m.ALL, bits: new Uint8Array(u.size).fill(1) },
            ];
            const pick = (): { dd: Dd; bits: Uint8Array } => pool[Math.floor(r() * pool.length)]!;
            const image = (
                bits: Uint8Array,
                f: (x: number[], add: (y: number[]) => void) => void,
            ): Uint8Array => {
                const out = new Uint8Array(u.size);
                const add = (y: number[]): void => {
                    out[u.encode(y)] = 1;
                };
                for (let i = 0; i < u.size; i++) if (bits[i] === 1) f(u.decode(i), add);
                return out;
            };
            for (let step = 0; step < 14; step++) {
                const a = pick();
                const b = pick();
                let e: { dd: Dd; bits: Uint8Array };
                switch (step % 7) {
                    case 0: {
                        const s = Math.floor(r() * 9);
                        const values = randomSubset(r, domains[s]!, 0.6);
                        const bits = a.bits.map((x, i) =>
                            x === 1 && values.includes(u.decode(i)[s]!) ? 1 : 0,
                        );
                        e = { dd: m.and(a.dd, m.slotIn(s, values)), bits };
                        break;
                    }
                    case 1:
                        e = { dd: m.or(a.dd, b.dd), bits: a.bits.map((x, i) => x | b.bits[i]!) };
                        break;
                    case 2: {
                        const bits = a.bits.map((x, i) => x & (1 - b.bits[i]!));
                        e = { dd: m.diff(a.dd, b.dd), bits };
                        break;
                    }
                    case 3: {
                        const t = randomRelation(r, domains);
                        const bits = image(a.bits, (x, add) => {
                            for (let s = 0; s < 9; s++) {
                                for (const w of t[s]![x[s]!] ?? []) {
                                    const y = [...x];
                                    y[s] = w;
                                    add(y);
                                }
                            }
                        });
                        e = { dd: m.mapOne(a.dd, relOf(t)), bits };
                        break;
                    }
                    case 4: {
                        const t = randomRelation(r, domains);
                        let bits = a.bits;
                        for (let s = 0; s < 9; s++) {
                            bits = image(bits, (x, add) => {
                                for (const w of t[s]![x[s]!] ?? [x[s]!]) {
                                    const y = [...x];
                                    y[s] = w;
                                    add(y);
                                }
                            });
                        }
                        e = { dd: m.mapEach(a.dd, relOf(t)), bits };
                        break;
                    }
                    case 5: {
                        const slots = [0, 1, 2, 3, 4, 5, 6, 7, 8].filter(() => r() < 0.3);
                        let bits = a.bits;
                        for (const s of slots) {
                            bits = image(bits, (x, add) => {
                                for (let v = 0; v < domains[s]!; v++) {
                                    const y = [...x];
                                    y[s] = v;
                                    add(y);
                                }
                            });
                        }
                        e = { dd: m.forget(a.dd, slots), bits };
                        break;
                    }
                    default: {
                        const auto = randomAutomaton(r, domains);
                        const bits = new Uint8Array(u.size);
                        for (let i = 0; i < u.size; i++) {
                            if (a.bits[i] === 1 || runAutomaton(auto, u.decode(i))) bits[i] = 1;
                        }
                        e = { dd: m.or(a.dd, buildAutomaton(m, auto)), bits };
                    }
                }
                let n = 0;
                for (let i = 0; i < u.size; i++) {
                    if (m.contains(e.dd, u.decode(i)) !== (e.bits[i] === 1)) {
                        expect.fail(`assignment ${i} differs at step ${step} of seed ${seed}`);
                    }
                    n += e.bits[i]!;
                }
                expect(m.count(e.dd)).toBe(BigInt(n));
                pool.push(e);
            }
            const last = pool[pool.length - 1]!;
            const set = new Set<number>();
            for (let i = 0; i < u.size; i++) if (last.bits[i] === 1) set.add(i);
            expect(fromSet(m, set)).toBe(last.dd);
        }
    });

    it("keeps one diagram per set after unreferenced diagrams are collected", async () => {
        const domains = [3, 4, 2, 3, 4, 3];
        const m = new DdManager(domains);
        const u = new Universe(domains);
        const build = (seed: number): Entry => {
            const r = rng(seed);
            const pool: Entry[] = [
                { dd: m.EMPTY, set: new Set() },
                { dd: m.ALL, set: u.filter(() => true) },
            ];
            for (let step = 0; step < 20; step++) {
                const e = randomStep(m, u, pool, r);
                if (e !== undefined) pool.push(e);
            }
            return pool[pool.length - 1]!;
        };
        const check = (i: number): void => {
            const again = build(i + 1);
            expect(sorted(again.set)).toEqual(sorted(sets[i]!));
            expect(sorted(toSet(m, again.dd))).toEqual(sorted(sets[i]!));
            expect(fromSet(m, sets[i]!)).toBe(again.dd);
        };
        v8.setFlagsFromString("--expose-gc");
        const gc = vm.runInNewContext("gc") as () => void;
        const macrotask = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
        const sets = Array.from({ length: 120 }, (_, i) => build(i + 1).set);
        const made = m.tableEntryCount;
        // A WeakRef keeps its target alive until the job ends, so collection needs a yield.
        await macrotask();
        gc();
        // The finalisers have not run yet: these lookups meet references to dead nodes.
        for (let i = 0; i < 60; i++) check(i);
        await macrotask();
        gc();
        await macrotask();
        expect(m.tableEntryCount).toBeLessThan(made);
        for (let i = 60; i < sets.length; i++) check(i);
    });

    it("builds and transforms a 260-slot item in a few thousand nodes", () => {
        const r = rng(260);
        const N = 260;
        const domains = Array.from({ length: N }, () => 2 + Math.floor(r() * 12));
        const side = domains.map((_, s) => (s < N / 2 ? 0 : 1));
        const groupStart: boolean[] = [];
        for (let s = 0; s < N;) {
            const len = 1 + Math.floor(r() * 4);
            for (let i = 0; i < len && s < N; i++, s++) {
                groupStart.push(i === 0 || side[s] !== side[s - 1]);
            }
        }
        const m = new DdManager(domains);
        type Wf = readonly [number, number, boolean];
        const wf = m.automaton<Wf>({
            init: [0, 0, false],
            step: (s, v, [p, q, taken]) => {
                const inGroup = groupStart[s] ? false : taken;
                if (v === 0) return [p, q, inGroup];
                if (inGroup) return undefined;
                const np = side[s] === 0 ? p + 1 : p;
                const nq = side[s] === 1 ? q + 1 : q;
                return np > 3 || nq > 3 ? undefined : [np, nq, true];
            },
            accept: () => true,
            key: ([p, q, taken]) => p * 8 + q * 2 + (taken ? 1 : 0),
        });
        const nonZero = (lo: number, hi: number): Dd =>
            m.automaton<number>({
                init: 0,
                step: (_s, v, c) => Math.min(c + (v === 0 ? 0 : 1), 7),
                accept: (c) => c >= lo && c <= hi,
                key: (c) => c,
            });
        let state = m.and(wf, nonZero(4, 6));
        const add: DdRelation = (s, v) =>
            v === 0 ? Array.from({ length: domains[s]! - 1 }, (_, i) => i + 1) : undefined;
        const remove: DdRelation = (_s, v) => (v === 0 ? undefined : [0]);
        for (let i = 0; i < 20; i++) {
            state = i % 2 === 0 ? m.and(m.mapOne(state, add), wf) : m.mapOne(state, remove);
            expect(state).toBe(i % 2 === 0 ? m.and(wf, nonZero(5, 6)) : m.and(wf, nonZero(4, 5)));
            expect(m.size(state)).toBeLessThan(5_000);
        }
        expect(m.nodeCount).toBeLessThan(30_000);
    });
});
