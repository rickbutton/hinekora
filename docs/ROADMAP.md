# hinekora — Roadmap

> Forward-looking work only. Completed work is not tracked here; that is what
> `git log` is for, and the design that resulted lives in `REFERENCE.md`,
> `ARCHITECTURE.md` and `operations.md`. The order below is the plan; each step is one
> or more commits that pass the gate, reviewed by the `reviewer` agent, with any decision
> or in-game probe it needs recorded in `QUESTIONS.md` rather than waited on.

## The goal

Cover the whole PoE1 crafting surface: every method in `operations.md` §3 that is not
marked **out** becomes a library entry the checker interprets, with the preconditions
and the metamod rules the wiki states, and the surface language names it. Coverage is
measured against that ledger.

## Step 1. The item model agrees with the code

The audit of the code against `item-model.md` is applied: its decisions are resolved in
`QUESTIONS.md`, its bugs fixed, the §8 rules the checker can express are enforced by its
item block and transfer functions and the §9 facts are data tests. What remains is a
re-audit of the code against
`item-model.md` §§4–9, rule by rule, now that the operations model has settled the shape
of the operations; no divergence is expected.

## Deferred by design (don't build until called for)

- the **cost layer's** next steps (`ARCHITECTURE.md` §7 has what is built): bounds beside
  the point estimate (the same race on the checker's superset and subset pools, Q54), a
  loop whose exit rests on modifiers already on the item (a presence distribution carried
  across steps, which the per-roll model does not have), the Recombinator's chance, the
  Bestiary's prices, Harvest's "more likely" bias and memory strands.
- **multi-item crafts** beyond the Recombinator (Reflecting Mist, Kishara's Ducat; the
  Awakener's Orb is built with the donor reduced to its influence, the Recombinator with
  two items of one base, `QUESTIONS.md` Q55)
  and **choice over an operation's outcomes** (Hinekora's Lock, Allflame crafting).
- English negation sugar (`doesn't have` → `not has`); a power-user annotation tier for
  reusable techniques; a way to name an unveiled modifier whose words a natural one
  shares other than by its mod id.
- **reduced-cap base edge cases:** the split-beast, Awakener's Orb and Harvest routes
  that put modifiers on a magic Simplex Amulet, which no ordinary currency can
  ([Simplex Amulet § Special Crafting Considerations](https://www.poewiki.net/wiki/Simplex_Amulet#Special_Crafting_Considerations)),
  and legacy base-implicit variants.
