# Questions for Rick

Decisions and in-game probes only the user can settle. Work never waits on one: each
entry names the assumption the code proceeds under and where it lives, so an answer is a
bounded change. The protocol is in `../CLAUDE.md` (Asking without blocking).

An entry is a **probe** (a rule the wiki does not settle; an item and a few steps in game)
or a **decision** (a design or scope choice). To answer, write under the entry and change
`open` to `answered`; the next session applies it and deletes the entry, and git history
keeps it. New entries continue from Q99.

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

### Q22 · probe · open — the Harvest change's tier where the ladders differ

**Q:** [Modifier § Harvest Crafting](https://www.poewiki.net/wiki/Modifier#Harvest_Crafting)
says the craft "preserves the tier", but the elements' ladders are offset (fire
resistance's rows at levels 1, 12, 24, …, cold's at 1, 14, 26, …): at an item level
between two such rows the source's tier does not roll for the target.
**Probe:** a Rare of item level 13 with the level-12 fire resistance; change it to cold;
record the cold row, or a refusal.
**Assumed:** the target's row at the source's rank where as many rows of each roll at the
item's level; in the window between, any of the target's rows that roll or its row at
the source's rank in the whole ladder. **Encoded in:**
`check/methods.ts` `harvestChange`.

### Q25 · probe · open — when the grove greys a craft out under a metamod

**Q:** [Harvest crafting § Mechanics](https://www.poewiki.net/wiki/Harvest_crafting#Mechanics)
says only that the added modifier obeys the "Cannot Be Changed" metamods. On a Rare with
"Prefixes Cannot Be Changed", is a tagged reforge offered when no tagged modifier can
land: its only life modifier among the protected prefixes, or a prefix-only tag beside
three protected prefixes?
**Probe:** those two items; open "Reforge … including a Life modifier" on each; record
offered or greyed out, and the outcome.
**Assumed:** refused unless a tagged row can roll on every path after the
protection-respecting strip. **Encoded in:** `check/library.ts` `harvestReforgeOps`;
`check/ops.ts` `poolNonEmpty`, `sidePairs`, `subsetMods`.

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

### Q29 · probe · open — the grove's influence crafts under the metamods

**Q:** [Metamod § Rules and Exceptions](https://www.poewiki.net/wiki/Metamod#Rules_and_Exceptions)
says the randomise is prevented when a protected side holds an influenced modifier, marks
it "Unknown" under the cannot-roll metamods, and has no row for the influence reforge.
**Probe:** an influenced Rare with "Prefixes Cannot Be Changed" and an influenced prefix,
one with "Cannot roll Attack Modifiers"; open both crafts on each; record offered or
greyed out, and what survives.
**Assumed:** the randomise is refused when a protected side may hold an influence
modifier, and the cannot-roll metamods do not touch it; the influence reforge behaves as
the tagged reforges. **Encoded in:** `check/ops.ts` `noInfluencedOnProtected`,
`check/library.ts` `HARVEST_INFLUENCE_REFORGE`.

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
says "random affix modifiers"; only the Vaal Orb's six is stated,
[Vaal Orb § Equipment](https://www.poewiki.net/wiki/Vaal_Orb#Equipment)), how many does
either roll on a jewel, and what does the altar's reforge make of an item that already
has an influence or an eldritch implicit? (The influence is one of the six: GGG, forum
thread 2147954.)
**Probe:** a Rare ring, a Rare jewel, an influenced ring and boots with an eldritch
implicit, altar access, Vaal Orbs; record each reforge's affix count and marks.
**Assumed:** the altar four to six, a Vaal Orb six, a jewel three or four without an
influence; an influenced item any one influence or its own; an eldritch implicit kept
beside the new influence (the wide reading); in the cost, each of the six influences
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

### Q41 · probe · open — where a copied item's `Corrupted` goes

**Q:** in the advanced copy (Ctrl+Alt+C), does `Corrupted` come before or after the
influence section on an item with both? No real paste seen has both.
**Probe:** an influenced, corrupted Rare; copy it with Ctrl+Alt+C; paste it verbatim.
**Assumed:** `Corrupted` in its own section, last. **Encoded in:**
`packages/core/src/render/item.ts` `renderItemText`.

### Q52 · probe · open — what a Harvest-changed crafted modifier becomes

**Q:** does it stay crafted, and which row is it?
[Harvest crafting § Mechanics](https://www.poewiki.net/wiki/Harvest_crafting#Mechanics)
does not say; it decides whether "remove crafted modifiers" and the crafted limit reach
it. [Modifier § Harvest Crafting](https://www.poewiki.net/wiki/Modifier#Harvest_Crafting)
has an Incursion resistance become the other element's Incursion row, and says nothing of
a bench, essence, fossil, unveiled, elevated or retired row.
**Probe:** a Rare with a bench fire resistance and no other crafted modifier; change it
to cold; record the cold's values, whether it shows as crafted and whether the removal
takes it.
**Assumed:** it stays crafted; it is the same source's counterpart row or any natural row
of the target. **Encoded in:** `check/ops.ts` `fill` on a `rows` pool keeps the new rows
among `craftedTypes`; `check/methods.ts` `harvestChange`.

### Q58 · probe · open — one or two modifiers from a transmute or an alteration

**Q:** [Orb of Transmutation § Spending](https://www.poewiki.net/wiki/Orb_of_Transmutation#Spending)
says "a prefix, suffix, or both" with no ratio.
**Probe:** fifty Orbs of Transmutation on Normal rings, or fifty Alterations on a Magic
ring; record the counts with one modifier and with two.
**Assumed:** one half each, a single modifier's side by the sides' weight shares.
**Encoded in:** [cost.md §2](cost.md#2-how-the-game-rolls).

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
recipes, Dominance). **Encoded in:** [cost.md §2](cost.md#2-how-the-game-rolls).

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

### Q74 · probe · open — which listed modifiers the Harvest damage change takes

**Q:** the game's list for the damage change is not the whole filter: it names the
critical strike multipliers, which the grove refuses. It names the fire and cold damage
over time multipliers too; one player reports the grove taking one, another refusing it.
And what does a listed modifier with no like-named counterpart become (increased fire
damage with a chance to ignite)?
**Probe:** Rares with a fire damage over time multiplier and with the fire damage and
ignite chance hybrid; the grove's fire-to-cold damage change; record offered or not, and
the result.
**Assumed:** the multipliers refused, the safe side; a modifier with no counterpart
refused. **Encoded in:** `check/methods.ts` `harvestChange`, `listedButRefused`;
`resolve/registry.ts` `harvestChangeTarget`;
`packages/data/data/poe1/harvest_change.json`.

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

### Q88 · probe · open — the Harvest damage change on increased elemental damage

**Q:** players report "There are no valid Mods for this craft on this item" for a listed
increased elemental damage modifier on a wand, a sceptre, jewels and shields, and others
the same craft working on a staff and a sceptre (reddit 1romglx, 1rr0jyz; forum thread
3916613). What beyond the game's list decides it?
**Probe:** a wand, a sceptre, a jewel and a shield, each with one increased fire damage
modifier; the grove's fire-to-cold damage change on each; record offered or the message.
**Assumed:** taken on every base where the counterpart rolls, as listed. **Encoded in:**
`check/methods.ts` `harvestChange`.

### Q89 · probe · open — the order of a Harvest augment's add and removal

**Q:** does the grove add the tagged modifier before it removes another, so that the item
as it stands needs a slot the modifier fits?
[Harvest crafting](https://www.poewiki.net/wiki/Harvest_crafting) does not say; the order
rests on a refusal seen in game on an amulet with full suffixes (reddit 1chjx6g) and on
[Maxroll's Harvest guide](https://maxroll.gg/poe/crafting/harvest-crafting-guide).
**Probe:** a Rare with three prefixes whose only modifiers of some tag are prefixes; open
that tag's augment in the grove; record offered or greyed out (a refusal costs nothing).
**Assumed:** added first: refused without an open slot one of the tag's rows fits.
**Encoded in:** `check/library.ts` `harvestAugmentOps`.

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

### Q97 · decision · open — naming a tier above the item's level

**Q:** a Harvest change that keeps the tier may leave a row that does not roll at the
item's level (Q22). `t<n>` numbers the rows that roll at the item's level, so no `t<n>`
names that row: a guide reaches it only as "none of the tiers that roll".
**Options:** (a) leave it: the item card says "above the item's level", and a guide
branches by negation or by value (`has "cold resistance" >= 18`) (recommended: the case
is rare and the numbering keeps one meaning); (b) number tiers over the whole ladder
wherever such a row may be on the item, so `t1` changes meaning with the state; (c) a
word for it, `has "<mod>" above`.
**Assumed:** (a). **Encoded in:** `check/check.ts` `resolveHas`, `render/item.ts`
`modView`.

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
