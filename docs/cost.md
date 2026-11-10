# hinekora: The Cost Layer

> The checker proves; the cost layer estimates. It answers what every guide quotes but
> the checker cannot: how many tries a loop takes and what the craft is expected to
> spend. This is its design and the game readings it rests on; the code is
> `packages/core/src/cost/`, the checker it reads [ARCHITECTURE.md](ARCHITECTURE.md) §4.

---

## 1. Beside the checker, not in it

The cost layer reads the same method table and op sequences the checker runs, and
consumes the checker's output, the trace with the item before every statement, without
touching a transfer function. Nothing it computes can make the checker accept or refuse
a step, which keeps the checker a pure soundness tool. Its surfaces are `hinekora cost`,
the hover footer and the storyboard.

---

## 2. How the game rolls

A row's weight is its first spawn-weight tag the item carries
([Modifier § Spawn weight tag](https://www.poewiki.net/wiki/Modifier#Spawn_weight_tag)),
scaled by its generation weight; the item's tags are the base's, those its present
modifiers add, and its influence's. A
reforge rolls a count, then draws modifiers one at a time by weight without replacement,
a group closing once one of it is drawn
([Modifier § Group/family](https://www.poewiki.net/wiki/Modifier#Group/family)) and a
side closing when full. The wiki states the group rule but not the order; craftofexile's
emulator and every community calculator draw this way, and it is taken as settled. The
prefix/suffix split is not a roll of its own: it falls out of the draw.

Where no source settles a rule, the code reads it so (each a `QUESTIONS.md` entry):

- **Counts.** A Rare reforge (Chaos Orb, Alchemy, essence, resonator, Harvest reforge,
  Veiled Chaos) is 4, 5 or 6 at 8:3:1, the forced row within it
  ([Chaos Orb § Mechanics](https://www.poewiki.net/wiki/Chaos_Orb#Mechanics), Q59); a
  base holding four takes three or four at 65:35; a Magic reforge one or two at even odds
  (Q58); a Vaal reforge six.
- **Fossils.** Several fossils' "more" multipliers add (Q60).
- **Harvest.** The tagged row is drawn among the tag's rows by weight (Q63); "more / less
  likely" multiplies the rows sharing a type with the item's by ten and a tenth (Q66).
- **Removals** are uniform over the modifiers they can reach (Q61).
- **Unveil.** The three options are drawn by weight without replacement (Q64).
- **Values** are uniform over their row's range (Q65).
- **Memory strands.** The share used up is not stated; the estimate reads the floor
  (Q68).

---

## 3. Probabilities over a set of items

The item at a step is a set of items, so a probability needs a stated reading of it. The
cost layer takes a **point estimate on the path the guide describes**: a draw sees the
pool of the facts the item holds on every path (the base at its level, the influence,
the modifiers present on every path with their groups and tags), the item the player is
holding when the guide's step is right. A modifier held only as possible neither shrinks
the pool nor adds its tags. This is exact for a reforge, which strips the uncertain
modifiers away, and for an item its named modifiers fill; it is approximate for an add
onto an item with unnamed modifiers (Q57).

Beside the estimate the report carries a **spread**: the same walk with every range the
checker left open (a side's count, the memory strands) read at its floor and at its
ceiling (`Reading`); where the ends disagree the step's figure is given with them.

---

## 4. The race: an exact draw without listing outcomes

The draw has an exact representation as a **race**: give every group an exponential
clock whose rate is its weight (the code takes a modifier type as a group, §8), read the
groups off in the order their clocks fire, skip a group whose side is full. Every
question becomes one about independent firing times.
"These groups are all among the first k drawn" is "fewer than k minus their number of
the other groups fired before the last of them", a Poisson-binomial count at a time,
integrated against that time's density; the split of m draws is a race between the two
sides' order statistics. The dynamic program (`cost/race.ts`) carries a count, never a
list of draws: the core invariant on the probability side.

It is exact for one group, for any set jointly (by inclusion–exclusion), and for the
split with depletion. Given the split, which groups landed on a side is read from that
side's race alone, where the true draw couples the two through depletion; the race
tests bound that at two hundredths. The integral runs over log-time with panels in every
decade between the fastest clock and the slowest: a substitution on one rate alone steps
over the faster clocks in a pool whose weights span orders of magnitude (a fossil's
multipliers).

---

## 5. From a method to a roll, from a roll to a chance

`cost/roll.ts` reads a method's op sequence into its **roll**: the random `fill` with
the pool it draws from (the checker's own `pool` on the sure facts, cut by the memory
strands, re-weighted by fossils or the grove's tilt), the count of draws, the modifiers
present for certain (kept, or placed first: an essence's grant, a Harvest tag's row),
or else a uniform removal, a fracture,
an unveil's three options, an ember's weighted implicit, or a Divine Orb's reroll.

`cost/chance.ts` evaluates the checker's resolved predicate against the roll. A `has`
atom on a side is "its group among the first p of that side's race", the row by weight
share within the group, the value by its share of the row's range; count atoms read the
split; `and`, `or` and `not` are combined exactly by enumerating which of the few named
modifiers were drawn and which rows they are, a few dozen cases, never the item's
outcomes. A leaf the roll does not model (a rarity, an influence) is read off the
checker's item after the step, which settles it or leaves the chance unknown.

---

## 6. Cost as a mass walk over the guide

`cost/report.ts` walks the syntax tree once beside the trace, carrying a probability
**mass** split into a few **branches**, one per arm of the `if`s passed since the last
roll, each remembering that roll and the conditions it passed, so a later condition is
judged jointly with them (`has life` after `if not has fire { restart }` is life and
fire together over one reforge, not a product). Expected cost is linear: a statement's
expected runs is the mass reaching it times the rounds of every loop around it, times its
unit price (`cost/prices.ts`, in the step's own currency).

- An **`until`** is a sequence of independent attempts: the body is walked once to find
  the chance an attempt ends in the exit or a `stop`; the expected rounds is the
  reciprocal, and the share ending in a stop ends the craft. The next attempt starts
  where the last left off short of the exit.
- A loop whose body **changes the item one modifier at a time** (random removals, single
  draws, bench crafts, branches over them; a reforge or a `restore` inside starts the
  item over) is not memoryless. It is solved as a Markov chain (`cost/chain.ts`) over a
  small state, the (prefix, suffix) counts and, for each modifier the loop's conditions
  name, whether it is present and at which row, plus a protecting metamod a removal may
  take; the rest of the item is a count whose draws close an average group. The
  distribution is carried round after round until the mass has left (the exit, a
  restart, a stop, or an item full with nothing removing); once a round hands the next a
  distribution of the same shape, only smaller, the rest is summed as a geometric series,
  and a chain that has not settled is noted as an estimate. Where the exit leaves the
  item is what the next steps see: a second such loop starts from it.
- An **`if`** splits each branch by its condition's chance; a `restart` ends the
  attempt; a `stop` ends the craft; a top-level `restart` makes the guide one attempt of
  an outer loop.

Where the model cannot say (a loop whose exit rests on a value no roll in its body
changes, an item the snapshot does not price), the
step's note says so and names what the walk assumes there.

---

## 7. The economy

Prices come from a **snapshot committed with the data**,
`packages/data/data/poe1/economy.json`, for one league on one day, never from live calls
in the checker, the CLI or the editor (Q62), so a figure is
reproducible and dated by the snapshot. `fetch-economy.mjs`
refreshes it with five requests and nothing else: poe.ninja's exchange overview
(`/poe1/api/economy/exchange/current/overview`) for `Currency`, `Essence`, `Fossil` and
`Resonator`, and its stash overview (`/poe1/api/economy/stash/current/item/overview`)
for `Beast`. Both are the endpoints the site's own pages read, undocumented (the
documented one answers 404), keyed by the league's display name from
`/poe1/api/data/index-state`; when they move, the script is what changes.

The snapshot cannot price three things, which the code carries itself: a bench craft's
cost, read from the catalog; a Harvest craft's lifeforce, a table in `cost/prices.ts`
from the wiki's `harvest_crafting_options`; and the beasts a Bestiary recipe takes, a
table there from `bestiary_recipes`, each beast then priced by the snapshot.

---

## 8. Known differences from craftofexile

craftofexile's calculator and simulator are the yardstick; hinekora agrees with them
wherever the calculator is exact, to the rounding of its display. Where they differ:

- **Its extrapolation regime** (ten or more eligible types on a side) replaces the
  unrequired draws by an average depletion, about a tenth optimistic against the race;
  a difference there is not a defect.
- **Its side split** draws independently at the prefix pool's share, ignoring depletion,
  which the race includes.
- **Its Orb of Alteration** assumes an Augmentation fills the empty side; hinekora prices
  the alteration alone (Q58).
- **The race's clocks are modifier types**, not groups, so two types of one group may both
  be drawn and a group's other members never close it; on a wand's spell damage this
  moves the figure by up to a fifth either way (Q73).
- **An item the checker cannot narrow** reads an open count at its floor and keeps only
  a path's last roll, where the game's item remembers every roll (Q57).
