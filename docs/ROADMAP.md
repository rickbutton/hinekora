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

The audit of the code against `item-model.md` left four decisions (`QUESTIONS.md` Q1–Q4)
and ten bugs. The bugs, in the order they ship:

1. The item block accepts counts over the combined cap (`maxTotal`) and the initial
   state is not normalized.
2. `bench` and an omen-forced `exalt` accept a full item: the open-slot check with a
   named side ignores the combined cap (a false negative).
3. `harvest reforge` passes its empty-pool check from the unrestricted pool, so an
   active cannot-roll metamod that excludes every tagged modifier is missed (a false
   negative); reforges likewise take their pool from an unrestricted state (precision).
4. A second `veiled exalt` on an item with a pending veiled modifier is accepted.
5. A modifier's side is looked up globally, so the item block can reject a correctly
   placed affix of a type that has rows on both sides.
6. `fractured` on a `"random"` placeholder is dropped instead of asserting the
   "some modifier is fractured" fact.
7. A bench-crafted modifier declared by exact id does not count toward the crafted limit.
8. The concrete validator applies the item-level and domain rules to every affix, so a
   concrete item holding a bench or essence row is ill-formed.
9. The never-Rare and four-affix class sets are incomplete
   ([Rarity § Rare](https://www.poewiki.net/wiki/Rarity#Rare)).
10. Affix capacity is computed three ways; the pool's slot check uses the incomplete one
    (Q1).
11. `alteration` and `essence` reforge from a blank slate, dropping a fractured
    modifier's lock and guarantee, so a scoured fractured base that is altered and later
    fractured again is accepted (a false negative;
    [Fracturing Orb § Mechanics](https://www.poewiki.net/wiki/Fracturing_Orb#Mechanics)).
12. `annul` ignores the cannot-roll metamods, which shield their tagged modifiers from
    removal ([Orb of Annulment § Mechanics](https://www.poewiki.net/wiki/Orb_of_Annulment#Mechanics)),
    so "a removable modifier" can hold where the game has none.
13. The veiled orbs are accepted on an item that already carries a veiled modifier or an
    unveiled one ([Veiled Exalted Orb](https://www.poewiki.net/wiki/Veiled_Exalted_Orb):
    "or its craftable versions"); bug 4 is the placeholder half of this.

Then the added tags of present modifiers in the pool (Q2), the dead effect kinds and
sources (Q4), and a test per well-formedness rule of `item-model.md` §8.

## Step 2. The operations model (Q5)

Replace the per-currency transfer functions with the primitives of `operations.md` §2
and a library of entries (`operations.md` §3): pools and selectors as descriptions, an
interpreter in the checker, and one generic operation statement in the AST whose
arguments the library's signature drives (parser, completion and hover stop knowing
each method). Every existing test stays green; the diagnostics keep their wording. This
is a refactor commit series followed by a deletion of the old functions.

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
