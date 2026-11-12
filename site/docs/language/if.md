# Branches: if and else

<!-- fragment -->

```hinekora
if <condition> {
    <statements>
} else {
    <statements>
}
```

`if` tests a [condition](./conditions) once and runs one arm. The `else` arm is optional. An
`else` takes a block, so a chain of tests is an `if` nested inside the `else` block.

## Narrowing

The checker follows both arms. In the `if` arm it keeps only the items for which the
condition is true. In the `else` arm it keeps the items that fail the condition. A step in an
arm must apply to every item that arm keeps.

```hinekora
item {
    base:   "Iron Ring"
    ilvl:   84
    rarity: normal
}

transmute
if suffixCount == 0 {
    augment
}
regal
```

A [`transmute`](/docs/operations/transmute) leaves one or two modifiers on a Magic item, which
holds one prefix and one suffix. An [`augment`](/docs/operations/augment) needs an open slot.
Without the `if` the checker rejects the `augment`, because the item may be full. Inside the
arm the item has no suffix, so the slot is open.

## After the branch

After the arms the checker takes the items of both together. A later step must apply to
every item from either arm.

<!-- refused -->

```hinekora
item {
    base:   "Iron Ring"
    ilvl:   84
    rarity: normal
}

transmute
if has "maximum life" {
    regal
} else {
    scour
}
chaos
```

```txt
at this point the item is: Iron Ring · Normal or Rare · 0–3 affixes · 0–2 prefixes · 0–2 suffixes · ilvl 84
Requires a Rare item — this item may be Normal or Rare.
```

The first arm leaves a Rare item and the second a Normal one. A
[`chaos`](/docs/operations/chaos) needs a Rare item on both. Adding an
[`alchemy`](/docs/operations/alchemy) after the `scour` makes both arms Rare, and the craft
checks.

Nothing is lost where the arms meet. If one arm ends with maximum Life on the item and the
other with maximum Mana, every item afterwards has one of the two. A later test for
"neither" is then an arm that never runs.

An arm that ends in [`stop` or `restart`](./until) adds no item after the branch. After
`if not has "maximum life" { stop }` the checker knows the item has maximum Life.

## Arms that never run

The checker reports an arm that no item can reach. The `if` arm is dead when the condition is
false for every item. The `else` arm is dead when the condition is true for every item.

<!-- refused -->

```hinekora
item {
    base:   "Iron Ring"
    ilvl:   84
    rarity: normal
}

transmute
if isMagic {
    regal
} else {
    alchemy
}
```

```txt
the 'else' branch can never run: isMagic always holds here
```

The other message reads `the 'if' branch can never run: <condition> is impossible here`. The
checker accepts an `if` without an `else` whose condition is always true.
