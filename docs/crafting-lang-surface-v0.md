# The Crafting Language

The language a person writes to describe a craft, as the parser and checker implement it
today. A craft reads like a written guide: no type annotations, no type-theory vocabulary;
the checker infers the item's state after every line and only ever shows it as a plain
rendering. Anything not built yet is in [ROADMAP.md](ROADMAP.md), not here.

Where a construct rests on a game rule, the rule is linked to its section of the Path of
Exile wiki (poewiki.net) rather than restated; the text here says only how the construct
relates to it.

---

## 0. Principles

- **The item is implicit and threaded automatically.** A craft is an imperative script;
  each statement acts on the ambient current item. The item is never named.
- **State is inferred, never declared**, except the starting item (§1), which is physical
  ground truth.
- **Errors show the item's state, they don't lecture.** A rejected operation renders what
  the item provably is at that point, then what the operation needed (§6).
- **Few primitives, additive sugar.** Every construct is a currency operation, a loop, a
  branch, or a definition; a future convenience will lower to one of these.

## 0.1 Concrete syntax

- **`craft in poe1` comes first.** The data, the currencies and every rule below are
  Path of Exile 1's; the header names the game the file is written for and no other
  word is accepted.
- **Blocks are C-style `{ … }`.** Whitespace, including newlines, is insignificant.
- **Text values are quoted**: `base: "Cobalt Jewel"`, mod names, essence and bench names,
  harvest tags.
- **Comments** run from `#` to the end of the line.
- **Statements are self-delimiting**; no separators.
- **Case:** keywords and the camelCase predicate symbols are lowercase; `rarity` values and
  game names are case-insensitive.

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

- `base` resolves by display name against the catalog; a name shared by several bases is
  rejected as ambiguous (the id, `Metadata/Items/...`, is the escape hatch).
- `ilvl` is the [item level](https://www.poewiki.net/wiki/Item_level); it never changes.
- `rarity` is `normal`, `magic` or `rare`. A base that can never be Rare (flasks,
  tinctures) is rejected at `rare`, per [Rarity § Rare](https://www.poewiki.net/wiki/Rarity#Rare).
- `prefixes` / `suffixes` list the affixes. Each named affix **must pin a tier**: either a
  mod name plus `t<n>` (§2) or an exact mod id. A bare name is an error, because a
  starting item is a concrete item. `"random"` (or `"?"`) is an anonymous affix: counted,
  not named. A count over the base's limit for the rarity is an error; a named mod listed
  under the wrong side is an error.
- `fractured "<mod>" t<n>` (or `fractured "random"`, when the locked modifier is not
  named: the item is known to be fractured, the modifier is not) marks a
  [fractured modifier](https://www.poewiki.net/wiki/Fractured_item#Mechanics). Hinekora
  models at most one per item, the
  [Fracturing Orb](https://www.poewiki.net/wiki/Fracturing_Orb#Mechanics)'s own limit; the
  wiki's multi-fracture items are out of scope.
- `augments: [ … ]` and `quality: <n>` are accepted by the parser and ignored by the
  checker; they are reserved and have no effect.

Name resolution happens here, so an unknown or ambiguous name is reported on the item
block before any operation is checked.

---

## 2. Names

**Currencies** are written by their short name: `transmute`, `augment`, `alteration`,
`regal`, `alchemy`, `chaos`, `exalt`, `annul`, `scour`, `fracture` (§3). There are no
other aliases.

**Mods** are written as a stat description, matched to a modifier _type_ (every tier of a
modifier shares the wording and differs only in numbers). Matching is by word: a query
word matches an entry word exactly or as a prefix of at least three letters, so
`"max life"` finds "maximum Life" and `"fire res"` finds "Fire Resistance". The candidates
are narrowed to the types that can roll on the craft's base at its item level, which is
what keeps `"fire res"` from also meaning the fire-and-chaos hybrid on a base that cannot
roll it. An exact mod id (`IncreasedLife5`) always resolves. A query that matches several
types is an error listing them:

```
Ambiguous name "res" — candidates: fire resistance, cold resistance, lightning resistance.
```

**Tiers.** `t<n>` names a tier, T1 the best. The game stores no tier numbers, only each
row's [mod level](https://www.poewiki.net/wiki/Modifier#Mod_Level); Hinekora numbers the
rows of a type that can roll on this base at this item level, best first. So `t1` on a
ring is a different row from `t1` on body armour, and from the in-game display, which
numbers tiers across all bases. A tier that cannot roll here is an error.

---

## 3. Operations

Each statement applies one operation to the current item. The checker proves the
operation's precondition from the state it has inferred; a failure is reported as in §6
and the operation is skipped so checking continues.

The ten **currencies**, grouped as the wiki's [Crafting](https://www.poewiki.net/wiki/Crafting)
page groups them:

| Written      | Currency                                                                               | Needs                                                           |
| ------------ | -------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `transmute`  | [Orb of Transmutation](https://www.poewiki.net/wiki/Orb_of_Transmutation)              | Normal                                                          |
| `alchemy`    | [Orb of Alchemy](https://www.poewiki.net/wiki/Orb_of_Alchemy)                          | Normal, a base that can be Rare                                 |
| `regal`      | [Regal Orb](https://www.poewiki.net/wiki/Regal_Orb)                                    | Magic, a base that can be Rare                                  |
| `alteration` | [Orb of Alteration](https://www.poewiki.net/wiki/Orb_of_Alteration)                    | Magic                                                           |
| `chaos`      | [Chaos Orb](https://www.poewiki.net/wiki/Chaos_Orb)                                    | Rare                                                            |
| `augment`    | [Orb of Augmentation](https://www.poewiki.net/wiki/Orb_of_Augmentation)                | Magic with an open slot                                         |
| `exalt`      | [Exalted Orb](https://www.poewiki.net/wiki/Exalted_Orb)                                | Rare with an open slot                                          |
| `annul`      | [Orb of Annulment](https://www.poewiki.net/wiki/Orb_of_Annulment)                      | a removable modifier (Magic or Rare)                            |
| `scour` | [Orb of Scouring](https://www.poewiki.net/wiki/Orb_of_Scouring) | Magic or Rare, with a side a metamod does not protect |
| `fracture`   | [Fracturing Orb](https://www.poewiki.net/wiki/Fracturing_Orb#Mechanics)                | Rare, at least four modifiers, not already fractured            |

"Open slot" and "removable" are decided by the checker's knowledge of the item: a slot is
open only if it is open on every path, a modifier is removable only if one is present on
every path and not locked (fractured, or shielded by a
[metamod](https://www.poewiki.net/wiki/Metamod)). `fracture` locks a random modifier; no
specific one is proven locked until a `fractured "<mod>"` branch (§5) narrows it, and
until then every reforge keeps "one of the current modifiers survives, still locked".

Operations that take a name (and an optional `t<n>`):

- `essence "<name>" [t<n>]` applies an [essence](https://www.poewiki.net/wiki/Essence#Crafting):
  a full name (`"Deafening Essence of Greed"`) or a type with a tier (`essence "greed" t1`,
  T1 = Deafening). The tier table of that section decides what it accepts: a Normal item at
  any tier, a Rare item from Screaming up, never a Magic item; the base must be one that
  can be Rare; the essence must grant a modifier for the item's class; and no protection
  or cannot-roll metamod may be on the item.
- `bench "<mod>" [t<n>]` adds a [crafting bench](https://www.poewiki.net/wiki/Crafting_Bench)
  modifier, named by the modifier it adds (`bench "maximum life"`). It needs an open slot
  in the modifier's generation, the crafted-modifier limit not reached (one, or three under
  the multimod metamod), and no modifier of the same
  [group](https://www.poewiki.net/wiki/Modifier#Group/family) possibly present. The
  metamods are benched the same way: `bench "prefixes cannot be changed"`.
- `harvest reforge "<tag>"` and `harvest augment "<tag>"` are the two
  [Harvest crafts](https://www.poewiki.net/wiki/Harvest_crafting) that target a
  [modifier group](https://www.poewiki.net/wiki/Harvest_crafting#Modifier_groups): "Reforge
  with random modifiers, including a [Type] modifier" and "Add a new [Type] modifier and
  remove another random modifier". Tags: `attack`, `attribute`, `caster`, `chaos`, `cold`,
  `critical`, `defence` (or `defences`), `elemental`, `fire`, `life`, `lightning`, `mana`,
  `minion`, `physical`, `speed`. Both need a Rare item and a tag some modifier of the base can carry;
  `augment` also needs a removable modifier.
- `veiled chaos` and `veiled exalt` are the
  [Veiled Chaos Orb](https://www.poewiki.net/wiki/Veiled_Chaos_Orb) and
  [Veiled Exalted Orb](https://www.poewiki.net/wiki/Veiled_Exalted_Orb); both need a Rare
  item, `veiled exalt` also a removable modifier.
- `unveil ["<mod>"]` is the three-option unveil of a
  [veiled modifier](https://www.poewiki.net/wiki/Veiled_modifier) and needs a veiled
  modifier on the item. Bare, the result is one of the valid options
  (narrow it with a following `if has "<mod>"`). With a name, that outcome is guaranteed
  only when the option pool is three or fewer, which you reach by blocking: bench a
  modifier that shares a group with an option. Hovering the line shows the current
  options by side.

A statement may also be a **call**, `name(arg, …)`, to an operation function (§4.4).

---

## 4. Control

### 4.1 `until <pred> { … }`

Run the body until the predicate holds. On exit the predicate is proven, so later lines
may rely on it. The checker proves the body safe on every iteration, not just the first
(so `until has "X" { exalt }` is reported: the item fills before X is guaranteed), and
reports a loop whose exit can never be true on this base:

```
this loop can never exit: has "fire resistance" can never become true here
```

### 4.2 `if <pred> { … } [else { … }]`

Branch on what is now true of the item. Inside the `if` body the predicate is known to
hold; inside `else`, its negation. A branch whose condition is impossible here, or whose
negation always holds, is reported as never running. After the branch, what both arms
guarantee is kept, including disjunctions ("one of these three is present").

### 4.3 `restart`

Re-enter the innermost enclosing `until` from its start (at top level: end the craft).
Used in a failure branch, typically after a removal that may have taken a wanted modifier.

### 4.4 Definitions

`def name(params) = <pred>` declares a predicate; `def name(params) { <statements> }` an
operation function. Both are local to the file, may appear anywhere at file scope, and are
inlined at each use. A parameter's sort is inferred from its use: a tier slot, a count
slot, or a name slot (a mod name, a bench or essence name, a harvest tag, an unveil
target); the three sorts are distinct (`t1` is not the number `1`), and conflicting uses,
an unused parameter, recursion, or calling a predicate as a statement (or a function in a
condition) are errors.

```
def anyEleRes(t) = has "fire res" t or has "cold res" t or has "lightning res" t

def guarantee(m) {
    until has m {
        scour
        alchemy
    }
}

guarantee("maximum life")
until anyEleRes(t1) { chaos }
```

---

## 5. Predicates

```
pred := isRare | isMagic | isNormal
      | has "<mod>" [t<n>]                  # that modifier type is present (at that tier)
      | fractured "<mod>"                   # that modifier is the fractured one
      | prefixCount <cmp> <int>
      | suffixCount <cmp> <int>
      | not <pred>
      | <pred> and <pred>
      | <pred> or <pred>
      | ( <pred> )
      | <name>(<arg>, …)                    # a predicate def
cmp  := == | != | < | <= | > | >=
```

Precedence, loosest first: `or`, `and`, `not`, atom; binary operators are
left-associative. A predicate asks about the item's current state only; there are no
history predicates. `has "X"` means any tier of X; `has "X" t1` the specific tier, which the
checker tracks through operations (a modifier narrowed to T1 is provably not T2).

---

## 6. Errors

A rejected operation reports the item's state, then the requirement, in the game's
words:

```
at this point the item is: Iron Ring · Magic · 2 affixes · 1 prefix · 1 suffix · ilvl 84
Requires a Rare item — this item is Magic.
```

The state line leads with the base, the rarity, the total affix count (a range when the
checker is not certain), the split by side, and the item level. The same renderer powers
hover ("what is my item here"), where the state is shown as an item tooltip with the
guaranteed modifiers, their tiers or roll spans, and any "one of these" facts.

Error categories:

- **Resolution**: unknown or ambiguous base, mod, currency, essence, bench craft, harvest
  tag; a mod without a tier in the item block; a tier that cannot roll here.
- **Precondition**: the operation does not fit the item on some path (§3).
- **Control**: a loop that can never exit; a branch that can never run; a def with
  conflicting or unused parameters, recursion, or the wrong kind of call.

---

## 7. Example

```
craft in poe1

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

Deafening Essence of Greed reforges the item each time with maximum Life guaranteed; the
loop spins until the random fill includes a T1 elemental resistance. On exit the checker
knows maximum Life is present at its essence tier and one of the three resistances is
present at T1. More in `examples/`.
