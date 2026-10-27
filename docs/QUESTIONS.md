# Questions for Rick

The asynchronous channel between the autonomous work and the user. Work never blocks on
an entry here: each question records the assumption the code proceeds under and where
that assumption lives, so answering later is a bounded change. The protocol is in
`../CLAUDE.md` (Asking without blocking).

Three kinds of entry:

- **decision**: a design or scope choice that is the user's to make.
- **game probe**: a rule the wiki does not settle; needs an item and a few steps in game.
- **clarification**: the request or a convention is ambiguous.

To answer, write under **Answer** and change the status in the heading to `answered`.
The next session applies it, records the commit, and moves the entry to Resolved.

---

## Open

### Q1 · decision · open

**Asked:** 2026-10-26
**Question:** Affix capacity is computed in three places (`check/counts.ts`, `model/wf.ts`,
and a literal 6 in `currency/base.ts`). Route the concrete layer and the pool through
`counts.ts` (recommended), delete the concrete library instead, or merge the two modules?
**Context:** the plan doc "Item Model Next Steps", Decision 1. `pool.slotOpen` uses the
incomplete `wf.ts` formula and sits on the checker's path, so on a rare Ratcheting Ring
the add-pool is wrong in the unsound direction.
**Assumed meanwhile:** option 1, delegate. `wf.slotCap` calls `counts.sideCap`, `wf`
gains the combined-cap clause, `pool.slotOpen` tests both caps, exalt's literal becomes
`maxTotal`.
**Where the assumption lives:** `packages/core/src/model/wf.ts`,
`packages/core/src/pool/pool.ts`, `packages/core/src/currency/base.ts`, their tests.
**Answer:**

### Q2 · decision · open

**Asked:** 2026-10-26
**Question:** The item's tag set. Implement the tags a present modifier adds
(`adds_tags`) in the pool now and defer influence (recommended), implement both, or
leave the pool matching on base tags only?
**Context:** plan doc Decision 2. 235 jewel modifiers key on a `specific_weapon` tag that
another jewel modifier adds; without it the jewel pool overstates what can roll, which
makes `until has X` look reachable when it is not.
**Assumed meanwhile:** added tags only; influence arrives with the influence currencies.
**Where the assumption lives:** `packages/core/src/pool/pool.ts`, `pool.test.ts`.
**Answer:**

### Q3 · decision · open

**Asked:** 2026-10-26
**Question:** What the concrete `Item` carries. Only what the pool reads (influence, once
it exists; recommended), a faithful item with fractured/veiled/influence marks, or the
present subset with the spec stating that marks are checker-only?
**Context:** plan doc Decision 3; `docs/item-model.md` §10 is the open question in the
spec.
**Assumed meanwhile:** option 3. Fracture and veiled state stay in the checker; the
concrete item gains fields only when the pool needs them.
**Where the assumption lives:** `docs/item-model.md` §7 and §10 once rewritten.
**Answer:**

### Q4 · decision · open

**Asked:** 2026-10-26
**Question:** Delete the dead effect kinds (`poolWiden`, `protect` by mods, `slotDelta`,
`opUnlock`) and the five unreachable `ModSource` values (recommended), or keep them as
PoE2 design intent?
**Context:** plan doc Decision 4. Nothing constructs them; the typing-rules doc keeps the
vocabulary as design intent either way.
**Assumed meanwhile:** delete.
**Where the assumption lives:** `packages/core/src/model/effects.ts`,
`packages/core/src/model/sources.ts`, `packages/data/src/adapter.ts`.
**Answer:**

### Q5 · decision · open

**Asked:** 2026-10-26
**Question:** Go ahead with the core-operations redesign proposed in
`operations.md` (every crafting method compiled to a handful of primitive effects on
the abstract item), or keep one transfer function per currency?
**Context:** the analysis in that doc; it changes the shape of `check/transfer.ts` but not
the abstract domain, and it is what makes the remaining crafting surface tractable.
**Assumed meanwhile:** the bug fixes land first in the current structure (their tests
carry over); the redesign waits for the answer.
**Where the assumption lives:** nowhere yet.
**Answer:**

---

## Resolved

_None yet._
