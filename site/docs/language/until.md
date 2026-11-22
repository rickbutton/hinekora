# Loops: until, restart, fail, done

## until

<!-- fragment -->

```hinekora
until <condition> {
    <statements>
}
```

The loop tests its [condition](./conditions) before each pass and runs
the body while it stays false. After the loop the checker knows the condition is true.

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
start of a pass, after any number of earlier passes. It rejects this loop: after some exalts
the item may be full without the life.

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

`restart` returns to the condition test of the innermost enclosing `until`, skipping the
rest of that pass. The statements after an `if` that ends in `restart` see only the items
that skipped the `if`.

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
craft for that item, as `fail` does.

## fail and done

`fail` gives up on the item. `done` ends the craft for it as finished. The checker follows
the statements after either only on the items that continue.

```hinekora
item {
    base:   "Titan Greaves"
    ilvl:   84
    rarity: rare
}

chaos
if not has "maximum life" t1 {
    fail
}
until has "maximum life" >= 125 {
    divine
}
```

The checker runs the `divine` loop against items with tier 1 Life.

The finished item holds the items a `done` ended and those reaching the end of the craft, an
implicit `done`. A step after `fail`, `done` or `restart` in its block never runs, and the
checker rejects it.

## Related

- [Branches: if and else](./if) for the narrowing inside an arm.
- [Reading a cost report](../cost) for each loop's odds and expected spend.
