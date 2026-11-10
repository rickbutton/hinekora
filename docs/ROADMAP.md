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
  value no roll in its body changes, and the chance a modifier the checker holds only as
  possible is there when a later roll is judged (the walk keeps the last roll alone, Q57;
  a distribution carried through every step, extending what `cost.md` §6 says a
  solved loop hands on, would replace both that and the estimate's floor); the race's clocks are modifier
  types, so two types of one modifier group may both be drawn (`cost.md` §8).
- **multi-item crafts** beyond the Recombinator (the Awakener's Orb, whose result keeps
  an influenced modifier of its donor's and so needs the donor as a second item;
  Reflecting Mist, Kishara's Ducat; the Recombinator is built with two items of one base,
  since the state carries one base and the result keeps one of the two at random)
  and **choice over an operation's outcomes** (Hinekora's Lock, Allflame crafting).
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
- **legacy base-implicit variants** of the experimented bases (`QUESTIONS.md` Q70); a Magic
  Simplex Amulet with modifiers no longer exists since 3.27.0
  ([Simplex Amulet § Version history](https://www.poewiki.net/wiki/Simplex_Amulet#Version_history)).
