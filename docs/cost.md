# hinekora: The Cost Layer

> The checker proves; the cost layer estimates how many tries a loop takes and what the
> craft is expected to spend. The code is `packages/core/src/cost/`, the checker it reads
> [ARCHITECTURE.md](ARCHITECTURE.md) §4.

---

## 1. Beside the checker, not in it

The cost layer reads the checker's method table, op sequences and trace; nothing it
computes makes the checker accept or refuse a step.
---

## 2. How the game rolls

A row's weight is its first spawn-weight tag the item carries
([Modifier § Spawn weight tag](https://www.poewiki.net/wiki/Modifier#Spawn_weight_tag)),
scaled by its generation weight. A
reforge rolls a count, then draws modifiers one at a time by weight without replacement,
a group closing once one of it is drawn
([Modifier § Group/family](https://www.poewiki.net/wiki/Modifier#Group/family)) and a
side closing when full (the wiki gives the group rule; the order is every calculator's). An
unveil's three options
([Veiled modifier](https://www.poewiki.net/wiki/Veiled_modifier)) are
of the veiled modifier's side where the item says which; the player takes the craft's
target if offered, else a modifier its conditions ask for, else one no one names. A
value falls as
[Modifier § Mechanics overview](https://www.poewiki.net/wiki/Modifier#Mechanics_overview)
has it, a Vaal Orb's outcomes as
[Vaal Orb § Equipment](https://www.poewiki.net/wiki/Vaal_Orb#Equipment) and
[§ Jewels](https://www.poewiki.net/wiki/Vaal_Orb#Jewels),
the craft ending where the item is destroyed or becomes a unique, a Sanctified
Fossil's weights as
[Sanctified Fossil § Further analysis](https://www.poewiki.net/wiki/Sanctified_Fossil#Further_analysis),
its lucky values not modelled. A Harvest augment adds, then removes.

Where no source settles a rule, the code reads it so (each a `QUESTIONS.md` entry):

- **Counts.** A Rare reforge (Chaos Orb, Alchemy, essence, resonator, Harvest reforge,
  Veiled Chaos) is 4, 5 or 6 at 8:3:1, the forced row within it
  ([Chaos Orb § Mechanics](https://www.poewiki.net/wiki/Chaos_Orb#Mechanics), Q59); a
  base holding four or five takes one fewer or all at 65:35; a Magic reforge one or two at
  even odds (Q58). A kept side counts toward the total, the rerolled side taking what fits (Q112).
- **Fossils.** Several fossils' "more" multipliers add and a "fewer" multiplies the
  result (Q60).
- **Harvest.** The tagged row is drawn among the tag's rows by weight (Q63).
- **Removals** are uniform over the modifiers they can reach, never a fractured one, as
  is which an Orb of Dominance raises (Q61).
- **Veiled orbs.** The veiled modifier lands on either side with room alike (Q76); an
  unveil draws its options as a reforge draws modifiers (Q99).
- **Corruption implicits.** Drawn by spawn weight from the base's pool at its level, not
  of a kept one's group (Q135); the implicit replaced is picked evenly, a lone corruption
  implicit kept and the new one added (Q32); the altar's outcomes are no change, an
  implicit, or destruction two times in four ([Version 3.30.0](https://www.poewiki.net/wiki/Version_3.30.0#Incursion_and_Atziri)).
- **Orb of Conflict.** The line of
  [Orb of Conflict § Mechanics](https://www.poewiki.net/wiki/Orb_of_Conflict#Mechanics)
  is carried past the gap it states, neither side below one in a hundred (Q96).
- **Memory strands.** The share used up is unstated; the estimate reads the floor (Q68).
- **Partial protections.** A random removal weighs each choice of kept modifiers alike
  (Q128). Beside one no reforge, strip, Divine Orb, Orb of Dominance, Harvest change or
  augment is read, nor a random removal beside an unsettled count. The
  bench's removal takes all crafted (Q120).
- **Bestiary metamod.** Each that fits alike, unread beside one maybe held (Q131).

---

## 3. The item the cost layer follows

The checker's item at a step is a set of items; a probability needs to know how likely
each member is. The cost layer follows a **distribution over a small state**
(`cost/track.ts`): the (prefix, suffix) counts and, for each modifier a condition names
or the checker knows is there (declared, granted, crafted, a protecting metamod, a veiled
placeholder; each eldritch implicit's tier, and its type where a condition names one; the
base's implicit; the corruption implicits, a row a condition names apart), whether it is on the item, in which tier class (each tier a condition names
on its own, the rest of the ladder together) and whether it is fractured (its row marked
`!`); a modifier a condition compares by value is held per tier
and value piece, cut at the condition's thresholds, and an imprint holds the state it was taken of. The distribution starts from the item
block, a `"random"` modifier a natural roll of its side by spawn weight and an eldritch
implicit declared without a type each type of its tier by an ember's weights (assumed
for the tiers only an Orb of Conflict reaches too), and is
carried through every step, a call's body walked in its place. Each method is read on
the checker's item **narrowed to each state**: a random method by its roll, a sure one by the checker's own
transfer function, the item that leaves read back as states. A branch splits the distribution by its condition; a loop is solved
as a chain over it (§6).

What stays approximate: the modifiers no one names are a count, not identities, unless the
catalogue allows one type, so a draw beside them keeps each unnamed group's weight by its
chance of not being among that many draws. A step that cannot carry a state exactly says
so, and the walk reads on from the checker's item, as past 5000 states
(`TrackerOverflow`).
There a roll is read on the facts every item holds: a modifier some items lack neither
shrinks the pool nor adds its tags, and every range the items span is read at its floor
and at its ceiling (`Reading`), a **spread** given beside the figure where
the ends disagree.

---

## 4. The race: an exact draw without listing outcomes

The draw has an exact representation as a **race**: give every modifier group an
exponential clock whose rate is its types' weights together, read the
groups off in the order their clocks fire, skip a group whose side is full.
"These groups are all among the first k drawn" is "fewer than k minus their number of
the other groups fired before the last of them", a Poisson-binomial count at a time,
integrated against that time's density; the split of m draws is a race between the two
sides' order statistics. The dynamic program (`cost/race.ts`) carries a count, never draws.

It is exact for one group, for any set of one side jointly (by inclusion–exclusion), for
the split with depletion, and for a side's groups jointly with the split, which the
draw couples. The
sides are taken as independent given the split, which reads a condition on both within
two hundredths. A group with rows on both sides (a jewel's) is a
mixture, wholly a prefix or wholly a suffix by weight, and loses a draw the full side
turns away: up to five hundredths low, each bound tested against the draw played out. An
unveil's three draws are played out (`unveilOffers`), not raced.

---

## 5. From a method to a roll, from a roll to a chance

`cost/roll.ts` reads a method's op sequence into its **roll**: a draw from the checker's
own `pool` on the sure facts, with its count and the modifiers present for certain (kept,
or placed first), or a removal, fracture, unveil, implicit or reroll.

`cost/chance.ts` evaluates the condition, read under every influence the items have, against
the roll. A `has`
atom on a side is "its group among the first p of that side's race", the type and row by weight
share within the group, the value by its share of the row's range; count atoms read the
split; `and`, `or` and `not` are combined exactly by enumerating which of the few named
modifiers were drawn and which rows they are, a few dozen cases, never the item's
outcomes. A leaf the roll does not model (a rarity, an influence) is read off the
checker's item after the step, which settles it or leaves the chance unknown.

---

## 6. Cost as a mass walk over the craft

`cost/report.ts` walks the syntax tree once beside the trace, carrying a probability
**mass** split into a few **branches**, one per arm of the `if`s passed since the last
roll, each remembering that roll and the conditions it passed, so a later condition is
judged jointly with them (`has life` after `if not has fire { restart }` is life and
fire together over one reforge, not a product). Expected cost is linear: a statement's
expected runs is the mass reaching it times the rounds of every loop around it, times its
unit price (`cost/prices.ts`, in the step's own currency).

- An **`until`** whose body the tracker can follow is a Markov chain
  (`cost/chain.ts`) over the tracked state, each round starting where the last left
  the item, a loop inside it solved once per state entering it. The
  distribution is carried round after round until the mass has left; once a round
  hands on the same shape, only smaller, the rest is a geometric series. A chain not
  settled within the rounds followed is solved over its states; past a few hundred,
  its own rounds' decay stands for the rest, an estimate. Where those rounds are too
  few (the work went on loops inside) or lose too little to measure, its rounds are
  not worked out. States that cannot reach the exit hold the share that never
  leaves.
- Any other `until` is independent attempts: the body is walked once for the chance
  one ends in the exit, a `fail` or a `done`; the expected rounds is its reciprocal.
- An **`if`** splits each branch by its condition's chance; a `restart` is back at
  its loop's head as the item is.

A `fail`, a top-level `restart` or a destroyed item ends short; a `done` finishes.

A loop the check refuses, whose
exit no round reaches or the item sticks short of, or whose rounds were not worked
out has no figure, nor have its steps or the craft's total.

---

## 7. The economy

Prices are **poe.ninja's**, from endpoints its [API reference](https://poe.ninja/docs/api)
supports without promise, cached hourly per league; offline, the last fetch serves however
old, never the snapshot, a past league's. The language server refreshes in the background;
`HINEKORA_PRICES` pins a file. poe.ninja refuses other sites, so the site's deploy fetches
the playground's six-hourly, else `packages/data/data/poe1/economy.json`, the tests' and
site's fixture.

What poe.ninja cannot price (a bench craft, a Harvest craft's lifeforce, a Bestiary
recipe's beasts) `cost/prices.ts` carries from the catalog and the wiki's tables, a Harvest
change's amounts from [Version 3.30.0](https://www.poewiki.net/wiki/Version_3.30.0#Harvest)
and its colours from the game's `HarvestCraftOptions` table.

---

## 8. Known differences from craftofexile

craftofexile is the yardstick, not the truth; where they part, the wiki and the game data
decide:

- its calculator **extrapolates** at ten or more eligible types on a side, a few per cent
  optimistic;
- its **side split** depletes crudely, by the heaviest modifier a draw;
- its Orb of Alteration defaults to **Alt + Augment**, where hinekora prices the
  alteration alone (Q58);
- it weighs a **Foulborn** orb's pool as a Sanctified Fossil's, where hinekora culls tiers
  as the wiki has it, and it has no **memory strands**;
- it ignores **metamods** on essences and fossils, and the level caps of low-tier
  essences;
- it does not halve a **Convoking Wand**'s attack rows, as the data's generation weights do;
- a base of five slots takes four or five modifiers at two to one there, 65:35 here.
