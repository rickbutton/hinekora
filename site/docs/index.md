# Introduction

A crafting guide is a list of steps: start from this base, spam this essence until a
resistance rolls, lock the suffixes, reforge. hinekora is that list written so a program can
read it. Every step is checked against every outcome the steps before it could have had, so a
guide that works only when you are lucky is caught before you follow it.

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

Deafening Essence of Greed reforges the boots with maximum Life guaranteed, and the loop goes
round until a tier 1 fire resistance rolls with it. When the loop ends, hinekora knows both are
on the item.

## What it checks

- **Each step's needs.** An exalt needs a Rare item with an open slot; a bench craft needs an
  open slot of its side and no modifier of its group. A step is accepted only if what it needs
  is true on every path the craft can have taken.
- **Names.** Bases, modifiers, essences, bench crafts and fossils are looked up in the game's
  data, and a tier that cannot roll on this base at this item level is an error.
- **Control.** A loop that can never finish, or never runs, and a branch that can never be
  taken are reported.

## Where to go next

- [Syntax overview](./syntax): the whole language on one page.
- [Loops: until, restart, stop](./language/until): repeating a step until it lands.
- [Operations](./operations/): every currency and craft, one page each.
- [Playground](/playground/): write a guide in the browser and see the item at every step.
