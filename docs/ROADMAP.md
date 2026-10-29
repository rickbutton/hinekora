# Hinekora — Roadmap

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
of the operations. The expected remaining divergence is influence (Step 3) and nothing
else.

## Step 2. The remaining single-item methods

Every **composes** row of the ledger is built. What waits: the bench reroll recipes on
Q7; the Bestiary's two-modifier fracture on a fracture count in the abstract item. The
Orb of Chance is out of scope (Q15).

## Step 3. Marks

The abstract item and the item block carry the influences and corruption; the influence
currencies and crafts are built. What remains are the rows marked **later** for the
marks: the Orb of Dominance once the elevated modifiers are in the data; the Vaal Orb
(an `either` over its outcomes), the Locus, the Tainted currency, the Bloodstained
Fossil; the eldritch currency once the dominant implicit is a declarable mark.

## Step 4. Language and editor follow-ons

- **Negative facts in the tooltip.** `not has X` yields an exclusion that is filtered
  from completion candidates but never shown. Surface it as a "without …" line: an
  additive layer over the presence decomposition (units → prime implicates →
  cardinality), not a special case.
- Statement-position **completion** of proc names and proc-name **hover** signatures.
- A currency- or block-valued **parameter** (only value params, tier/count/mod, for now).
- Restrict **base** completion to craftable classes.
- **Completion perf:** `getCompletions` runs a full check per mod-string request;
  memoize if latency shows.
- **Tier-atom tightenings:** assert `tierAtom ⇒ family` and tier mutual-exclusion in the
  presence BDD. Both are true facts we currently omit; omitting them only ever
  under-claims (sound), so they are precision, not correctness.
- A **Monaco playground** (a new `editors/` package) reusing the transport-free LSP
  service.

## Deferred by design (don't build until called for)

- the **cost/probability layer** (expected attempts, spawn weights, fossil and Harvest
  biases, memory strands).
- **multi-item crafts** (Awakener's Orb, Recombinator, Reflecting Mist, Kishara's Ducat)
  and **choice over an operation's outcomes** (Hinekora's Lock, Allflame crafting).
- English negation sugar (`doesn't have` → `not has`); a power-user annotation tier for
  reusable techniques.
- **reduced-cap base edge cases:** the split-beast, Awakener's Orb and Harvest routes
  that put modifiers on a magic Simplex Amulet, which no ordinary currency can
  ([Simplex Amulet § Special Crafting Considerations](https://www.poewiki.net/wiki/Simplex_Amulet#Special_Crafting_Considerations)),
  and legacy base-implicit variants.
