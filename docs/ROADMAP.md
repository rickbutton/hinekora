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

The audit of the code against `item-model.md` left four decisions (`QUESTIONS.md` Q1–Q4,
applied under their recommendations and awaiting the user's ruling) and a list of bugs,
all fixed; the concrete validator holds every §8 rule the concrete item can express and
the §9 facts are data tests. What remains is a re-audit of the code against
`item-model.md` §§4–9, rule by rule, once Step 2 has settled the shape of the transfer
layer. The expected remaining divergence is influence (Step 4) and nothing else.

## Step 2. The operations model (Q5)

Replace the per-currency transfer functions with the primitives of `operations.md` §2
and a library of entries (`operations.md` §3): pools and selectors as descriptions, an
interpreter in the checker, and one generic operation statement in the AST whose
arguments the library's signature drives (parser, completion and hover stop knowing
each method). Every existing test stays green; the diagnostics keep their wording. This
is a refactor commit series followed by a deletion of the old functions. One rule the
model must state: a precondition that needs a pool to be non-empty (the harvest crafts'
`harvestEmptyPool`) must read a pool that is a subset of every path's real pool, while an
add reads a superset; today both read the add-pool, so a greyed-out harvest craft whose
tagged pool a possibly present modifier empties can be accepted.

## Step 3. The remaining single-item methods

In the order of the ledger's **composes** rows, each a library entry plus tests and the
surface name: Orb of Chance and Binding, Foulborn currency, the bench's remove and
replace crafted modifiers and reroll-the-rarity, corrupted essences, fossils (the
weight fossils, Fractured, Hollow, Glyphic), the Harvest sibling swaps and the more /
less likely reforges, the beastcrafts (add-and-remove across sides, talisman fractures,
random metamod, Aspects), imprint and restore. The bench reroll recipes wait on Q7, the
chaotic resonator on Q8.

## Step 4. Marks

Add the mark set to the abstract item and the item block (`influences:`, `corrupted`),
then the rows marked **later** for them: the conqueror Exalted Orbs, Orb of Dominance,
the Harvest influence reforges, the beast add-to-influenced recipe; the Vaal Orb, the
Locus, the Tainted currency, the Bloodstained Fossil; the eldritch currency once the
dominant implicit is a declarable mark. Influence also widens the natural pool with the
influence's rows ([Influenced item](https://www.poewiki.net/wiki/Influenced_item#Mechanics)).

## Step 5. Language and editor follow-ons

- **Negative facts in the tooltip.** `not has X` yields an exclusion that is filtered
  from completion candidates but never shown. Surface it as a "without …" line: an
  additive layer over the presence decomposition (units → prime implicates →
  cardinality), not a special case.
- Statement-position **completion** of proc names and proc-name **hover** signatures.
- A currency- or block-valued **parameter** (only value params, tier/count/mod, for now).
- Restrict **base** completion to craftable classes.
- `with omen "…"` **completion**: today the mod list is offered inside the quotes.
- **Completion perf:** `getCompletions` runs a full check per mod-string request;
  memoize if latency shows.
- **Tier-atom tightenings:** assert `tierAtom ⇒ family` and tier mutual-exclusion in the
  presence BDD. Both are true facts we currently omit; omitting them only ever
  under-claims (sound), so they are precision, not correctness.
- A **Monaco playground** (a new `editors/` package) reusing the transport-free LSP
  service.

## Deferred by design (don't build until called for)

- the **cost/probability layer** (expected attempts, spawn weights, fossil and Harvest
  biases, memory strands; needs the Known/Approx/Unknown weight provenance already in the
  model).
- **multi-item crafts** (Awakener's Orb, Recombinator, Reflecting Mist, Kishara's Ducat)
  and **choice over an operation's outcomes** (Hinekora's Lock, Allflame crafting).
- the **PoE2 module** (the omen machinery is modelled; PoE2 data ingest is not the
  target yet).
- English negation sugar (`doesn't have` → `not has`); "omen next op only" sugar; a
  power-user annotation tier for reusable techniques.
- **reduced-cap base edge cases:** the split-beast, Awakener's Orb and Harvest routes
  that put modifiers on a magic Simplex Amulet, which no ordinary currency can
  ([Simplex Amulet § Special Crafting Considerations](https://www.poewiki.net/wiki/Simplex_Amulet#Special_Crafting_Considerations)),
  and legacy base-implicit variants.
