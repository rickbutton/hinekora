# Errors

The checker reports every error in one run. The
[command line](./cli) prints them, and the [editor](./editor) underlines them.

## Syntax

The parser stops at the first syntax error, so the checker does not run. An `else` takes a
block, which this line breaks:

```txt
chain.craft:7:27: error: expected '{' to open a block
  7 | if isMagic { regal } else if isRare { chaos }
    |                           ^
```

## The item block

The checker reports an item block that describes no item before it checks a step.
The causes: an unknown base, a modifier without a tier, more modifiers than the base
holds, and marks that cannot go together. See [The item block](./language/item).

<!-- refused -->

```hinekora
item {
    base:     "Iron Ring"
    ilvl:     84
    rarity:   magic
    prefixes: [ "maximum life" t2, "random" ]
}
```

```txt
too many prefixes for a magic Iron Ring: 2 (max 1)
```

## Names

The checker rejects a quoted name that matches nothing, a name that matches two things, and a tier the modifier does not have. See [Names and tiers](./language/names).

<!-- refused -->

```hinekora
item {
    base:   "Iron Ring"
    ilvl:   84
    rarity: rare
}

until has "ma life" {
    chaos
}
```

```txt
Unknown mod "ma life".
```

A bare word that is no operation reads `Unknown currency "chaoss".`

## A step that may not apply

Each [operation](./operations/) has preconditions, which the editor's hover lists. The checker
reports a step whose precondition fails for some item that can reach it. The message gives
the item at that point, then what the step needed.

<!-- refused -->

```hinekora
item {
    base:   "Iron Ring"
    ilvl:   84
    rarity: normal
}

alchemy
if has "maximum life" {
    regal
}
```

```txt
at this point the item is: Iron Ring · Rare · 4–6 affixes · 1–3 prefixes · 1–3 suffixes · ilvl 84
Requires a Magic item — this item is Rare.
```

The item line gives the base, the rarities the item may have, the ranges of its modifier
counts and its item level. The wording of the second line says how sure the checker is.
"This item is Rare" means every path. "The item may be full" means some path.

| Message                                                        | The step needed                    |
| -------------------------------------------------------------- | ---------------------------------- |
| `Requires a Rare item — this item may be Normal or Rare.`      | one rarity on every path           |
| `Requires an open affix slot — the item may be full.`          | room for one more modifier         |
| `Requires an open prefix slot — none is guaranteed open here.` | room on one side                   |
| `Requires a removable affix — the item may have none.`         | a modifier that a removal can take |
| `The item may already carry a "cold resistance" modifier …`    | no modifier of the new one's group |

## Loops and branches

| Message                                                            | See                       |
| ------------------------------------------------------------------ | ------------------------- |
| `this loop's body never runs: <condition> already holds here`      | [Loops](./language/until) |
| `this loop can never exit: <condition> can never become true here` | [Loops](./language/until) |
| `the 'if' branch can never run: <condition> is impossible here`    | [Branches](./language/if) |
| `the 'else' branch can never run: <condition> always holds here`   | [Branches](./language/if) |
| `this step can never run: the craft always stops before it`        | [Loops](./language/until) |
| `The item this loop works on is still changing after 256 rounds`   | [Loops](./language/until) |
| `Too many different items reach this step`                         | [Branches](./language/if) |

## Definitions

The checker rejects a definition whose parameters it cannot give one kind, a call with the
wrong arguments, and a recursive definition. [Definitions](./language/def) lists the messages.
