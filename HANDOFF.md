# Hinekora — Work Handoff / Resume Document

> Purpose: hand the project to a fresh context (a new Claude session or a human).
> Read this top-to-bottom, then skim the "Key files" index. The three design docs
> (`IMPLEMENTATION_BRIEF.md`, `crafting-lang-surface-v0.md`,
> `crafting-lang-typing-rules-v0.md`) are the ground truth for _intent_; this doc
> is the ground truth for _what exists and where_.

Last updated: 2026-07-17.

---

## 1. What Hinekora is

A **statically-checked DSL for Path of Exile crafting guides**, in TypeScript. You
write a craft (a sequence of currency operations, loops, and conditionals over an
item), and the checker proves — via abstract interpretation — that every operation's
precondition holds on every path, catching mistakes like "exalt on a full item" or
"annul on an empty item" _before_ you spend real currency. Errors render the item's
abstract state at the point of failure (surface §6 stance: state first, no lecturing).

Example (`examples/example.craft`):

```
craft in poe1

item {
    base:     "Vaal Regalia"
    ilvl:     84
    rarity:   normal
}

transmute
regal

until has "maximum life" t1 {
    if prefixCount < 3 {
        exalt
    } else {
        annul
    }
}
```

This checks clean: the `prefixCount < 3` guard means exalt never hits a full item and
annul never hits an empty one.

---

## 2. Who the user is / how to work with them

- **Experienced compiler / PL implementer**, but **new to type-system theory**. When a
  type-theory concept comes up (abstract domains, relational vs non-relational, join /
  widening, soundness), **explain it as you go** — they want to learn it, not just get
  working code.
- Prefers **clear, well-commented implementations over clever ones.** Match the existing
  comment density (it's high — comments explain _why_, tie back to the design docs' §
  numbers).
- Walk through **non-obvious design choices** rather than silently deciding.
- The user drives milestone-by-milestone and often says "go" / "yes" to advance. When
  they ask a conceptual question ("what is the logical equivalent of X"), answer the
  concept first, _then_ implement.
- Global rule (from their CLAUDE.md): **never prefix bash commands with `cd`** — the
  working directory is already correct. Their email is rick@button.dev.

### Locked decisions (firm — do not relitigate)

- TypeScript with **all strictness flags**: `strict`, `noUncheckedIndexedAccess`,
  `noImplicitOverride`, `exactOptionalPropertyTypes`, `noFallthroughCasesInSwitch`, etc.
- **pnpm workspace monorepo** under the `@hinekora` namespace.
- **Hand-written lexer + recursive-descent parser** (no parser generators).
- ESLint + Prettier: **4-space indent, double quotes.**
- **Vitest**, with extensive tests.
- Surface syntax uses **C-style braces** (not Python indentation).
- The file opens with a top-level **`craft in <game>`** declaration, before anything else.
- **PoE1 only** for now (PoE2 / omens machinery exists in the model but PoE1 is the
  target data set).

---

## 3. The load-bearing invariant: the intensional-union rule

**Outcome unions must be symbolic (intensional) descriptions, never enumerated.** A
currency op on an item can produce hundreds of concrete results; chaining `n` of them
would be `~200^n` concrete items. The whole design avoids this by keeping a **symbolic
summary** and folding each op's _effect_ into that summary. If you ever find yourself
enumerating concrete items or a list of concrete outcomes in the checker, stop — that
violates the rule and won't scale.

The checker's abstract state (`AItem`) is exactly this symbolic summary.

---

## 4. Monorepo layout

```
packages/
  core/     @hinekora/core   — pure, UI-agnostic kernel (model, pool, outcome,
                                currency, render, resolve, check). No I/O.
  parser/   @hinekora/parser — hand-written lexer + parser: source → Craft AST.
  data/     @hinekora/data   — loads projected RePoE JSON, builds a Registry.
  lsp/      @hinekora/lsp    — transport-free language service + stdio server.
  cli/      @hinekora/cli    — command-line checker.
editors/
  vscode/                    — VSCode extension (TextMate grammar + LSP client).
examples/
  example.craft              — the demo craft (open in the Extension Dev Host).
```

Build system: **tsc project references** (`tsc -b`), root solution tsconfig, each package
has its own tsconfig. Core is ESM (NodeNext). The **vscode extension is CommonJS** (its
own tsconfig, does NOT extend the ESM base).

### Commands (run from anywhere; do not `cd`)

```
pnpm -C c:/git/hinekora test           # vitest run — currently 236 passing
pnpm -C c:/git/hinekora exec tsc -b    # typecheck + build all packages
pnpm -C c:/git/hinekora lint           # eslint .
pnpm -C c:/git/hinekora format         # prettier --write .
```

The standard gate before declaring done: **tsc -b → test → lint → format**, all green.

---

## 5. Architecture deep-dive

### 5a. `@hinekora/core`

- **model/** — `Item`, `Mod` (one row per _tier_; `type` is the ModType bucket), `Base`
  (id = metadata path, since display names collide across hundreds of bases), `Weight`,
  `Effect` seam, `ModSource` (natural/essence/bench/veiled/fossil/synthesis/corrupted/
  enchant/eldritch/unique/other), and the `wf` (well-formedness) rules. ids in `model/ids.ts`.
- **pool/** — `pool(catalog, item)`: which mods can roll on an item (eligibility by
  base tags vs mod spawn tables, first-match weight lookup, zero-weight disables).
- **outcome/** — the symbolic outcome-union machinery (M2). Intensional, never enumerated.
- **currency/** — the concrete base currency library (transmute/regal/exalt/annul) that
  produces symbolic `Outcome`s. Shares op names with the checker's transfer functions.
- **render/** — plain-text renderers (`baseLabel`, item/outcome/error → text).
- **resolve/** — `Registry` (the resolved data surface). Key methods:
    - `resolveBase / resolveMod / resolveModType(name, ctx?) / resolveCurrency / resolveOmen`
    - `resolveModType` is **fuzzy and base-aware**: text → ModType, narrowed to types that
      can actually roll on the given base/ilvl (`ctx`), returning `ambiguous` with candidates
      when several match. Built on `fuzzy.ts` (`normalizeText` range-strips text into tokens;
      `buildTypeIndex`; `matchTypes`). `matchTypes` accepts a query token exactly OR as a
      **≥3-char prefix** of an entry token, so abbreviations resolve ("max life" → "maximum
      life"); the length floor stops 1–2 char fragments matching everything.
    - `genOfType(type)` → prefix/suffix.
    - `typeLabel(type)` → friendly range-stripped wording for a TypeId (for hover/diagnostics).
    - Precomputed completion lists: `currencyNames`, `currencies` (the full catalog —
      alias + kind + `displayName` + `description`), `baseNames`, `statSuggestions` (each
      carries its `type: TypeId` so completion can filter by rollability).
    - `STANDARD_CURRENCIES`: the 9-currency catalog. `name`/`kind` drive the language;
      `displayName`/`description` are curated DISPLAY metadata (RePoE ships no currency
      descriptions) used only by hover/completion. `RegistryData.currencies` can override.
    - `tiers.ts`: `rollableTiers(catalog, game, base, ilvl, type)` (pool ∩ type, sorted by
      minLevel desc so T1 = best available), `tierMod`, and `rollableTypes(catalog, game,
base, ilvl)` → the type-level pool set (drives base-aware mod completion).
- **check/** — the abstract-interpretation checker (see §6).

### 5b. `@hinekora/parser`

Lexer (`tokenize`) → `Token[]` (trivia-free; no keyword token kind — every word is an
`ident` and the parser decides by text). `parse(source)` returns `{ ok, craft }` or
`{ ok: false, error }` with a message + span. `Token`/`TokenKind` exported. Tokens carry
`span` with `start.offset` / `end.offset` (byte offsets), used by the LSP.

### 5c. `@hinekora/data`

Ingest scripts (`scripts/ingest-poe1.mjs`) project the RePoE-fork JSON dump down to just
the fields needed (+ `is_essence_only`, text/name, essences.json, crafting_bench_options.json),
minified, with a **provenance manifest** (repoe commit SHA + sha256 hashes; gameVersion
"unknown" because repoe doesn't stamp it). `adapter.ts` adapts rows into model types and
stamps `ModSource` via `classifySource` (domain + generation_type + is_essence_only).
`load.ts`: `loadDefaultPoe1()` → `LoadedData`, `registryOf(data)` → `Registry`.

### 5d. `@hinekora/lsp`

Transport-free service functions + a stdio server:

- `service.ts` — `getDiagnostics`.
- `hover.ts` — `getHover(source, offset, registry)`: **token-centric** (signature of the
  hovered token) + a `---` state footer. See §6-hover below and §7.
- `completion.ts` — `getCompletions`: backward text-scan `contextAt` picks one of four
  contexts — **statement** (currencies + control keywords), **predicate** (after
  `if`/`until`/`not` → `has`/`not`/`isNormal`/`isMagic`/`isRare`/`prefixCount`/`suffixCount`),
  **base** (inside `base: "…"` → base names), **mod** (any other string → mod names). Mod
  candidates are **filtered to what's possible at the cursor**: rollable on the item's
  base+ilvl (`rollableTypes`, base read from the text) AND not in the checker's `excluded`
  set at that point (`excludedAt` parses the craft, retrying with the open string closed).
  Both filters degrade gracefully to "all mods" when the base can't be read / nothing parses.
- `semantic.ts` — `getSemanticTokens`: lexer-driven; legend `["keyword","property","function"]`;
  returns empty on unlexable input.
- `server.ts` — `createServer(connection, registry)`: wires onInitialize capabilities +
  handlers. `completionProvider.triggerCharacters` includes `"` so the mod/base list pops
  the moment a string opens (identifier chars already auto-trigger statement/predicate lists).
- `node.ts` — stdio entry (`vscode-languageserver/node.js`, explicit `.js` for NodeNext).
- **Dependency pins that matter:** `vscode-languageserver ^9`, `-textdocument ^1.0.11`,
  `-types` pinned **exact `3.17.5`** (must match the framework's transitive version, else
  a dual-version type clash). `SemanticTokensBuilder` imports from `vscode-languageserver`,
  the `SemanticTokens` _type_ from `-types`. Package exports `"./node"` with `default` (so
  `require.resolve` from the CJS extension works).

### 5e. `editors/vscode`

TextMate grammar for highlighting + a language client that spawns the LSP node server via
`require.resolve("@hinekora/lsp/node")` + `TransportKind.ipc`. CommonJS tsconfig.

---

## 6. The checker (`packages/core/src/check/`)

The heart. Abstract interpretation over a symbolic item summary.

### `astate.ts` — the abstract state `AItem`

- `rarity` (known exactly), `base`, `ilvl`, `game`.
- **`total` and `prefix` are integer RANGES** `[min,max]`; **suffix is DERIVED**:
  `suffixRange(a) = [total.min - prefix.max, total.max - prefix.min]`.
- Mod-set knowledge: `guaranteed` / `possible` / `excluded` sets of ModTypes.
- `tiers`: an overlay `Map<TypeId, Set<ModId>>` refining which specific mod a present
  type could be (full tier tracking).
- **`normalize(a)`** enforces the coupling between `total` and `prefix` to a fixpoint (up
  to 4 iterations). BOTH directions: `prefix ∈ [total-cap, total]` AND
  `total ∈ [prefix, prefix+cap]`. This second coupling was a **bug fix last session** —
  without it, refining `prefixCount < 3` tightened prefix but not total, producing false
  positives on the exalt/annul loop. Returns `null` on an empty (contradictory) region.
  `rarityCap` = per-side slot cap (3 for rare).
- `refine`, `join`, `stateEqual` for narrowing and loop fixpoints.

### `check.ts` — the driver

- `Flow` = a statement either `{ kind: "fall", state }` or `{ kind: "restart" }`
  (diverges, re-enters the enclosing loop).
- `if/else`: narrow into each arm, check, **join** the falling states. **Dead-arm
  detection**: a branch whose predicate is impossible (or whose negation always holds) is
  flagged.
- `until` loops: **loop-invariant fixpoint** for soundness — the body must be sound from
  the invariant entry state, not just the first iteration (this is what catches
  `until has X { exalt }` filling to 6 affixes). On exit the predicate is **proven** into
  the after-state (loop-exit-as-proof). A `quiet` depth counter suppresses duplicate
  diagnostics during the invariant-finding passes.
- **Reachability**: an `until` whose exit predicate can never be satisfied on this base
  is flagged ("can never exit") before the fill-up symptom.
- **Trace** (`TraceEntry[]`) powers editor hover. Each entry: `{ span, kind, before,
after? }` — `kind` is the statement kind (or `"item"`), `before`/`after` are the
  `AItem` entering and leaving. `after` is absent when the path diverges. Recorded in
  `checkSeq` **only on the real (non-quiet) pass**, so each source statement appears once.
  `traceAt(trace, offset)` returns the innermost (smallest-span) entry covering an offset.
- `stateAt` was **renamed to `traceAt`** and now returns the whole `TraceEntry` (not just
  a state), so hover can show before → after.

### `transfer.ts` — abstract currency ops

Nine common orbs, each `AItem → TransferResult` (`{ok, state}` or `{ok:false, failure}`):
`transmute`, `augment`, `alteration`, `regal`, `alchemy`, `chaos`, `exalt`, `annul`,
`scour`. They reduce to two primitives: an ADDITIVE add (`addOne` — transmute/augment/
regal/exalt) and a REFORGE (`reroll` — alteration/alchemy/chaos: discard all mods, lay
down a fresh count range, clear `guaranteed`, set `possible` to the base pool); plus
`removeOne` (annul) and `scour` (strip to Normal). `PreconditionFailure` = wrongRarity |
noOpenSlot | nothingToRemove (scour reuses `nothingToRemove` to flag scouring a no-mod
item as wasted). `forcedGen` (from an active omen) constrains an add/remove to one
generation, tightening counts and deciding which guarantees survive. `addOne` is additive
(all prior mods survive; pool types become `possible`, `excluded` cleared, tier overlay
grows); `removeOne` drops guarantees unless a gen-forced removal protects the other side.
The
abstract add-pool is over-approximated by running the real `pool` on a synthetic item
carrying only the guaranteed mods at rare caps.

### `diagnostics.ts` — messages

`renderState(a)` is the one-line state summary used in BOTH errors and hover. It leads
with the **total affix count**, then the prefix/suffix split:
`Vaal Regalia · Magic · 1 affix · 0–1 prefixes · 0–1 suffixes · ilvl 84`. Leading with
`total` is deliberate (see §7 point 2). `preconditionMessage` = "state first, then what
the op required." `describePred`, `resolveMessage` for other diagnostics.

---

## 7. Recent work (changelog, newest first)

### Predicate defs (`def name(p) = <pred>`)

- **Local, parameterized predicate definitions**, usable in any `until`/`if`. The
  motivating win: `def anyEleRes(t) = has "fire res" t or has "cold res" t or …`,
  then `until anyEleRes(1)`. Both examples now use it.
- **Parametric AST**: params appear in VALUE slots, so `HasPred.mod`/`.tier` and
  `ComparePred.value` became `T | ParamRef`. New `Def`, `CallPred`, `Arg`, `ParamRef`
  nodes; `Craft.defs` collects defs (parser separates them from the body). New `assign`
  (`=`) token — the lexer emits `eq` for `==`, `assign` for a lone `=`.
- **Parser**: `parseDef`; a call is `ident(` in predicate position; a bare in-scope
  param in a value slot lexes as a `ParamRef` (instance state `defParams`, empty at top
  level so only def bodies can reference params).
- **Checker** (`resolveCall` + module-level `substitute`/`inferParamTypes`): a call
  checks arity + arg types, substitutes args → a concrete pred, then resolves it (so all
  existing narrowing "just works"). **Param types are inferred** from use (tier/count slot
  ⇒ int, `has` target ⇒ mod); a param used as both is a hard error and the def is marked
  `valid:false` so calls drop without cascading. Recursion is caught (`expanding` set).
  Recursion is caught (`expanding` set).
- **Parameter sorts are `tier | count | mod` — three DISTINCT sorts**, not two. A `t1`
  tier is NOT sugar for the int `1`: `Arg` has a separate `tier` kind, and a param
  inferred from a `has`-tier slot won't accept a bare-int count (or flow into a
  `prefixCount` comparison) — those are conflicts. This tightening removes well-typed
  nonsense (`prefixCount > t1` never parsed anyway; the leak was only at the def-param
  level). An **unused parameter is an error** (`used` set spans value slots + passthrough
  args, so a forwarded-only param isn't falsely flagged).
- **Param pass-through**: a param can be forwarded to a nested call (`def a(t) = b(t)`).
  `Arg` gained a `param` kind; substitution rewrites nested-call param args; type errors
  surface at the callee (the substituted arg keeps the outer call site's span).
- **LSP** (craft-local symbols — a first for the language service, which otherwise only
  knows registry symbols): `def` highlighted; local def names complete as predicates
  (after `if`/`until`/`not`/`and`/`or`, via a regex scrape so it works mid-edit); and a
  def's declaration, calls, and params all hover as one signature (`def name(p)` + the
  `describePred`-rendered body). Predicate completion now also fires after `and`/`or`.

### Bench crafts + the `withGuaranteed` primitive

- Extracted **`withGuaranteed(state, mod)`** (transfer.ts) — force a specific mod present
  (presence, tier pin, possible, gen-count floor); essence now uses it, bench is built on it.
- **`bench "<mod>" [t1]`** — add a specific bench mod. `resolveBench(name, itemClass?, tier?)`
  scores the mod text (so "maximum life" beats "minions … life") and restricts to the item's
  class; multiple bench _tiers_ of one mod pick the best (or the tier given). Transfer = an
  additive add in the mod's generation + `withGuaranteed`; preconditions = (1) an open slot
  in that gen (a Normal item, cap 0, naturally fails) and (2) **group exclusivity** — the
  mod's family must be provably absent (`sharesFamilyWithPossible` vs `possible`, via the new
  `registry.familiesOfType`), since an item holds one mod per group. NOT modelled: the
  one-crafted-mod limit, and a conflict hidden behind an anonymous "random" affix (no type).
- Editor: `bench "…"` completion (`benchNames`), hover (keyword/name/tier share one signature
  via the generalized `namedAt`), `bench` highlighted. Parser: extracted `tierShorthand`
  (now shared by `has`/`essence`/`bench`).
- Perf: cached the empty-item pool per (base, ilvl) — hover 78ms → 4ms.

### Essences (first op that grows `guaranteed`)

- `essence "<name>" [t1]` statement — full name (`"Deafening Essence of Greed"`) or type +
  tier (`essence "greed" t1`, t1 = Deafening = best). Parser + AST (`EssenceStmt`),
  `registry.resolveEssence(name, tier?)` (fuzzy; ambiguous without a tier), checker dispatch.
- `essence()` transfer (`transfer.ts`): precondition Normal-always / Rare-if-tier≥5 / never
  Magic / class must be in `grants` (new `essenceRarity`/`essenceClass` failures); effect =
  reforge to Rare `[4,6]`, inject the fixed class mod into `guaranteed` (`presence = var(type)`)
  with its tier pinned, fill from the pool capped at `min(ilvl, maxRandomModLevel)`. No
  ilvl gate (guaranteed mod forced at its tier). `registryOf` now passes `essences` through.
- `examples/essence-life-boots.craft` checks clean (guaranteed maximum life on a reforged
  Titan Greaves).
- **Essence LSP done:** completion inside `essence "…"` offers essence names (new `essence`
  context + `registry.essenceNames`); hover on the name shows its tier, reforge behaviour,
  and the specific mod it guarantees on the current base's class; `essence`/`and`/`or` are
  semantic-token keywords.

### Presence-BDD domain (relational precision) — §11 realized

- `AItem`'s `guaranteed`/`excluded` sets are gone; presence knowledge is now one
  `presence: Bdd` over type-presence variables (`check/bdd.ts`, a small hash-consed
  ROBDD), plus a `bdd: BddManager` carried on the state (one per check). `possible`
  stays a plain pool-whitelist set.
- Accessors `isGuaranteed`/`isExcluded`/`guaranteedTypes`/`excludedTypes`/`presenceFacts`
  are the views; `refine has` = BDD-AND var, `refine not-has` = AND ¬var, **`join` =
  BDD-OR**, `stateEqual` = `presence ===` (canonical). Transfer functions still reason
  in guaranteed/excluded sets and re-materialise presence via `presenceFacts`
  (disjunctions live through control flow, are flattened at operations — sound).
- **Q2 fixed:** after `until has X or has Y { … }`, a later `if not X and not Y` is now
  correctly flagged dead — the disjunction survives the loop-exit join. Regression test
  added.

### `or` / `and` predicates

- `BinaryPred` in the AST; parser precedence `or` < `and` < `not` < atom (left-assoc, parens
  override). Checker `refine` handles them by De Morgan (conjunction = sequential narrow,
  disjunction = `join`); dead-arm and loop-exit-as-proof both work — e.g. `until has "fire
resistance" t1 or has "cold resistance" t1 or has "lightning resistance" t1 { chaos }`
  checks clean, and a disjunctive exit proves nothing specific (`guaranteed` stays empty).

### Essence groundwork + `t1` tier shorthand

- **`t1` tier shorthand** replaces `tier 1` (long form dropped). A single `t<digits>` ident
  wherever a tier is taken (`has "mod" t1`; the future `essence "…" t1`). Hovering a `t1`
  token renders the same signature as its mod string, with that tier spotlit.
- **Essence data corrected** (see §9): the ingest now reads the real ladder (`e.level`), and
  `item_level_restriction` was renamed `maxRandomModLevel` (the fill-mod cap — essences have
  no item-level gate; the guaranteed mod is forced at its fixed tier). Mechanics fully locked
  via in-game testing; transfer function still to build.
- Example `examples/essence-life-boots.craft` sketches the intended essence craft (a design
  target — uses `essence`, `or`, and the `t1` shorthand).

### Editor UX — completion made context- and state-aware

- **Predicate completions.** After `if` / `until` / `not` (a non-string boundary whose
  preceding word introduces a predicate), completion offers `has`, `not`, `isNormal`,
  `isMagic`, `isRare`, `prefixCount`, `suffixCount` — no longer the (invalid) statement list.
- **Mod completions are filtered to "possible here"** (two layers, both best-effort):
    1. **base+ilvl rollable** via `rollableTypes` (base read from the source text, robust to a
       broken tail) — a jewel/weapon mod never shows on a ring (Iron Ring ~29 vs 2837 total).
    2. **not `excluded`** by the abstract state at the cursor — a mod proven absent by an
       earlier `not has …` disappears. `excludedAt` parses the craft, retrying with the open
       string closed so the surrounding statement parses.
- **Trigger character `"`** so the mod/base list pops the moment a string opens (was
  Ctrl+Space only). Completion content already returned full mod strings — the trigger was
  the missing piece.

### Rich mod hover + fuzzy abbreviations

- Hovering a (fuzzy) mod string now shows: the resolved **canonical wording + `TypeId`**,
  generation, source, and a **markdown table of every rollable tier** (T-number, `ModId`,
  affix name, fully-resolved roll range, ilvl). Note the tier id rarely matches the
  T-number (`IncreasedLife11` is tier 1 — ids count up with level, T-numbers down from best).
- A `has "…" tier N` predicate **spotlights that specific tier** above the table and bolds
  its row (`tierAfter` scans the tokens for the trailing `tier <int>`).
- `matchTypes` gained **prefix/abbreviation matching** ("max life" → "maximum life").

### Currency set expanded 4 → 9

- Added `augment`, `alteration`, `alchemy`, `chaos`, `scour` (semantics in `transfer.ts` +
  catalog entries). Two primitives cover them: additive `addOne` and the new `reroll`
  (reforge). `scour` reuses `nothingToRemove` to flag scouring a no-mod item as wasted.
  Left out: Divine/Blessed (value/implicit rerolls — no-ops here), Vaal/Chance (random
  outcomes we don't model).
- **`annul` fix:** it works on **Magic OR Rare** (anything with a removable mod), not
  Rare-only — the rarity gate was dropped; `hasRemovable` is the real precondition.
- **Currency catalog** (`CurrencySpec` gained `displayName`/`description`): curated in-game
  names + descriptions for hover/completion, linked to hand-written semantics only by
  `kind`. RePoE ships no currency descriptions, so these are authored in `STANDARD_CURRENCIES`.

### Hover redesign (foundational) + the "ranges lie" fix

- **Token-centric hover** (`hover.ts`): the hovered token's signature is the headline
  (currency op / mod / base / projection / keyword), with the item-state as a `---` footer
  (`before:` / `after:`, labelled `after the loop` for `until`; `guaranteed (on every exit)`).
- **`renderState` leads with the total affix count** — the domain is weakly relational
  (tracks `total`+`prefix`), but rendering the two side-ranges alone lost the `p+s=total`
  correlation (after transmute both showed 0–1, implying the impossible (0,0)/(1,1)). Showing
  `total` restores it. A _fully_ relational render would enumerate (forbidden).
- `registry.typeLabel(type)` maps a TypeId back to friendly wording for `guaranteed:` etc.

**Status: all 191 tests pass; tsc / lint / format green; LSP dist rebuilt.**

To preview hover/completion without VSCode: a throwaway `.mjs` placed **inside
`packages/lsp/`** (so Node resolves the workspace `@hinekora/*` symlinks), importing
`getHover`/`getCompletions` from `./dist/…` and `loadDefaultPoe1`/`registryOf` from
`@hinekora/data`, run then deleted. Node can't resolve the packages from the scratchpad.

---

## 8. Key files index

| Path                                                                  | What                                                                                           |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `packages/core/src/check/astate.ts`                                   | `AItem`, `normalize` (the total/prefix coupling), `refine`, `join`, `suffixRange`, `rarityCap` |
| `packages/core/src/check/check.ts`                                    | driver, `Flow`, loops/branches, `TraceEntry`, `traceAt`                                        |
| `packages/core/src/check/transfer.ts`                                 | the 9 abstract currency ops (`addOne` / `reroll` primitives)                                   |
| `packages/core/src/check/diagnostics.ts`                              | `renderState`, message builders                                                                |
| `packages/core/src/resolve/registry.ts`                               | `Registry`, `buildRegistry`, `typeLabel`, resolution                                           |
| `packages/core/src/resolve/fuzzy.ts` / `tiers.ts`                     | fuzzy mod matching / rollable tiers                                                            |
| `packages/core/src/pool/pool.ts`                                      | eligibility + weights                                                                          |
| `packages/parser/src/{lexer,parser,token}.ts`                         | lexer / parser / token types                                                                   |
| `packages/data/src/{load,adapter}.ts` + `scripts/ingest-poe1.mjs`     | data load + ingest                                                                             |
| `packages/lsp/src/{hover,completion,semantic,service,server,node}.ts` | LSP features                                                                                   |
| `packages/core/src/check/check.test.ts`                               | checker tests (currency set, count-coupling regression, loops, omens)                          |
| `packages/lsp/src/features.test.ts`                                   | hover / completion (predicate + base-filter) / semantic-token tests                            |
| `examples/example.craft`                                              | the demo craft                                                                                 |

---

## 9. Pending / possible next work (none committed yet)

### Designed & queued (essence + language features)

- **`or` / `and` in predicates — DONE.** `BinaryPred {kind:"and"|"or", left, right}`; parser
  precedence `or` < `and` < `not` < atom, all left-assoc. Checker `refine` handles them by De
  Morgan: conjunction = sequential narrow, disjunction = `join` (LUB over-approximates "one
  holds"); negation swaps. Loop-exit proves the disjunction (a weaker fact — `guaranteed`
  stays empty when the exit is `X or Y`, which is correct). Completion doesn't yet offer
  `or`/`and` mid-predicate (minor gap).
- **Local predicate functions (after essences).** `def name(args) = <predicate>` — named, parameterized,
  PURE predicates (no item side-effects), file-level scope. Args substitute into the body;
  no new checker machinery beyond substitution. **Param types are INFERRED from usage** (a
  param in `t1`/count position ⇒ int; in `has p` ⇒ mod-name), each use a constraint, unify;
  conflicting uses → error. Decided v1 = predicate-only. Example target: `def anyEleRes(t) =
has "fire resistance" t… or …`.
- **THEN: generic functions that can contain operations** (not just predicates) — reusable
  op sequences / procedures. Bigger design (they mutate the item, compose like inlined
  blocks). Explicitly wanted as the follow-up to predicate functions.
- **Essences transfer function** — mechanics fully locked (confirmed by in-game testing):
    - Precondition: **Normal** always; **Rare** only if `tier ≥ 5`; **never Magic**; the
      item's class must be in `grants`. **No item-level gate.**
    - Effect: reforge (replace all) → inject the fixed `grants[itemClass]` mod (essence-only,
      forced at its exact tier/generation regardless of ilvl) into `guaranteed` + tier
      overlay; fill to `[4, 2·cap]` from the normal pool capped at `min(item.ilvl,
maxRandomModLevel)`. First op that GROWS `guaranteed`.
    - Data ready: `EssenceSpec` = `{id, name, tier (1=Whispering…7=Deafening, 8=corrupted),
maxRandomModLevel?, grants: class→modId}`. Needs `resolveEssence` + a transfer fn +
      `essence "<type>" t1` syntax (t1 = Deafening, best; type+tier resolves the specific
      essence) + checker dispatch + tests + completion/hover.
    - Reforge count `[4,6]` confirmed for standard bases (poewiki 8:3:1); jewels/altered-cap
      bases differ — see per-base-cap item below.
- **`t1` tier shorthand is DONE** (parser + hover + completion); the `tier 1` long form was
  dropped — only `t1` is accepted. Hovering a `t1` token renders its mod string's signature.

### Housekeeping / smaller items

- **Re-evaluate comment verbosity** across the codebase — comments are currently very dense
  (explain-the-why, cite design-doc §s). Decide the right level and normalize; some are more
  than they need to be.
- **Per-base affix caps** — `rarityCap` is a flat 3/side (6 total) for every Rare. Jewels
  cap at 4 total and some special bases differ. Pre-existing soundness gap: a jewel modeled
  as 6-max lets the checker miss a "no open slot" error. Affects exalt/annul/reforge alike.
- **Item-block tier declarations**; restrict **base** completion to craftable classes (mod
  completion is already base+state filtered; base completion still lists all base names).
- **`with omen "…"` completion** deliberately deferred — omens aren't really implemented
  yet, so that position just falls through to the statement list (harmless).
- **Completion perf:** `getCompletions` recomputes the base pool + a full check per request.
  Fine for tiny crafts; memoize the base pool per `(base, ilvl)` if latency ever shows.
- **Monaco playground** (`editors/playground`) reusing the transport-free LSP service —
  the user has flagged interest in a browser playground.
- **PoE2 module** — the omen machinery is modelled; PoE2 data ingest is not the current
  target.
- Hover polish: spell out the coupled-range corners in words if desired; the domain
  already supports it.

---

## 10. Conventions & gotchas

- **ESM (NodeNext)** in core/parser/data/lsp: relative imports need explicit `.js`
  extensions (`../ast/span.js`), even in `.ts` source. `SourceSpan` lives in
  `ast/span.js`, not `ast/ast.js`.
- **The vscode extension is CommonJS** — don't make it extend the ESM base tsconfig.
- Prettier: **4-space indent, double quotes.** Match it; the linter/formatter run in the
  gate.
- The concrete currency library (`currency/`) and the checker's `transfer.ts` **share op
  names** (`exalt` etc.); `check/index.ts` only re-exports the transfer _types_ to avoid an
  ambiguous barrel re-export.
- Base **display names are not unique**; resolution treats a name collision as `ambiguous`
  and ids are metadata paths.
- Soundness principle: tightening the abstract domain (like the normalize coupling) only
  ever **removes false positives** — it can't introduce false negatives — so existing
  green tests staying green is evidence the tightening is sound.

---

## 11. Design note — relational precision (VC / SMT / BDD)

A **VC (verification condition)** is a proof obligation: a formula whose validity
(or, for inhabitation, satisfiability) certifies a property. The design docs
(`IMPLEMENTATION_BRIEF` §7, typing-rules §2.1/§4.7) frame `wf`, dead-arm
inhabitation, and refinement as VCs in an **SMT-decidable fragment** — _linear
arithmetic over counts + set membership_ — with the guidance: **"start hand-rolled;
reach for Z3 only if something genuinely needs it."**

`AItem` **is** that hand-rolled decision procedure — but **non-relational**: each
type is tracked independently (`guaranteed`/`possible`/`excluded`) plus the coupled
counts. So it cannot represent a **disjunctive fact across types**. Concretely,
after `until has "fire res" t1 or has "cold res" t1 or has "lightning res" t1 { … }`
the loop exit `join`s three states, and `join`'s `guaranteed` = the intersection =
∅ — so "≥1 of the three is present" is lost. A later
`if not has fire and not has cold and not has lightning` is then **not** flagged
dead even though it's unreachable. This is a **precision** loss, not unsoundness —
we never accept a failing op, we just miss a helpful warning.

Options weighed:

- **Special-case "≥1 present" groups** — rejected: throwaway once we go general.
- **Powerset / DNF of states** — = enumeration, violates the intensional-union rule.
- **BDD over type-presence — DONE (§7).** Represent presence knowledge as one boolean
  function (a reduced, ordered Binary Decision Diagram over presence variables).
  `guaranteed`/`possible`/`excluded` become _views_ of it; `refine` = BDD-AND;
  **`join` = BDD-OR** (keeps disjunctions compact & symbolic — NOT enumeration);
  dead-arm = the BDD is `false`. Dependency-free, deterministic, pure TS; keeps the
  abstract-interpretation fixpoint. Bounded by the number of types touched (a
  handful) so tiny in practice; worst-case exponential but irrelevant for real
  crafts; finite domain ⇒ fixpoints still terminate. Also handles the future
  need where a disjunction interacts with `guaranteed` unit facts.
- **Z3 / SMT (via wasm)** — strictly more general: handles presence AND count
  disjunctions AND their interaction (the whole VC fragment). But heavy async
  dependency (breaks `core`'s purity), less deterministic, worse diagnostics
  (UNSAT-core vs our state-rendered errors), and it does **not** remove the loop-
  **invariant** fixpoint (SMT decides fixed formulas; invariant synthesis needs the
  AI fixpoint, or Z3's heavier Horn/Spacer engine). By the brief's own bar the
  current gap doesn't "genuinely need" Z3 (it's sound). **Reserved** for a genuine
  presence-×-count disjunction need or a wholesale VC offload. A hybrid (hand-rolled
  fast path + Z3 oracle only for hard disjunctive queries) is possible but adds
  moving parts.

**Roadmap:** BDD-presence domain → essences transfer function → predicate `def`s.
