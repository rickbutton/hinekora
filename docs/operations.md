# Hinekora: The Operations Model

> How every crafting method is expressed as a short program over a handful of primitive
> effects on the checker's abstract item, so that a method is a library entry rather
> than a hand-written function. §2 is the primitive set and its abstract semantics; §3
> is the ledger of the game's methods, each with its composition and its status; §4 is
> what the surface language sees. The checker's `check/ops.ts` and `check/library.ts`
> are audited against this doc.
>
> Game rules are not restated here; each method links the wiki section that defines it.
> The abstract item is [ARCHITECTURE.md](ARCHITECTURE.md) §4 and [REFERENCE.md](REFERENCE.md)
> §4; the item model is [item-model.md](item-model.md); the syntax is
> [crafting-lang-surface-v0.md](crafting-lang-surface-v0.md).

---

## 1. Why a primitive set

A crafting method changes an item in a few ways only: it strips modifiers, lays down
modifiers drawn from some pool, removes one, changes the rarity, locks a modifier, or
marks the item. The wiki's [Crafting](https://www.poewiki.net/wiki/Crafting) page sorts
every currency into those bins. In the checker each method has so far been its own
function that re-derives the count arithmetic, the pool and the presence bookkeeping, and
that duplication is where the rules drift apart. The alternative is a small set of
**primitive effects** with fixed abstract semantics and a **library** that states, per
method, the sequence of primitives it composes, its preconditions among them. The checker interprets the
library; the surface language is sugar over library entries; adding a method is a table
row plus a test.

The checker's design constraint binds every primitive: it folds its effect into the abstract item
without enumerating outcomes, and over-approximates, so the result covers every item the
game could produce.

---

## 2. The primitives

The abstract item `a` has the components REFERENCE §4 lists (rarity, coupled counts,
presence BDD, `possible`, tier overlay, crafted range) plus a set of **marks**
(influences, corrupted) that §3 needs.

A **pool** is a description the checker resolves against the catalog and the current
state, never a hand-written list: a source (the natural pool; an essence's grant; a bench
craft; the veiled placeholders; the unveil results; an influence's pool), an optional
generation, an optional [modifier group](https://www.poewiki.net/wiki/Harvest_crafting#Modifier_groups)
tag, an optional level cap, an optional "top tiers only" cut, the sibling rows of a
present modifier at its tier, and the metamod restrictions in force. A **selector** names
which present modifiers an effect may reach: a generation, a tag, a source (crafted), an
influence, a specific type, or any that is not locked.

| Primitive                | Abstract semantics                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `strip(keep)`            | Every modifier outside the keep-set is gone. Counts fall to the kept range; guarantees, tier pins and `possible` survive only for kept types; exclusions clear; fracture facts always survive; the crafted range keeps only what the kept side could hold. `keep` is a selector: nothing, a protected generation, the fractured modifier, a chosen side, or everything.                                                                                                                               |
| `fill(pool, k, choose?)` | Lay down `k` modifiers (a range) drawn from `pool`, each in its own generation. Counts rise by `k`, clamped to the caps and to the pool's generation when it has one; the pool's types join `possible` and its rows the tier overlay; exclusions on pool types are relaxed; when the pool is narrow enough to name, "at least one of its types is present" is asserted. `choose = n`: the player picks among `n` offered draws, so a named target is guaranteed iff the pool holds at most `n` types. |
| `remove(selector, k)`    | Remove `k` (a range) modifiers the selector may reach. Counts fall by `k` on the reachable sides; a guarantee survives only if the removal could not reach it; exclusions and fracture facts survive; the crafted lower bound drops unless the selector cannot reach a crafted modifier.                                                                                                                                                                                                              |
| `rarity(r)`              | Set the rarity; caps follow and counts are re-clamped. `rarity(lowest)` picks the lowest rarity whose caps hold what the method's strip kept, read per side from the state the method started on.                                                                                                                                                                                                                                                                                                     |
| `lock(selector, n)`      | Exactly `n` modifiers the selector may reach become fractured. Candidates are the guaranteed types it covers; when they account for every modifier the lock provably landed among them.                                                                                                                                                                                                                                                                                                               |
| `mark(m)` / `unmark(m)`  | Set or clear an item-level mark. Marks are exact; influence marks widen the natural pool with the influence's rows, `corrupted` restricts which methods apply.                                                                                                                                                                                                                                                                                                                                        |
| `relax(selector)`        | Forget which tier each selected present modifier is: the row could now be any that rolls here. The sound summary of every method that shifts tiers without changing which modifiers are present.                                                                                                                                                                                                                                                                                                      |
| `imprint` / `restore`    | Save the abstract item, or replace it with the saved one. Exact.                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `end`                    | The item is destroyed or made unmodifiable on this path: the craft ends here, like `restart` ends an iteration.                                                                                                                                                                                                                                                                                                                                                                                       |
| `require(check)`         | The state at this point must prove `check` on every path; otherwise the whole method fails. A check is one of: a rarity; a base that can hold a rarity; an open slot (in a generation); a reachable modifier for a selector; a count bound; a mark present or absent; no fracture; a veiled modifier present or absent; class membership; no blocking metamod; a pool non-empty.                                                                                                                      |

A method is an **ordered sequence** of these operations. Its preconditions are
`require` operations like any other, usually first, but a `require` may sit anywhere in
the sequence, including last, where it checks the state the earlier operations produced.
A method is **all or nothing**: when any `require` in it fails, the method fails as a
whole and the item is as it was before the first operation; the game never applies part
of a currency. The checker therefore reports a failed `require` against the state before
the method and continues from that state. The one other combinator is **either**, which
joins the results of alternative sequences, for a method whose outcome is one of several
distinct things.

What the checker does today is already these primitives in disguise. Forcing a specific
mod (essence, bench) is `fill` with a one-row pool; Harvest's "at least one fire modifier"
is `fill` with a tagged pool; the veiled placeholder is `fill` with the two placeholder
rows; a reforge is `strip(keep); fill(pool, k)` where `k` is the reforge's count when
nothing is kept and "up to the cap" otherwise; scour is `strip(keep); rarity(lowest)`.

Two things the primitives deliberately do not carry, both sound to omit at the level the
checker reasons (which modifiers are present, at which tier): **spawn weights and
biases** ("more likely", fossil multipliers, memory strands), which belong to the deferred
probability layer, and **numeric values** (Divine Orb, lucky rolls, mirrored scaling).

---

## 3. The library

Status: **built** (a library entry exists today), **composes** (expressible with §2,
not yet built), **probe** (expressible once an in-game question in `QUESTIONS.md` is
settled), **later** (needs a component the abstract item does not have yet, named), **out**
(not an operation on one item's explicit modifiers: multi-item, unique-only, implicit,
socket, quality or value-only; or retired from the game). The wiki's
[Metamod § Rules and Exceptions](https://www.poewiki.net/wiki/Metamod#Rules_and_Exceptions)
table decides the keep-set and the selector of every row that meets a metamod.

### 3.1 Currency

| Method                                                                                                                                                                                                                                                               | Precondition                                                                                                                                                                            | Composition                                                                                                                                        | Status                          |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| [Orb of Transmutation](https://www.poewiki.net/wiki/Orb_of_Transmutation)                                                                                                                                                                                            | Normal                                                                                                                                                                                  | `rarity(magic); fill(natural, [1,2])`                                                                                                              | built                           |
| [Orb of Augmentation](https://www.poewiki.net/wiki/Orb_of_Augmentation)                                                                                                                                                                                              | Magic, open slot                                                                                                                                                                        | `fill(natural, 1)`                                                                                                                                 | built                           |
| [Orb of Alteration](https://www.poewiki.net/wiki/Orb_of_Alteration)                                                                                                                                                                                                  | Magic                                                                                                                                                                                   | `strip(protected ∪ fractured); fill(natural, [1,2])`                                                                                               | built                           |
| [Regal Orb](https://www.poewiki.net/wiki/Regal_Orb)                                                                                                                                                                                                                  | Magic, base can be Rare                                                                                                                                                                 | `rarity(rare); fill(natural, 1)`                                                                                                                   | built                           |
| [Orb of Alchemy](https://www.poewiki.net/wiki/Orb_of_Alchemy)                                                                                                                                                                                                        | Normal, base can be Rare                                                                                                                                                                | `rarity(rare); fill(natural, [4,6])`                                                                                                               | built                           |
| [Chaos Orb](https://www.poewiki.net/wiki/Chaos_Orb)                                                                                                                                                                                                                  | Rare                                                                                                                                                                                    | `strip(protected ∪ fractured); fill(natural, [4,6])`                                                                                               | built                           |
| [Exalted Orb](https://www.poewiki.net/wiki/Exalted_Orb)                                                                                                                                                                                                              | Rare, open slot                                                                                                                                                                         | `fill(natural[gen], 1)`                                                                                                                            | built                           |
| [Orb of Annulment](https://www.poewiki.net/wiki/Orb_of_Annulment#Mechanics)                                                                                                                                                                                          | reachable modifier                                                                                                                                                                      | `remove(unlocked ∖ protected ∖ cannot-roll-tagged [∩ gen], 1)`                                                                                     | built                           |
| [Orb of Scouring](https://www.poewiki.net/wiki/Orb_of_Scouring)                                                                                                                                                                                                      | Magic or Rare                                                                                                                                                                           | `strip(protected ∪ fractured); rarity(lowest)`                                                                                                     | built                           |
| [Fracturing Orb](https://www.poewiki.net/wiki/Fracturing_Orb#Mechanics)                                                                                                                                                                                              | Rare, ≥4 modifiers, no fracture, no influence                                                                                                                                           | `lock(any, 1)`                                                                                                                                     | built                           |
| [Orb of Chance](https://www.poewiki.net/wiki/Orb_of_Chance)                                                                                                                                                                                                          | Normal                                                                                                                                                                                  | `either(transmute, alchemy, end)` (the unique outcome ends the craft)                                                                              | composes                        |
| [Orb of Binding](https://www.poewiki.net/wiki/Orb_of_Binding)                                                                                                                                                                                                        | Normal, base can be Rare                                                                                                                                                                | as Orb of Alchemy                                                                                                                                  | composes                        |
| Foulborn [Augmentation](https://www.poewiki.net/wiki/Foulborn_Orb_of_Augmentation) / [Regal](https://www.poewiki.net/wiki/Foulborn_Regal_Orb) / [Exalted](https://www.poewiki.net/wiki/Foulborn_Exalted_Orb)                                                         | as the plain orb                                                                                                                                                                        | as the plain orb with `natural.topTiers`                                                                                                           | composes                        |
| [Veiled Chaos Orb](https://www.poewiki.net/wiki/Veiled_Chaos_Orb)                                                                                                                                                                                                    | Rare, no veiled or unveiled modifier ([Crafting](https://www.poewiki.net/wiki/Crafting): "cannot be used to obtain multiple veiled modifiers"; the unveiled half is `QUESTIONS.md` Q12) | `strip(protected ∪ fractured); fill(natural, [3,5]); fill(veiled, 1)`                                                                              | built                           |
| [Veiled Exalted Orb](https://www.poewiki.net/wiki/Veiled_Exalted_Orb)                                                                                                                                                                                                | Rare, no veiled or unveiled modifier, reachable modifier                                                                                                                                | `remove(unlocked ∖ protected, 1); fill(veiled, 1)` (the removal ignores cannot-roll)                                                               | built                           |
| Unveil ([Veiled modifier § How to obtain](https://www.poewiki.net/wiki/Veiled_modifier#How_to_obtain))                                                                                                                                                               | veiled modifier present                                                                                                                                                                 | `remove(veiled, 1); fill(unveiled ∖ blocked groups, 1, choose 3)`                                                                                  | built                           |
| Shaper's / Elder's / Conqueror [Exalted Orbs](https://www.poewiki.net/wiki/Hunter%27s_Exalted_Orb#Mechanics)                                                                                                                                                         | Rare, open slot, no influence, no fracture, no eldritch implicit                                                                                                                        | `mark(influence); fill(influence, 1)`                                                                                                              | later: influence marks          |
| [Awakener's Orb](https://www.poewiki.net/wiki/Awakener%27s_Orb)                                                                                                                                                                                                      | two items                                                                                                                                                                               |                                                                                                                                                    | out: multi-item                 |
| [Orb of Dominance](https://www.poewiki.net/wiki/Orb_of_Dominance)                                                                                                                                                                                                    | ≥2 influenced modifiers, armour                                                                                                                                                         | `remove(influenced ∖ protected, 1); relax(influenced)`                                                                                             | later: influence marks          |
| [Eldritch Chaos Orb](https://www.poewiki.net/wiki/Eldritch_Chaos_Orb)                                                                                                                                                                                                | Rare armour, dominant Exarch or Eater implicit                                                                                                                                          | `strip(other side ∪ fractured); fill(natural[side], up to cap)`                                                                                    | later: implicit marks           |
| [Eldritch Exalted Orb](https://www.poewiki.net/wiki/Eldritch_Exalted_Orb)                                                                                                                                                                                            | as above, open slot on that side                                                                                                                                                        | `fill(natural[side], 1)`                                                                                                                           | later: implicit marks           |
| [Eldritch Orb of Annulment](https://www.poewiki.net/wiki/Eldritch_Orb_of_Annulment)                                                                                                                                                                                  | as above, reachable modifier on that side                                                                                                                                               | `remove(unlocked ∖ protected ∖ cannot-roll-tagged ∩ side, 1)`                                                                                      | later: implicit marks           |
| [Vaal Orb](https://www.poewiki.net/wiki/Vaal_Orb)                                                                                                                                                                                                                    | not corrupted                                                                                                                                                                           | `mark(corrupted); either(nothing, strip(protected ∪ fractured); rarity(rare); fill(natural, 6))` (implicit and socket outcomes are `nothing` here) | later: corrupted mark           |
| [Locus of Corruption](https://www.poewiki.net/wiki/Locus_of_Corruption)                                                                                                                                                                                              | not corrupted                                                                                                                                                                           | as Vaal Orb, plus `end` and an influenced reforge branch                                                                                           | later: corrupted, influence     |
| [Tainted Chaos Orb](https://www.poewiki.net/wiki/Tainted_Chaos_Orb)                                                                                                                                                                                                  | corrupted Rare                                                                                                                                                                          | `either(chaos, scour)`                                                                                                                             | later: corrupted mark           |
| [Tainted Exalted Orb](https://www.poewiki.net/wiki/Tainted_Exalted_Orb)                                                                                                                                                                                              | corrupted Rare                                                                                                                                                                          | `either(fill(natural, 1), remove(unlocked ∖ protected, 1))`                                                                                        | later: corrupted mark           |
| [Tainted Divine Teardrop](https://www.poewiki.net/wiki/Tainted_Divine_Teardrop)                                                                                                                                                                                      | corrupted Rare                                                                                                                                                                          | `relax(not crafted)`                                                                                                                               | later: corrupted mark           |
| [Tainted Mythic Orb](https://www.poewiki.net/wiki/Tainted_Mythic_Orb)                                                                                                                                                                                                | corrupted                                                                                                                                                                               | `end`                                                                                                                                              | later: corrupted mark           |
| [Orb of Unravelling](https://www.poewiki.net/wiki/Orb_of_Unravelling)                                                                                                                                                                                                | memory strands                                                                                                                                                                          | `relax(not crafted)`                                                                                                                               | composes (strands not tracked)  |
| [Hinekora's Lock](https://www.poewiki.net/wiki/Hinekora%27s_Lock)                                                                                                                                                                                                    |                                                                                                                                                                                         | previewing the next outcome is a choice over the next method's outcomes                                                                            | later: choice over an operation |
| [Imprint](https://www.poewiki.net/wiki/Imprint) (Eternal Orb, beastcraft)                                                                                                                                                                                            | not corrupted, mirrored or fractured                                                                                                                                                    | `imprint` / `restore`                                                                                                                              | composes                        |
| [Mirror of Kalandra](https://www.poewiki.net/wiki/Mirror_of_Kalandra), [Reflecting Mist](https://www.poewiki.net/wiki/Reflecting_Mist), [Recombinator](https://www.poewiki.net/wiki/Recombinator), [Kishara's Ducat](https://www.poewiki.net/wiki/Kishara%27s_Ducat) |                                                                                                                                                                                         |                                                                                                                                                    | out: multi-item or copies       |
| [Divine Orb](https://www.poewiki.net/wiki/Divine_Orb), [Blessed Orb](https://www.poewiki.net/wiki/Blessed_Orb), sockets, quality, enchantments, eldritch implicits, [Orb of Conflict](https://www.poewiki.net/wiki/Orb_of_Conflict)                                  |                                                                                                                                                                                         |                                                                                                                                                    | out: values, implicits, sockets |
| [Ancient Orb](https://www.poewiki.net/wiki/Ancient_Orb) and the unique-only currencies                                                                                                                                                                               |                                                                                                                                                                                         |                                                                                                                                                    | out: unique-only                |

### 3.2 Crafting bench

| Method                                                                                              | Precondition                                                     | Composition                                              | Status   |
| --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | -------------------------------------------------------- | -------- |
| Craft a modifier ([Crafting Bench](https://www.poewiki.net/wiki/Crafting_Bench))                    | open slot on its side, crafted limit, group not possibly present | `fill(bench(row), 1)`                                    | built    |
| The five metamods ([Metamod](https://www.poewiki.net/wiki/Metamod))                                 | as any crafted modifier                                          | `fill(bench(row), 1)`; their effect is read off presence | built    |
| Remove crafted modifiers                                                                            | a crafted modifier present                                       | `remove(crafted ∖ fractured, all)`                       | composes |
| Replace a crafted modifier                                                                          | exactly one crafted modifier                                     | remove crafted; craft                                    | composes |
| Reroll three / one random modifiers ([Version 3.29.0](https://www.poewiki.net/wiki/Version_3.29.0)) | Rare                                                             | `remove(unlocked, k); fill(natural, k)`                  | probe    |
| Reroll the rarity (1 Chance)                                                                        | non-unique                                                       | scour; chance                                            | composes |

### 3.3 Essences

Per [Essence § Crafting](https://www.poewiki.net/wiki/Essence#Crafting): tiers 1–4 on a Normal item, 5–7 on Normal or Rare, never Magic, blocked by any metamod but multimod.

| Method                                                                                                       | Composition                                                                                  | Status   |
| ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- | -------- |
| Any tiered essence                                                                                           | `strip(fractured); rarity(rare); fill(natural.levelCap(tier), [3,5]); fill(grant(class), 1)` | built    |
| Corrupted essences ([Essence § Corrupted essences](https://www.poewiki.net/wiki/Essence#Corrupted_essences)) | same, the grant an untiered exclusive row                                                    | composes |

### 3.4 Fossils

Per [Fossil § Mechanics](https://www.poewiki.net/wiki/Fossil#Mechanics) and
[Resonator](https://www.poewiki.net/wiki/Resonator): a reforge whose pool drops the
fossils' "no X modifiers" tags and, for some fossils, adds fossil-only rows or forces one;
blocked by any metamod but multimod.

| Method                                                            | Composition                                                                         | Status                     |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------------- | -------------------------- |
| Weight fossils (chaotic / alchemical resonator)                   | `strip(fractured); rarity(rare); fill(natural ∖ blocked tags ∪ fossil rows, [4,6])` | probe (chaotic on Normal?) |
| [Fractured Fossil](https://www.poewiki.net/wiki/Fractured_Fossil) | as above, then `lock(any, 1)`                                                       | composes                   |
| Hollow, Glyphic ([Fossil](https://www.poewiki.net/wiki/Fossil))   | as above, then `fill(forced row, 1)` taken from the count                           | composes                   |
| [Bloodstained Fossil](https://www.poewiki.net/wiki/Fossil)        | as above, then `mark(corrupted)`                                                    | later: corrupted mark      |
| Sanctified, Gilded                                                | values / implicit only                                                              | out                        |

### 3.5 Harvest

Per [Harvest crafting](https://www.poewiki.net/wiki/Harvest_crafting) and the harvest
rows of the Metamod table.

| Method                                                                          | Composition                                                                                                       | Status                 |
| ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ---------------------- |
| Reforge including a `<tag>` modifier                                            | `strip(protected ∪ fractured); fill(natural, [4,6]); fill(natural[tag], 1)` (the tagged fill is within the count) | built                  |
| Reforge more / less likely                                                      | as a plain reforge (bias is probability)                                                                          | composes               |
| Add a `<tag>` modifier, remove another random modifier                          | `remove(unlocked ∖ protected, 1); fill(natural[tag], 1)`, the removal never the added one                         | built                  |
| Change a resistance / damage modifier to another element                        | `remove(type ∖ protected, 1); fill(siblings(type) at its tier, 1)`                                                | composes               |
| Reforge an influenced item including an influence modifier; randomise influence | `strip(protected ∪ fractured); fill(natural, [4,6]); fill(influence, 1)`                                          | later: influence marks |

### 3.6 Beastcrafting

Per [Beastcrafting](https://www.poewiki.net/wiki/Beastcrafting).

| Method                                                | Composition                                                                               | Status                                           |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------ |
| Add a prefix, remove a random suffix (and the mirror) | `remove(suffix ∖ protected, 1); fill(natural[prefix], 1)` (the pool at the beast's level) | composes                                         |
| Add a modifier to an influenced item                  | `fill(natural ∪ influence, 1)`                                                            | later: influence marks                           |
| Fracture one / two modifiers on a talisman            | `lock(any, 1)` / `lock(any, 2)`                                                           | composes (two locks relax the one-fracture rule) |
| Add a random metamod                                  | `fill(metamods, 1)`                                                                       | composes                                         |
| Craft an Aspect                                       | `fill(aspect row, 1)`                                                                     | composes                                         |
| Imprint a Magic item / a Rare talisman                | `imprint`                                                                                 | composes                                         |
| Reroll a talisman base                                | base change keeping modifiers                                                             | later: base change                               |
| Corrupt, split, unique and flask recipes              |                                                                                           | out                                              |

### 3.7 Allflame and league content

[Allflame crafting](https://www.poewiki.net/wiki/Allflame_crafting) runs a currency up to
four times and the player keeps one result: a choice over an operation's outcomes, the
same shape as Hinekora's Lock (later). Its ducats that touch explicit modifiers compose
(Cyaxan's: a reforge with a forced exclusive row; Brinehook's, Rotmother's: a `fill` from a
dedicated pool; The Genteel's: a sibling swap); their core status is unknown at the
snapshot. [Rog](https://www.poewiki.net/wiki/Rog)'s options are not listed on the wiki
(probe). The methods the wiki lists under
[Crafting § Historical crafting methods](https://www.poewiki.net/wiki/Crafting#Historical_crafting_methods)
are out.

### 3.8 Preconditions and marks the library needs

The rows above use these preconditions beyond today's: `corrupted` present or absent,
an influence present or absent, a dominant eldritch implicit, a veiled modifier present
or absent (today only "present"), a count of influenced or crafted modifiers. They use
these marks: the six influences ([Influenced item](https://www.poewiki.net/wiki/Influenced_item#Mechanics)),
`corrupted` ([Corrupted](https://www.poewiki.net/wiki/Corrupted)), and the dominant
eldritch implicit ([Eldritch implicit modifier](https://www.poewiki.net/wiki/Eldritch_implicit_modifier)).
Marks are exact, so they are a plain set on the abstract item, joined by union of
possibilities; a mark that is "maybe present" blocks any method that requires it absent.

---

## 4. Surface sugar

A statement is a library entry's name followed by its arguments: quoted names, a tier, a
tag. The parser knows nothing per method; the library's signature (which arguments, of
which sort) drives parsing, completion and hover, and `def` functions remain the user's
way to name a composition. The currencies keep their short names; the named operations
keep their current spelling (`essence "greed" t1`, `bench "maximum life"`,
`harvest reforge "fire"`, `veiled chaos`, `unveil`). New entries appear as new names with
no parser change.
