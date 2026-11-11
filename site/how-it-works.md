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

## One summary for every outcome

The checker is an [abstract interpreter](https://en.wikipedia.org/wiki/Abstract_interpretation).
It keeps one value, the abstract item, that stands for every item the steps so far could have
produced. The abstract item has four parts:

<HowModel />

<HowTrace />

## Which modifiers are present

Steps depend on which modifiers the item has. A bench craft cannot add fire resistance to an
item that has one, and an `if has "maximum life"` sends the items with Life one way and the
rest the other. The checker has to track which modifiers can be there.

Often the checker is sure of no single modifier and still knows a fact about a group of
them. This loop ends when the ring has any of three resistances:

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

After the loop the ring may have any one of the three, or two, or all. It cannot have none.
To hold a fact like that, the presence part is a rule. Give it a yes or a no for each
modifier, and it answers whether an item with that combination can exist at this point. A
rule of this kind is a boolean function. Written as a table, it has a row for each
combination, and the loop's condition removes the one row that breaks it:

<HowPresence />

Two lists, "surely there" and "surely not", cannot hold this fact. No one resistance is sure
to be there and none is sure to be absent, so both lists are empty and all eight rows pass.
With the rule, the checker knows that a later test for "none of the three" is dead.

A table doubles with every modifier, and a ring can roll dozens. The checker stores the rule
as a [decision diagram](https://en.wikipedia.org/wiki/Binary_decision_diagram), which asks
about one modifier at a time and shares the questions that many combinations have in common.

## A step changes the summary

Each crafting method is a short sequence of primitive operations. A Regal Orb is, in order:

1. require a Magic item that is not corrupted, on a base that can be Rare;
2. set the rarity to Rare;
3. add one modifier from the pool the item can roll;
4. use up memory strands, if the item has any.

The checker runs each operation on the abstract item. A `require` must hold for every item the
summary stands for, or the whole method fails, since the game never applies half a currency.
Adding a modifier raises the count ranges by one and records the pool's modifiers as possible.

About twenty primitives cover every method. A Chaos Orb is a `strip` and a `fill`. An Orb of
Annulment is a `remove`. A new method is a new sequence, with no change to the checker.

## Branches and loops

At an `if` the checker narrows the summary by the condition for one arm and by its negation
for the other. After the arms it joins the two results into one summary that covers both. It
reports an arm whose condition cannot hold as dead.

A loop body must be safe on every pass. The checker takes the summary entering the loop, runs
the body, and joins the result back into the summary at the top. It repeats until a pass adds
nothing. That summary covers every pass, and the checker judges the body against it.

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

<HowLoop />

A range that is still moving after many rounds jumps to its limit, so the iteration always
ends. After the loop the condition is true, and the checker narrows the summary by it.

## What a verdict means

The summary always covers at least every item the game could produce. If no check fails on the
summary, none fails on a real item. The price is the other direction. The summary can cover an
item that no path produces, so the checker can reject a craft that would have worked. Within
its model of the game's rules it does not accept one that can fail.

## Cost

The checker says nothing about odds. The cost layer reads the same method sequences and the
checker's summaries, and it cannot change a verdict.

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
