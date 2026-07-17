import { describe, expect, it } from "vitest";
import { BddManager } from "./bdd.js";

describe("BddManager — a reduced, ordered BDD", () => {
    it("is canonical: equal functions share one id", () => {
        const m = new BddManager();
        const x = m.variable("x");
        const y = m.variable("y");
        // `and`/`or` are commutative, and hash-consing makes structurally-equal
        // functions identical — so equality is just `===`.
        expect(m.and(x, y)).toBe(m.and(y, x));
        expect(m.or(x, y)).toBe(m.or(y, x));
        expect(m.and(x, x)).toBe(x);
        expect(m.or(x, x)).toBe(x);
    });

    it("handles the terminal identities", () => {
        const m = new BddManager();
        const x = m.variable("x");
        expect(m.and(x, m.TRUE)).toBe(x);
        expect(m.and(x, m.FALSE)).toBe(m.FALSE);
        expect(m.or(x, m.FALSE)).toBe(x);
        expect(m.or(x, m.TRUE)).toBe(m.TRUE);
        expect(m.and(x, m.not(x))).toBe(m.FALSE); // x ∧ ¬x
        expect(m.or(x, m.not(x))).toBe(m.TRUE); // x ∨ ¬x
    });

    it("obeys De Morgan", () => {
        const m = new BddManager();
        const x = m.variable("x");
        const y = m.variable("y");
        expect(m.not(m.and(x, y))).toBe(m.or(m.not(x), m.not(y)));
        expect(m.not(m.or(x, y))).toBe(m.and(m.not(x), m.not(y)));
    });

    it("computes entailment", () => {
        const m = new BddManager();
        const x = m.variable("x");
        const y = m.variable("y");
        expect(m.entails(m.and(x, y), x)).toBe(true); // x∧y ⇒ x
        expect(m.entails(x, m.or(x, y))).toBe(true); // x ⇒ x∨y
        expect(m.entails(x, y)).toBe(false); // x ⇏ y
    });

    it("restricts a variable", () => {
        const m = new BddManager();
        const x = m.variable("x");
        const y = m.variable("y");
        expect(m.restrict(m.and(x, y), "x", true)).toBe(y);
        expect(m.restrict(m.or(x, y), "x", false)).toBe(y);
        expect(m.restrict(x, "x", true)).toBe(m.TRUE);
        expect(m.restrict(x, "x", false)).toBe(m.FALSE);
        expect(m.restrict(y, "x", true)).toBe(y); // x doesn't appear in `y`
    });

    it("keeps a disjunction across an OR-join, so `not(all)` is unsatisfiable", () => {
        // This is the checker's Q2 case: after `has fire or has cold or has
        // lightning`, refining by `not fire and not cold and not lightning` must
        // collapse to FALSE (the branch is dead) — the thing the three-set domain
        // could not see.
        const m = new BddManager();
        const fire = m.variable("fire");
        const cold = m.variable("cold");
        const lightning = m.variable("lightning");
        const disjunction = m.or(m.or(fire, cold), lightning);
        const noneOfThem = m.and(m.not(fire), m.and(m.not(cold), m.not(lightning)));
        expect(m.and(disjunction, noneOfThem)).toBe(m.FALSE);
        // But a single one being absent is still satisfiable.
        expect(m.and(disjunction, m.not(fire))).not.toBe(m.FALSE);
        // And the disjunction does NOT entail any specific disjunct.
        expect(m.entails(disjunction, fire)).toBe(false);
    });
});
