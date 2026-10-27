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

### Q1 · decision · open

**Asked:** 2026-10-26
**Question:** Affix capacity is computed in three places (`check/counts.ts`, `model/wf.ts`,
and a literal 6 in `currency/base.ts`). Route the concrete layer and the pool through
`counts.ts` (recommended), delete the concrete library instead, or merge the two modules?
**Context:** `pool.slotOpen` used the incomplete `wf.ts` formula and sits on the
checker's path, so on a rare Ratcheting Ring the add-pool was wrong in the unsound
direction (ROADMAP Step 1 bug 10).
**Applied meanwhile:** option 1. The formula lives once in `model/capacity.ts`; `wf`,
the pool, the concrete exalt and the count domain read it, and `wf` gained the
combined-cap clause. Ruling otherwise means moving or duplicating that module.
**Where the assumption lives:** `packages/core/src/model/wf.ts`,
`packages/core/src/pool/pool.ts`, `packages/core/src/currency/base.ts`, their tests.
**Answer:**

### Q2 · decision · open

**Asked:** 2026-10-26
**Question:** The item's tag set. Implement the tags a present modifier adds
(`adds_tags`) in the pool now and defer influence (recommended), implement both, or
leave the pool matching on base tags only?
**Context:** 235 jewel modifiers key on a `specific_weapon` tag that
another jewel modifier adds; without it the jewel pool overstates what can roll, which
makes `until has X` look reachable when it is not.
**Applied meanwhile:** added tags only (`pool.itemTags`); influence arrives with the
influence currencies (ROADMAP Step 4).
**Where the assumption lives:** `packages/core/src/pool/pool.ts`, `pool.test.ts`.
**Answer:**

### Q3 · decision · open

**Asked:** 2026-10-26
**Question:** What the concrete `Item` carries. Only what the pool reads (influence, once
it exists; recommended), a faithful item with fractured/veiled/influence marks, or the
present subset with the spec stating that marks are checker-only?
**Context:** `docs/item-model.md` §10 is the open question in the spec.
**Assumed meanwhile:** option 3. Fracture and veiled state stay in the checker; the
concrete item gains fields only when the pool needs them.
**Where the assumption lives:** `docs/item-model.md` §7 and §10 once rewritten.
**Answer:**

### Q4 · decision · open

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
**Answer:**

### Q5 · decision · open

**Asked:** 2026-10-26
**Question:** Go ahead with the core-operations redesign proposed in
`operations.md` (every crafting method compiled to a handful of primitive effects on
the abstract item), or keep one transfer function per currency?
**Context:** the analysis in that doc; it changes the shape of `check/transfer.ts` but not
the abstract domain, and it is what makes the remaining crafting surface tractable.
**Assumed meanwhile:** the bug fixes land first in the current structure (their tests
carry over); the redesign waits for the answer.
**Where the assumption lives:** nowhere yet.
**Answer:**

### Q6 · decision · open

**Asked:** 2026-10-26
**Question:** The typing-rules design doc (crafting-lang-typing-rules-v0.md, now deleted) was retired in
favour of `operations.md`. Most of it described designs never built (`narrow`, game
modules, PoE2 operations, augments, `OpUnlock`, `placeMeta`); what was built is covered by
`ARCHITECTURE.md`, `item-model.md` and `operations.md`. Keep it retired, or restore it as
an explicitly historical design record?
**Assumed meanwhile:** retired; git history keeps it.
**Where the assumption lives:** `docs/`, the code comments that used to cite its sections.
**Answer:**

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

### Q8 · game probe · open

**Asked:** 2026-10-26
**Goal:** whether a Chaotic Resonator (fossils) accepts a Normal item.
[Crafting](https://www.poewiki.net/wiki/Crafting) says fossils are "only usable on rare
items"; [Resonator](https://www.poewiki.net/wiki/Resonator) likens the Chaotic one to a
Chaos Orb and the Alchemical one to an Orb of Alchemy.
**Procure:** a Normal base, a Chaotic Resonator with one fossil.
**Steps:** try to apply it. **Record:** accepted or refused.
**Assumed meanwhile:** Chaotic needs Rare, Alchemical needs Normal (the Resonator page).
**Answer:**

### Q9 · game probe · open

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
**Answer:**

### Q11 · game probe · open

**Asked:** 2026-10-26
**Goal:** the rarity an Orb of Scouring leaves on an item with two fractured modifiers.
[Fractured item § Mechanics](https://www.poewiki.net/wiki/Fractured_item#Mechanics) says
"a Rare item if it had two or three fractured mods";
[Tainted Chaos Orb § Mechanics](https://www.poewiki.net/wiki/Tainted_Chaos_Orb#Mechanics)
says one fractured prefix and one fractured suffix "results in a magic item".
**Procure:** an item with one fractured prefix and one fractured suffix (a Recombinator or
a talisman with two beast-fractured modifiers).
**Steps:** scour it. **Record:** the resulting rarity.
**Assumed meanwhile:** the lowest rarity whose caps hold the survivors (Magic for one of
each side), which is what `rarity(lowest)` in `operations.md` and the checker's scour do.
Only reachable through the multi-fracture routes Hinekora does not model yet.
**Answer:**

### Q12 · game probe · open

**Asked:** 2026-10-26
**Goal:** whether a Veiled Chaos Orb refuses an item that carries an unveiled modifier.
[Veiled Exalted Orb](https://www.poewiki.net/wiki/Veiled_Exalted_Orb) says it cannot be
used "on an item with a veiled modifier or its craftable versions"; for the Veiled Chaos
Orb the wiki says only that it "cannot be used to obtain multiple veiled modifiers"
([Crafting](https://www.poewiki.net/wiki/Crafting)).
**Procure:** a Rare with an unveiled modifier (veiled chaos, then unveil) and a Veiled
Chaos Orb.
**Steps:** try to apply it. **Record:** accepted or refused.
**Assumed meanwhile:** refused, the stricter reading, in `check/transfer.ts`
(`veiledChaos`) and the Veiled Chaos Orb row of `operations.md`.
**Answer:**

### Q10 · clarification · open

**Asked:** 2026-10-26
**Question:** [Rog](https://www.poewiki.net/wiki/Rog)'s crafting options are not listed on
the wiki. Is Rog in scope for the crafting surface, and if so what source should define
his options (poedb, in-game notes)?
**Assumed meanwhile:** out of scope until a source exists.
**Answer:**

---

## Resolved

_None yet._
