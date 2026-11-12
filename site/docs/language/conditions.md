# Conditions

A condition is a test of the current item. [`until`](./until) and [`if`](./if) take one, and a
[definition](./def) can name one. A condition reads the current item only. It cannot ask what an
earlier step did.

## Forms

| Condition                              | True when                                                  |
| -------------------------------------- | ---------------------------------------------------------- |
| `isNormal`, `isMagic`, `isRare`        | the item has that rarity                                   |
| `has "maximum life"`                   | the modifier is on the item, at any tier                   |
| `has "maximum life" t1`                | the modifier is on the item at that tier                   |
| `has "maximum life" >= 110`            | the modifier is on the item and its value compares so      |
| `has group "spell damage"`             | a modifier of that modifier's group is on the item         |
| `fractured "maximum life"`             | the modifier is on the item and fractured                  |
| `prefixCount <= 2`, `suffixCount == 3` | the number of prefixes or suffixes compares so             |
| `corrupted`                            | the item has the corrupted mark                            |
| `influenced`, `influenced hunter`      | the item has an influence, or that one                     |
| `exarch`, `eater grand`                | the item has that eldritch implicit, at that tier if given |
| `dominant exarch`, `dominant eater`    | that implicit has the higher tier                          |

The comparison operators are `==`, `!=`, `<`, `<=`, `>` and `>=`.

A value is the first number of the modifier's text. An eldritch test also takes a quoted
wording, which names one implicit. A [group](https://www.poewiki.net/wiki/Modifier#Group/family) is the
set of modifiers of which an item holds one. [Names and tiers](./names) covers the quoted
names.

## Combining

`not`, `and` and `or` combine conditions, and parentheses group them. `not` binds tightest,
then `and`, then `or`. `and` and `or` associate to the left.

```hinekora
item {
    base:     "Amethyst Ring"
    ilvl:     84
    rarity:   rare
    prefixes: [ "maximum life" t1 ]
    suffixes: [ "fire resistance" t1, "random" ]
}

until has "maximum life" >= 110 {
    divine
}
if not has group "cold resistance" {
    bench "cold resistance"
}
```

## What the checker knows

The checker's item stands for every item the earlier steps could have produced. For that
set a condition has one of three answers.

| Answer                | At an `if`                             | At an `until`                 |
| --------------------- | -------------------------------------- | ----------------------------- |
| true for every item   | an `else` arm, if written, is an error | an error: the body never runs |
| false for every item  | an error: the `if` arm never runs      | the loop runs                 |
| true for some of them | the checker follows both arms          | the loop runs                 |

Where a condition splits the set, the checker narrows it. Inside an `if` arm, and after an
`until`, the condition is true of the item. Inside `else` the condition is false. A step there must apply to every item left in the narrowed set.

The checker keeps what the outer condition established. Here the inner arm holds only
items with a fire resistance and no cold resistance, which is what
[`harvest change`](/docs/operations/harvest-change) needs:

```hinekora
item {
    base:   "Amethyst Ring"
    ilvl:   84
    rarity: normal
}

alchemy
if has "cold resistance" or has "fire resistance" {
    if not has "cold resistance" {
        harvest change "fire resistance" "cold resistance"
    }
}
```

A value comparison rules out every tier that cannot reach the value.

`influenced`, `corrupted` and the eldritch tests read the item's marks. They matter after a
step that marks only some of the items. A [`locus`](/docs/operations/locus) leaves some
items influenced, and `if influenced` separates them.
