import { describe, expect, it } from "vitest";
import {
    callStmt,
    craft,
    done,
    fail,
    has,
    iff,
    item,
    op,
    procDef,
    restart,
    until,
} from "../__fixtures__/ast.js";
import type { Craft } from "../ast/ast.js";
import { check } from "./check.js";
import type { Dd } from "./dd.js";
import { compareCraft } from "./reference/craft.js";
import { handCtx, HAND_REGISTRY } from "./reference/hand.js";

type Spec = Parameters<typeof item>[0];

const ring = (over: Partial<Spec> = {}) =>
    item({ base: "IronRing", ilvl: 84, rarity: "rare", ...over });

const exact = (c: Craft) => check(c, { registry: HAND_REGISTRY });

/** The exact driver against the reference on the hand catalogue's ring, the
 *  finished items among what they are held to. */
const agrees = (c: Craft): void => {
    expect(compareCraft(c, HAND_REGISTRY, handCtx()).diff).toBe("");
};

/** The finished items of a craft, and the items past its last statement. */
const ends = (c: Craft): { finished: Dd | undefined; fell: Dd | undefined } => {
    const r = exact(c);
    const last = r.trace.filter((e) => e.kind !== "item").at(-1);
    return { finished: r.finalState?.dd, fell: last?.after?.dd };
};

describe("done ends the craft for an item, finished", () => {
    it("in a branch: its items join the finished item, and what follows sees the rest", () => {
        const c = craft(ring({ prefixes: ["Life1"], suffixes: [{ mod: "random" }] }), [
            op("annul"),
            iff(has("Life1"), [done()]),
            op("exalt"),
        ]);
        const r = exact(c);
        expect(r.diagnostics).toEqual([]);
        const { finished, fell } = ends(c);
        // The finished item holds more than the exalt's items: the ones kept
        // with the life on them.
        expect(finished).not.toBe(fell);
        const m = r.trace[0]!.before.u.dd;
        expect(m.implies(fell!, finished!)).toBe(true);
        agrees(c);
    });

    it("in a loop body: a done item neither goes round again nor leaves by the exit", () => {
        const c = craft(ring({ rarity: "magic" }), [
            until(has("Mana1"), [op("alteration"), iff(has("Fire1"), [done()])]),
        ]);
        expect(exact(c).diagnostics).toEqual([]);
        agrees(c);
    });

    it("in a loop body that also restarts and fails", () => {
        const c = craft(ring({ prefixes: ["Life1"], suffixes: [{ mod: "random" }] }), [
            until(has("Mana1"), [
                op("divine"),
                iff(has("Fire1"), [done()], [iff(has("Life1"), [restart()], [fail()])]),
            ]),
        ]);
        agrees(c);
    });

    it("in a def's body, called twice", () => {
        const keep = procDef("keep", [], [iff(has("Fire1"), [done()])]);
        const c = craft(
            ring({ prefixes: ["Life1"], suffixes: [{ mod: "random" }] }),
            [op("annul"), callStmt("keep"), op("exalt"), callStmt("keep"), op("annul")],
            [],
            [keep],
        );
        expect(exact(c).diagnostics).toEqual([]);
        agrees(c);
    });

    it("after a step that splits the items, on one side of the split", () => {
        const c = craft(ring({ rarity: "magic", prefixes: ["Life1"] }), [
            op("augment"),
            iff(has("Fire1"), [done()], [op("regal")]),
        ]);
        expect(exact(c).diagnostics).toEqual([]);
        agrees(c);
    });

    it("on every item before the last statement: the finished item is theirs, the rest never runs", () => {
        const c = craft(ring({ prefixes: ["Life1"] }), [
            op("exalt"),
            iff(has("Fire1"), [done()], [done()]),
            op("chaos"),
        ]);
        const r = exact(c);
        expect(r.diagnostics.map((d) => d.message)).toEqual([
            "this step can never run: the craft always ends before it",
        ]);
        expect(r.diagnostics[0]!.span).toBe(c.body[2]!.span);
        // The finished item is the exalt's every outcome.
        expect(r.finalState?.dd).toBe(r.trace[1]!.after!.dd);
        agrees(c);
    });

    it("beside a fail: only the done items are finished", () => {
        const c = craft(ring({ prefixes: ["Life1"], suffixes: [{ mod: "random" }] }), [
            op("annul"),
            iff(has("Life1"), [done()], [fail()]),
        ]);
        const r = exact(c);
        expect(r.diagnostics).toEqual([]);
        const m = r.trace[0]!.before.u.dd;
        const annulled = r.trace[1]!.after!.dd;
        expect(r.finalState).toBeDefined();
        expect(m.implies(r.finalState!.dd, annulled)).toBe(true);
        expect(r.finalState!.dd).not.toBe(annulled);
        agrees(c);
    });

    it("at the end of the craft, as the end itself", () => {
        const plain = craft(ring({ prefixes: ["Life1"] }), [op("exalt")]);
        const ended = craft(ring({ prefixes: ["Life1"] }), [op("exalt"), done()]);
        expect(exact(ended).diagnostics).toEqual([]);
        expect(exact(ended).finalState?.dd).toBe(exact(plain).finalState?.dd);
        agrees(ended);
    });
});
