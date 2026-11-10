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
   abstract interpretation                 Layer 3 · the checker  ◀── the heart
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
- **tiers**: the tier ladder per base/ilvl (T1 = the best mod that can roll here), derived
  by sorting a type's rollable rows by mod level, since the game stores no tier numbers.
- **caps**: the per-base affix limits (the [rarity](https://www.poewiki.net/wiki/Rarity#Rarities)
  limits shifted by an experimented base's stats, e.g.
  [Simplex Amulet](https://www.poewiki.net/wiki/Simplex_Amulet#Mechanics)), consumed by the
  checker's count domain.

This layer is pure data → structures. It never analyses; it answers questions.

---

## 4. Layer 3: the checker (abstract interpretation)

The abstract state's fields are tabled in [REFERENCE §4](REFERENCE.md).

### 4.1 The idea

A craft is a program over an item, with loops and branches, and every operation's
precondition must hold on every path. Simulating is hopeless (the
[core invariant](../CLAUDE.md)), so the checker uses **abstract interpretation**: it
tracks one summary, an `AItem`, standing for the whole set of items possible at a program
point. Each operation has a **transfer function** from summary to summary; where control
flow merges, a `join` covers both summaries; a loop iterates to a fixpoint.

In plain terms: the summary always allows at least every item the game could produce, so
if no check fails on the summary, none fails in reality (**soundness**). A summary too
loose only costs _false positives_, a fine craft flagged. "X is guaranteed" means every
item in the set has X; "excluded", none does; a _disjunction_, each has one of a group.
Background: [abstract interpretation](https://en.wikipedia.org/wiki/Abstract_interpretation),
[lattices](https://en.wikipedia.org/wiki/Lattice_%28order%29).

### 4.2 The abstract domain: a reduced product

`AItem` is not one blob. It is a **reduced product** of small, independent domains, each
tracking one kind of fact. `check/domain.ts` declares the shared contract `Domain<T>`: the
two operations the merge/fixpoint machinery needs from _every_ piece, `join` (least upper
bound, to merge branches) and `equal` (to detect a fixpoint). Most pieces are
non-relational: a range per count, a set of the concrete values the paths reaching a
point allow (so a join is a union), a per-type overlay. The one **relational** piece is
presence: a BDD (a compact canonical boolean function) over "type X is present"
variables, whose payoff is that a _disjunction_ ("at least one of these three
resistances") survives a branch merge, because merging presence is boolean OR.
Guaranteed / excluded / "≥k of n" are all _views_ of this single function. Where two
facts must be kept together, a domain carries them as one value (the affix counts as
three ranges normalized under `prefix + suffix = total`, an eldritch implicit pair as a
pair) rather than as two independent ones that a join would decorrelate.

Why "reduced product": the domains are independent, but a few facts couple them, e.g.
crafted mods are a subset of all affixes, so `crafted ≤ total`. Such a cross-domain fact is
a **reduction**, applied _explicitly_ at the product level (in `normalize`), never smuggled
inside one domain. Keeping each domain ignorant of the others is what makes them small and
independently testable; the reductions are the named seams where they exchange information.

The relational BDD is the one deliberately clever part. A purely per-type set of
guaranteed/excluded facts would intersect a disjunction away at a join and forget it, so a
later "if neither A nor B" could not be flagged dead. The BDD keeps it. (Why not hand the
whole thing to an SMT solver, per [REFERENCE §6](REFERENCE.md): worse diagnostics, a heavy
async dependency, and you would still need the loop fixpoint yourself.)

### 4.3 Operations: methods as sequences of state transformers

A crafting method is a sequence of primitive transfer functions `AItem → AItem`, whose
semantics and all-or-nothing rule are [operations.md](operations.md) §2. The operations
are _transformers_, not part of any domain, so they live apart (`check/ops.ts`, the
sequences in `check/library.ts`) and do not change when a domain is refactored: the
domains supply the lattice, the transformers the semantics. The method table
(`check/methods.ts`) maps a statement's words to a sequence, one dispatch rather than a
case per method.

### 4.4 The driver: sequencing, branches, loops

`check.ts` threads a summary through the program. A statement either _falls through_ with a
new summary, _restarts_ (diverges, re-entering the enclosing loop) or _stops_ (the path
ends; it joins nothing downstream, which is how a guide's "the item is bricked" branch
leaves the rest of the craft judged on the good paths only).

- **Sequence**: look each statement's words up in the method table and run the sequence
  its entry builds from the arguments.
- **Branch (`if`)**: refine the summary into each arm (narrow by the condition), check
  each, then `join` the arms that fall through. An arm whose condition is impossible here
  is flagged as dead.
- **Loop (`until`)**: three steps. _reachability_ (can the exit predicate ever hold on this
  base? if never, report that root cause), the **loop invariant** (a join-fixpoint over the
  states that re-enter the head, so the body is checked at _every_ iteration; this is what
  catches `until has X { exalt }` filling the item), and _exit-as-proof_ (on exit the
  predicate holds, so refine the after-state by it). The body runs only from the part of
  a head state where the exit predicate is false: the rest leaves at once, and checking
  the body on it would refuse steps no path takes (an inner loop entered from an outer
  loop's joined invariant). All three are expressed over one primitive: `headStates`,
  the states re-entering the loop head after one body run (the fall-off-end state plus
  every `restart` back-edge).
- **Termination**: the invariant lattice is finite and the step monotone, but the
  relational presence part is tall (~2^atoms), so past a few exact iterations the driver
  **widens**: it over-approximates presence to its unit facts, guaranteeing quick
  convergence. Widening trades a little precision for termination; the loop's exit refine
  re-establishes what was dropped.
- **Defs & procs**: predicate defs (`def f(p) = <pred>`) and operation functions
  (`def f(p) { <stmts> }`) are _inlined_: arguments substituted, body checked in place. So
  they need nothing new in the domain or driver; state threading, nested loops, and
  `restart` back-edges compose for free across a call.

Two suppression modes are worth naming because they recur: `quietly` (a probe or fixpoint
pass, no diagnostics, no trace) and `untraced` (an inlined proc body: trace off, but its
precondition failures still matter). They are scoped helpers, not raw counters.

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
