# Reading a cost report

`hinekora cost <file>` estimates what a craft spends. [How it works](/how-it-works#cost) describes the method.

```hinekora
item {
    base:   "Titan Greaves"
    ilvl:   84
    rarity: normal
}

until has "fire resistance" t1 {
    essence "greed" t1
}
if prefixCount <= 2 and not has group "movement speed" {
    bench "movement speed"
}
```

```txt
    7  until has "fire resistance" t1 {                          1/26 chance
    8  essence "greed" t1                                        ×25.5: 25.5 Deafening Essence of Greed  (72.4 chaos)
   10  if prefixCount <= 2 and not has group "movement speed" {  taken 62%
   11  bench "movement speed"                                    ×0.62: 2.49 Chaos Orb  (2.49 chaos)

Expected spend: 25.5 Deafening Essence of Greed, 2.49 Chaos Orb.
~74.9 Chaos Orbs (~0.16 Divine Orbs) at Allflame prices of 2026-11-09.
```

## Lines

Each line is a statement: its line number, its first source line and its figures.

| Statement | Figure                    | Meaning                                                   |
| --------- | ------------------------- | --------------------------------------------------------- |
| `until`   | `1/26 chance`             | the chance that one pass ends the loop                    |
| `if`      | `taken 62%`               | the share of crafts that enter the arm                    |
| a step    | `×25.5: 25.5 Deafening …` | the expected number of runs, then what those runs consume |

A chance of one half or more is a percentage. A step that consumes nothing reads `free`.
The figure in parentheses is the step's spend in Chaos Orbs.

A bench craft costs its bench price, a Harvest craft its lifeforce, and a Bestiary craft its
beast.

## Totals

`Expected spend` sums the steps by currency. The next line converts the sum to Chaos Orbs and
Divine Orbs and names the league and date of the prices. It names a currency that has no
price in place of the converted total.

If some paths end in a [`stop`](./language/until), a last line gives their share, such as
`The craft ends short of a finished item 18% of the time.`

## Spreads

A chance can depend on something that differs between the items reaching a step, such as the
[memory strands](https://www.poewiki.net/wiki/Memory_strand#Mechanics) left after each Chaos
Orb. The report then gives the estimate and, in brackets, the two ends.

```hinekora
item {
    base:    "Iron Ring"
    ilvl:    84
    strands: 60
    rarity:  rare
}

until has "maximum life" t1 {
    chaos
}
```

```txt
    8  until has "maximum life" t1 {  1/30 chance [1/30.2 to 1/11.4]
    9  chaos                          ×30.2 [11.4 to 30.2]: 30.2 Chaos Orb  (30.2 chaos)

Expected spend: 30.2 Chaos Orb.
~30.2 Chaos Orbs (~0.06 Divine Orbs), 11.4 to 30.2 by what the item may hold, at Allflame prices of 2026-11-09.
```

## Not known

A craft that checks can hold a loop that some items never leave. A
[`divine`](/docs/operations/divine) rolls a modifier's value again and cannot change its
tier. The checker accepts this craft, because the unnamed prefix may be a tier 1 life.

```hinekora
item {
    base:     "Iron Ring"
    ilvl:     84
    rarity:   rare
    prefixes: [ "random" ]
}

until has "maximum life" t1 {
    divine
}
```

```txt
    8  until has "maximum life" t1 {  rounds not known
                                      (98% of the time the item never reaches the exit, so the loop cannot end as written and its rounds and the craft's total are not known)
    9  divine                         uses not known

Expected spend: not known, for a loop above has no figure.
```

A note in parentheses under a line says why a figure is missing.

## Prices

Prices come from a snapshot of [poe.ninja](https://poe.ninja/) for one league on one day. The
snapshot ships with the game data, so the same craft always gives the same figure.
