# Introduction

A craft is a `.craft` file: a starting item, then a sequence of crafting steps applied to it.
Each step is a method of the game (a currency orb, a bench craft, an essence, a Harvest or
Bestiary craft), and most have a random outcome. Loops and branches choose the next step from
what the item has.

```hinekora
item {
    base:   "Titan Greaves"
    ilvl:   84
    rarity: normal
}

until has "fire resistance" t1 {
    essence "greed" t1
}
```

The essence reforges the boots with maximum Life guaranteed and the other modifiers random.
The loop tests for a tier 1 fire resistance before each pass and applies the essence while
there is none. After the loop, the checker knows both modifiers are present.

The checker reports a step whose precondition may fail on some path, a name it cannot
resolve, a loop that cannot exit and a branch the craft can never take. [Errors](./errors)
shows each kind.

## Pages

Overview

- [Getting started](./getting-started): build the tool, check a first craft
- [Syntax overview](./syntax): the shape of a file

Language

- [The item block](./language/item)
- [Names and tiers](./language/names)
- [Conditions](./language/conditions)
- [Loops: until, restart, stop](./language/until)
- [Branches: if and else](./language/if)
- [Definitions](./language/def)

Tools

- [Command line](./cli)
- [Reading a cost report](./cost)
- [Errors](./errors)
- [Editor support](./editor)
- [Playground](/playground/), the checker in the browser

Reference

- [Operations](./operations/), one page per crafting method
- [How it works](/how-it-works), the checker and the cost layer
