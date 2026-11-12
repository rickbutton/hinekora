# hinekora — Roadmap

> Forward-looking work only. Completed work is not tracked here; that is what
> `git log` is for, and the design that resulted lives in the code,
> `ARCHITECTURE.md` and `operations.md`. The order below is the plan; each step is one
> or more commits that pass the gate, reviewed by the `reviewer` agent, with any decision
> or in-game probe it needs recorded in `QUESTIONS.md` rather than waited on.

## The goal

Cover the whole PoE1 crafting surface. Every method in `operations.md` §3 not marked
**out** is a library entry the checker interprets; what is left is the work below, which
waits until a craft calls for it.

## Deferred by design (don't build until called for)

- the **cost layer's** finer points (`cost.md` has what is built): the
  Orb of Unravelling's tier upgrade (its rule is not stated), a loop whose exit rests on a
  value no roll in its body changes. Left unmodelled by choice, their steps read on the
  checker's item: the Tangled Fossil's random tags, an Orb of Dominance
  on an item that may hold influenced modifiers the craft does not name, and a corruption
  that may replace an eldritch implicit.
- **multi-item crafts**, which need a second item named in the craft, a design to be
  worked out first: the Recombinator, whose result pools both items' modifiers (an
  earlier form, and the evidence on how it picks, are in the git history before the
  commit that removed it; that evidence predates
  [Version 3.30.0](https://www.poewiki.net/wiki/Version_3.30.0#Item_Generation_Changes), whose result takes the chosen base's item level and counts
  only modifiers the new base can roll, and which takes no corrupted item
  ([§ Item Changes](https://www.poewiki.net/wiki/Version_3.30.0#Item_Changes))), the Awakener's
  Orb, whose result keeps an influenced modifier of each item, Reflecting Mist and
  Kishara's Ducat.
- **Merrick's Ducat on an Abyss Jewel** (Q129) and **Gwennen's "Take a Chance"**, whose
  crafts the wiki does not list yet.
- **choice over an operation's outcomes** (Hinekora's Lock).
- **an item's other implicits**: a corruption that replaces one is read as maybe taking
  an eldritch implicit, since the base's own are not tracked.
- **several held imprints**: the checker holds one at a time.
- **`"random"` as any modifier the item can hold**, not a natural roll alone.
- **the Bestiary's add-and-remove order** under a cannot-roll metamod, unprobed.
- **an orb that adds where nothing can roll**: refused as a step with no outcome; a check
  like `poolNonEmpty` would word it as the harvest crafts' is.
- **the cost layer's split of a reforge between the sides**, which undercounts a type
  with rows on both.
- **a first check's speed**: a flatter node layout, a prebuilt data snapshot, a bundled
  command line.
- English negation sugar (`doesn't have` → `not has`); a power-user annotation tier for
  reusable techniques; a way to name an unveiled modifier whose words a natural one
  shares other than by its mod id.
- **experimented bases' magnitude implicits** ("100% increased Explicit Modifier
  magnitudes" on a Simplex Amulet): carried as `Base.magnitude`, never applied; with them
  come the rounding of a scaled value, whether a granted skill's level scales
  ([Simplex Amulet § Mechanics](https://www.poewiki.net/wiki/Simplex_Amulet#Mechanics)
  names only "+1 gem" modifiers), and catalyst quality. Meanwhile a value compares on its
  row's own span: on a Simplex Amulet `has "maximum life" >= 240` never holds though the
  item shows twice the row.
- **legacy base-implicit variants** of the experimented bases, whose own caps and magnitudes one catalog id cannot carry and
  no collected recipe starts from; a Magic
  Simplex Amulet with modifiers no longer exists since 3.27.0
  ([Simplex Amulet § Version history](https://www.poewiki.net/wiki/Simplex_Amulet#Version_history)).
