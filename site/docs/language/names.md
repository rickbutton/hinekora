# Names and tiers

A craft names things in two ways. Operations and keywords are bare words: `chaos`, `exalt`,
`until`. Everything from the game's data is a quoted string: a base, a modifier, an essence,
a fossil, a bench craft, a Harvest tag.

## Modifier names

A quoted modifier name is a search over the stat text of the
[modifiers](https://www.poewiki.net/wiki/Modifier) the item can have. It names a modifier
type, every tier of it.

- The search ignores case, numbers and punctuation.
- Each word of the name must match a word of the stat text. A word matches whole, or as a
  prefix of three letters or more. `"max life"` names "+# to maximum Life".
- The checker ranks matches by how much of the stat text the name covers. `"maximum life"`
  names the flat life modifier, not "#% increased maximum Life".
- Some common short forms are read as the game's wording, such as `"max es"` for maximum
  Energy Shield.
- A modifier's id from the game data, such as `"IncreasedLife5"`, names that one tier.

The search prefers modifiers that roll on the base at its item level. The checker
rejects a name that matches nothing, and a name that two modifier types match equally well:

<!-- refused -->

```hinekora
item {
    base:   "Iron Ring"
    ilvl:   84
    rarity: rare
}

until has "res" {
    chaos
}
```

```txt
Ambiguous name "res" — candidates: +(6-11)% to Fire Resistance, +(6-11)% to Cold Resistance, +(6-11)% to Lightning Resistance, +(5-10)% to Chaos Resistance.
```

## Tiers

`t<n>` after a name picks one tier. `t1` is the modifier's Tier 1 on that base, as the game's
advanced tooltip numbers it. The count runs over every tier the base can have, best first,
whatever the item's level. A number past the last tier is an error.

The item level decides which tiers a currency can roll. The numbers stay the same. On an
Iron Ring, Tier 1 of maximum Life needs
[item level](https://www.poewiki.net/wiki/Item_level) 44:

<!-- refused -->

```hinekora
item {
    base:   "Iron Ring"
    ilvl:   30
    rarity: rare
}

until has "maximum life" t1 {
    chaos
}
```

```txt
this loop can never exit: has "maximum life" t1 can never become true here — Tier 1 "maximum life" needs item level 44; this item is level 30
```

The [item block](./item) accepts a tier above the item's level, since an essence or a Harvest
craft can leave one on an item.

## Other names

| Step                                                         | The name                                                      |
| ------------------------------------------------------------ | ------------------------------------------------------------- |
| [`essence "greed" t1`](/docs/operations/essence)             | whole words of the essence's name, with a tier                |
| `essence "Deafening Essence of Greed"`                       | the full name, no tier                                        |
| [`fossil "pristine" "dense"`](/docs/operations/fossil)       | whole words of each fossil's name                             |
| [`bench "maximum life"`](/docs/operations/bench)             | the modifier the bench craft adds, matched as a modifier name |
| [`harvest reforge "life"`](/docs/operations/harvest-reforge) | one of a fixed list of tags                                   |

An essence tier counts from the best: `t1` is Deafening and `t7` is Whispering. A `bench`
step takes the best craft the bench has for the item, or the one `t<n>` picks.

```hinekora
item {
    base:   "Iron Ring"
    ilvl:   84
    rarity: normal
}

until has "max life" and has "fire res" t1 {
    essence "greed" t1
}
```

The editor completes every kind of name, and its hover on a modifier name lists the tiers.
See [Editor support](../editor).
