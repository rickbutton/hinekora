# Syntax overview

## Files

A craft is one `.craft` file. It opens with an item block, the starting item, followed by
statements. Braces delimit blocks; whitespace, newlines included, is insignificant, and
statements need no separators. A comment runs from `#` to the end of the line.

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

The item is implicit. Every statement acts on the current item, which is never named.

## The item block

The item block is the only declared state. The checker infers the state after each statement.

| Field                  | Example                           | Meaning                                                   |
| ---------------------- | --------------------------------- | --------------------------------------------------------- |
| `base`                 | `"Titan Greaves"`                 | the base item, by its display name                        |
| `ilvl`                 | `84`                              | the item level                                            |
| `rarity`               | `normal`, `magic`, `rare`         | the rarity                                                |
| `prefixes`, `suffixes` | `[ "maximum life" t2, "random" ]` | the affixes, each at a tier; `"random"` is an unnamed one |
| `fractured`, `bench`   | `fractured "maximum life" t1`     | marks on an affix in the lists                            |
| `influences`           | `hunter`, `shaper elder`          | the item's influences                                     |
| `exarch`, `eater`      | `grand`                           | the tier of an eldritch implicit                          |
| `enchant`              | `8 "lightning damage"`            | a cluster jewel's enchantments                            |
| `strands`              | `82`                              | memory strands                                            |
| `corrupted`            |                                   | a corrupted item                                          |

## Names and tiers

A quoted string names a modifier by its stat text. A query word matches a whole word of the text
or a prefix of at least three letters, so `"max life"` names "+# to maximum Life". A name that
matches two or more modifier types equally well is an error listing them.

`t<n>` names a tier, `t1` the best. The number is the one the game's advanced tooltip shows for
that base. The item level decides which tiers a currency can roll, not their numbers.

## Statements

A statement is an operation: its words, then its arguments.

```hinekora
chaos
exalt hunter
ember grand
essence "greed" t1
bench "maximum life"
harvest reforge "life"
harvest change "fire resistance" "cold resistance"
fossil "pristine" "dense"
beast add prefix 84
```

These lines show the statement forms; they are not one craft. The arguments are a tier word, quoted names (some with a tier), a harvest tag, one to four
fossils, or a side and a beast level. The [operations reference](./operations/) has a page for
each operation.

## Control

```hinekora
until has "maximum life" t1 {
    chaos
}

if suffixCount <= 2 and not has group "cold resistance" {
    bench "cold resistance"
} else {
    stop
}
```

`until` tests its condition before each pass, the first included, and runs the body while the
condition is false; after the loop the condition is true. Inside `if` the condition is true; inside `else` its
negation is. `restart` returns to the condition test of the innermost enclosing `until`; `stop`
ends the craft on the current path. See [Loops: until, restart, stop](./language/until).

## Conditions

| Condition                                  | True when                                         |
| ------------------------------------------ | ------------------------------------------------- |
| `isNormal`, `isMagic`, `isRare`            | the item has that rarity                          |
| `has "maximum life"`                       | the modifier is present, at any tier              |
| `has "maximum life" t1`                    | the modifier is present at that tier              |
| `has "maximum life" >= 110`                | its value, the first number of its text, is so    |
| `has group "spell damage"`                 | some modifier of that modifier's group is present |
| `fractured "maximum life"`                 | the item has that modifier, fractured             |
| `influenced`, `influenced hunter`          | the item has an influence, or that one            |
| `corrupted`                                | a corrupted item                                  |
| `exarch grand`, `eater`, `dominant exarch` | the eldritch implicits                            |
| `prefixCount <= 2`, `suffixCount == 3`     | affix counts; `==` `!=` `<` `<=` `>` `>=`         |
| `not`, `and`, `or`, `( … )`                | combinations; `or` binds loosest                  |

A condition reads the current state only; there are no history predicates.

## Definitions

`def name(params) = <condition>` declares a predicate; `def name(params) { <statements> }` an
operation function. Both are local to the file and inlined at each use.

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

A parameter takes its kind from its use: a tier, a number, a name, or, in statement
position, steps. A steps argument is one statement or a `{ … }` block.
