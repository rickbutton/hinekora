---
title: How it works
aside: false
---

# How it works

Hinekora has two parts. The checker decides whether every step of a craft can apply. The cost
layer estimates what the craft spends. Both read the same description of each crafting method.

## The problem

Most crafting steps are random. One Chaos Orb can leave a ring as any of thousands of items. A
craft chains many steps, some inside loops, and no one can list the items it can produce.

The checker does not need the list. It needs to know whether a step can fail to apply. An
Exalted Orb needs an open slot. A bench craft needs an open slot on its side and no modifier
of its group on the item. If one outcome of the earlier steps breaks that, the craft can leave
an item stuck halfway.

<HowTree />

## The item is a set of items

The checker is an [abstract interpreter](https://en.wikipedia.org/wiki/Abstract_interpretation):
it runs the craft on a description of many items at once. At a point of a craft, the checker's
item is not one item but every item the steps so far could have made. It holds that set
exactly.

Picture the set as a table. It has one axis for each fact about the item that a step can
change. A position on every axis picks out one item. Each cell holds yes or no: can this item
exist here? A toy ring with three axes shows the shape:

<HowTable />

A real item has an axis for each modifier the craft can put on the base. Its positions are
"absent" and each tier. A tier also carries the fractured or crafted mark where the craft can
give one, and splits at a number the craft compares, as in `has "maximum life" >= 110`. The
item adds an axis each for rarity, corruption, influences and memory strands, and two for each
eldritch implicit.

<HowAxes />

The prefix and suffix counts are not axes. The checker counts them from the modifier axes, so a
count can never disagree with the modifiers. The game's rules, such as one modifier per group
and the caps of each rarity, form one fixed table of legal items. Every table the checker
builds stays inside it.

## Facts about a group of modifiers

The table holds facts that no list of single modifiers can. This loop ends when the ring has
any of three resistances:

```hinekora
item {
    base:   "Vermillion Ring"
    ilvl:   84
    rarity: rare
}

until has "fire resistance" or has "cold resistance" or has "lightning resistance" {
    chaos
}
```

After the loop the ring may have one of the three, two, or all. It cannot have none. Cut the
table down to the three resistance axes and the fact is plain. The loop's condition removes
the one row that breaks it:

<HowPresence />

Two lists, "surely there" and "surely not", lose this fact. No resistance is sure either way,
so both lists are empty and all eight rows pass. The table keeps it, so the checker reports a
later `if` that tests for none of the three as dead.

No one writes the table down. A ring's table has about <HowCells /> cells. The checker
stores it as a [decision diagram](https://en.wikipedia.org/wiki/Binary_decision_diagram): a
chain of questions, one per axis, where equal sub-questions share one copy. The right half of
the figure is one. On a ring, the diagram of every legal Rare item asks a few hundred
questions in all, and a step takes a few milliseconds.

## A step changes the table

Each crafting method is a short sequence of primitive operations. A Regal Orb is, in order:

1. require a Magic item that is not corrupted, on a base that can be Rare;
2. set the rarity to Rare;
3. add one modifier from the pool the item can roll;
4. use up memory strands, if the item has any.

Each operation turns one table into another. Every yes-cell goes to every item the operation
could make of it. A `require` must hold on every yes-cell, or the checker refuses the whole
method, since the game never applies half a currency. An Exalted Orb adds one modifier to an
open slot, and the result must still be a legal item:

<HowStep />

About twenty primitives cover every method. Adding a method adds a sequence and leaves the
checker alone.

## Branches and loops

A condition is a mask over the table: it passes some cells and blocks the rest. At an `if` the
checker keeps the cells the condition passes for one arm and the rest for the other. Where the
arms meet, each cell takes yes if either arm has yes there. An arm that no yes-cell can enter is
dead.

A loop body must be safe on every pass. From the items entering the loop, the checker runs the
body on those that do not meet the condition yet and adds what comes back to the top. It repeats until a round adds nothing. This loop exalts until it rolls tier 1
Life:

<!-- refused -->

```hinekora
item {
    base:   "Vermillion Ring"
    ilvl:   84
    rarity: rare
}

until has "maximum life" t1 {
    exalt
}
```

The checker follows the rings at the top of the loop, round by round:

<HowLoop />

Each round adds rings with one more modifier. In round seven the exalt meets the full rings, and
the checker refuses it. After a loop the condition is true, and the checker keeps
only the cells that meet it.

## Why exact matters

Exactness is what lets a craft like this one check. The ring starts with five modifiers:

```hinekora
item {
    base:     "Vermillion Ring"
    ilvl:     84
    rarity:   rare
    prefixes: ["random", "random", "random"]
    suffixes: ["random", "random"]
}

exalt
if not has "maximum life" t1 {
    annul
}
if not has "maximum life" t1 {
    exalt
}
```

The first `if` leaves two kinds of ring. A ring with tier 1 Life skips the annul and keeps six
modifiers. The rest lose one and have five. The second `if` meets only rings with
five, and its Exalted Orb has a slot. The craft checks.

<HowParts />

A summary that kept each fact on its own would let in the red cell. It would refuse the second
exalt for a ring never made.

## What a verdict means

The checker rounds nothing, so it loses nothing. Up to its first error, it refuses a step only
when an item the craft can make breaks it. Past an error it goes on from assumed items, so a
later error may follow from the first. Where it can, it prints an item that breaks the step.

"Can make" means within the checker's model of the game. The model is the game's rules as the
[Path of Exile wiki](https://www.poewiki.net/) states them. Where the wiki is silent, the
code follows a recorded assumption. A wrong rule in the model gives a wrong verdict.

Where the checker cannot follow a craft, it says so: a diagram past its budget, or a loop still
changing after 256 rounds, is an error at that step, and the steps after it go unchecked.

## Cost

The checker says nothing about odds. The cost layer reads the same method sequences and the
checker's tables, and it cannot change a verdict.

The game draws modifiers one at a time by weight. A drawn modifier closes its group, and a full
side closes too. For one Orb of Alteration the arithmetic is short:

<HowWeights />

A Chaos Orb draws four to six modifiers, and each draw changes the weights left for the
next. The cost layer treats the draw as a race. Every modifier group gets a clock that fires
at a rate equal to its weight, and the order the clocks fire in is the order of the draw. "Tier
1 Life is among the prefixes" becomes an integral over the time its clock fires. The answer is
exact for one group and close for conditions that span both sides. It lists no outcomes.

A loop is a chain of states. A state is the prefix and suffix counts and the modifiers the
conditions name. Each round moves the item between states with the chances the race gives.
Solving the chain gives the expected number of rounds.

<HowChain />

The expected spend of a step is its expected number of runs times its price. Prices come from
a market snapshot kept with the data, so the same craft always gives the same figure.

The design in full is in the repository:
[the checker](https://github.com/rickbutton/hinekora/blob/main/docs/ARCHITECTURE.md) and
[the cost layer](https://github.com/rickbutton/hinekora/blob/main/docs/cost.md).
