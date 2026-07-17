# PoE Crafting Language — Typing Rules v0

A working formalization of the item/mod model and the core operations.
Grounded in the `poe-tool-dev/dat-schema` fields. Notation is deliberately
light: records, `(x : A) -> B(x)` for dependent functions, tagged sums for
outcomes, and `M before after result` for indexed-monad steps.

This is a design artifact, meant to be edited as the model evolves. Every
rule is annotated with which type-system concept it exercises and which real
schema field it rests on.

---

## 0. Decisions locked so far

- **Outcomes are tagged unions** (sum types). Narrowing is opt-in ("silent
  wide"): you may stay on the union and only use operations valid across all
  arms; you must narrow to use anything arm-specific. Using an arm-specific
  fact without narrowing fails to type-check.
- **Loop primitive is single-exit** with a union after-type; the caller
  narrows after. Multi-exit / folded-in recovery is **sugar** that desugars
  into nested single-exit loops. Only the primitive gets typing rules.
- **Eligibility is binary** (closed-world for now; dataset owns completeness).
- **Weight is provenance-tagged** (Known / Approx / Unknown), probability-only.
- **Coexistence invariant**: ModType-distinct + Family-disjoint + slot
  cardinality + tier-gate + domain-match. Tags are NOT a coexistence rule.
- **Currencies are a standard library, not language features.** The core is
  the type machinery; each currency is a typed library value. Crafter
  techniques are higher-order functions composed from currency primitives.
- **Currencies are game-parameterized.** `chaos` means different operations
  in PoE1 vs PoE2; each game module defines its own. Same machinery, different
  catalog. A `game` tag lives in the item type index so cross-game steps fail
  at the seam (you cannot even construct a PoE1-op-on-PoE2-item step).
- **Dead arms are a type error.** If `wf` proves an outcome arm uninhabited
  for the item's known type, narrowing on that arm is rejected. Uniform-random
  removal is still a real branch — dead-arm rejection only fires on the
  *provably impossible*, never the merely unlikely.

---

## 1. Base data (grounded in dat-schema)

```
Game         = PoE1 | PoE2             -- which game's ruleset this item lives under
GroupId      = ModFamily.Id            -- mutual-exclusion group
TypeId       = ModType.Name            -- tier bucket (all tiers share this)
TagId        = Tags.Id
Domain       = ModDomains   (ITEM | FLASK | MAP | ...)   -- @indexing(first:1)
Gen          = ModGenerationType (PREFIX | SUFFIX | ESSENCE | ...)

Weight =
  | Known   Nat        -- PoE1 shipped ground truth
  | Approx  Nat        -- PoE2 trade-inferred
  | Unknown            -- PoE2 sentinel-only ("can roll, odds unknown")

Mod = {                                 -- one row per TIER (Mods table)
  id        : string,                   -- Mods.Id
  type      : TypeId,                   -- Mods.ModType   (tier bucket)
  families  : Set GroupId,              -- Mods.Families  (exclusion)
  gen       : Gen,                      -- Mods.GenerationType (prefix/suffix/...)
  domain    : Domain,                   -- Mods.Domain
  minLevel  : Nat,                      -- Mods.Level     (tier ilvl gate)
  addsTags  : Set TagId,                -- Mods.TagsKeys
  spawn     : List (TagId, Weight),     -- SpawnWeight_TagsKeys ‖ _Values
}

Base = {                                -- BaseItemTypes row
  id        : string,
  itemClass : ClassId,                  -- BaseItemTypes.ItemClassesKey
  domain    : Domain,                   -- BaseItemTypes.ModDomain (must match Mod.domain)
  tags      : Set TagId,                -- BaseItemTypes.TagsKeys (matched vs spawn)
}
```

---

## 2. The item, indexed

The item's *type* carries what operations branch on. The runtime record:

```
Item = {
  base     : Base,
  ilvl     : Nat,
  rarity   : Normal | Magic | Rare,
  prefixes : List Mod,
  suffixes : List Mod,
}
```

The meaningful **type index** (the indexed-monad state) is:

```
Item[ game, rarity, |prefixes|, |suffixes|, ilvl, present ]
```

where `present` is the set of (TypeId, GroupId) facts we track for guarantees
(e.g. "has mod X"). Counts + rarity drive slot rules; `present` drives the
loop-exit guarantees; `game` isolates the two rulesets.

**Effects are DERIVED, not stored.** The item does not carry an effects field.
Active effects are a pure projection over the mods and augments actually
present (see §9):

```
effects(it) = ⋃ { effectsOf(m) | m in affixes it }      -- effects carried by present mods
            ∪ ⋃ { effectsOf(a) | a in it.augments }       -- effects from socket augments
```

`effectsOf` is a static per-mod/per-augment lookup from the data (a mod either
carries effects or it doesn't). Every operation rule reads `effects(it)`,
recomputed from whatever is present at that moment. This makes desync
**impossible by construction**: there is no separate effects state to keep in
sync — remove a carrier mod (Annul, chaos, removeMeta) and its effect vanishes
from `effects(it)` automatically because the mod it derived from is gone. The
mods/augments are the single source of truth; effects are a view.

**Game isolation.** Every currency in the PoE1 module has `game = PoE1` in
both its before- and after-index; likewise PoE2. Because the indexed-monad
seam requires `after(step_n) = before(step_{n+1})` (the B=C rule), a PoE1
currency applied to a PoE2 item fails to unify at `game` — the same structural
mechanism that stops a Magic item being Exalted. No import-hygiene pass
needed; cross-game mixing is not constructible. Below, `g` is a game variable
that each module instantiates to its own game; a rule written with a literal
`PoE1`/`PoE2` is that-game-only.

### 2.1 Well-formedness invariant (refinement — topic 2)

Every item, at all times, must satisfy (discharged to SMT):

```
wf(it) :=
     |it.prefixes| <= maxPre(it.rarity, effects(it))  -- base 0/1/3, shifted by slot-effects (§9)
  && |it.suffixes| <= maxSuf(it.rarity, effects(it))  -- e.g. "+1 suffix" raises the cap
  && allDistinct  (map .type   (affixes it))     -- (1) no duplicate mod  [ModType]
  && allDisjoint  (map .families (affixes it))    -- (2) mutual exclusion  [Families]
  && forall m in affixes it. m.minLevel <= it.ilvl  -- tier gate  [Mods.Level]
  && forall m in affixes it. m.domain == it.base.domain  -- domain match
```

Tags appear NOWHERE here. Coexistence = ModType-distinct + Family-disjoint
+ slot counts. This is the correction from the dat-schema analysis. Slot caps
take `effects` because slot-cardinality effects (§9) can raise them; with empty
effects, `maxPre/maxSuf` are the plain 0/1/3 constants.

---

## 3. The candidate pool (dependent — topic 3)

`pool` computes, from a *known* item value, the set of mods that can be added.
It is the `Value -> Set` computation that refinements cannot express.

```
pool : (it : Item) -> Set (Mod, Weight)
pool it =
  let restrict = poolRestrictFilters (effects it)   -- e.g. "cannot roll attack" (§9)
      widen    = poolWidenMods       (effects it)    -- e.g. "can roll Marksman"  (§9)
  in
  { (m, w) | m : (Mod ∪ widen),                      -- widen ADDS candidates
      m.domain == it.base.domain                       -- domain partition
      && m.minLevel <= it.ilvl                          -- tier gate
      && classPermitted m it.base.itemClass             -- CraftingItemClassRestrictions
      && m.type    notin (map .type   (affixes it))     -- (1) no dup type
      && disjoint m.families (unions (map .families (affixes it)))  -- (2) exclusion
      && slotOpen it m.gen                              -- (3) slot cardinality (effect-adjusted caps)
      && satisfiesAll restrict m                        -- pool-restrict effects shrink the set
      && w = lookupWeight m it.base.tags                -- spawn weight by BASE tags
      && nonzero w }                                    -- eligibility (Known/Approx/Unknown all nonzero)
```

Pool effects act on two sides: **restrict** shrinks the candidate set
(`satisfiesAll restrict`), **widen** grows it (`Mod ∪ widen`). Both are read
from `effects(it)` (derived, §2); §9 defines the effect kinds.

Two roles of tags, kept separate:
- `lookupWeight m it.base.tags` — BASE item's tags vs mod's spawn array. Eligibility.
- `satisfiesAll filters m` — tags named by an active metamod. Conditional filter.

`nonzero w` is true for `Known n>0`, `Approx n>0`, and `Unknown` (sentinel).
Only a provably-zero weight (PoE1 closed-world) is ineligible.

---

## 4. Currency standard library — typing rules

Currencies are **library values**, not language features. The core provides
the machinery (indexed steps, dependent pools, tagged unions, `wf`); each
game module supplies a catalog of typed operations. Random outcomes produce a
**tagged union** as the result/after; a deterministic operation is the
one-arm degenerate case. Notation for a rule:

```
    <premises>
  --------------------------------  (NAME)
    op : M before after result
```

Common building blocks (below) are helpers used across several currencies:

```
addResult it P =                          -- the union produced by "add one random mod"
  Sum over (m in pool it) of
    Item[game(it), Rare, p + (m.gen=PREFIX), s + (m.gen=SUFFIX), lvl, P ∪ {m.type}]

removeThenAddDet it mX =                   -- deterministic remove-random + add SPECIFIC mX,
  Sum over (m in affixes it                --   ranging only over removals that stay wf
            such that wf(applyRemoveAdd it m mX)) of
    Item[game(it), Rare,
         p - (m.gen=PREFIX) + (mX.gen=PREFIX),
         s - (m.gen=SUFFIX) + (mX.gen=SUFFIX),
         lvl, (P \ {m.type}) ∪ {mX.type}]
```

The `such that wf(...)` filter in `removeThenAddDet` is load-bearing — it is
what makes perfect-essence deterministic on a full-suffix item (§4.7).

---

### 4.1 Transmute  [BOTH games]  (Normal -> Magic, adds 1)

```
    wf(it)   it.rarity = Normal
  ------------------------------------------------------------  (TRANSMUTE)
    transmute : M  Item[g,Normal,0,0,lvl,{}]
                   ( Sum over (m in pool it) of
                       Item[g,Magic, m.gen=PREFIX ? 1:0, m.gen=SUFFIX ? 1:0, lvl, {m.type}] )
                   Unit
```

Additive: `present` gains `m.type`. Game-agnostic (`g` free), so it lives in
a shared base module both games re-export.

### 4.2 Regal  [BOTH games]  (Magic -> Rare, adds 1)

```
    wf(it)   it.rarity = Magic
  ------------------------------------------------------------  (REGAL)
    regal : M  Item[g,Magic,p,s,lvl,P]  (addResult it P)  Unit
```

### 4.3 Exalt  [BOTH games]  (Rare, adds 1 into an open slot)

```
    wf(it)   it.rarity = Rare   p + s < 6   (openSlot it)
  ------------------------------------------------------------  (EXALT)
    exalt : M  Item[g,Rare,p,s,lvl,P]  (addResult it P)  Unit
```

Precondition `p + s < 6` is the refinement that makes "exalt a full item" a
type error. **Additive**: every mod in `P` is preserved — why a guaranteed
mod survives an Exalt.

### 4.4 Annul  [BOTH games]  (Rare, removes 1 at random)  — branching

```
    wf(it)   it.rarity = Rare   |removable it| > 0
  ------------------------------------------------------------  (ANNUL)
    annul : M  Item[g,Rare,p,s,lvl,P]
               ( Sum over (m in removable it) of    -- WHICH affix (uniform over removable)
                   Item[g,Rare, p - (m.gen=PREFIX), s - (m.gen=SUFFIX), lvl, P \ {m.type}] )
               Unit

removable it = affixes it \ protected(effects it, it)   -- protection effects exclude mods (§9)
```

The sum ranges over **removable** affixes = present affixes minus those
protected by an active protection effect (§9). This is the corrected
"cannot be changed" semantics: protection targets **active mods**, not slots.
So under "prefixes cannot be changed", a prefix present when it took effect (or
added later) is removed from `removable`, and Annul's uniform random ranges
only over what's left. Removing that protection effect (removing its carrier)
puts those affixes back into `removable`.

Each arm **loses** that mod's type. Where a guaranteed `X` can die: the arm
`m.type=X` drops `X`; any later step needing `X` forces a narrow — UNLESS `X`
is protected, in which case its arm is absent from the sum and `X` provably
survives (protection can turn a risky Annul into a safe one; that IS the point
of protection metamods). Uniform over the inhabited (removable) arms.

---

### 4.5 Chaos  — DIFFERENT operation per game

`chaos` is the canonical example of game-divergence. Two distinct definitions,
same name, different modules.

**PoE1 — reroll ALL modifiers** (rare stays rare, entire affix set redrawn):

```
    wf(it)   it.rarity = Rare
  ------------------------------------------------------------  (CHAOS@PoE1)
    chaos@poe1 : M  Item[PoE1,Rare,p,s,lvl,P]
                    ( Sum over (fresh affix set A drawn from pool, |A| valid for Rare) of
                        Item[PoE1,Rare, prefixesOf A, suffixesOf A, lvl, typesOf A] )
                    Unit
```

The after-`present` bears **no relation** to the prior `P` — everything is
rerolled. A guaranteed mod does NOT survive PoE1 chaos (unlike Exalt).

**PoE2 — remove one random, add one random** (this is the "chaos" my earlier
draft mistakenly wrote as universal; it is the PoE2 rule):

```
    wf(it)   it.rarity = Rare   p + s > 0
  ------------------------------------------------------------  (CHAOS@PoE2)
    chaos@poe2 : M  Item[PoE2,Rare,p,s,lvl,P]
                    ( Sum over (mOut in affixes it, mIn in pool (afterRemove it mOut) {}) of
                        Item[PoE2,Rare, ...counts..., lvl, (P \ {mOut.type}) ∪ {mIn.type}] )
                    Unit
```

### 4.6 Essence  — DIFFERENT operation per game

**PoE1 — rarity-set + random fill** (turns Normal, or per-tier a Magic/Normal,
into a Rare with random mods; the essence guarantees one specific mod). Tiers
differ in which input rarity they accept; defer full tier catalog. Shape:

```
    wf(it)   essenceApplicable@poe1 e it   mX = guaranteedMod e it
  ------------------------------------------------------------  (ESSENCE@PoE1)
    essence@poe1[e] : M  Item[PoE1, inputRarity(e), _, _, lvl, _]
                         ( Sum over (fresh Rare affix set A containing mX) of
                             Item[PoE1,Rare, ...counts of A..., lvl, typesOf A ∋ mX.type] )
                         Unit
```

Guarantees `mX` present; the *rest* of the affixes are random (hence a `Sum`),
but every arm contains `mX.type`.

**PoE2 — Regal-with-guarantee** (Magic -> Rare, the added mod is the specific
`mX`; deterministic, one arm):

```
    wf(it)   it.rarity = Magic   mX = guaranteedMod e it
    (openSlot it mX.gen)
  ------------------------------------------------------------  (ESSENCE@PoE2)
    essence@poe2[e] : M  Item[PoE2,Magic,p,s,lvl,P]
                         Item[PoE2,Rare,
                              p + (mX.gen=PREFIX), s + (mX.gen=SUFFIX),
                              lvl, P ∪ {mX.type}]
                         Unit
```

No `Sum` — deterministic. `mX.type` enters `present` with certainty.

### 4.7 Perfect Essence  [PoE2]  — remove-random + add-SPECIFIC  ★ key case

Behaves like a chaos (remove one random affix) but the added mod is the
guaranteed `mX`, not random. This is the common method whose determinism is
*state-dependent*:

```
    wf(it)   it.rarity = Rare   p + s > 0   mX = guaranteedMod e it
  ------------------------------------------------------------  (PERFECT-ESSENCE@PoE2)
    perfectEssence@poe2[e] : M  Item[PoE2,Rare,p,s,lvl,P]
                                (removeThenAddDet it mX)
                                Unit
```

The after-type is `removeThenAddDet it mX`: a `Sum` over which affix was
removed, **filtered to removals that leave a wf item after adding mX**. This
single filter produces exactly the behavior described in design:

- `mX.gen = SUFFIX`, item = **2 prefix / 2 suffix**:
  removing a prefix -> (1p,3s) wf ✓ ; removing a suffix -> (2p,2s) wf ✓.
  **Both arms inhabited** -> the `Sum` has two arms -> a real branch; a guide
  must narrow (it can lose a prefix). Uniform random over the inhabited arms.

- `mX.gen = SUFFIX`, item = **3 prefix / 3 suffix**:
  removing a prefix -> (2p,**4s**) wf ✗ (suffixes > 3) -> arm FILTERED OUT ;
  removing a suffix -> (3p,3s) wf ✓.
  **Only the suffix-removal arm inhabited** -> the `Sum` collapses to ONE arm
  -> deterministic. Nobody wrote "on a full-suffix item, remove a suffix" —
  it is a *theorem* of `wf` + the dependent sum, not a special case.

Because dead arms are a **type error** (§0), narrowing on "removed a prefix"
in the 3p/3s case is rejected: the checker proves that arm uninhabited from
the item's known type. Asking about an impossible outcome surfaces as an
error, which (per design rationale) means the author's model of the item's
state diverged from what their own prior steps guaranteed.

---

## 5. Narrowing (opt-in)

Given a value of union type `Sum over i of T_i`, the narrow construct:

```
    narrow e {
      | pattern_1 -> body_1     -- inside: type narrowed to T_1
      | pattern_2 -> body_2     -- inside: type narrowed to T_2
      | _         -> body_wide  -- optional: stays on the full union
    }
```

- Inside arm `k`, the item's type is the precise `T_k` — open slots known,
  `present` set exact. Arm-specific operations type-check here.
- If a `_` wide fall-through is present, unhandled arms flow there with the
  **union** type; only union-valid (branch-agnostic) operations type-check.
- If NO wide fall-through and NO arm covers a case, that's fine ("silent
  wide") **only if** nothing after depends on the missing arm's facts.
  The moment something does, it fails to type-check. Validation is never
  skippable when it's load-bearing.

---

## 6. Loop primitive (single-exit)

The core loop. One entry index, a body, one exit through a **union
after-type** tagged by which terminating condition fired.

```
    body : M S ( Sum over j in Exits of S_j )   result      -- body ends by either
                                                            -- signalling an exit tag
                                                            -- or 'continue'
    continue-arm re-enters at S (invariant preserved)
  ---------------------------------------------------------------------  (LOOP)
    loop body : M S ( Sum over j in Exits of S_j )  result
```

Reading it:
- The **entry index `S`** is the loop invariant.
- The body either **continues** (must re-establish `S` — this is the
  invariant) or **exits** via some tag `j`, landing in `S_j`.
- The loop's after-type is the **union of exit states** `Sum_j S_j`.
- The caller **narrows** on that union (section 5).

Crucially: the after-type carries whatever the exit condition **proves**.
"Chaos until X" exits only through the `has-X` tag, so its after-type is the
single-arm `Item[..., P ∪ {X}]` — the exit condition IS the proof.

Termination is NOT proven (types give post-condition *conditional on exit*).

---

## 7. Worked example — the validation from the design chat

### 7.1 "Chaos until mod X"  (loop-exit-as-proof)  [PoE2 chaos]

```
-- chaos@poe2 : remove one, add one random (§4.5). Game-tagged PoE2.

forceX : M Item[PoE2,Rare,_,_,lvl,P]  Item[PoE2,Rare,_,_,lvl, P ∋ X]  Unit
forceX =
  loop {
    chaos@poe2 ;
    narrow outcome {
      | has-X -> exit has-X          -- the ONLY exit; proves X present
      | _     -> continue            -- re-establish invariant, loop
    }
  }
-- after-type: single arm  Item[PoE2,...,present ∋ X].  X now guaranteed.
```

### 7.2 Exalt preserves X, Annul risks it

```
forceX ;                              -- after: present ∋ X          (guaranteed)
exalt  ;                              -- ADDITIVE: after still ∋ X   (X preserved)
annul  ;                              -- after: Sum over removed affix
                                      --   arm (removed X):  present = P \ {X}  <-- X GONE
                                      --   arm (removed other): present ∋ X
narrow outcome {
  | still-has-X -> ...continue guide...     -- narrowed: present ∋ X, safe
  | lost-X      -> ...recover: re-enter forceX...   -- narrowed: X gone, must rebuild
}
```

If you try to use `X` after the annul **without** narrowing, it fails to
type-check: the un-narrowed union does not prove `present ∋ X`.

### 7.3 "Annul until X is the sole mod"  (sugar over the primitive)

The multi-exit form authors want:

```
forceXAlone : M Item[Rare,_,_,lvl, P ∋ X]  Item[Rare, X-only, lvl, {X}]  Unit
```

Desugars into a single-exit loop with folded-in recovery on the failure arm:

```
forceXAlone =
  loop {
    annul ;
    narrow outcome {
      | x-alone   -> exit x-alone            -- WON: after-type {X} only
      | removed-X -> forceX ; continue        -- BROKEN: rebuild X (nested single-exit loop), loop
      | _         -> continue                 -- other removal, keep going
    }
  }
-- The `removed-X` arm re-enters forceX (whose exit-type proves X back),
-- then continues the annul loop. All primitive; no new rule needed.
```

The type system **forces** the `removed-X` arm to exist: the annul union
contains it, and you cannot reach the success exit without accounting for the
branch where annul destroys X. A guide that ignores its own failure mode does
not type-check.

---

## 8. Open items for next pass

- **Affine carrier lifecycle rules** (topic 5): §9 defines the effects layer
  and the three lifecycles. Still TODO: precise rules for the
  slot-cardinality-reverting case (§9.4) where removing a carrier can drive
  the item temporarily ill-formed. That is the one isolated hard sub-problem.
- **Dead-arm inhabitation check**: each `narrow` arm generates a VC "this arm
  is inhabited given the item's type"; provably-uninhabited arm = type error
  (§4.7). Need to specify the exact VC form and confirm it stays within the
  SMT-decidable fragment (`wf` is linear arithmetic over counts + set
  membership, so it should).
- **PoE1 essence tier catalog**: which tiers accept Normal vs Magic input,
  and the guaranteed-mod table. Deferred; shape given in §4.6.
- **Game module structure**: base module (transmute/regal/exalt/annul, `g`
  free) re-exported by both; `poe1`/`poe2` modules add game-specific ops
  (chaos, essence, perfect-essence). Import rule: a craft fixes one game via
  the item's `game` tag; cross-game steps are unconstructible at the seam.
- PoE1 vs PoE2 **data adapter** for stat ranges (two scalars vs one
  `@interval`) and the relocated PoE2 spawn-weight column. Model-level, not
  type-level — does not touch typing rules.
- Termination/currency-budget reasoning: explicitly out of the type system
  for now (types prove post-conditions conditional on exit).
- `slotOpen` / `openSlot` precise defn against Magic (1+1) vs Rare (3+3).

---

## 9. The effects layer (metamods, augments, and effect-carrying mods)

There is no single "metamod" construct. Instead, certain **carriers** (affix
mods, or augment implicits) contribute **effects** — typed modifications to
the operation rules that are active *while the carrier is present*. This one
abstraction subsumes PoE1 bench metamods, PoE2 effect-essences, delirium
slot-mods, and socket augments. (PoE1 has a bench; PoE2 does not, so its
effects arrive via currency-placed mods and augments instead — but the
*effect* vocabulary is shared.)

### 9.1 Effects and carriers

Two axes matter. The third (lifecycle) is NOT a stored tag — it emerges from
the derived-effects model (§9.4), so it is not represented here.

```
Effect =                                  -- WHAT it does to the rules
  | PoolRestrict  (Mod -> Bool)           -- shrink add-side pool     ("cannot roll attack")
  | PoolWiden     (Set Mod)               -- grow  add-side pool      ("can roll Marksman")
  | Protect       (Gen | Set ModRef)      -- shrink remove-side sum   ("prefixes cannot be changed")
  | SlotDelta     (Gen, Int)              -- shift wf slot cap        ("+1 suffix")
  | OpUnlock      OpCapability            -- make an op legal         ("+20% max quality" -> quality op)

Carrier vehicle =                         -- WHERE it lives
  | AffixCarrier    -- effect rides on a prefix/suffix mod; occupies an affix slot
  | AugmentImplicit -- effect rides on a socket augment; NOT an affix; no affix slot
```

`effectsOf(m)` / `effectsOf(a)` map a mod or augment to the `Effect`s it
carries (often none). `effects(it)` (§2) is the union over present carriers.
Nothing is stored; nothing can desync. A carrier that leaves the item takes
its effects with it, for free.

### 9.2 How effects fold into the rules (summary of the wiring already placed)

- **`pool` (§3)**: `PoolRestrict` filters shrink the candidate set;
  `PoolWiden` sets are unioned in. Multiple of each fold together (AND the
  restricts, UNION the widens).
- **`removable` / Annul (§4.4)**: `Protect` effects subtract their targeted
  affixes from the removal sum. Protection targets **active mods** (per domain
  correction), so a mod added *after* the protection is placed is protected
  too, as long as it matches the protected `Gen`/ref.
- **`wf` slot caps (§2.1)**: `SlotDelta (g, +n)` raises `maxPre`/`maxSuf` for
  gen `g` by `n` while active.
- **Operation preconditions**: `OpUnlock cap` makes an otherwise-illegal op
  (e.g. raise quality past the normal cap) type-check while active.

### 9.3 Acquire / release (the affine part — topic 5)

Only `AffixCarrier` carriers are affine: placing one **occupies an affix slot**
(competes with real mods for 3+3) and must be explicitly removed to free the
slot. `AugmentImplicit` carriers are NOT affine — permanent type-extensions
declared on the input (like base implicits), never competing for affix slots.

Because effects are derived (§2), `placeMeta`/`removeMeta` are just **add-a-mod
/ remove-a-mod**. They carry no effects bookkeeping; `effects(it)` recomputes
after each and picks up or drops the carrier's effects for free.

```
    wf(it)   c is an AffixCarrier mod   slotOpen it c.gen
  ------------------------------------------------------------  (PLACE-META)
    placeMeta[c] : M Item[g,r,p,s,lvl,P]
                     Item[g,r, p+(c.gen=PREFIX), s+(c.gen=SUFFIX), lvl, P ∪ {c.type}]
                     Unit
    -- identical in shape to adding any affix; effects(it') gains effectsOf(c).

    wf(it)   c ∈ affixes it   c is an AffixCarrier
  ------------------------------------------------------------  (REMOVE-META)
    removeMeta[c] : M Item[g,r,p,s,lvl,P]
                      ( after-state depends on c's effect kind, see §9.4 )
                      Unit
    -- for all effect kinds EXCEPT slot-cardinality, the after-state is the
    -- plain affix removal Item[g,r, p-(..), s-(..), lvl, P\{c.type}] and
    -- effects(it') simply loses effectsOf(c). Only SlotDelta needs §9.4.
```

`placeMeta` is a normal additive step. Affinity here is just "a slot-occupying
mod, released by removeMeta" — already enforced by `wf`'s collision rules, not
a new checker feature.

### 9.4 Slot-cardinality removal is governed by plain wf-preservation

Every operation carries the implicit obligation that its after-state is `wf`.
For slot-cardinality carriers (delirium "+1 suffix"), this single existing
rule handles the whole "hard case" with **no new machinery** — the earlier
dependent-sum / grandfathering fork is dropped.

```
Delirium "+1 suffix" carrier, jewel at 1 prefix / 3 suffixes:
    While the carrier is present:
        effectsOf(carrier) ∋ SlotDelta(SUFFIX,+1)  =>  maxSuf = 3.  wf holds.
    Attempting removeMeta[+1suffix] from this state:
        after-state would be 1p / 3s with maxSuf reverted to 2  =>  wf FAILS.
    Therefore removeMeta is NOT a valid operation from a 3-suffix state.
    It simply does not type-check (wf-preservation rejects it), the same way
    any operation with an ill-formed after-state is rejected.

    To legally remove the carrier you must FIRST reduce to <= 2 suffixes
    (e.g. annul a suffix down to 1p/2s), THEN removeMeta -> 1p/2s. wf holds
    throughout. The naked over-cap state (3 suffixes, cap 2) is UNREACHABLE.
```

Consequences:
- No "over-cap grandfathered" mode; `wf` stays a hard invariant everywhere.
- `removeMeta` needs no special after-type for cardinality carriers — the
  generic wf-preservation obligation already forbids the illegal removal.
- Because the naked over-cap state is unreachable, any in-game behavior that
  operates on it (see the chaos-orb suffix-lock quirk, §10.4) is OUTSIDE the
  language's semantics by construction. The language models rules, not the
  implementation artifacts that appear only in states the rules forbid.

### 9.5 Lifecycle is emergent (no stored lifecycle tag)

Because effects are derived (§2) and any *produced* state lives in normal item
fields (quality, mods) rather than in the effects set, the Reverting /
Persisting / Permanent distinction is not something to track — each falls out:

- **"Reverting" non-cardinality** (e.g. "cannot roll attack"): the effect only
  constrained ops while present. removeMeta drops the carrier; effects(it')
  loses it; the constraint lifts. Nothing produced, nothing to undo.
- **"Persisting"** (e.g. breach +20% quality): the effect gated an op that
  wrote to a normal field (quality). That field was never in effects(it), so
  removing the effect leaves it untouched — persistence is automatic, not a
  lifecycle.
- **"Permanent"** (socket augment): lives in it.augments, which ops never
  change, so it is always in the projection. No removeMeta.
- **Cardinality**: governed entirely by wf-preservation (§9.4).

So the only lifecycle logic in the whole layer is §9.4's wf check.

### 9.6 Worked mini-examples

```
"Cannot roll attack" (PoE1 bench, AffixCarrier, PoolRestrict):
    placeMeta[cannotRollAttack] ;        -- occupies a suffix slot
    exalt ;                              -- pool excludes attack-tagged mods (§3 restrict)
    removeMeta[cannotRollAttack]         -- frees slot; restriction ends; wf clean

"Prefixes cannot be changed" protecting a forced prefix (PoE1):
    forceX ;                             -- X is a prefix, present ∋ X
    placeMeta[prefixesCannotChange] ;    -- occupies a suffix slot; Protect(PREFIX)
    annul ;                              -- removable excludes ALL prefixes incl X
                                         -- => X provably survives; NO narrow needed
    removeMeta[prefixesCannotChange]     -- protection ends

"Can roll Marksman" (PoE2 socket augment, AugmentImplicit, PoolWiden):
    -- declared on the input item; not placed/removed. pool (§3) unions Marksman
    -- mods into candidates for every generating op. No affix slot used. Permanent.

"+20% max quality" (PoE2 essence of the breach, AffixCarrier, OpUnlock):
    placeMeta[breachQuality] ;           -- adds a prefix; unlocks over-cap quality op
    raiseQuality ;                       -- legal only while OpUnlock present; writes quality FIELD
    removeMeta[breachQuality]            -- prefix + effect gone; quality field untouched => STAYS
                                         -- persistence is automatic: quality was never in effects(it)
```

---

## 10. Omens (PoE2 operation-directing metamods)

Omens are a distinct vehicle from §9 effects. They are separate consumable
items that, while **active**, direct the behavior of a specific operation
type — but (unlike §9 carriers) they are NOT mods/augments on the item and do
NOT appear in `effects(it)`. They live in a parallel **omen context** Ω.

### 10.1 Modeling decision: enable/disable context, not consumable inventory

Omens are modeled as a **boolean context** Ω = the set of currently-enabled
omens, NOT a finite resource with counts. Rationale: crafting is chance-based,
so real Omen *cost* is a function of expected attempts over a whole craft —
that belongs to a future cost/attempts model (§8), separate from the per-op
*logic* the type system checks. The type system only needs to know which
omens are active for a given operation. So omens are treated as infinite in
supply, toggled on/off:

```
enableOmen[o]  : M[Ω]  Item[..]  Item[..]  Unit    with  Ω -> Ω ∪ {o}
disableOmen[o] : M[Ω]  Item[..]  Item[..]  Unit    with  Ω -> Ω \ {o}
```

Ω is threaded through the indexed monad alongside the item (write `M[Ω]` for
"indexed step carrying omen context Ω"). Operations read Ω; they do NOT consume
from it — an enabled omen stays enabled until explicitly disabled.

**Sugar (language-level, not type-level):** "omen the next operation only"
desugars to a scoped bracket:

```
withOmen[o] { op }   ≡   enableOmen[o] ; op ; disableOmen[o]
```

The type system only ever sees enable/disable; the "just next op" convenience
is surface syntax. (Minimal primitive + desugaring, per project convention.)

### 10.2 Omens direct an operation by shrinking its outcome sum

An active omen changes the after-type of its target operation, and adds a
precondition whose failure is a **type error** (matching the game's "operation
fails with an error" when the omen's constraint can't be met).

```
Omen of Dextral Exaltation  (next Exalt forced to a SUFFIX):

    wf(it)   it.rarity = Rare   suffixOpen it   (dextralExalt ∈ Ω)
  ------------------------------------------------------------  (EXALT | DEXTRAL)
    exalt : M[Ω]  Item[g,Rare,p,s,lvl,P]
                  ( Sum over (m in pool it, m.gen = SUFFIX) of    -- SUFFIX arms only
                      Item[g,Rare, p, s+1, lvl, P ∪ {m.type}] )
                  Unit

Omen of Sinistral Annulment  (next Annul forced to remove a PREFIX):

    wf(it)   it.rarity = Rare   (∃ removable prefix)   (sinistralAnnul ∈ Ω)
  ------------------------------------------------------------  (ANNUL | SINISTRAL)
    annul : M[Ω]  Item[g,Rare,p,s,lvl,P]
                  ( Sum over (m in removable it, m.gen = PREFIX) of  -- PREFIX arms only
                      Item[g,Rare, p-1, s, lvl, P \ {m.type}] )
                  Unit
```

- `suffixOpen it` / `∃ removable prefix` are the preconditions that turn "no
  legal target for the forced direction" into a **type error** — exactly the
  game erroring when e.g. an item has no open suffix under Dextral Exaltation.
- The directed sum is the base operation's sum **intersected** with the omen's
  constraint. Same "shrink the set an operation ranges over" shape as pool
  filters and protection — omens just apply it per-operation from Ω.
- If the intersection is a SINGLE arm, the operation is now deterministic
  (e.g. Dextral Exalt when exactly one open slot is a suffix). This is the
  primary way PoE2 crafters turn random ops into forced ones.

### 10.3 Combining omens

Ω is a set, so an operation folds in ALL active omens matching it: its outcome
sum is intersected against every applicable omen's constraint.

```
Two exalt-directing omens both in Ω  =>  exalt's sum is intersected against both.
Contradictory constraints (e.g. force-SUFFIX ∧ force-PREFIX on one exalt)
  =>  the directed sum is EMPTY  =>  an operation with no possible outcome
  =>  TYPE ERROR (uninhabited outcome, same rule as dead-arm §4.7).
```

Whether contradictory omens are prevented at enable-time or only rejected at
use-time is an open ergonomics choice (§10.5).

### 10.4 The chaos-orb suffix-lock quirk is DELIBERATELY not modeled

The in-game behavior where a chaos orb on a 1-prefix/3-suffix jewel fails ~50%
of the time / only ever changes a prefix (the suffixes "locked") is, by
analysis, a bug: the game appears to pick a modifier to remove before checking
legality, and aborts when it picks a suffix in an over-cap state.

This is **not modeled**, on principle:
- The language models the game's RULES; a bug is where the implementation
  DIVERGES from the rules. Encoding it would assert invalid behavior as valid.
- It is expected to be patched; guides relying on it would silently break.
- Its precondition is the naked over-cap state (1p/3s, cap 2), which §9.4
  makes **unreachable** in the language. So the state this quirk operates on
  does not exist in the semantics, and the question "what does chaos do here"
  never arises.

A crafter exploiting the bug in-game is using a technique OUTSIDE the
language's guarantees. A rule-fidelity tool correctly declining to bless it is
a feature, not a gap.

### 10.5 Open items (omen layer)

- Precise catalog of PoE2 omens and their per-operation constraints (Dextral/
  Sinistral Exaltation & Annulment, and the many others), each as an
  intersection constraint on a specific operation's sum.
- Contradictory-omen handling: reject at enable-time (Ω may not hold a
  conflicting pair) vs. at use-time (empty-sum type error). Leaning use-time
  (uniform with dead-arm §4.7), but enable-time gives earlier errors.
- Whether any omens direct operations OTHER than by shrinking the outcome sum
  (e.g. omens that change WHICH operation happens, or add steps). If all omens
  are sum-intersection constraints, the layer stays uniform; if not, some need
  bespoke rules.
- Interaction of omens with the future cost/attempts model (§8): Ω toggling is
  free in the type system, but each *enabled* omen consumed on a real attempt
  feeds the cost accounting.
