# The cost of a craft: how the game rolls, what the yardstick computes, where prices come from

> Research notes (see `README.md`): the investigation behind hinekora's cost layer, the
> probability of each step against the modifier pool and the currency it is expected to
> consume. Gathered 2026-11-09 from the local poewiki cache, the RePoE export the catalog is
> built from, craftofexile.com's own code, and poe.ninja. Everything here is evidence and
> analysis; the design that follows from it is §5, and what the code does is
> `../ARCHITECTURE.md` §7 and `../REFERENCE.md` once built. The docs check does not scan this
> directory, so this file may name code that does not exist yet.

**How to read the labels.** [wiki] is verified against the local cache (page named);
[data] is read off the RePoE export the catalog is projected from, or the wiki's Cargo
tables in the cache; [coe] is read off craftofexile.com's `package.js` (version
`1786125802`, Allflame 3.29 data); [ninja] is poe.ninja's live API as probed on 2026-11-09;
[assumed] is a rule no source states, recorded as a question in `../QUESTIONS.md`.

---

## 1. How the game weights a roll

### 1.1 Spawn weights, first match wins

A modifier row (one tier) carries an ordered list of (tag, weight) pairs. The item's tags
are matched against it in order; the first tag the item carries decides, a zero weight
disables the row, and the weight is the row's share of the draw
([Modifier § Spawn weight tag](https://www.poewiki.net/wiki/Modifier#Spawn_weight_tag))
[wiki]. The item's tags are the base's plus the `adds_tags` of present modifiers plus the
influence tags (`QUESTIONS.md` Q2, Q13, Q26). A second table, the generation weights, is
read the same way and scales the result in percent; a zero there disables the row too
(`Mod.generation`, `lookupWeight`) [data]. So **the catalog already holds every number the
probability of a draw needs**: `lookupWeight(mod, tags)` is the weight, and the pool the
checker computes (`addableMods`, `rollableTiers`) is the set of rows in the race.

### 1.2 The draw

A reforge rolls an affix count first, then draws modifiers one at a time, each a weighted
draw without replacement from the rows still eligible: a row is ineligible once its side is
full, once a modifier of its group is on the item (one per group,
[Modifier § Group/family](https://www.poewiki.net/wiki/Modifier#Group/family)), and once a
tag it zeroes on has been added by an earlier draw (Q13). The wiki states the group rule
and the tag rule but not the draw order; craftofexile's emulator implements exactly this
sequence (`poec_simRollAffix`: pick a weighted row from the pool of both sides, remove its
group's rows and close its side when full, repeat) [coe], and every community calculator
agrees. Treated as settled.

### 1.3 The affix count of each method

| Method                                                     | Count                       | Source                                                                                                                                                                                                                                                                 |
| ---------------------------------------------------------- | --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Chaos Orb                                                  | 4, 5, 6 at 8:3:1            | [Chaos Orb § Mechanics](https://www.poewiki.net/wiki/Chaos_Orb#Mechanics) [wiki]                                                                                                                                                                                       |
| Orb of Alchemy                                             | 4 to 6; 3 to 4 on a jewel   | [Orb of Alchemy](https://www.poewiki.net/wiki/Orb_of_Alchemy) [wiki]; the ratio is not stated; craftofexile uses 8:3:1 for 4-6 and 65:35 for 3-4 (`affNumProbs`) [coe]                                                                                                 |
| Essence (any tier)                                         | 4 to 6 including the grant  | "similar to an Orb of Alchemy", "like a Chaos Orb" ([Essence § Crafting](https://www.poewiki.net/wiki/Essence#Crafting)) [wiki]; craftofexile rolls 3, 4, 5 random modifiers at 8:3:1 beside the guaranteed one (`essNumProbs`) [coe]                                  |
| Resonator                                                  | 4 to 6                      | "similarly to a Chaos Orb" ([Resonator](https://www.poewiki.net/wiki/Resonator)) [wiki]; 8:3:1 [assumed, Q56]                                                                                                                                                          |
| Harvest reforge                                            | 4 to 6 including the tagged | the option text says only "reforge" ([Harvest crafting](https://www.poewiki.net/wiki/Harvest_crafting)) [wiki]; 8:3:1 with the tagged modifier drawn among the tag's rows by weight [assumed, Q56, Q60]                                                                |
| Veiled Chaos Orb                                           | 4 to 6 including the veiled | as a Chaos Orb ([Veiled modifier](https://www.poewiki.net/wiki/Veiled_modifier)) [wiki]; 8:3:1 [assumed, Q56]                                                                                                                                                          |
| Orb of Transmutation, Orb of Alteration, Harvest randomise | 1 or 2                      | "a prefix, suffix, or both" ([Orb of Transmutation § Spending](https://www.poewiki.net/wiki/Orb_of_Transmutation#Spending)) [wiki]; the odds are not stated; craftofexile uses one half each, the single modifier's side by weight share (`affNumProbs[1]`) [coe]; Q55 |
| Orb of Augmentation, Regal, Exalted, the influence exalts  | exactly 1                   | the orbs' pages [wiki]                                                                                                                                                                                                                                                 |
| Vaal Orb's reforge, Locus                                  | 6 (the base's cap)          | [Vaal Orb § Equipment](https://www.poewiki.net/wiki/Vaal_Orb#Equipment) [wiki]                                                                                                                                                                                         |

The prefix/suffix split of a count is not a separate roll: it falls out of the draw (§1.2),
a draw landing on whichever side its row belongs to until a side is full. craftofexile
approximates the split with independent draws at the prefix pool's weight share `x`, a
draw that lands on a full side going to the other (`affNumProbs`, the `f` formulas such as
`(2/3)*(x**2+2*(x**2)*(1-x))` for two prefixes and one suffix out of three) [coe], which
ignores depletion but is otherwise the same model.

### 1.4 Biases

- **Essences** force one row (the class's grant) and cap the random fill's modifier level
  by tier ([Essence § Crafting](https://www.poewiki.net/wiki/Essence#Crafting)) [wiki]; the
  random modifiers roll at their natural weights. The grant's group is on the item before
  the fill, so its group is out of the random draw.
- **Fossils** multiply the weights of rows carrying a category tag ("More Life modifiers":
  ×10, written `1000` in the data), zero those carrying another ("No Defence modifiers"),
  and their multipliers reach the fossil-only rows too
  ([Fossil](https://www.poewiki.net/wiki/Fossil), the "Fossil weight multipliers" table)
  [wiki]. Each fossil affects a row once however many of its tags match; whether the
  "more" multipliers of several fossils add or multiply is disputed, additive being "the
  more widely accepted theory" [wiki]. craftofexile has both modes and defaults to
  additive (`poec_cFosMode`, `poec_getModdedWeight`) [coe]. The multipliers are in the
  export (`positive_mod_weights`, `negative_mod_weights`) [data] but the catalog's
  projection keeps only the zeros (`FossilSpec.blockedTags`); the cost layer needs the
  positive ones too (§5.6). Prismatic and Corroded carry compound conditions ("Physical
  AND Ailment") that the data expresses as hybrid entries [coe]; the Sanctified Fossil
  scales by modifier level and the Tangled Fossil picks a random tag [wiki]; all three are
  out of the first cut.
- **Harvest** "reforge including a `<tag>` modifier" guarantees one tagged modifier
  ([Harvest crafting](https://www.poewiki.net/wiki/Harvest_crafting)) [wiki]; which tagged
  row lands is not stated. craftofexile treats the craft as an essence whose forced row is
  drawn among the tag's rows by weight [coe]. The "more / less likely" reforges change the
  weights of the modifier types already present by an unstated factor
  (`ReforgeMoreLikely`, `ReforgeLessLikely` in the cargo `harvest_crafting_options`) [data];
  out of scope (`../operations.md` §3.5).
- **Veiled** orbs add a placeholder whose side is random when both are open; the Veiled
  Exalted Orb's removal is a random modifier respecting the "cannot be changed" metamods
  only ([Veiled Exalted Orb](https://www.poewiki.net/wiki/Veiled_Exalted_Orb)) [wiki]. An
  unveil offers three of the unveiled rows valid on the base, less the groups already
  present ([Veiled modifier](https://www.poewiki.net/wiki/Veiled_modifier)) [wiki]; the
  rows carry spawn weights in the export (207 of 258 unveiled rows) [data] and the wiki
  records a rebalance of "the weighting of Veiled modifiers" [wiki], so the three are a
  weighted draw without replacement [assumed, Q61].
- **Eldritch** Embers and Ichors set an implicit of their tier; which implicit is a weighted
  draw among the tier's rows for the class (the rows carry `gloves: 1000`-style spawn
  entries) [data]. The Orb of Conflict raises one implicit and lowers the other with a
  chance of 50% at equal tiers, shifting by about 11 points per tier of difference against
  the higher one ([Orb of Conflict](https://www.poewiki.net/wiki/Orb_of_Conflict)) [wiki].
- **Removals.** The Orb of Annulment "removes a random modifier"
  ([Orb of Annulment](https://www.poewiki.net/wiki/Orb_of_Annulment)) [wiki]; nothing says
  the choice is weighted, and every calculator takes it as uniform over the removable
  modifiers [coe] [assumed, Q58]. The same reading serves the Veiled Exalted Orb's removal,
  the Harvest augment's, the beast recipes' and the Orb of Dominance's.
- **Values.** A roll's value is uniform over its row's range as far as anyone knows; the
  Divine Orb rolls every unfractured modifier's value again within its tier
  ([Divine Orb](https://www.poewiki.net/wiki/Divine_Orb)) [wiki]. A `has "life" >= 110`
  exit therefore succeeds with the share of the row's integer range at or above 110, per
  Divine, assuming a uniform roll [assumed, Q62].
- **Recombinator.** The wiki gives the output count per pooled count as a table
  ([Recombinator § Unpredictable Recombination](https://www.poewiki.net/wiki/Recombinator#Unpredictable_Recombination):
  one modifier pooled → 41% none / 59% one; two → 66.7% / 33.3%; three → 40/50/10; four →
  10/60/30; five → 43/57 for two or three; six → 30/70) and says which modifiers survive is
  weighted "although the exact formula is unknown" [wiki]. The count table is usable; the
  modifier selection is not. Later.

### 1.5 What the abstract item contributes

The checker's state at a step is a set of items, not one item. For a reforge that strips
everything the set does not matter: the pool is the base's at its level plus the tags of
the kept modifiers (fractured, protected) and of the influence, all of which are facts the
state holds for sure (`guaranteedFacts`). For an add (an Exalted Orb, a Harvest augment)
the pool depends on which modifiers are present, and a modifier the state holds as
_possible_ (the "random" prefix of a bought item, a modifier a reforge may have rolled)
may or may not shrink the pool. The checker reads such a pool twice, as a superset
(`addableMods`, optimistic tags) and as a subset (`subsetMods`, pessimistic), because it
needs both bounds. A probability needs one pool. §5.2 says which.

---

## 2. What craftofexile computes, and how

Read off `package.js` (`poec_computeFinalProbsV2`, `poec_computePermutationsV2`,
`poec_computeFCTrueCalc`, `poec_getModdedWeight`, `poec_simRollAffix`, the `*NumProbs`
tables) on 2026-11-09 [coe]. The calculator takes a base, an item level, a method and a set
of required modifiers (each a type with a tier range) and reports the chance per attempt
and the expected cost.

1. **Weights.** Each row's weight is the spawn weight for the base, scaled by the fossils'
   multipliers (blocked rows at zero), the Sanctified Fossil's level factor and the Opulent
   Fossil's tagless exclusion (`poec_getModdedWeight`).
2. **Counts and split.** The affix count and the prefix/suffix split come from a table per
   method (`affNumProbs` for 3/3, 2/2 and 1/1 caps, `essNumProbs` with a forced row,
   `glholNumProbs` for a Glyphic or Hollow Fossil): 8:3:1 over 4–6 with the split by the
   binomial formulas of §1.3 in `x`, the prefix pool's share of total weight.
3. **Per side, given its count.** Two regimes, switched at `numModifersToExact = 10`
   eligible modifiers on the side. **Exact**: enumerate every combination of `num` rows that
   contains the required ones and, for each permutation of it, multiply
   `weight / remaining` where `remaining` starts at the side's total and loses the drawn
   row's whole group weight after each draw (sequential sampling without replacement with
   group exclusion, exactly §1.2 on one side). **Extrapolation** (ten or more): only the
   required rows are permuted; the other draws are "fictional picks" that each remove the
   average group weight of the non-required groups from `remaining`, a mean-field
   depletion. A required modifier wanted at several tiers is one group whose weight is the
   tiers' sum (`rbyg`, "required by group").
4. **Both sides.** The per-side results are combined over the split table
   (`penddist`), prefix and suffix independent given the split.
5. **Cost.** Expected attempts is `ceil(1 / p)`; the cost is attempts times the method's
   price plus, per attempt, a resonator and its fossils (`poec_computeFCTrueCalc`), prices
   from the site's own snapshot `json/data/prices/poec_prices.json`, which is keyed by
   poe.ninja league name and holds chaos values (`"Divine Orb": 104.9` in the current file,
   stamped `v=1785166458`, 2026-07-27, so a league-start snapshot).

What it does not do: condition on the item the method is applied to beyond its metamods and
fractured modifiers (the item is the base), chain steps (each method is costed alone), or
treat loops (the per-attempt chance is the output; "tries" is the reciprocal). Its
simulator is Monte Carlo over the same emulator.

**Verdict for the yardstick.** For a single reforge with few wanted modifiers the exact
regime is the true distribution of §1.2 up to the independent-split approximation; it is
what hinekora should agree with to within that approximation. In the extrapolation regime
craftofexile's own numbers are approximate, so a disagreement there is not a defect by
itself. The sections below record the comparison once the implementation exists.

---

## 3. The economy source

poe.ninja's documented `/api/data/currencyoverview` endpoint answers 404 for every league
spelling tried (`Allflame`, `allflame`), with or without the `/poe1` prefix [ninja]. The
site is an Astro page that fetches its tables from
`https://poe.ninja/poe1/api/economy/exchange/current/overview?league=<League>&type=<Type>`,
found by listing the page's resource timings in the browser [ninja]. Facts established with
five requests (a truthful user agent, `hinekora-cost-research/0.1 (…)`):

- `league` is the display name (`Allflame`, from `/poe1/api/data/index-state`
  `economyLeagues[].name`); the URL slug `allflame` returns an empty body with status 200.
- `type` ∈ `Currency` (100 lines: the orbs, the four lifeforces, the eldritch currency,
  catalysts, the Tainted orbs), `Essence` (53), `Fossil` (21), `Resonator` (4). `Beast`
  returns no lines; the Bestiary is priced elsewhere (not probed; the beasts stay unpriced).
- The shape is `{ core: { items, rates: { divine: 0.002127 }, primary: "chaos", secondary:
"divine" }, lines: [{ id, primaryValue, volumePrimaryValue, maxVolumeCurrency,
maxVolumeRate, sparkline }], items: [{ id, name, image, category, detailsId }] }`.
  `primaryValue` is the price in Chaos Orbs; `rates.divine` is chaos per divine inverted
  (1 / 0.002127 = 470 chaos per Divine Orb, which is the `divine` line's own
  `primaryValue` of 470.1). Ids are slugs of the names (`deafening-essence-of-greed`,
  `pristine-fossil`, `primitive-chaotic-resonator`, `vivid-lifeforce`, `veiled-chaos-orb`,
  `orb-of-conflict`), the classic orbs abbreviated (`alch`, `alt`, `aug`, `regal`, `annul`,
  `scour`, `exalted`, `transmute`, `vaal`).
- Sample values on 2026-11-09, Allflame, in chaos: Divine 470.1, Exalted 3.06, Annulment
  17.5, Alteration 0.176, Augmentation 0.018, Regal 0.055, Scouring 1.2, Veiled Chaos Orb
  141.5, Veiled Exalted Orb 4760, Fracturing Orb 442, Orb of Conflict 693, Eldritch Chaos
  Orb 43.2, Lesser Eldritch Ember 2.59, Awakener's Orb 1222, Hunter's Exalted Orb 1358;
  Wild / Vivid / Primal / Sacred lifeforce 0.026 / 0.26 / 0.047 / 228 per unit; Deafening
  Essence of Greed 2.66, of Misery 9.02; Pristine Fossil 11.3, Dense 26.8, Primitive
  Chaotic Resonator 0.32, Potent 0.57.

The endpoint is internal and may change without notice (the documented one did), and the
site blocks crawlers, so the source of truth for hinekora is a **snapshot committed to the
repository** with its provenance (league, the endpoint, the fetch time, the divine rate),
refreshed by a script that makes one request per type, four in all, and nothing else; a
guide's cost is "as of" the snapshot's date. The 3.30 league starts 2026-11-13; the first
snapshot is Allflame's closing week, the next the new league's once poe.ninja lists it.

Prices the snapshot cannot give: the bench's crafts (paid in currency the bench names, read
from the export's `cost` field per option, which the catalog's projection drops today
[data]; the five metamods cost 2 Divine Orbs each, a life craft an Orb of Alchemy or two),
Harvest crafts (lifeforce amounts per craft in the cargo `harvest_crafting_options`: 50 Wild
for a fire reforge, 75 Wild for life, 100 Vivid for chaos, 200 Primal for minion, 5000 Primal
and a Sacred for the influence reforge) [data], beasts (unpriced), and the Allflame bench
(out of scope).

---

## 4. Open questions, each with a recommendation

Recorded as `../QUESTIONS.md` Q54–Q62 with the assumption the code proceeds under.

| #   | Question                                                                                               | Recommendation                                                                                                                                                                       |
| --- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Q54 | What a probability means over an abstract state: a point estimate under stated assumptions, or bounds? | Point estimates, computed on the paths the guide is on (the guaranteed facts), with the assumptions named in the report; bounds later if a guide needs them (§5.2).                  |
| Q55 | The odds of one versus two modifiers from an Orb of Transmutation or Alteration.                       | One half each, craftofexile's model, until a probe counts them.                                                                                                                      |
| Q56 | Whether essences, resonators, Harvest reforges and the Veiled Chaos Orb share the Chaos Orb's 8:3:1.   | Yes (craftofexile's model for essences; the wiki likens each to a Chaos Orb).                                                                                                        |
| Q57 | Whether several fossils' "more" multipliers add or multiply.                                           | Add (the wiki's "more widely accepted theory", craftofexile's default).                                                                                                              |
| Q58 | Whether a random removal is uniform over the removable modifiers.                                      | Uniform.                                                                                                                                                                             |
| Q59 | The economy source and its refresh: which league, how often, who runs it.                              | A committed snapshot from poe.ninja's exchange overview, four requests per refresh, refreshed by hand at least weekly and at the league start; the report names the snapshot's date. |
| Q60 | Which tagged row a Harvest reforge places.                                                             | One of the tag's rows, by spawn weight, the remaining count drawn as a Chaos Orb would.                                                                                              |
| Q61 | Whether an unveil's three options are a weighted draw.                                                 | Yes, by the unveiled rows' spawn weights, without replacement.                                                                                                                       |
| Q62 | Whether a modifier's value is uniform over its range.                                                  | Yes.                                                                                                                                                                                 |

---

## 5. The design that follows

Built as described, with two things learned on the way: a make-room loop (random removals
until the counts allow) is not a memoryless sequence of attempts and is solved as a chain
over the counts instead (§5.5), and the walk keeps one branch per arm of the `if`s passed
since the last roll so that a later condition is judged jointly with them rather than
multiplied in. The symbol-level account is `../REFERENCE.md` §3a and the shape
`../ARCHITECTURE.md` §7; where this section and those differ, those are current.

### 5.1 A second interpretation beside the checker, never inside it

The checker proves; the cost layer estimates. They read the same op sequences
(`check/library.ts`) and the same pools, but the cost layer lives in its own module
(`packages/core/src/cost/`) and consumes the checker's output (the trace, which holds the
abstract item before every statement and the loop invariants) rather than changing the
transfer functions. Nothing it computes can make the checker accept or refuse a step.

### 5.2 The probability of a step, given the abstract item

The item at a step is the trace's `before` state: on a loop body's first statement that is
the loop's invariant restricted to where the exit is false, so the probability of one
attempt is judged from the item every iteration starts with. The pool a draw sees is the
pool of the **guaranteed facts** (the base, its level, the influence and the modifiers
present on every path, with their groups and tags): the pool of the item the guide is
actually holding on the path it describes. A modifier the state holds only as possible
neither shrinks the pool nor adds its tags. This is a point estimate, not a bound, and it
is exact for a reforge (which strips the uncertain modifiers away) and for a step after
the named modifiers fill the item; it is approximate for an add onto an item with unnamed
modifiers, where the true pool is smaller by the groups those modifiers occupy. The report
says so where it applies ("unnamed modifiers may narrow this pool"). Bounds would be the
same computation on the superset and the subset pools the checker already builds
(`addableMods`, `subsetMods`); not built until a guide needs them (Q54).

### 5.3 The race: an exact weighted draw without enumeration

Sequential weighted sampling without replacement has a well-known exact representation:
give every row an exponential clock with rate equal to its weight and read the rows off in
the order their clocks fire. A group's clock is its rows' sum, the row that represents the
group is drawn with probability weight over group weight, and a group whose side is full,
or that fires after a group of its own, is skipped. The draw is then **the first `m`
groups to fire that the side caps admit**, and every question about it is a question about
firing times, which are independent. Two consequences carry the whole model:

- **Given the side split**, the modifiers on a side are the first `p` prefix groups to fire
  in the prefix race alone, independent of the suffix side. The split's own distribution is
  a race between the two sides' order statistics (the `a`-th prefix firing against the
  `(m−a+1)`-th suffix firing), with a side that is full admitting no more.
- **"Group `g` is among the first `k` to fire"** is "fewer than `k` of the other groups
  fired before `g`'s clock". Conditioned on `g`'s firing time `t`, the others fire before `t`
  independently (each with probability `1 − e^(−w·t)`), so their count is a Poisson-binomial
  distribution computed by a dynamic program over the groups in `O(groups × k)`, and the
  condition is removed by integrating `t` against `g`'s exponential density, a smooth
  one-dimensional integral a Gauss–Legendre rule evaluates to machine precision in a few
  dozen points. The same program with two conditioned clocks gives the exact joint for a
  pair of groups ("life T1 and fire resistance T1"), a two-dimensional integral; three or
  more wanted groups are combined by inclusion–exclusion with the pairwise joints exact and
  the higher-order terms taken independent.

This is an intensional computation (the state of the dynamic program is a count, never a
list of outcomes), it is exact where craftofexile is exact and exact where craftofexile
extrapolates, and its cost is a few thousand multiplications per atom. The depletion the
split model ignores in craftofexile is included.

### 5.4 From a roll to a predicate

A reforge's outcome is summarised, never enumerated: the (prefix, suffix) distribution
from the split race, and per side the race over its groups with each group's row weights.
The exit predicate of the loop (or the condition of an `if`) is evaluated against it by
recursion on the predicate: `has X tN` on a side is "group X among the first `p` of that
side's race, with a row at tier N or better" (the row share within the group times the top-`p`
probability), summed over the split; a count predicate is read off the split; `has X >= v`
is the tier atom times the share of the row's range at or above `v`; `and` and `or` of
atoms on one side use the exact pair joint, across sides they multiply (independent given
the split), and `not` is the complement. Essence grants, Harvest's tagged modifier and a
forced fossil row are placed first: they occupy a slot and remove their group from the
race before the random draws.

An add (Exalted Orb, augment, Harvest augment) is one draw: the race over the open sides'
pools, the group's share. A removal is uniform over the removable modifiers the state
names (a range of counts gives a range of probabilities; the midpoint is reported with the
range). A Divine Orb's exit is the value share of §1.4. An unveil is three weighted draws
without replacement from the unveil pool, the chance the target is among them.

Between a randomising step and the predicate that reads it a body may run further steps
(a bench craft, an annul). These are folded into the summary in the mean field: a bench
craft adds its row with probability one and takes its slot; a random removal scales every
present modifier's probability by one minus one over the count. The structure of the last
reforge survives these as far as the predicate's atoms are not the ones touched.

### 5.5 How cost flows through loops, branches and restarts

Expected cost is linear: the cost of a program point is the sum over its statements of the
expected number of times each runs, times its unit cost, in the step's own currency (so
many Chaos Orbs, so many Deafening Essences of Greed, so much Vivid lifeforce, a bench
craft's listed price). The expected run counts come from one walk over the syntax tree with
a probability mass:

- a **sequence** passes its mass along;
- an **`if`** splits it by the condition's probability under the summary at that point,
  joins what falls out of both arms;
- an **`until`** with per-attempt exit probability `p` runs its body `1/p` times in
  expectation (the attempts are taken as independent trials, exact for a body that rerolls
  what the exit reads and an approximation otherwise, stated in the report), so every
  statement in the body is multiplied by `1/p` times the mass that reaches it within one
  attempt; a nested loop multiplies again;
- a **`restart`** inside a body ends the attempt early: the mass that reaches it is an
  attempt that failed, so the statements after it do not run on that path and `p` counts
  only the paths that fall off the end and satisfy the exit;
- a **`stop`** ends the craft on its path: its mass leaves the walk and the guide's total
  is the cost up to it, which the report shows as the chance the craft ends there;
- a top-level **`restart`** makes the whole guide one attempt of an outer loop: the cost
  up to the restart, divided by the chance of getting past it.

No outcome is enumerated: the walk carries a scalar mass and, at each randomising step,
the summary of §5.4.

### 5.6 What the data needs

- Fossil weight multipliers: `positive_mod_weights` projected into `fossils.json` as
  `weights` (tag → percent), on `FossilSpec` as `weights`, additive to the blocked tags
  already kept.
- Bench costs: the export's `cost` per option (`{ "Metadata/Items/Currency/CurrencyModValues": 2 }`)
  projected into `bench.json` as `cost`, on `BenchCraft` as `cost` (currency name →
  amount).
- Eldritch implicit weights: the rows' per-class spawn weights kept in `eldritch.json`.
- Harvest costs: a small table beside `HARVEST_TAGS` in core, from the cargo
  `harvest_crafting_options` (the lifeforce colour and amount per tag).
- The economy snapshot: `economy.json` in the data package, with a fetch script.

### 5.7 Surfaces

A CLI report (`hinekora cost <file>`): one line per statement with its expected runs and
cost in its own currency, loops with their attempts and per-attempt chance, branches with
their probability, and a total in chaos and divine with the snapshot's date. A line in the
hover footer for the statement under the cursor and for a loop's head. A per-statement
shape keyed by the statement's start offset, as the trace is, for the storyboard to draw
beside each step (owned by the `ui` stream).

---

## 6. Validation against craftofexile

Recorded 2026-11-09 against craftofexile's calculator driven by URL (`b` the base,
`m` the method, `lv` the item level, `req` the required modifiers by craftofexile's
modifier id and the tier's level; `e` an essence, `f` a fossil list), Allflame 3.29 data,
its own figures read from its "Final calculation" row and, where it matters, from its
diagnostic trace (`poec_computeFinalProbsV2(null, true)`). hinekora's figures are
`hinekora cost` on a guide of the base, the loop and nothing else; "rounds" is its
expected rounds, craftofexile's "tries" its `ceil(1 / p)`.

| Recipe (base, item level 84)                                                                 | craftofexile                                   | hinekora            | Note                                                                                                                                                                                                                                                          |
| -------------------------------------------------------------------------------------------- | ---------------------------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Chaos Orb on Titan Greaves until T1 fire resistance                                          | 4.361 %, ~23 tries                             | 4.3 %, 23.1 rounds  | exact regime (10 suffix types)                                                                                                                                                                                                                                |
| Deafening Essence of Greed on Titan Greaves until T1 fire resistance (R3/R7's shape)         | 3.953 %, ~26 tries                             | 3.9 %, 25.5 rounds  | the grant takes a prefix slot, 3–5 random draws at 8:3:1 in both                                                                                                                                                                                              |
| Chaos Orb on Stygian Vise until T1 life                                                      | 3.907 %, ~26 tries                             | 3.9 %, 25.5 rounds  |                                                                                                                                                                                                                                                               |
| Pristine Fossil (Primitive resonator) on Stygian Vise until T1 life (R4)                     | 9.038 %, ~12 tries                             | 9.0 %, 11.1 rounds  | the ×10 life weight and the blocked defences read alike                                                                                                                                                                                                       |
| Chaos Orb on Titan Greaves until T1 life and T1 fire resistance                              | 0.198 %, ~503 tries                            | 0.20 %, 504 rounds  | two atoms, one per side: the split and the per-side races agree                                                                                                                                                                                               |
| Chaos Orb on Imbued Wand until +1 to all spell gems and T1 spell damage (R2's wand prefixes) | 0.000183 %, ~545,204 tries                     | 0.000168 %, 596,976 | craftofexile's extrapolation regime (23 prefix types): its mean-field depletion is optimistic by a tenth against the exact race                                                                                                                               |
| Orb of Alteration on Titan Greaves until T1 fire resistance                                  | 1.798 %, ~56 tries (`m=alteration`, mode `aa`) | 1.4 %, 69.8 rounds  | craftofexile's alteration assumes an Orb of Augmentation fills the empty side, so every roll has a suffix; hinekora prices the alteration alone, a one-modifier roll being a prefix alone 20 % of the time (Q55). Written with the augment, the guides agree. |
| `m=alt` on a Viridian Jewel until % maximum life (R1)                                        | 3.070 %, ~33 tries                             | 1.3 %, 74.4 rounds  | not a comparison: `alt` is not a method of craftofexile's table and its page fell back to a rare roll of three or four modifiers (its trace says "Max. affixes by type 2", combinations 2/1, 1/2, 2/2)                                                        |

The model agrees with craftofexile wherever craftofexile is exact, to the rounding of its
display, and the one real difference, the wand, is the regime craftofexile itself marks as
an extrapolation. The Orb of Alteration row is a difference of question, not of model.
Not compared: a Harvest reforge under a lock (craftofexile's `hreroll` needs the metamod
set through its item panel, not the URL) and the unveil's three options; both rest on the
same race and on Q60 and Q61.
