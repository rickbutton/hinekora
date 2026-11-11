# hinekora — Roadmap

> Forward-looking work only. Completed work is not tracked here; that is what
> `git log` is for, and the design that resulted lives in the code,
> `ARCHITECTURE.md` and `operations.md`. The order below is the plan; each step is one
> or more commits that pass the gate, reviewed by the `reviewer` agent, with any decision
> or in-game probe it needs recorded in `QUESTIONS.md` rather than waited on.

## The goal

Cover the whole PoE1 crafting surface. Every method in `operations.md` §3 not marked
**out** is a library entry the checker interprets; what is left is the work below, which
waits until a guide calls for it.

## Deferred by design (don't build until called for)

- the **cost layer's** finer points (`cost.md` has what is built): the
  Orb of Unravelling's tier upgrade (its rule is not stated), a loop whose exit rests on a
  value no roll in its body changes. Left unmodelled by choice, their steps read on the
  checker's item: the Tangled Fossil's random tags, an Orb of Dominance
  on an item that may hold influenced modifiers the guide does not name, and a corruption
  that may replace an eldritch implicit.
- **multi-item crafts**, which need a second item named in the guide, a design to be
  worked out first: the Recombinator, whose result pools both items' modifiers (an
  earlier form, and the evidence on how it picks, are in the git history before the
  commit that removed it), the Awakener's
  Orb, whose result keeps an influenced modifier of each item, Reflecting Mist and
  Kishara's Ducat.
- **choice over an operation's outcomes** (Hinekora's Lock, Allflame crafting).
- **a count tied to a modifier across an `if`**: `until has X { exalt  if not has X { annul } }`
  on an item with room is refused, since the join after the `if` keeps "four or five
  modifiers" and "X or not" apart, and the next pass exalts the five. Writing `restart`
  after the `annul` passes: each way round the loop then reaches its head on its own.
- English negation sugar (`doesn't have` → `not has`); a power-user annotation tier for
  reusable techniques; a way to name an unveiled modifier whose words a natural one
  shares other than by its mod id.
- **experimented bases' magnitude implicits** ("100% increased Explicit Modifier
  magnitudes" on a Simplex Amulet, a side's on the rings): the data carries them as
  `Base.magnitude`, but neither the checker nor the item card scales a value by them; with
  them come the rounding of a scaled value (down, up or to nearest decides whether
  `has "…" >= 86` holds on a Helical Ring's 85.5), whether a granted skill's level scales
  ([Simplex Amulet § Mechanics](https://www.poewiki.net/wiki/Simplex_Amulet#Mechanics)
  names only "+1 gem" modifiers), and catalyst quality, which adds to the same percentage.
  Meanwhile a value compares on its row's own span, so on a Simplex Amulet
  `has "maximum life" >= 240` reads as a branch that can never run though the item shows
  twice the row.
- **legacy base-implicit variants** of the experimented bases, whose own caps and magnitudes one catalog id cannot carry and
  no collected recipe starts from; a Magic
  Simplex Amulet with modifiers no longer exists since 3.27.0
  ([Simplex Amulet § Version history](https://www.poewiki.net/wiki/Simplex_Amulet#Version_history)).
