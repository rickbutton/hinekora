# Command line

The command-line tool is `packages/cli/dist/cli.js` after a build
([Getting started](./getting-started)). The examples below write it as `hinekora`, which
stands for `node packages/cli/dist/cli.js`.

```txt
hinekora check <file.craft>
hinekora fmt [--check] <file.craft>
hinekora chart <file.craft>
hinekora cost <file.craft>
```

Each command takes one file and reads the game data and the prices that ship with the tool,
with no network request.

## Exit codes

| Code | Meaning                                                                                          |
| ---- | ------------------------------------------------------------------------------------------------ |
| 0    | `check`: the craft checks. `fmt`: the file has the standard layout. `chart`, `cost`: printed.    |
| 1    | `check`: the craft has errors. `fmt --check`: the file needs formatting. Any: it does not parse. |
| 2    | wrong arguments, or the file cannot be read                                                      |
| 3    | any: the tool could not judge the craft, a fault of its own to report                            |

On a usage error the tool prints the four command forms to standard error.

## check

`check` parses the craft and runs the checker. It prints the game data's source first.

For a craft that checks, it prints the final item in the layout of the game's item text, as
[Getting started](./getting-started#check-it) shows.

If the craft ends for every item, at a [`stop`](./language/until), a `restart` outside any
loop or a step that ends it, the line
`(the craft ends for every item before this point)` takes the item's place.

For a craft with errors, it prints each one with its position and source line, then a count.
Where only some of the items reaching a step break it, and none got there past an earlier
error, one that does can follow:

```txt
bad.craft:8:1: error: at this point the item is: Iron Ring · Magic · 1–2 affixes · 0–1 prefixes · 0–1 suffixes · ilvl 84
  Requires an open affix slot — the item may be full.
  8 | augment
    | ^
  For example, this item:
    Item Class: Rings
    Rarity: Magic
    Iron Ring
    --------
    Item Level: 84
    --------
    { Prefix Modifier "Annealed" (Tier: 1) — Physical Damage, Damage, Physical, Attack }
    Adds (6-9) to (13-15) Physical Damage to Attacks
    { Suffix Modifier "of the Gods" (Tier: 1) — Attribute }
    +(51-55) to Strength

✗ 1 error
```

A syntax error stops the parser, so `check` then reports that one error alone.
[Errors](./errors) lists the kinds.

## fmt

`fmt` rewrites the file in the standard layout and prints `formatted <file>`. It prints
nothing when the file already has that layout. The layout indents by four spaces, aligns the
values of the item block and keeps comments and single blank lines.

`fmt --check` changes nothing. It prints `<file> needs formatting` and exits with 1 when
`fmt` would change the file.

A file that does not parse is left alone, with a message on standard error.

## chart

`chart` prints the craft as a [Mermaid](https://mermaid.js.org/) flowchart. A step is a box,
a loop is a `repeat` group with its condition drawn before the body, and a branch is a
decision.

```txt
flowchart TD
    start(["`start with the item`"]):::start
    subgraph n1 [repeat]
    direction TB
    n2{{"`item has +#35;% to Fire Resistance (T1)?`"}}
    n3["`essence #quot;greed#quot; t1`"]:::essence
    end
    finish(["`done`"]):::finish
    n3 --> n2
    n2 -- "`no`" --> n3
    start --> n2
    n2 -- "`yes`" --> finish
```

`chart` does not need the craft to check.

## cost

`cost` prints the expected spend of each step and of the whole craft.
[Reading a cost report](./cost) explains the output.

`cost` also reports on a craft with errors: its first line counts them, and the figures take
the steps as written.
