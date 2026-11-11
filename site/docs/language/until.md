# Loops: until, restart, stop

## until

```hinekora
until <condition> {
    <statements>
}
```

The body runs, then the condition is tested; the loop repeats until it is true. After the loop
the condition is known to be true, and the statements that follow are checked against that
state.

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

### Every iteration

The body is checked against every state any number of earlier iterations can leave, not only the
first. Starting from a Rare item with no affixes, this loop is rejected: after some exalts the
item may be full while the life is still absent.

```hinekora
until has "maximum life" {
    exalt
}
```

```txt
at this point the item is: Titan Greaves · Rare · 0–6 affixes · 0–3 prefixes · 0–3 suffixes · ilvl 84
Requires an open affix slot — the item may be full.
```

### Loops the checker rejects

A loop whose condition can never become true, and a loop whose condition is already true on
entry, are errors:

```txt
this loop can never exit: has "fire resistance" can never become true here
this loop's body never runs: prefixCount <= 3 already holds here
```

## restart

`restart` re-enters the innermost enclosing `until` from its start. The rest of that iteration
does not run, so the statements after a `restart` behind an `if` are checked only on the paths
where the `if` was not taken.

```hinekora
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

The `exalt` runs only on items with a tier 1 life. At top level, `restart` ends the craft.

## stop

`stop` ends the craft on the current path. The statements after it are checked only on the
paths that continue.

```hinekora
chaos
if not has "maximum life" {
    stop
}
until has "maximum life" >= 90 {
    divine
}
```

The `divine` loop is checked against items that have maximum Life. A craft on which every path
stops has no final item.

## Related

- [Syntax overview](../syntax): conditions and the other control statements.
- The playground shows, under each loop's first line, the chance it exits and its expected
  cost.
