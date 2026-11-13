# The item block

A craft opens with one item block. It declares the starting item, the only state a craft
declares; the checker infers the rest.

```hinekora
item {
    base:     "Iron Ring"
    ilvl:     84
    rarity:   rare
    prefixes: [ "maximum life" t2, bench "maximum mana" ]
    suffixes: [ fractured "fire resistance" t3, "random" ]
}

exalt
```

## Fields

A block must have `base`, `ilvl` and `rarity`.

| Field                  | Value                             | When absent       |
| ---------------------- | --------------------------------- | ----------------- |
| `base`                 | a quoted base name                | an error          |
| `ilvl`                 | the item level, an integer        | an error          |
| `rarity`               | `normal`, `magic` or `rare`       | an error          |
| `prefixes`, `suffixes` | a bracketed list of modifiers     | none on that side |
| `influences`           | one or two influence words        | no influence      |
| `exarch`, `eater`      | an eldritch tier, then a wording  | no such implicit  |
| `enchant`              | a passive count and a quoted stat | no enchantment    |
| `strands`              | memory strands, 0 to 100          | none              |
| `corrupted`            | no value, or `twice corrupted`    | not corrupted     |

`base` names an item a craft can work on: equipment, a jewel, a flask and similar. No step
changes `base` or `ilvl`.

The checker rejects a block that lists more modifiers than the base holds at its
[rarity](https://www.poewiki.net/wiki/Rarity), or a modifier on the wrong side.

## Modifiers

Each entry of `prefixes` and `suffixes` is a [modifier name](./names) with a tier, such as
`"maximum life" t2`. A name without a tier is an error unless the item level allows one tier.

`"random"`, or `"?"`, declares a modifier the craft does not name. The checker counts it
and treats it as any natural modifier the item could roll on that side. A later step must be
safe whatever that modifier turns out to be:

<!-- refused -->

```hinekora
item {
    base:     "Iron Ring"
    ilvl:     84
    rarity:   rare
    prefixes: [ "maximum life" t2 ]
    suffixes: [ "fire resistance" t3, "random" ]
}

bench "cold resistance"
```

```txt
at this point the item is: Iron Ring · Rare · 3 affixes · 1 prefix · 2 suffixes · ilvl 84
The item may already carry a "cold resistance" modifier — an item holds at most one per group, so this can't be benched.
```

Two marks go before a name, alone or together:

- `fractured` declares a [fractured modifier](https://www.poewiki.net/wiki/Fractured_item#Mechanics),
  which no step removes or changes. `fractured "random"` leaves it unnamed.
- `bench` declares a crafted modifier, named as the [`bench`](/docs/operations/bench) step
  names it. Its tier is optional. It counts toward the item's limit of crafted modifiers.

## Influences and implicits

`influences: hunter` declares an
[influenced item](https://www.poewiki.net/wiki/Influenced_item#Mechanics). The words are
`shaper`, `elder`, `crusader`, `hunter`, `redeemer` and `warlord`. An influenced item rolls
its influence's modifiers, and a craft names them like any other. The checker rejects an
influence beside a fractured modifier, and one on a class that takes no influence.

`exarch: grand` and `eater: lesser` declare
[eldritch implicits](https://www.poewiki.net/wiki/Eldritch_implicit_modifier) by tier:
`lesser`, `greater`, `grand`, `exceptional`, `exquisite` or `perfect`. A quoted wording after
the tier names the implicit. The checker rejects them on an influenced item and below
item level 75.

`enchant: 8 "lightning damage"` declares a
[cluster jewel](https://www.poewiki.net/wiki/Cluster_jewel#Mechanics)'s passive count and
the stat of its small passives. A cluster jewel requires it.

## Corruption

`corrupted` declares a [corrupted item](https://www.poewiki.net/wiki/Corrupted). The checker
then rejects every step except [`unveil`](/docs/operations/unveil) and
[`locus`](/docs/operations/locus). `twice corrupted` declares one the altar has corrupted
again, which then takes no step.
