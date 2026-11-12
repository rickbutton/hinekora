# hinekora: Implementation Architecture

> The **shape** of the implementation: the layers, how they compose, and the theory
> behind the checker. The other docs are listed in [../CLAUDE.md](../CLAUDE.md); where
> this doc names a symbol, it is to locate a concept, and the detail is the code.

---

## 1. The pipeline, as a stack

Source text flows down; each layer's output is the next layer's input. Analysis is a pure
function of `(source, registry)`; no I/O anywhere in it.

```
   source text  (a .craft file)
        │   @hinekora/parser
        ▼
   tokens ─▶ Craft AST                     Layer 1 · surface syntax
        │   @hinekora/core: resolve/  ◀── fed by @hinekora/data
        ▼
   Registry: names ⇒ game entities         Layer 2 · data & resolution
        │   @hinekora/core: check/
        ▼
   the exact checker                       Layer 3 · the checker  ◀── the heart
        │   ⇒ diagnostics  +  a per-statement trace
        │        └─▶ @hinekora/core: cost/   the cost layer reads the trace (§7)
        ▼
   language service                        Layer 4 · LSP (diagnostics, hover, completion, names, hints, folding, formatting)
        │
        ▼
   editors / CLI                           Layer 5 · thin clients
```

The **dependency arrow points one way**: `cli` / `lsp` / `editors` depend on `core`; `data`
feeds `core` plain structures; `core` depends on nothing UI. That is why the AST lives in
`core` (not the parser), why the checker cannot reach the parser, and why the whole
analysis is testable with no editor and no disk.

---

## 2. Layer 1: surface syntax (text → AST)

A hand-written lexer turns text into trivia-free tokens carrying source spans; a
recursive-descent parser turns tokens into a `Craft` AST. Three decisions shape everything
downstream:

- **No keyword token kind.** Every word lexes as an `ident`; the parser decides meaning by
  position. This keeps the lexer trivial and the vocabulary in one place.
- **One operation statement.** The parser knows control flow, defs and calls; every
  crafting method is the same `OperationStmt` (its words and arguments), shaped by the
  checker's method table (`check/methods.ts`), which says which words open a method and
  what argument slots follow. Adding a method is a table entry; the parser, completion
  and hover pick it up unchanged.
- **The AST is deliberately shallow.** It mirrors the surface syntax and does _no_
  resolution or lowering; names stay raw strings. So the parser is a pure syntax→tree
  transform, and the AST is the stable contract between front end and checker. The same
  package carries the inverse, the formatter (`formatCraft`), which prints a tree back
  in the house style; the only thing the tree lacks for that, the comments, the lexer
  keeps alongside the tokens.

Spans thread through every node: they are what later render a diagnostic under the right
op and let hover find the statement at the cursor.

---

## 3. Layer 2: data & resolution (names → entities)

The surface speaks the game's language: `"maximum life"`, `"Vaal Regalia"`, `"greed"`.
The checker needs resolved entities: a `ModType`, a `Base`, an `EssenceSpec`. The
**`Registry`** is that resolved surface, built once from RePoE JSON that an offline ingest
step has projected down to just the fields needed.

What resolution provides to the checker:

- **fuzzy, base-aware name → ModType**: a query token matches exactly or as a ≥3-char
  prefix, narrowed to the types that can actually roll on this base/ilvl.
- **the pool**: which mods can roll on a given item, by the wiki's
  [spawn weight tag](https://www.poewiki.net/wiki/Modifier#Spawn_weight_tag) and
  [mod level](https://www.poewiki.net/wiki/Modifier#Mod_Level) rules, with the generation
  table the data pairs with each spawn table. This is what a currency add draws from.
- **tiers**: the tier ladders per base (T1 = the best row of a type that rolls on it, at
  any item level, the number the game's tooltip shows), derived by sorting those rows by
  mod level, the base's own and each influence's apart; the item level only decides which
  of them a currency can roll.
- **caps**: the per-base affix limits (the [rarity](https://www.poewiki.net/wiki/Rarity#Rarities)
  limits shifted by an experimented base's stats, e.g.
  [Simplex Amulet](https://www.poewiki.net/wiki/Simplex_Amulet#Mechanics)), consumed by the
  checker's count domain.

This layer is pure data → structures. It never analyses; it answers questions.

---

## 4. Layer 3: the checker

The checker runs a craft over the exact set of items each point of it can hold, one
decision diagram per state; its design is [EXACT.md](EXACT.md).

---

## 5. Layer 4: language services

The LSP is not a second analysis; it is the _same_ checker, surfaced. Two of the checker's
outputs feed it:

- **diagnostics**: the precondition failures, rendered in the game's language: the item's
  current state first, then what the op required. No type-system vocabulary ever reaches the
  user, because the domain's components are already game concepts (rarity, counts, mods,
  tiers).
- **the trace**: the summary before/after every statement, recorded on the real pass.
  `traceAt(offset)` finds the innermost statement at the cursor; that powers **hover**
  ("what is my item here"). **Completion** goes a step further and runs the checker to learn
  what is _provably impossible_ at the cursor, filtering the offered mods to those that can
  actually roll and are not already excluded.

One analysis per document text, shared by every feature: the parse and the check are
memoized by the text, so a keystroke costs one run of the checker however many requests
the editor sends for it.

The name features (highlight the other uses, go to definition, references, rename, the
outline) need no checker at all: the parser already decides what each identifier is, a
parameter of the enclosing def or a method word, and `bindingsOf` reads that off the
syntax tree. The same table tells hover which def an identifier belongs to, so hover and
highlight cannot disagree.

---

## 6. Layer 5: clients

Thin, by design. The CLI runs the checker and prints diagnostics, or formats a guide. The VSCode extension is a
language client: a TextMate grammar for coloring plus an LSP client that spawns the stdio
server. The browser playground binds the same transport-free service functions to Monaco's
providers directly, with the catalog fetched as JSON; it is the proof that the service
needs no server. Its storyboard is the trace read the other way round: not "what is my
item here" for one cursor position but the item after every statement, laid out top to
bottom as the guide a player follows at the bench, the step with its currency between
two items. None of the three holds any analysis logic; all of it is in `core`,
reachable only through the one-way dependency arrow of §1.

---

## 7. The cost layer (beside the checker, not in it)

The checker proves; the cost layer estimates how many tries a loop takes and what a craft
is expected to spend. It lives in `packages/core/src/cost/`, reads the checker's trace and
the same op sequences, and can never make the checker accept or refuse a step. Its design
is [cost.md](cost.md).
