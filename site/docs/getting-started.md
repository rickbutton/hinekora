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

The build writes the command-line tool to `packages/cli/dist/cli.js`. The game data ships
with it.

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

The [item block](./language/item) declares Normal boots. The
[`essence`](/docs/operations/essence) step makes them Rare with maximum Life and random
modifiers, and the [`until`](./language/until) loop repeats it until they have tier 1 fire
resistance.

## Check it

```sh
node packages/cli/dist/cli.js check first.craft
```

```txt
data: repoe-fork/repoe @ 509bdf7afe (poe1, game 3.30.0.1.3)

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

The first line names the game data. Under the verdict is the finished item, laid out as the
game's item text: the two named modifiers are on every one, and the last line counts the rest.

## A step the checker rejects

Bench movement speed after the loop, where the essence rolled none:

<!-- fragment -->

```hinekora
if not has group "movement speed" {
    bench "movement speed"
}
```

```txt
first.craft:11:5: error: at this point the item is: Titan Greaves · Rare · 4–6 affixes · 1–3 prefixes · 1–3 suffixes · ilvl 84
  Requires an open prefix slot — the item may have none open.
  11 |     bench "movement speed"
     |     ^
  For example, this item:
    Item Class: Boots
    Rarity: Rare
    Titan Greaves
    --------
    Item Level: 84
    --------
    { Prefix Modifier "Pirate's" (Tier: 1) — Drop }
    (13-18)% increased Rarity of Items found
    { Prefix Modifier "Mammoth's" (Tier: 1) — Defences, Armour }
    (39-42)% increased Armour
    (16-17)% increased Stun and Block Recovery
    { Prefix Modifier "Essences" — Resource, Life }
    +(91-105) to maximum Life
    { Suffix Modifier "of Tzteosh" (Tier: 1) — Elemental, Fire, Resistance }
    +(46-48)% to Fire Resistance

✗ 1 error
```

Movement speed is a prefix, and the essence can fill all three, as on the item under the
error.

A count in the [branch](./language/if) restricts the step to the items that can take it:

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

This craft checks.

## Next

- `cost first.craft` estimates the spend. See [Reading a cost report](./cost).
- [Command line](./cli) lists every command.
- [Editor support](./editor) covers the VS Code extension.
- [Syntax overview](./syntax) starts the language reference.
