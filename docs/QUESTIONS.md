# Questions for Rick

Decisions and in-game probes only the user can settle. Work never waits on one: each
entry names the assumption the code proceeds under and where it lives, so an answer is a
bounded change. The protocol is in `../CLAUDE.md` (Asking without blocking).

An entry is a **probe** (a rule the wiki does not settle; an item and a few steps in game)
or a **decision** (a design or scope choice). To answer, write under the entry and change
`open` to `answered`; the next session applies it and deletes the entry, and git history
keeps it. New entries continue from Q84.

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

### Q19 · probe · open — how a fossil's own modifiers are admitted

**Q:** do fossil-exclusive rows (the Faceted Fossil's gem levels) join the pool by base
tag like any row? [Fossil § Mechanics](https://www.poewiki.net/wiki/Fossil#Mechanics)
says only that some fossils roll them; the data weighs them by base tag.
**Probe:** a Faceted Fossil and resonators, a weapon and a body armour; resonate each
several times; record the gem-level modifiers seen per base.
**Assumed:** a fossil's row joins when its weight on the base's tags is positive and its
level is within the item's. **Encoded in:** `check/ops.ts`, the `fossil` pool.

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

### Q35 · decision · open — the eldritch implicits' words

**Q:** the surface for eldritch implicits: item block `exarch: grand`, `eater: lesser`;
statements `ember <tier>`, `ichor <tier>`, `eldritch chaos|exalt|annul`, `conflict`;
predicates `exarch [<tier>]`, `eater [<tier>]`, `dominant exarch|eater`; tier words the
game's (`lesser` … `perfect`).
**Options:** (a) as above (recommended); (b) the in-game item names (`lesser ember`);
(c) one `eldritch` family for everything.
**Assumed:** (a). **Encoded in:** `check/methods.ts`, `parser/src/parser.ts`,
`docs/language.md` §1, §3, §5.

### Q37 · probe · open — an Orb of Conflict past a presence implicit's top tier

**Q:** the "presence" implicits have fewer tiers (Unique-presence stops at Exquisite,
Pinnacle-presence at Exceptional); what does raising one at its top give?
[Orb of Conflict § Mechanics](https://www.poewiki.net/wiki/Orb_of_Conflict#Mechanics)
says only that it raises a tier.
**Probe:** gloves with a Pinnacle-presence Exceptional Exarch and a Greater Eater
implicit, Orbs of Conflict; apply until the Exarch rises; record the plain variant,
another Exquisite, or a refusal.
**Assumed:** the implicit keeps its type. **Encoded in:** `check/ops.ts`, the `conflict`
change leaves `eldritchTypes` alone.

### Q40 · decision · open — the formatter's style

**Q:** width 100; item-block fields in a fixed order (`base`, `ilvl`, `rarity`,
`prefixes`, `suffixes`, `influences`, `exarch`, `eater`, `corrupted`) with aligned
values; an `and` under an `or` parenthesised; a body on one line only when written so;
the source's line ending kept. Each is a one-line change.
**Options:** (a) as above (recommended); (b) name the changes.
**Assumed:** (a). **Encoded in:** `packages/parser/src/format.ts`.

### Q41 · probe · open — the text of a copied item

**Q:** the game's Ctrl+Alt+C text, which the wiki does not record: a bench modifier's
header (`{ Master Crafted Prefix Modifier … }` or a plain header with `(crafted)`);
whether `Corrupted` and the influence lines share a section; an eldritch implicit's
header and suffix; the plural `Item Class:` names.
**Probe:** a Rare with a bench, a fractured and an influenced modifier, corrupted; an
armour piece with an Exarch implicit; one item per class; paste each copy verbatim.
**Assumed:** plain headers with `(crafted)`, one marks section, `{ Searing Exarch
Implicit Modifier (Tier: Grand) }` and `(exarch implicit)`, `CLASS_LABEL` with a
camel-case split and an `s`. **Encoded in:** `packages/core/src/render/item.ts`
`renderItemText`.

### Q50 · decision · open — the item after a refused step

**Q:** the game applies none of a refused currency; what state do the later steps see?
**Options:** (a) the untouched item, which cascades (a refused `regal` refuses every
Rare-only step after it, and a loop whose refused `exalt` changes nothing looks endless);
(b) the state the method would have left had its checks held, so a refusal is reported
once (recommended); (c) the state narrowed to where the check holds, then the effect:
most precise, but a narrowing per check kind. (b) is sound up to the first reported
refusal: every effect is monotone, so (b) over-approximates (c).
**Assumed:** (b); the trace shows the item the guide meant. **Encoded in:**
`check/ops.ts` `runMethod`, `check/check.ts`, `operations.md` §2.

### Q51 · decision · open — naming one side's modifier of a shared wording

**Q:** on a wand "increased fire damage" is a caster prefix and a suffix of another
group, and the clash message names it by that wording, so "bench spell damage unless a
caster prefix is there" cannot be written with `has`.
**Options:** (a) a side on the predicate, `has prefix "fire damage"`; (b) a group
predicate, `has group "spell damage"`, exactly the bench's check (recommended); (c) both.
**Assumed:** (b). **Encoded in:** `check/check.ts` `resolveHas`, `check/astate.ts`
`refineHasGroup`, `check/group.test.ts`, `docs/language.md` §5.

### Q52 · probe · open — does a Harvest-changed crafted modifier stay crafted?

**Q:** [Harvest crafting § Mechanics](https://www.poewiki.net/wiki/Harvest_crafting#Mechanics)
does not say; it decides whether "remove crafted modifiers" and the crafted limit reach it.
**Probe:** a Rare with a bench fire resistance and no other crafted modifier; change it
to cold; record whether it shows as crafted and whether the removal takes it.
**Assumed:** it stays crafted. **Encoded in:** `check/ops.ts` `fill` on a `rows` pool
keeps the new rows among `craftedTypes`.

### Q56 · probe · open — how the game reads a generation table

**Q:** the data's `generation_weights` beside each spawn table is read like it: first
matching tag decides, scaling in percent, zero disabling. The only zero in play caps a
Small Cluster Jewel at one notable
([Cluster jewel § Mechanics](https://www.poewiki.net/wiki/Cluster_jewel#Mechanics)).
**Probe:** a Small and a Medium Rare cluster jewel, each with one notable and an open
prefix; exalt until full; record whether a second notable lands on either.
**Assumed:** as above. **Encoded in:** `pool/pool.ts` `lookupWeight`, `Mod.generation`,
`item-model.md` §5.

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

### Q62 · decision · open — the economy source

**Q:** poe.ninja's documented endpoint is gone; its pages read an internal one that may
change.
**Options:** (a) a committed snapshot with provenance, refreshed by hand at least weekly
and at a league's start (recommended); (b) live requests from the CLI; (c) a hand-kept
table. Track the current trade league only (Allflame until 2026-11-13, then 3.30).
**Assumed:** (a). **Encoded in:** [cost.md §7](cost.md#7-the-economy).

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

### Q70 · decision · open — legacy experimented-base variants

**Q:** the legacy variants ([Simplex Amulet § Legacy variants](https://www.poewiki.net/wiki/Simplex_Amulet#Legacy_variants),
[Cogwork Ring § Legacy variants](https://www.poewiki.net/wiki/Cogwork_Ring#Legacy_variants))
have their own caps and magnitudes, which one catalog id cannot carry.
**Options:** (a) keep them out (recommended: no collected recipe starts from one); (b) a
`legacy` item-block field carrying the deltas.
**Assumed:** (a). **Encoded in:** `model/capacity.ts`, one base per id.

### Q73 · probe · open — a fossil reforge's prefix/suffix split

**Q:** how do a reforge's modifiers split when fossils weigh one side far more?
[Fossil](https://www.poewiki.net/wiki/Fossil) gives multipliers, not the split. On an
Imbued Wand with an Aetheric Fossil hinekora reads "increased Spell Damage" on 58% of
reforges, craftofexile's simulator 67.5% ([cost.md §8](cost.md#8-known-differences-from-craftofexile)).
**Probe:** an Imbued Wand of item level 84+, thirty Aetheric Fossils and Primitive
Chaotic Resonators; reforge thirty times; record each result's prefix and suffix count
and whether it has increased Spell Damage.
**Assumed:** the Chaos Orb's 8:3:1, each modifier drawn from both sides' pools at once by
weight after the multipliers, a full side admitting no more. **Encoded in:**
`cost/race.ts` `splitDistribution`, `cost/roll.ts` `countCases`.

### Q74 · probe · open — penetration and the reported refusals of the Harvest change

**Q:** does the damage change take a penetration modifier, and does the grove refuse a
damage over time multiplier and, for the resistance change, a resistance shared with
chaos, as players report? The wiki names neither.
**Probe:** Rares with fire penetration, a fire damage over time multiplier, and fire and
chaos resistance; the grove's fire-to-cold damage and resistance changes; record which it
offers.
**Assumed:** penetration taken; the multiplier and the hybrid refused (a refusal only
makes the checker stricter). **Encoded in:** `check/methods.ts` `elementalKind`.

### Q75 · decision · open — what a declared "random" modifier is to the cost layer

**Q:** the item block's `"random"` says only that a modifier is there; which one changes
the odds of every draw beside it, and whether it may be one a condition names.
**Options:** (a) a natural roll of its side by spawn weight, the item's other modifiers
closing their groups, several random slots of a side drawn without replacement
(recommended: what a reforge most likely left, and the guide's conditions see the chance
it is theirs); (b) none of the named modifiers, one of average weight; (c) the item read
at the floor and ceiling of what the checker allows.
**Assumed:** (a). **Encoded in:** `cost/track.ts` `statesIn`, `cost/roll.ts`
`naturalGroups`.

### Q76 · probe · open — the side of a Veiled Exalted Orb's veiled modifier

**Q:** which side does it land on when both have room?
[Veiled Exalted Orb](https://www.poewiki.net/wiki/Veiled_Exalted_Orb) says only "adds a
random veiled modifier", and the two placeholders carry no spawn weight in the wiki's
data.
**Probe:** Veiled Exalted Orbs, Rares with two prefixes and two suffixes; apply one to
each; record how many veiled prefixes and veiled suffixes come up.
**Assumed:** the sides with room alike, half each. **Encoded in:** `cost/track.ts`
`veiledSides`.

### Q77 · probe · open — the side of an unveil's options

**Q:** does unveiling a veiled prefix offer only prefixes, and a veiled suffix only
suffixes? [Veiled modifier](https://www.poewiki.net/wiki/Veiled_modifier) says the unveil
"presents three random mods" and lists the results by side, without tying them to the
placeholder's.
**Probe:** Veiled Exalted Orbs, a Rare that will take a veiled prefix (suffixes full) and
one that will take a veiled suffix; veil and unveil each several times; record the sides
of the options offered.
**Assumed:** the veiled modifier's own side, where the item says which; the checker still
offers both sides, the looser reading. **Encoded in:** `model/veiled.ts`, `cost/roll.ts`
`unveilRoll`.

### Q78 · decision · open — which unveil option the player takes

**Q:** which of the three options does the cost layer take the player to choose?
**Options:** (a) the guide's target when offered, else a modifier a later condition names,
else one no one names (recommended: a guide naming no target still unveils for what its
conditions ask, and a player takes that when offered); (b) only the target, any other pick
an unnamed modifier; (c) the most valuable, which the cost layer cannot measure.
**Assumed:** (a), the named modifiers ranked in the order the guide's conditions first
name them. **Encoded in:** `cost/track.ts` `unveiled`.

### Q79 · probe · open — an essence's item-level requirement

**Q:** [Essence § Crafting](https://www.poewiki.net/wiki/Essence#Crafting)'s tier table
has a "Minimum required level of crafted item" column (Whispering 1, Muttering 8, Weeping
20, Wailing 33, Screaming 46, Shrieking 59, Deafening 65). Does using an essence below
that item level fail? (Its guaranteed row ignoring the item level otherwise is confirmed
in game, `item-model.md`.)
**Probe:** a Normal item of item level 40 and a Shrieking essence; apply it; record
refused or applied.
**Assumed:** no gate. **Encoded in:** `check/library.ts` `essenceOps`.

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
