# Getting started

The [playground](/playground/) runs the checker in the browser and needs no install. The steps
below build the command-line tool from the repository.

## Build

Building it needs [Node.js](https://nodejs.org/) 22 or later and [pnpm](https://pnpm.io/).

```sh
git clone https://github.com/rickbutton/hinekora
cd hinekora
pnpm install
pnpm build
```

The build writes the command-line tool to `packages/cli/dist/cli.js`. The game data ships in
the repository, so the tool makes no network request.

## A first craft

Save this as `first.craft`:

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

The [item block](./language/item) declares a pair of Normal boots. The
[`essence`](/docs/operations/essence) step reforges them into a Rare item with maximum Life
and other random modifiers. The [`until`](./language/until) loop repeats it while the boots
have no tier 1 fire resistance.

## Check it

```sh
node packages/cli/dist/cli.js check first.craft
```

```txt
data: repoe-fork/repoe @ aa9fa7c394 (poe1, game 3.29.3.4)

✓ first.craft checks.

  Item Class: Boots
  Rarity: Rare
  Titan Greaves
  --------
  Item Level: 84
  --------
  { Prefix Modifier "Essences" — Resource, Life }
  +(91-105) to maximum Life
  { Suffix Modifier "of Tzteosh" (Tier: 1) — Elemental, Fire, Resistance }
  +(46-48)% to Fire Resistance
  { 2-4 additional prefix or suffix modifiers }
```

The first line names the game data. The item under the verdict is what the checker knows at
the end of the craft, laid out as the game's item text. The two named modifiers are on every
finished item. The last line counts the modifiers the checker cannot name.

## A step the checker rejects

Add a bench craft after the loop:

<!-- fragment -->

```hinekora
bench "movement speed"
```

```txt
first.craft:10:1: error: at this point the item is: Titan Greaves · Rare · 4–6 affixes · 1–3 prefixes · 1–3 suffixes · ilvl 84
  Requires an open prefix slot — none is guaranteed open here.
  10 | bench "movement speed"
     | ^

✗ 1 error
```

The error gives the position, the item at that step and what the step needed. Movement speed
is a prefix and boots hold three. The essence can fill all three, so on some paths the bench
craft has no slot.

A [branch](./language/if) restricts the step to the items that can take it:

```hinekora
item {
    base:   "Titan Greaves"
    ilvl:   84
    rarity: normal
}

until has "fire resistance" t1 {
    essence "greed" t1
}
if prefixCount <= 2 and not has group "movement speed" {
    bench "movement speed"
}
```

This craft checks. The craft needs the second test because the essence can roll a
movement speed modifier itself.

## Next

- `cost first.craft` estimates the spend. See [Reading a cost report](./cost).
- [Command line](./cli) lists every command.
- [Editor support](./editor) covers the VS Code extension.
- [Syntax overview](./syntax) starts the language reference.
