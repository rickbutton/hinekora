# Hinekora: Codebase Reference

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
> Exile wiki (poewiki.net) that defines it, and the text covers only how Hinekora models it.
> The wiki is cached locally (`tools/poewiki`, the `poewiki-render` skill).

---

## 1. What Hinekora is

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
                                resolve, check). No I/O.
  parser/   @hinekora/parser - hand-written lexer + parser: source → Craft AST.
  data/     @hinekora/data   - loads projected RePoE JSON, builds a Registry.
  lsp/      @hinekora/lsp    - transport-free language service + stdio server.
  cli/      @hinekora/cli    - command-line checker.
editors/
  vscode/                    - VSCode extension (TextMate grammar + LSP client).
examples/
  example.craft              - the demo craft (open in the Extension Dev Host).
  essence-life-boots.craft   - essence + def + or example.
  bench-finish-resists.craft - finishing a Rare at the bench (open slot + group rule).
  phys-dot-weapon.craft      - a fractured Rare, chaos/annul/bench with predicate defs.
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
  disables) plus the [mod level](https://www.poewiki.net/wiki/Modifier#Mod_Level) gate.
- **render/**: the labels diagnostics and hover show (`modLabel`, `baseLabel`).
- **resolve/**: `Registry` (the resolved data surface). Key methods:
    - `resolveBase / resolveMod / resolveModType(name, ctx?) / resolveCurrency /
resolveEssence / resolveBench / resolveHarvestTag`
    - `effectsOfType(type)`: the effects a carrier type contributes (the metamod seam the
      checker folds over guaranteed types; empty for everything else).
    - `resolveHarvestTag(name)` maps a surface category ("fire", "caster") to its
      canonical `Mod.implicitTags` tag via the curated `HARVEST_TAGS` table.
    - `resolveModType` is **fuzzy and base-aware**: text → ModType, narrowed to types that
      can actually roll on the given base/ilvl (`ctx`), returning `ambiguous` with
      candidates when several match. Built on `fuzzy.ts`; a query token matches exactly OR
      as a **≥3-char prefix** of an entry token ("max life" → "maximum life").
    - `genOfType(type)` → prefix/suffix; `familiesOfType(type)` → mod groups (drives the
      bench group-exclusivity check); `typeLabel(type)` → friendly wording for display.
    - Precomputed completion lists: `currencies`/`currencyNames`, `baseNames`,
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

### 3b. `@hinekora/parser`

Lexer (`tokenize`) → `Token[]` (trivia-free; no keyword token kind, every word is an
`ident` and the parser decides by text). The words the parser gives meaning to are the
tables in `vocabulary.ts` (the item block, control flow, predicates, item fields) and the core's
method table (`check/methods.ts`), which completion, hover and the docs check read too.
A statement that is not control flow or a call is an `OperationStmt`: `parseOperation`
takes its opening word, a second word when `methodsAfter` says the family has one, and
then one argument per slot of the method's `args` (`parseSlot`: a quoted name or a
parameter, a word from a fixed set, a number, a tier; optional slots may be left off).
A missing argument's error says what the slot wants in the guide's words (`QUOTED`)
after the statement as written so far.
An unknown opening word still parses as an operation, so the checker names it. `parse(source)` returns `{ ok, craft }` or
`{ ok: false, error }` with a message + span. Tokens carry spans whose `offset` is a
UTF-16 code-unit index into the source (the LSP's own offset convention). The lexer
emits `eq` for `==` and `assign` for a lone `=` (the def binding).

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
filter on). The eldritch implicit rows (eldritch.json, `scripts/ingest-eldritch.mjs`,
`projectEldritch`) come from the current export with their own `provenance`: side, tier
(read off the `no_tier_<n>_eldritch_implicit` tag that excludes the row), type, the
class tags it rolls on and its text; a row with no tier or no class is not obtainable
and is dropped. `adaptEldritch` makes an `EldritchImplicitSpec`; the registry offers
`eldritchPool(base, side, tier)`, `resolveEldritch(name, side, base?)` (every type the
wording covers, the "presence" variants among them; several wordings are ambiguous),
`eldritchNames(side)` (one wording per implicit) and `eldritchTextOf(type)`. For a base it also folds the affix-count implicit stats
(`local_maximum_{prefixes,suffixes}_allowed_+`) into a `capDelta` (absent when zero).
`adapter.ts` adapts rows into model types and stamps `ModSource` via `classifySource`
(domain + generation_type + is_essence_only). `load.ts`: `loadDefaultPoe1()` →
`LoadedData`, `registryOf(data)` → `Registry`.

Essence data note: `maxRandomModLevel` is the "maximum level for random mods" column of the
tier table in [Essence § Crafting](https://www.poewiki.net/wiki/Essence#Crafting) and caps only
the random FILL mods. Essences have no item-level gate: the guaranteed mod is forced at its
fixed tier regardless of ilvl (not stated on the wiki; confirmed by in-game testing).

### 3d. `@hinekora/lsp`

Transport-free service functions + a stdio server:

- `service.ts`: `getDiagnostics`.
- `hover.ts`: `getHover(source, offset, registry)` is **token-centric**. The hovered
  token's signature (currency op / mod / base / essence / bench / def / projection /
  keyword) plus an item-tooltip footer of the state at that point. Details:
    - The tooltip is a PoE-style item view built as **three general layers** over the
      presence BDD, not per-case handlers: unit facts (`guaranteedTypes`/`excludedTypes`),
      prime implicates (`disjunctiveGuarantees`), and a cardinality fold
      (`cardinalityGuarantees`, "≥k of n"). Adding a new readable form means adding a
      layer. Each mod line shows the exact roll when its tier is pinned, else the roll
      span across candidate tiers; the undetermined remainder renders as ONE coupled line
      ("1 more, a prefix or a suffix"), not two independent per-side ranges.
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
      as one shared signature (`defAt`).
- `completion.ts`: `getCompletions`. The pieces of the current line before the cursor
  (`piecesOf`: words, numbers, closed strings, the open string) pick the context
  (`contextAt`): statement (each method's first word + control keywords; also once
  the method before the cursor has no slot left), predicate (after
  `if`/`until`/`not`/`and`/`or`; includes local def names scraped by regex), base, the
  second word of a method family (`methodsAfter`), a `word` slot's choices, a `name`
  slot's catalog names (essences, bench crafts, fossils, Aspects, harvest tags), or
  mod; the slot comes from the same `methodAt` hover uses. Mod candidates are **filtered to what's possible at the cursor**:
  rollable on the item's base+ilvl (`rollableTypes`, base read from the text) AND not
  proven-absent by the checker's state at that point (`excludedAt` parses the craft,
  retrying with the open string closed). Both filters degrade gracefully to "all mods"
  when the base can't be read / nothing parses.
- `semantic.ts`: `getSemanticTokens`, lexer-driven; legend
  `["keyword","property","function"]`; keywords are the control and predicate words plus
  `METHOD_WORDS` (currency names colour as functions); returns empty on unlexable input.
- `server.ts`: `createServer(connection, registry)`, capabilities + handlers.
  `triggerCharacters` includes `"` so the mod/base list pops when a string opens.
- `node.ts`: stdio entry (`vscode-languageserver/node.js`, explicit `.js` for NodeNext).
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
just those ops applied field-by-field. A cross-domain fact (e.g. crafted ⊆ affixes) is a
**reduction** applied explicitly at the product level in `normalize`, never hidden inside
one domain. The sub-domains:

- **Counts (`check/counts.ts`, `CountDomain`).** `total` and `prefix` are integer RANGES
  `[min,max]`; **suffix is DERIVED**: `CountDomain.suffix = [total.min − prefix.max,
total.max − prefix.min]` (capped). Tracking the total preserves the `p + s = total`
  correlation two independent side-ranges would lose. Reads the affix caps from
  `model/capacity.ts` (`sideCap`/`hardTotalCap`/`maxTotal`/`caps`, re-exported here and the
  first three through `astate`), and owns the coupling `normalize`, count-comparison
  `refine`, and `learnPresent` (the "≥1 affix, ≥1 in gen" bump shared by `has` and
  essence/bench). Independently unit-tested in `counts.test.ts`.
- **`presence` is a BDD** (`bdd.ts`, a small hash-consed ROBDD over type-presence
  variables): the relational mod knowledge. "Guaranteed X" = presence entails X;
  "excluded X" = entails ¬X; a disjunction ("one of these three is present") survives a
  control-flow `join` because **join is BDD-OR**. Views: `isGuaranteed`/`isExcluded`/
  `guaranteedTypes`/`excludedTypes`/`disjunctiveGuarantees`/`cardinalityGuarantees`.
  `possible` stays a plain set: the pool whitelist of types that could roll.
- `tiers` (`TierDomain`, in `astate.ts`): an overlay `Map<TypeId, Set<ModId>>` refining
  which specific mod (tier) a present type could be. The overlay is non-relational, so it
  is joined per-type and a tier known in only one branch drops to unconstrained. Its
  refinement is coupled to `presence` (tier atoms), so that part lives in `refine`, not the
  domain.
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
  Conflict maps each pair to the two it can reach, and `dominantOf` reads which side the
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
  hover so a disjunctive block shows the t1 roll, not the full span). We do NOT yet assert
  `tierAtom ⇒ family` or tier mutual-exclusion; both only under-claim if omitted (sound).
- **`normalize(a)`** runs `CountDomain.normalize` (the total/prefix coupling to a fixpoint,
  BOTH directions: `prefix ∈ [total−sCap, min(pCap, total)]` AND
  `total ∈ [prefix, min(tCap, prefix+sCap)]`) then re-applies the one cross-domain reduction
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
- `refine(a, pred, positive)` narrows by a resolved predicate (De Morgan for and/or:
  conjunction = sequential narrow, disjunction = `join`); `null` means the sub-state is
  impossible, the dead-branch signal. `join` is the branch-merge LUB; `stateEqual`
  detects loop fixpoints (`presence` compares by `===`, the BDD is canonical).

### `check.ts`: the driver

- `Flow` = a statement either `{ kind: "fall", state }` or `{ kind: "restart" }`
  (diverges, re-entering the enclosing loop).
- `if/else`: narrow into each arm, check, **join** the falling states. A branch whose
  condition is impossible (or whose negation always holds) is flagged as never running.
- `until` loops, three steps. (a) **reachability**: if the exit predicate can never be
  satisfied on this base, report "can never exit" (the root cause) instead of downstream
  symptoms. (b) **soundness across iterations**: compute the loop invariant (a join
  fixpoint over continue-states) and run the body once from it; this is what catches
  `until has X { exalt }` eventually filling the item. (c) **loop-exit-as-proof**: refine
  the after-state by the exit predicate. All three share one primitive, `headStates(entry,
body)`, the states that re-enter the loop head after one iteration (fall-off-end +
  every `restart` back-edge), plus `refineHeads(states, ¬/exit)`; `foldJoin` merges a list
  of states. Two suppression modes are scoped helpers, not manual counters: `quietly` (no
  diagnostics, no trace, for probe/fixpoint passes) and `untraced` (trace off, diagnostics
  on, for inlined proc bodies).
- **Predicate defs** (`def name(p) = <pred>`): local, parameterized, pure. Param sorts
  are **inferred from use**: `tier | count | mod`, three DISTINCT sorts (`t1` is not
  the int `1`); conflicting uses are an error and the def is dropped without cascading;
  unused params are an error; recursion is caught (`expanding` set). A call checks arity
  and arg sorts, substitutes args into the body, then resolves it, so all existing
  narrowing just works. Params can be forwarded to nested calls (`def a(t) = b(t)`).
- **Operation functions** (`def name(p) { <stmts> }`): the statement-valued sibling of a
  predicate def, dispatched at parse time by a `{ … }` body. A `CallStmt` (`checkCall`)
  binds args (shared `bindArgs`/param-sort machinery) and inlines the substituted body
  via `checkSeq` in the caller's context, so state threading, nested loops/ifs, and
  `restart` back-edges compose with no special handling. Param-sort inference walks the
  statements (`noteStmtUses`) and substitution recurses through them (`substituteStmt`);
  a param can fill a `has`/`bench`/`essence` mod-name or tier slot, a `harvest` tag, or an
  `unveil` mod. Procs share the def name space and `expanding` guard; the inlined body is a trace black box (`suppressTrace`).
- **Operation statements** (`checkOperation`): look the statement's words up in the
  method table (`findMethod`; an unknown word is "Unknown currency" or "Unknown
  operation"), bind its arguments to the method's slots as `Literal`s (a parameter left
  unbound is an error), call the entry's `build` for the op sequence (or its `Refusal`,
  reported as a diagnostic) and run it with `runMethod`. The slot kinds give param sorts
  (`slotSort`) and substitution (`subOperationArg`).
- **Trace** (`TraceEntry[]`): `{ span, kind, before, after? }` per statement (and the
  item block), recorded only on the real (non-quiet) pass. `traceAt(trace, offset)`
  returns the innermost entry covering an offset; this powers hover.
- `elaborateItem`: declared mods must **pin a tier** (`[ "maximum life" t1 ]`) via an
  exact id/alias or a description + `t<n>`; a bare description is an error. Placeholders
  (`"random"`/`"?"`) stay anonymous. Pinned tiers seed the `tiers` overlay, so the
  starting item is fully concrete.

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
`{ok, state}` or `{ok:false, failure}`. The operations are `require(check)`, `strip`,
`fill(pool, count)`, `remove(selector)`, `rarity(r | survivors)`, `lock`,
`imprint`/`restore`, `influence(change)` (set the mark, add an influence to every
possible set, or randomise to every set of the same size), `eldritch(change)` (set an
implicit's tier, or the Orb of Conflict's raise and lower), `unprotect` (the metamods
no longer govern the rest of the method, the Awakener's Orb), `keep(gen)` (that side is
kept through the rest of the method, the Eldritch Chaos Orb), `corrupt`, `relax`
(forget the present modifiers' tiers, `relaxTiers`, the crafted ones excepted when
asked), `elevate` (the Orb of Dominance's upgrade: every influenced modifier the item
may have loses its tier and may be its elevated row, a type of its own sharing its
group and named "Elevated"; one of them remains) and `either(branches)`, the join of running each branch of effects, a branch of
`end` alone being an outcome that destroys the item and adds nothing; a method is
all or nothing, so a failed `require` anywhere leaves the state as it was. The metamods
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
  would add passed as "maybe" tags: a positive spawn entry on one admits the row, a zero
  entry on one is skipped (`addsTagsOfType`). The maybe set is closed under the pool's own
  rows, since a reforge's later rolls see the tags of its earlier ones (`QUESTIONS.md`
  Q13). A declared `"random"` affix is outside `possible`, so an adder hidden behind one
  is not seen, the same anonymous-affix gap as the bench group conflict.
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
  modelled: a conflict hidden behind an anonymous "random" affix. The fill is preceded by
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
  where a fill reads a superset (`addableMods`); so a tagged pool that a possibly kept
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

| Path                                                                  | What                                                                                               |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `packages/core/src/check/astate.ts`                                   | `AItem` (the reduced product), `normalize`, `refine`, `join`, `TierDomain`, presence views         |
| `packages/core/src/check/domain.ts`                                   | `Domain<T>` contract, `RangeDomain`, `SetDomain`, range algebra                                    |
| `packages/core/src/model/capacity.ts`                                 | the affix caps (`sideCap`, `hardTotalCap`, `maxTotal`, `caps`), shared by the pool and the checker |
| `packages/core/src/check/counts.ts`                                   | `CountDomain` (suffix, the total/prefix coupling, count refine, `learnPresent`)                    |
| `packages/core/src/check/bdd.ts`                                      | the hash-consed ROBDD behind `presence`                                                            |
| `packages/core/src/check/check.ts`                                    | driver, `Flow`, loops/branches, defs, `TraceEntry`, `traceAt`                                      |
| `packages/core/src/check/ops.ts` / `library.ts`                       | the primitive operations and their interpreter / every method as a sequence of them                |
| `packages/core/src/check/methods.ts`                                  | the method table: each method's words, argument slots, help and `build`                            |
| `packages/core/src/model/marks.ts`                                    | the influences and their data tags, `InfluenceKey`, the mark labels                                |
| `packages/core/src/check/diagnostics.ts`                              | `renderState`, message builders                                                                    |
| `packages/core/src/model/metamods.ts`                                 | the curated metamod id → effect table, attached to the catalog at registry build                   |
| `packages/core/src/model/veiled.ts`                                   | veiled placeholder types and the unveiled-result predicate                                         |
| `packages/core/src/pool/veiled.ts`                                    | `veiledPool`: which unveiled mods an `unveil` can reveal on an item                                |
| `packages/core/src/resolve/registry.ts`                               | `Registry`, `buildRegistry`, resolution, completion lists                                          |
| `packages/core/src/resolve/fuzzy.ts` / `tiers.ts`                     | fuzzy mod matching / rollable tiers (+ the memoized empty pool)                                    |
| `packages/core/src/pool/pool.ts`                                      | eligibility + weights                                                                              |
| `packages/parser/src/{lexer,parser,token}.ts`                         | lexer / parser / token types                                                                       |
| `packages/parser/src/vocabulary.ts`                                   | the surface vocabulary outside the method table (keywords, predicate words, item fields)           |
| `packages/data/src/{load,adapter}.ts` + `scripts/ingest-poe1.mjs`     | data load + ingest                                                                                 |
| `packages/lsp/src/{hover,completion,semantic,service,server,node}.ts` | LSP features                                                                                       |
| `packages/lsp/src/method-at.ts`                                       | `methodAt`: the method statement a token or cursor position belongs to                             |
| `packages/core/src/check/check.test.ts`                               | checker tests (currency set, count-coupling regression, loops, defs)                               |
| `packages/core/src/check/check-tiers.test.ts`                         | tier-pinned predicates and the tier overlay through the checker                                    |
| `packages/core/src/check/counts.test.ts`                              | `CountDomain` in isolation (caps, coupling, refine)                                                |
| `packages/core/src/check/bdd.test.ts`                                 | the ROBDD manager (canonicity, operators)                                                          |
| `packages/core/src/check/fracture.test.ts`                            | fractured items and the Fracturing Orb through the checker                                         |
| `packages/core/src/check/harvest.test.ts`                             | harvest reforge / augment through the checker                                                      |
| `packages/core/src/check/metacraft.test.ts`                           | metamods: protection, cannot-roll, multimod, essence blocking                                      |
| `packages/core/src/check/fossil.test.ts`                              | resonators: blocked tags, added and forced rows, the corrupted-essence guarantee, the fracture     |
| `packages/core/src/check/bench.test.ts`                               | bench remove and the replace of a crafted modifier                                                 |
| `packages/core/src/check/foulborn.test.ts`                            | the Foulborn orbs' top-tier cull                                                                   |
| `packages/core/src/check/beast.test.ts`                               | the Bestiary recipes                                                                               |
| `packages/core/src/check/harvest-change.test.ts`                      | the Harvest change of a modifier into another element                                              |
| `packages/core/src/check/veiled.test.ts`                              | veiled orbs and `unveil` through the checker                                                       |
| `packages/lsp/src/features.test.ts`                                   | hover / completion / semantic-token tests                                                          |
| `packages/lsp/src/service.test.ts`                                    | `getDiagnostics` over the real data pipeline                                                       |

---

## 6. Gotchas

- **ESM (NodeNext)** in core/parser/data/lsp: relative imports need explicit `.js`
  extensions (`../ast/span.js`), even in `.ts` source. `SourceSpan` lives in
  `ast/span.js`, not `ast/ast.js`.
- **The vscode extension is CommonJS**: don't make it extend the ESM base tsconfig.
- Base **display names are not unique**; resolution treats a name collision as
  `ambiguous`, and ids are metadata paths.
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
