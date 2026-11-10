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
a step, which keeps the checker a pure soundness tool.
---

## 2. How the game rolls

A row's weight is its first spawn-weight tag the item carries
([Modifier § Spawn weight tag](https://www.poewiki.net/wiki/Modifier#Spawn_weight_tag)),
scaled by its generation weight. A
reforge rolls a count, then draws modifiers one at a time by weight without replacement,
a group closing once one of it is drawn
([Modifier § Group/family](https://www.poewiki.net/wiki/Modifier#Group/family)) and a
side closing when full (the wiki gives the group rule; the order is every calculator's). An
unveil's three
options are drawn the same way
([Veiled modifier § Version history](https://www.poewiki.net/wiki/Veiled_modifier#Version_history)),
of the veiled modifier's side where the item says which; the player takes the guide's
target if offered, else a modifier its conditions ask for, else one no one names. A
value falls as
[Modifier § Mechanics overview](https://www.poewiki.net/wiki/Modifier#Mechanics_overview)
has it, a Vaal Orb's outcomes as
[Vaal Orb § Equipment](https://www.poewiki.net/wiki/Vaal_Orb#Equipment), a Sanctified
Fossil's weights as
[Sanctified Fossil § Further analysis](https://www.poewiki.net/wiki/Sanctified_Fossil#Further_analysis),
its lucky values not modelled; a Tangled Fossil's roll is not read.

Where no source settles a rule, the code reads it so (each a `QUESTIONS.md` entry):

- **Counts.** A Rare reforge (Chaos Orb, Alchemy, essence, resonator, Harvest reforge,
  Veiled Chaos) is 4, 5 or 6 at 8:3:1, the forced row within it
  ([Chaos Orb § Mechanics](https://www.poewiki.net/wiki/Chaos_Orb#Mechanics), Q59); a
  base holding four or five takes one fewer or all at 65:35; a Magic reforge one or two at
  even odds (Q58). An Eldritch Chaos Orb's kept side counts toward the total, the
  rerolled side taking what fits.
- **Fossils.** Several fossils' "more" multipliers add and a "fewer" multiplies the
  result (Q60).
- **Harvest.** The tagged row is drawn among the tag's rows by weight (Q63).
- **Removals** are uniform over the modifiers they can reach, never a fractured one (Q61).
- **Veiled orbs.** The veiled modifier lands on either side with room alike (Q76).
- **Tainted Exalted Orb.** It adds or removes at even odds, and removes from a full item
  (Q95).
- **Orb of Conflict.** The line of
  [Orb of Conflict § Mechanics](https://www.poewiki.net/wiki/Orb_of_Conflict#Mechanics)
  is carried past the gap it states, neither side below one in a hundred (Q96).
- **Harvest augment** adds, then removes another
  ([Maxroll](https://maxroll.gg/poe/crafting/harvest-crafting-guide)).
- **Memory strands.** The share used up is not stated; the estimate reads the floor
  (Q68).

---

## 3. The item the cost layer follows

The checker's item at a step is a set of items; a probability needs to know how likely
each member is. The cost layer follows a **distribution over a small state**
(`cost/track.ts`): the (prefix, suffix) counts and, for each modifier a condition names
or the checker knows is there (declared, granted, crafted, a protecting metamod, a veiled
placeholder; each eldritch implicit's tier, and its type where a condition names one), whether it is on the item, in which tier class (each tier a condition names
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

What stays approximate: the modifiers no one names are a count, not identities, so a draw
beside them keeps each unnamed group's weight by its chance of not being among that many
draws by weight. A step that cannot carry a state exactly says so, and the walk reads on
from the checker's item, as it does once it has read 5000 states (`TrackerOverflow`).
There a roll is read on the facts every path holds: a modifier held only as possible
neither shrinks the pool nor adds its tags, and every range the checker left open is read
at its floor and at its ceiling (`Reading`), a **spread** given beside the figure where
the ends disagree.

---

## 4. The race: an exact draw without listing outcomes

The draw has an exact representation as a **race**: give every modifier group an
exponential clock whose rate is its types' weights together, read the
groups off in the order their clocks fire, skip a group whose side is full.
"These groups are all among the first k drawn" is "fewer than k minus their number of
the other groups fired before the last of them", a Poisson-binomial count at a time,
integrated against that time's density; the split of m draws is a race between the two
sides' order statistics. The dynamic program (`cost/race.ts`) carries a count, never a list of draws.

It is exact for one group, for any set jointly (by inclusion–exclusion), and for the
split with depletion. Given the split, which groups landed on a side is read from that
side's race alone, where the true draw couples the two through depletion; the race
tests bound that at two hundredths. Two groups fit a clock loosely, each bounded by a
test against the draw played out (`packages/cli/src/race.test.ts`): one with rows on both sides (a
jewel's) is a mixture, wholly a prefix or wholly a suffix by weight, and a type listing
several groups (an unveil's attribute hybrids) shares a clock only with types it all
excludes, which reads it up to a fifth high.

---

## 5. From a method to a roll, from a roll to a chance

`cost/roll.ts` reads a method's op sequence into its **roll**: the random `fill` with
the pool it draws from (the checker's own `pool` on the sure facts), the count of draws
and the modifiers present for certain (kept, or placed first), or else a removal, a
fracture, an unveil, an implicit or a reroll.

`cost/chance.ts` evaluates the checker's resolved predicate against the roll. A `has`
atom on a side is "its group among the first p of that side's race", the type and row by weight
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

- An **`until`** whose body the tracker can follow
  is not memoryless: each round starts where the last left the item.
  It is solved as a Markov chain (`cost/chain.ts`) over the tracked state, from the
  states the loop enters with. The
  distribution is carried round after round until the mass has left (the exit or a
  stop); once a round hands the next a
  distribution of the same shape, only smaller, the rest is summed as a geometric series.
  A chain not settled within the rounds followed is solved over its states, or past a
  few hundred noted as an estimate; the states that cannot reach the exit hold the
  share that never leaves. Where the exit leaves the item is what the next steps see.
- Any other `until` is a sequence of independent attempts: the body is walked once to
  find the chance an attempt ends in the exit or a `stop`; the expected rounds is the
  reciprocal, and the share ending in a stop ends the craft.
- An **`if`** splits each branch by its condition's chance; a `restart` is back at
  its loop's head with the item as it is, the checker's meaning; a `stop`, or a
  `restart` outside every loop, ends the craft.

Where the model cannot say, the step's note says why. A loop whose rounds have no
figure (the check refuses it, no round reaches its exit, or the item sticks short of
it) is given none, nor are its steps or the guide's total.

---

## 7. The economy

Prices come from a **snapshot committed with the data**,
`packages/data/data/poe1/economy.json`, for one league on one day, never from live calls, so a figure is reproducible and dated. `fetch-economy.mjs`
refreshes it from poe.ninja's economy overview endpoints, which its
[API reference](https://poe.ninja/docs/api) supports without promising them stable.

What the snapshot cannot price (a bench craft, a Harvest craft's lifeforce, a Bestiary
recipe's beasts) `cost/prices.ts` carries from the catalog and the wiki's tables.

---

## 8. Known differences from craftofexile

craftofexile's calculator and simulator are the yardstick, not the truth: where they and
hinekora part, the wiki and the game data decide. craftofexile
differs in that:

- its calculator **extrapolates** at ten or more eligible types on a side, an average
  depletion standing for the draws not asked for, a few per cent optimistic;
- its **side split** depletes crudely, by the heaviest modifier a draw;
- its Orb of Alteration defaults to **Alt + Augment**, where hinekora prices the
  alteration alone (Q58);
- it weighs a **Foulborn** orb's pool as a Sanctified Fossil's, where hinekora culls tiers
  as the wiki has it, and it has no **memory strands**;
- it ignores **metamods** on essences and fossils, and the level caps of low-tier
  essences;
- it does not halve attack rows on a **Convoking Wand**, as the data's generation weights
  do;
- a base of five slots takes four or five modifiers at two to one there, 65:35 here.
