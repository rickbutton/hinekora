# Syntax overview

A craft is one `.craft` file. It opens with an item block, followed by statements and
definitions.

```hinekora
# Roll a ring, then finish it at the bench.
item {
    base:   "Iron Ring"
    ilvl:   84
    rarity: normal
}

def twoRes() = has "fire resistance" and has "cold resistance"

alchemy
until has "maximum life" t1 and twoRes() {
    chaos
}
if prefixCount <= 2 and not has group "maximum mana" {
    bench "maximum mana"
}
```

## Lexical rules

- Braces delimit blocks. Whitespace, newlines included, has no meaning, and statements need
  no separators.
- A comment runs from `#` to the end of the line.
- A name from the game's data is a quoted string. Keywords and operations are bare words.
- Keywords and condition words such as `prefixCount` are case-sensitive.

## The item

The item is implicit. Every statement acts on the current item, which the craft never names.
The [item block](./language/item) is the only declared state. The checker infers the item
after each statement.

## Statements

| Statement                         | Meaning                                       | Page                          |
| --------------------------------- | --------------------------------------------- | ----------------------------- |
| `chaos`, `bench "maximum mana"`   | an operation: its words, then its arguments   | [Operations](./operations/)   |
| `until <condition> { … }`         | repeat the block while the condition is false | [Loops](./language/until)     |
| `if <condition> { … } else { … }` | run one block or the other                    | [Branches](./language/if)     |
| `restart`                         | return to the test of the enclosing `until`   | [Loops](./language/until)     |
| `stop`                            | end the craft for this item                   | [Loops](./language/until)     |
| `name(args)`                      | run a definition's steps                      | [Definitions](./language/def) |

An operation is one or two words, such as `exalt` or `harvest reforge`. Its arguments follow
without punctuation.

| Argument           | Example                                              |
| ------------------ | ---------------------------------------------------- |
| a quoted name      | `bench "maximum life"`, `fossil "pristine" "dense"`  |
| a name and a tier  | `essence "greed" t1`                                 |
| a Harvest tag      | `harvest reforge "life"`                             |
| two modifier names | `harvest change "fire resistance" "cold resistance"` |
| a word             | `ember grand`, `beast add prefix`                    |
| a number           | `beast add prefix 84`                                |

Each operation's page gives its arguments.

## Conditions and names

A [condition](./language/conditions) tests the current item: `has "maximum life" t1`,
`prefixCount <= 2`, `isRare`. `not`, `and` and `or` combine conditions.

A quoted modifier name matches the words of the modifier's text, and `t<n>` picks a tier.
[Names and tiers](./language/names) gives the rules.

## Definitions

`def` names a condition or a sequence of steps. A [definition](./language/def) is local to
the file, and the checker inlines it at each call.
