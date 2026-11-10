# Loops: until, restart, stop

Most crafts repeat a step until it lands: spam an essence until a resistance rolls, reforge until
the life is tier 1. `until` writes that down, and `restart` and `stop` say what happens when a
round goes wrong.

## until

```hinekora
until <condition> {
    <steps>
}
```

The steps run, then the condition is asked; the loop goes round again until it is true. After
the loop, hinekora knows the condition holds, so the steps after it can rely on it.

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

When the loop ends, the boots have the essence's maximum Life and a tier 1 fire resistance, and
every step after the loop is checked against that item.

### Every round, not just the first

Each step in the loop has to work on every round, with the item as any earlier round could have
left it. This loop is reported, because after a few exalts the item can be full before the life
has rolled:

```hinekora
until has "maximum life" {
    exalt
}
```

```txt
at this point the item is: Titan Greaves · Rare · 0–6 affixes · 0–3 prefixes · 0–3 suffixes · ilvl 84
Requires an open affix slot — the item may be full.
```

The fix is to make room inside the loop, the way the guide on the [home page](/) annuls until a
prefix is free before it benches.

### Loops that cannot work

hinekora reports a loop that can never finish, and one whose steps never run:

```txt
this loop can never exit: has "fire resistance" can never become true here
this loop's body never runs: prefixCount <= 3 already holds here
```

## restart

`restart` goes back to the start of the loop it is in, as if the round had just begun. It is for
a round that has already gone wrong, so the rest of it is not worth paying for:

```hinekora
until has "maximum life" t1 and has "cold resistance" {
    chaos
    if not has "maximum life" t1 {
        restart                # no exalt on boots without the life
    }
    if suffixCount <= 2 {
        exalt
    }
}
```

After the `if`, the life is known to be tier 1, since every round without it went back to the
start.

Outside every loop, `restart` ends the craft.

## stop

`stop` ends the craft on this path: you keep the item as it is, or it is not worth more
currency. The steps after it are checked only on the paths that go on, so a `stop` behind an
`if` makes its condition's opposite true for everything after it.

```hinekora
chaos
if not has "maximum life" {
    stop                       # start over with a new base
}
until has "maximum life" >= 90 {
    divine                     # the life is known to be there
}
```

A craft whose every path stops has no finished item.

## See also

- [Syntax overview](../syntax) for conditions and the other control words.
- The playground shows each loop's chance of finishing and its expected spend, under the loop's
  first line.
