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
The next session applies it, records the commit, and moves the entry to Resolved.

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

### Q22 · game probe · open

**Asked:** 2026-10-28
**Goal:** which tier the Harvest change lands on when the two elements' tiers differ, and
whether it works on a Magic item.
[Modifier § Harvest Crafting](https://www.poewiki.net/wiki/Modifier#Harvest_Crafting)
says the craft "preserves the tier, but not the roll within that tier"; but the elements'
ladders are not parallel (fire resistance's rows at levels 1, 12, 24, …, cold's at 1, 14,
26, …), so "the same tier" may be counted over the base's whole ladder or over the rows
the item level allows, and the two disagree on a low item.
**Procure:** a Rare of item level 13 with the level-12 fire resistance; a Magic item with a
fire resistance; the change to cold.
**Steps:** apply it to each; note the cold resistance's value and whether the Magic item
took it.
**Record:** the cold row on the Rare; accepted or not on the Magic item.
**Assumed meanwhile:** the target's row at the source's rank where the two ladders match
level for level at the item's level, any of the target's rows where they do not
(`check/methods.ts` `harvestChange`); any rarity with the modifier present.
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

### Q33 · game probe · open

**Asked:** 2026-10-29
**Goal:** how the Tainted Chaos Orb treats the metamods. The Metamod table has a row for
the Tainted Exalted Orb only
([Metamod § Rules and Exceptions](https://www.poewiki.net/wiki/Metamod#Rules_and_Exceptions));
[Tainted Chaos Orb § Mechanics](https://www.poewiki.net/wiki/Tainted_Chaos_Orb#Mechanics)
names the fractured modifier as the only survivor of its strip and says nothing of its
reforge under a protection. The Teardrop's half of this entry is settled by the wiki
([Tainted Divine Teardrop § Mechanics](https://www.poewiki.net/wiki/Tainted_Divine_Teardrop#Mechanics):
a raised tier is bounded by "a tier usually obtainable on that base type", and the orb
ignores metamods); the checker forgets the tiers and reads a value against every row the
base rolls, whatever the item level (`check/value.test.ts`).
**Procure:** a corrupted Rare with "Suffixes Cannot Be Changed"; Tainted Chaos Orbs.
**Steps:** apply the orb until each outcome shows; note whether the suffixes survived
either.
**Record:** the suffixes after each outcome.
**Assumed meanwhile:** both halves of the Tainted Chaos Orb ignore the protection
(`check/library.ts` `TAINTED_CHAOS`, `unprotect`).
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
has every tier eligible).
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
most tiers.
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

### Q74 · game probe · open

**Asked:** 2026-11-10
**Goal:** whether the Harvest damage change takes a penetration modifier, and a check of
the two refusals only players report: a damage over time multiplier, and a resistance
shared with chaos (Q18). The wiki names neither.
**Procure:** a Rare with fire penetration, one with a fire damage over time multiplier and
one with fire and chaos resistance; the grove's fire-to-cold damage and resistance changes.
**Steps:** try each change on its item.
**Record:** which the grove offers.
**Assumed meanwhile:** penetration is taken; the multiplier and the hybrid are refused
(`check/methods.ts` `elementalKind`). The refusals only ever make the checker stricter.
**Answer:**

### Q75 · decision · open

**Asked:** 2026-11-10
**Question:** what the cost layer takes a modifier the item block declares `"random"` to
be. The guide says only that a modifier is there; which one changes the odds of every
draw beside it, and whether it might be one a condition names. (a) A natural roll of its
side by spawn weight, the item's other modifiers closing their groups, several random
slots of a side drawn without replacement; (b) none of the guide's named modifiers, a
modifier of average weight; (c) leave such a guide to the old point estimate and its
spread.
**Recommendation:** (a): it is what the item most likely holds if it came from a
reforge, and it lets the guide's own conditions see the chance the slot is one of theirs.
**Assumed meanwhile:** (a) (`cost/track.ts` `statesIn`, `cost/roll.ts` `naturalGroups`).
**Answer:**

### Q76 · game probe · open

**Asked:** 2026-11-10
**Goal:** which side a Veiled Exalted Orb's veiled modifier lands on when both have room.
[Veiled Exalted Orb](https://www.poewiki.net/wiki/Veiled_Exalted_Orb) says only "adds a
random veiled modifier", and the two placeholders (`VeiledPrefix`, `VeiledSuffix`) carry
no spawn weight in the wiki's data.
**Procure:** Veiled Exalted Orbs and Rares with two prefixes and two suffixes.
**Steps:** apply one to each Rare.
**Record:** how many veiled prefixes and veiled suffixes come up.
**Assumed meanwhile:** the sides with room alike, half each when both have room
(`cost/track.ts` `veiledSides`).
**Answer:**

---

## Resolved

### Q57 · decision · resolved

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
**Answer:** (d), Rick, 2026-11-10: "it's the only way to be accurate." Applied in e9d523d:
the walk carries a distribution over the counts and every named or known modifier
(`cost/track.ts`); the modifiers no one names stay a count, each closing a group of
average weight when a draw lands beside them, which Rick accepted as the one
approximation that tracking every modifier's identity cannot avoid without
enumerating outcomes. The spread of the meanwhile assumption remains only for a guide the
walk cannot follow throughout (`docs/ARCHITECTURE.md` §7.1), and a state a step cannot
carry exactly is left as it was, with a note.

### Q23 · game probe · resolved

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
**Answer:** 2026-11-10, from the game data: not crafted. Every Bestiary aspect row
(`Grants…AspectCrafted`) in the wiki's mods table is an ordinary item modifier (domain 1), where a bench row
(`EinharMasterIncreasedLife2`) is a crafted one (domain 9), and the trade site's stat list
offers the aspects as explicit and fractured modifiers, never crafted. The assumption
above stands.

### Q26 · game probe · resolved

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
**Answer:** 2026-11-10, from the game data: RePoE's item classes export, read from the
game's own influence-tag table, gives every class's `influence_tags`; all 24 classes match
`INFLUENCE_STEMS`, a warstaff seeing only `warstaff_*` rows and a thrusting sword the
`sword_*` rows. The assumption above stands.

### Q39 · game probe · resolved

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
**Answer:** 2026-11-10, from the wiki: [Orb of Dominance § Mechanics](https://www.poewiki.net/wiki/Orb_of_Dominance#Mechanics)
takes "Magic and Rare items", a reading the page's editors set deliberately in 2022
over the older "Rare only"; the Elevated modifier page's wording is the older one. The
assumption above stands.

### Q53 · game probe · resolved

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
**Answer:** 2026-11-10, from players' reports: a Divine Orb rerolls a bench-crafted
modifier's value within its rank ([forum](https://www.pathofexile.com/forum/view-thread/1826750),
[forum](https://www.pathofexile.com/forum/view-thread/1629903)). The assumption above stands.

### Q64 · game probe · resolved

**Asked:** 2026-11-09
**Goal:** whether an unveil's three options are drawn by the unveiled rows' spawn weights.
[Veiled modifier](https://www.poewiki.net/wiki/Veiled_modifier) says three random
modifiers are presented and records a rebalance of "the weighting of Veiled modifiers".
**Procure:** Veiled Chaos Orbs and a Rare body armour.
**Steps:** veil and unveil many times; note the three options each time.
**Record:** each option's frequency against its weight in the data.
**Assumed meanwhile:** three weighted draws without replacement from the unveil pool
(`docs/research/cost-model.md` §1.4).
**Answer:** 2026-11-10, from the wiki: the options are drawn by weight;
[Veiled modifier § Version history](https://www.poewiki.net/wiki/Veiled_modifier#Version_history)
rebalances "the weighting of Veiled modifiers" and makes rarer ones more likely to show.
Drawing without replacement fits the three distinct options. The assumption above stands.

### Q65 · game probe · resolved

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
**Answer:** 2026-11-10, from the wiki: [Modifier § Mechanics overview](https://www.poewiki.net/wiki/Modifier#Mechanics_overview)
says a value is "randomized within with equal chances", within the stat's own range.
The assumption above stands.

### Q18 · game probe · resolved

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
**Answer:** 2026-11-10, from the wiki and players' reports: the damage change refuses a
critical strike multiplier ([Harvest crafting § Version history](https://www.poewiki.net/wiki/Harvest_crafting#Version_history),
3.28.0 Hotfix 8), and players report it refusing a damage over time multiplier
([forum](https://www.pathofexile.com/forum/view-thread/3923545)) and the resistance change
refusing a resistance shared with chaos ([forum](https://pathofexile.com/forum/view-thread/3270484));
[Modifier § Harvest Crafting](https://www.poewiki.net/wiki/Modifier#Harvest_Crafting) adds
that it takes the Incursion resistance modifiers too, and
[Version 3.28.0c](https://www.poewiki.net/wiki/Version_3.28.0c) fixes it to take increased
elemental damage. `elementalKind` now leaves out rows tagged `critical` (standing for the
multiplier, which today is all it catches beside one cluster notable), rows tagged
`dot_multi`, and resistances tagged `chaos`. Penetration and the two forum-sourced
refusals are Q74's probe.

### Q67 · game probe · resolved

**Asked:** 2026-11-09
**Goal:** how the Recombinator picks which pooled modifiers survive.
[Recombinator § Unpredictable Recombination](https://www.poewiki.net/wiki/Recombinator#Unpredictable_Recombination)
gives the count per pooled count as a table and says "higher weight modifiers are more
likely to be selected, although the exact formula is unknown"; it does not say whether a
modifier both items carry is twice as likely, nor which of its two tiers the result takes.
**Procure:** two Rare rings of one base, each with one prefix and nothing else, one
prefix's spawn weight about three times the other's; Recombinators and gold for forty.
**Steps:** recombine forty pairs; note which prefix survived when one did, and the tier
when both items carried the same modifier at different tiers.
**Record:** the survivors' frequencies against their spawn weights.
**Assumed meanwhile:** a pick proportional to spawn weight on the result's base, without
replacement, a modifier on both items at twice its weight and its tier one of either's
by weight share, an unnamed modifier at the average weight of its side's pool, the
exclusive rule as the page states it.
**Evidence since (2026-11-10):** the same page's history row for
[Version 3.25.1](https://www.poewiki.net/wiki/Version_3.25.1) says the opposite direction,
"rarer Modifiers now have a much higher chance to be selected", but it belongs to the
Settlers league, when a Kingsmarch upgrade made "Rarer Modifiers … more likely to be
retained"; the page's history says that upgrade was likely removed when the Recombinator
went core in 3.26.0, so the note probably describes that upgrade, not today's pick.
craftofexile's emulator (`poec_simRecombinate`) picks uniformly among the pooled
modifiers, and its count table differs from the page's (one pooled: keep none a third of
the time, not 41%; three pooled: 30/50/20, not 40/50/10). The probe above settles the
direction: if the rarer prefix survives more often than half, the pick leans against
spawn weight and the pick should weigh by its inverse.
**Answer:** 2026-11-10: deferred with the Recombinator, which is removed until a second
item in a guide is designed (`ROADMAP.md`, multi-item crafts); the evidence above stands
for that design.

### Q28 · game probe · resolved

**Asked:** 2026-10-29
**Goal:** what an Awakener's Orb needs of the target item and what it keeps.
[Awakener's Orb § Mechanics](https://www.poewiki.net/wiki/Awakener%27s_Orb#Mechanics)
says each item must have exactly one influence, that the target is reforged as a Rare
ignoring metamods, and that the result "will attempt to retain one influenced modifier
from each item if possible"; it does not say whether a Normal or Magic target is
accepted, nor when the retention succeeds.
**Procure:** a Magic one-influence item and a Rare one-influence donor of the same class;
an Awakener's Orb.
**Steps:** apply the orb to the Magic target; note whether it is accepted and which
influenced modifiers the result carries.
**Record:** accepted or not; the influenced modifiers kept from each item.
**Assumed meanwhile:** any rarity is accepted, and no modifier is guaranteed kept; the
section also says a transferred modifier keeps its tier, so note whether a kept donor
modifier obeys the target's item level.
**Answer:** 2026-11-10: deferred. The donor's and the target's modifiers both decide the
result, so the orb waits until a guide can name the donor as a second item; it is removed
until then (`ROADMAP.md`, multi-item crafts), and the probe goes with it.

### Q38 · game probe · resolved

**Asked:** 2026-10-30
**Goal:** whether an Eldritch Ember or Ichor needs an item level. The rows carry a
required level of 75 in the data, and the item pages say only "a normal, magic or rare
item" ([Lesser Eldritch Ember](https://www.poewiki.net/wiki/Lesser_Eldritch_Ember)).
**Procure:** a pair of gloves of item level 20; a Lesser Eldritch Ember.
**Steps:** apply it; note whether it is refused.
**Record:** refused or applied.
**Assumed meanwhile (until the answer):** any item level, the row's level dropped by
`packages/data/scripts/ingest-eldritch.mjs`.
**Answer:** 2026-11-10: not seen in play; assume the data's level 75 as an item level until
a game shows otherwise (`model/marks.ts` `ELDRITCH_ITEM_LEVEL`, required by an ember, an ichor and the item block).

### Q36 · game probe · resolved

**Asked:** 2026-10-30
**Goal:** what an Orb of Conflict does when the implicit it would raise is already
Perfect. [Orb of Conflict § Mechanics](https://www.poewiki.net/wiki/Orb_of_Conflict#Mechanics)
says the orb raises one and lowers the other and is the only way to the top two tiers,
not whether a Perfect stays while the other still drops or only the other can rise.
**Procure:** an item with a Perfect Exarch and a Grand Eater implicit; Orbs of Conflict.
**Steps:** apply several; note each result.
**Record:** the pairs seen.
**Assumed meanwhile:** both readings, the raised one capped at Perfect with the other
lowered either way (`check/ops.ts`, the `conflict` change).
**Answer:** 2026-11-10, from play: the orb picks either side. Picked, a Perfect implicit
stays Perfect and the other drops a tier; otherwise the Perfect drops as usual. That is
the assumption above, so the model is unchanged; `examples/eldritch-gloves.craft` now
raises its Exarch implicit to Exquisite with the Conflict loop.

### Q16 · game probe · resolved

**Asked:** 2026-10-28
**Goal:** whether the bench's "remove crafted modifiers" respects "Prefixes / Suffixes
Cannot Be Changed". Neither
[Crafting Bench § Using the crafting bench](https://www.poewiki.net/wiki/Crafting_Bench#Using_the_crafting_bench)
nor [Metamod § Rules and Exceptions](https://www.poewiki.net/wiki/Metamod#Rules_and_Exceptions)
lists the option.
**Procure:** a Rare with "Can have up to 3 Crafted Modifiers", "Prefixes Cannot Be
Changed" and a crafted prefix (a bench life).
**Steps:** use "Remove Crafted Mods" on it.
**Record:** which of the three crafted modifiers remain.
**Assumed meanwhile:** protection does not apply; every crafted modifier that is not
fractured goes, the protecting metamod itself included (`check/ops.ts` `removeCrafted`).
If protection did apply, the removal would wrongly exclude a surviving modifier.
**Answer:** 2026-11-10, from play: the removal ignores the metamods, which are crafted
themselves, and takes every crafted modifier, the metamods included. A fractured crafted
modifier stays and stays crafted, so a further bench craft needs the multimod again. Both
are the assumption above (`check/bench.test.ts`, bench remove with a fractured crafted
modifier).

### Q72 · decision · resolved

**Asked:** 2026-11-09
**Question:** whether a value comparison on an experimented base reads the row's own span
or the span the item shows, scaled by the base's magnitude implicit (a Simplex Amulet's
top life row shows 230 to 258, its row 115 to 129). Reading the row's span only is unsound
against what a player reads: `if has "maximum life" <= 129 { … }` is taken as always true
there, and a branch on `>= 240` is reported as one that can never run. Scaling needs the
rounding (Q69), the granted-skill rule (Q71) and catalyst quality; a span widened to cover
both readings and every rounding would be sound meanwhile.
**Options:** (a) the row's own span, the implicit a no-op; (b) scale with the span
widened outward to whole numbers; (c) the hull of both readings.
**Answer:** (a), 2026-11-09: the implicit is a no-op for now, and its scaling waits on the
roadmap (`check/check.ts` value rows and tier spans read `rollRange` unscaled).

### Q54 · decision · resolved

**Asked:** 2026-11-08
**Question:** whether to lift Q34's "not for now" on Hinekora's Lock. The research
report ranks the Lock and the Allflame bench third of the constructs guides use and the
language lacks (`docs/research/feature-report.md` B3): every advanced 3.29 route previews
its risky step and keeps the outcome only on a condition. The model is one mechanism, a
filtered transfer: run the operation, keep the outcomes that satisfy a predicate, join
with the unchanged item for the rest, and report a condition the operation can never
produce; a spelling such as `lock regal keep suffixCount == 1` (`examples/future/lock-regal.craft`).
**Options:** (a) keep Q34 as ruled and leave the Lock to a later league; (b) build the
Lock now, with its own rules (not after a bench, Harvest, beast or Recombinator step; not
on a corrupted item); (c) build the Lock and the Allflame bench together, the bench as the
same statement with a preview count that changes the cost, not the state.
**Recommendation:** (b), then (c) when the Allflame bench's rules are in the wiki cache.
**Assumed meanwhile:** (a), as Q34 ruled; `lock-regal` stays in `examples/future/`.
**Answer:** (a), 2026-11-09: the Lock and the Allflame bench stay deferred; `lock-regal`
stays in `examples/future/`.

### Q55 · decision · resolved

**Asked:** 2026-11-08
**Question:** what the Recombinator model leaves out, and whether to carry it. The
result keeps one of the two inputs' bases at random
([Recombinator § Unpredictable Recombination](https://www.poewiki.net/wiki/Recombinator#Unpredictable_Recombination)),
and the state carries one base, so `recombine` refuses two bases that differ; the
result's rarity is read from its modifier count, since the page states no rule; the
count table is read as a range, the weights dropped with the rest of the probability
layer; and every non-natural row (crafted, veiled, essence-only, elevated) counts as an
exclusive modifier, the page's list being "non-exhaustive".
**Options:** (a) as built; (b) a base disjunction on the state (two bases on an item,
every pool and cap a join), which the whole abstract item would have to learn; (c) a
probe on the rarity rule and on which crafted modifiers are exclusive.
**Recommendation:** (a) now, (c) when an item is at hand; (b) only if a guide needs two
bases, which none in the research does.
**Assumed meanwhile:** (a).
**Answer:** (a), 2026-11-09: the Recombinator stays as built; two bases, the named
Awakener donor and Kishara's Ducat stay deferred. Superseded 2026-11-10: the Recombinator
is removed until a second item in a guide is designed (`ROADMAP.md`, multi-item crafts).

### Q69 · game probe · resolved

**Asked:** 2026-11-09
**Goal:** how the game rounds a value an experimented base scales. A Helical Ring's
"50% increased Suffix Modifier magnitudes" turns a +57 roll into 85.5
([Helical Ring](https://www.poewiki.net/wiki/Helical_Ring#Mechanics)); the item shows a
whole number, and whether it is rounded down, up or to nearest decides whether
`has "…" >= 86` holds on that roll.
**Procure:** a Helical or Cogwork Ring with a suffix whose scaled value is not whole.
**Steps:** read the shown value; compare with the row's span scaled by hand.
**Record:** the rounding.
**Assumed meanwhile:** no value is scaled (the implicit is not applied).
**Answer:** moot, 2026-11-09: an experimented base's magnitude implicit is not applied for now (`ROADMAP.md`), so no value is scaled.

### Q71 · game probe · resolved

**Asked:** 2026-11-09
**Goal:** whether an experimented base's magnitude implicit scales a granted skill's
level. [Simplex Amulet § Mechanics](https://www.poewiki.net/wiki/Simplex_Amulet#Mechanics)
says the 100% doubles "+1 gem" modifiers, but not whether "Grants Level 22 Wrath Skill"
(the Awakener's Orb aura suffixes) reads Level 44.
**Procure:** a Simplex or Focused Amulet with a "Grants Level N … Skill" suffix (an
Awakener's Orb onto one).
**Steps:** read the granted level on the item and on the skill.
**Record:** whether the level is scaled.
**Assumed meanwhile:** no value is scaled (the implicit is not applied).
**Answer:** moot, 2026-11-09: an experimented base's magnitude implicit is not applied for now (`ROADMAP.md`), so no value is scaled.

### Q46 · decision · resolved

**Asked:** 2026-11-08
**Question:** whether the playground's walkthrough may carry the game's currency icons.
The wiki hosts them, but they are Grinding Gear Games' art; shipping them in the
repository and on the published page is a licensing call, not a technical one. The
alternatives: fetch them from the wiki at page load (no copy in the repo, but a
dependency on the wiki being up and on its hotlinking policy), or lettered,
colour-coded badges drawn by the page.
**Assumed meanwhile:** the badges (the `badge-<word>` styles in
`editors/playground/src/style.css`).
**Answer:** Rick ruled (2026-11-08): the game's CDN hosts the icons for bases and currencies under hashed URLs that its APIs return (the build sites use those); derive them if we can, otherwise copy the currency icons from the wiki into an images or resources folder of the playground for now.
**Applied:** 410fe1a. The CDN's public path (`web.poecdn.com/image/Art/2DItems/Currency/<name>.png`) answers for the classic orbs only (the eldritch, tainted, veiled, harvest and bestiary currencies are not under it), and the ingested data carries no art paths, so the icons are copied from the wiki into `editors/playground/src/icons/` by `editors/playground/scripts/fetch-icons.mjs`, one per method.

### Q49 · decision · resolved

**Asked:** 2026-11-08
**Question:** a declared `"random"` affix is read as a natural modifier of its side the item
could roll: never a bench craft, an essence-only, fossil-only or unveiled row, nor one a
declared cannot-roll metamod would have blocked. A bought item whose unnamed prefix is in
fact a bench craft then checks as if it had none, and a later `bench` is let through
where the game refuses on the crafted limit.
**Options:** (a) keep natural-only and say so (the surface doc does); (b) a spelling for
an unnamed crafted modifier, `bench "random"`, counted toward the crafted range;
(c) read `"random"` as any row of any source, which would block most crafts on a
placeholder item.
**Recommendation:** (b) when a guide needs it; (a) meanwhile.
**Assumed meanwhile:** (a) (`check/ops.ts` `anonymousTypes`; the `crafted` range counts
named bench rows only).
**Answer:** Rick ruled (2026-11-08): (b). Applied: the item block takes `bench "<mod>" [t<n>]` and `bench "random"`, both counted toward the crafted limit (spelled `bench`, the operation's word, by a later ruling).

### Q42 · game probe · resolved

**Asked:** 2026-11-08
**Goal:** whether a resonator takes a Normal item. craftofexile's emulator enables
fossils on a white base and fossil-crafting a white base is common play;
[Resonator](https://www.poewiki.net/wiki/Resonator) says a chaotic resonator works
"similarly to a Chaos Orb" and contrasts it with the alchemical ones, which take Normal
items only, so the page does not settle it.
**Procure:** a Normal body armour, a Primitive Chaotic Resonator with any fossil.
**Steps:** apply the resonator.
**Record:** refused, or the Rare it produced.
**Assumed meanwhile:** a Rare item only (`check/library.ts` `resonatorOps`, `isRare`),
which is the stricter reading; if the game accepts a Normal item the gate relaxes to
"not Magic".
**Answer:** Rick ruled (2026-11-08): a resonator takes a Normal item. Applied: `resonatorOps` refuses only a Magic item (`notMagic`), and the fossil docs say Normal or Rare.

### Q43 · game probe · resolved

**Asked:** 2026-11-08
**Goal:** which rarities the grove's "add a <tag> modifier and remove another random
modifier" and "reforge … including a <tag> modifier" take. The reforge's option text
names a Rare item; the add/remove craft's says only "from a non-Influenced item"
([Harvest crafting](https://www.poewiki.net/wiki/Harvest_crafting)). craftofexile's
emulator allows both on a Magic item and the reforge on a Normal one.
**Procure:** a Magic ring with two modifiers and a Normal ring; lifeforce for one
augment and one reforge.
**Steps:** open the grove's "add a Life modifier, remove another" on the Magic ring and
"reforge including a Life modifier" on the Normal ring; note which are offered.
**Record:** offered or greyed out, and the result.
**Assumed meanwhile:** both need a Rare item (`check/library.ts` `harvestReforgeOps`,
`harvestAugmentOps`, `isRare`), the stricter reading.
**Answer:** Rick ruled (2026-11-08): assume a Rare item for both crafts. Already what the checker encodes; nothing to change.

### Q44 · game probe · resolved

**Asked:** 2026-11-08
**Goal:** whether a Fracturing Orb takes an item with an eldritch implicit.
[Fracturing Orb § Mechanics](https://www.poewiki.net/wiki/Fracturing_Orb#Mechanics) says
it can be used on such an item; craftofexile's emulator greys it out, and the emulator
is usually right about what the client refuses.
**Procure:** a Rare pair of gloves with four modifiers and a Lesser Eldritch Ember's
implicit; a Fracturing Orb.
**Steps:** apply the orb.
**Record:** refused, or which modifier fractured.
**Assumed meanwhile:** the wiki's reading, accepted (the `fracture` entry of the currency table in
`check/library.ts` has no eldritch gate).
**Answer:** Rick ruled (2026-11-08): a Fracturing Orb takes an item with an eldritch implicit, not an influenced one. Already what the checker encodes.

### Q45 · game probe · resolved

**Asked:** 2026-11-08
**Goal:** whether the bench's "remove crafted modifiers" removes an unveiled modifier.
[Veiled modifier](https://www.poewiki.net/wiki/Veiled_modifier) says an unveiled modifier
does not count as a crafted one (it does not take the crafted slot), not whether the
removal recipe reaches it. Guides that loop a Veiled Exalted Orb need to clear a bad
unveil before the next orb, which refuses an item with an unveiled modifier, and the
cheap way would be that recipe.
**Procure:** a Rare with an unveiled modifier and a bench modifier.
**Steps:** use "remove crafted modifiers"; note which of the two went.
**Record:** the modifiers after.
**Assumed meanwhile:** the removal leaves an unveiled modifier alone (`check/ops.ts`
`removeCrafted` touches bench rows only), so a bad unveil is cleared with an annul.
**Answer:** Rick ruled (2026-11-08): the removal does not reach an unveiled modifier; the bench's own lower-tier versions of the veiled modifiers are crafted modifiers, a veiled orb's are not. Already what the checker encodes; a bad unveil is cleared with an annul.

### Q47 · game probe · resolved

**Asked:** 2026-11-08
**Goal:** what a conqueror's, Shaper's or Elder's Exalted Orb does on a Rare whose item
level is below every row of that influence (an ilvl 50 body armour and a Hunter's
Exalted Orb). [Hunter's Exalted Orb § Mechanics](https://www.poewiki.net/wiki/Hunter%27s_Exalted_Orb#Mechanics)
lists only the influenced, synthesised, fractured and eldritch refusals; the help text
says "a high-level rare item"; craftofexile refuses below item level 68.
**Procure:** a Rare body armour of item level 50 with an open slot; a Hunter's Exalted Orb.
**Steps:** apply the orb.
**Record:** refused; or marked Hunter with no modifier added; or marked with one (which).
**Assumed meanwhile:** refused (`check/library.ts` `influenceExaltOps` requires an
influence modifier the item can take), the reading under which the checker never
claims a modifier the game did not add.
**Answer:** Rick ruled (2026-11-08): refuse below the minimum item level, as craftofexile does. Already what `influenceExaltOps` encodes.

### Q48 · game probe · resolved

**Asked:** 2026-11-08
**Goal:** whether the four Path of Exile: Royale modifier rows (movement speed on boots,
cast speed, attack speed) ever roll in the main game. The export gives them weights; the
wiki's per-class modifier lists ([List of modifiers for wands](https://www.poewiki.net/wiki/List_of_modifiers_for_wands))
omit them, as does craftofexile, but no page states the rule.
**Procure:** a few low-level Normal boots and gloves; Orbs of Transmutation and Alteration.
**Steps:** roll them; watch for a "Sprinter's" boots prefix of 15–25% or a gloves "of
Ease" of 8–15% that the ordinary ladder does not have.
**Record:** whether such a roll ever appears.
**Assumed meanwhile:** never (`packages/data/src/adapter.ts` `adaptMod` drops a row whose
id names Royale), which rests on the lists' omission.
**Answer:** Rick ruled (2026-11-08): the Royale rows belong to a game mode that no longer exists and must never be considered; they go away. Applied: the ingest script drops them, the committed catalog no longer holds them, and the adapter guard is gone.

### Q31 · decision · resolved

**Asked:** 2026-10-29
**Question:** whether an influence orb can be used on an item that already has that
same influence. The wiki disagrees with itself:
[Hunter's Exalted Orb § Mechanics](https://www.poewiki.net/wiki/Hunter%27s_Exalted_Orb#Mechanics)
says "Cannot be used on influenced items, synthesised items, fractured items, or items
with eldritch implicit modifiers" and its help text "a high-level rare item with no
influence", while
[Influenced item § Mechanics](https://www.poewiki.net/wiki/Influenced_item#Mechanics)
says "This cannot be done if the item already has an influence different than the orb
being applied", which reads as if the same influence were accepted.
**Answer:** Rick ruled (2026-10-29): the same influence counts; a Shaper's Exalted Orb
cannot be used on a Shaper item. The orb's own page is followed
(`check/library.ts` `influenceExaltOps`, `noInfluence`). Do not relax this from the
Influenced item page.

### Q24 · decision · resolved

**Asked:** 2026-10-28
**Question:** the shape of the generic operation statement. Each method family had its
own statement, parser branch, completion context and hover (`essence`, `bench`,
`harvest`, `veiled`, `foulborn`, `fossil`, `beast`, `unveil`, `restore`), so adding a
method touched six files. Options: (1) one operation statement `<name> <arg> …` whose
arguments a **signature** table for that name drives (a list of slots: a quoted catalog
name, a word from a fixed set, an integer, a list of names), so the parser, completion
and hover read the table and know no method; the surface forms stay as they are, only
their machinery is shared. (2) Keep per-method statements and accept the cost.
Recommendation: (1).
**Answer:** Rick ruled (2026-10-29): (1), the whole surface as a library over one
operation dispatch. Built as the method table `check/methods.ts` (`Method`, `Slot`,
`findMethod`), the AST's single `OperationStmt`, the parser's `parseOperation`, the
checker's `checkOperation`, and completion, hover and highlighting reading the table.

### Q15 · decision · resolved

**Asked:** 2026-10-28
**Question:** the [Orb of Chance](https://www.poewiki.net/wiki/Orb_of_Chance) has three
outcomes: Magic (as a transmute), Rare (as an alchemy), or Unique, where the craft ends.
The state holds a set of rarities (`check/astate.ts` `rarities`), so the Magic-or-Rare
half is expressible; what is missing is the Unique outcome, where the item leaves the
crafting domain and nothing later can be done to it. The usual guide is "scour-chance
until unique", about which only cost modelling has anything to say. Options: (1) a
`unique` rarity no later operation accepts, so a guide that goes on after a chance is
refused unless it narrows the rarity first; (2) leave the orb out of scope, like Rog.
Recommendation: (2) until a guide needs it.
**Answer:** Rick ruled (2026-10-29): do not model the Orb of Chance at all; it is not
worth being able to model. The ledger rows for the orb and the bench's "Reroll the
rarity" are **out** in `operations.md` §3.

### Q1 · decision · resolved

**Asked:** 2026-10-26
**Question:** Affix capacity was computed in three places (the checker's count domain, the
concrete item validator, and a literal 6 in the concrete exalt). Route the concrete layer
and the pool through the count domain (recommended), delete the concrete library instead,
or merge the two modules?
**Context:** the pool's open-slot check used the validator's incomplete formula and sits
on the checker's path, so on a rare Ratcheting Ring the add-pool was wrong in the unsound
direction (ROADMAP Step 1 bug 10).
**Applied meanwhile:** option 1. The formula lives once in `model/capacity.ts`; the
validator, the pool, the concrete exalt and the count domain read it, and the validator
gained the combined-cap clause.
**Where the assumption lives:** `packages/core/src/model/capacity.ts`,
`packages/core/src/pool/pool.ts`, `packages/core/src/check/counts.ts`, their tests.
**Answer:** Rick ruled option 1 (2026-10-27). Applied in `67003d1`. The concrete validator and
currency library were deleted afterwards under Q3; the pool and the checker remain the
formula's two readers.

### Q2 · decision · resolved

**Asked:** 2026-10-26
**Question:** The item's tag set. Implement the tags a present modifier adds
(`adds_tags`) in the pool now and defer influence (recommended), implement both, or
leave the pool matching on base tags only?
**Context:** 235 jewel modifiers key on a `specific_weapon` tag that
another jewel modifier adds; without it the jewel pool overstates what can roll, which
makes `until has X` look reachable when it is not.
**Applied meanwhile:** added tags only (then `pool.itemTags`, now `ItemFacts.tags`); influence arrives with the
influence currencies (built).
**Where the assumption lives:** `packages/core/src/pool/pool.ts`, `pool.test.ts`.
**Answer:** Rick ruled option 1 (2026-10-27). Applied in `1a3c83e` and `138cb13`.

### Q3 · decision · resolved

**Asked:** 2026-10-26
**Question:** What the concrete `Item` carries. Only what the pool reads (influence, once
it exists; recommended), a faithful item with fractured/veiled/influence marks, or the
present subset with the spec stating that marks are checker-only?
**Context:** `docs/item-model.md` §10 is the open question in the spec.
**Assumed meanwhile:** option 3. Fracture and veiled state stay in the checker; the
concrete item gains fields only when the pool needs them.
**Where the assumption lived:** `docs/item-model.md` §7 and §10.
**Answer:** Rick ruled none of the three (2026-10-27). A concrete item is an abstract state with no
uncertainty, so the checker's state is the only item model; the pool reads a projection
of it (`ItemFacts`). The concrete currency library and validator were deleted in
`1f62c9d` and the pool's parameter became the projection in `294d7c1`.

### Q7 · game probe · resolved

**Asked:** 2026-10-26
**Goal:** the semantics of the two new bench recipes "Reroll three random modifiers on a
Rare item" (3 Chaos) and "Reroll a random modifier" (8 Chaos), added in 3.29. The wiki
([Version 3.29.0](https://www.poewiki.net/wiki/Version_3.29.0)) says only "reroll".
**Procure:** any Rare with 6 modifiers, two of them of a known group, and a spare with
"Prefixes Cannot Be Changed" benched.
**Steps:** (1) apply "reroll three" to the full Rare several times; note whether the
count stays 6 and whether the three rerolled modifiers can land on the other side (prefix
count changing). (2) apply it to the metamod item; note whether prefixes are ever touched
and whether the metamod itself can be rerolled. (3) apply "reroll a random modifier" to a
Rare with one modifier of each side; note whether the result keeps the side.
**Record:** before/after prefix and suffix counts for each try.
**Assumed meanwhile:** `remove(unlocked, k); fill(natural, k)` (count preserved, side may
change, metamods respected), as `operations.md` §3.2 states; not built until answered.
**Answer:** Rick ruled (2026-10-30): deferred, not worth modelling yet. The ledger row
is deferred; the probe stands for when it is.

### Q34 · decision · resolved

**Asked:** 2026-10-30
**Question:** whether to model [Hinekora's Lock](https://www.poewiki.net/wiki/Hinekora%27s_Lock):
a method applied under a condition on its own outcome, the join of the narrowed
after-state and the unchanged one, which would also flag a condition the method can
never produce.
**Answer:** Rick ruled (2026-10-30): not for now. The ledger row is deferred.

### Q4 · decision · resolved

**Asked:** 2026-10-26
**Question:** Delete the dead effect kinds (`poolWiden`, `protect` by mods, `slotDelta`,
`opUnlock`) and the five unreachable `ModSource` values (recommended), or keep them as
PoE2 design intent?
**Context:** Nothing constructs them; the design that introduced
them (PoE2 socket augments, quality unlocks) is out of scope.
**Applied meanwhile:** deleted; the effect union has three arms and the source enum
six values. Restoring them is a revert of one commit.
**Where the assumption lives:** `packages/core/src/model/effects.ts`,
`packages/core/src/model/sources.ts`, `packages/data/src/adapter.ts`.
**Answer:** Rick ruled option 1 (2026-10-27), and wider: every PoE2 consideration goes (the
omen scope, the game header's second value and the `Game` type, the weight provenance,
the ignored item-block fields). Hinekora is PoE1 only, with no provision for PoE2.
Applied in `7fdc664` (omen scope), `bd15774` (the `Game` type), `174ebf0` (weight
provenance), `1eeee60` (item-block fields).

### Q5 · decision · resolved

**Asked:** 2026-10-26
**Question:** Go ahead with the core-operations redesign proposed in
`operations.md` (every crafting method compiled to a handful of primitive effects on
the abstract item), or keep one transfer function per currency?
**Context:** the analysis in that doc; it changes the shape of the checker's operation
layer but not the abstract domain, and it is what makes the remaining crafting surface tractable.
**Assumed meanwhile:** the bug fixes land first in the current structure (their tests
carry over); the redesign waits for the answer.
**Where the assumption lives:** nowhere yet.
**Answer:** Rick ruled go (2026-10-27), with three refinements now in `operations.md` §2: a
method is an ordered sequence of irreducible operations; a precondition is itself an
operation (`require`) that may sit anywhere in the sequence, including after the
effects it checks; and a method is all or nothing, a failed `require` anywhere leaves
the item as it was. Built: `check/ops.ts`, `check/library.ts` and the method table of
`check/methods.ts` (Q24).

### Q14 · game probe · resolved

**Asked:** 2026-10-27
**Goal:** how many modifiers an Orb of Transmutation lays down.
**Answer:** settled by the wiki (2026-10-27), no probe needed:
[Orb of Transmutation § Spending](https://www.poewiki.net/wiki/Orb_of_Transmutation#Spending)
says "the resulting item may have a prefix, suffix, or both". Applied as one or two in
`check/library.ts` (`transmute`).

### Q6 · decision · resolved

**Asked:** 2026-10-26
**Question:** The typing-rules design doc (crafting-lang-typing-rules-v0.md, now deleted) was retired in
favour of `operations.md`. Most of it described designs never built (`narrow`, game
modules, PoE2 operations, augments, `OpUnlock`, `placeMeta`); what was built is covered by
`ARCHITECTURE.md`, `item-model.md` and `operations.md`. Keep it retired, or restore it as
an explicitly historical design record?
**Assumed meanwhile:** retired; git history keeps it.
**Where the assumption lives:** `docs/`, the code comments that used to cite its sections.
**Answer:** Rick ruled retired (2026-10-27). The deletion is `e298aa3`.

### Q8 · game probe · resolved

**Asked:** 2026-10-26
**Goal:** whether a Chaotic Resonator (fossils) accepts a Normal item.
[Crafting](https://www.poewiki.net/wiki/Crafting) says fossils are "only usable on rare
items"; [Resonator](https://www.poewiki.net/wiki/Resonator) likens the Chaotic one to a
Chaos Orb and the Alchemical one to an Orb of Alchemy.
**Procure:** a Normal base, a Chaotic Resonator with one fossil.
**Steps:** try to apply it. **Record:** accepted or refused.
**Assumed meanwhile:** Chaotic needs Rare, Alchemical needs Normal (the Resonator page).
**Answer:** Rick ruled (2026-10-27): a Chaotic Resonator works on Rare items only. The
Alchemical Resonator is Ruthless-only, and nothing that exists only in Ruthless mode is in
scope.

### Q9 · game probe · resolved

**Asked:** 2026-10-26
**Goal:** the two Metamod-table cells the wiki itself marks unconfirmed
([Metamod § Rules and Exceptions](https://www.poewiki.net/wiki/Metamod#Rules_and_Exceptions)):
does a Harvest "reforge including a Fire modifier" respect "Cannot roll Caster Modifiers"
on its own, or only together with "Suffixes Cannot Be Changed"? Same for "reforge more
likely".
**Procure:** a Rare with "Cannot roll Caster Modifiers" benched and no other metamod;
Harvest reforge lifeforce.
**Steps:** reforge (fire) ten times; note whether any caster-tagged modifier ever rolls.
**Record:** the modifiers rolled.
**Assumed meanwhile:** the cannot-roll metamod is respected whenever its carrier
survives the reforge (the checker's current wiring).
**Answer:** Rick knows this (2026-10-27): the cannot-roll metamod is respected only when
its carrier survives the reforge under a "cannot be changed" lock on its side, which in
practice needs the multimod metamod too (three crafted modifiers: multimod, the lock, the
cannot-roll). That is the checker's wiring: the strip keeps the protected side's carriers
and the fill reads the effects still in force. The more/less-likely reforges are not
implemented; they are rarely part of a craft worth modelling and are deferred.

### Q11 · game probe · resolved

**Asked:** 2026-10-26
**Goal:** the rarity an Orb of Scouring leaves on an item with two fractured modifiers.
[Fractured item § Mechanics](https://www.poewiki.net/wiki/Fractured_item#Mechanics) says
"a Rare item if it had two or three fractured mods";
[Tainted Chaos Orb § Mechanics](https://www.poewiki.net/wiki/Tainted_Chaos_Orb#Mechanics)
says one fractured prefix and one fractured suffix "results in a magic item".
**Procure:** the route the checker models, a kept side holding exactly one modifier plus
one fractured modifier on the other: a Rare with one prefix and three suffixes, no
metamod; a Fracturing Orb (it may lock any of the four, and a fractured item cannot be
fractured again, so a miss means a fresh item); on a suffix hit, Orbs of Annulment until a
suffix slot opens with the prefix still there (a removal may take the prefix; start over),
then bench "Prefixes Cannot Be Changed". Or the two-fracture route: a Recombinator or a
talisman with two beast-fractured modifiers.
**Steps:** scour it. **Record:** the resulting rarity, with the prefix and suffix counts
the item kept.
**Assumed meanwhile:** the lowest rarity whose caps hold the survivors (Magic for one of
each side), which is what `rarity(lowest)` in `operations.md` and `lowestRarity` in
`check/ops.ts` do. [Orb of Scouring](https://www.poewiki.net/wiki/Orb_of_Scouring) says
"with two modifiers, the item will remain rare", so the case is reachable today: a
protected side plus one fractured modifier (the scour tests in
`check/metacraft.test.ts`), not only the multi-fracture routes.
**Answer:** Rick tested it (2026-10-27): the item stayed Rare. Start: one natural prefix,
one fractured suffix, one natural suffix, "Prefixes Cannot Be Changed" (a suffix); after
the scour: the prefix and the fractured suffix. So the rarity goes by survivor count, as
[Orb of Scouring](https://www.poewiki.net/wiki/Orb_of_Scouring) says: none Normal, one
Magic, two or more Rare. Applied in `check/ops.ts` (`scouredRarity`).

### Q12 · game probe · resolved

**Asked:** 2026-10-26
**Goal:** whether a Veiled Chaos Orb refuses an item that carries an unveiled modifier.
[Veiled Exalted Orb](https://www.poewiki.net/wiki/Veiled_Exalted_Orb) says it cannot be
used "on an item with a veiled modifier or its craftable versions"; for the Veiled Chaos
Orb the wiki says only that it "cannot be used to obtain multiple veiled modifiers"
([Crafting](https://www.poewiki.net/wiki/Crafting)).
**Procure:** a Rare with an unveiled modifier (veiled chaos, then unveil) and a Veiled
Chaos Orb.
**Steps:** try to apply it. **Record:** accepted or refused.
**Assumed meanwhile:** refused, the stricter reading, in `check/library.ts`
(`VEILED_CHAOS`) and the Veiled Chaos Orb row of `operations.md`.
**Answer:** Rick knows this (2026-10-27): the Veiled Chaos Orb is refused only when a
veiled or unveiled modifier would survive the reforge, that is, under a "cannot be
changed" lock on its side (veiled or unveiled alike). Applied as the `noVeiledKept` check
in `check/ops.ts`; the Veiled Exalted Orb keeps the stricter check.

### Q13 · game probe · resolved

**Asked:** 2026-10-26
**Goal:** whether a reforge's later rolls see the tags its earlier rolls added. The data
has rows that only roll once another row's added tag is on the item (the staff jewel
modifiers on a Strength jewel carry `staff: 500` ahead of `not_int: 0`), and rows a tag
disables (`specific_weapon`); whether one Chaos Orb can produce both the adder and the
enabled row is not stated on the wiki.
**Procure:** a Strength (Crimson) Jewel, Chaos Orbs or Orbs of Alteration.
**Steps:** reforge repeatedly; note whether a jewel ever shows two staff modifiers, or a
staff modifier together with a modifier the `not_int` tag would otherwise block.
**Record:** any such pair, or none after many tries.
**Assumed meanwhile:** yes, the stricter reading for the checker: the add-pool admits
every row an admitted row's tag would enable, to a fixpoint (`check/ops.ts`
`addableMods`, `pool/pool.ts` `lookupWeight`).
**Answer:** Rick knows this (2026-10-28): one Chaos Orb can roll both the adder and the
enabled row, so a reforge's later rolls see the tags its earlier rolls added. The
assumption stands: the fixpoint in `check/ops.ts` `addableMods` is the rule itself, not a
safe over-approximation of it.

### Q10 · clarification · resolved

**Asked:** 2026-10-26
**Question:** [Rog](https://www.poewiki.net/wiki/Rog)'s crafting options are not listed on
the wiki. Is Rog in scope for the crafting surface, and if so what source should define
his options (poedb, in-game notes)?
**Assumed meanwhile:** out of scope until a source exists.
**Answer:** Rick ruled (2026-10-28): Rog is out of scope; do not implement his crafts.
Recorded in `docs/operations.md` § 3.7.
