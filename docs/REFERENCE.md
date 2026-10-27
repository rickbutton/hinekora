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
craft in poe1

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
  core/     @hinekora/core   - pure, UI-agnostic kernel (model, pool, outcome,
                                currency, render, resolve, check). No I/O.
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

- **model/**: `Item`, `Mod` (one row per _tier_, i.e. one row of the game's `Mods` table;
  `type` is the ModType bucket, `families` the
  [mod groups](https://www.poewiki.net/wiki/Modifier#Group/family), `implicitTags` the
  [mod tags](https://www.poewiki.net/wiki/Modifier#Mod_tag) that tag-directed crafting selects
  on — harvest, fossils), `Base` (id = metadata path, since display names collide across
  hundreds of bases), `Weight` (provenance-tagged), `Effect` seam, `ModSource`, and the `wf`
  (well-formedness) rules. Branded id types in `model/ids.ts`.
- **pool/**: `pool(catalog, item)`, which mods can roll on an item: the wiki's
  [spawn weight tag](https://www.poewiki.net/wiki/Modifier#Spawn_weight_tag) rule (the item's
  tags, `itemTags`: the base's plus the `adds_tags` of present mods, a rule the data
  carries rather than the wiki (`QUESTIONS.md` Q2), vs the mod's spawn table,
  first match wins, zero disables) plus the
  [mod level](https://www.poewiki.net/wiki/Modifier#Mod_Level) gate.
- **outcome/**: the symbolic outcome-union machinery. Intensional: chaining consumes a
  description; `arms()` expands one only on the on-demand render/probability path.
- **currency/**: the concrete base currency library (transmute/regal/exalt/annul) that
  produces symbolic `Outcome`s from a concrete item. Shares op names with the checker's
  transfer functions; `check/index.ts` re-exports only the transfer _types_ to avoid an
  ambiguous barrel re-export.
- **render/**: plain-text renderers (`baseLabel`, item/outcome/error → text).
- **resolve/**: `Registry` (the resolved data surface). Key methods:
    - `resolveBase / resolveMod / resolveModType(name, ctx?) / resolveCurrency /
resolveOmen / resolveEssence / resolveBench / resolveHarvestTag`
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
    - `tiers.ts`: `rollableTiers(catalog, game, base, ilvl, type)` (pool ∩ type, sorted
      by minLevel desc so T1 = best available), `tierMod`, `rollableTypes` (the
      type-level pool; drives base-aware mod completion). The empty-item pool is
      memoized per (base, ilvl), the single biggest checker/LSP speedup (hover
      78ms → 4ms).
- **check/**: the abstract-interpretation checker (§4 below).

### 3b. `@hinekora/parser`

Lexer (`tokenize`) → `Token[]` (trivia-free; no keyword token kind, every word is an
`ident` and the parser decides by text). The words the parser gives meaning to are the
tables in `vocabulary.ts`, which completion and the docs check read too. `parse(source)` returns `{ ok, craft }` or
`{ ok: false, error }` with a message + span. Tokens carry spans whose `offset` is a
UTF-16 code-unit index into the source (the LSP's own offset convention). The lexer
emits `eq` for `==` and `assign` for a lone `=` (the def binding).

### 3c. `@hinekora/data`

Ingest scripts (`scripts/ingest-poe1.mjs`) project the RePoE-fork JSON dump down to just
the fields needed (mods, bases, essences, bench options), minified, with a **provenance
manifest** (repoe commit SHA + sha256 hashes; gameVersion "unknown" because repoe doesn't
stamp it). A mod's projection keeps `implicit_tags` (the category tags harvest and fossils
filter on). For a base it also folds the affix-count implicit stats
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
    - `essence`/`bench "<name>" [t1]` and a def's declaration/calls/params each hover as
      one shared signature (`namedAt` / `defAt`).
- `completion.ts`: `getCompletions`. A backward text-scan (`contextAt`) picks the
  context: statement (currencies + control keywords + the sourced keywords `essence`,
  `bench`, `harvest`, `veiled`, `unveil`), predicate (after
  `if`/`until`/`not`/`and`/`or`; includes local def names scraped by regex), base,
  essence, bench, harvest verb (after `harvest`), harvest tag (after `reforge`/`augment`),
  veiled verb (after `veiled`), or mod. Mod candidates are **filtered to what's possible
  at the cursor**: rollable on the item's base+ilvl (`rollableTypes`, base read from the text)
  AND not proven-absent by the checker's state at that point (`excludedAt` parses the
  craft, retrying with the open string closed). Both filters degrade gracefully to "all
  mods" when the base can't be read / nothing parses.
- `semantic.ts`: `getSemanticTokens`, lexer-driven; legend
  `["keyword","property","function"]`; returns empty on unlexable input.
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

`AItem` carries the item's identity, which no operation changes (`game`, `base`, `ilvl`)
or changes exactly (`rarity`), the shared `bdd` manager, and the sub-domains below. It is
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
  scour clears it to 0, while a reforge or scour that keeps a protected side
  (`keepProtectedReroll`, `scourKeeping`) keeps `[0, max − stripped carriers]`, since a
  crafted mod on the kept side may survive; an unforced `annul` drops its lower bound (the
  crafted mod may have been removed).
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
  `model/capacity.ts`, the one formula the concrete `wf`/`pool` and the checker share).
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
  implicit stats (`local_maximum_{prefixes,suffixes}_allowed_+`); see `transfer.ts` for how
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
- **Trace** (`TraceEntry[]`): `{ span, kind, before, after? }` per statement (and the
  item block), recorded only on the real (non-quiet) pass. `traceAt(trace, offset)`
  returns the innermost entry covering an offset; this powers hover.
- `elaborateItem`: declared mods must **pin a tier** (`[ "maximum life" t1 ]`) via an
  exact id/alias or a description + `t<n>`; a bare description is an error. Placeholders
  (`"random"`/`"?"`) stay anonymous. Pinned tiers seed the `tiers` overlay, so the
  starting item is fully concrete.

### `transfer.ts`: abstract currency ops

Ten orbs, each `AItem → TransferResult` (`{ok, state}` or `{ok:false, failure}`):
transmute, augment, alteration, regal, alchemy, chaos, exalt, annul, scour, fracture (the
wiki's [Crafting](https://www.poewiki.net/wiki/Crafting) page groups them the same way:
rarity upgrades, reforges, augment/remove). All but `fracture` (a lock; see Fractures
below) reduce to two primitives: an ADDITIVE add
(`addOne`, for transmute/augment/regal/exalt) and a REFORGE (`reroll`, for
alchemy, and for alteration/chaos with nothing kept: fresh count range, nothing
guaranteed, pool becomes `possible`);
plus `removeOne` (annul) and `scour` (strip to Normal, or keep a protected side — see
metamods). Notes:

- `annul` works on **Magic OR Rare**: the precondition is "has a removable mod", not a
  rarity gate ([Orb of Annulment § Mechanics](https://www.poewiki.net/wiki/Orb_of_Annulment#Mechanics):
  it never downgrades rarity). `scour` requires a Magic or Rare item: rarity, not mod
  count, is the gate, so a Magic base with zero affixes still drops to Normal and only a
  Normal item fails as wasted currency.
- A reforge's count range is the Chaos Orb's 4–6 affixes
  ([Chaos Orb § Mechanics](https://www.poewiki.net/wiki/Chaos_Orb#Mechanics)); the 8:3:1 odds
  are not modelled, only the range.
- Removal draws from an **allowed-gens** set = `(omen forcedGen ?? both) − protectedGens`;
  `removeOne`/`hasRemovable`/`annul`/`harvestAugment` all share it. A guarantee whose
  generation is not in that set survives (protected, or the omen-spared side); an empty set
  means nothing is removable.
- The add-pool is over-approximated by running the real `pool` on a synthetic item
  carrying only the guaranteed mods at rare caps, with the tags a possibly present mod
  would add passed as "maybe" tags: a positive spawn entry on one admits the row, a zero
  entry on one is skipped (`addsTagsOfType`).
- `withGuaranteed(state, mod)` forces a specific mod present (presence + tier pin +
  possible + count floors). `essence()` = reforge to Rare `[4,6]` + `withGuaranteed`, the
  rules of [Essence § Crafting](https://www.poewiki.net/wiki/Essence#Crafting) (tiers 1–4
  are an alchemy with one guaranteed affix, tier 5+ also reforge a Rare; the fill is capped
  by the tier's maximum random mod level): precondition Normal always, Rare only at ladder
  tier ≥ 5, never Magic, class must be in `grants`; fill capped at
  `min(ilvl, maxRandomModLevel)`. `bench()` = additive add + `withGuaranteed`
  ([Crafting Bench](https://www.poewiki.net/wiki/Crafting_Bench); preconditions: open slot in
  the mod's generation; **the crafted-mod limit** `craftedCapOfState(a, registry)` (one, or
  three under an active multimod), where `AItem.crafted` is the count of bench-crafted mods
  present, a range that `bench` requires provably below the cap (what each op does to it is
  under `crafted` in §4); and
  **group exclusivity** — the [mod group](https://www.poewiki.net/wiki/Modifier#Group/family)
  rule — where the mod's family must not be possibly-present, via `familiesOfType`). Not
  modelled: a conflict hidden behind an anonymous "random" affix.
- **Metamods** ([Metamod](https://www.poewiki.net/wiki/Metamod), the
  [metacrafting bench options](https://www.poewiki.net/wiki/Crafting_Bench#Metacrafting_modifiers))
  are effect-carriers: an effect is active iff its carrier type is GUARANTEED present, the
  abstract analogue of the concrete derived `effects(it)`. `activeEffects(a, registry)` folds
  `registry.effectsOfType` over the guaranteed types;
  `protectedGens`/`craftedCapOfState`/`metamodBlocksSourced` are views of it. Placement is
  just `bench "prefixes cannot be changed"`. Which currency respects which metamod is the
  table in [Metamod § Rules and Exceptions](https://www.poewiki.net/wiki/Metamod#Rules_and_Exceptions);
  the wiring follows it: **protect** shrinks the allowed-gens removal set (annul/harvest
  augment respect it); **scour** keeps the protected side and stays Rare (`scourKeeping`);
  **cannot-roll** is a `poolRestrict` that folds through `pool` for free (the synthetic item
  carries the guaranteed carrier); **multimod** raises the crafted cap; **essence** is
  blocked (`metamodBlocks`) by any protect or cannot-roll metamod ("usage prevented" in the
  table); **alteration**, **chaos** and **harvest reforge** keep the protected side and reroll the rest
  (`keepProtectedReroll` — protected guarantees + tier pins + a count floor survive, open
  protected slots may fill from the fresh pool, which is the table's "respected, but open
  prefixes may be filled"; the metamod on the rerolled side goes). A cannot-roll metamod
  also shields its tagged guaranteed mods from `annul` alone (`cannotRollShield`; the veiled
  exalt and harvest augment removals ignore it); under one, only a
  guaranteed unshielded mod proves a removal, since an anonymous mod may be tagged. Not
  modelled from that table: the Fracturing Orb ignoring metamods. The curated id→effect
  table is `model/metamods.ts`.
- **Fractures** ([Fractured item § Mechanics](https://www.poewiki.net/wiki/Fractured_item#Mechanics))
  are a per-mod lock, tracked as `frac@type` atoms in the presence BDD (the tier-atom
  pattern; a `FRAC_EXISTS` sentinel marks "some mod is fractured" so a fracture on an
  anonymous mod still counts). A declared `fractured "…"` affix asserts a definite fracture;
  the **Fracturing Orb** (`fracture`; its preconditions are
  [Fracturing Orb § Mechanics](https://www.poewiki.net/wiki/Fracturing_Orb#Mechanics): Rare,
  ≥4 mods, not already fractured) asserts "exactly one of the current mods is fractured" —
  pinnable by a `fractured X` branch (`refine`). Hinekora therefore models at most one
  fracture per item; the wiki's multi-fracture routes (Synthesis, Necropolis, beastcrafting)
  are not modelled. Removal, `alteration`, `chaos`, `scour`, essence and harvest reforge keep the fracture by
  preserving `fractureProjection(a)` (the presence BDD reduced to the fracture atoms + their
  coupled presence) and rerolling the rest, so a proven fracture keeps its type and an
  unproven one keeps the survivor disjunction. **Scour** drops to the minimum rarity that
  holds the survivors (`minRarityFor`): a fractured Rare scours to a 1-mod Magic, as the wiki
  states.
- **Veiled** (`veiledChaos` / `veiledExalt` / `unveil`, the
  [Veiled Chaos Orb](https://www.poewiki.net/wiki/Veiled_Chaos_Orb),
  [Veiled Exalted Orb](https://www.poewiki.net/wiki/Veiled_Exalted_Orb) and the
  three-option unveil of [Veiled modifier § How to obtain](https://www.poewiki.net/wiki/Veiled_modifier#How_to_obtain)):
  the orbs add a veiled placeholder (the `VeiledPrefix ∨ VeiledSuffix` disjunction,
  generation fixed-random so unknown) on the reforge / add-remove seams; both refuse an
  item that may already carry a placeholder or an unveiled result mod (`mayHaveVeiled`). `unveil` reads
  `veiledPool` (`pool/veiled.ts` — the unveiled result mods valid on the base, minus families
  already present, which is "blocking") and either asserts the pool disjunction (narrow with
  `if has`) or, with a target, guarantees it once the pool is ≤ 3. The veiled `domain` keeps
  result mods out of the normal `pool`. Model helpers in `model/veiled.ts`.
- **Harvest** ([Harvest crafting](https://www.poewiki.net/wiki/Harvest_crafting); the tags
  are its [modifier groups](https://www.poewiki.net/wiki/Harvest_crafting#Modifier_groups)):
  `harvestReforge(a, tag)` = `reroll` plus a DISJUNCTIVE guarantee — "at least one mod
  carrying `tag`" — ANDed into the presence BDD as one OR clause over the tagged types (never
  an enumerated union; a wide clause is sound, just skipped by `disjunctiveGuarantees`'
  variable guard). `harvestAugment(a, tag)` (the wiki's "Augment" crafts; Craft of Exile's
  "Add/Remove") removes a random other mod then adds a tagged one: net count unchanged, and
  the random removal reuses `removeOne` (unforced) over the allowed-gens set — which matches
  [Harvest crafting § Mechanics](https://www.poewiki.net/wiki/Harvest_crafting#Mechanics):
  the removal obeys prefix/suffix locks but ignores cannot-roll metamods. A tag is matched
  against `Mod.implicitTags`; an empty tagged pool fails (`harvestEmptyPool`).
  Preconditions: Rare; augment also needs a removable mod.

### `diagnostics.ts`: messages

`renderState(a)` is the one-line state summary used in both errors and hover, leading
with the **total affix count** then the prefix/suffix split (the total restores the
correlation the coupled ranges track). `preconditionMessage` = state first, then what
the op needed (surface doc §6). `describePred`, `resolveMessage` for the rest.

---

## 5. Key files index

| Path                                                                  | What                                                                                          |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `packages/core/src/check/astate.ts`                                   | `AItem` (the reduced product), `normalize`, `refine`, `join`, `TierDomain`, presence views    |
| `packages/core/src/check/domain.ts`                                   | `Domain<T>` contract, `RangeDomain`, `SetDomain`, range algebra                               |
| `packages/core/src/model/capacity.ts`                                 | the affix caps (`sideCap`, `hardTotalCap`, `maxTotal`, `caps`), shared by `wf`/`pool`/checker |
| `packages/core/src/check/counts.ts`                                   | `CountDomain` (suffix, the total/prefix coupling, count refine, `learnPresent`)               |
| `packages/core/src/check/bdd.ts`                                      | the hash-consed ROBDD behind `presence`                                                       |
| `packages/core/src/check/check.ts`                                    | driver, `Flow`, loops/branches, defs, `TraceEntry`, `traceAt`                                 |
| `packages/core/src/check/transfer.ts`                                 | the abstract currency ops (`addOne` / `reroll` / `withGuaranteed` primitives)                 |
| `packages/core/src/check/diagnostics.ts`                              | `renderState`, message builders                                                               |
| `packages/core/src/model/metamods.ts`                                 | the curated metamod id → effect table, attached to the catalog at registry build              |
| `packages/core/src/model/veiled.ts`                                   | veiled placeholder types and the unveiled-result predicate                                    |
| `packages/core/src/pool/veiled.ts`                                    | `veiledPool`: which unveiled mods an `unveil` can reveal on an item                           |
| `packages/core/src/resolve/registry.ts`                               | `Registry`, `buildRegistry`, resolution, completion lists                                     |
| `packages/core/src/resolve/fuzzy.ts` / `tiers.ts`                     | fuzzy mod matching / rollable tiers (+ the memoized empty pool)                               |
| `packages/core/src/pool/pool.ts`                                      | eligibility + weights                                                                         |
| `packages/parser/src/{lexer,parser,token}.ts`                         | lexer / parser / token types                                                                  |
| `packages/parser/src/vocabulary.ts`                                   | the surface vocabulary (keywords, predicate words, item fields, verbs)                        |
| `packages/data/src/{load,adapter}.ts` + `scripts/ingest-poe1.mjs`     | data load + ingest                                                                            |
| `packages/lsp/src/{hover,completion,semantic,service,server,node}.ts` | LSP features                                                                                  |
| `packages/core/src/check/check.test.ts`                               | checker tests (currency set, count-coupling regression, loops, omens, defs)                   |
| `packages/core/src/check/check-tiers.test.ts`                         | tier-pinned predicates and the tier overlay through the checker                               |
| `packages/core/src/check/counts.test.ts`                              | `CountDomain` in isolation (caps, coupling, refine)                                           |
| `packages/core/src/check/bdd.test.ts`                                 | the ROBDD manager (canonicity, operators)                                                     |
| `packages/core/src/check/fracture.test.ts`                            | fractured items and the Fracturing Orb through the checker                                    |
| `packages/core/src/check/harvest.test.ts`                             | harvest reforge / augment through the checker                                                 |
| `packages/core/src/check/metacraft.test.ts`                           | metamods: protection, cannot-roll, multimod, essence blocking                                 |
| `packages/core/src/check/veiled.test.ts`                              | veiled orbs and `unveil` through the checker                                                  |
| `packages/lsp/src/features.test.ts`                                   | hover / completion / semantic-token tests                                                     |
| `packages/lsp/src/service.test.ts`                                    | `getDiagnostics` over the real data pipeline                                                  |

---

## 6. Gotchas

- **ESM (NodeNext)** in core/parser/data/lsp: relative imports need explicit `.js`
  extensions (`../ast/span.js`), even in `.ts` source. `SourceSpan` lives in
  `ast/span.js`, not `ast/ast.js`.
- **The vscode extension is CommonJS**: don't make it extend the ESM base tsconfig.
- Base **display names are not unique**; resolution treats a name collision as
  `ambiguous`, and ids are metadata paths.
- The concrete currency library (`currency/`) is the typed model of ops over concrete
  items; the checker's `transfer.ts` is their abstract counterpart. Same op names, on
  purpose.
- **Loop widening over-approximates PRESENCE only.** Counts/`possible`/tiers converge on
  their own, so they are left exact; an earlier attempt that also interval-widened the
  counts corrupted the after-state total. Widen presence, leave the rest.

---

## 7. Design note: relational precision (why a BDD, and why not Z3)

The design framed `wf`, dead-branch checks, and refinement as verification
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
