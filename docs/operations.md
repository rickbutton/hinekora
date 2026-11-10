# hinekora: The Operations Model

> Every crafting method is a short program over a few primitive operations on the
> checker's abstract item. §2 is the one statement of the primitives' semantics; §3 the
> ledger of the game's methods. The sequences are `check/library.ts`, each method's
> surface and description `check/methods.ts`; the abstract item's fields
> [REFERENCE.md](REFERENCE.md) §4. Game rules are linked, never restated.

---

## 1. Why a primitive set

A method changes an item in a few ways only: it strips modifiers, lays some down from a
pool, removes one, changes the rarity, fractures one, or changes a mark of the item (the
wiki's [Crafting](https://www.poewiki.net/wiki/Crafting) page sorts every currency into
those bins). So a method is an `Op` sequence, not a function of its own: the count
arithmetic, the pool and the presence bookkeeping are written once, in the primitive,
and cannot drift apart between methods that share them. Every primitive folds its effect
into the abstract item without enumerating outcomes, and over-approximates.

---

## 2. The primitives

A **pool** (`PoolSpec`) is resolved against the catalog and the current state, never a
hand-written list; the metamods in force and the memory strands' tier cut apply to it. A
**count** (`FillCount`) is a number added, a reforge's total, or one already counted. A
**selector** (`Selector`) names the present modifiers a removal may reach.

| Op          | Effect on the abstract item                                                                                                                                                                                                                                    |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `require`   | The state at this point must prove the check on every path, or the method fails.                                                                                                                                                                               |
| `strip`     | Every modifier but the protected sides' and the fractured ones goes: counts fall to the kept range; guarantees, tier pins and `possible` survive for kept types only; exclusions and fracture facts survive; the crafted range keeps what the kept sides hold. |
| `unprotect` | The metamods no longer govern the rest of the method.                                                                                                                                                                                                          |
| `keep`      | That side alone is protected for the rest of the method, in place of the item's own protections.                                                                                                                                                               |
| `fill`      | Lay down a count from a pool: counts rise, clamped to the caps and the pool's side; its types join `possible`, its rows the tier overlay; exclusions on them relax; a pool narrow enough to name asserts one of its types present.                             |
| `remove`    | Remove one modifier the selector reaches (the crafted ones: all). A guarantee survives only if unreachable, and of the reachable ones all but one remain; a side-limited removal on a protected side does nothing.                                             |
| `rarity`    | Set the rarity; caps follow. `survivors` is the rarity a scour leaves, by what its strip kept of the item the method started on.                                                                                                                               |
| `lock`      | `n` random present modifiers become fractured; when the guaranteed types account for every modifier, the lock provably landed among them.                                                                                                                      |
| `relax`     | Forget each present modifier's tier (a provably crafted one keeps it unless `crafted`): the sound summary of a tier shift.                                                                                                                                     |
| `reroll`    | Every value rolls again within its tier, fractured modifiers and protected sides excepted ([Divine Orb](https://www.poewiki.net/wiki/Divine_Orb)).                                                                                                             |
| `elevate`   | One influenced modifier on an unprotected side went up a tier or to its elevated row; which is unknown, so each loses its tier.                                                                                                                                |
| `strands`   | The memory strands' floor falls by at most the method's figure; the ceiling stays ([Memory strand § Mechanics](https://www.poewiki.net/wiki/Memory_strand#Mechanics), `QUESTIONS.md` Q68).                                                                     |
| `corrupt`   | The item is corrupted.                                                                                                                                                                                                                                         |
| `influence` | Set the influence mark, add an influence, or randomise it.                                                                                                                                                                                                     |
| `eldritch`  | Set an eldritch implicit's tier, raise one and lower the other, or let a corruption implicit replace them.                                                                                                                                                     |
| `imprint`   | Save the abstract item.                                                                                                                                                                                                                                        |
| `restore`   | Replace the item with the saved one, consuming it.                                                                                                                                                                                                             |
| `either`    | The join of each branch's effects; a branch of `end` adds nothing, and some branch survives.                                                                                                                                                                   |
| `end`       | The item is destroyed or unmodifiable on this path; the craft ends here.                                                                                                                                                                                       |

The metamods in force are read once, when the method is applied, and govern every
operation in it ([Metamod § Rules and Exceptions](https://www.poewiki.net/wiki/Metamod#Rules_and_Exceptions));
only `unprotect` and `keep` change that.

**All or nothing.** The game never applies part of a currency, so a failed `require`
fails the whole method. The checker reports the first failure, and the state `runMethod`
returns is the one the method leaves where its preconditions hold, not the input
(`QUESTIONS.md` Q50): later steps are judged against what the guide meant, so one wrong
step does not cascade into refusing every step after it, and a loop whose body fills the
item is still seen to reach its exit.

Spawn weights are not carried; they are the cost layer's ([cost.md](cost.md)). Nor is the distribution of values: a value is a span, which a predicate narrows and
`reroll` resets.

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
| [Veiled Chaos](https://www.poewiki.net/wiki/Veiled_Chaos_Orb), [Veiled Exalted](https://www.poewiki.net/wiki/Veiled_Exalted_Orb), [unveil](https://www.poewiki.net/wiki/Veiled_modifier#How_to_obtain)                                              | `veiled chaos`, `veiled exalt`, `aisling`, `unveil`                                        |
| Shaper's, Elder's and Conqueror [Exalted Orbs](https://www.poewiki.net/wiki/Hunter%27s_Exalted_Orb#Mechanics)                                                                                                                                       | `exalt <influence>`                                                                        |
| [Recombinator](https://www.poewiki.net/wiki/Recombinator#Unpredictable_Recombination), two items of one base (`QUESTIONS.md` Q55)                                                                                                                   | `recombine`                                                                                |
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

| Method                                                                                                                                                                                                    | Status                                                                      |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| [Awakener's Orb](https://www.poewiki.net/wiki/Awakener%27s_Orb)                                                                                                                                           | deferred: keeps a modifier of the donor, so needs it as a second item (Q28) |
| [Orb of Unravelling](https://www.poewiki.net/wiki/Orb_of_Unravelling)                                                                                                                                     | deferred: the strands are tracked, its tier upgrade rule is not stated      |
| [Hinekora's Lock](https://www.poewiki.net/wiki/Hinekora%27s_Lock), [Allflame crafting](https://www.poewiki.net/wiki/Allflame_crafting)                                                                    | deferred: a choice over a method's outcomes (the Lock: Q34)                 |
| Bench reroll of three or one modifiers ([Version 3.29.0](https://www.poewiki.net/wiki/Version_3.29.0))                                                                                                    | deferred: not worth modelling yet (Q7)                                      |
| [Orb of Chance](https://www.poewiki.net/wiki/Orb_of_Chance), [Tainted Mythic Orb](https://www.poewiki.net/wiki/Tainted_Mythic_Orb), the bench's rarity reroll                                             | out: a unique outcome; not worth modelling (Q15)                            |
| [Orb of Binding](https://www.poewiki.net/wiki/Orb_of_Binding)                                                                                                                                             | out: an alchemy to the checker; write `alchemy`                             |
| [Mirror of Kalandra](https://www.poewiki.net/wiki/Mirror_of_Kalandra), [Reflecting Mist](https://www.poewiki.net/wiki/Reflecting_Mist), [Kishara's Ducat](https://www.poewiki.net/wiki/Kishara%27s_Ducat) | out: multi-item or copies                                                   |
| [Blessed](https://www.poewiki.net/wiki/Blessed_Orb), [Ancient](https://www.poewiki.net/wiki/Ancient_Orb), Sanctified and Gilded Fossils; sockets, quality, enchantments                                   | out: values, implicits, sockets, or unique-only                             |
| Talisman base reroll; the Bestiary's corrupt, split, unique and flask recipes                                                                                                                             | out: base changes and non-explicit outcomes                                 |
| The Alchemical Resonator; [Rog](https://www.poewiki.net/wiki/Rog)                                                                                                                                         | out: Ruthless-only; steps chosen from what he offers, unlisted on the wiki  |
| [Crafting § Historical crafting methods](https://www.poewiki.net/wiki/Crafting#Historical_crafting_methods)                                                                                               | out: retired                                                                |
