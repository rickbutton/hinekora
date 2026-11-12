# Questions for Rick

Decisions and in-game probes only the user can settle. Work never waits on one: each
entry names the assumption the code proceeds under and where, so an answer is a bounded
change (`../CLAUDE.md`, Asking without blocking).

An entry is a **probe** (a rule the wiki does not settle; an item and a few steps in game)
or a **decision** (a design or scope choice). To answer, write under the entry and change
`open` to `answered`; the next session applies it and deletes the entry, and git history
keeps it. New entries continue from Q130.

```
### Qn · probe|decision · open — title
**Q:** the question.
**Probe:** what to procure, the steps, what to record.     (probes)
**Options:** (a) … (b) …, the recommendation marked.         (decisions)
**Assumed:** what the code does meanwhile. **Encoded in:** files and symbols.
```

---

### Q17 · probe · open — a Foulborn orb's "eligible tiers"

**Q:** does a tier that only another modifier's tag makes rollable count when that
modifier is on the item? [Foulborn currency § Mechanics](https://www.poewiki.net/wiki/Foulborn_currency#Mechanics)
hedges and says "at the current item level".
**Probe:** Strength jewels with and without a staff modifier, Foulborn Exalted Orbs;
record the lowest tier of a tag-gated type seen on each.
**Assumed:** the count is the type's rows that can roll on the item now, its modifiers'
tags included. **Encoded in:** `check/ops/pools.ts` `foulbornCull`; `model/strands.ts`
`foulbornKept`.

### Q20 · probe · open — a fossil's guarantee when another fossil blocks it

**Q:** what does a resonator do when the other fossils block every row a fossil would
force? [Glyphic Fossil § Mechanics](https://www.poewiki.net/wiki/Glyphic_Fossil#Mechanics)
says a Jagged Fossil blocks the chaos-tagged essence modifiers, not what happens when none
is left (on boots Corroded, Shuddering and Jagged together do).
**Probe:** boots, a Prime Chaotic Resonator with Glyphic, Corroded, Shuddering and
Jagged Fossils; resonate; record whether an essence modifier appears, the resonator is
refused, or the item rolls without one.
**Assumed:** the guarantee lapses and no such row rolls. **Encoded in:**
`check/library.ts` `resonatorOps`.

### Q27 · probe · open — what the grove's influence randomise leaves

**Q:** is a two-influence item rerolled to any pair, and may an influence it had come
back? ([Harvest crafting](https://www.poewiki.net/wiki/Harvest_crafting) says only
"randomise"; [one player](https://www.pathofexile.com/forum/view-thread/3158689) never
saw one return.)
**Probe:** a two-influence Rare, lifeforce; randomise it several times; record the
influence sets seen.
**Assumed:** the count is kept and any set of that size results, the same one included.
**Encoded in:** `check/library.ts` `HARVEST_RANDOMISE`, `check/ops/types.ts` the `randomise`
change.

### Q30 · probe · open — the Bestiary's "Add a Mod to a Hunter Item"

**Q:** does it (and its five siblings) take a Magic item?
[Beastcrafting](https://www.poewiki.net/wiki/Beastcrafting) does not say;
[Maxroll](https://maxroll.gg/poe/crafting/beastcrafting) calls it "functionally the same
as an Exalted Orb", which takes a Rare only.
**Probe:** a Magic Hunter item with an open slot, the recipe's beasts; record accepted or
not.
**Assumed:** a Rare with an open slot. **Encoded in:** `check/library.ts`
`beastAddInfluenceOps`.

### Q32 · probe · open — the Corruption Altar

**Q:** [§ Incursion and Atziri](https://www.poewiki.net/wiki/Version_3.30.0#Incursion_and_Atziri):
the altar corrupts "an Equipment Item" a second time, and a twice-corrupted item "cannot
[be] Corrupted further using these devices". Does it take an uncorrupted item, or a jewel
(the pre-3.30 Locus of Corruption page lists jewels)? How likely is each outcome? May its
implicit replace an eldritch one? Does the copy (Ctrl+Alt+C) show `Twice Corrupted`
alone? Does a twice-corrupted item take the Tainted currency or an unveil? No source says.
**Probe:** corrupted Rares, a jewel, boots with an eldritch and a Vaal implicit, an
uncorrupted ring; the altar some forty times; then a Tainted Exalted Orb and an unveil on
a twice-corrupted item; record refusals, outcomes, which implicit went, the copy.
**Assumed:** corrupted equipment only, no jewel; 1:1:2 to no change, an implicit,
destroyed; either eldritch implicit may go; `Twice Corrupted` alone; a twice-corrupted
item takes nothing. **Encoded in:** `check/library.ts` `locusOps`, `onceCorrupted`;
`cost/track.ts`; `render/item.ts`.

### Q33 · probe · open — the Tainted Chaos Orb under a protection, and its rarity

**Q:** does its reforge respect a protection?
[Tainted Chaos Orb § Mechanics](https://www.poewiki.net/wiki/Tainted_Chaos_Orb#Mechanics)
names only the fractured modifier as surviving. What rarity does its strip leave with a
fractured prefix and a fractured suffix: Magic ("the lowest eligible rarity"), or Rare, as
[Orb of Scouring](https://www.poewiki.net/wiki/Orb_of_Scouring) has two modifiers?
**Probe:** a corrupted Rare with "Suffixes Cannot Be Changed", and one with a fractured
prefix and a fractured suffix; Tainted Chaos Orbs; apply until each outcome shows; record
whether the suffixes survived, and the second item's rarity when stripped.
**Assumed:** both halves ignore the protection; the strip leaves a scour's rarity, and
with a fractured prefix beside a fractured suffix Magic or Rare, so a second orb is
refused. **Encoded in:** `check/library.ts` `TAINTED_CHAOS`, `unprotect`;
`check/ops/marks.ts` `LOWEST`; `check/reference/ops/marks.ts` `lowestRarity`.

### Q52 · probe · open — what a Harvest-changed essence, fossil or unveiled modifier becomes

**Q:** which row is it?
[Modifier § Harvest Crafting](https://www.poewiki.net/wiki/Modifier#Harvest_Crafting)
has an Incursion resistance become the other element's Incursion row, a bench craft the
bench's (seen); nothing covers an essence-only, fossil, unveiled, elevated or retired row.
**Probe:** a Rare with an unveiled or essence-only fire modifier; change it to cold;
record the cold's values and name.
**Assumed:** the same source's counterpart row or any natural row of the target, above the
item's level too; a
natural row an essence placed on a base that rolls no such modifier becomes the row of its
rank, when an essence places that one on the class; a counterpart the base gives no
weight (a bow's unveiled cold damage over time multiplier) is none, so that change is
refused. **Encoded in:** `check/methods.ts` `harvestChange`, `isTwinOn`.

### Q58 · probe · open — one or two modifiers from a transmute or an alteration

**Q:** [Orb of Transmutation § Spending](https://www.poewiki.net/wiki/Orb_of_Transmutation#Spending)
says "a prefix, suffix, or both" with no ratio.
**Probe:** fifty Orbs of Transmutation on Normal rings, or fifty Alterations on a Magic
ring; record the counts with one modifier and with two.
**Assumed:** one half each, a single modifier's side by the sides' weight shares.
**Encoded in:** [cost.md §2](cost.md#2-how-the-game-rolls); the site's weights figure
(`site/.vitepress/theme/how.data.ts`).

### Q59 · probe · open — the modifier count of the Chaos-like reforges

**Q:** do essences, resonators, Harvest reforges and the Veiled Chaos Orb lay down 4, 5 or
6 modifiers at the [Chaos Orb's](https://www.poewiki.net/wiki/Chaos_Orb#Mechanics) 8:3:1?
Does an [Eldritch Chaos Orb's](https://www.poewiki.net/wiki/Eldritch_Chaos_Orb) count
include the side it keeps? What does a base holding five roll?
**Probe:** a Rare body armour; forty each of Screaming essences, one-fossil resonators and
Harvest reforges; record the counts. Boots with both implicits and three modifiers on the
kept side, forty Eldritch Chaos Orbs; record the rerolled side's counts.
**Assumed:** 8:3:1 for all, the guaranteed modifier and an Eldritch Chaos Orb's kept side
among them (craftofexile's reading); a base holding four (a jewel) or five one fewer or
all at 65:35, craftofexile's reading of
[Orb of Alchemy](https://www.poewiki.net/wiki/Orb_of_Alchemy) for four. **Encoded in:**
[cost.md §2](cost.md#2-how-the-game-rolls); `cost/roll.ts` `countDistribution`,
`countCases`.

### Q60 · probe · open — do two fossils' multipliers add or multiply?

**Q:** [Fossil](https://www.poewiki.net/wiki/Fossil) calls additive the more accepted
theory, and does not say how a "fewer" multiplier meets another fossil's "more". A row
carrying both fossils' tags tells them apart: lightning under Metallic and Prismatic,
caster under Aetheric (more) and Serrated (fewer).
**Probe:** an Iron Ring of item level 84 or more, a Potent Chaotic Resonator, Metallic and
Prismatic Fossils; resonate forty times; record how many results hold a lightning
modifier. A wand, Aetheric and Serrated Fossils, forty times; record how many hold a
caster modifier.
**Assumed:** "more" additive; when two tags of one fossil match a row, the larger "more"
(the page's "each fossil only affects a modifier once", kept for "more" only); every
"fewer" that matches multiplies that sum, craftofexile's reading.
**Encoded in:** [cost.md §2](cost.md#2-how-the-game-rolls); `cost/roll.ts` `poolRows`.

### Q61 · probe · open — is an annulment uniform?

**Q:** [Orb of Annulment](https://www.poewiki.net/wiki/Orb_of_Annulment) says "a random
modifier".
**Probe:** Rares with a T1 life beside a T1 movement speed, Orbs of Annulment; record which
modifier went, per try.
**Assumed:** uniform, for every random removal (Veiled Exalted, Harvest augment, beast
recipes, Dominance), and for which other modifier an Orb of Dominance raises
([§ Mechanics](https://www.poewiki.net/wiki/Orb_of_Dominance#Mechanics): "randomly").
**Encoded in:** [cost.md §2](cost.md#2-how-the-game-rolls); `cost/track.ts` `dominated`.

### Q63 · probe · open — the Harvest tagged reforge's draw

**Q:** which tagged row does "reforge including a <tag> modifier" place, and is the rest
a plain Chaos roll? [Harvest crafting](https://www.poewiki.net/wiki/Harvest_crafting)
guarantees one tagged modifier and no more.
**Probe:** a Rare ring, lifeforce for forty life reforges; record the life modifiers'
frequencies against their weights, and the total counts.
**Assumed:** one tag row by weight, placed first, the rest drawn as a Chaos Orb draws.
**Encoded in:** [cost.md §2](cost.md#2-how-the-game-rolls), §5.

### Q68 · probe · open — the memory strands where the wiki is blank

**Q:** [Memory strand § Crafting methods consuming memory strands](https://www.poewiki.net/wiki/Memory_strand#Crafting_methods_consuming_memory_strands)
leaves the Foulborn Exalted Orb below five modifiers ("0-?") and an Exalted Orb on an
empty item ("likely 0-10") open, and whether `tiers` counts the whole ladder or the rows
the item level allows.
**Probe:** two empty Rare rings with 100 strands, a Foulborn Exalted and an Exalted Orb;
record strands used per orb. A Rare of item level 30 with 82 strands, Chaos Orbs; record
the lowest resistance tier seen.
**Assumed:** 62 and 16; the whole ladder, which keeps the most tiers; the page's Exalted
Orb rows read one modifier count lower than printed, since recorded orbs used up 33
strands at four modifiers and 38 at five where it gives 32 and 34. **Encoded in:**
`check/library.ts` `FOULBORN_STRANDS`, `EXALT_STRANDS`; `pool/pool.ts`
`topTiersUnderStrands`.

### Q74 · probe · open — Harvest damage modifiers paired by ailment, or with no counterpart

**Q:** the other element's list has no counterpart of a jewel's fire damage with bows (to
cold or lightning), added cold or lightning damage with bows (to fire), or cold or
lightning damage avoidance (to fire). Does the grove refuse them? Does a modifier naming an
ailment take the other element's ailment? Only "fire damage and chance to ignite" to cold
was seen.
**Probe:** an item with one of the first; the grove's damage change to that element; record
the message or the result. A Shaper ring with "adds cold damage against chilled or frozen
enemies"; change it to lightning; record the result.
**Assumed:** the first refused; ignite, freeze and shock exchanged with the element, for
the five other pairs and the six of added damage against ailing enemies. **Encoded in:**
`packages/data/scripts/ingest-harvest-change.mjs` `NO_COUNTERPART`, `AILMENT`.

### Q76 · probe · open — the side of a veiled orb's veiled modifier

**Q:** which side does it land on when both have room?
[Veiled Exalted Orb](https://www.poewiki.net/wiki/Veiled_Exalted_Orb) says only "adds a
random veiled modifier", and the two placeholders carry no spawn weight in the wiki's
data.
**Probe:** Veiled Exalted Orbs, Rares with two prefixes and two suffixes; apply one to
each; record how many veiled prefixes and veiled suffixes come up.
**Assumed:** the sides with room alike, half each, for a Veiled Chaos Orb's too.
**Encoded in:** `cost/track.ts` `veiledSides`, `cost/roll.ts` `poolRows`.

### Q80 · probe · open — the bench's rerolls

**Q:** what do "Reroll three random modifiers on a Rare item" and "Reroll a random
modifier" keep? [Version 3.29.0](https://www.poewiki.net/wiki/Version_3.29.0) says only
"reroll": does the modifier count hold, and may a rerolled modifier land on the other side?
[Version 3.30.0](https://www.poewiki.net/wiki/Version_3.30.0#Bug_Fixes) has them respect "some meta-crafted Modifiers": which?
**Probe:** a Rare with six modifiers, one with "Prefixes Cannot Be Changed", one with a
prefix and a suffix; reroll three on the first two and one on the third, several times;
record the prefix and suffix counts before and after, and whether a protected prefix or
the metamod changed.
**Assumed:** not built (deferred, `operations.md` §3.2); when built, `remove(unlocked ∖
protected, k); fill(natural, k)`: the count kept, the side free, the metamods respected.
**Encoded in:** nothing yet.

### Q83 · probe · open — a scour that would remove nothing

**Q:** does the game refuse an Orb of Scouring when every affix is protected? A fractured
modifier is never removed ([Fractured item](https://www.poewiki.net/wiki/Fractured_item)),
and both "Cannot Be Changed" metamods are respected by the orb
([Metamod § Rules and Exceptions](https://www.poewiki.net/wiki/Metamod#Rules_and_Exceptions)).
**Probe:** a Rare with the multimod and both protection metamods, one without and one
with a fractured modifier; apply a scour to each; record refused or consumed.
**Assumed:** refused, with a fractured modifier or without. **Encoded in:**
`check/ops/types.ts` `strippable`.

### Q85 · probe · open — a bench craft on a Normal item

**Q:** does the bench craft a modifier onto a Normal item, making it Magic?
[Crafting Bench § Using the crafting bench](https://www.poewiki.net/wiki/Crafting_Bench#Using_the_crafting_bench)
asks only for an open slot of the modifier's side and names Magic and Rare items.
**Probe:** a Normal ring, the bench; craft any modifier; record refused, or the item's
rarity afterwards.
**Assumed:** refused: a Normal item has no slot. **Encoded in:** `check/library.ts`
`benchOps`, its `openSlot`.

### Q86 · probe · open — the item level an ember or ichor needs

**Q:** does an Eldritch Ember or Ichor refuse an item below some item level? Neither
[Lesser Eldritch Ember](https://www.poewiki.net/wiki/Lesser_Eldritch_Ember) nor
[Eldritch implicit modifier](https://www.poewiki.net/wiki/Eldritch_implicit_modifier)
names one; every implicit row's required level in the data is 75.
**Probe:** boots of item level 70 and a Lesser Eldritch Ember; apply it; record refused or
applied.
**Assumed:** refused below item level 75, in a step and in the item block. **Encoded in:**
`model/marks.ts` `ELDRITCH_ITEM_LEVEL`.

### Q87 · probe · open — the item level a bench craft needs

**Q:** does the bench refuse a craft on an item below the crafted modifier's level?
[Crafting Bench](https://www.poewiki.net/wiki/Crafting_Bench) names none; the crafted rows
carry one in the game's data (the top life craft's is 80).
**Probe:** a ring of item level 10, the bench with its top life craft unlocked; craft it;
record refused or applied.
**Assumed:** applied at any item level, in a step and in the item block. **Encoded in:**
`check/library.ts` `benchOps` (no level check), `check/item-block.ts` `declareItem`.

### Q95 · probe · open — a Tainted Exalted Orb's odds

**Q:** how often does a Tainted Exalted Orb add, and what does it do to a full item?
[Tainted Exalted Orb](https://www.poewiki.net/wiki/Tainted_Exalted_Orb) says only that it
"unpredictably adds or removes a modifier".
**Probe:** corrupted Rares with four modifiers and with six, Tainted Exalted Orbs; apply
one to each; record added or removed, and whether a full item ever comes back unchanged.
**Assumed:** even odds; a full item loses a modifier. **Encoded in:** `cost/track.ts`
`OUTCOME_ODDS`, `ASSUMED_ODDS`; `check/reference/ops/fill.ts`; `check/library.ts`
`TAINTED_EXALT`.

### Q96 · probe · open — an Orb of Conflict over a wide gap

**Q:** [Orb of Conflict § Mechanics](https://www.poewiki.net/wiki/Orb_of_Conflict#Mechanics)
gives one half at equal tiers and "approximately ±11%" a tier of difference, with one
example two tiers apart. Does the line hold further apart, where five tiers leave no chance?
**Probe:** boots with a Perfect and a Lesser implicit, and with an Exceptional and a
Lesser one, an imprint of each, some fifty Orbs of Conflict a pair; record how often the
higher implicit rises.
Record also whether the orb works on a Perfect implicit, and whether the other side drops
when the Perfect one is chosen to rise.
**Assumed:** the line carried on, neither side below one in a hundred; a Perfect stays
and the other drops. **Encoded in:** `cost/track.ts` `CONFLICT_STEP`, `CONFLICT_FLOOR`,
`conflicted`; `check/ops/marks.ts`.

### Q98 · probe · open — a cluster jewel's enchantment and its size

**Q:** does each small-passive enchantment belong to cluster jewels of one size?
[Cluster jewel § Mechanics](https://www.poewiki.net/wiki/Cluster_jewel#Mechanics) does not
say; RePoE's list of each size's passives puts every enchantment under one size, and a
[Refracting Fog](https://www.poewiki.net/wiki/Refracting_Fog#Mechanics) rerolls the
enchantment without saying it keeps to the size.
**Probe:** a Small and a Large Cluster Jewel, some twenty Refracting Fogs each; record
whether an enchantment of the other size ever appears.
**Assumed:** one size each; the item block refuses another size's enchantment, so a jewel
a Refracting Fog made otherwise cannot be declared. **Encoded in:** `check/item-block.ts`
`declareItem`; `packages/data/data/poe1/cluster_enchants.json`.

### Q99 · probe · open — how an unveil's three options are drawn

**Q:** [Veiled modifier](https://www.poewiki.net/wiki/Veiled_modifier) says only that
unveiling "presents three random mods". Are they drawn by spawn weight without
replacement, and may two options share a modifier group?
**Probe:** unveil some thirty body armours with a veiled suffix; record the three options
each time, and whether two of one group (Strength and Dexterity beside Dexterity and
Intelligence) are ever offered together.
**Assumed:** by spawn weight, one at a time, an option closing every modifier that shares
a group with it; so a named result is sure only among three or fewer, none sharing its
group. **Encoded in:** `cost/roll.ts` `offerSetsOf`; `check/ops/crafted.ts`.

### Q100 · probe · open — where a copied item's `Corrupted` goes beside `Fractured Item`

**Q:** the advanced copy (Ctrl+Alt+C) of a corrupted Shaper shield has `Corrupted` in its
own section before `Shaper Item`. Does it come before `Fractured Item` too?
**Probe:** a corrupted fractured Rare; copy it with Ctrl+Alt+C; paste it verbatim.
**Assumed:** `Corrupted`, then the influence, then `Fractured Item`. **Encoded in:**
`packages/core/src/render/item.ts` `renderItemText`.

### Q101 · probe · open — an influence's rows: the Harvest change, and tier numbers

**Q:** [Modifier § Harvest Crafting](https://www.poewiki.net/wiki/Modifier#Harvest_Crafting)
keeps the tier. Under two influences, does a modifier become the other element's row of
its own influence only? Does the tooltip number each influence's rows and the base's apart?
**Probe:** change the Redeemer's "physical damage as extra cold" on a Shaper and Redeemer
wand; record the result or refusal. Record the tier shown for "increased maximum Life" on
an Elder and Hunter body armour, the base's "Gain 2 Life per Enemy Hit" on an Elder ring
(assumed 1; 3 as one ladder) and "Minions deal increased Damage" on a Redeemer Bone Ring
(assumed 5 and 3 tiers; 8 as one).
**Assumed:** it stays within its own influence's rows, else refused; a tier counts the rows
of the modifier's own influence, or the base's own.
**Encoded in:** `check/methods.ts` `harvestChange`; `resolve/tiers.ts` `tierLadders`.

### Q102 · probe · open — the tier of two modifiers that share a type and a mod level

**Q:** an Elder amulet's "+1 to maximum number of Skeletons" and "… Raised Zombies" are one
modifier type, both of [mod level](https://www.poewiki.net/wiki/Modifier#Mod_Level) 68; so
are a Hunter helmet's three Conflux modifiers (80). Which tier does the advanced tooltip
show for each?
**Probe:** an Elder amulet with either minion modifier, or a Hunter helmet with a Conflux;
record the tier in the header.
**Assumed:** each is Tier 1 of its own modifier: rows of one level in a ladder share the
number, and a name that words one of them means that one alone. **Encoded in:**
`resolve/tiers.ts` `tiersOf`; `resolve/registry.ts` `rowsNamed`; `check/resolve-pred.ts`
`rowsOnly`.

### Q106 · decision · open — a value comparison on a modifier with no number

**Q:** `has "X" >= 5` where the item's row of X has no number in its text (a metamod, a
flag modifier): is the condition false, or an error? [language.md](language.md) §5 says
only that it compares the first number.
**Options:** false whatever the operator, `!=` included, so `not has "X" != 0` holds there
(recommended: nothing compares); or refuse the condition when a row of the modifier has no
number.
**Assumed:** false. **Encoded in:** `check/reference/conditions.ts` `holds`.

### Q107 · probe · open — the multimod and its own three

**Q:** does "Can have up to 3 Crafted Modifiers" count toward the three?
[Metamod](https://www.poewiki.net/wiki/Metamod) and
[Crafting Bench](https://www.poewiki.net/wiki/Crafting_Bench) do not say.
**Probe:** craft the multimod, then bench crafts until the bench refuses; record how many
it took.
**Assumed:** it counts, so two more fit. **Encoded in:** `check/ops/types.ts` `craftedBelowCap`;
`check/reference/item.ts` `craftedLimit`.

### Q108 · probe · open — an Astrolabe Amulet and a fracture

**Q:** the [Astrolabe Amulet](https://www.poewiki.net/wiki/Astrolabe_Amulet) counts as
having every influence. Can it be fractured, as an influenced item cannot?
**Probe:** use a Fracturing Orb on a Rare Astrolabe Amulet with four modifiers; record the
refusal or the result.
**Assumed:** refused, as for any influenced item. **Encoded in:**
`check/reference/wellformed.ts` `violations`; `check/item-block.ts` `declareItem`.

### Q109 · probe · open — which veiled modifier a veiled orb places

**Q:** the data holds a placeholder row per Syndicate member beside the plain veiled prefix
and suffix. [Veiled modifier](https://www.poewiki.net/wiki/Veiled_modifier) says some
veiled modifiers come only from a member's drops; it does not say which a Veiled Chaos
Orb or a Veiled Exalted Orb adds.
**Probe:** use a Veiled Chaos Orb on a Rare ring several times; record each veiled
modifier's name in the advanced tooltip.
**Assumed:** the plain placeholder of its side, never a member's. **Encoded in:**
`check/rows.ts` `candidateRows`.

### Q110 · probe · open — a scour that leaves more than the lower rarity holds

**Q:** an Orb of Scouring leaves a Rare item with one kept modifier Magic. A Magic
[Simplex Amulet](https://www.poewiki.net/wiki/Simplex_Amulet#Mechanics) holds none. What
rarity does the scour leave it?
**Probe:** a Rare Simplex Amulet with "Prefixes Cannot Be Changed" and one prefix; scour;
record the rarity.
**Assumed:** it stays Rare, the next rarity up that holds what is left. **Encoded in:**
`check/ops/marks.ts`; `check/reference/ops/marks.ts`.

### Q111 · decision · open — an item's other implicits

**Q:** a corruption implicit replaces one of an item's implicits
([Vaal Orb § Equipment](https://www.poewiki.net/wiki/Vaal_Orb#Equipment)), the altar's an
earlier one (Q32). The checker knows the eldritch implicits only, so it lets none or one
of them go; on boots with no other implicit a Vaal Orb always takes one.
**Options:** track whether the item has another implicit (from the base, and a mark a
Gilded Fossil sets), which makes the outcome exact (recommended); or keep the wider set.
**Assumed:** the wider set. **Encoded in:** `check/ops/marks.ts`;
`check/reference/ops/marks.ts`.

### Q112 · probe · open — a Chaos Orb's count beside a protected side

**Q:** with "Prefixes Cannot Be Changed", how many modifiers does a reforge add?
[Metamod § Examples](https://www.poewiki.net/wiki/Metamod#Examples) has two kept prefixes
take "1 prefix as well as 0 to 3 suffixes, or add 0 prefix and add 1 to 3 suffixes".
**Probe:** a Rare with two prefixes and the metamod as its only suffix; forty Chaos Orbs,
re-crafting the metamod each time; record each total. The same with no prefix.
**Assumed:** the checker admits both: a modifier is laid, or the total already reaches
the reforge's least; the same for an Eldritch Chaos Orb's kept side. The cost layer reads
four to six. **Encoded in:** `check/reference/ops/fill.ts`, `check/ops/fill.ts`;
`cost/roll.ts` `countCases`.

### Q113 · probe · open — a guaranteed modifier that has no place

**Q:** what does an essence do on a Rare whose fractured modifier shares the group of the
essence's modifier, or a resonator whose forced row meets one?
[Essence § Crafting](https://www.poewiki.net/wiki/Essence#Crafting) and
[Fossil § Mechanics](https://www.poewiki.net/wiki/Fossil#Mechanics) do not say.
**Probe:** a Rare ring with a fractured life modifier and a Screaming Essence of Greed;
record refused, or the modifiers after.
**Assumed:** reforged without the guaranteed modifier. **Encoded in:**
`check/reference/ops/fill.ts`.

### Q114 · probe · open — an orb that adds a modifier when none can roll

**Q:** does the game refuse an Exalted Orb, an Orb of Augmentation or a Regal Orb on an
item with an open slot that no modifier fits?
[Metamod § Examples](https://www.poewiki.net/wiki/Metamod#Examples) has a bow under
"Cannot roll Attack Modifiers" with one prefix left that can roll.
**Probe:** that bow with the prefix on it, an open prefix and full suffixes; an Exalted
Orb; record refused, or used up with no change.
**Assumed:** the checks do not look at the pool; the checker finds no outcome there. **Encoded in:** `check/library.ts`
`currencyOps`; `check/reference/ops/fill.ts`.

### Q115 · probe · open — a Divine Orb on a crafted modifier

**Q:** [Divine Orb § Crafting](https://www.poewiki.net/wiki/Divine_Orb#Crafting) rerolls "all random explicit
modifiers" and excepts fractured ones; it does not name a bench craft.
**Probe:** a Rare with a bench craft of a value range; a Divine Orb; record whether the
crafted value changes.
**Assumed:** it is rerolled. **Encoded in:** `check/reference/ops/misc.ts`.

### Q116 · probe · open — how far a Tainted Divine Teardrop moves a modifier

**Q:** [Tainted Divine Teardrop § Mechanics](https://www.poewiki.net/wiki/Tainted_Divine_Teardrop#Mechanics) stops
at "a tier usually obtainable on that base type". The base's whole ladder, or the rows the
item's level allows? Does a fractured modifier move? Does one that "does nothing" keep its
value?
**Probe:** a corrupted Rare of item level 30 with a top-rollable resistance, one with a
fractured modifier; teardrops; record tiers and values.
**Assumed:** the whole ladder; a fractured modifier moves and stays fractured; an unmoved
value kept, a moved one rolled anew. **Encoded in:** `check/ops/misc.ts`;
`check/reference/ops/misc.ts`.

### Q117 · decision · open — one held imprint

**Q:** an imprint is an item, and a craft may hold several; the checker holds one, and a
new imprint replaces it.
**Options:** one, the latest (recommended: a craft that needs two is refused, never
wrongly accepted); or a stack of imprints.
**Assumed:** one. **Encoded in:** `check/reference/ops/misc.ts`.

### Q118 · probe · open — unveiling a fractured veiled modifier, or one with nothing to offer

**Q:** does a fractured veiled modifier
([Fractured item § How to obtain](https://www.poewiki.net/wiki/Fractured_item#How_to_obtain)) stay fractured when
unveiled? What does unveiling do when every result of its side shares a group with a
modifier on the item?
**Probe:** a dropped item with a fractured veiled modifier; unveil. A jewel whose few
results are each blocked by a modifier on it; unveil; record what happens.
**Assumed:** it stays fractured; with nothing to offer the veiled modifier stays and the
step is accepted. **Encoded in:** `check/reference/ops/crafted.ts`.

### Q119 · probe · open — the Veiled Chaos Orb beside a veiled modifier it would keep

**Q:** is it refused, and does it honour the protections as a Chaos Orb does?
[Metamod § Rules and Exceptions](https://www.poewiki.net/wiki/Metamod#Rules_and_Exceptions) has no row for it.
**Probe:** a Rare with an unveiled prefix and "Prefixes Cannot Be Changed", and one with a
fractured unveiled modifier; a Veiled Chaos Orb on each.
**Assumed:** refused where a veiled or unveiled modifier is fractured or on a protected
side; protections honoured. **Encoded in:** `check/library.ts` `VEILED_CHAOS`;
`check/reference/ops/crafted.ts`.

### Q120 · probe · open — the bench under a metamod, and an Aspect

**Q:** does "Remove Crafted Mods" take a crafted modifier on a protected side? Does
"Cannot roll Attack Modifiers" bar an attack bench craft? Is a beastcrafted Aspect
([Aspect of the Cat](https://www.poewiki.net/wiki/Aspect_of_the_Cat)) a crafted modifier?
**Probe:** a Rare with the multimod, "Prefixes Cannot Be Changed" and a crafted prefix;
remove crafted. A Rare with the cannot-roll metamod; craft an attack modifier. An item with
an Aspect; bench-craft, then remove crafted.
**Assumed:** every unfractured crafted modifier goes; the craft is not barred; an Aspect
is not crafted. **Encoded in:** `check/library.ts` `BENCH_REMOVE`, `benchOps`,
`beastAspectOps`; `check/reference/ops/crafted.ts`.

### Q121 · probe · open — an Orb of Dominance: its order, the item level, the other side

**Q:** [§ Mechanics](https://www.poewiki.net/wiki/Orb_of_Dominance#Mechanics) upgrades one influenced modifier and
removes one other. Which first? Does a tier upgrade below the top ignore the item level?
The elevated energy shield leech on Crusader gloves is a prefix, its top tier a suffix:
with three prefixes, can the orb pick it?
**Probe:** such gloves with one other Crusader suffix; orbs; record what went and what the
other became, and on which side.
**Assumed:** removed first, then one of those left is upgraded, whatever the item level;
a fractured one is out of reach; a modifier whose elevated row has no room is not picked.
**Encoded in:** `check/ops/remove.ts`; `check/reference/ops/remove.ts`.

### Q122 · probe · open — removals beside a metamod

**Q:** [Version 3.30.0](https://www.poewiki.net/wiki/Version_3.30.0#Item_Changes): the
cannot-roll metamods no longer keep "some Currencies that remove Modifiers, such as Orbs
of Annulment" off what they bar. Is the Tainted Exalted Orb among them? Is the Eldritch
Orb of Annulment refused on a protected side, or used up? Under
"Cannot roll Attack Modifiers", [Metamod § Examples](https://www.poewiki.net/wiki/Metamod#Examples)
has the Bestiary's "add prefix remove suffix" add only what can roll even when the suffix
it takes is the metamod: is the prefix added first?
**Probe:** boots, the Exarch dominant, "Prefixes Cannot Be Changed", an Eldritch Orb of
Annulment. A corrupted Rare with the attack metamod and an attack modifier, tainted orbs.
The page's bow, the recipe until it takes the metamod.
**Assumed:** it spares nothing; refused; the suffix goes first, so an attack prefix may
follow. **Encoded in:** `check/library.ts` `eldritchAnnulOps`, `TAINTED_EXALT`,
`beastAddOps`; `check/ops/remove.ts`.

### Q123 · probe · open — the tier of a modifier beside a tag another modifier adds

**Q:** [Modifier § Spawn weight tag](https://www.poewiki.net/wiki/Modifier#Spawn_weight_tag) does not say whether
the tooltip's tier counts rows that roll only under a tag another modifier adds. Does such
a row have a tier, and does it renumber the others?
**Probe:** a Crimson Jewel with a staff modifier and "increased Spell Damage while
wielding a Staff"; record the tier shown, annul the staff modifier, record it again.
**Assumed:** a name and a tier are read on the base and the item's influences alone
([language.md](language.md) §2); a row that rolls only under an added tag has no tier.
**Encoded in:** `check/resolve-pred.ts` `resolveHas`; `check/conditions.ts`.

### Q124 · decision · open — what a `"random"` modifier may be beside the others

**Q:** [language.md](language.md) §1 says "any natural modifier of its side the item could
roll". A modifier a currency could add to the item as declared, or any an item with these
others can hold?
**Options:** as declared (beside "cannot roll attack modifiers" it is never an attack
modifier; a row gated by a tag needs the modifier that adds it); or any the item can hold
(recommended: a bought item's history is unknown, the metamod may have come last).
**Assumed:** as declared, a tag any row of the pool adds read wherever it admits a row.
**Encoded in:** `check/initial.ts` `anonymousRows`.

### Q125 · probe · open — the side of an unveiled modifier

**Q:** is every option an unveil offers of the veiled modifier's own side? [Veiled
modifier](https://www.poewiki.net/wiki/Veiled_modifier) says only that it "presents three
random mods".
**Probe:** unveil some twenty Rare items with a veiled prefix and twenty with a veiled
suffix, on a base that has unveiled rows of both sides; record the side of every option
offered.
**Assumed:** a veiled prefix unveils only to prefixes, a veiled suffix to suffixes. **Encoded in:**
`check/ops/crafted-rows.ts` `unveilRows`; `check/ops/crafted.ts`;
`check/reference/ops/crafted.ts`.

### Q126 · probe · open — the advanced copy of a veiled modifier

**Q:** what header and line does the advanced copy (Ctrl+Alt+C) give a modifier still
veiled? The `mods` Cargo table names the placeholders "Veiled" and "of the Veil";
[Veiled modifier](https://www.poewiki.net/wiki/Veiled_modifier) shows no copy.
**Probe:** a Rare item with one veiled prefix and one veiled suffix (a Veiled Chaos Orb's
output, a Betrayal drop); copy it with Ctrl+Alt+C; record the two headers and the lines
under them, and whether `Veiled` leads the header as it does on an unveiled modifier.
**Assumed:** the header of any affix, `{ Prefix Modifier "Veiled" }`, over the table's
text. **Encoded in:** `render/item.ts` `modHeader`, `textless`.

### Q127 · probe · open — the lifeforce of a Harvest change

**Q:** [Version 3.30.0](https://www.poewiki.net/wiki/Version_3.30.0#Harvest): a change of
a resistance or damage modifier to another element costs "300 Lifeforce of two different
types" (a damage change a Crystallised Rancour besides). Which two, for each pair?
[List of harvest crafting options](https://www.poewiki.net/wiki/List_of_harvest_crafting_options)
still gives 500 of the target's colour.
**Probe:** at the Horticrafting Station, read the cost of each of the six resistance
changes and one damage change.
**Assumed:** the colours of the element left and the element taken, fire Wild, cold Vivid,
lightning Primal, 300 each. **Encoded in:** `cost/prices.ts` `unitCost`.

### Q128 · probe · open — the partial protections

**Q:** [§ Endgame Changes](https://www.poewiki.net/wiki/Version_3.30.0#Endgame_Changes)
adds "1 Prefix Modifier cannot be changed" and its siblings, the kept modifiers chosen at
random each use ([FAQ](https://www.pathofexile.com/forum/view-thread/4013527), ruled). Does
one block what the full protection blocks? Can the Bestiary's metamod recipe craft one?
May the choice fall on a fractured modifier?
Is a Harvest augment's removal chosen for among the modifiers before its add, or after?
Do two on one side keep either count, or both?
**Probe:** "1 Prefix Modifier cannot be changed": an essence; three prefixes, one
fractured, annuls; one prefix, augments until it goes; with "2 Prefix…" too, scours; the
recipe twenty times; record refusals and what went.
**Assumed:** as the full protection; the recipe may craft one; any modifier; after; any
reading. In the cost, each
choice alike, the larger count. **Encoded in:** `check/rules.ts` `partialProtections`;
`check/ops/remove.ts` `partialChoices`; `check/reference/rules.ts`; `cost/roll.ts`.

### Q129 · probe · open — Merrick's Ducat on a Rare Abyss Jewel

**Q:** [Version 3.30.0](https://www.poewiki.net/wiki/Version_3.30.0#Endgame_Changes) lets the ducat be used on an Abyss
Jewel itself. [Merrick's Ducat § Mechanics](https://www.poewiki.net/wiki/Merrick%27s_Ducat#Mechanics)
adds a modifier "like an Exalted Orb", on a jewel holding four a fifth, "either a prefix
or suffix", and corrupts it. May the fifth make three of a side? Does it respect the
metamods?
**Probe:** Rare Abyss Jewels with two prefixes and two suffixes, one with "Prefixes Cannot
Be Changed"; a ducat each, some ten; record the sides after.
**Assumed:** not built (`operations.md` §3.2). **Encoded in:** nothing yet.
