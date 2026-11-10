# Questions for Rick

Decisions and in-game probes only the user can settle. Work never waits on one: each
entry names the assumption the code proceeds under and where it lives, so an answer is a
bounded change. The protocol is in `../CLAUDE.md` (Asking without blocking).

An entry is a **probe** (a rule the wiki does not settle; an item and a few steps in game)
or a **decision** (a design or scope choice). To answer, write under the entry and change
`open` to `answered`; the next session applies it and deletes the entry, and git history
keeps it. New entries continue from Q85.

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

**Q:** what does a resonator do when another fossil blocks every row a fossil would force
(a Glyphic beside a Jagged on a base whose corrupted-essence rows are all chaos-tagged)?
[Glyphic Fossil § Mechanics](https://www.poewiki.net/wiki/Glyphic_Fossil#Mechanics) says
the Jagged blocks them, not what happens when none is left.
**Probe:** Glyphic and Jagged Fossils, a Potent Chaotic Resonator, such a base (check the
ring's four); resonate; record whether an essence modifier appears, the resonator is
refused, or the item rolls without one.
**Assumed:** the guarantee lapses and no such row rolls. **Encoded in:**
`check/library.ts` `resonatorOps`.

### Q21 · probe · open — the Tangled Fossil's fossil-only and essence rows

**Q:** does the Tangled Fossil still roll fossil-only or corrupted-essence modifiers?
[Fossil § Mechanics](https://www.poewiki.net/wiki/Fossil#Mechanics) describes it as a
random "greatly more" and "no" tag since 3.16; the data still lists both.
**Probe:** Tangled Fossils and resonators, any rare base; resonate many times; record
whether either kind ever appears.
**Assumed:** the data's reading, which only widens what may appear; the hover says "may
roll". **Encoded in:** `packages/data/data/poe1/fossils.json`, `resonatorOps`.

### Q22 · probe · open — the Harvest change's tier where the ladders differ

**Q:** [Modifier § Harvest Crafting](https://www.poewiki.net/wiki/Modifier#Harvest_Crafting)
says the craft "preserves the tier", but the elements' ladders are not parallel (fire
resistance's rows at levels 1, 12, 24, …, cold's at 1, 14, 26, …), so "the same tier"
may count the base's whole ladder or the rows the item level allows. And does it take a
Magic item?
**Probe:** a Rare of item level 13 with the level-12 fire resistance, a Magic item with a
fire resistance; change each to cold; record the cold row, and whether the Magic item
took it.
**Assumed:** the target's row at the source's rank where the two ladders match level for
level at the item's level, any of its rows where they do not; any rarity. **Encoded in:**
`check/methods.ts` `harvestChange`.

### Q25 · probe · open — when the grove greys a craft out under a metamod

**Q:** [Harvest crafting § Mechanics](https://www.poewiki.net/wiki/Harvest_crafting#Mechanics)
says only that the added modifier obeys the "Cannot Be Changed" metamods. Three cases on
a Rare with "Prefixes Cannot Be Changed": (a) a life reforge whose only life modifier is
among the protected prefixes; (b) a reforge for a prefix-only tag with three protected
prefixes; (c) an augment whose removal may take a suffix while the prefixes are full.
**Probe:** those three items; open "Reforge … including a Life modifier" for (a) and
(b), "Add a new Defence modifier and remove another random modifier" for (c); record
offered or greyed out, and the outcome.
**Assumed:** refused unless a tagged row can roll on every path after the lock-respecting
strip or the removal. **Encoded in:** `check/library.ts` `harvestReforgeOps`,
`harvestAugmentOps`; `check/ops.ts` `poolNonEmpty`, `sidePairs`, `subsetMods`.

### Q27 · probe · open — what the grove's influence randomise leaves

**Q:** does "Randomise the Influence types" keep the count, can the same influence come
back, and is a two-influence item rerolled to any pair?
([Harvest crafting](https://www.poewiki.net/wiki/Harvest_crafting) says only "randomise".)
**Probe:** a one- and a two-influence Rare, lifeforce; randomise each several times;
record the influence sets seen.
**Assumed:** the count is kept and any set of that size results, the same one included.
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

**Q:** does it (and its five siblings) take a Magic item, and does it draw from the whole
pool or the influence's rows only? [Beastcrafting](https://www.poewiki.net/wiki/Beastcrafting)
does not say.
**Probe:** a Magic and a Rare Hunter item with an open slot, the recipe's beasts; record
accepted or not and the modifiers added over several tries.
**Assumed:** a Rare with an open slot; the whole pool at the beast's level. **Encoded
in:** `check/library.ts` `beastAddInfluenceOps`.

### Q32 · probe · open — the Corruption Altar's influence and a jewel's corrupted reforge

**Q:** which influence does the altar's reforge give
([Locus of Corruption § Possible outcomes](https://www.poewiki.net/wiki/Locus_of_Corruption#Possible_outcomes)
says only "an influenced rare item"), and how many affixes does a corruption reforge roll
on a jewel ([Vaal Orb § Equipment](https://www.poewiki.net/wiki/Vaal_Orb#Equipment) says
six)?
**Probe:** an uninfluenced Rare ring and a Rare jewel, altar access, Vaal Orbs; record
the influences seen and the jewel's affix counts.
**Assumed:** any one influence or the item's own; a jewel reforged without one; six
capped by the base's limit. An item with an eldritch implicit keeps it beside the new
influence (the wide reading); a Gilded Fossil's extra implicit is not modelled.
**Encoded in:** `check/library.ts` `locusOps`, `vaalOps`, `brickBranch`.

### Q33 · probe · open — the Tainted Chaos Orb under a protection

**Q:** does its reforge respect a protection?
[Tainted Chaos Orb § Mechanics](https://www.poewiki.net/wiki/Tainted_Chaos_Orb#Mechanics)
names only the fractured modifier as surviving; the
[Metamod table](https://www.poewiki.net/wiki/Metamod#Rules_and_Exceptions) has a row for
the Tainted Exalted Orb only.
**Probe:** a corrupted Rare with "Suffixes Cannot Be Changed", Tainted Chaos Orbs; apply
until each outcome shows; record whether the suffixes survived either.
**Assumed:** both halves of the orb ignore the protection. **Encoded in:**
`check/library.ts` `TAINTED_CHAOS`, `unprotect`.

### Q41 · probe · open — where a copied item's `Corrupted` goes

**Q:** in the advanced copy (Ctrl+Alt+C), does `Corrupted` come before or after the
influence section on an item with both? No real paste seen has both.
**Probe:** an influenced, corrupted Rare; copy it with Ctrl+Alt+C; paste it verbatim.
**Assumed:** `Corrupted` in its own section, last. **Encoded in:**
`packages/core/src/render/item.ts` `renderItemText`.

### Q52 · probe · open — does a Harvest-changed crafted modifier stay crafted?

**Q:** [Harvest crafting § Mechanics](https://www.poewiki.net/wiki/Harvest_crafting#Mechanics)
does not say; it decides whether "remove crafted modifiers" and the crafted limit reach it.
**Probe:** a Rare with a bench fire resistance and no other crafted modifier; change it
to cold; record whether it shows as crafted and whether the removal takes it.
**Assumed:** it stays crafted. **Encoded in:** `check/ops.ts` `fill` on a `rows` pool
keeps the new rows among `craftedTypes`.

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
**Probe:** a Rare body armour; forty Screaming essences, forty resonators with one fossil,
lifeforce for forty reforges; record how many of each batch left 4, 5 and 6.
**Assumed:** 8:3:1 for all, the guaranteed modifier among them; a base holding four (a
jewel) three or four at 65:35, craftofexile's reading of
[Orb of Alchemy](https://www.poewiki.net/wiki/Orb_of_Alchemy). **Encoded in:**
[cost.md §2](cost.md#2-how-the-game-rolls).

### Q60 · probe · open — do two fossils' multipliers add or multiply?

**Q:** [Fossil](https://www.poewiki.net/wiki/Fossil) records the dispute and calls
additive the more accepted theory.
**Probe:** a Rare ring, a Potent Chaotic Resonator, Pristine and Prismatic Fossils;
resonate many times; record life and elemental modifier counts against the single-fossil
rates.
**Assumed:** additive; when two tags of one fossil match a row, the larger multiplier.
**Encoded in:** [cost.md §2](cost.md#2-how-the-game-rolls).

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

### Q66 · probe · open — the tilt of the "more / less likely" reforge

**Q:** [Harvest crafting](https://www.poewiki.net/wiki/Harvest_crafting) states no
factor; craftofexile multiplies the rows sharing a type with the item's by ten or a tenth.
**Probe:** a Rare ring with one life modifier and no other life-typed one, 8000 Wild
Crystallised Lifeforce; "more likely" forty times; record the share of rolls with a life
modifier against the plain reforge's.
**Assumed:** ten and a tenth; the checker reads it as a plain reforge. **Encoded in:**
`cost/roll.ts` `LIKELY_FACTOR`, `check/library.ts` `harvestLikelyOps`.

### Q68 · probe · open — the memory strands where the wiki is blank

**Q:** [Memory strand § Crafting methods consuming memory strands](https://www.poewiki.net/wiki/Memory_strand#Crafting_methods_consuming_memory_strands)
leaves the Foulborn Exalted Orb below five modifiers ("0-?") and an Exalted Orb on an
empty item ("likely 0-10") open; nor does it say whether the Foulborn cut and the strand
cut apply together, whether a strandless fill (Harvest, Bestiary, resonator) is cut, or
whether `tiers` counts the whole ladder or the item level's.
**Probe:** two empty Rare rings with 100 strands, a Foulborn Exalted and an Exalted Orb;
a third with 82 strands and a Foulborn Exalted Orb; record strands used per orb and the
tier the third gets.
**Assumed:** 62 and 10; both cuts apply; only strand-using fills are cut; `tiers` is the
whole ladder. **Encoded in:** `check/library.ts` `FOULBORN_STRANDS`, `EXALT_STRANDS`;
`check/ops.ts` `foulbornTiers`, `Rules.strands`; `pool/pool.ts`.

### Q74 · probe · open — penetration and the reported refusals of the Harvest change

**Q:** does the damage change take a penetration modifier, and does the grove refuse a
damage over time multiplier and, for the resistance change, a resistance shared with
chaos, as players report? The wiki names neither.
**Probe:** Rares with fire penetration, a fire damage over time multiplier, and fire and
chaos resistance; the grove's fire-to-cold damage and resistance changes; record which it
offers.
**Assumed:** penetration taken; the multiplier and the hybrid refused (a refusal only
makes the checker stricter). **Encoded in:** `check/methods.ts` `elementalKind`.

### Q76 · probe · open — the side of a Veiled Exalted Orb's veiled modifier

**Q:** which side does it land on when both have room?
[Veiled Exalted Orb](https://www.poewiki.net/wiki/Veiled_Exalted_Orb) says only "adds a
random veiled modifier", and the two placeholders carry no spawn weight in the wiki's
data.
**Probe:** Veiled Exalted Orbs, Rares with two prefixes and two suffixes; apply one to
each; record how many veiled prefixes and veiled suffixes come up.
**Assumed:** the sides with room alike, half each. **Encoded in:** `cost/track.ts`
`veiledSides`.

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

### Q81 · probe · open — which implicit an Orb of Conflict raises

**Q:** with both eldritch implicits below Perfect, is each as likely to rise?
[Orb of Conflict § Mechanics](https://www.poewiki.net/wiki/Orb_of_Conflict#Mechanics)
says one rises and the other falls, and play has seen either side picked, not the odds.
**Probe:** gloves with a Greater Exarch and a Greater Eater implicit, Orbs of Conflict,
Lesser embers and ichors to restore them; apply many; record which side rose each time.
**Assumed:** each side alike, half and half. **Encoded in:** `cost/track.ts` `conflicted`.

### Q82 · probe · open — the order of a Harvest augment

**Q:** does a Harvest augment remove before it adds, or add first?
[Harvest crafting](https://www.poewiki.net/wiki/Harvest_crafting) words it "Add a new
Chaos modifier and remove another random modifier". The order decides the added
modifier's pool: a group the removal frees may be drawn again only if it goes first.
**Probe:** a Rare holding the only prefix group with the augment's tag; augment it many
times; record whether one craft ever removes that modifier and adds a new one of its group.
**Assumed:** removal first. **Encoded in:** `check/library.ts` `harvestAugmentOps`,
`cost/track.ts` `outcomesOn`.

### Q83 · probe · open — a scour that would remove nothing

**Q:** does the game refuse an Orb of Scouring when every affix is protected? A fractured
modifier is never removed ([Fractured item](https://www.poewiki.net/wiki/Fractured_item)),
and both "Cannot Be Changed" metamods are respected by the orb
([Metamod § Rules and Exceptions](https://www.poewiki.net/wiki/Metamod#Rules_and_Exceptions)).
**Probe:** a Rare with the multimod and both protection metamods, one without and one
with a fractured modifier; apply a scour to each; record refused or consumed.
**Assumed:** refused, with a fractured modifier or without. **Encoded in:**
`check/ops.ts` `strippable`.

### Q84 · decision · open — what a `restart` leaves the item as

**Q:** the checker takes a `restart` back to its loop's head with the item as it is, like
`continue`; the cost layer takes it as a new attempt from the item the loop was entered
with. They differ wherever the restarted item is not the entry item: in
`until prefixCount <= 2 { annul; if not has "maximum life" { restart } }`, the item as it
is leaves the loop without the life.
**Options:** (a) the item as it is in both, a guide writing `stop` for a lost modifier
(recommended: one meaning, the checker's, which the language doc states); (b) a new
attempt from the loop's entry in both, the checker joining that item into the head.
**Assumed:** the split above; the cost layer cannot follow a `restart` in a loop nested in
another until this is settled. **Encoded in:** `check/check.ts` `restartHeads`,
`cost/chain.ts` `restart`, `cost/report.ts` `chainLoop`.
