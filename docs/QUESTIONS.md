# Questions for Rick

The asynchronous channel between the autonomous work and the user. Work never blocks on
an entry here: each question records the assumption the code proceeds under and where
that assumption lives, so answering later is a bounded change. The protocol is in
`../CLAUDE.md` (Asking without blocking).

Three kinds of entry:

- **decision**: a design or scope choice that is the user's to make.
- **game probe**: a rule the wiki does not settle; needs an item and a few steps in game.
- **clarification**: the request or a convention is ambiguous.

To answer, write under **Answer** and change the status in the heading to `answered`.
The next session applies it and deletes the entry; git history keeps it.

---

## Open

### Q17 · game probe · open

**Asked:** 2026-10-28
**Goal:** what a Foulborn orb counts as a modifier's "eligible tiers".
[Foulborn currency § Mechanics](https://www.poewiki.net/wiki/Foulborn_currency#Mechanics)
hedges ("testing suggests") and says "at the current item level"; whether a tier that
only another modifier's tag makes rollable counts when that modifier is on the item is
not stated.
**Procure:** a Strength jewel with one staff modifier on it, Foulborn Exalted Orbs.
**Steps:** exalt several jewels with and without the staff modifier; note which tiers of a
type with tag-gated rows appear.
**Record:** the lowest tier seen in each case.
**Assumed meanwhile:** the count is what can roll on the item now, tags included, which is
what the add-pool holds (`check/ops.ts` `foulbornTiers`); the cull keeps every row some
count between the sure and the tag-enabled total would keep.
**Answer:**

### Q18 · game probe · open

**Asked:** 2026-10-28
**Goal:** which modifier types the Harvest "change a modifier that grants Fire Damage"
crafts accept. The grove's option table (the cached cargo rows) names the twelve
crafts: the three elemental resistances among themselves and the three elemental damages
among themselves; it does not say whether "grants Fire Damage" covers flat added damage
only, or also increased damage, penetration and the hybrids.
**Procure:** a Rare with a flat added fire damage modifier, one with increased fire
damage, one with fire penetration; the grove's "Fire Damage into Cold Damage" craft.
**Steps:** try the craft on each; note which it offers.
**Record:** the modifiers it changed.
**Assumed meanwhile:** any type whose rows carry the element's tag and the damage tag
(`check/methods.ts` `elementalKind`), and for resistances the element's tag and the
resistance tag, which admits the fire-and-chaos hybrid; a type that names two of the
three elements (the fire-and-cold hybrid) is refused.
**Answer:**

### Q19 · game probe · open

**Asked:** 2026-10-28
**Goal:** how a fossil's own modifiers (the Faceted Fossil's gem-level rows) are
admitted. [Fossil § Mechanics](https://www.poewiki.net/wiki/Fossil#Mechanics) says only
that some fossils roll fossil-exclusive modifiers; the data gives those rows spawn
weights by base tag like any other row.
**Procure:** a Faceted Fossil and a resonator; a weapon and a body armour.
**Steps:** resonate each several times; note which gem-level modifiers appear on which.
**Record:** the modifiers seen per base.
**Assumed meanwhile:** a fossil's row joins the pool when its weight on the base's tags is
positive and its level is within the item's (`check/ops.ts`, the `fossil` pool).
**Answer:**

### Q20 · game probe · open

**Asked:** 2026-10-28
**Goal:** what a resonator does when another fossil blocks every row a fossil would force
or guarantee: a Glyphic Fossil beside a fossil that blocks the chaos tag on a base whose
corrupted-essence modifiers all carry it, or a Hollow Fossil beside one blocking its
row's tag. [Glyphic Fossil § Mechanics](https://www.poewiki.net/wiki/Glyphic_Fossil#Mechanics)
says a Jagged Fossil blocks the chaos-tagged essence modifiers, not what happens when
none is left.
**Procure:** a Glyphic and a Jagged Fossil, a Potent Chaotic Resonator, a base whose four
corrupted-essence modifiers are all chaos-tagged (check the ring's four).
**Steps:** resonate; note whether an essence modifier appears anyway, the resonator is
refused, or the item rolls without one.
**Record:** the outcome.
**Assumed meanwhile:** the guarantee lapses and no such row rolls (`check/library.ts`
`resonatorOps` filters the forced and essence rows by the blocked tags and asserts nothing
when none remain).
**Answer:**

### Q21 · game probe · open

**Asked:** 2026-10-28
**Goal:** whether the Tangled Fossil still rolls fossil-only modifiers or a
corrupted-essence modifier. [Fossil § Mechanics](https://www.poewiki.net/wiki/Fossil#Mechanics)
describes it as a random "greatly more" and "no" tag since 3.16; the data still lists
every fossil-only row under it and a one-in-ten corrupted-essence chance.
**Procure:** Tangled Fossils and resonators, any rare base.
**Steps:** resonate many times; note any fossil-only or corrupted-essence modifier.
**Record:** whether either ever appears.
**Assumed meanwhile:** the data's reading, which only widens what may appear (the
`packages/data/data/poe1/fossils.json` entry, `resonatorOps`); the hover says "may roll" rather than asserting a
chance.
**Answer:**

### Q23 · game probe · open

**Asked:** 2026-10-28
**Goal:** whether a beastcrafted Aspect counts as a crafted modifier: toward the bench's
limit, and for "remove crafted modifiers". [Aspect of the Cat](https://www.poewiki.net/wiki/Aspect_of_the_Cat)
says only that it is beastcrafted onto gear as a suffix; the data's level-30 rows are
ordinary item-domain rows with no weight, the level-20 bench rows separate.
**Procure:** a Rare with a beastcrafted Aspect and a bench.
**Steps:** bench a modifier (does the Aspect count as the one crafted modifier?); use
"remove crafted modifiers" (does the Aspect go?).
**Record:** both outcomes.
**Assumed meanwhile:** not crafted: `beast aspect` leaves the crafted count alone
(`check/library.ts` `beastAspectOps`) and the removal ignores the row. The level-20 bench
Aspects have no surface form.
**Answer:**

### Q22 · game probe · open

**Asked:** 2026-10-28
**Goal:** what "similar-tier" means for the Harvest change, and whether it works on a
Magic item. The option text says "similar-tier"; the checker takes the target's row of
the same rank among its tiers when the source's tier is known (`check/methods.ts`
`harvestChange`) and sets no rarity gate.
**Procure:** a Rare and a Magic item each with a T3 fire resistance; the change to cold.
**Steps:** apply it; note the cold resistance's tier and whether the Magic item took it.
**Record:** the resulting tier on each.
**Assumed meanwhile:** the same rank; any rarity with the modifier present.
**Answer:**

### Q25 · game probe · open

**Asked:** 2026-10-28
**Goal:** when the Sacred Grove greys a harvest craft out.
[Harvest crafting § Mechanics](https://www.poewiki.net/wiki/Harvest_crafting#Mechanics)
says only that the added modifier obeys "Prefixes/Suffixes Cannot Be Changed". Three
cases decide the checker's rule: (a) a reforge whose tagged modifier can roll on the
base but not beside what the metamod keeps (the only life modifier already among the
protected prefixes); (b) a reforge for a prefix-only tag with three protected prefixes;
(c) an augment whose removal may take a suffix while the prefixes stay full.
**Procure:** a Rare with "Prefixes Cannot Be Changed": for (a) its only life modifier
among the prefixes, for (b) three prefixes, for (c) three prefixes and three suffixes.
**Steps:** open the grove's "Reforge … including a Life modifier" for (a) and (b), and
"Add a new Defence modifier and remove another random modifier" for (c); note which are
offered and, when used, what happens.
**Record:** greyed out or not, and the outcome.
**Assumed meanwhile:** the craft is refused unless a tagged row can roll on every path
after the lock-respecting strip or the removal (`check/library.ts`
`harvestReforgeOps` and `harvestAugmentOps`, `check/ops.ts` `poolNonEmpty` reading, per
pair of side counts (`sidePairs`),
`subsetMods`).
**Answer:**

### Q26 · game probe · open

**Asked:** 2026-10-29
**Goal:** which influence tag each item class carries. The data keys an influence's rows
by class (`2h_sword_shaper`, `rune_dagger_shaper`, `warstaff_shaper`), not by the tags a
base has (a two-handed sword carries `sword`, not `2h_sword`), and the wiki states no
class table; the stems are read off the spawn tables
([Modifier § Spawn weight tag](https://www.poewiki.net/wiki/Modifier#Spawn_weight_tag)
gives only the matching rule). Two classes are in doubt: a warstaff (the data has six
`staff_*`-only rows beside its own `warstaff_*` rows) and a thrusting sword (mapped to
`sword` with the one-handed swords).
**Procure:** a Warlord warstaff and a Shaper rapier; a Chaos Orb each.
**Steps:** reforge each several times; note any modifier the influence's table lists
for staves but not warstaves, and any one-handed-sword-only modifier on the rapier.
**Record:** the modifiers seen.
**Assumed meanwhile:** one stem per class, the table in `packages/core/src/model/marks.ts`
`INFLUENCE_STEMS`, checked against the spawn tags by the data tests; a warstaff sees
only its `warstaff_*` rows and a thrusting sword the `sword_*` rows.
**Answer:**

### Q27 · game probe · open

**Asked:** 2026-10-29
**Goal:** what the grove's "Randomise the Influence types on an Influenced Normal, Magic or
Rare Item" can leave. The option text says only that the types are randomised; whether
the item keeps as many influences as it had, whether the same influence can come back,
and whether a two-influence item is rerolled to any pair are not stated
([Harvest crafting](https://www.poewiki.net/wiki/Harvest_crafting)).
**Procure:** a one-influence Rare and (via an Awakener's Orb) a two-influence Rare;
primal lifeforce for several randomises each.
**Steps:** randomise each several times; note the influences after each.
**Record:** the influence sets seen, and whether the same set ever returned.
**Assumed meanwhile:** the count is kept and any set of that size can result, the same
one included (`check/library.ts` `HARVEST_RANDOMISE`, `check/ops.ts` the `randomise`
change).
**Answer:**

### Q29 · game probe · open

**Asked:** 2026-10-29
**Goal:** how the grove's two influence crafts behave under the metamods.
[Metamod § Rules and Exceptions](https://www.poewiki.net/wiki/Metamod#Rules_and_Exceptions)
gives the randomise craft's row as "Respected, but usage is prevented if any prefix is
influenced" (and suffix) under the two protections, and "Unknown" under the two
cannot-roll metamods; it has no row for "Reforge an Influenced Rare item … including an
Influence modifier".
**Procure:** an influenced Rare with "Prefixes Cannot Be Changed" and an influenced
prefix; one with "Cannot roll Attack Modifiers"; lifeforce for both crafts.
**Steps:** open the grove's randomise and influence reforge on each; note which are
offered and what survives.
**Record:** offered or greyed out; the modifiers kept.
**Assumed meanwhile:** the randomise is refused when a modifier that may sit on a
protected side may be an influence modifier (`check/ops.ts` `noInfluencedOnProtected`)
and the cannot-roll metamods have no effect on it; the influence reforge behaves as the
tagged reforges, keeping a protected side and needing room for its influence modifier
(`check/library.ts` `HARVEST_INFLUENCE_REFORGE`).
**Answer:**

### Q30 · game probe · open

**Asked:** 2026-10-29
**Goal:** what the Bestiary's "Add a Mod to a Hunter Item" and its five siblings need and
draw from. The recipe rows ([Beastcrafting](https://www.poewiki.net/wiki/Beastcrafting))
carry no note on rarity, and do not say whether the added modifier comes from the whole
pool or the influence's rows only.
**Procure:** a Magic Hunter item and a Rare one with an open slot; the recipe's beasts.
**Steps:** try the recipe on each; note whether the Magic item is accepted and whether a
natural modifier is ever added.
**Record:** accepted or not; the modifiers added over several tries.
**Assumed meanwhile:** a Rare item with an open slot, the modifier drawn from the whole
pool at the beast's level (`check/library.ts` `beastAddInfluenceOps`).
**Answer:**

### Q32 · game probe · open

**Asked:** 2026-10-29
**Goal:** which influence the Corruption Altar's reforge gives, and how many modifiers a
corruption reforge rolls on a base that holds fewer than six.
[Locus of Corruption § Possible outcomes](https://www.poewiki.net/wiki/Locus_of_Corruption#Possible_outcomes)
says "an influenced rare item of the same base type, with random affix modifiers" and
no more; [Vaal Orb § Equipment](https://www.poewiki.net/wiki/Vaal_Orb#Equipment) says
"rolling six random affixes" without naming a jewel's four.
**Procure:** an uninfluenced Rare ring and a Rare jewel; altar access and Vaal Orbs.
**Steps:** corrupt several rings at the altar until the influenced outcome shows; note
the influences; corrupt jewels with Vaal Orbs until the reforge shows; count the affixes.
**Record:** the influences seen; the affix counts on the jewel.
**Assumed meanwhile:** any one influence or what the item had, a jewel reforged without
one (no influence can mark a jewel), and six capped by the base's limit
(`check/library.ts` `locusOps`, `vaalOps`, `brickBranch`). An item with an eldritch
implicit cannot be influenced, and the wiki does not say what the altar's influenced
reforge does to one; the checker lets the outcome keep the implicits beside the new
influence, the wide reading. A Gilded Fossil's extra implicit, which the altar's two
replacements could spare an eldritch one beside, is not modelled.
**Answer:**

### Q37 · game probe · open

**Asked:** 2026-10-30
**Goal:** what an Orb of Conflict makes of an implicit raised past the top tier of its
own kind. The data gives the "presence" variants of an implicit (stronger while a
Unique or Pinnacle enemy is near) fewer tiers than the plain one: the Unique-presence
families stop at Exquisite and the Pinnacle-presence ones at Exceptional, so raising one
of those at its top cannot keep its type.
[Orb of Conflict § Mechanics](https://www.poewiki.net/wiki/Orb_of_Conflict#Mechanics)
says only that the orb raises a tier.
**Procure:** gloves with a Pinnacle-presence Exceptional Exarch implicit and a Greater
Eater one; Orbs of Conflict.
**Steps:** apply until the Exarch side rises; note what the implicit became.
**Record:** the plain variant of the same stat, another Exquisite, or a refusal.
**Assumed meanwhile:** the implicit keeps its type when raised (`check/ops.ts`, the
`conflict` change leaves `eldritchTypes` alone), which is exact while a wording never
separates a variant from its plain sibling.
**Answer:**

### Q39 · game probe · open

**Asked:** 2026-10-30
**Goal:** whether an Orb of Dominance takes a Magic item.
[Orb of Dominance § Mechanics](https://www.poewiki.net/wiki/Orb_of_Dominance#Mechanics)
says "Magic and Rare items that have two or more Influenced modifiers", while
[Elevated modifier](https://www.poewiki.net/wiki/Elevated_modifier) says elevated
modifiers "can only be crafted onto Rare Influenced items".
**Procure:** a Magic pair of gloves with a Hunter prefix and a Hunter suffix at tier 1;
an Orb of Dominance.
**Steps:** apply it; note whether it is accepted and what the result is.
**Record:** accepted or not; the modifiers after.
**Assumed meanwhile:** the orb's own page, a Magic item accepted (`check/library.ts`
`DOMINANCE` has no rarity gate); the elevated row is the one sharing the modifier's
group under the item's influence tag (`check/ops.ts` `elevate`), which pairs every
influenced modifier of the four classes in the data.
**Answer:**

### Q33 · game probe · open

**Asked:** 2026-10-29
**Goal:** how the Tainted currency treats the metamods and the item level. The Metamod
table has a row for the Tainted Exalted Orb only
([Metamod § Rules and Exceptions](https://www.poewiki.net/wiki/Metamod#Rules_and_Exceptions));
[Tainted Chaos Orb § Mechanics](https://www.poewiki.net/wiki/Tainted_Chaos_Orb#Mechanics)
names the fractured modifier as the only survivor of its strip and says nothing of its
reforge under a protection; and
[Tainted Divine Teardrop § Mechanics](https://www.poewiki.net/wiki/Tainted_Divine_Teardrop#Mechanics)
bounds a raised tier by "a tier usually obtainable on that base type", not by the item's
level.
**Procure:** a corrupted Rare with "Suffixes Cannot Be Changed" and a corrupted low-level
Rare with a modifier at its level's top tier; Tainted Chaos Orbs and Teardrops.
**Steps:** apply the orb to the first until each outcome shows; note whether the suffixes
survived either; apply Teardrops to the second; note whether a tier above the level's
cap appears.
**Record:** the suffixes after each outcome; the highest tier seen.
**Assumed meanwhile:** both halves of the Tainted Chaos Orb ignore the protection
(`check/library.ts` `TAINTED_CHAOS`, `unprotect`), and a Teardrop's tier stays among
those the item level allows (`check/astate.ts` `relaxTiers`, the tier resolution in
`check/check.ts`).
**Answer:**

### Q41 · game probe · open

**Asked:** 2026-11-08
**Goal:** the exact text the game writes when an item is copied with Ctrl+C and with
Ctrl+Alt+C (the advanced form), which the wiki does not record. The renderer
(`packages/core/src/render/item.ts`) is modelled on memory of it; the points to settle:
the header of a bench-crafted modifier (`{ Master Crafted Prefix Modifier "…" }` or the
plain `{ Prefix Modifier … }` with `(crafted)` after the text); whether `Corrupted` and
the influence lines (`Hunter Item`) share one `--------` section or each have their own;
the header and the line suffix of an eldritch implicit (`{ Searing Exarch Implicit
Modifier (Tier: Grand) }`, `(exarch implicit)`); and the plural class names on the `Item
Class:` line for every craftable class (Abyss Jewels, Life Flasks, Charms, Staves, …).
**Procure:** a Rare with a bench modifier, a fractured modifier, an influence and a
corruption; an armour piece with an Exarch implicit; one item of each class.
**Steps:** copy each with Ctrl+Alt+C and paste the text.
**Record:** the text, verbatim.
**Assumed meanwhile:** the layout `renderItemText` writes (`item.ts`): plain modifier
headers with `(crafted)` after the text, one marks section, the eldritch header and
suffix above, `CLASS_LABEL` plus a camel-case split and an `s` for the class names.
**Answer:**

### Q40 · decision · open

**Asked:** 2026-11-08
**Question:** the formatter's style choices, each a one-line change if you want them
otherwise: a width of 100 columns (the repo's Prettier width); the item block's fields
in a fixed order (`base`, `ilvl`, `rarity`, `prefixes`, `suffixes`, `influences`,
`exarch`, `eater`, then `corrupted`) with the values aligned; an `and` under an `or`
in parentheses for the reader though the grammar does not need them; a body kept on one
line only when the author wrote it on one; the source's own line ending kept.
**Assumed meanwhile:** the above (`packages/parser/src/format.ts`, REFERENCE §3b).
**Answer:**

### Q50 · decision · open

**Asked:** 2026-11-08
**Question:** what item state follows a step the checker refuses. The game applies none
of a refused currency, so the item is as it was; the checker used to continue from that
untouched state, and every later step that needed the refused one's effect was refused
too (a `regal` refused on a maybe-Magic item left every Rare-only step after it refused as
well), and a loop whose body fills the item looked like one that could never reach its
exit, since the refused `exalt` changed nothing on the full paths.
**Options:** (a) the untouched state, as before, with the cascade; (b) the state the
method would have left had its checks held, so the steps after the one reported are
judged against what the guide meant, and a refusal is reported once; (c) the state
narrowed to where the check holds, then the method's effect, the most precise, but a
narrowing for every kind of check, and nothing to narrow to when the check holds nowhere.
**Recommendation:** (b); (c) if a cascade ever matters enough to pay for it. Why (b)
is sound: (c) is the exact continuation on the paths where the step is legal, and every
operation's effect is monotone in the state, so applying it to the whole state gives a
superset of (c); the paths where the game refuses are the ones the reported failure
covers, so the checker's guarantee holds up to the first reported refusal, after which
findings are judged against the guide's intent. In a loop's quiet probes the would-be
state can be narrower than the untouched one (a refused regal leaves Rare, not Magic or
Rare); that is safe because the reporting pass runs from the final invariant's
continuing part, a superset of every probe's, and the checks are monotone, so a refusal
a probe met fires again where it is reported. The trace records the would-be state after
the refused step, so hover and the walkthrough show the item the guide meant.
**Assumed meanwhile:** (b) (`check/ops.ts` `runMethod` returns the state with the
failure, `check/check.ts` continues from it, `operations.md` §2).
**Answer:**

### Q35 · decision · open

**Asked:** 2026-10-30
**Question:** the surface for the eldritch implicits. Item block fields `exarch: grand`
and `eater: lesser`; statements `ember <tier>`, `ichor <tier>` (the four tiers an ember
or ichor comes in), `eldritch chaos`, `eldritch exalt`, `eldritch annul`, `conflict`;
predicates `exarch [<tier>]`, `eater [<tier>]` and `dominant exarch|eater`. The tier
words are the game's: `lesser`, `greater`, `grand`, `exceptional`, `exquisite`,
`perfect`. Alternatives: the in-game item names (`lesser ember`), or one `eldritch`
family for everything.
**Assumed meanwhile:** the words above (`check/methods.ts`, `parser/src/parser.ts`,
the surface doc §1, §3 and §5).
**Answer:**

### Q56 · game probe · open

**Asked:** 2026-11-09
**Goal:** how the game reads a modifier's generation table. The data pairs each spawn
table with a `generation_weights` table the wiki does not describe; the code reads it as
it reads the spawn table, the first entry whose tag the item carries deciding, that entry
scaling the spawn weight in percent and a zero disabling the row (`pool/pool.ts`
`lookupWeight`, `Mod.generation`). The one consequence in play is wiki-backed: every
cluster notable adds `has_affliction_notable` and its table reads the Large and Medium
size tags at full weight before a zero on that tag, the Small Cluster Jewel's cap of one
notable ([Cluster jewel § Mechanics](https://www.poewiki.net/wiki/Cluster_jewel#Mechanics)).
No other row in the data carries a zero generation entry; the rest scale weapon rows by
50 or 100 percent.
**Procure:** a Small Cluster Jewel and a Medium one, each Rare with one notable and an
open prefix.
**Steps:** use Exalted Orbs on each until the prefixes are full.
**Record:** whether a second notable ever lands on the Small (the zero), and whether one
does on the Medium (the size tag matching first).
**Assumed meanwhile:** first match wins, percent scale, zero disables (`Mod.generation`,
`lookupWeight`, `item-model.md` §5).
**Answer:**

### Q53 · game probe · open

**Asked:** 2026-11-08
**Goal:** whether a Divine Orb rolls a bench-crafted modifier's value again.
[Divine Orb](https://www.poewiki.net/wiki/Divine_Orb) says it rerolls "the values of the
random modifiers" and that a fractured modifier's are not rerolled; it does not name the
crafted ones. It decides whether a value a guide has pinned on a crafted modifier
survives a `divine`.
**Procure:** a Rare with a bench-crafted modifier whose value is not at its maximum.
**Steps:** use a Divine Orb; compare the crafted modifier's value before and after.
**Record:** whether it changed.
**Assumed meanwhile:** it is rerolled, the conservative reading (`check/ops.ts` `reroll`
keeps only a fractured modifier's value and those of a side a metamod protects).
**Answer:**

### Q52 · game probe · open

**Asked:** 2026-11-08
**Goal:** whether a crafted modifier a Harvest "change a resistance / damage modifier to
another element" craft changes stays a crafted modifier. [Harvest crafting § Mechanics](https://www.poewiki.net/wiki/Harvest_crafting#Mechanics)
and [Metamod § Rules and Exceptions](https://www.poewiki.net/wiki/Metamod#Rules_and_Exceptions)
do not say; it decides whether the bench's "remove crafted modifiers" reaches the new
modifier and whether the crafted limit still counts it.
**Procure:** a Rare with a bench-crafted fire resistance and no other crafted modifier.
**Steps:** change it to cold at the Horticrafting Station; hover the new modifier; try
"remove crafted modifiers".
**Record:** whether the modifier shows as crafted and whether the recipe removes it.
**Assumed meanwhile:** it stays crafted, the conservative reading (`check/ops.ts` `fill` on a
`rows` pool that replaces a crafted type keeps the new rows among `craftedTypes` and
restores the crafted count the change began with).
**Answer:**

### Q51 · decision · open

**Asked:** 2026-11-08
**Question:** how a guide names one modifier of a group when the wording is shared by
both sides. On a wand "increased fire damage" is a caster prefix (the group of the
bench's spell damage) and a suffix of its own group, so the guard a guide means by
"bench spell damage unless you already have a caster damage prefix" cannot be written:
`not has "increased fire damage"` is ambiguous, and the clash message names the modifier
by that very wording (`docs/research/checker-findings.md` B12).
**Options:** (a) a side on the predicate, `has prefix "fire damage"`, the item block's
words; (b) a group predicate, `has group "spell damage"`, true when the item may carry
any modifier of the named modifier's group, which is exactly what the bench check tests,
so the guard is one clause, `if not has group "spell damage" { bench "spell damage" }`;
(c) both.
**Recommendation:** (b) first: it is what every "unless you already have one" guard
means, one clause instead of five, and it needs no new word in the item block; (a) when
a guide needs one side's version of a shared wording for its own sake.
**Assumed meanwhile:** (b), built as `has group "<mod>"` (the surface doc §5,
`check/check.ts` `resolveHas`, `check/astate.ts` `refineHasGroup`), tested in
`check/group.test.ts`.
**Answer:**

### Q57 · decision · open

**Asked:** 2026-11-09
**Question:** what a step's probability means when the checker's item is a set of items
(`docs/research/cost-model.md` §5.2). (a) A point estimate on the paths the guide is on:
the pool of the modifiers present on every path, a modifier the state holds only as
possible neither shrinking the pool nor adding its tags, with the report naming the
assumption where it applies; (b) bounds, the same computation on the checker's superset
and subset pools, reported as a range; (c) both.
**Recommendation:** (a): exact for a reforge and for an item whose named modifiers fill
it, which is where guides quote odds; (b) when a guide needs the range.
**Assumed meanwhile:** (a) for the figure, with (b) beside it as a spread: the walk is run
again with every range the checker left open (a side's count, the memory strands) at its
floor and at its ceiling, and a step whose ends differ shows them (`cost/roll.ts`
`Reading`, `cost/report.ts` `Bounds`).
**Evidence since (2026-11-10):** craftofexile's simulator, run to a few hundred items per
guide (`docs/research/cost-model.md` §6), puts the figure inside the spread wherever the
two differ, but the estimate falls well off it where the checker's item is a join over a
loop's rounds. On `examples/metamod-harvest-loop.craft` (its random prefix made a T5
mana) the simulator takes 9.35 Harvest reforges; the spread is 8.73 to 23.1 and the
estimate 23.1, because an annul inside the loop may take a kept suffix, so the join no
longer guarantees the three suffixes and the estimate reads the open count at its floor.
On `examples/example.craft`'s second loop the simulator takes 1306 rounds, the spread is
1084 to 2111, the estimate 1626: the Regal Orb's path forgets how many modifiers the
Orb of Transmutation laid down. A fourth option follows: (d) carry a distribution over
the counts and the named modifiers forward through every step, as a chain-solved loop
already does for its rounds and now hands to the steps after it, so neither a floor nor
the last roll alone stands in for what came before.
**Answer:**

### Q58 · game probe · open

**Asked:** 2026-11-09
**Goal:** the odds of one against two modifiers from an Orb of Transmutation or an Orb of
Alteration. [Orb of Transmutation § Spending](https://www.poewiki.net/wiki/Orb_of_Transmutation#Spending)
says "a prefix, suffix, or both" and no page gives the ratio; craftofexile uses one half
each.
**Procure:** a Normal ring, fifty Orbs of Transmutation or a Magic ring and fifty Orbs of
Alteration.
**Steps:** apply each; count the results with one modifier and with two.
**Record:** the two counts.
**Assumed meanwhile:** one half each, the single modifier's side by the sides' weight
shares (`docs/research/cost-model.md` §1.3).
**Answer:**

### Q59 · game probe · open

**Asked:** 2026-11-09
**Goal:** whether essences, resonators, the Harvest reforges and the Veiled Chaos Orb lay
down 4, 5 or 6 modifiers at the Chaos Orb's 8:3:1
([Chaos Orb § Mechanics](https://www.poewiki.net/wiki/Chaos_Orb#Mechanics)). The wiki
likens each to a Chaos Orb or an Orb of Alchemy without a ratio; craftofexile rolls an
essence's three to five random modifiers at 8:3:1 beside the guaranteed one.
**Procure:** a Rare body armour; forty Screaming essences, forty resonators with one
fossil, lifeforce for forty reforges.
**Steps:** apply each batch; count the modifiers after every use.
**Record:** how many of each batch left 4, 5 and 6.
**Assumed meanwhile:** 8:3:1 for all of them, the guaranteed modifier counted among the
4–6, and on a base holding four (a jewel) three or four at 65:35, craftofexile's reading
of [Orb of Alchemy](https://www.poewiki.net/wiki/Orb_of_Alchemy)'s "three to four if used
on jewels" (`docs/research/cost-model.md` §1.3).
**Answer:**

### Q60 · game probe · open

**Asked:** 2026-11-09
**Goal:** whether the "more" weight multipliers of two fossils add (×10 and ×10 giving
×20) or multiply (×100). [Fossil](https://www.poewiki.net/wiki/Fossil) records the dispute
and calls additive the more widely accepted theory.
**Procure:** a Rare ring, a Potent Chaotic Resonator, Pristine and Prismatic Fossils in
quantity (life ×10 and elemental ×6 on a base where both tags have rows).
**Steps:** resonate many times; note how often a life modifier appears beside how often an
elemental one does, against the single-fossil rates.
**Record:** the counts.
**Assumed meanwhile:** additive, and when two tags of one fossil match a row the larger
of its multipliers counts, since the page says only that a fossil affects a modifier
once (`docs/research/cost-model.md` §1.4).
**Answer:**

### Q61 · game probe · open

**Asked:** 2026-11-09
**Goal:** whether an Orb of Annulment picks the removed modifier uniformly among those it
can remove. [Orb of Annulment](https://www.poewiki.net/wiki/Orb_of_Annulment) says only
"a random modifier"; every calculator takes it as uniform.
**Procure:** Rare items with one common and one rare modifier (a T1 life beside a T1
movement speed) and Orbs of Annulment.
**Steps:** annul many such items; count which modifier went.
**Record:** the counts per modifier.
**Assumed meanwhile:** uniform, for every random removal (the Veiled Exalted Orb's, the
Harvest augment's, the beast recipes', the Orb of Dominance's)
(`docs/research/cost-model.md` §1.4).
**Answer:**

### Q62 · decision · open

**Asked:** 2026-11-09
**Question:** the economy source and its refresh (`docs/research/cost-model.md` §3).
poe.ninja's documented endpoint is gone; its page reads
`/poe1/api/economy/exchange/current/overview?league=<League>&type=<Type>`, an internal
endpoint that may change again. Options: (a) a snapshot committed to the repository with
its provenance, refreshed by a script making five requests (Currency, Essence, Fossil,
Resonator, Beast), run by hand at least weekly and at a league's start, the report naming the
snapshot's date; (b) live requests from the CLI at each run; (c) a hand-kept table.
**Recommendation:** (a): the prices stay reproducible and the site is not polled by every
check. Which league to track is the current trade league (Allflame until 2026-11-13, the
3.30 league once poe.ninja lists it); hardcore and Standard are not tracked.
**Assumed meanwhile:** (a).
**Answer:**

### Q63 · game probe · open

**Asked:** 2026-11-09
**Goal:** which tagged row a Harvest "reforge including a <tag> modifier" places, and
whether the rest of the roll is a plain Chaos Orb roll.
[Harvest crafting](https://www.poewiki.net/wiki/Harvest_crafting) guarantees one tagged
modifier and says no more.
**Procure:** a Rare ring, lifeforce for forty "reforge including a Life modifier".
**Steps:** reforge forty times; note which life modifier appeared and the total count.
**Record:** the life modifiers' frequencies against their spawn weights.
**Assumed meanwhile:** one of the tag's rows by spawn weight, placed first, the remaining
modifiers drawn as a Chaos Orb draws them (`docs/research/cost-model.md` §1.4, §5.4).
**Answer:**

### Q64 · game probe · open

**Asked:** 2026-11-09
**Goal:** whether an unveil's three options are drawn by the unveiled rows' spawn weights.
[Veiled modifier](https://www.poewiki.net/wiki/Veiled_modifier) says three random
modifiers are presented and records a rebalance of "the weighting of Veiled modifiers".
**Procure:** Veiled Chaos Orbs and a Rare body armour.
**Steps:** veil and unveil many times; note the three options each time.
**Record:** each option's frequency against its weight in the data.
**Assumed meanwhile:** three weighted draws without replacement from the unveil pool
(`docs/research/cost-model.md` §1.4).
**Answer:**

### Q65 · game probe · open

**Asked:** 2026-11-09
**Goal:** whether a modifier's value is uniform over its row's range, which decides the
chance a Divine Orb reaches `has "maximum life" >= 110`.
[Divine Orb](https://www.poewiki.net/wiki/Divine_Orb) says the values are rolled again
within the tier and nothing of the distribution.
**Procure:** a Rare with a T1 life modifier and Divine Orbs.
**Steps:** divine many times; note each value.
**Record:** the values.
**Assumed meanwhile:** uniform over the integers of the range
(`docs/research/cost-model.md` §1.4).
**Answer:**

### Q66 · game probe · open

**Asked:** 2026-11-09
**Goal:** by how much the grove's "Reforge a Rare item, being more / less likely to
receive the same modifier types" tilts the weights. The option text
([Harvest crafting](https://www.poewiki.net/wiki/Harvest_crafting)) states no factor;
craftofexile multiplies the weight of every row sharing a harvest type with a modifier
on the item by ten for "more likely" and by a tenth for "less likely".
**Procure:** a Rare ring with one life modifier and no other life-typed modifier, 8000
Wild Crystallised Lifeforce.
**Steps:** "more likely" forty times; count the rolls holding a life modifier against the
plain reforge's share (the cost report gives it).
**Record:** the share of rolls with a life modifier.
**Assumed meanwhile:** craftofexile's ten and one tenth (`cost/roll.ts` `LIKELY_FACTOR`);
the checker reads the craft as a plain reforge either way, since the same modifiers can
roll (`check/library.ts` `harvestLikelyOps`).
**Answer:**

### Q70 · decision · open

**Asked:** 2026-11-09
**Question:** an experimented-base state the model cannot hold. The legacy variants
([Simplex Amulet § Legacy variants](https://www.poewiki.net/wiki/Simplex_Amulet#Legacy_variants):
−1/−1 and 25%; [Cogwork Ring § Legacy variants](https://www.poewiki.net/wiki/Cogwork_Ring#Legacy_variants):
a hidden 0%) have their own caps and magnitudes, which the catalog's one id cannot carry.
A Magic Simplex Amulet with modifiers is no longer a state to hold:
[Simplex Amulet § Version history](https://www.poewiki.net/wiki/Simplex_Amulet#Version_history)
3.27.0 fixed the bug that let it and similar bases be Magic with modifiers, though the
page's crafting notes still describe a split beast making one.
**Options:** (a) keep legacy variants out; (b) a `legacy` field on the item block carrying
the variant's deltas.
**Recommendation:** (a): no collected recipe starts from a legacy item.
**Assumed meanwhile:** (a) (`model/capacity.ts`, one base per id).
**Answer:**

### Q68 · game probe · open

**Asked:** 2026-11-09
**Goal:** the memory strands two orbs use up where the wiki's table is blank, and how far
their cut of the lower tiers reaches.
[Memory strand § Crafting methods consuming memory strands](https://www.poewiki.net/wiki/Memory_strand#Crafting_methods_consuming_memory_strands) gives every currency's most, except the Foulborn Exalted Orb's below five
modifiers ("0-?") and an Exalted Orb's on an item with none ("likely 0-10", "so far seen
up to 9"). The page does not say whether the Foulborn cut of the lower tiers and the
strands' cut apply together; whether a Harvest, Bestiary or resonator fill, which uses no
strands, is cut all the same (it names "currency orbs"); whether the formula's `tiers`
counts the modifier's whole ladder or only the tiers the item level admits (its example
has every tier eligible); nor what strands a Recombinator's result keeps.
**Procure:** two Rare rings with 100 memory strands and no modifiers, Foulborn Exalted
Orbs and Exalted Orbs; a third with 82 strands and a Foulborn Exalted Orb.
**Steps:** use one orb on each empty ring and note the strands used; on the third, note
whether the modifier added is one of the top tiers both rules allow.
**Record:** the strands used per orb; the tier added.
**Assumed meanwhile:** 62 for the Foulborn Exalted Orb at every count and 10 for the
Exalted Orb on an empty item (`check/library.ts` `FOULBORN_STRANDS`, `EXALT_STRANDS`);
both cuts apply, each keeping the top tiers it allows (`pool/pool.ts`, `check/ops.ts`
`foulbornTiers`); only the fills of a method that uses strands up are cut (`Rules.strands`
in `check/ops.ts`); `tiers` is the whole ladder on the base, the reading that keeps the
most tiers; a Recombinator's result may keep either input's strands (`check/ops.ts`
`recombine`).
**Answer:**

### Q73 · game probe · open

**Asked:** 2026-11-10
**Goal:** how a fossil reforge's modifiers split between prefixes and suffixes when the
fossils weigh one side far more than the other.
[Fossil](https://www.poewiki.net/wiki/Fossil) gives the multipliers but not the split.
On an Imbued Wand an Aetheric Fossil (caster rows ten times, attack rows at 0.15) leaves
the prefix pool about twice the suffix pool; hinekora then lays three prefixes on seven
reforges in eight, and craftofexile's simulator lands some "increased Spell Damage" on
67.5% of reforges where hinekora reads 58% (`docs/research/cost-model.md` §6.2).
**Procure:** an Imbued Wand of item level 84 or more, thirty Aetheric Fossils and
Primitive Chaotic Resonators.
**Steps:** reforge it thirty times.
**Record:** the prefix and suffix count of each result, and whether it has increased
Spell Damage.
**Assumed meanwhile:** the count is the Chaos Orb's 8:3:1, split by drawing each modifier
from both sides' pools at once in proportion to their weights after the fossils'
multipliers, a side admitting no more once full (`cost/race.ts` `splitDistribution`,
`cost/roll.ts` `countCases`).
**Answer:**
