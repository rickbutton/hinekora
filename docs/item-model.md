# hinekora: Item Model

> The item and modifier model hinekora audits its code against, for Path of Exile 1: what
> an item and a modifier are, and which modifiers may sit together. Each game rule links
> its wiki section (cached in `tools/poewiki`) and the text says only how hinekora models
> it, or narrows it. The fields are the types in `packages/core/src/model/`; this doc
> gives their meaning.

---

## 1. Scope

In: `Base`, `Mod`, `Effect`, `Item`; the identifier types; spawn weights; modifier sources;
influence and fracture marks; affix capacity; well-formedness.

Out: candidate-pool eligibility (the
[spawn weight tag](https://www.poewiki.net/wiki/Modifier#Spawn_weight_tag) rule applied to
an item; only the data it reads is declared here); currency operations and the
essence/bench/fossil catalogues; the implicit layer (implicits, corruption, enchantments,
synthesis: [Modifier § Types of modifiers](https://www.poewiki.net/wiki/Modifier#Types_of_modifiers));
unique items ([Rarity § Unique](https://www.poewiki.net/wiki/Rarity#Unique)).

---

## 2. Identifiers

The game keys its data by several families of identifier, distinct types in `model/ids.ts`
because confusing one for another is a category error. Two carry meaning beyond their name:

- A **mod type** is the tier bucket of a row of the `Mods` table
  ([Mod Level](https://www.poewiki.net/wiki/Modifier#Mod_Level)). Rows of one type never
  share an item and share exclusion groups, but a type is **not** one ladder: many types have
  both prefix and suffix rows, rolling on different base classes. The ladder a player sees is
  the type's rows that roll on one base, which the pool defines.
- A **tag** plays three roles under one type: a base's tags, the tags a modifier adds to its
  item, and a modifier's own category tags ([Tags](https://www.poewiki.net/wiki/Modifier#Tags)).

A mod family is an [exclusion group](https://www.poewiki.net/wiki/Modifier#Group/family). A
spawn weight of zero discards the modifier.

---

## 3. Enumerations

**Generation**: prefix or suffix. Only generation types 1 and 2 occupy affix slots; the rest
are the implicit layer ([Generation type](https://www.poewiki.net/wiki/Modifier#Generation_type)).

**Rarity**: normal, magic, rare ([Rarities](https://www.poewiki.net/wiki/Rarity#Rarities)).

**Domain**: the data's partitions, as the data spells them
([Domain](https://www.poewiki.net/wiki/Modifier#Domain); `misc` is the wiki's "Jewel",
`affliction_jewel` the cluster jewels). Bench, fossil-only, veiled and unveiled rows live in
partitions no base has (`crafted`, `delve`, `veiled`, `unveiled`) and are placed directly.

**Source**: which mechanic places a modifier (`ModSource` in `model/sources.ts`), a reading
of the row (§5), never independent data. Only natural modifiers roll from ordinary currency
([Reforging modifiers](https://www.poewiki.net/wiki/Crafting#Reforging_modifiers)); the rest
arrive through their own mechanic and are exempt from the natural-roll rules in §8.

**Influence**: the six of
[Influenced item § Mechanics](https://www.poewiki.net/wiki/Influenced_item#Mechanics); the
data spells the Conqueror tags by their creatures (`model/marks.ts`).

---

## 4. Base

[Rarity § Normal](https://www.poewiki.net/wiki/Rarity#Normal): the item before any affix
(`model/base.ts`), identified by its metadata id since display names collide. Beyond its
class, domain and tags, a base carries three implicits that change crafting:

- a per-side **capacity delta**, the "maximum prefixes/suffixes allowed" stats, which shift
  the rarity's per-side limit (§7; [Simplex Amulet](https://www.poewiki.net/wiki/Simplex_Amulet#Mechanics),
  [Ratcheting Ring](https://www.poewiki.net/wiki/Ratcheting_Ring#Mechanics));
- a per-side **magnitude**, the "increased … Modifier magnitudes" implicit, carried but not
  applied: a value compares on its row's own span;
- **all influences**, the Astrolabe Amulet's: the item counts as having every influence
  ([Influenced item § Mechanics](https://www.poewiki.net/wiki/Influenced_item#Mechanics)),
  so every influence row rolls on it and no influence orb takes it.

Derived, per [Rarity § Rare](https://www.poewiki.net/wiki/Rarity#Rare), from the class lists
in `model/capacity.ts`: whether a Rare **holds four** affixes and whether the base **can be
Rare** at all. A cluster jewel's modifiers roll under the
spawn tag of its enchantment ([Cluster jewel](https://www.poewiki.net/wiki/Cluster_jewel)),
which the checker reads as a tag of the base.

---

## 5. Mod

One tier of one modifier: one row of the `Mods` table
([Conditions](https://www.poewiki.net/wiki/Modifier#Conditions)), identified by its row id
(`model/mod.ts`). Most fields are the data's own (type, groups, side, domain, the
[mod level](https://www.poewiki.net/wiki/Modifier#Mod_Level), category tags, display text).
Three readings matter to the model:

- **Spawn table**, in table order: the first entry whose tag the item carries decides, so an
  early zero disables the row for that tag
  ([spawn weight tag](https://www.poewiki.net/wiki/Modifier#Spawn_weight_tag)).
- **Added tags**, the data's `adds_tags`, which the item gains while the row is on it (the
  wiki does not describe them). An added tag can disable rows (a weapon-specific jewel
  modifier adds `specific_weapon`, zeroing every other such modifier) or enable them (one
  staff modifier on a Strength jewel lets the others roll, within one Chaos Orb too:
  confirmed in game); the checker admits such rows for a possibly present adder.
- **Generation table**, the data's `generation_weights`, read as the spawn table is, the
  matching entry scaling the weight in percent (the wiki does not describe them,
  `QUESTIONS.md` Q56); they hold a
  [cluster jewel](https://www.poewiki.net/wiki/Cluster_jewel#Mechanics)'s notable cap.

A row's **effects** are the rule changes it carries while on the item (§6), empty for every
row but the five metamods. A row is **essence-only** when the data says so
([Essence § Crafting](https://www.poewiki.net/wiki/Essence#Crafting)).

Rules every row satisfies:

- **Source follows the row.** Essence-only ⇒ essence; else a name with "Elevated" ⇒ elevated
  (an [elevated modifier](https://www.poewiki.net/wiki/Elevated_modifier), which rolls
  nowhere and only an Orb of Dominance makes); else domain `crafted` ⇒ bench,
  `veiled`/`unveiled` ⇒ veiled, `delve` ⇒ fossil; else any positive spawn weight ⇒ natural,
  none ⇒ other. (This is the adapter's `classifySource`.)
- **Essence-only rows never roll**: every spawn weight is zero.
- **Carriers are bench metamods**: in PoE1 every row with effects is a bench craft.

---

## 6. Effects

A change to the crafting rules, active exactly while its carrier is on the item. Effects
are read off the modifiers present, never recorded on the item, so removing the carrier
withdraws its effect with no bookkeeping. Which currency honours which effect is the table
in [Metamod § Rules and Exceptions](https://www.poewiki.net/wiki/Metamod#Rules_and_Exceptions).
Three kinds cover the five real metamods ([Metamod](https://www.poewiki.net/wiki/Metamod)):

- `PoolRestrict(category)`, "Cannot roll Attack / Caster Modifiers": bars rows of the
  category from being added and shields present ones from removal.
- `ProtectGeneration(generation)`, "Prefixes / Suffixes Cannot Be Changed": shields whatever
  occupies that side from removal and reroll.
- `CraftedCap(cap)`, "Can have up to 3 Crafted Modifiers": raises the crafted-mod limit; the
  highest cap carried wins, never below one.

---

## 7. Item

An item is a base and its item level
([Item level](https://www.poewiki.net/wiki/Item_level), fixed at creation), a rarity, the
affixes of each side (order within a side carries no meaning), and its marks:

- **Memory strands**, 0 to 100, which cut the tiers an adding or rerolling currency can roll
  and are used up by it ([Memory strand § Mechanics](https://www.poewiki.net/wiki/Memory_strand#Mechanics),
  [§ Crafting methods consuming memory strands](https://www.poewiki.net/wiki/Memory_strand#Crafting_methods_consuming_memory_strands));
  `model/strands.ts` counts the tiers over the modifier's whole ladder on the base.
- **Influences**, one or two
  ([Influenced item](https://www.poewiki.net/wiki/Influenced_item#Mechanics)); an influence
  adds its `<class>_<influence>` tag, which is how influence-exclusive rows join the natural
  pool.
- **Fractured** affixes, locked against removal and reroll
  ([Fractured item](https://www.poewiki.net/wiki/Fractured_item#Mechanics)).
- **Corrupted**, never cleared
  ([Corrupted](https://www.poewiki.net/wiki/Corrupted#Modifying_corrupted_items)).
- **Eldritch implicits**, the Searing Exarch's and the Eater of Worlds', each a tier and which
  implicit it is ([Eldritch implicit modifier](https://www.poewiki.net/wiki/Eldritch_implicit_modifier)).

Derived: the affix counts by side and by source; the present types and families (the
coexistence facts); the tags a roll matches, the base's ∪ the influence tags ∪ every present
affix's added tags; and the active effects of the modifiers present.

**Affix capacity.** [Rarities](https://www.poewiki.net/wiki/Rarity#Rarities) gives the
per-side limit; an experimented base's delta shifts each side; and the two sides together
never exceed twice the rarity's per-side limit, which is what holds a magic Ratcheting Ring
to two suffixes and a magic Simplex Amulet to none (`model/capacity.ts`).

```
natural_per_side  = normal 0 | magic 1 | rare (holds_four ? 2 : 3)
combined_capacity = 2 * natural_per_side
prefix_capacity   = max(0, natural_per_side + base.prefix_capacity_delta)
suffix_capacity   = max(0, natural_per_side + base.suffix_capacity_delta)
max_affixes       = min(combined_capacity, prefix_capacity + suffix_capacity)
prefix_slot_open  = prefix_count < prefix_capacity and affix_count < max_affixes
suffix_slot_open  = suffix_count < suffix_capacity and affix_count < max_affixes
```

**Crafted limit** ([Crafting Bench](https://www.poewiki.net/wiki/Crafting_Bench)): one
bench-crafted modifier, or the highest `CraftedCap` carried.

---

## 8. Well-formedness

What every item satisfies at every point of a craft; an operation whose result would break
one of these is not a legal operation. Tags appear nowhere here: they decide what can roll,
not what can coexist.

| Rule                                  | Statement                                                                                                                                                                                                                                                     | Source                                                                                                                            |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Affix side matches generation         | every prefix is a prefix row, every suffix a suffix row                                                                                                                                                                                                       |                                                                                                                                   |
| Rarity within class ceiling           | Rare ⇒ `base.rare_capable`                                                                                                                                                                                                                                    | [Rarity § Rare](https://www.poewiki.net/wiki/Rarity#Rare)                                                                         |
| Prefixes / suffixes within capacity   | `prefix_count ≤ prefix_capacity`, `suffix_count ≤ suffix_capacity`                                                                                                                                                                                            | §7                                                                                                                                |
| Affixes within combined capacity      | `affix_count ≤ max_affixes`                                                                                                                                                                                                                                   | §7                                                                                                                                |
| Distinct mod types                    | two rows of one tier bucket never share an item                                                                                                                                                                                                               |                                                                                                                                   |
| Disjoint families                     | no exclusion group is claimed twice                                                                                                                                                                                                                           | [Group/family](https://www.poewiki.net/wiki/Modifier#Group/family)                                                                |
| Natural affix tiers within item level | every `natural` affix has `min_level ≤ ilvl`; essences and the bench place their rows regardless (an essence's row at its fixed tier: confirmed in game, not on the wiki)                                                                                     | [Mod Level](https://www.poewiki.net/wiki/Modifier#Mod_Level), [Essence § Crafting](https://www.poewiki.net/wiki/Essence#Crafting) |
| Natural affix domain matches base     | every `natural` affix shares the base's domain (§3)                                                                                                                                                                                                           | [Domain](https://www.poewiki.net/wiki/Modifier#Domain)                                                                            |
| Crafted mods within limit             | `crafted_count ≤ crafted_limit`                                                                                                                                                                                                                               | [Crafting Bench](https://www.poewiki.net/wiki/Crafting_Bench)                                                                     |
| Fractured affixes present             | `fractured ⊆ affixes`                                                                                                                                                                                                                                         | [Fractured item](https://www.poewiki.net/wiki/Fractured_item#Mechanics)                                                           |
| Fractures                             | one per [Fracturing Orb](https://www.poewiki.net/wiki/Fracturing_Orb#Mechanics), which refuses a fractured item; the Bestiary recipes likewise, by their own note ([Beastcrafting](https://www.poewiki.net/wiki/Beastcrafting)), the talisman one locking two | [Fracturing Orb](https://www.poewiki.net/wiki/Fracturing_Orb#Mechanics)                                                           |
| At most one veiled placeholder        | Hinekora's restriction: Aisling's two-veiled drops are not modelled                                                                                                                                                                                           | [Veiled Exalted Orb](https://www.poewiki.net/wiki/Veiled_Exalted_Orb) ("cannot be used on an item with a veiled modifier")        |
| Influence limit                       | `influences.count ≤ 2`                                                                                                                                                                                                                                        | [Influenced item](https://www.poewiki.net/wiki/Influenced_item#Mechanics)                                                         |
| Influence excludes fracture           | influenced ⇒ not fractured                                                                                                                                                                                                                                    | [Fractured item](https://www.poewiki.net/wiki/Fractured_item#Mechanics)                                                           |
| Eldritch implicits                    | only on helmets, gloves, boots and body armours of item level 75 or more (the data's level, which the wiki does not name), never beside an influence; the higher tier is dominant                                                                             | [Eldritch implicit modifier](https://www.poewiki.net/wiki/Eldritch_implicit_modifier)                                             |

---

## 9. Catalog-level facts

True of the ingested PoE1 data, and pinned by the catalog-level tests of
`packages/data/src/load.test.ts`:

- **A ladder shares its families.** Every row of a ModType claims the same groups, so a
  modifier named without a tier resolves to its groups from any row.
- The facts of §2 and §5: a ModType is not one side, essence-only rows never roll, and the
  five metamods are the only effect carriers.

---

## 10. The item in the implementation

The checker's abstract state is the implementation's only item: a declared item is a
state with no uncertainty beyond its `"random"` affixes, and the marks of §7 live there
(fracture, veiled state, the influences, corruption and the eldritch implicits, with
the currencies that set them).
The pool reads a projection of it, the facts of §7 a roll depends on: base, level, rarity,
counts, present types and families, tags, active effects (`ItemFacts` in
`packages/core/src/model/item.ts`). There is no concrete item type.
