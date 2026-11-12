# Loops: until, restart, stop

## until

<!-- fragment -->

```hinekora
until <condition> {
    <statements>
}
```

The loop tests its [condition](./conditions) before each pass. It runs
the body while the condition is false. After the loop the checker knows the condition is true
and checks the statements that follow against that item.

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

On exit the item has the essence's maximum Life and a tier 1 fire resistance.

### Every pass

The checker runs the body against every item for which the condition can be false at the
start of a pass, after any number of earlier passes. It rejects this loop. After some exalts
the item may be full while the life is still absent.

<!-- refused -->

```hinekora
item {
    base:   "Titan Greaves"
    ilvl:   84
    rarity: rare
}

until has "maximum life" {
    exalt
}
```

```txt
at this point the item is: Titan Greaves · Rare · 0–6 affixes · 0–3 prefixes · 0–3 suffixes · ilvl 84
Requires an open affix slot — the item may be full.
```

### Loops the checker rejects

The checker rejects a loop whose condition is already true for every item that reaches it.

<!-- refused -->

```hinekora
item {
    base:     "Titan Greaves"
    ilvl:     84
    rarity:   rare
    prefixes: [ "maximum life" t1 ]
}

until has "maximum life" t1 {
    chaos
}
```

```txt
this loop's body never runs: has "maximum life" t1 already holds here
```

It also rejects a loop whose condition no pass can make true. That message reads
`this loop can never exit: <condition> can never become true here`.

## restart

`restart` returns to the condition test of the innermost enclosing `until`. The rest of that
pass does not run. The checker follows the statements after an `if` that ends in `restart`
only for the items that skipped the `if`.

```hinekora
item {
    base:   "Titan Greaves"
    ilvl:   84
    rarity: rare
}

until has "maximum life" t1 and has "cold resistance" {
    chaos
    if not has "maximum life" t1 {
        restart
    }
    if suffixCount <= 2 {
        exalt
    }
}
```

Outside every `until`, `restart` ends the
craft for that item, as `stop` does.

## stop

`stop` ends the craft for the item. The checker follows the statements after it only
on the items that continue.

```hinekora
item {
    base:   "Titan Greaves"
    ilvl:   84
    rarity: rare
}

chaos
if not has "maximum life" t1 {
    stop
}
until has "maximum life" >= 125 {
    divine
}
```

The checker runs the `divine` loop against items with tier 1 Life. A craft that stops for every item has no final item.

A step written after a `stop` or `restart` in its block never runs, and the checker rejects
it.

## Related

- [Branches: if and else](./if) for the narrowing inside an arm.
- [Reading a cost report](../cost) for each loop's odds and expected spend.
