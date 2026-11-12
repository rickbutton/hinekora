# hinekora: The Operations Model

> Every crafting method is a short program over a few primitive operations on one item.
> §2 is the one statement of the primitives' semantics; §3 the ledger of the game's
> methods. The sequences are `check/library.ts`, each method's surface and description
> `check/methods.ts`; each primitive's rule as code is the reference interpreter's
> (`check/reference/ops/`). Game rules are linked, never restated.

---

## 1. Why a primitive set

A method changes an item in a few ways only: it strips modifiers, lays some down from a
pool, removes one, changes the rarity, fractures one, or changes a mark of the item (the
wiki's [Crafting](https://www.poewiki.net/wiki/Crafting) page sorts every currency into
those bins). So a method is an `Op` sequence, not a function of its own: the count
arithmetic, the pool and the presence bookkeeping are written once, in the primitive,
and cannot drift apart between methods that share them. The checker computes each
primitive's exact image over its set of items without listing them
([ARCHITECTURE.md](ARCHITECTURE.md) §4).

---

## 2. The primitives

A **pool** (`PoolSpec`) is resolved against the catalog and the current state, never a
hand-written list; the metamods in force and the memory strands' tier cut apply to it. A
**count** (`FillCount`) is a number added, a reforge's total, or one already counted. A
**selector** (`Selector`) names the present modifiers a removal may reach.

| Op          | What it does to an item                                                                                                                                                                                                                                                |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `require`   | The item must pass the check, or the method is refused on it.                                                                                                                                                                                                          |
| `strip`     | Every modifier goes but a fractured one and those on a protected side.                                                                                                                                                                                                 |
| `unprotect` | The metamods no longer govern the rest of the method.                                                                                                                                                                                                                  |
| `keep`      | That side alone is protected for the rest of the method, in place of the item's own protections.                                                                                                                                                                       |
| `fill`      | Rows are drawn one at a time from the pool as the item then stands, each at any value of its span, until the count is laid; an item the least count cannot be laid on has no outcome. With a side kept a reforge may also stop once one is laid (`QUESTIONS.md` Q112). |
| `remove`    | One modifier the selector reaches goes (the bench's removal: every crafted one it can clear); with none in reach, no outcome. A side-limited removal on a protected side changes nothing.                                                                              |
| `rarity`    | Set the rarity. `survivors`: Normal, Magic or Rare by the modifiers left, never above what it was; `lowest` also admits Magic for one survivor a side (`QUESTIONS.md` Q33).                                                                                            |
| `lock`      | `n` of the unfractured modifiers become fractured, each choice an outcome.                                                                                                                                                                                             |
| `relax`     | Each modifier, on its own, stays or moves a tier along its ladder; a crafted one stays unless `crafted` ([Tainted Divine Teardrop](https://www.poewiki.net/wiki/Tainted_Divine_Teardrop)).                                                                             |
| `reroll`    | Every value rolls again within its tier, fractured modifiers and protected sides excepted ([Divine Orb](https://www.poewiki.net/wiki/Divine_Orb)).                                                                                                                     |
| `elevate`   | One influenced modifier on an unprotected side, not the one removed, goes up a tier or to its elevated row.                                                                                                                                                            |
| `strands`   | The memory strands fall by none up to the method's figure, read at the count it started on ([Memory strand § Mechanics](https://www.poewiki.net/wiki/Memory_strand#Mechanics), `QUESTIONS.md` Q68).                                                                    |
| `corrupt`   | The item is corrupted once more: an uncorrupted item corrupted, a corrupted one twice corrupted.                                                                                                                                                                       |
| `influence` | Set the influence mark, add an influence, or take any set of the same size.                                                                                                                                                                                            |
| `eldritch`  | Set an eldritch implicit's tier, raise one and lower the other, or let a corruption implicit replace one.                                                                                                                                                              |
| `imprint`   | The item as it stands is held.                                                                                                                                                                                                                                         |
| `restore`   | The item becomes the held one, which is consumed.                                                                                                                                                                                                                      |
| `either`    | Each branch is an outcome; a branch of `end` leaves no item; all ending, so does the craft.                                                                                                                                                                            |
| `end`       | The item is destroyed or unmodifiable; the craft ends here for it.                                                                                                                                                                                                     |

The protections in force are read once, when the method is applied, and govern every
operation in it ([Metamod § Rules and Exceptions](https://www.poewiki.net/wiki/Metamod#Rules_and_Exceptions));
only `unprotect` and `keep` change that. A cannot-roll metamod restricts a pool only
while it is still on the item when the `fill` draws: a reforge that strips it rolls
freely, as the table's Chaos Orb row has it. The checker splits its items by the metamods
they carry (`metamodCases`), runs each case under its own rules and unites the results.

**All or nothing.** The game never applies part of a currency, so an item that fails a
`require`, or that an operation cannot act on, refuses the whole method; the checker
reports the earliest such step. The craft goes on from the items the method works on
(recovery, [ARCHITECTURE.md](ARCHITECTURE.md) §4.4), so one wrong step does not refuse
every step after it.

Spawn weights are not carried; they are the cost layer's ([cost.md](cost.md)). Nor is the distribution of values: a value is a cell of its row's span, cut where the
craft's conditions compare it.

---

## 3. The library

Status: **built**, **deferred** (expressible, not built, for the reason given) or **out**
(not an operation on one item's explicit modifiers, or not worth modelling).

### 3.1 Built

| Method                                                                                                                                                                                                                                              | Surface                                                                                    |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| [Transmutation](https://www.poewiki.net/wiki/Orb_of_Transmutation), [Augmentation](https://www.poewiki.net/wiki/Orb_of_Augmentation), [Alteration](https://www.poewiki.net/wiki/Orb_of_Alteration), [Regal](https://www.poewiki.net/wiki/Regal_Orb) | `transmute`, `augment`, `alteration`, `regal`                                              |
| [Alchemy](https://www.poewiki.net/wiki/Orb_of_Alchemy), [Chaos](https://www.poewiki.net/wiki/Chaos_Orb), [Exalted](https://www.poewiki.net/wiki/Exalted_Orb), [Annulment](https://www.poewiki.net/wiki/Orb_of_Annulment#Mechanics)                  | `alchemy`, `chaos`, `exalt`, `annul`                                                       |
| [Divine](https://www.poewiki.net/wiki/Divine_Orb), [Scouring](https://www.poewiki.net/wiki/Orb_of_Scouring), [Fracturing](https://www.poewiki.net/wiki/Fracturing_Orb#Mechanics)                                                                    | `divine`, `scour`, `fracture`                                                              |
| Foulborn [Augmentation](https://www.poewiki.net/wiki/Foulborn_Orb_of_Augmentation), [Regal](https://www.poewiki.net/wiki/Foulborn_Regal_Orb), [Exalted](https://www.poewiki.net/wiki/Foulborn_Exalted_Orb)                                          | `foulborn augment`, `foulborn regal`, `foulborn exalt`                                     |
| [Veiled Chaos](https://www.poewiki.net/wiki/Veiled_Chaos_Orb), [Veiled Exalted](https://www.poewiki.net/wiki/Veiled_Exalted_Orb), [unveil](https://www.poewiki.net/wiki/Veiled_modifier#How_to_obtain)                                              | `veiled chaos`, `veiled exalt`, `unveil`                                                   |
| Shaper's, Elder's and Conqueror [Exalted Orbs](https://www.poewiki.net/wiki/Hunter%27s_Exalted_Orb#Mechanics)                                                                                                                                       | `exalt <influence>`                                                                        |
| [Orb of Dominance](https://www.poewiki.net/wiki/Orb_of_Dominance), [Orb of Conflict](https://www.poewiki.net/wiki/Orb_of_Conflict)                                                                                                                  | `dominance`, `conflict`                                                                    |
| Eldritch [Chaos](https://www.poewiki.net/wiki/Eldritch_Chaos_Orb), [Exalted](https://www.poewiki.net/wiki/Eldritch_Exalted_Orb), [Annulment](https://www.poewiki.net/wiki/Eldritch_Orb_of_Annulment)                                                | `eldritch chaos`, `eldritch exalt`, `eldritch annul`                                       |
| [Eldritch Embers](https://www.poewiki.net/wiki/Lesser_Eldritch_Ember), [Ichors](https://www.poewiki.net/wiki/Lesser_Eldritch_Ichor)                                                                                                                 | `ember`, `ichor`                                                                           |
| [Vaal Orb](https://www.poewiki.net/wiki/Vaal_Orb), [Locus of Corruption](https://www.poewiki.net/wiki/Locus_of_Corruption)                                                                                                                          | `vaal`, `locus`                                                                            |
| Tainted [Chaos](https://www.poewiki.net/wiki/Tainted_Chaos_Orb), [Exalted](https://www.poewiki.net/wiki/Tainted_Exalted_Orb), [Divine Teardrop](https://www.poewiki.net/wiki/Tainted_Divine_Teardrop)                                               | `tainted chaos`, `tainted exalt`, `tainted divine`                                         |
| [Crafting Bench](https://www.poewiki.net/wiki/Crafting_Bench) crafts and the [metamods](https://www.poewiki.net/wiki/Metamod)                                                                                                                       | `bench`, `bench remove`                                                                    |
| [Essences](https://www.poewiki.net/wiki/Essence#Crafting), tiered and corrupted                                                                                                                                                                     | `essence`                                                                                  |
| [Fossils](https://www.poewiki.net/wiki/Fossil#Mechanics) under a Chaotic [Resonator](https://www.poewiki.net/wiki/Resonator)                                                                                                                        | `fossil`                                                                                   |
| [Harvest](https://www.poewiki.net/wiki/Harvest_crafting) reforges, randomise, augment, change                                                                                                                                                       | `harvest reforge`, `harvest randomise`, `harvest augment`, `harvest change`                |
| [Beastcrafting](https://www.poewiki.net/wiki/Beastcrafting): add, talisman fracture, metamod, Aspect, [imprint](https://www.poewiki.net/wiki/Imprint)                                                                                               | `beast add`, `beast fracture`, `beast metamod`, `beast aspect`, `beast imprint`, `restore` |

### 3.2 Deferred and out

| Method                                                                                                                                                                                                    | Status                                                                                                                 |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| [Awakener's Orb](https://www.poewiki.net/wiki/Awakener%27s_Orb), [Recombinator](https://www.poewiki.net/wiki/Recombinator#Unpredictable_Recombination)                                                    | deferred: the result keeps modifiers of a second item, which a craft cannot yet name (`ROADMAP.md`)                    |
| [Orb of Unravelling](https://www.poewiki.net/wiki/Orb_of_Unravelling), [Orb of Remembrance](https://www.poewiki.net/wiki/Orb_of_Remembrance)                                                              | deferred: the strands are tracked; the first's tier upgrade rule and the range the second randomises to are not stated |
| [Hinekora's Lock](https://www.poewiki.net/wiki/Hinekora%27s_Lock), [Allflame crafting](https://www.poewiki.net/wiki/Allflame_crafting)                                                                    | deferred: a choice over a method's outcomes                                                                            |
| Bench reroll of three or one modifiers ([Version 3.29.0](https://www.poewiki.net/wiki/Version_3.29.0))                                                                                                    | deferred: not worth modelling yet; what it keeps needs a probe (`QUESTIONS.md` Q80)                                    |
| [Orb of Chance](https://www.poewiki.net/wiki/Orb_of_Chance), [Tainted Mythic Orb](https://www.poewiki.net/wiki/Tainted_Mythic_Orb), the bench's rarity reroll                                             | out: a unique outcome; not worth modelling                                                                             |
| Harvest "more likely" and "less likely" [reforges](https://www.poewiki.net/wiki/List_of_harvest_crafting_options)                                                                                         | out: not commonly used in crafts that need modelling                                                                   |
| [Orb of Binding](https://www.poewiki.net/wiki/Orb_of_Binding)                                                                                                                                             | out: an alchemy to the checker; write `alchemy`                                                                        |
| [Mirror of Kalandra](https://www.poewiki.net/wiki/Mirror_of_Kalandra), [Reflecting Mist](https://www.poewiki.net/wiki/Reflecting_Mist), [Kishara's Ducat](https://www.poewiki.net/wiki/Kishara%27s_Ducat) | out: multi-item or copies                                                                                              |
| [Blessed](https://www.poewiki.net/wiki/Blessed_Orb), [Ancient](https://www.poewiki.net/wiki/Ancient_Orb), Sanctified and Gilded Fossils; sockets, quality, enchantments                                   | out: values, implicits, sockets, or unique-only                                                                        |
| Talisman base reroll; the Bestiary's corrupt, split, unique and flask recipes                                                                                                                             | out: base changes and non-explicit outcomes                                                                            |
| The Alchemical Resonator; [Rog](https://www.poewiki.net/wiki/Rog)                                                                                                                                         | out: Ruthless-only; steps chosen from what he offers, unlisted on the wiki                                             |
| [Crafting § Historical crafting methods](https://www.poewiki.net/wiki/Crafting#Historical_crafting_methods)                                                                                               | out: retired                                                                                                           |
