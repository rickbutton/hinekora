# The hinekora language

The language a player writes a craft in. Where a construct rests on a game
rule, the rule is linked to its wiki section rather than restated; what is not built yet is
in [ROADMAP.md](ROADMAP.md).

---

## 0. Principles

- **The item is implicit.** A craft is an imperative script; each statement acts on the
  current item, which is never named.
- **State is inferred, never declared**, except the starting item (§1), which is physical
  ground truth.
- **Errors show the item, they don't lecture** (§6).
- **Few primitives.** Every construct is an operation, a loop, a branch or a definition.

### Concrete syntax

- A file opens with its item block; there is no header. The data and every rule are Path
  of Exile 1's.
- Blocks are C-style `{ … }`; whitespace, newlines included, is insignificant, and
  statements need no separators.
- Text values are quoted: base, mod, essence, bench and fossil names, harvest tags.
- Comments run from `#` to the end of the line.
- Keywords and the camelCase predicate words are lowercase; `rarity` values are
  case-insensitive.

---

## 1. The item block

```
item {
    base:     "Iron Ring"
    ilvl:     84
    rarity:   rare
    prefixes: [ "maximum life" t2 ]
    suffixes: [ "fire resistance" t3, fractured "lightning resistance" t3, "random" ]
}
```

- `base` resolves by display name; where several bases share it, the id
  (`Metadata/Items/...`) picks one. It is an item a craft is modelled on: a weapon, a
  piece of armour or jewellery, a quiver, a jewel (abyss and cluster jewels too), a flask,
  a tincture, a charm, a relic, an idol, a Thief's Trinket or a piece of Rogue's
  equipment. Currency, gems, maps and the rest are refused.
- `ilvl` is the [item level](https://www.poewiki.net/wiki/Item_level); it never changes.
- `rarity` is `normal`, `magic` or `rare`. A base that can never be Rare (flasks, tinctures)
  is rejected at `rare` ([Rarity § Rare](https://www.poewiki.net/wiki/Rarity#Rare)).
- `prefixes` / `suffixes` list the affixes. Each named affix **pins a tier**: a mod name
  with `t<n>` (§2) or an exact mod id; a bare name only where the item's level rolls a
  single tier. `"random"` (or `"?"`) is an anonymous affix:
  counted, not named, and any natural modifier of its side the item could roll, so a `has`
  may be it and a bench craft of its group may clash with it. More affixes than the base
  allows at the rarity, or a mod on the wrong side, is an error.
- `fractured "<mod>" t<n>` marks a
  [fractured modifier](https://www.poewiki.net/wiki/Fractured_item#Mechanics);
  `fractured "random"` says the item is fractured without naming the modifier. An item may
  declare more than one.
- `bench "<mod>" [t<n>]` marks a crafted modifier, named as the `bench` step names it;
  `bench "random"` is some bench modifier of its side. It counts toward the crafted-modifier
  limit, so a bought item's craft is declared rather than mistaken for a natural modifier.
  The marks combine: `fractured bench "maximum life"`.
- `strands: 82` is the item's
  [memory strands](https://www.poewiki.net/wiki/Memory_strand#Mechanics), 0 to 100, none
  when absent; the crafts that use them up are
  [those the wiki lists](https://www.poewiki.net/wiki/Memory_strand#Crafting_methods_consuming_memory_strands)
  (`QUESTIONS.md` Q68). The checker follows the strands each item has left.
- `influences: hunter` (or two, `influences: shaper elder`) marks an
  [influenced item](https://www.poewiki.net/wiki/Influenced_item#Mechanics); the six are
  `shaper`, `elder`, `crusader`, `hunter`, `redeemer` and `warlord`; its influence
  modifiers roll and are named like any other. An influence with a fracture is an error,
  and so is one on a class no influence marks (a jewel, a flask). The
  [Astrolabe Amulet](https://www.poewiki.net/wiki/Astrolabe_Amulet) counts as having every
  influence, so its block lists none.
- `exarch: grand` and `eater: lesser` give the tiers of the item's
  [eldritch implicits](https://www.poewiki.net/wiki/Eldritch_implicit_modifier): `lesser`,
  `greater`, `grand`, `exceptional`, `exquisite`, `perfect`. A wording after the tier names
  which implicit it is (`exarch: grand "increased movement speed"`), matched as a mod name is
  (§2). An influenced item cannot carry one, nor an item below item level 75, nor any
  class but body armours, boots, gloves, helmets and amulets; an amulet has one of the
  two, `exceptional` at most.
- `enchant: <passives> "<stat>"` is a
  [cluster jewel](https://www.poewiki.net/wiki/Cluster_jewel#Mechanics)'s two enchantments:
  how many passives it adds and the stat its small passives grant, which decides the
  notables it can roll (`enchant: 8 "lightning damage"` makes `has "sadist"` possible). A
  cluster jewel without it, or with another size's, is an error.
- `corrupted` marks a
  [corrupted item](https://www.poewiki.net/wiki/Corrupted#Modifying_corrupted_items), which
  takes no craft but the Tainted currency and an `unveil`
  ([Veiled modifier § Version history](https://www.poewiki.net/wiki/Veiled_modifier#Version_history)).
  After a step that may corrupt the item (`vaal`,
  `locus`), the craft continues under every outcome at once (§5); one that destroys the
  item ends the craft for it.

An unknown or ambiguous name is reported on the item block before any step is checked.

---

## 2. Names

**Currencies** are written by their short name (`chaos`, `alteration`), as completion offers
them.

**Mods** are written as a stat description and name a modifier type, every tier of it. A
query word matches an entry word exactly or as a prefix of at least three letters, so
`"max life"` finds "maximum Life". Only types that roll on the base at its item level are
candidates, then those its level stops short of, then those an unveil or the bench puts on
its class, as a metamod is (`has "suffixes cannot be changed"`). Players' spellings are read as
the game's first (`"max es"`, `"+1 gems"`); the table is `packages/data/src/aliases.ts`. An
exact mod id (`IncreasedLife5`) always resolves. Where modifiers of one type share a tier
(an Elder amulet's Skeletons and Raised Zombies), a name means the one it words. Matches
rank by the share of a type's wording the query covers; a tie at the top is an error:

```
Ambiguous name "res" — candidates: +(6-11)% to Fire Resistance, +(6-11)% to Cold Resistance, +(6-11)% to Lightning Resistance, +(5-10)% to Chaos Resistance.
```

**Tiers.** `t<n>` is the tier the game's advanced tooltip shows, `t1` the modifier's Tier 1
on that base: its rows that roll on the base, counted best first by
[mod level](https://www.poewiki.net/wiki/Modifier#Mod_Level), whatever the item's level. An
influence's rows are counted apart from the base's and another influence's, so a number may
name a row of each (`QUESTIONS.md` Q101). The item's level decides which tiers a currency
can roll, not their numbers. The item block takes a tier above it, as an essence or a
Harvest change leaves one; in a condition no currency meets it.

---

## 3. Operations

Each statement applies one operation to the current item: a currency, an essence, a bench,
Harvest, Bestiary or Eldritch craft, a fossil resonator, an unveil. Completion lists them
all, and hovering a step shows what it does and what the item needs for it. Every item
the craft can have there must meet them; a failure is reported as in §6, and checking goes
on from the items the step fits, else as the craft meant it, so one wrong step is reported
once.

So a slot is open only if it is open on every item the craft can have there, and a
modifier is removable only if every such item has one not locked (fractured, or shielded
by a [metamod](https://www.poewiki.net/wiki/Metamod)). Items with a metamod and items
without are each judged under their own rules. `fracture` locks a random modifier: the
items after it hold every choice until a `fractured "<mod>"` branch (§5) narrows them.

A statement opens with its words and takes its arguments after them:

- Words alone: `chaos`, `exalt hunter`, `eldritch annul`, `foulborn regal`, `bench remove`.
- A tier word: `ember grand`, `ichor lesser`.
- A quoted name, some with an optional `t<n>`: `essence "greed" t1` (T1 = Deafening) or
  `essence "Deafening Essence of Greed"`; `bench "maximum life"`; `beast aspect "cat"` (`20` after it for the level-20 skill);
  `unveil "<mod>"`.
- A harvest tag: `harvest reforge "<tag>"` and `harvest augment "<tag>"`, the
  [Harvest crafts](https://www.poewiki.net/wiki/Harvest_crafting#Modifier_groups) that
  target a modifier group. The tags are `attack`, `attribute`, `caster`, `chaos`, `cold`,
  `critical`, `defence` (or `defences`), `drop`, `elemental`, `fire`, `life`, `lightning`, `mana`,
  `minion`, `physical` and `speed`; `harvest reforge` also takes `"influence"`, and
  the grove has no augment for `attribute`, `drop`, `elemental`, `mana` or `minion`.
- Two mod names: `harvest change "fire resistance" "cold resistance"`.
- One to four fossils: `fossil "pristine" "dense"`.
- A side with an optional beast level, or an influence: `beast add prefix 84`,
  `beast add hunter`; a side without a level reads a beast of any level.

A step with several possible outcomes (`unveil`, `beast metamod`, `conflict`) leaves the
item as any of them; a following `if` (§4.2) narrows it.

A statement may also be a **call**, `name(arg, …)`, to an operation function (§4.4), or,
inside one, a bare parameter standing for the steps bound to it.

---

## 4. Control

### 4.1 `until <pred> { … }`

Run the body until the predicate holds; later lines may rely on it. The body must be safe on
every round, not just the first (`until has "X" { exalt }` is reported: some item fills before
it has X). A loop that can never exit, or never runs, is reported:

```
this loop can never exit: has "fire resistance" can never become true here
this loop's body never runs: prefixCount <= 3 already holds here
```

### 4.2 `if <pred> { … } [else { … }]`

Branch on what is now true of the item. Inside `if` the predicate holds; inside `else`, its
negation. A branch that can never run is reported. After the branch the items of both arms
go on together, so a fact true after each, such as "one of these three is present", holds.

### 4.3 `restart` and `stop`

`restart` re-enters the innermost enclosing `until` from its start (at top level it ends the
craft); typically after a removal that may have taken a wanted modifier.

`stop` ends the craft for the item: it is kept, or is not worth more currency. What
follows is judged only on the items that continue, so "if the life was removed, start over
with a new base" is `if not has "maximum life" { stop }`, after which every item has it. A
craft that stops for every item has no finished item.

### 4.4 Definitions

`def name(params) = <pred>` declares a predicate; `def name(params) { <statements> }` an
operation function. Both are local to the file, may appear anywhere at file scope, and are
inlined at each use. A parameter's kind is inferred from its use: a tier, a count, a name (a
mod, bench or essence name, a harvest tag, an unveil target), or, in an operation function,
statement position, where it stands for **steps**. The kinds are distinct (`t1` is not the
number `1`).

A step parameter is bound at the call to one statement or a `{ … }` block, which runs where
the parameter is written, as if pasted there (a `restart` in it re-enters the `until`
enclosing that point). A parameter shadows a method word of the same name.

```
def anyEleRes(t) = has "fire res" t or has "cold res" t or has "lightning res" t

def guarantee(m, step) {
    until has m {
        step
    }
}

guarantee("maximum life", { scour alchemy })
guarantee("maximum life", chaos)
until anyEleRes(t1) { chaos }
```

---

## 5. Predicates

```
pred := isRare | isMagic | isNormal
      | has "<mod>" [t<n>] [<cmp> <int>]    # that modifier is present (at that tier; with its value so)
      | has group "<mod>"                   # some modifier of that modifier's group is present
      | fractured "<mod>"                   # that modifier is fractured
      | influenced [<influence>]            # the item has that influence (any, when none is named)
      | corrupted                           # the item is corrupted
      | exarch ["<wording>"] [<tier>]       # that eldritch implicit is present (that one, at that tier;
      | eater ["<wording>"] [<tier>]        #   the wording and the tier in either order)
      | dominant exarch | dominant eater    # that implicit's tier is the higher
      | prefixCount <cmp> <int>
      | suffixCount <cmp> <int>
      | not <pred>
      | <pred> and <pred>
      | <pred> or <pred>
      | ( <pred> )
      | <name>(<arg>, …)                    # a predicate def
cmp  := == | != | < | <= | > | >=
```

Precedence, loosest first: `or`, `and`, `not`, atom; binary operators are left-associative.
A predicate asks about the item's current state only; there are no history predicates.

- `has "X"` means any tier of X; `has "X" t1` the specific tier, which the checker tracks
  through every step.
- `has "X" >= 110` compares the modifier's **value**, the first number of its text. Values
  that miss it are ruled out, and a value holds until a reforge or a `divine` rolls it
  again: `until has "maximum life" >= 110 { divine }` is "divine the life into range". An
  experimented base's "increased modifier magnitudes" implicit is not applied.
- `has group "X"` asks for any modifier of X's
  [group](https://www.poewiki.net/wiki/Modifier#Group/family), read across every base:
  `if not has group "spell damage" { bench "spell damage" }` is a player's "unless you already
  have one of those".
- `influenced`, `corrupted` and `dominant` ask about the item's marks (§1); where the items
  differ in their marks, as after a `locus` or a `conflict`, a branch on them narrows to one.
  An Eldritch orb reads each item's own dominant side.

---

## 6. Errors

A rejected step reports the item's state, then the requirement, in the game's words:

```
at this point the item is: Iron Ring · Magic · 2 affixes · 1 prefix · 1 suffix · ilvl 84
Requires a Rare item — this item is Magic.
```

Hover, the CLI and the playground lay out the item as the game's copy-to-clipboard text,
with tier ranges, "one of these" groups and "possibly" marks. Where only some of the items
reaching a rejected step break it, and none came past an earlier error, the CLI and hover
add one that does.

- **Names**: an unknown or ambiguous base, mod, currency, essence, bench craft or harvest
  tag; a mod without a tier in the item block; a tier past the ladder.
- **Requirements**: some item the craft can have there does not fit the step (§3).
- **Control**: a loop that can never exit or whose body never runs; a branch or step that never
  runs; a def with conflicting, unused or repeated parameters, recursion, or a predicate
  called as a statement (or a function in a condition).
- **Stops**: a loop still changing after 256 rounds, an item that can turn out too many ways
  to follow, or a step the checker cannot handle (CLI exit code 3); later steps go
  unchecked.

---

## 7. Example

```
item {
    base:   "Titan Greaves"
    ilvl:   84
    rarity: normal
}

def anyEleRes(t) =
    has "fire resistance" t
    or has "cold resistance" t
    or has "lightning resistance" t

until anyEleRes(t1) {
    essence "greed" t1
}
```

The essence guarantees maximum Life; on exit every item has it and one of the three
resistances at T1. More in `examples/`.
