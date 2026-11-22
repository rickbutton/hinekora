# Command line

The examples write `hinekora` for `node packages/cli/dist/cli.js` after a build ([Getting started](./getting-started)).

```txt
hinekora check <file.craft>
hinekora fmt [--check] <file.craft>
hinekora chart <file.craft>
hinekora cost [--league <name>] <file.craft>
```

Each command takes one file. Only `cost` uses the network, for prices.

## Exit codes

| Code | Meaning                                                                                          |
| ---- | ------------------------------------------------------------------------------------------------ |
| 0    | `check`: the craft checks. `fmt`: the file is formatted. `chart`, `cost`: printed.               |
| 1    | `check`: the craft has errors. `fmt --check`: the file needs formatting. Any: it does not parse. |
| 2    | wrong arguments, a league poe.ninja lacks, or an unreadable file                                 |
| 3    | any: the tool could not judge the craft, a fault of its own to report                            |

A usage error prints the command forms to standard error.

## check

`check` prints the game data's source, then checks the craft.

For a craft that checks, it prints the finished item, the items reaching the end or a
[`done`](./language/until), as the game's item text ([Getting started](./getting-started#check-it)).
If every item ends at a `fail`, a `restart` outside any loop or a step that ends it,
`(the craft ends for every item before this point)` takes its place.

For a craft with errors, it prints each with its position and line, then a count.
Where only some items reaching a step break it, none past an earlier error, one that does
can follow:

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
    { Implicit Modifier — Damage, Physical, Attack }
    Adds 1 to 4 Physical Damage to Attacks
    --------
    { Prefix Modifier "Annealed" (Tier: 1) — Damage, Physical, Attack }
    Adds (6-9) to (13-15) Physical Damage to Attacks
    { Suffix Modifier "of the Gods" (Tier: 1) — Attribute }
    +(51-55) to Strength

✗ 1 error
```

`check` reports a syntax error alone.
[Errors](./errors) lists the kinds.

## fmt

`fmt` rewrites the file in the standard layout and prints `formatted <file>`, or nothing
when the file already has it. The layout indents by four spaces, aligns the item block's
values and keeps comments and single blank lines.

`fmt --check` changes nothing; it prints `<file> needs formatting` and exits 1 when `fmt`
would change the file.

A file that does not parse is left alone, with a message.

## chart

`chart` prints the craft as a [Mermaid](https://mermaid.js.org/) flowchart. A step is a box,
a loop a `repeat` group with its condition before the body, and a branch a decision.

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

`cost` prints the expected spend of each step and the craft
([Reading a cost report](./cost)).

On a craft with errors, its first line counts them and the figures take the steps as written.

`cost` fetches [poe.ninja](https://poe.ninja/)'s prices for the current challenge league,
or the one `--league` or `HINEKORA_LEAGUE` names, and keeps them an hour in
`$XDG_CACHE_HOME/hinekora` (else `~/.cache/hinekora`; `~/Library/Caches/hinekora` on macOS,
`%LOCALAPPDATA%\hinekora\Cache` on Windows). Offline, it uses the last prices kept and says
so. `HINEKORA_PRICES` names a prices file instead; `none` means no prices and no request.
