# Hinekora: Item Model

> Purpose: the item and modifier vocabulary Hinekora models, for Path of Exile 1. What an
> item is made of, what a modifier is, and which combinations of modifiers may sit on an
> item. This is what the code is audited against; the open decisions are `QUESTIONS.md` Q1–Q4
> and the remaining work is `ROADMAP.md` Step 1.
>
> Game rules are not restated here. Each rule links the section of the Path of Exile wiki
> (poewiki.net) that defines it and the text says only how Hinekora models it; where
> Hinekora narrows a rule the text says so. The wiki is cached locally (`tools/poewiki`).

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

The game keys its data by several families of identifier. They are distinct types in the
code (`model/ids.ts`) because confusing one for another is a category error. Spelling is
read only where this doc says so.

| Type        | What it names                                                                                                                                                                                                                                                                                                                          | Wiki                                                               |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `ModType`   | The tier bucket of a row of the `Mods` table. Rows of one ModType never share an item and share exclusion groups, but a ModType is **not** one ladder: 130 ModTypes have both prefix and suffix rows, rolling on different base classes. The ladder a player sees is the ModType's rows that roll on one base, which the pool defines. | [Mod Level](https://www.poewiki.net/wiki/Modifier#Mod_Level)       |
| `ModFamily` | A mutual-exclusion group.                                                                                                                                                                                                                                                                                                              | [Group/family](https://www.poewiki.net/wiki/Modifier#Group/family) |
| `Tag`       | One type, three roles: a base's tags, the tags a modifier adds to its item, a modifier's own category tags.                                                                                                                                                                                                                            | [Tags](https://www.poewiki.net/wiki/Modifier#Tags)                 |
| `ItemClass` | Spelling read in two places: the four-affix classes and the never-Rare classes (§4).                                                                                                                                                                                                                                                   | [Item class](https://www.poewiki.net/wiki/Item_class)              |
| `ModDomain` | The partition a row or base belongs to (§3).                                                                                                                                                                                                                                                                                           | [Domain](https://www.poewiki.net/wiki/Modifier#Domain)             |

A spawn weight is a number the data ships for every row. `can_roll` is `weight > 0`: zero
discards the modifier.

---

## 3. Enumerations

**Generation**: `prefix | suffix`. Only generation types 1 and 2 occupy affix slots;
intrinsic, corrupted, enchantment and the rest are the implicit layer
([Generation type](https://www.poewiki.net/wiki/Modifier#Generation_type)).

**Rarity**: `normal | magic | rare` ([Rarities](https://www.poewiki.net/wiki/Rarity#Rarities)).

**ModDomain**: by the wiki's numbering, spelled as the data spells them
([Domain](https://www.poewiki.net/wiki/Modifier#Domain)):

| Value              | Wiki # | Carried by                                            |
| ------------------ | ------ | ----------------------------------------------------- |
| `item`             | 1      | ordinary equipment bases and their modifiers          |
| `flask`            | 2      | flasks                                                |
| `crafted`          | 9      | bench crafts (no base)                                |
| `misc`             | 10     | the wiki's "Jewel": ordinary jewels                   |
| `abyss_jewel`      | 13     | abyss jewels                                          |
| `delve`            | 16     | fossil-only modifiers (no base)                       |
| `affliction_jewel` | 21     | cluster jewels                                        |
| `veiled`           | 26     | veiled placeholders (no base)                         |
| `unveiled`         | 28     | unveil results (no base)                              |
| `tincture`         | 34     | tinctures                                             |
| `other`            |        | partitions the ingest keeps but no craftable base has |

**ModSource**: which mechanic places a modifier: `natural | essence | bench | veiled |
fossil | other`. Only `natural` modifiers roll from ordinary currency
([Reforging modifiers](https://www.poewiki.net/wiki/Crafting#Reforging_modifiers)); the rest
arrive through their own mechanic and are exempt from the natural-roll rules in §8. `other`
is a row nothing places: no partition of its own and no weight anywhere. The source is a
reading of the row (§5), never independent data.

**Influence**: `shaper | elder | crusader | hunter | redeemer | warlord`
([Influenced item](https://www.poewiki.net/wiki/Influenced_item#Mechanics)). The data spells
the Conqueror tags by their creatures: hunter = `basilisk`, redeemer = `eyrie`, warlord =
`adjudicator`.

---

## 4. Base

[Rarity § Normal](https://www.poewiki.net/wiki/Rarity#Normal): the item before any affix.
Identity is the game's metadata id; display names collide across hundreds of bases, so a
name resolves a base only when it is unique.

| Field                                            | Meaning                                                                                                                                                                                                                                                                                                |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `name?`                                          | display name                                                                                                                                                                                                                                                                                           |
| `item_class`                                     | the class id                                                                                                                                                                                                                                                                                           |
| `domain`                                         | one of `item`, `flask`, `misc`, `abyss_jewel`, `affliction_jewel`, `tincture` for a craftable base                                                                                                                                                                                                     |
| `tags`                                           | matched against each modifier's spawn table ([spawn weight tag](https://www.poewiki.net/wiki/Modifier#Spawn_weight_tag))                                                                                                                                                                               |
| `prefix_capacity_delta`, `suffix_capacity_delta` | the experimented bases' "maximum prefixes/suffixes allowed" stats, which shift the rarity's per-side limit ([Simplex Amulet](https://www.poewiki.net/wiki/Simplex_Amulet#Mechanics) −2/−1, [Ratcheting Ring](https://www.poewiki.net/wiki/Ratcheting_Ring#Mechanics) −3/+3); zero for every other base |

Derived, per [Rarity § Rare](https://www.poewiki.net/wiki/Rarity#Rare):

- `holds_four`: class in `Jewel`, `AbyssJewel`, `HeistEquipmentWeapon`, `HeistEquipmentTool`,
  `HeistEquipmentUtility`, `HeistEquipmentReward` (jewels, abyss jewels, Rogue's equipment;
  cluster jewels share the `Jewel` class).
- `rare_capable`: class not in `LifeFlask`, `ManaFlask`, `HybridFlask`, `UtilityFlask`,
  `UtilityFlaskCritical`, `Tincture`, `Relic`, `SanctumSpecialRelic`, `AtlasRelic`,
  `AnimalCharm` (flasks, tinctures, relics and charms are never Rare).

---

## 5. Mod

One tier of one modifier: one row of the `Mods` table
([Conditions](https://www.poewiki.net/wiki/Modifier#Conditions)). Identity is the row id.

| Field                 | Meaning                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mod_type`            | the tier bucket (§2)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `families`            | its exclusion groups                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `generation`          | prefix or suffix                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `domain`              | its partition                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `min_level`           | the item level the row needs ([Mod Level](https://www.poewiki.net/wiki/Modifier#Mod_Level))                                                                                                                                                                                                                                                                                                                                                                                                          |
| `adds_tags`           | tags the item gains while this row is on it, the data's `adds_tags` (the wiki does not describe them). The data relies on them: a weapon-specific jewel modifier adds `specific_weapon`, which zeroes every other such modifier's weight. An added tag can also enable a row: the staff jewel modifiers carry a positive weight on `staff` ahead of the zero on `not_int`, so one staff modifier on a Strength jewel lets the others roll; the checker admits such rows for a possibly present adder |
| `category_tags`       | the row's own categories (attack, caster, life...), which fossils, harvest and the cannot-roll metamods select on ([Mod tag](https://www.poewiki.net/wiki/Modifier#Mod_tag)); `implicitTags` in the code                                                                                                                                                                                                                                                                                             |
| `spawn`               | the spawn table in table order: the first entry whose tag the item carries decides, so an early zero disables the row for that tag ([spawn weight tag](https://www.poewiki.net/wiki/Modifier#Spawn_weight_tag))                                                                                                                                                                                                                                                                                      |
| `allowed_classes?`    | absent means unrestricted, which is every ingested row today                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `effects`             | the rule changes this row carries while on the item (§6); empty for every row but the five metamods                                                                                                                                                                                                                                                                                                                                                                                                  |
| `source`              | the placing mechanic (§3)                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `essence_only`        | a row only an essence can place, the data's `is_essence_only` ([Essence § Crafting](https://www.poewiki.net/wiki/Essence#Crafting))                                                                                                                                                                                                                                                                                                                                                                  |
| `name?`, `stat_text?` | display text; absent for internal rows                                                                                                                                                                                                                                                                                                                                                                                                                                                               |

Derived: `is_carrier` (has effects); `is_veiled_placeholder` (domain `veiled`) and
`is_unveiled_result` (domain `unveiled`), since the veiled roles are the partitions.

Rules every row satisfies:

- **Source follows the row.** `essence_only` ⇒ `essence`; else domain `crafted` ⇒ `bench`,
  `veiled`/`unveiled` ⇒ `veiled`, `delve` ⇒ `fossil`; else any positive spawn weight ⇒
  `natural`, none ⇒ `other`. (This is the adapter's `classifySource`.)
- **Essence-only rows never roll**: every spawn weight is zero.
- **Carriers are bench metamods**: in PoE1 every row with effects is a bench craft.

---

## 6. Effects

A change to the crafting rules, active exactly while its carrier is on the item. Effects
are read off the modifiers present, never recorded on the item, so removing the carrier
withdraws its effect with no bookkeeping. Which currency honours which effect is the table
in [Metamod § Rules and Exceptions](https://www.poewiki.net/wiki/Metamod#Rules_and_Exceptions).
Three kinds cover the five real metamods ([Metamod](https://www.poewiki.net/wiki/Metamod)):

| Kind                            | Metamod                               | Effect                                                                                             |
| ------------------------------- | ------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `PoolRestrict(category)`        | Cannot roll Attack / Caster Modifiers | bars rows carrying the category from being added and shields present rows carrying it from removal |
| `ProtectGeneration(generation)` | Prefixes / Suffixes Cannot Be Changed | whatever occupies that side at the time is shielded from removal and reroll                        |
| `CraftedCap(cap)`               | Can have up to 3 Crafted Modifiers    | raises the crafted-mod limit; the highest cap carried wins, never below one                        |

---

## 7. Item

| Field                  | Meaning                                                                                                                                                                                                                        |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `game`                 | the craft's game; this doc states PoE1 rules                                                                                                                                                                                   |
| `base`                 | §4                                                                                                                                                                                                                             |
| `ilvl`                 | fixed when the item is created ([Item level](https://www.poewiki.net/wiki/Item_level))                                                                                                                                         |
| `rarity`               | operations move it; this doc states the limits                                                                                                                                                                                 |
| `influences`           | one normally, two via Awakener's Orb ([Influenced item](https://www.poewiki.net/wiki/Influenced_item#Mechanics)); an influence adds its `<class>_<influence>` tag, which is how influence-exclusive rows join the natural pool |
| `prefixes`, `suffixes` | the affixes; order within a side carries no meaning                                                                                                                                                                            |
| `fractured`            | affixes locked against removal and reroll ([Fractured item](https://www.poewiki.net/wiki/Fractured_item#Mechanics))                                                                                                            |

Derived:

- `affixes`, the counts, `natural_affixes` (source `natural`), `crafted_mods` (source
  `bench`), `veiled_placeholders`.
- `present_types` and `present_families`: the coexistence facts.
- `tags` = `base.tags` ∪ the influence tags ∪ `adds_tags` of every present affix: the set a
  roll matches against.
- `active_effects`: the effects of the modifiers present, collected.

**Affix capacity.** [Rarities](https://www.poewiki.net/wiki/Rarity#Rarities) gives the
per-side limit; an experimented base's stats shift each side; and the two sides together
never exceed twice the rarity's per-side limit, which is what holds a magic Ratcheting Ring
to two suffixes ([Ratcheting Ring](https://www.poewiki.net/wiki/Ratcheting_Ring#Mechanics))
and a magic Simplex Amulet to none ([Simplex Amulet](https://www.poewiki.net/wiki/Simplex_Amulet#Mechanics)).

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

| Rule                                  | Statement                                                                                                                                                                        | Source                                                                                                                            |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Affix side matches generation         | every prefix is a prefix row, every suffix a suffix row                                                                                                                          |                                                                                                                                   |
| Rarity within class ceiling           | Rare ⇒ `base.rare_capable`                                                                                                                                                       | [Rarity § Rare](https://www.poewiki.net/wiki/Rarity#Rare)                                                                         |
| Prefixes / suffixes within capacity   | `prefix_count ≤ prefix_capacity`, `suffix_count ≤ suffix_capacity`                                                                                                               | §7                                                                                                                                |
| Affixes within combined capacity      | `affix_count ≤ max_affixes`                                                                                                                                                      | §7                                                                                                                                |
| Distinct mod types                    | two rows of one tier bucket never share an item                                                                                                                                  |                                                                                                                                   |
| Disjoint families                     | no exclusion group is claimed twice                                                                                                                                              | [Group/family](https://www.poewiki.net/wiki/Modifier#Group/family)                                                                |
| Natural affix tiers within item level | every `natural` affix has `min_level ≤ ilvl`. Essences and the bench place their rows regardless of item level (the essence's own use is gated by item level, an operation rule) | [Mod Level](https://www.poewiki.net/wiki/Modifier#Mod_Level), [Essence § Crafting](https://www.poewiki.net/wiki/Essence#Crafting) |
| Natural affix domain matches base     | every `natural` affix shares the base's domain; bench, unveiled and fossil rows live in partitions no base has and are placed directly                                           | [Domain](https://www.poewiki.net/wiki/Modifier#Domain)                                                                            |
| Crafted mods within limit             | `crafted_count ≤ crafted_limit`                                                                                                                                                  | [Crafting Bench](https://www.poewiki.net/wiki/Crafting_Bench)                                                                     |
| Fractured affixes present             | `fractured ⊆ affixes`                                                                                                                                                            | [Fractured item](https://www.poewiki.net/wiki/Fractured_item#Mechanics)                                                           |
| At most one fracture                  | Hinekora's restriction: the Fracturing Orb refuses an already-fractured item; the wiki's multi-fracture routes are not modelled                                                  | [Fracturing Orb](https://www.poewiki.net/wiki/Fracturing_Orb#Mechanics)                                                           |
| At most one veiled placeholder        | Hinekora's restriction: Aisling's two-veiled drops are not modelled                                                                                                              | [Veiled Exalted Orb](https://www.poewiki.net/wiki/Veiled_Exalted_Orb) ("cannot be used on an item with a veiled modifier")        |
| Influence limit                       | `influences.count ≤ 2`                                                                                                                                                           | [Influenced item](https://www.poewiki.net/wiki/Influenced_item#Mechanics)                                                         |
| Influence excludes fracture           | influenced ⇒ not fractured                                                                                                                                                       | [Fractured item](https://www.poewiki.net/wiki/Fractured_item#Mechanics)                                                           |

---

## 9. Catalog-level facts

Checked against the ingested PoE1 data (12,643 affix rows, 4,561 bases):

- **A ladder shares its families.** Every row of a ModType claims the same groups (true of
  all 4,374 ModTypes), so a modifier named without a tier resolves to its groups from any row.
- **A ModType is not one side.** 130 ModTypes have both prefix and suffix rows; a row's side
  is only defined relative to the base it rolls on.
- **Essence-only rows carry zero weight everywhere** (457 rows).
- **The five metamods are the only effect carriers**, all in domain `crafted`.

---

## 10. The item in the implementation

The checker's abstract state is the implementation's only item: a declared item is a
state with no uncertainty beyond its `"random"` affixes, and the marks of §7 live there
(fracture and veiled state today; influence with its currencies, `ROADMAP.md` Step 4).
The pool reads a projection of it, the facts of §7 a roll depends on: base, level, rarity,
counts, present types and families, tags, active effects (`ItemFacts` in
`packages/core/src/model/item.ts`). There is no concrete item type (`QUESTIONS.md` Q3).
