# Questions for Rick

Decisions and in-game probes only the user can settle. Work never waits on one: each
entry names the assumption the code proceeds under and where it lives, so an answer is a
bounded change. The protocol is in `../CLAUDE.md` (Asking without blocking).

An entry is a **probe** (a rule the wiki does not settle; an item and a few steps in game)
or a **decision** (a design or scope choice). To answer, write under the entry and change
`open` to `answered`; the next session applies it and deletes the entry, and git history
keeps it. New entries continue from Q105.

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
**Probe:** a Strength jewel with one staff modifier, Foulborn Exalted Orbs; exalt jewels
with and without the staff modifier; record the lowest tier of a tag-gated type seen in
each case.
**Assumed:** the count is what can roll on the item now, tags included; the cull keeps
every row some count between the sure and the tag-enabled total would keep. **Encoded
in:** `check/ops.ts` `foulbornTiers`.

### Q20 · probe · open — a fossil's guarantee when another fossil blocks it

**Q:** what does a resonator do when the other fossils block every row a fossil would
force? [Glyphic Fossil § Mechanics](https://www.poewiki.net/wiki/Glyphic_Fossil#Mechanics)
says a Jagged Fossil blocks the chaos-tagged essence modifiers, not what happens when
none is left. No one fossil blocks all four on any base; on boots Corroded, Shuddering
and Jagged together do.
**Probe:** boots, a Prime Chaotic Resonator with Glyphic, Corroded, Shuddering and
Jagged Fossils; resonate; record whether an essence modifier appears, the resonator is
refused, or the item rolls without one.
**Assumed:** the guarantee lapses and no such row rolls. **Encoded in:**
`check/library.ts` `resonatorOps`.

### Q27 · probe · open — what the grove's influence randomise leaves

**Q:** is a two-influence item rerolled to any pair, and may an influence it had come
back? ([Harvest crafting](https://www.poewiki.net/wiki/Harvest_crafting) says only
"randomise".) One player's long run on one-influence items never saw the same influence
return ([forum thread 3158689](https://www.pathofexile.com/forum/view-thread/3158689)).
**Probe:** a two-influence Rare, lifeforce; randomise it several times; record the
influence sets seen.
**Assumed:** the count is kept and any set of that size results, the same one included:
wider than the report, so nothing reachable is ruled out.
**Encoded in:** `check/library.ts` `HARVEST_RANDOMISE`, `check/ops.ts` the `randomise`
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

### Q32 · probe · open — the counts of a corruption reforge, and the altar on a marked item

**Q:** how many affixes does the altar's reforge roll
([Locus of Corruption § Possible outcomes](https://www.poewiki.net/wiki/Locus_of_Corruption#Possible_outcomes)
states no count; players report four to six, or always six), how many on a
jewel, and what does the altar make of an item with an influence
or an eldritch implicit? (The influence is one of the six: GGG, forum thread 2147954.)
**Probe:** a Rare ring, a Rare jewel, an influenced ring, boots with an eldritch
implicit, a ring below item level 68 (reported to get no influence); record each reforge's affix count and marks, and any reforge with two influences.
**Assumed:** the altar four to six, a Vaal Orb six, a jewel three or four without an
influence; an influenced item any one influence or its own; an eldritch implicit kept
beside the new influence; in the cost, each of the six influences
alike. **Encoded in:** `check/library.ts` `locusOps`, `vaalOps`, `brickBranch`;
`cost/track.ts` `byInfluence`.

### Q33 · probe · open — the Tainted Chaos Orb under a protection, and its rarity

**Q:** does its reforge respect a protection?
[Tainted Chaos Orb § Mechanics](https://www.poewiki.net/wiki/Tainted_Chaos_Orb#Mechanics)
names only the fractured modifier as surviving; the
[Metamod table](https://www.poewiki.net/wiki/Metamod#Rules_and_Exceptions) has a row for
the Tainted Exalted Orb only. And what rarity does its strip leave with one fractured
prefix and one fractured suffix? That page says Magic ("the lowest eligible rarity");
[Orb of Scouring](https://www.poewiki.net/wiki/Orb_of_Scouring) says two modifiers stay
Rare.
**Probe:** a corrupted Rare with "Suffixes Cannot Be Changed", and one with a fractured
prefix and a fractured suffix; Tainted Chaos Orbs; apply until each outcome shows; record
whether the suffixes survived, and the second item's rarity when stripped.
**Assumed:** both halves ignore the protection; the strip leaves a scour's rarity, and
with a fractured prefix beside a fractured suffix Magic or Rare, so a second orb is
refused. **Encoded in:** `check/library.ts` `TAINTED_CHAOS`, `unprotect`;
`check/ops.ts` `scouredRarities`.

### Q52 · probe · open — what a Harvest-changed essence, fossil or unveiled modifier becomes

**Q:** which row is it?
[Modifier § Harvest Crafting](https://www.poewiki.net/wiki/Modifier#Harvest_Crafting)
has an Incursion resistance become the other element's Incursion row, and a bench craft
becomes the bench's (seen in game); nothing says it of an essence-only, fossil, unveiled,
elevated or retired row.
**Probe:** a Rare with an unveiled or essence-only fire modifier; change it to cold;
record the cold's values and name.
**Assumed:** the same source's counterpart row or any natural row of the target, above the
item's level too; a
natural row an essence placed on a base that rolls no such modifier becomes the row of its
rank, when an essence places that one on the class. **Encoded in:** `check/methods.ts` `harvestChange`.

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
Does the count of an [Eldritch Chaos Orb](https://www.poewiki.net/wiki/Eldritch_Chaos_Orb),
which its page does not give, include the side it keeps? What does a base holding five
roll?
**Probe:** a Rare body armour; forty Screaming essences, forty resonators with one fossil,
lifeforce for forty reforges; record how many of each batch left 4, 5 and 6. Boots with
both implicits and three modifiers on the kept side, forty Eldritch Chaos Orbs; record
the rerolled side's counts.
**Assumed:** 8:3:1 for all, the guaranteed modifier and an Eldritch Chaos Orb's kept side
among them (craftofexile's reading); a base holding four (a jewel) or five one fewer or
all at 65:35, craftofexile's reading of
[Orb of Alchemy](https://www.poewiki.net/wiki/Orb_of_Alchemy) for four. **Encoded in:**
[cost.md §2](cost.md#2-how-the-game-rolls); `cost/roll.ts` `countDistribution`,
`countCases`.

### Q60 · probe · open — do two fossils' multipliers add or multiply?

**Q:** [Fossil](https://www.poewiki.net/wiki/Fossil) records the dispute and calls
additive the more accepted theory; how a "fewer" multiplier meets another fossil's
"more" it does not say.
A row must carry both fossils' tags to tell the readings apart: a lightning modifier
under Metallic (lightning) and Prismatic (elemental), a caster one under Aetheric (more)
and Serrated (fewer).
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
empty item ("likely 0-10") open; nor does it say whether `tiers` counts a modifier's
whole ladder or the rows the item level allows.
**Probe:** two empty Rare rings with 100 strands, a Foulborn Exalted and an Exalted Orb;
record strands used per orb. A Rare of item level 30 with 82 strands, Chaos Orbs; record
the lowest resistance tier seen.
**Assumed:** 62 and 16; the whole ladder, which keeps the most tiers; the page's Exalted
Orb rows read one modifier count lower than printed, since recorded orbs used up 33
strands at four modifiers and 38 at five where it gives 32 and 34. **Encoded in:**
`check/library.ts` `FOULBORN_STRANDS`, `EXALT_STRANDS`; `pool/pool.ts`
`topTiersUnderStrands`.

### Q74 · probe · open — Harvest damage modifiers paired by ailment, or with no counterpart

**Q:** the other element's list has no modifier named like these: a jewel's fire damage
with bows (to cold or lightning), added cold or lightning damage with bows (to fire),
cold or lightning damage avoidance (to fire). Does the grove refuse them? And does a modifier that names an ailment become the other element's with
its own ailment? Only "fire damage and chance to ignite" to cold was seen.
**Probe:** an item with one of the first; the grove's damage change to that element; record
the message or the result. A Shaper ring with "adds cold damage against chilled or frozen
enemies"; change it to lightning; record the result.
**Assumed:** the first refused; ignite, freeze and shock exchanged with the element, for
the other five pairs of damage with an ailment's chance and the six of added damage
against ailing enemies, all unobserved. **Encoded in:**
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

### Q80 · probe · open — the bench's 3.29 rerolls

**Q:** what do "Reroll three random modifiers on a Rare item" and "Reroll a random
modifier" keep? [Version 3.29.0](https://www.poewiki.net/wiki/Version_3.29.0) says only
"reroll": does the modifier count hold, may a rerolled modifier land on the other side,
and do the metamods hold?
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
`check/ops.ts` `strippable`.

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
[Crafting Bench](https://www.poewiki.net/wiki/Crafting_Bench) names no item level, and
the wiki's table of bench options gives a required level to the map crafts only; the
crafted rows carry a level in the game's data (the top life craft's is 80).
**Probe:** a ring of item level 10, the bench with its top life craft unlocked; craft it;
record refused or applied.
**Assumed:** applied at any item level, in a step and in the item block. **Encoded in:**
`check/library.ts` `benchOps` (no level check), `check/check.ts` `elaborateItem`.

### Q95 · probe · open — a Tainted Exalted Orb's odds

**Q:** how often does a Tainted Exalted Orb add, and what does it do to a full item?
[Tainted Exalted Orb](https://www.poewiki.net/wiki/Tainted_Exalted_Orb) says only that it
"unpredictably adds or removes a modifier".
**Probe:** corrupted Rares with four modifiers and with six, Tainted Exalted Orbs; apply
one to each; record added or removed, and whether a full item ever comes back unchanged.
**Assumed:** even odds; a full item loses a modifier. **Encoded in:** `cost/track.ts`
`OUTCOME_ODDS`, `ASSUMED_ODDS`.

### Q96 · probe · open — an Orb of Conflict over a wide gap

**Q:** [Orb of Conflict § Mechanics](https://www.poewiki.net/wiki/Orb_of_Conflict#Mechanics)
gives one half at equal tiers, "approximately ±11%" for each tier of difference and one
example, two tiers apart. Does that line hold three and more tiers apart, where five
would leave the side ahead no chance at all?
**Probe:** boots with a Perfect and a Lesser implicit, and with an Exceptional and a
Lesser one, an imprint of each, some fifty Orbs of Conflict a pair; record how often the
higher implicit rises.
**Assumed:** the line carried on, neither side below one in a hundred. **Encoded in:**
`cost/track.ts` `CONFLICT_STEP`, `CONFLICT_FLOOR`, `conflicted`.

### Q98 · probe · open — a cluster jewel's enchantment and its size

**Q:** does each small-passive enchantment belong to cluster jewels of one size?
[Cluster jewel § Mechanics](https://www.poewiki.net/wiki/Cluster_jewel#Mechanics) does not
say; RePoE's list of each size's passives puts every enchantment under one size, and a
[Refracting Fog](https://www.poewiki.net/wiki/Refracting_Fog#Mechanics) rerolls the
enchantment without saying it keeps to the size.
**Probe:** a Small and a Large Cluster Jewel, some twenty Refracting Fogs each; record
whether an enchantment of the other size ever appears.
**Assumed:** one size each; the item block refuses another size's enchantment, so a jewel
a Refracting Fog made otherwise cannot be declared. **Encoded in:** `check/check.ts`
`elaborateItem`; `packages/data/data/poe1/cluster_enchants.json`.

### Q99 · probe · open — how an unveil's three options are drawn

**Q:** [Veiled modifier](https://www.poewiki.net/wiki/Veiled_modifier) says only that
unveiling "presents three random mods", and that their weighting was rebalanced in
3.14.0. Are they drawn by spawn weight without replacement, and may two options share a
modifier group, as two on one item may not?
**Probe:** unveil some thirty body armours with a veiled suffix; record the three options
each time, and whether two of one group (Strength and Dexterity beside Dexterity and
Intelligence) are ever offered together.
**Assumed:** by spawn weight, one at a time, an option closing every modifier that shares
a group with it. **Encoded in:** `cost/roll.ts` `offerSetsOf`.

### Q100 · probe · open — where a copied item's `Corrupted` goes beside `Fractured Item`

**Q:** the advanced copy (Ctrl+Alt+C) of a corrupted Shaper shield has `Corrupted` in its
own section before `Shaper Item`. Does it come before `Fractured Item` too?
**Probe:** a corrupted fractured Rare; copy it with Ctrl+Alt+C; paste it verbatim.
**Assumed:** `Corrupted`, then the influence, then `Fractured Item`. **Encoded in:**
`packages/core/src/render/item.ts` `renderItemText`.

### Q101 · probe · open — an influence's rows: the Harvest change, and tier numbers

**Q:** [Modifier § Harvest Crafting](https://www.poewiki.net/wiki/Modifier#Harvest_Crafting)
says the change keeps the tier. With rows under each of an item's two influences, does a
modifier become the other element's row of its own influence only? Does the tooltip number
each influence's rows and the base's apart, or as one ladder?
**Probe:** change the Redeemer's "physical damage as extra cold" on a Shaper and Redeemer
wand; record the result or refusal. Record the tier shown for "increased maximum Life" on
an Elder and Hunter body armour, the base's "Gain 2 Life per Enemy Hit" on an Elder ring
(assumed 1; 3 as one ladder) and "Minions deal increased Damage" on a Redeemer Bone Ring
(assumed 5 and 3 tiers; 8 as one).
**Assumed:** it stays within its own influence's rows, else refused; a tier counts the rows
of the modifier's own influence, or the base's own.
**Encoded in:** `check/methods.ts` `harvestChange`; `resolve/tiers.ts` `tierLadders`.

### Q102 · probe · open — the tier of two modifiers that share a type and a mod level

**Q:** an Elder amulet's "+1 to maximum number of Skeletons" and "+1 to maximum number of
Raised Zombies" are one modifier type in the data, both of
[mod level](https://www.poewiki.net/wiki/Modifier#Mod_Level) 68; so are a Hunter helmet's
three Conflux modifiers (80) and an abyss jewel's two "Chance to Block Spell Damage if you
were Damaged by a Hit Recently" (1). Which tier does the advanced tooltip show for each?
**Probe:** an Elder amulet with either minion modifier, or a Hunter helmet with a Conflux;
record the tier in the header.
**Assumed:** each is Tier 1 of its own modifier: rows of one level in a ladder share the
number, and a name that words one of them means that one alone. **Encoded in:**
`resolve/tiers.ts` `tiersOf`; `resolve/registry.ts` `rowsNamed`; `check/check.ts`
`rowsOnly`.

### Q103 · decision · open — steps written after a path has ended

**Q:** a step after a top-level `stop` or `restart`, or after either in a loop body, can
never run. Should the checker say so?
**Options:** (a) an error, as an `if` branch that can never run is (recommended: such a
step is a mistake, and its cost and its place in the chart are silently dropped); (b)
leave it unreported.
**Assumed:** (b). **Encoded in:** `check/check.ts` `checkSeq`.

### Q104 · decision · open — a condition wider than the formatter's line

**Q:** `fmt` leaves an `until` or `if` whose condition passes 100 columns on one line; a
`def` of that width is broken before each `or`. Should a statement's condition break the
same way?
**Options:** (a) break before each top-level `or`, then `and`, indented one step, the
`{` on its own line (recommended); (b) leave long conditions to the author, who can name
them with a `def`.
**Assumed:** (b). **Encoded in:** `packages/parser/src/format.ts` `fits`.
