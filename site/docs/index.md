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

The essence reforges the boots with maximum Life guaranteed and the other modifiers random. The
loop repeats it until a tier 1 fire resistance is among them. After the loop, the checker knows
both modifiers are present.

## What the checker reports

- A step whose precondition may fail on some path: an exalt where the item may be full, a bench
  craft whose group may already be present, a currency on the wrong rarity. The report gives the
  item's state at that point and the requirement that failed.
- A name that resolves to no base, modifier, essence, bench craft or fossil, or to more than one,
  and a tier that cannot roll on the base at its item level.
- A loop that can never exit or whose body never runs, and a branch that can never be taken.

## Pages

- [Syntax overview](./syntax)
- [Loops: until, restart, stop](./language/until)
- [Operations](./operations/), one page per crafting method
- [Playground](/playground/), the checker in the browser
