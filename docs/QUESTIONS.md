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

### Q7 · game probe · open

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
**Answer:**

### Q15 · decision · open

**Asked:** 2026-10-28
**Question:** the [Orb of Chance](https://www.poewiki.net/wiki/Orb_of_Chance) has three
outcomes: Magic (as a transmute), Rare (as an alchemy), or Unique, where the craft ends.
The abstract item holds one rarity, so the orb needs either a set of rarities in the
state (the `ROADMAP.md` Step 2 remainder wants the same for a scour on an uncertain
count) together with a way to say the item has left the crafting domain, or a surface
form that fixes the outcome by looping (`until isRare { chance; scour }`), which still
needs the set inside the loop. The usual guide is "scour-chance until unique", about
which only cost modelling has anything to say. Options: (1) build the rarity set and a
`unique` rarity no later operation accepts; (2) leave the orb out of scope, like Rog.
Recommendation: (2) until a guide needs it. The single rarity also bites where paths
meet: an `if` whose arms leave the item at different rarities, or a loop whose body
changes it, is joined to the first path's rarity (`check/astate.ts` `join`), a known gap
that a set of rarities would close; guides that branch on the rarity afterwards are not
caught. An imprint whose two sides differ in rarity is dropped by the same join, so a
`restore` after it is refused.
**Assumed meanwhile:** not built; the ledger rows for the Orb of Chance and the bench's
"Reroll the rarity" are marked **later** in `operations.md` §3.
**Answer:**

### Q16 · game probe · open

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
**Answer:**

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

### Q18 · clarification · open

**Asked:** 2026-10-28
**Question:** which pairs the Harvest "change a modifier into a similar tier modifier"
crafts offer. The wiki cache has the craft's description
([Harvest crafting](https://www.poewiki.net/wiki/Harvest_crafting): fire resistance to
lightning resistance as the example; a damage variant that excludes critical strike
multiplier) but not the option table. `harvest change "<mod>" "<mod>"` accepts any pair
whose target rolls on the base.
**Assumed meanwhile:** the resistances (fire, cold, lightning, each to each other) and
the damage types; the checker does not validate the pair (`check/check.ts`
`checkHarvestChange`).
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

---

## Resolved

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
influence currencies (ROADMAP Step 4).
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
the item as it was. Implementation is `ROADMAP.md` Step 2.

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
