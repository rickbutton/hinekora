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
holds, marks that cannot go together, and fields that together fit no item
(`No item can have everything this item block declares on this base.`). See
[The item block](./language/item).

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

The first line gives the item's base, rarities, modifier counts and item level. The second
says how sure the checker is: "this item is Rare" means every path, "the item may be full"
some path.

Other steps need one rarity on every path, an open slot, room on one side, a modifier to
remove, or none of the new modifier's group:

- `Requires a Rare item — this item may be Normal or Rare.`
- `Requires an open affix slot — the item may be full.`
- `Requires an open prefix slot — none is guaranteed open here.`
- `Requires a removable affix — the item may have none.`
- `The item may already carry a "cold resistance" modifier …`

## Loops and branches

See [Loops](./language/until) and [Branches](./language/if).

- `this loop's body never runs: <condition> already holds here`
- `this loop can never exit: <condition> can never become true here`
- `the 'if' branch can never run: <condition> is impossible here`
- `the 'else' branch can never run: <condition> always holds here`
- `this step can never run: the craft always stops before it`

## Where the checker stops

The steps after one of these go unchecked:

- `The item this loop works on is still changing after 256 rounds …`: the loop does not settle.
- `The item can turn out too many different ways here to follow each …`: the items outgrow the
  checker's limit.
- `This step could not be checked …`: a fault in the checker, to report.

## Definitions

The checker rejects a definition whose parameters it cannot give one kind, a call with the
wrong arguments, and a recursive definition. [Definitions](./language/def) lists the messages.
