# hinekora: Codebase Reference

> Purpose: orient a fresh context (a new Claude session or a human) in the codebase.
> This doc is the ground truth for _what exists and where_: package layout, the
> per-module breakdown, the key-files index, gotchas, and the standing design notes.
> The _shape_ of the implementation (the layers and the theory behind the checker) is
> `ARCHITECTURE.md`; forward-looking work is `ROADMAP.md`; conventions, the build gate,
> and working style live in `../CLAUDE.md`; design intent lives in
> `crafting-lang-surface-v0.md` (surface language) and `operations.md`
> (the operations model); the item and modifier model the code is audited against is
> `item-model.md`. Recent history lives in `git log`.
>
> Game mechanics are not re-explained here. Each rule links to the section of the Path of
> Exile wiki (poewiki.net) that defines it, and the text covers only how hinekora models it.
> The wiki is cached locally (`tools/poewiki`, the `poewiki-render` skill).

---

## 1. What hinekora is

A **statically-checked DSL for Path of Exile crafting guides**, in TypeScript. You
write a craft (a sequence of currency operations, loops, and conditionals over an
item), and the checker proves (via abstract interpretation) that every operation's
precondition holds on every path, catching mistakes like "exalt on a full item" or
"annul on an empty item" _before_ you spend real currency. Errors render the item's
state at the point of failure (surface doc §6: state first, no lecturing).

The name: the PoE deity Hinekora foresees the future, and the in-game currency
_Hinekora's Lock_ lets an item foresee the result of the next currency used on it.
The language generalizes that to the whole craft.

Example (the first half of `examples/example.craft`):

```
item {
    base:     "Vaal Regalia"
    ilvl:     84
    rarity:   normal
}

transmute
regal

until has "fire res" t1 or has "cold res" t1 or has "light res" t1 {
    annul
    exalt
}
```

This checks clean: each iteration removes one mod then adds one, so annul always has
something to remove and exalt always has an open slot; on exit, at least one of the
three resistances is provably present (a fact the BDD presence domain keeps through
the loop join).

**Why TypeScript** (settled): the design needed fast iteration, the tool wants a browser
playground, and the data is JSON-heavy. Performance never distinguishes the languages
here: a pool computation is ~200 mods × ~25 cheap checks per step, microseconds, as
long as the intensional-union invariant (`../CLAUDE.md`) is respected. That invariant is an
algorithm choice, not a language choice.

---

## 2. Monorepo layout

```
packages/
  core/     @hinekora/core   - pure, UI-agnostic kernel (model, pool, render,
                                resolve, check, cost). No I/O.
  parser/   @hinekora/parser - hand-written lexer + parser: source → Craft AST.
  data/     @hinekora/data   - loads projected RePoE JSON, builds a Registry.
  lsp/      @hinekora/lsp    - transport-free language service + stdio server.
  cli/      @hinekora/cli    - command-line checker, formatter, chart printer and cost report.
editors/
  vscode/                    - VSCode extension (TextMate grammar + LSP client).
  playground/                - browser playground: Monaco + the language service in-page
                                (Vite; `pnpm -C editors/playground dev`).
examples/                    - the guide suite; every file here checks clean (`packages/cli/src/examples.test.ts`).
  example.craft              - the demo craft (open in the Extension Dev Host).
  essence-life-boots.craft   - essence + def + or example.
  bench-finish-resists.craft - finishing a Rare at the bench (open slot + group rule).
  phys-dot-weapon.craft      - a fractured Rare, chaos/annul/bench with predicate defs.
  alt-regal-jewel.craft      - alt–aug–regal on a jewel (the cheap small-pool opener).
  flask-alt-aug.craft        - a Magic flask: one prefix, one suffix.
  self-fracture.craft        - a Fracturing Orb, the `fractured` branch, the fillers annulled.
  matron-metamod.craft       - the Wild Bristle Matron's random metamod made deterministic.
  eldritch-gloves.craft      - a fractured base, essences, an eldritch annul to make room, embers for the implicit.
  metamod-harvest-loop.craft - "Suffixes Cannot Be Changed" and a Harvest reforge, round until the life is T1.
  veiled-unveil.craft        - a veiled orb under a suffix lock, unveiled until the right option shows; `stop` on a bricked item.
  essence-minion-wand.craft  - one repeat of essence spam and annuls (back to the essences when an annul takes a kept modifier), a prefix lock and a scour, multimod and bench crafts.
  value-threshold.craft      - a finished ring divined until the life roll is 110 or more.
  imprint-regal-amulet.craft - an imprint as the checkpoint, a regal under a prefix lock, Harvest and the bench to finish.
  cluster-harvest.craft      - a Large Cluster Jewel reforged by tag until two notables sit, its enchant naming the pool.
  recombinator.craft         - two Magic wands, one wanted prefix each, recombined until one carries both.
  future/                    - recipes that wait on a feature, each headed by which; not tested.
docs/
  REFERENCE.md, ARCHITECTURE.md, ROADMAP.md, item-model.md, QUESTIONS.md + the two design docs
  (CLAUDE.md stays at the repo root).
tools/
  poewiki/                   - local cache of poewiki.net for mechanics research:
                                full export, incremental sync via recentchanges,
                                on-demand page rendering to Markdown. Driven by
                                the poewiki-render / poewiki-sync skills in
                                .claude/skills/. Data lives in .cache/ (gitignored).
scripts/
  check-docs.mjs             - the docs-vs-code check in the gate (CLAUDE.md).
  coverage-summary.mjs       - renders coverage for the CI job summary.
.claude/
  agents/reviewer.md         - the fresh-context reviewer (/review).
  hooks/pre-commit-gate.mjs  - runs the gate before a commit issued through the Bash tool.
  skills/                    - poewiki-render, poewiki-sync, review.
```

Build system: **tsc project references** (`tsc -b`), root solution tsconfig, each package
has its own tsconfig. Core is ESM (NodeNext). The **vscode extension is CommonJS** (its
own tsconfig, does NOT extend the ESM base). The dependency arrow is one-way: cli/lsp/
editors depend on core; core depends on nothing UI; data feeds core plain structures.

Build/test/lint/format commands: the gate in `../CLAUDE.md`.

---

## 3. Architecture

### 3a. `@hinekora/core`

- **words.ts**: the small pieces of English every message, tooltip and card is built
  from, so the checker, the cost report, the renderers and the editors write them alike:
  `capitalise`, `plural` and `pluralRange` (a range is singular only when it is exactly
  one; "prefix" becomes "prefixes"), `rangeText` ("82", "40-82"), `RARITY_WORD` and
  `rarityText` ("Magic or Rare", in the game's order). The cost report's own figures are
  `cost/words.ts`.
- **model/**: `ItemFacts` (what a roll depends on; the checker projects its state onto
  it, there is no concrete item type), `Mod` (one row per _tier_, i.e. one row of the game's `Mods` table;
  `type` is the ModType bucket, `families` the
  [mod groups](https://www.poewiki.net/wiki/Modifier#Group/family), `implicitTags` the
  [mod tags](https://www.poewiki.net/wiki/Modifier#Mod_tag) that tag-directed crafting selects
  on — harvest, fossils), `Base` (id = metadata path, since display names collide across
  hundreds of bases), `Effect` seam, `ModSource`, and the affix caps
  (`model/capacity.ts`). Branded id types in `model/ids.ts`. There is no concrete
  validator: the item block checks the declared item against item-model.md §8 (side,
  caps, the rarity ceiling, distinct modifiers, disjoint groups, and for a row named by
  id the natural-row level and domain rules), and the operations keep every state
  within §8 from there.
- **pool/**: `pool(catalog, facts[, maybeTags])`, which mods can roll on an item: the wiki's
  [spawn weight tag](https://www.poewiki.net/wiki/Modifier#Spawn_weight_tag) rule (the item's
  tags, the base's plus the `adds_tags` of present mods, a rule the data carries rather
  than the wiki (`QUESTIONS.md` Q2), vs the mod's spawn table, first match wins, zero
  disables, then its generation table the same way, a percentage scale whose zero
  disables: `Mod.generation`, item-model.md §5, which is what caps a Small Cluster
  Jewel at one notable) plus the [mod level](https://www.poewiki.net/wiki/Modifier#Mod_Level) gate.
- **ast/**: the surface AST (`ast.ts`), spans (`span.ts`), and name binding
  (`bindings.ts`): `bindingsOf(craft)` lists every def, operation function and parameter
  with its declaration span and reference spans, `bindingAt` finds the one under an
  offset. Scoping is the parser's: a bare identifier is a parameter reference only when
  it names a parameter of the enclosing def, so steps written inside a call's block
  argument bind to the def they are written in. The editor's highlights, definition,
  references, rename and hover all read this one table.
- **render/**: the labels diagnostics and hover show (`modLabel`, `baseLabel`), and the
  item as a player reads it (`item.ts`). `itemView(a, registry)` is a view model shaped
  like the game's tooltip: the base, class and level, the memory strands when the item
  has any (`strands`, fewest to most; "Memory Strands: 82" in the copy text), the
  rarities, the eldritch
  implicits (each side's tier names and the wordings of its possible types at those
  tiers, taken from `eldritchPool`, since a family's text changes with the tier; empty
  when any implicit of the side may be there), the modifiers by side (each with its stat text, its affix name and tier when
  the row is known, a tier range and a roll span across the rows it may be otherwise, the
  span narrowed to the value a `has "<mod>" >= n` proved (`AItem.values`), its
  category tags, and whether it is fractured or crafted), "one of" groups for the
  disjunctions (members pinned to their tier when the clause named one, exact when no
  more could fit), one remainder line for the modifiers whose identity is unknown
  (counted once against the coupled total, so never two independent per-side ranges),
  the marks (influence, eldritch, fractured, corrupted, each "possibly" when on some
  path only), and the modifiers proven absent. `renderItemText(view)` writes it modelled
  on the game's copy-to-clipboard text (`QUESTIONS.md` Q41 probes the details the wiki
  does not record): `Item Class:` / `Rarity:` / the base, `--------`
  between sections, `Item Level:`, then each modifier under the advanced tooltip's
  header `{ Prefix Modifier "Virile" (Tier: 1) — Resource, Life }` with `(fractured)` /
  `(crafted)` after the text, the marks as the game writes them (`Hunter Item`,
  `Corrupted`), and this project's extensions in the same brace style (`{ At least one of
these suffix modifiers }`, `{ 1-3 additional prefix or suffix modifiers }`,
  `Possibly: Corrupted`, `Without: …`). The hover, the CLI and the playground's card all
  read the view, so they cannot disagree; `renderState` stays the one-line summary for
  diagnostics. `walkthrough.ts` turns a craft and its check result into the guide as a
  player follows it (`walkthrough(craft, result, registry)`): the declared item and the
  second items (`donors`, from `donorItems`), then a
  `Step` per statement with the item before and after it from the trace, matched by
  statement kind and start offset, the checker's findings owned by the innermost
  statement that contains them, loops as blocks with their exit both as written and as a
  checklist in the player's words (`check`, from `criteria`), branches with their arms
  likewise, and for a method its display name, the step as written and what it does
  from the method table. `flowchart.ts` turns a walkthrough into Mermaid `flowchart TD`
  text (`flowchart(walkthrough)`): an action node per statement in a class named after
  its method word, a hexagon per loop exit or branch asking "item has …?" with the
  checklist's lines, "yes" and "no" edges, a loop as a `repeat` subgraph whose decision
  leads back to its first step (a `restart` goes there too; a `stop` is an end node of
  its own path), start and end nodes
  (`FLOW_START`, `FLOW_END`), and the map from node id to statement for a consumer that
  binds the drawn nodes to the text; the CLI's `hinekora chart <file>` prints the text
  (`chartSource` in `packages/cli/src/check.ts`) for a README or a wiki page to embed;
  `hinekora cost <file>` prints the cost report (`costSource`): one line per statement
  with a loop's odds (`oddsText`), a branch's chance or what it is expected to consume, the spread over
  what the item may hold in brackets where the ends differ, then the total per
  currency and in Chaos and Divine Orbs at the bundled snapshot's league and date. `itemDelta`/`stepDelta` list what a step added and removed, as
  the lines of the item view a player would notice. `conditions.ts` words a guide's
  conditions for the player: `clause` as prose ("+# to maximum Life at T1 and exactly 2
  prefixes", a negated count turned round, "no …" for a negated modifier), `criteria` as
  a checklist (`Criterion`: every requirement its own line, alternatives grouped under
  "one of", a disjunction of every k-subset of a set folded to "at least k of" those
  (`atLeast`, worded by `groupWords`), a requirement that must be absent negated). Both
  expand a local predicate
  call as its body with the arguments in place and word a modifier as the trade site does
  (`modWording`: the row's text with its numbers as `#`), given the item's base and level.
- **resolve/**: `Registry` (the resolved data surface). Key methods:
    - `resolveBase / resolveMod / resolveModType(name, ctx?) / resolveCurrency /
resolveEssence / resolveBench / resolveHarvestTag`
    - `effectsOfType(type)`: the effects a carrier type contributes (the metamod seam the
      checker folds over guaranteed types; empty for everything else).
    - `resolveClusterEnchant(name)` names a cluster jewel's enchantment by the words of
      its stat, matched against the `affliction_` spawn tags the notables roll under
      (`clusterEnchants()` lists them); the checker reads the tag onto the base.
    - `resolveHarvestTag(name)` maps a surface category ("fire", "caster") to its
      canonical `Mod.implicitTags` tag via the curated `HARVEST_TAGS` table.
    - `resolveModType` is **fuzzy and base-aware**: text → ModType, narrowed to types that
      can actually roll on the given base/ilvl (`ctx`), then, failing any, to those an
      unveil or the bench can put on it, returning `ambiguous` with candidates when
      several match. A veiled-only type whose words a natural one shares is therefore
      named by its mod id. Built on `fuzzy.ts`; a query token matches exactly OR
      as a **≥3-char prefix** of an entry token ("max life" → "maximum life"), after the
      community wordings of `RegistryData.wordingAliases` are rewritten into the query
      (`wordingAliases`, `expandAliases`: longest phrase first, "es" → "energy shield").
    - `genOfType(type)` → prefix/suffix (`sidesOfType(type)` → every side the type's rows
      sit on, both for the few that are a prefix on one base and a suffix on another);
      `familiesOfType(type)` → mod groups (drives the bench group-exclusivity check);
      `typeLabel(type)` → friendly wording for display.
    - Precomputed completion lists: `currencies`/`currencyNames`, `baseNames` (only
      names that resolve to one base of a class that takes modifiers: a class is kept
      once any base of it has a pool, so gems, currency and cards drop out without a
      hand-kept class table),
      `statSuggestions` (each carries its `type` so completion can filter by
      rollability), `essenceNames`, `benchNames`, `harvestTags`.
    - `STANDARD_CURRENCIES`: the 10-currency catalog. `name`/`kind` drive the language;
      `displayName`/`description` are curated display metadata (RePoE ships no currency
      descriptions) used only by hover/completion.
    - `tiers.ts`: `rollableTiers(catalog, base, ilvl, type)` (pool ∩ type, sorted
      by minLevel desc so T1 = best available), `tierMod`, `rollableTypes` (the
      type-level pool; drives base-aware mod completion). The empty-item pool is
      memoized per (base, ilvl), the single biggest checker/LSP speedup (hover
      78ms → 4ms).
- **check/**: the abstract-interpretation checker (§4 below).
- **cost/**: the cost layer (`ARCHITECTURE.md` §7; the research behind it,
  `research/cost-model.md`): the chance of each step against the modifier pool and what a
  guide is expected to spend, computed from the checker's trace and never inside it.
  `race.ts` is the weighted draw without replacement as an exponential race: `allAmongFirst`
  (the chance a set of groups is among the first `k` drawn), `amongFirstDistribution` (the
  exact distribution over which of some groups are drawn, by inclusion–exclusion) and
  `splitDistribution` (how `m` draws split between the sides, with the side caps and
  depletion), each a Poisson-binomial dynamic program under a Gauss–Legendre quadrature,
  checked against brute-force enumeration in `race.test.ts`. `roll.ts` reads a method's
  op sequence on the checker's item into its `Roll` (`rollOf(a, ops, registry, reading?)`,
  the `Reading` saying which end of each range the checker left open the roll reads:
  `estimate`, `floors` or `ceilings`): a `draw` (the pool's
  groups per side with their rows and weights, built with `pool` on the item's sure facts
  (`guaranteedFacts`, each side's count raised to its proven floor, the memory strands at
  theirs, so the lower tiers the strands bar are out), re-weighted by a
  resonator's fossils (`FossilSpec.weights`, added up across fossils, Q60), narrowed to a
  tag, culled to the Foulborn top tiers, tilted by the grove's "more / less likely"
  (`PoolSpec.likely`, ten and a tenth on the rows sharing a harvest type with the item's
  modifiers, Q66), or the influence's rows; the modifiers `present`
  for certain, kept or placed first; the count cases, a reforge's
  [Chaos Orb § Mechanics](https://www.poewiki.net/wiki/Chaos_Orb#Mechanics) ratio, a Magic
  item's 1–2 at even odds (Q58, Q59), an add's one), a `removal` (uniform over what it
  reaches, the protected sides excluded, Q61), a `lock`, an `unveil` (three weighted
  draws, Q64), an `implicit` (an ember's weighted draw over `EldritchImplicitSpec.weights`),
  a `reroll`, or a `recombine` (`recombineRoll(a, b, registry)` on the item and the second
  item the checker lends through `donorItems`: per side the pooled types with their rows,
  weights and exclusivity (`exclusiveTypes`, `rowsOf`) and the kept count by the page's
  table, `recombine.ts` `keptDistribution`; `pickSide` is the weighted pick without
  replacement under the exclusive rule, Q67); `withPresent` folds a bench craft after a
  roll in. `chance.ts` evaluates a
  resolved predicate (`RPred`, from the checker's `predicateResolver`) against a roll
  (`chance`): the leaves the roll models are enumerated jointly (which named modifiers
  were drawn, which rows, which part of a value range, Q65), a leaf it does not is read
  off the checker's item after the step (`refine` both ways), and a condition neither
  settles is unknown rather than guessed. `chain.ts` solves a loop whose body changes the
  item one modifier at a time (`chain`: `ChainStep`s of a random removal, a single draw, a
  bench craft, a branch over them with or without an else arm, a reforge whose `Outcome`s
  the item starts over from, a `restore` read as a reforge whose outcomes are the item
  restored, a restart or a stop) as a Markov chain over the counts
  and the named modifiers' rows (`ChainState`, one `ChainAtom` per modifier the loop's
  conditions name), from weighted start states to the exit (`exitAtStart` the part that
  holds before any round), a restart, a stop or the mass that never leaves; once the
  share of mass each round keeps has settled, the rounds still to come are added as
  that round's geometric tail, so a rare exit costs its full expected rounds. The walk
  builds it in `chainLoop` for every `until` whose body and exit fit, the rest taking
  the independent-attempts path. `prices.ts` holds the unit
  cost of a method in its own currency (`unitCost`: the orb's name, the essence, the
  fossils and their resonator, the lifeforce per Harvest craft, a bench craft's
  `BenchCraft.cost`, the beasts a Bestiary recipe takes), the `Prices` snapshot type and
  `inChaos`. `report.ts` is the walk
  (`costOf(craft, result, registry, prices?)` → `CostReport`): one `StepCost` per
  statement keyed by its span (`reached`, `runs`, `unit`, `expected`, a loop's `attempts`
  as rounds and the chance each round run ends it, a branch's chance, a `note` where a
  figure is assumed), the `total` per currency, `chaos` and `divine` under the snapshot, the
  `unpriced` items and the chance the craft `stopped`. The walk runs once per `Reading`,
  and each step carries the spread of its figures over the floors and ceilings walks
  where they differ (`Bounds`: `runsRange`, `attemptsRange`, `chanceRange`, `branchRange`), the report
  its `chaosRange`; a step whose figure is an assumption (its `note`) in any reading, and
  the steps inside such a loop or branch, carry none, and the total's spread is left out
  with them. `words.ts` is the figures in the guide's words (`figure`, `percentage`,
  `priceText`; `approx` marks an estimate "~24", `oddsText` is a repeat's odds as guides
  quote them, "1/37 chance", or a percentage once better than even, `oddsFigure` the
  same as the end of a spread, "1/36.5"), the one copy the CLI, the hover and the playground print, and
  `costIsObvious`, the step whose cost says nothing its name does not (it runs once and
  spends one of one currency), whose line the hover and the storyboard leave out. A
  method first in a loop body is judged on the item the loop finds, not on the join
  over its rounds, so the attempts are taken alike; a loop or branch first in the body
  reads the join, weighed by the path the round before left.

### 3b. `@hinekora/parser`

Lexer (`tokenize`) → `Token[]` (trivia-free; no keyword token kind, every word is an
`ident` and the parser decides by text; `tokenizeWithComments` also returns the `#`
comments with their spans, for folding and the formatter). The words the parser gives meaning to are the
tables in `vocabulary.ts` (the item block, control flow, predicates, item fields) and the core's
method table (`check/methods.ts`), which completion, hover and the docs check read too.
A statement that is not control flow or a call is an `OperationStmt`: `parseOperation`
takes its opening word, a second word when `methodsAfter` says the family has one, and
then one argument per slot of the method's `args` (`parseSlot`: a quoted name or a
parameter, a word from a fixed set, a number, a tier, the name of a second item; optional
slots may be left off). A file may declare second items, `with <name> { … }` (`parseDonor`,
`Craft.donors`), described as the item block is.
A missing argument's error says what the slot wants in the guide's words (`QUOTED`)
after the statement as written so far.
An unknown opening word still parses as an operation, so the checker names it. `parse(source)` returns `{ ok, craft }` or
`{ ok: false, error }` with a message + span. Tokens carry spans whose `offset` is a
UTF-16 code-unit index into the source (the LSP's own offset convention). The lexer
emits `eq` for `==` and `assign` for a lone `=` (the def binding).

`format.ts`: `formatCraft(source)` prints the tree in the house style, or `undefined`
when the guide does not parse. Four-space indent, width 100. The item block one field
per line with the values aligned, the fields in a fixed order, empty affix lists left
out, `corrupted` last. A body stays on one line when the author wrote it on one and it
fits, else one statement per line; an empty one is `{}`. A braced block argument written
over several lines keeps that shape, the call opening up to its `{` and `}` carrying on
with the remaining arguments; written on one line, or bare, it stays inline. A predicate
def that does not fit goes under its header, one operand of the loosest chain per line
with the connective leading. Parentheses appear where the grammar needs them (an `or`
under an `and`, a right operand of the same connective) and around an `and` under an
`or` for the reader; an eldritch predicate writes the tier before the wording, as the
item block does. Comments are kept by source line (`tokenizeWithComments`): one after
code stays after that code, one on its own line stays before the next code at its depth
(inside the block, when the next line closes one); one blank line is kept wherever the
source had any. Every printed line remembers its source line, which is what makes both
of those work; several nodes written on one line print on several and the trailing
comment follows the last. The source's line ending is kept (`\r\n` when it has any,
else `\n`). Stable: formatting formatted text changes nothing, and the example guides
are asserted to be in the house style. The CLI's `hinekora fmt [--check] <file>` and
the editor's Format Document both call it.

### 3c. `@hinekora/data`

Ingest scripts (`scripts/ingest-poe1.mjs`) project the RePoE-fork JSON dump down to just
the fields needed (mods, bases, essences, bench options, fossils), minified, with a
**provenance manifest** (repoe commit SHA + sha256 hashes; gameVersion "unknown" because
repoe doesn't stamp it; a file taken from a later dump than the rest carries its own
`provenance` entry, written by hand when the file was added, which the next full
re-ingest supersedes along with the file). A fossil's projection keeps what decides which modifiers a
resonator can roll (`projectFossils`: blocked category tags, added and forced rows, the
base tags it allows, its chance of a corrupted-essence modifier, a fracture), never the
weight multipliers. A mod's projection keeps `implicit_tags` (the category tags harvest and fossils
filter on) and `generation_weights` (the table that scales a spawn weight by the item's tags).
An essence's ladder tier is the export's `level`, with a fallback for the one it leaves at
zero (`LADDER_TIER_FALLBACK`: the
[Essence of Desolation](https://www.poewiki.net/wiki/Essence_of_Desolation), 8 on its page). The eldritch implicit rows (eldritch.json, `scripts/ingest-eldritch.mjs`,
`projectEldritch`) come from the current export with their own `provenance`: side, tier
(Lesser = 1 up to Perfect = 6, the model's count; the export's
`no_tier_<n>_eldritch_implicit` tag that excludes the row counts from Perfect = 1, so the
tier is 7 − n), type, the class tags it rolls on and its text (a "presence" row's text
gains the condition the game prints first, `presenceText`); a row with no tier or no
class is not obtainable and is dropped. `adaptEldritch` makes an `EldritchImplicitSpec`, its per-class spawn weights kept as
`weights` for the cost layer; the registry offers
`eldritchPool(base, side, tier)`, `resolveEldritch(name, side, base?)` (the types of the
wording the query covers best, so "attack speed" is the plain implicit and a "presence"
variant is reached by its condition's words; a tie is ambiguous),
`eldritchNames(side)` (one wording per implicit) and `eldritchTextOf(type)`. For a base it also folds the affix-count implicit stats
(`local_maximum_{prefixes,suffixes}_allowed_+`) into a `capDelta` (absent when zero), the
magnitude stats (`local_{explicit,prefix,suffix}_mod_effect_+%`) into a per-side
`magnitude` in percent (carried, not yet applied), and `local_item_can_roll_all_influences` into `allInfluences`.
`adapter.ts` adapts rows into model types and stamps `ModSource` via `classifySource`
(domain + generation_type + is_essence_only). A fossil's `weights` (category tag → the
multiplier in percent, "More Life modifiers" being 1000) and a bench craft's `cost`
(currency name → amount, read back from the export's currency ids through the bases) are
kept for the cost layer alone; the checker reads neither. `economy.ts` adapts the economy
snapshot `packages/data/data/poe1/economy.json` (`adaptEconomy` → an `EconomySnapshot`): every currency,
essence, fossil, resonator and beast priced in Chaos Orbs by poe.ninja for one league on
one day, with the Divine Orb's rate, written by `scripts/fetch-economy.mjs` (five requests
to the exchange and stash overviews the site's own pages read; `QUESTIONS.md` Q62) and
loaded by
`loadDefaultEconomy`. `aliases.ts` holds `COMMUNITY_ALIASES`, the
words guides use for a modifier where the game's wording differs (surface doc §2), which
`registryOf` hands the registry as its `wordingAliases`. `load.ts`: `loadDefaultPoe1()` →
`LoadedData`; `bundle.ts`: the disk-free half, `adaptPoe1(raw)` over the seven parsed
files (`POE1_FILES` names them) and `registryOf(data)` → `Registry`, exported on their
own as `@hinekora/data/browser` for a page that fetches the JSON itself (the `./data/*`
export serves it).

Essence data note: `maxRandomModLevel` is the "maximum level for random mods" column of the
tier table in [Essence § Crafting](https://www.poewiki.net/wiki/Essence#Crafting) and caps only
the random FILL mods. Essences have no item-level gate: the guaranteed mod is forced at its
fixed tier regardless of ilvl (not stated on the wiki; confirmed by in-game testing).

### 3d. `@hinekora/lsp`

Transport-free service functions + a stdio server:

- `analysis.ts`: `parseCached(source)`, `checkCached(source, registry)` and
  `costCached(source, registry, prices?)`, the parse, the check and the cost report of a
  document memoized by its text (the last 16 texts; checks per registry, costs per
  registry and snapshot). Every feature below reads these, so an edit is parsed once and checked
  once, by whichever request arrives first; a hover, completion or hint on unchanged
  text does no analysis at all.
- `service.ts`: `getDiagnostics`.
- `hover.ts`: `getHover(source, offset, registry, prices?)` is **token-centric**. The
  hovered token's signature (currency op / mod / base / essence / bench / def / projection /
  keyword) plus an item-tooltip footer of the state at that point, then the cost line for
  the statement (`costCached`, `analysis.ts`): a loop's odds, a branch's chance, what a step is expected to consume and, with a snapshot, its
  price in chaos, each with its spread over what the item may hold where the ends
  differ; on the item block the guide's whole expected spend. Details:
    - The tooltip is the item in the game's copy-to-clipboard layout (`renderItemText`
      over `itemView`, render/ above) as a code block, after the loop's exit state is
      captioned "after the loop". The view is built from **three general layers** over
      the presence BDD, not per-case handlers: unit facts
      (`guaranteedTypes`/`excludedTypes`), prime implicates (`disjunctiveGuarantees`),
      and a cardinality fold (`cardinalityGuarantees`, "≥k of n"). Adding a new readable
      form means adding a layer.
    - A mod string's hover shows the resolved canonical wording, generation, and a
      table of every tier rollable on this base/ilvl; a trailing `t1` spotlights that
      tier. (Tier ids rarely match T-numbers: `IncreasedLife11` can be T1; ids count up
      with [mod level](https://www.poewiki.net/wiki/Modifier#Mod_Level), T-numbers down from
      best.)
    - An operation statement hovers by the method table (`operationSignature`). Which
      statement a token belongs to is `methodAt` (`method-at.ts`): statements have no
      separator and sit inside one-line `if`/`until` bodies, so it walks back from the
      token to the nearest words the table knows, stopping at punctuation and control or
      predicate words, and accepts them only when their slots reach the token. Its
      words show the method's `doc` (a currency's description and what it requires; the
      veiled orbs and `unveil` append the unveil options), and a string argument shows
      the signature of what its slot names (essence, bench craft, fossil set, harvest
      tag, Aspect, or mod with a trailing `t1`). A def's declaration/calls/params hover
      as one shared signature (`defAt`, by the bindings): a predicate def shows what it
      expands to, an operation function the steps it runs.
- `navigation.ts`: the name-aware features over `bindingsOf`: `getDocumentHighlights`
  (declaration as a write, references as reads), `getDefinition`, `getReferences`,
  `prepareRename` + `getRenameEdits` (refuses a non-identifier, a tier shorthand such
  as `t1`, a word of the language or the method table, a taken def name, or a taken
  parameter name of the same def),
  and `getDocumentSymbols` (the item, then each def with its parameters as children).
  All return nothing while the guide does not parse.
- `signature-help.ts`: `getSignatureHelp(source, offset)` works on the tokens before the
  cursor alone (an open string is closed first), since the statement is unfinished while
  this is wanted. Inside a call's argument list (`enclosingCall`, which skips closed
  `{ … }` block arguments and gives up inside an open one) it shows the def's parameters
  from the same regex scrape completion uses (`localDefs`), with the argument being typed
  marked; after a method's words it shows the method's slots as they are written
  (`"essence" [t<n>]`, `hunter|shaper`, `count`), the one being filled marked, a repeated
  names slot staying active, nothing for a method without slots. Triggered by `(`, `,`
  and space. It reads tokens, not bindings, so a parameter named like a method shows
  that method's slots inside its def.
- `completion.ts`: `getCompletions`. The pieces of the current line before the cursor
  (`piecesOf`: words, numbers, closed strings, the open string) pick the context
  (`contextAt`): statement (each method's first word, the local operation functions,
  and the control keywords; also once the method before the cursor has no slot left),
  predicate (after `if`/`until`/`not`/`and`/`or`; includes the local predicate defs),
  base, the
  second word of a method family (`methodsAfter`), a `word` slot's choices, a `name`
  slot's catalog names (essences, bench crafts, fossils, Aspects, harvest tags), or
  mod; the slot comes from the same `methodAt` hover uses. Mod candidates are **filtered to what's possible at the cursor**:
  rollable on the item's base+ilvl (`rollableTypes`, base read from the text) AND not
  proven-absent by the checker's state at that point (`excludedAt` parses the craft,
  retrying with the open string closed). Both filters degrade gracefully to "all mods"
  when the base can't be read / nothing parses.
- `folding.ts`: `getFoldingRanges`: every brace pair from the tokens (the item block,
  bodies, block arguments; works mid-edit, an unmatched `{` folds nothing; the fold ends
  on the line before `}` so the closing brace stays visible), each run of consecutive
  lines that are comments as a comment fold (`tokenizeWithComments` keeps what the
  parser skips; a comment after code belongs to that code's line, `commentOpensLine`),
  and a predicate def written over several lines from the tree.
- `inlay-hints.ts`: `getInlayHints`: at a def's declaration what each parameter stands
  for as its uses determine it (`m: mod`, `step: steps`, `t: tier`, `n: count`, from the
  checker's `paramSorts`; a parameter only forwarded to another def has none), and at
  each call the parameter the argument fills (`roll(m: "maximum life", …)`), except a
  forwarded parameter of the same name. Nothing while the guide does not parse.
- `formatting.ts`: `getFormattingEdits`: the whole guide replaced by `formatCraft`'s
  output as one edit; none when it does not parse or is already formatted.
- `semantic.ts`: `getSemanticTokens`, lexer-driven; legend
  `["keyword","property","function","parameter"]` with the `declaration` modifier;
  keywords are the control and predicate words plus `METHOD_WORDS` (currency names
  colour as functions). When the guide parses, the bindings decide first: a def name is
  a function and a parameter a parameter wherever they appear, so a parameter named
  like a currency colours as a parameter inside its def. Returns empty on unlexable
  input.
- `server.ts`: `createServer(connection, registry, prices?)`, capabilities + handlers.
  `triggerCharacters` includes `"` so the mod/base list pops when a string opens. A
  refused rename is returned as an `InvalidRequest` error so the editor shows the reason.
- `node.ts`: stdio entry (`vscode-languageserver/node.js`, explicit `.js` for NodeNext);
  loads the catalog and the economy snapshot once and hands both to `createServer`.
- **Dependency pins that matter:** `vscode-languageserver ^9`, `-textdocument ^1.0.11`,
  `-types` pinned **exact `3.17.5`** (must match the framework's transitive version, else
  a dual-version type clash). `SemanticTokensBuilder` imports from `vscode-languageserver`,
  the `SemanticTokens` _type_ from `-types`. Package exports `"./node"` with `default` (so
  `require.resolve` from the CJS extension works).

To preview hover/completion without VSCode: a throwaway `.mjs` placed **inside
`packages/lsp/`** (so Node resolves the workspace `@hinekora/*` symlinks), importing from
`./dist/…` and `@hinekora/data`, run then deleted. Node can't resolve the packages from
outside the workspace.

### 3e. `editors/vscode`

TextMate grammar for highlighting (kept in sync with the language by hand,
`syntaxes/hinekora.tmLanguage.json`) + a language client that spawns the LSP server via
`require.resolve("@hinekora/lsp/node")` + `TransportKind.ipc`. CommonJS tsconfig.

### 3f. `editors/playground`

A static page (Vite) with Monaco and the whole language service running in the page, no
server: `pnpm -C editors/playground dev` to run it, `build` for a deployable `dist/`.
It resolves the workspace packages through their `exports`, which point at `dist/`, so
run `pnpm build` first and keep `tsc -b -w` running next to `vite` while changing core or
the service; the page otherwise serves the last built behaviour.
The catalog is fetched as the seven JSON files of `packages/data/data/poe1` (served through
the data package's `./data/*` export) and adapted with `adaptPoe1` from
`@hinekora/data/browser`, the package's disk-free entry.

- `src/monaco.ts`: Monaco assembled from its parts, the editor API plus the feature
  registrations the service backs (hover, suggest with its controller, parameter hints,
  word highlighter, go to symbol, references, rename, outline, folding, inlay hints,
  format, semantic tokens) and the editing basics; the package's main entry would bundle
  every built-in language.
- `src/language.ts`: the `hinekora` language: a Monarch tokenizer built from the parser's
  word tables and the method table, the bracket and comment configuration, and a theme
  that also colours the service's semantic token types (`function`, `parameter`).
- `src/providers.ts`: each service function behind the matching Monaco provider, with
  positions and enumerations translated by `src/convert.ts` (LSP is 0-based and numbers
  its kinds from 1, Monaco 1-based and from 0; `byName` maps a kind through both tables).
  Diagnostics become markers after each change.
- `src/item-card.ts`: `renderItemCard(view)`, the item drawn as the game draws one from
  the core's `itemView`: a rarity-coloured header with the base, sections for the
  implicits, the modifiers and the marks, modifier text in the game's blue with the side
  and the tier (or tier range) at the right, roll ranges set apart, crafted and fractured
  lines in their colours, a bracketed "one of" group for a disjunction, a dashed line for
  the modifiers whose identity is unknown, "possibly" marks, and the absent modifiers
  struck through. An eldritch implicit line names its side and tier at the right
  ("Exarch · Grand") and reads its wording, a short "one of" list, "one of n Exarch
  implicits" past `IMPLICIT_LIST_LIMIT`, or "any Lesser Eater implicit" when nothing
  narrows it. The affix name and tags are the line's tooltip.
- `src/storyboard.ts`: `createStoryboard(root, hooks)`, the guide as the item's journey
  from the core's `walkthrough`, one block per step on a rail of icons: the currency's
  icon (what it does is the icon's tooltip), its display name, the step as written, the
  named lines it added or removed (`stepDelta`, less the rarity and the unnamed count)
  and the checker's findings, then the item after it. The item is a card, drawn at its
  own width like the game's tooltip, when something named changed; a one-line state
  ("Rare · 2–3 modifiers") when only the counts or the rarity moved; nothing when it
  did not change. A step's changes, findings, cost and item hang off its title in one
  panel with a line joining them to it. A loop is one container: "repeat until the item
  has" with the checklist (the step's `check`) on top, its steps in an inner panel, its
  odds and cost table as a footer, and its result, the item once it is done, always a
  card, closing the container; every other top-level block (the start, the second items, each step, the finished item) stands in a box of its own
  too, so nothing reads as hung off the step before it; a branch is a container with "if the item has" and its checklist on top and one panel per answer; a `restart`
  is a block pointing back and a `stop` one that keeps the item as it is; the start and
  the finished item open and close the board, the second items (`with <name> { … }`,
  the walkthrough's `donors`) following the start as their own cards;
  a step never reached is dimmed. Given the economy snapshot, each block carries the
  cost layer's line for its statement (`costCached`, matched by statement kind and start
  offset): what a step is expected to consume and its price in chaos ("expected 8.8
  Deafening Essence of Greed (~24 chaos)"; left out when `costIsObvious`, and inside a
  repeat, whose own table says it), and under the finished item the guide's expected spend in chaos
  and divine at the snapshot's league and date, with the currencies it could not price;
  a spread over what the item may hold is the line's tooltip. A repeat's foot gives its
  odds as guides quote them ("1/37 chance", `oddsText`) over a small table
  (`repeatTable`): per currency what the rounds spend (`passSpend`: the body's spend
  over the guide divided by the repeat's own runs) and its worth in chaos, dearest
  first, with the sum. Clicking a cost line opens a dialog with the breakdown
  (`breakdown`): each currency's expected amount, its price and its worth, dearest
  first and the unpriced last, the sum in chaos and divine, and the snapshot's league,
  date and divine rate. The block is the unit of interaction: hovering
  anywhere in it highlights its statement in the editor, clicking moves the cursor
  there, and the cursor marks the block it is in (a loop's head and foot together). A
  card has one action of its own, a copy button that puts `renderItemText` on the
  clipboard. While the guide does not parse the last board stays, dimmed.
- `src/icons/*.png`: the currency icons, copied from the wiki by
  `scripts/fetch-icons.mjs` (one file per method, keyed by its words joined with
  dashes; the page falls back to the first word, then to a lettered glyph; `aisling`
  shares the Veiled Exalted Orb's, `recombine` has a Recombinator's). The game's
  CDN serves only the classic orbs under a public path, which is why the wiki's copies
  are the source; `QUESTIONS.md` Q46 holds the ruling.
- `src/main.ts`: the page: the example guides (`examples/*.craft`, picked from a menu), the
  catalog and the economy snapshot (`packages/data/data/poe1/economy.json`,
  `adaptEconomy`) fetched together, the
  storyboard bound to the editor both ways, a problems panel that jumps to a
  finding (and is absent when there is none), a format button, a handle that resizes the sidebar (the width is kept in the
  browser for the next visit), a header that speaks only while the catalog loads or
  when it cannot, and `window.hinekora` (`editor`, `monaco`, `registry`, `prices`) for
  the browser console.

The package is part of `tsc -b` (declarations only; Vite does the real build), lint and
the test run (`src/convert.test.ts`, `src/storyboard.test.ts`). Every push to `main` builds it and publishes it to
GitHub Pages (`.github/workflows/pages.yml`; the repository's Pages source must be set to
GitHub Actions once).

---

## 4. The checker (`packages/core/src/check/`)

The heart. Abstract interpretation over a symbolic item summary.

### The abstract state `AItem`: a reduced product of sub-domains

`AItem` carries the item's identity, which no operation changes (`base`, `ilvl`), the
set of rarities it may have (`rarities`: one on a straight line, more where paths that
changed it meet or a scour's survivor count is uncertain; a `require` on the rarity
holds only when the set is that one value, `isRare` and its kin refine it, and the
counts live under the loosest caps over the set while an open slot is judged by the
tightest, `capsOver`), the shared `bdd` manager, and the sub-domains below. It is
a **reduced product**: each sub-domain field is a small abstract domain, and the
merge/fixpoint machinery treats them uniformly. `check/domain.ts` declares the shared
contract `Domain<T>`: the two ops every sub-domain must provide, `join` (branch-merge
LUB) and `equal` (fixpoint detection), plus the reusable `RangeDomain` (integer ranges)
and `SetDomain` (the `possible` whitelist). `join`/`stateEqual` in `astate.ts` are now
just those ops applied field-by-field; the tier and value overlays keep what one branch
knows of a type the other branch excludes (`joinKnown`), since the type can only have come
from the branch that pinned it; a branch whose item holds no modifier excludes every type,
so the row an essence places survives the head of a repeat entered on a Normal item. A
cross-domain fact (e.g. crafted ⊆ affixes) is a **reduction** applied explicitly at the
product level in `normalize`, never hidden inside one domain. The sub-domains:

- **Counts (`check/counts.ts`, `CountDomain`).** `total`, `prefix` and `suffix` are integer
  RANGES `[min,max]`, closed under `p + s = total` by `normalize` (each range against the
  other two and its cap). All three are kept because a fact about one side alone ("at most
  two suffixes", the exit of every make-room loop) has no home in the other two unless that
  other side is pinned; `CountDomain.suffix` reads the suffix range no looser than
  `total − prefix`. Reads the affix caps from
  `model/capacity.ts` (`sideCap`/`hardTotalCap`/`maxTotal`/`caps`, re-exported here and the
  first three through `astate`), and owns the coupling `normalize`, count-comparison
  `refine`, and `learnPresent` (the "≥1 affix, ≥1 in gen" bump shared by `has` and
  essence/bench). Independently unit-tested in `counts.test.ts`.
- **`presence` is a BDD** (`bdd.ts`, a small hash-consed ROBDD over type-presence
  variables): the relational mod knowledge. "Guaranteed X" = presence entails X;
  "excluded X" = entails ¬X; a disjunction ("one of these three is present") survives a
  control-flow `join` because **join is BDD-OR**. Views: `isGuaranteed`/`isExcluded`/
  `guaranteedTypes`/`excludedTypes`/`disjunctiveGuarantees`/`cardinalityGuarantees`.
  The manager is shared by every state of a craft, so a view scans the function's own
  `support`, never every variable allocated: one a later step allocated is unconstrained
  in an earlier state and must not change how that state reads. `possible` stays a plain
  set: the pool whitelist of types that could roll.
- `tiers` (`TierDomain`, in `astate.ts`): an overlay `Map<TypeId, Set<ModId>>` refining
  which specific mod (tier) a present type could be. The overlay is non-relational, so it
  is joined per-type and a tier known in only one branch drops to unconstrained. Its
  refinement is coupled to `presence` (tier atoms), so that part lives in `refine`, not the
  domain.
- `values` (`ValueDomain`, in `values.ts`): an overlay `Map<TypeId, Range>` of the span a
  present modifier's value, the first number of its row's text (`rollRange`; an
  experimented base's `magnitude` is not applied), is known to
  lie in, narrower than its rows' spans; a `has "X" t<n>` check clips it to that tier's span
  (`tierSpan`) or rules the tier out; a `has "X" >= n` predicate sets it (and pins the
  rows whose spans reach `n`, `refineHasValue`, every row the item may carry: a row the
  item is pinned to, the rows an essence grants its class, the natural rows that roll on its
  base (under an influence or a tag a present modifier may add too), the bench rows its
  class takes, the unveiled and other placed rows; a row with no number is neither ruled in
  nor
  out, and the value is unknown while it may be the one present), a join keeps a type only where both
  branches constrain it, and whatever rolls the modifier again drops it: a `fill` of its
  type, a `strip`, a `relax`, a removal, and `reroll`, the Divine Orb, which drops every
  entry but a fractured modifier's and those of a side a metamod protects.
- `craftedTypes`: the SET of types a bench craft may have put on the item (the named and
  anonymous `bench` affixes of the item block, then every `bench` step's row and the
  Bestiary's random metamod; a Harvest change of one keeps its replacement among them
  and the crafted count as it was, `QUESTIONS.md` Q52), which is
  what a removal of crafted modifiers reaches and nothing else: an unveiled modifier whose
  wording the bench also offers is not among them, so the removal cannot be charged a
  suffix for it. A removal or strip keeps only the fractured ones.
- `strands`: a RANGE, the [memory strands](https://www.poewiki.net/wiki/Memory_strand#Mechanics) the item may hold: the
  ceiling what it had (`strands:` in the item block), the floor after every currency that
  may have used some up (the `strands` op each such method ends with, the most one use
  takes per [Memory strand § Crafting methods consuming memory strands](https://www.poewiki.net/wiki/Memory_strand#Crafting_methods_consuming_memory_strands); none for a removal, the bench, Harvest, the Bestiary, a resonator or
  a Veiled Exalted Orb). The fill of a method that uses strands up (`Rules.strands`) reads
  the floor: `pool` keeps only the top `tiersWithStrands` tiers of each modifier
  (`model/strands.ts`), counted over the modifier's whole ladder on the base, the fewest
  strands admitting the most tiers, so the pool stays an over-approximation; a Harvest,
  Bestiary or resonator fill is not cut (Q68); the Recombinator's result may hold either
  input's.
- `crafted`: a RANGE, how many [bench-crafted](https://www.poewiki.net/wiki/Crafting_Bench)
  mods are present. `bench` requires it provably below the crafted cap (one, or three under
  the multimod [metamod](https://www.poewiki.net/wiki/Metamod)); a pure reforge or a plain
  scour with nothing protected clears it to 0 except for a fractured bench row, which
  survives every reforge (`fracturedCrafted`; an unproven lock may be on one), while a
  `strip` that keeps a protected side keeps `[0, max − stripped carriers]`, since a
  crafted mod on the kept side may survive; a `remove` with the random selector drops its
  lower bound (the crafted mod may have been removed), one with the crafted selector
  (`removeCrafted`) leaves only what is fractured.
- `imprint`: the item an imprint would restore, itself an `AItem` (with no imprint of
  its own), present only when one is held on every path: a join keeps it when both
  sides hold one, joining the two, and drops it otherwise; `restore` needs it and
  replaces the state with it.
- **Marks** (`model/marks.ts`). `influences` is the set of influence sets the item may
  have, each an `InfluenceKey` (the names in the game's order joined with `+`, empty for
  none): one after the item block and the orbs that set or add an influence, six or
  fifteen after the grove's randomise (every set of the size the item had), and the
  union where paths meet. The pool reads it as tags (`influenceTagsOf` in `ops.ts`): an
  influence's `<class>_<influence>` tags (`registry.influenceTags`) join the facts when
  every possible set has it and the maybe-tags otherwise, so a fill admits its rows
  optimistically and the subset pool pessimistically; a name or tier a predicate writes
  resolves against the tags of any path (`influenceTagsAny`), since it names what the
  item may have. `influenced [x]` refines it; `noInfluence` requires it to be exactly
  `{""}`. `eldritch` is the set of pairs of eldritch implicit tiers (`eldritchKey`,
  `<exarch>/<eater>`, 0 for none): an ember or ichor sets one coordinate, the Orb of
  Conflict maps each pair to the two it can reach (a pair without both implicits, which
  it refuses, to itself), and `dominantOf` reads which side the
  Eldritch orbs act on, which the table (`dominantSide`) requires to agree on every
  path; `exarch`/`eater` and `dominant` refine it, `noEldritch` and `bothEldritch`
  require it. `eldritchTypes` is which implicit each side may be (`ImplicitTypes`: a
  set of types, or `"any"` when nothing is known), set by an ember's draw to its pool's
  types and narrowed by a wording in `exarch "…"` or the item block; it is independent
  of the tiers, since the Orb of Conflict moves a tier without changing the implicit,
  and a wording's negation only narrows when the implicit is surely present.
  `corrupted` is `{false}`, `{true}` or
  both; every method's sequence opens with `require(notCorrupted)` (a corruption
  possible on any path refuses the craft), or with `corruptedItem` for the Tainted
  currency, which needs it on every path; `corrupted` refines it.
- **Tier presence atoms.** A tier-qualified predicate (`has X t1`) also asserts a SECOND
  BDD variable (`type` + NUL + `modId`), so a disjunction of tier-qualified clauses
  (`fire@t1 ∨ cold@t1 ∨ light@t1`) survives a `join` where the flat overlay would drop
  the tier. Atoms are lazy (only tiers a predicate names) and the type-level views filter
  them out; `disjunctiveTier(a, types)` reads them back for a known clause (drives the
  hover so a disjunctive block shows the t1 roll, not the full span). Two facts tie the
  atoms to the item, asserted whenever a predicate reasons about a type (`withTierFacts`):
  an atom implies its family (a modifier at a row is present) and two atoms of one type
  exclude each other (every row of a type shares its groups, item-model.md §9, and one
  modifier per group is
  [Modifier § Group/family](https://www.poewiki.net/wiki/Modifier#Group/family)). They are what lets "one of these is T1"
  followed by `not has fire` conclude that cold is the T1 one; `reduceTiers` then reads the
  overlay back from the presence function, pinning a type whose atom is forced true and
  dropping a row whose atom is forced false, so hover and the later `has` checks see it.
  Removals rebuild presence from unit facts, which drops the atoms with the modifier.
- **`normalize(a)`** first drops a rarity whose caps cannot hold the counts' minimums
  (a modifier every path carries rules out Normal, more than a Magic item's caps hold
  rule out Magic), then runs
  `CountDomain.normalize` (the total/prefix coupling to a fixpoint,
  BOTH directions: `prefix ∈ [total−sCap, min(pCap, total)]` AND
  `total ∈ [prefix, min(tCap, prefix+sCap)]`) then re-applies the cross-domain reductions
  (crafted ≤ total). The second direction is essential: without it, refining
  `prefixCount < 3` tightens prefix but not total, and a guarded exalt spuriously looks
  "possibly full". Returns `null` on an uninhabited (contradictory) state.
- **Affix caps are per-side and base-aware** (`sideCap`, `hardTotalCap`, `maxTotal` in
  `model/capacity.ts`, the one formula the pool and the checker share).
  `sideCap(gen) = max(0, naturalPerSide(rarity, class) + base.capDelta[gen])`: the
  natural limit per [rarity](https://www.poewiki.net/wiki/Rarity#Rarities) (normal 0 / magic
  1 / rare 3; [jewels](https://www.poewiki.net/wiki/Jewel#Affixes) 2) shifted by an
  "experimented base" stat ([Simplex Amulet](https://www.poewiki.net/wiki/Simplex_Amulet#Mechanics)
  −2/−1, [Ratcheting Ring](https://www.poewiki.net/wiki/Ratcheting_Ring#Mechanics) −3/+3),
  floored at 0. `hardTotalCap` (`2×naturalPerSide`) is an INDEPENDENT bound on the two sides
  together, which is what holds a magic Ratcheting to 0p/2s (raw suffix 1+3=4, hard total 2),
  not 0/4 — the wiki's "magic Ratcheting Rings will never roll prefixes but can roll two
  suffixes", and likewise its "magic Simplex Amulets are unable to have any modifiers". The
  three feed `normalize` as `pCap`/`sCap`/`tCap`. `capDelta` is ingested from the base's
  implicit stats (`local_maximum_{prefixes,suffixes}_allowed_+`); see `ops.ts` for how
  reforge/add ops clamp their counts to `maxTotal` (transmute on a 0-cap magic base adds
  nothing, per [Simplex Amulet § Special Crafting Considerations](https://www.poewiki.net/wiki/Simplex_Amulet#Special_Crafting_Considerations)).
- `refine(a, pred, positive)` narrows by a resolved predicate (`has group` is a
  disjunction over the group's types the item may carry, `refineHasGroup`, or their
  exclusion, `refineLacksGroup`; the group is the registry's `groupOf`; De Morgan for and/or:
  conjunction = sequential narrow, disjunction = `join`); `null` means the sub-state is
  impossible, the dead-branch signal. `join` is the branch-merge LUB; `stateEqual`
  detects loop fixpoints (`presence` compares by `===`, the BDD is canonical).

### `check.ts`: the driver

- `Flow` = a statement either `{ kind: "fall", state }`, `{ kind: "restart" }` or
  `{ kind: "stop" }` (the path ends and joins nothing; a branch whose arms all end
  ends the same way, a `restart` over a `stop`).
- `if/else`: narrow into each arm, check, **join** the falling states. A branch whose
  condition is impossible (or whose negation always holds) is flagged as never running.
- `until` loops, three steps. (a) **reachability**: if the exit predicate can never be
  satisfied on this base, report "can never exit" (the root cause) instead of downstream
  symptoms; if it already holds on every entry state, report that the body never runs,
  the mirror of a dead branch. (b) **soundness across iterations**: compute the loop invariant (a join
  fixpoint over continue-states) and run the body once from its continuing part, the
  states where the exit predicate is false (`continuing`; a head state that already
  satisfies it leaves at once, and an inner loop entered from an outer loop's joined
  invariant would otherwise run on states no path continues from); this is what catches
  `until has X { exalt }` eventually filling the item. (c) **loop-exit-as-proof**: the
  after-state is the entry and the body's results, each refined by the exit predicate.
  All three share one primitive, `headStates(entry, body)`, the states that re-enter the
  loop head after one iteration (fall-off-end + every `restart` back-edge), plus
  `refineHeads(states, ¬/exit)`; `foldJoin` merges a list of states. `tightenCounts`, after every narrowing, pushes a proven "≥k of one side" into
  the counts and, the other way (`dropUnnamed`), takes every other type that sits only on a
  side whose count the guaranteed types fill out of `possible`: after `until prefixCount
== 1` on an item whose one named prefix is sure, the prefixes a reforge might have
  rolled are gone, and a bench craft of their group is not refused for them. Two suppression
  modes are scoped helpers, not manual counters: `quietly` (no
  diagnostics, no trace, for probe/fixpoint passes) and `untraced` (trace off, diagnostics
  on, for inlined proc bodies).
- **Predicate defs** (`def name(p) = <pred>`): local, parameterized, pure. Param sorts
  are **inferred from use**: `tier | count | mod | block`, four DISTINCT sorts (`t1` is
  not the int `1`); conflicting uses are an error and the def is dropped without
  cascading; unused params are an error; recursion is caught (`expanding` set). A call
  checks arity and arg sorts, substitutes args into the body, then resolves it, so all
  existing narrowing just works. A param can be forwarded to a nested call.
- **Operation functions** (`def name(p) { <stmts> }`): the statement-valued sibling of a
  predicate def, dispatched at parse time by a `{ … }` body. A `CallStmt` (`checkCall`)
  binds args (shared `bindArgs`/param-sort machinery) and inlines the substituted body
  via `checkSeq` in the caller's context, so state threading, nested loops/ifs, and
  `restart` back-edges compose with no special handling. Param-sort inference walks the
  statements (`noteStmtUses`; `paramSorts` exposes the result per def, with
  `PARAM_SORT_WORD` naming each sort for the editor) and substitution recurses through
  them (`substituteStmt`);
  a param can fill a `has`/`bench`/`essence` mod-name or tier slot, a `harvest` tag, or an
  `unveil` mod. A param in statement position (`ParamStmt`, kind `paramStep`) has the
  `block` sort: the call site binds it to a `block` `Arg` (one statement or a `{ … }`
  block, `parseArg`), and `substituteStmts` splices the bound steps in place, already
  substituted in the caller's scope, so a callee param cannot capture a name inside them.
  Procs share the def name space; recursion is decided statically on the call graph of
  the bodies (`recursiveProcs`), not while inlining, so steps passed as an argument may
  call the proc they are passed to. The inlined body is a trace black box
  (`suppressTrace`), and so are the steps written in a block argument: hover gives them
  a signature but no tooltip (`insideStepArgument`).
- **`recombine <name>`** (`checkRecombine`, before the method table's sequence): the
  item and the named second item (`donors`, elaborated as the item block is; a kind of
  item made for each attempt, never consumed) go through `recombine` in `ops.ts`, the
  Recombinator's own transfer: pooled sides, the page's count table as a range, at least
  the floor of the pooled types present (`assertAtLeast`), tiers kept where known on
  either, one exclusive at most, the base's marks from either, values and the imprint
  gone; `recombineRefusal` names why two items cannot go in (rarity, corruption, class,
  and here a differing base). `donorItems(craft, registry)` lends the elaborated second
  items to the cost layer, `exclusiveTypes` the modifiers the Recombinator treats as
  exclusive.
- **Operation statements** (`checkOperation`): look the statement's words up in the
  method table (`findMethod`; an unknown word is "Unknown currency" or "Unknown
  operation"), bind its arguments to the method's slots as `Literal`s (a parameter left
  unbound is an error), call the entry's `build` for the op sequence (or its `Refusal`,
  reported as a diagnostic) and run it with `runMethod`. The slot kinds give param sorts
  (`slotSort`) and substitution (`subOperationArg`).
- **Trace** (`TraceEntry[]`): `{ span, kind, before, after? }` per statement (and the
  item block), recorded only on the real (non-quiet) pass. `traceAt(trace, offset)`
  returns the innermost entry covering an offset; this powers hover.
- `elaborateItem`: a cluster jewel's `enchant` must be present and fit its size
  (`CLUSTER_PASSIVES`, `clusterSize`), and becomes a tag of the base so the pool holds its
  notables; declared mods must **pin a tier** (`[ "maximum life" t1 ]`) via an
  exact id/alias or a description + `t<n>`; a bare description is an error unless a single
  tier of the modifier rolls here, which it then pins. Placeholders
  (`"random"`/`"?"`) stay anonymous and widen `possible` to the natural rows of their
  side (`anonymousTypes`). A `bench` affix resolves through `resolveBench` for the
  item's class and counts toward `crafted`; anonymous, it widens `possible` to the
  bench's rows of its side (`benchTypesFor`). Pinned tiers seed the `tiers` overlay, so
  the starting item is fully concrete.

### `methods.ts`: the method table

Every crafting method the surface names is one `Method` entry in `METHODS`: its `words`
(one for a currency, two for a family such as `harvest reforge`), its argument `args` as
`Slot`s (`name` of a `NameKind`: mod, essence, bench, fossil, tag, aspect; `names` with
a `max`; `word` with its `oneOf`; `int`; `tier`; optional slots last), a one-line `doc`
in the game's words, and `build(args, state, registry)`, which turns the bound `Literal`s
into the op sequence from `library.ts` or returns a `Refusal` (a name the catalog lacks,
a pair the grove does not offer). The currencies' entries are generated from
`STANDARD_CURRENCIES`. `findMethod(words)`, `methodsAfter(words)`, `slotAt(method, i)`
and `METHOD_WORDS` are what the parser, checker and editor read; nothing outside this
file knows a method by name.

### `ops.ts` and `library.ts`: the operations and the methods

Every crafting method is a sequence of primitive operations (`operations.md` §2), stated
in `library.ts` and run by `runMethod(state, ops, registry)` in `ops.ts`, which returns
`{ok, state}` or `{ok:false, failure, state}`, the first failed check with the state the
method would have left had its checks held (`operations.md` §2 on all-or-nothing). The
operations are `require(check)`, `strip`,
`fill(pool, count)`, `remove(selector)`, `rarity(r | survivors)`, `lock`,
`imprint`/`restore`, `influence(change)` (set the mark, add an influence to every
possible set, or randomise to every set of the same size), `eldritch(change)` (set an
implicit's tier, or the Orb of Conflict's raise and lower), `unprotect` (the metamods
no longer govern the rest of the method, the Tainted Chaos Orb), `keep(gen)` (that side is
kept through the rest of the method, the Eldritch Chaos Orb), `corrupt`, `relax`
(forget the present modifiers' tiers, `relaxTiers`, the crafted ones excepted when
asked), `elevate` (the Orb of Dominance's upgrade: every influenced modifier the item
may have loses its tier and may be its elevated row, a type of its own sharing its
group and named "Elevated"; one of them remains) and `either(branches)`, the join of running each branch of effects, a branch of
`end` alone being an outcome that destroys the item and adds nothing; a method is
all or nothing: in the game a failed `require` anywhere leaves the item as it was, and
the checker reports the first failure and continues from the state the method would have
left (`operations.md` §2), which is also the state the trace records after the refused
step, so hover and the walkthrough show the item the guide meant. The metamods
in force (`Rules`: protected sides, the cannot-roll shield, the crafted cap, whether an
essence is blocked) are read once when the method is applied and govern every operation
in it. Notes:

- `annul` works on **Magic OR Rare**: its one `require` is "has a removable mod", not a
  rarity gate ([Orb of Annulment § Mechanics](https://www.poewiki.net/wiki/Orb_of_Annulment#Mechanics):
  it never downgrades rarity). `scour` requires something to strip: a Magic or Rare item
  with a side unprotected or a fractured mod, so a Magic base with zero affixes still drops
  to Normal and only a Normal item fails as wasted currency.
- A `fill` lays down modifiers drawn from a pool: `add n` raises the counts by `n`,
  clamped to the caps; `reforge n` lands the total in `n` when no side was kept, the
  Chaos Orb's 4–6 affixes ([Chaos Orb § Mechanics](https://www.poewiki.net/wiki/Chaos_Orb#Mechanics);
  the 8:3:1 odds are not modelled, only the range), and with a kept side lets the
  rerolled side take any number up to its cap, the table's "respected, but open prefixes
  may be filled" and "0 to 3 suffixes"
  ([Metamod § Rules and Exceptions](https://www.poewiki.net/wiki/Metamod#Rules_and_Exceptions));
  `within` counts nothing new (an essence's grant, a harvest reforge's tagged modifier, a
  veiled chaos's placeholder, an unveil). The pool's types join `possible` and its rows
  the tier overlay (a one-row pool pins the tier); exclusions on its types are relaxed
  (`admitAdd`); a pool narrow enough to name asserts "at least one of its types is
  present" as one OR clause in the presence BDD (never an enumerated union), the natural
  pool asserts nothing. A natural pool with `topTiers` is the Foulborn cull
  (`foulbornTiers`): of each type's eligible tiers only the top half rolls
  ([Foulborn currency § Mechanics](https://www.poewiki.net/wiki/Foulborn_currency#Mechanics));
  rows a possibly present modifier's tag enables make the eligible count uncertain, so
  the cull keeps every row some count in that range would keep. A **fossil** pool is the
  natural pool without the rows carrying a blocked category tag, plus the fossils' own
  rows (admitted by their weight on the base, since their domain keeps them out of
  `pool`) and, when a fossil gives it a chance, the corrupted essences' modifiers for the
  item's class; a **rows** pool is one of a few given rows, asserted as a disjunction (a
  forced row, the Glyphic Fossil's guarantee). `resonatorOps` composes a resonator from
  them ([Resonator § Mechanics](https://www.poewiki.net/wiki/Resonator#Mechanics):
  refused like an essence under a protect or cannot-roll metamod and on a base a fossil
  does not allow, `fossilAllowed`), the Fractured Fossil adding a `lock` and the
  Bloodstained a `corrupt`. The harvest
  change (`harvestChangeOps`) is a `remove` with the **type selector** (`removeType`: the
  named modifier goes, excluded afterwards, everything else stays) after `typeRemovable`
  (guaranteed, not fractured, unprotected side), then a `rows` fill of the target's row
  at the source's tier rank, or all its rows while that rank is unknown. A **metamods**
  pool (`metamodRows`) is the bench's effect carriers not guaranteed on the item whose
  side may have a slot on some path, a crafted disjunction wide enough for every path
  (`BEAST_METAMOD`, after `metamodFits`: some one carrier fits on every path, its side
  provably open and itself not possibly present); an Aspect (`beastAspectOps`) is a one-row pool of the row the
  registry's `resolveAspect` names (`ASPECTS`, the four animals). `imprint` and
  `restore` are the two exact primitives (`BEAST_IMPRINT` after `imprintable`, a Magic
  item or a Rare talisman, and `noFracture`; `RESTORE` after `hasImprint` and
  `noFracture`).
- A `remove` with the random selector draws from an **allowed-gens** set = `both − protected`,
  or one side minus the protected when the selector names a side (`allowedFor`); a
  side-limited removal whose side is protected is skipped, not refused, the table's "will
  add without removing" for the beast recipes (`beastAddOps`, whose fill reads the
  natural pool at the beast's level, `addableMods` at a level other than the item's, or
  at `ANY_BEAST_LEVEL` when the guide names none). A guarantee whose
  generation is not in that set survives (protected), as does one the cannot-roll shield
  covers and a fractured one; an empty set means nothing is removable.
- `strip` keeps the protected sides and the fractured mod and drops the rest: counts fall
  to what is kept, guarantees survive for kept types only, tier pins and `possible` for
  kept types and, under an unproven lock, for every current type (the survivor may be any
  of them),
  exclusions stay, the fracture facts are permanent, and the crafted range keeps what the
  kept side could hold (`fracturedCrafted` for a fractured bench row).
- The add-pool is over-approximated by running the real `pool` on the facts of the
  guaranteed mods alone at rare caps (`guaranteedFacts`), with the tags a possibly present mod
  would add passed as "maybe" tags: a positive spawn or generation entry on one admits the
  row, a zero entry on one is skipped (`addsTagsOfType`). The maybe set is closed under the
  pool's own rows, since a reforge's later rolls see the tags of its earlier ones
  (`QUESTIONS.md` Q13); so within one reforge a row another roll's tag would zero stays
  admitted (two cluster notables on a Small jewel, both weapon-specific jewel modifiers),
  and only a tag a present modifier surely adds closes it. A declared `"random"` affix is every natural modifier of its side the item could
  roll (`anonymousTypes`, added to `possible` by the item block), so an adder hidden
  behind one flows through as a maybe tag.
- **Essence** = `strip; rarity(rare); fill(natural ≤ level, reforge 4–6); fill(grant, within)`,
  the rules of [Essence § Crafting](https://www.poewiki.net/wiki/Essence#Crafting) (tiers 1–4
  are an alchemy with one guaranteed affix, tier 5+ also reforge a Rare; the fill is capped
  by the tier's maximum random mod level): its checks are no blocking metamod, Normal
  always, Rare only at ladder tier ≥ 5, never Magic, a base that can be Rare, and a grant
  for the item's class. **Bench** = `fill(bench row, add 1)` after three checks
  ([Crafting Bench](https://www.poewiki.net/wiki/Crafting_Bench)): an open slot in the
  mod's generation; **the crafted-mod limit** (one, or three under an active multimod),
  where `AItem.crafted` is the count of bench-crafted mods present, a range that must be
  provably below the cap (what each op does to it is under `crafted` in §4); and
  **group exclusivity** — the [mod group](https://www.poewiki.net/wiki/Modifier#Group/family)
  rule — where the mod's family must not be possibly-present, via `familiesOfType`. Not
  modelled as a clash: a conflict with an anonymous "random" affix, which may be any
  modifier of its side (`QUESTIONS.md` Q49 for the crafted case). The fill is preceded by
  a `remove` with the **crafted selector** in replacing mode (`removeCrafted`): under a
  limit of one it clears the crafted modifier a craft replaces
  ([Crafting Bench § Using the crafting bench](https://www.poewiki.net/wiki/Crafting_Bench#Using_the_crafting_bench)),
  refused when that modifier may be fractured, when more than one may be present, or when
  a multimod may be on the item without being guaranteed, since the craft would add on
  that path and replace on the other (`craftedReplaceable`); under a guaranteed multimod
  it is a no-op. `bench remove` (`BENCH_REMOVE`) runs the same removal for every crafted
  modifier and needs one guaranteed removable (`craftedRemovable`). A type is a crafted
  modifier when its rows are bench rows (a benched or declared one pins to its row); a
  type with a bench row among others keeps its presence but loses its guarantee.
- **Metamods** ([Metamod](https://www.poewiki.net/wiki/Metamod), the
  [metacrafting bench options](https://www.poewiki.net/wiki/Crafting_Bench#Metacrafting_modifiers))
  are effect-carriers: an effect is active iff its carrier type is GUARANTEED present.
  `rulesInForce` folds `registry.effectsOfType` over the guaranteed types. Placement is
  just `bench "prefixes cannot be changed"`. Which currency respects which metamod is the
  table in [Metamod § Rules and Exceptions](https://www.poewiki.net/wiki/Metamod#Rules_and_Exceptions);
  the wiring follows it: **protect** shrinks the allowed-gens removal set (annul/harvest
  augment respect it) and is what `strip` keeps, so **scour** keeps the protected side and
  **alteration**, **chaos** and **harvest reforge** keep it and reroll the rest (protected
  guarantees + tier pins + a count floor survive, open protected slots may fill from the
  fresh pool; the metamod on the rerolled side goes); **cannot-roll** is a `poolRestrict`
  that folds through `pool` for free (the guaranteed carrier's effect is among the facts);
  **multimod** raises the crafted cap; **essence** is blocked by any protect or cannot-roll
  metamod ("usage prevented" in the table). A cannot-roll metamod also shields its tagged
  guaranteed mods from `annul` alone (`cannotRollShield`; the veiled exalt and harvest
  augment removals ignore it); under one, only a guaranteed unshielded mod proves a
  removal, since an anonymous mod may be tagged. Not modelled from that table: the
  Fracturing Orb ignoring metamods. The curated id→effect table is `model/metamods.ts`.
- **Fractures** ([Fractured item § Mechanics](https://www.poewiki.net/wiki/Fractured_item#Mechanics))
  are a per-mod lock, tracked as `frac@type` atoms in the presence BDD (the tier-atom
  pattern; a `FRAC_EXISTS` sentinel marks "some mod is fractured" so a fracture on an
  anonymous mod still counts), with `fractures`, how many modifiers are locked, as a range
  beside them; `unprovenFractures` is that count less the pinned types, the locks that may
  sit on any current modifier. A declared `fractured "…"` affix asserts a definite
  fracture; the **Fracturing Orb** and the Bestiary's talisman fractures (`lock(n)`; the
  orb's checks are
  [Fracturing Orb § Mechanics](https://www.poewiki.net/wiki/Fracturing_Orb#Mechanics): Rare,
  ≥4 mods, not already fractured) assert "at most `n` of the current mods are fractured",
  and "at least `n`" when the current mods are all named, so a `fractured X` branch chain
  (`refine`) can prove where the locks landed. One method fractures an item once; only the
  talisman recipe locks two at a time, and a scour leaves such an item Rare
  ([Fractured item § Mechanics](https://www.poewiki.net/wiki/Fractured_item#Mechanics)).
  `remove` and `strip` keep the fracture by preserving
  `fractureProjection(a)` (the presence BDD reduced to the fracture atoms, with
  "a locked mod is present" re-asserted; a candidate's own presence is forgotten, since
  the operation may have removed it), so a proven fracture keeps its type and an unproven
  one keeps the survivor disjunction. **Scour** sets the rarity by survivor count
  (`scouredRarities`, read from what the strip kept: none Normal, one Magic, two or more
  Rare, whichever sides they sit on; [Orb of Scouring](https://www.poewiki.net/wiki/Orb_of_Scouring),
  confirmed in game for one kept prefix beside a fractured suffix): a fractured Rare
  scours to a 1-mod Magic. A scour whose survivor count is uncertain (an unproven lock
  beside a kept side, or a kept side with an uncertain count) leaves every rarity the
  range allows, which an `if` on the count or on `isMagic` narrows.
- **Veiled** (`VEILED_CHAOS` / `VEILED_EXALT` / `unveilOps`, the
  [Veiled Chaos Orb](https://www.poewiki.net/wiki/Veiled_Chaos_Orb),
  [Veiled Exalted Orb](https://www.poewiki.net/wiki/Veiled_Exalted_Orb) and the
  three-option unveil of [Veiled modifier § How to obtain](https://www.poewiki.net/wiki/Veiled_modifier#How_to_obtain)):
  the orbs fill a veiled placeholder (the `VeiledPrefix ∨ VeiledSuffix` disjunction,
  generation fixed-random so unknown) within a reforge or after a removal. The Veiled
  Exalted Orb refuses an item that may already carry a placeholder or an unveiled result
  mod (`mayHaveVeiled`); the Veiled Chaos Orb refuses only one the reforge would keep, on a
  protected side or fractured (`noVeiledKept`, `veiledWouldSurvive`), since it rerolls the
  rest away.
  `unveil` fills from `veiledPool` (`pool/veiled.ts` — the unveiled result mods valid on
  the base, minus families already present, which is "blocking"), replacing the
  placeholder, and either asserts the pool disjunction (narrow with `if has`) or, with a
  target, guarantees it once the pool is ≤ 3. The veiled `domain` keeps result mods out of
  the normal `pool`. Model helpers in `model/veiled.ts`.
- **Harvest** ([Harvest crafting](https://www.poewiki.net/wiki/Harvest_crafting); the tags
  are its [modifier groups](https://www.poewiki.net/wiki/Harvest_crafting#Modifier_groups)):
  the reforge is a rare reforge then `fill(tagged, within)`, a DISJUNCTIVE guarantee — "at
  least one mod carrying `tag`" — as one OR clause over the tagged types (a wide clause is
  sound, just skipped by `disjunctiveGuarantees`' variable guard). The augment (the wiki's
  "Augment" crafts; Craft of Exile's "Add/Remove") is `remove; fill(tagged, add 1)`: net
  count unchanged, the removal over the allowed-gens set — which matches
  [Harvest crafting § Mechanics](https://www.poewiki.net/wiki/Harvest_crafting#Mechanics):
  it obeys prefix/suffix locks but ignores cannot-roll metamods. A tag is matched against
  `Mod.implicitTags`; the `require` that the tagged pool is non-empty sits after the
  strip or the removal, reading the state they produce, and fails as
  `harvestEmptyPool` when no tagged row rolls on the base at all, `harvestBlocked` when
  one does but a modifier the item may carry blocks every one (its type, its group), or
  `harvestNoRoom` when some path leaves it no slot. It reads a **subset pool** (`subsetMods`): the
  pool as if every possibly present modifier were present, with the tags it may add read
  pessimistically (`lookupWeight`'s pessimistic mode), a subset of every path's real pool
  where a fill reads a superset (`addableMods`). When that pool is empty, the pair of side
  counts is still open if the few unnamed modifiers of the path cannot block every tagged
  row the guaranteed facts leave (`taggedRowSurvives`: a path holds at most as many
  possibly present modifiers as affixes no guaranteed type accounts for, each blocking the
  rows that share a family with it or that a tag it adds zeroes, so one unknown suffix
  cannot block both a life leech and a mana leech); so a tagged pool that a possibly kept
  modifier empties refuses the craft. The counts are read per path: every (prefix,
  suffix) pair the coupled count ranges allow (`sidePairs`) must leave a tagged row
  room, so a full Rare whose removal may take either side still admits a tag with rows
  on both.

### `diagnostics.ts`: messages

`renderState(a)` is the one-line state summary used in both errors and hover, leading
with the **total affix count** then the prefix/suffix split (the total restores the
correlation the coupled ranges track). `preconditionMessage` = state first, then what
the op needed (surface doc §6). `describePred`, `resolveMessage` for the rest.

---

## 5. Key files index

| Path                                                                     | What                                                                                                 |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| `packages/core/src/check/astate.ts`                                      | `AItem` (the reduced product), `normalize`, `refine`, `join`, `TierDomain`, presence views           |
| `packages/core/src/check/values.ts`                                      | modifier values: `rollRange` from a row's text, `narrowRange` by a comparison, `ValueDomain`         |
| `packages/core/src/check/domain.ts`                                      | `Domain<T>` contract, `RangeDomain`, `SetDomain`, range algebra                                      |
| `packages/core/src/model/capacity.ts`                                    | the affix caps (`sideCap`, `hardTotalCap`, `maxTotal`, `caps`), shared by the pool and the checker   |
| `packages/core/src/model/strands.ts`                                     | the tiers memory strands let roll, and their cap                                                     |
| `packages/core/src/check/counts.ts`                                      | `CountDomain` (suffix, the total/prefix coupling, count refine, `learnPresent`)                      |
| `packages/core/src/check/bdd.ts`                                         | the hash-consed ROBDD behind `presence`                                                              |
| `packages/core/src/check/check.ts`                                       | driver, `Flow`, loops/branches, defs, `TraceEntry`, `traceAt`                                        |
| `packages/core/src/check/ops.ts` / `library.ts`                          | the primitive operations and their interpreter / every method as a sequence of them                  |
| `packages/core/src/check/methods.ts`                                     | the method table: each method's words, argument slots, help and `build`                              |
| `packages/core/src/model/marks.ts`                                       | the influences and their data tags, `InfluenceKey`, the mark labels                                  |
| `packages/core/src/check/diagnostics.ts`                                 | `renderState`, message builders                                                                      |
| `packages/core/src/model/metamods.ts`                                    | the curated metamod id → effect table, attached to the catalog at registry build                     |
| `packages/core/src/model/veiled.ts`                                      | veiled placeholder types and the unveiled-result predicate                                           |
| `packages/core/src/pool/veiled.ts`                                       | `veiledPool`: which unveiled mods an `unveil` can reveal on an item                                  |
| `packages/core/src/resolve/registry.ts`                                  | `Registry`, `buildRegistry`, resolution, completion lists                                            |
| `packages/core/src/resolve/fuzzy.ts` / `tiers.ts`                        | fuzzy mod matching / rollable tiers (+ the memoized empty pool)                                      |
| `packages/core/src/pool/pool.ts`                                         | eligibility + weights                                                                                |
| `packages/parser/src/{lexer,parser,token}.ts`                            | lexer / parser / token types                                                                         |
| `packages/parser/src/vocabulary.ts`                                      | the surface vocabulary outside the method table (keywords, predicate words, item fields)             |
| `packages/data/src/{load,bundle,adapter}.ts` + `scripts/ingest-poe1.mjs` | data load (disk in `load`, pure in `bundle`) + ingest                                                |
| `editors/playground/src/{main,monaco,language,providers,convert}.ts`     | the browser playground: Monaco bound to the language service                                         |
| `editors/playground/src/item-card.ts`                                    | the item drawn in the game's style from `itemView`                                                   |
| `editors/playground/src/storyboard.ts`                                   | the storyboard pane: the item after every step, loops and branches as regions, bound to the editor   |
| `editors/playground/scripts/fetch-icons.mjs`                             | copies the currency icons from the wiki into `src/icons/`                                            |
| `packages/core/src/render/item.ts`                                       | `itemView`, `renderItemText`: the item as a player reads it, in the game's copy layout               |
| `packages/core/src/render/walkthrough.ts`                                | `walkthrough`, `stepDelta`: the guide as steps with the item before and after each                   |
| `packages/core/src/render/flowchart.ts`                                  | `flowchart`: a walkthrough as Mermaid flowchart text, node ids mapped to statements                  |
| `packages/core/src/render/conditions.ts`                                 | `clause`, `criteria`: a guide's conditions as prose and as a checklist, in the player's words        |
| `packages/core/src/cost/race.ts`                                         | the weighted draw as an exponential race: top-`k` membership, its joint distribution, the split      |
| `packages/core/src/cost/roll.ts`                                         | `rollOf`: a method's op sequence on the checker's item as the pools, counts and certainties it draws |
| `packages/core/src/cost/chance.ts`                                       | `chance`: a resolved predicate's probability against a roll                                          |
| `packages/core/src/cost/recombine.ts`                                    | the Recombinator's count table and weighted pick under the exclusive rule                            |
| `packages/core/src/cost/chain.ts`                                        | a loop of removals, single draws and bench crafts as a Markov chain over counts and named modifiers  |
| `packages/core/src/cost/prices.ts` / `report.ts`                         | unit costs and the `Prices` snapshot / `costOf`: the walk, one `StepCost` per statement              |
| `packages/core/src/cost/words.ts`                                        | the report's figures, chances and prices in the guide's words, shared by every surface               |
| `packages/core/src/cost/{race,chain,recombine,report}.test.ts`           | the race against brute force, the chain and the pick by hand, the walk over fixture guides           |
| `packages/data/scripts/fetch-economy.mjs`                                | refreshes `packages/data/data/poe1/economy.json` from poe.ninja                                      |
| `packages/cli/src/check.ts`                                              | `checkSource`, `chartSource`, `costSource`: the CLI's check, chart and cost report, pure             |
| `packages/lsp/src/{walkthrough,flowchart}.test.ts`                       | the walkthrough model and its flowchart over real guides                                             |
| `packages/lsp/src/{hover,completion,semantic,service,server,node}.ts`    | LSP features                                                                                         |
| `packages/lsp/src/analysis.ts`                                           | the parse and check of a document, memoized by text; every feature reads it                          |
| `packages/lsp/src/navigation.ts`                                         | highlights, definition, references, rename, outline over the bindings                                |
| `packages/lsp/src/signature-help.ts`                                     | `getSignatureHelp`: a call's parameters or a method's slots, the active one marked                   |
| `packages/lsp/src/folding.ts`                                            | `getFoldingRanges`: brace blocks, comment runs, multi-line predicate defs                            |
| `packages/lsp/src/inlay-hints.ts`                                        | `getInlayHints`: parameter sorts at declarations, parameter names at calls                           |
| `packages/lsp/src/formatting.ts`                                         | `getFormattingEdits`: Format Document over `formatCraft`                                             |
| `packages/parser/src/format.ts`                                          | `formatCraft`: the formatter, comments and blank-line grouping kept                                  |
| `packages/parser/src/format.test.ts`                                     | formatter layout tests; the example guides stay stable and keep their meaning                        |
| `packages/core/src/ast/bindings.ts`                                      | `bindingsOf`: every def and parameter with its declaration and references                            |
| `packages/lsp/src/method-at.ts`                                          | `methodAt`: the method statement a token or cursor position belongs to                               |
| `packages/core/src/check/check.test.ts`                                  | checker tests (currency set, count-coupling regression, loops, defs)                                 |
| `packages/core/src/check/check-tiers.test.ts`                            | tier-pinned predicates and the tier overlay through the checker                                      |
| `packages/core/src/check/counts.test.ts`                                 | `CountDomain` in isolation (caps, coupling, refine)                                                  |
| `packages/core/src/check/make-room.test.ts`                              | annulling a full item down to open slots: the suffix bound survives the loop                         |
| `packages/core/src/check/loop-exit.test.ts`                              | a loop whose exit takes several iterations, and one whose exit is never reached                      |
| `packages/core/src/check/veiled-bench.test.ts`                           | a bench craft between the veiled orb and the unveil keeps the veiled modifier                        |
| `packages/core/src/check/anonymous-affix.test.ts`                        | a declared random affix may be any modifier of its side, and clashes with a craft of its group       |
| `packages/cli/src/examples.test.ts`                                      | every guide under `examples/` checks clean against the bundled catalog                               |
| `packages/core/src/check/bdd.test.ts`                                    | the ROBDD manager (canonicity, operators)                                                            |
| `packages/core/src/check/fracture.test.ts`                               | fractured items and the Fracturing Orb through the checker                                           |
| `packages/core/src/check/harvest.test.ts`                                | harvest reforge / augment through the checker                                                        |
| `packages/core/src/check/metacraft.test.ts`                              | metamods: protection, cannot-roll, multimod, essence blocking                                        |
| `packages/core/src/check/fossil.test.ts`                                 | resonators: blocked tags, added and forced rows, the corrupted-essence guarantee, the fracture       |
| `packages/core/src/check/bench.test.ts`                                  | bench remove and the replace of a crafted modifier                                                   |
| `packages/core/src/check/foulborn.test.ts`                               | the Foulborn orbs' top-tier cull                                                                     |
| `packages/core/src/check/beast.test.ts`                                  | the Bestiary recipes                                                                                 |
| `packages/core/src/check/harvest-change.test.ts`                         | the Harvest change of a modifier into another element                                                |
| `packages/core/src/check/veiled.test.ts`                                 | veiled orbs and `unveil` through the checker                                                         |
| `packages/lsp/src/features.test.ts`                                      | hover / completion / semantic-token tests                                                            |
| `packages/lsp/src/navigation.test.ts`                                    | highlight / definition / references / rename / outline tests                                         |
| `packages/lsp/src/signature-help.test.ts`                                | signature help for def calls and method slots                                                        |
| `packages/lsp/src/service.test.ts`                                       | `getDiagnostics` over the real data pipeline                                                         |

---

## 6. Gotchas

- **ESM (NodeNext)** in core/parser/data/lsp: relative imports need explicit `.js`
  extensions (`../ast/span.js`), even in `.ts` source. `SourceSpan` lives in
  `ast/span.js`, not `ast/ast.js`.
- **The vscode extension is CommonJS**: don't make it extend the ESM base tsconfig.
- Base **display names are not unique**; resolution treats a name collision as
  `ambiguous` unless the bases agree on class, domain, tags and caps (`sameToTheModel`),
  and ids are metadata paths.
- **Loop widening over-approximates PRESENCE only** (the held imprint's included).
  Counts/`possible`/tiers converge on their own, so they are left exact; an earlier
  attempt that also interval-widened the counts corrupted the after-state total. Widen
  presence, leave the rest.
- **Rarities are a set.** Paths that meet at different rarities keep both; an operation
  that needs one rarity is refused until an `if` on `isRare`, `isMagic` or `isNormal`
  narrows the set, and the counts' caps are the loosest over it.

---

## 7. Design note: relational precision (why a BDD, and why not Z3)

The design framed well-formedness, dead-branch checks, and refinement as verification
conditions in an SMT-decidable fragment (linear arithmetic over counts + set
membership), with the guidance "start hand-rolled; reach for Z3 only if something
needs it". `AItem` IS that hand-rolled decision procedure.

A purely non-relational version (independent guaranteed/possible/excluded sets per
type) loses disjunctive facts: after `until has A or has B { … }`, joining the exit
states intersects the guarantees away, so "at least one of A/B is present" is
forgotten and a later `if not A and not B` isn't flagged dead. Options weighed:

- Special-casing "≥1 present" groups: throwaway once general.
- Powerset/DNF of states: enumeration; violates the intensional-union rule.
- **BDD over type presence, chosen and built.** One boolean function represents all
  presence knowledge; refine = AND, join = OR, dead = FALSE. Deterministic, pure TS,
  compact (bounded by the handful of types a craft refines), keeps the fixpoint
  machinery.
- Z3/SMT via wasm: strictly more general (would also couple counts to presence
  disjunctions) but a heavy async dependency that breaks core's purity, gives worse
  diagnostics (unsat cores vs rendered state), and doesn't remove the need for the
  loop-invariant fixpoint. **Reserved** for the case that needs counts coupled to
  presence disjunctions.
