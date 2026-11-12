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
   the exact set of items at each step     Layer 3 · the checker  ◀── the heart
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

Spans thread through every node, placing a diagnostic under its step and letting hover
find the statement at the cursor.

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
  checker's well-formedness.

---

## 4. Layer 3: the checker

### 4.1 The idea

A craft is a program over an item, with loops and branches, and every operation's
precondition must hold on every item the craft can have there. Simulating each run is hopeless (the
[core invariant](../CLAUDE.md)): a currency has hundreds of outcomes, and a chain of them
multiplies. So the checker runs the craft once over a _set_ of items: the state at a point
of the craft is exactly the set of items the game can produce there, and each operation
maps it to exactly the set of items it can leave, taken over every item of the state
before it. A `require` fails if and only if some item breaks it; a branch is dead if and
only if no item meets its condition.

In type-theory terms this is abstract interpretation (running a program over descriptions
of sets of values) where the description loses nothing: the _image_ of a set under an
operation is computed exactly, not a coarser set containing it. A coarser one would be
_sound_ (no real failure missed) but would flag crafts no item breaks. Exactness is
relative to the model of the game ([operations.md](operations.md),
[item-model.md](item-model.md)); past a node budget or a round limit the checker stops
with that error rather than approximate.

### 4.2 The state: one decision diagram over slots

An item is an assignment to a fixed list of **slots**, built once per check (the
_universe_) from the registry, the base, the item level and the craft: one per modifier
type, one per mark ([REFERENCE §4](REFERENCE.md)). The universe holds only what the
craft's steps can lay (`craftReach`), so a ring craft does not carry every essence of the
game.

A set of assignments is a **decision diagram** (`check/dd.ts`): a graph that tests one slot
per level, one branch per value, ending in "in" or "out". It is reduced (a test whose
branches all agree is skipped) and hash-consed (equal sub-graphs are one node), so a set
has exactly one diagram and equal sets are the same object: comparing two states is
comparing two pointers, and every view is cached by the diagram. The engine knows nothing
of the game.

Counts are not stored: a prefix count is the number of slots holding a prefix row, and a
count condition or a cap is a small automaton run over the slots. **Well-formedness** is
one diagram, the items the game allows (one modifier per family, the caps of the rarity
and the base, the rules of the marks); every state lies inside it, and an operation that
could leave it is intersected with it.

### 4.3 Operations as exact images

A method is a sequence of primitives (`Op`, `check/ops/types.ts`; their meaning is
[operations.md](operations.md) §2), built from the method table (`check/methods.ts`,
`check/library.ts`). Each primitive's handler (`check/ops/`) composes a few building
blocks: narrow (intersect with a condition), set a slot, _one of_ (exactly one slot of a
set changes: an added modifier, a removal), _each of_ (every slot of a set changes
independently: a strip, a reroll), and _by case_: where what an operation does depends on
the item (its influence, a metamod's protection or cannot-roll rule, the dominant
implicit), the state is split by the slots that decide it, each case transformed under
its own rule, and the cases united. A fill of several modifiers is one draw repeated, so
the order of the draw is the game's.

The frame (`check/method.ts`) holds a method all or nothing: a `require` is judged on the
items the method has reached and refuses it on those that break it, and an operation that
cannot act on an item (a fill with nothing that fits, a removal with nothing in reach)
refuses it there likewise. Three runs are one image, since each needs what the step
before discards: a reforge with the modifiers it guarantees, an addition with the removal
that must spare it, and a Harvest change, whose new modifier keeps the old one's tier and
crafted mark.

### 4.4 Conditions and the driver

A resolved condition (`RPred`) is a diagram: presence and tier restrict a slot, a value
comparison takes the cells past its threshold, a count is an automaton, and `and`, `or`,
`not` are intersection, union and difference. A name is read per influence set, so an
influence's rows resolve on the items that carry it.

The driver (`check/check.ts`) threads one state. An `if` narrows it both ways and unites
the arms that fall through. A loop's head is a **least fixpoint**: the smallest set that
holds the entry and everything one run of the body brings back from the head's items that
fail the condition. It is found by adding each round's new items until a round adds none;
the sets only grow and are finite, so this ends, and no _widening_ (jumping to a coarser
set to end sooner) is needed. The exit is the head narrowed by the condition. A call is
its body inlined, traced as one step (`TraceEntry.inlined`).

**Recovery.** After a refused step the craft goes on, on the reporting pass only, from the
items the method works on; where none, from the failing items repaired as the craft meant
them where the check knows how (a wrong rarity set right), else unchanged. That state is
not a game fact; a run that takes no recovery (`strict`) tells what is found only on
it. A dead branch, a loop that never runs or exits, or a step that never runs,
found only there, is not reported; a refusal found only there is, unless an earlier error stated
the same requirement; and an error shows an item only where the strict run reaches every
item entering the step. The rounds that settle a loop take none.

### 4.5 What the rest of the tool reads, and how correctness is held

The renderer, the editors and the cost layer read a state through **views**
(`check/views.ts`); where the items alone would say too much, the
craft's own names bound a view (`check/names.ts`). An error can show one item that breaks
the step, a witness of the failing set.

The **reference interpreter** (`check/reference/`) holds explicit sets of concrete items
over tiny generated catalogues and states each primitive, condition and the driver one
item at a time: the model as plain code, reviewed against operations.md and the wiki. The
**exactness property** is tested on it: for random catalogues and states, each primitive's
and method's symbolic image, listed, equals the reference's; whole random crafts agree
statement by statement, the recovering run holding at least the strict one's items up to
a condition only it can read; and a
craft checked over the rows it reaches agrees with the same craft over every row.

---

## 5. Layer 4: language services

The LSP is not a second analysis; it is the _same_ checker, surfaced. Two of the checker's
outputs feed it:

- **diagnostics**: the precondition failures, rendered in the game's language: the items
  the step is used on first, then what the op required. No type-system vocabulary ever
  reaches the user, because the views are already game concepts (rarity, counts, mods,
  tiers).
- **the trace**: the items before and after every statement, recorded on the real pass.
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

Thin, by design. The CLI runs the checker and prints diagnostics, or formats a craft. The VSCode extension is a
language client: a TextMate grammar for coloring plus an LSP client that spawns the stdio
server. The browser playground binds the same transport-free service functions to Monaco's
providers directly, with the catalog fetched as JSON; it is the proof that the service
needs no server. Its storyboard is the trace read the other way round: the item after every
statement, top to bottom, as a player follows the craft at the bench. None of the three holds analysis logic; all of it is in `core`, behind the
one-way arrow of §1.

---

## 7. The cost layer (beside the checker, not in it)

The checker proves; the cost layer estimates how many tries a loop takes and what a craft
is expected to spend. It lives in `packages/core/src/cost/`, reads the checker's trace and
the same op sequences, and can never make the checker accept or refuse a step. Its design
is [cost.md](cost.md).
