# Syntax overview

The whole language on one page. Each part links to its own page for the details.

## A file

A guide is one `.craft` file. It opens with the item you start from, then lists the steps.
Blocks use braces, line breaks do not matter, and a comment runs from `#` to the end of the
line.

```hinekora
# Finish a ring at the bench.
item {
    base:     "Iron Ring"
    ilvl:     84
    rarity:   rare
    prefixes: [ "maximum life" t2 ]
    suffixes: [ "fire resistance" t3, "lightning resistance" t3 ]
}

bench "cold resistance"
```

The item is never named again: every step acts on the current item.

## The starting item

The `item` block is the only place an item is described. After it, hinekora works out what the
item can be at every step.

| Field                  | Example                           | Meaning                                                                 |
| ---------------------- | --------------------------------- | ----------------------------------------------------------------------- |
| `base`                 | `"Titan Greaves"`                 | the base, by its name in the game                                       |
| `ilvl`                 | `84`                              | the item level                                                          |
| `rarity`               | `normal`, `magic`, `rare`         | the rarity                                                              |
| `prefixes`, `suffixes` | `[ "maximum life" t2, "random" ]` | the modifiers, each at its tier; `"random"` is one you don't care about |
| `fractured`, `bench`   | `fractured "maximum life" t1`     | a fractured or a crafted modifier, inside the lists                     |
| `influences`           | `hunter`, `shaper elder`          | the item's influences                                                   |
| `exarch`, `eater`      | `grand`                           | the tier of an eldritch implicit                                        |
| `enchant`              | `8 "lightning damage"`            | a cluster jewel's enchantments                                          |
| `strands`              | `82`                              | memory strands                                                          |
| `corrupted`            |                                   | the item is corrupted                                                   |

## Names and tiers

Modifiers are written as their text, in quotes, and shortened words are fine: `"max life"`
finds "+# to maximum Life". A name that matches several modifiers equally well is an error
that lists them.

`t1` names a tier, `t1` the best. Tiers are counted among the rows that can roll on this base
at this item level, so `t1` on a ring and `t1` on body armour can be different rows.

## Steps

Each statement is one operation: its words, then its arguments.

```hinekora
chaos                                        # words alone
exalt hunter
ember grand                                  # a tier word
essence "greed" t1                           # a quoted name, some with a tier
bench "maximum life"
harvest reforge "life"                       # a harvest tag
harvest change "fire resistance" "cold resistance"
fossil "pristine" "dense"                    # one to four fossils
beast add prefix 84                          # a side and a beast level
```

The [operations reference](./operations/) has a page for each.

## Loops and branches

```hinekora
until has "maximum life" t1 {                # repeat until true
    chaos
}

if not has "maximum mana" {                  # branch on the item as it is now
    bench "maximum mana"
} else {
    stop                                     # end the craft on this path
}
```

After `until`, its condition is known to be true. Inside `if` the condition holds, inside
`else` it does not. `restart` goes back to the start of the loop it is in, and `stop` ends the
craft on this path. See [Loops: until, restart, stop](./language/until).

## Conditions

| Condition                                  | True when                                       |
| ------------------------------------------ | ----------------------------------------------- |
| `isNormal`, `isMagic`, `isRare`            | the item has that rarity                        |
| `has "maximum life"`                       | the modifier is on the item, at any tier        |
| `has "maximum life" t1`                    | at that tier                                    |
| `has "maximum life" >= 110`                | with its value at least 110                     |
| `has group "spell damage"`                 | some modifier of that group is on the item      |
| `fractured "maximum life"`                 | that modifier is fractured                      |
| `influenced`, `influenced hunter`          | the item has an influence, or that one          |
| `corrupted`                                | the item is corrupted                           |
| `exarch grand`, `eater`, `dominant exarch` | the eldritch implicits                          |
| `prefixCount <= 2`, `suffixCount == 3`     | counting modifiers; `==` `!=` `<` `<=` `>` `>=` |
| `not`, `and`, `or`, `( … )`                | combining them, `or` loosest                    |

A condition asks about the item as it is now; nothing looks back at earlier steps.

## Definitions

`def` names a condition or a group of steps, so a guide can say it once.

```hinekora
def anyEleRes(t) = has "fire res" t or has "cold res" t or has "lightning res" t

def guarantee(m, step) {
    until has m {
        step
    }
}

guarantee("maximum life", { scour alchemy })
until anyEleRes(t1) { chaos }
```

A parameter can be a tier, a number, a name, or steps; hinekora works out which from how it is
used.
