# Hinekora: Implementation Architecture

> This doc explains the **shape** of the implementation: the layers, how they compose,
> and the theory behind the checker. It is the mental model, not the map.
>
> - **What exists and where** (files, key symbols, gotchas) →
>   [REFERENCE.md](REFERENCE.md). Read it alongside this.
> - **Forward-looking work** → [ROADMAP.md](ROADMAP.md).
> - **The surface language** (syntax, predicates, error style) →
>   [crafting-lang-surface-v0.md](crafting-lang-surface-v0.md).
> - **The formal item/currency model** → [crafting-lang-typing-rules-v0.md](crafting-lang-typing-rules-v0.md).
> - **Conventions, the build gate, working style** → [../CLAUDE.md](../CLAUDE.md).
>
> Each detail lives in exactly one place. Where this doc names a symbol, it is to locate a
> concept; the symbol-level reference is REFERENCE §3–§5.

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
        ▼
   language service                        Layer 4 · LSP (diagnostics, hover, completion)
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

A hand-written lexer turns text into trivia-free tokens carrying byte-offset spans; a
recursive-descent parser turns tokens into a `Craft` AST. Two decisions shape everything
downstream:

- **No keyword token kind.** Every word lexes as an `ident`; the parser decides meaning by
  position. This keeps the lexer trivial and the vocabulary in one place.
- **The AST is deliberately shallow.** It mirrors the surface syntax and does _no_
  resolution or lowering; names stay raw strings. So the parser is a pure syntax→tree
  transform, and the AST is the stable contract between front end and checker.

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
- **the pool**: which mods can roll on a given item (eligibility by tags, first-match
  weights). This is what a currency add draws from.
- **tiers**: the tier ladder per base/ilvl (T1 = the best mod that can roll here).
- **caps**: the per-base affix limits (including the "experimented base" implicit deltas),
  consumed by the checker's count domain.

This layer is pure data → structures. It never analyses; it answers questions.

---

## 4. Layer 3: the checker (abstract interpretation)

The heart of the system. The rest of this section is the theory and the architecture; the
symbol-level detail is [REFERENCE §4](REFERENCE.md).

### 4.1 The problem, and the idea

A craft _is_ a program (a sequence of currency operations over an item, with loops and
branches), and we want to prove every operation's precondition holds on **every path**
before real currency is spent.

Simulating is hopeless. A single currency op has hundreds of possible concrete results, so
chaining `n` of them fans out ~`200^n` ways. We cannot enumerate outcomes (this is the
[core invariant](../CLAUDE.md)).

**Abstract interpretation** is the escape. Instead of tracking concrete items, track one
**symbolic summary**, an `AItem`, that stands for the _entire set_ of concrete items
possible at a program point. Each operation gets an abstract counterpart, a **transfer
function** that maps a summary to a summary, folding in the op's effect without ever
listing outcomes. Where control flow merges, `join` two summaries into one that covers
both. Loops iterate to a fixpoint.

The summary always describes a **superset** of what could really occur, an
_over-approximation_. That is the source of soundness: if the abstract run finds no
precondition failure, there is none in reality. The price is paid the other way: a summary
too coarse yields _false positives_ (flagging a craft that would in fact be fine), never
false negatives. Most of the domain's cleverness exists to keep the summary precise enough
that false positives are rare.

Two maps make this precise (lightly): an **abstraction** takes a set of real items to the
summary that covers them; a **concretization** takes a summary back to the set of items it
allows. "X is guaranteed" means _every_ item in that set has X; "X is excluded" means none
do; a _disjunction_ means every item has at least one of a group.

### 4.2 The abstract domain: a reduced product

`AItem` is not one blob. It is a **reduced product** of small, independent domains, each
tracking one kind of fact. `check/domain.ts` declares the shared contract `Domain<T>`: the
two operations the merge/fixpoint machinery needs from _every_ piece, `join` (least upper
bound, to merge branches) and `equal` (to detect a fixpoint). The pieces:

- **Counts** (`CountDomain`, `check/counts.ts`): how many prefixes / suffixes / affixes,
  as integer ranges. The suffix is _derived_ so the correlation `prefix + suffix = total`
  survives (two independent side-ranges would lose it). Owns the affix caps and the
  `normalize` that keeps its ranges mutually consistent.
- **Presence**: which mod _types_ are on the item. This is the one **relational** domain:
  a BDD (a compact canonical boolean function) over "type X is present" variables. Its
  payoff is that a _disjunction_ ("at least one of these three resistances") survives a
  branch merge, because merging presence is boolean OR. Guaranteed / excluded / "≥k of n"
  are all _views_ of this single function.
- **Tiers** (`TierDomain`): which specific tier a present type could be. A per-type overlay;
  non-relational.
- **Possible** (`SetDomain`): the pool whitelist: types that _could_ still roll.
- **Crafted**: how many bench-crafted mods are present (a range).

Why "reduced product": the domains are independent, but a few facts couple them, e.g.
crafted mods are a subset of all affixes, so `crafted ≤ total`. Such a cross-domain fact is
a **reduction**, applied _explicitly_ at the product level (in `normalize`), never smuggled
inside one domain. Keeping each domain ignorant of the others is what makes them small and
independently testable; the reductions are the named seams where they exchange information.

The relational BDD is the one deliberately clever part. A purely per-type set of
guaranteed/excluded facts would intersect a disjunction away at a join and forget it, so a
later "if neither A nor B" could not be flagged dead. The BDD keeps it. (Why not hand the
whole thing to an SMT solver, per [REFERENCE §7](REFERENCE.md): worse diagnostics, a heavy
async dependency, and you would still need the loop fixpoint yourself.)

### 4.3 Transfer functions: operations as state transformers

Each currency op is a function `AItem → AItem` (or a precondition failure). The nine orbs
reduce to two primitives (an **additive add** and a **reforge**) plus remove and scour;
essence and bench build on those with a "force this specific mod present" step.

The discipline is the core invariant: a transfer function _folds_ the op's effect
into the summary; it never materialises a list of concrete outcomes. An add over-
approximates "the new mod could be any addable type" by relaxing exactly those types'
facts. A reforge resets presence to "any of the base's pool." That is what keeps chaining
cheap.

Transfer functions are _transformers_, not part of any domain, which is why they live in
their own file (`check/transfer.ts`) and do not shrink when the domains are refactored.
This split is standard for abstract interpretation: the domains supply the lattice; the
transfer functions supply the abstract semantics of the operations.

### 4.4 The driver: sequencing, branches, loops

`check.ts` threads a summary through the program. A statement either _falls through_ with a
new summary or _restarts_ (diverges, re-entering the enclosing loop).

- **Sequence**: fold each statement's transfer function.
- **Branch (`if`)**: refine the summary into each arm (narrow by the condition), check
  each, then `join` the arms that fall through. An arm whose condition is impossible here
  is flagged as dead.
- **Loop (`until`)**: three steps. _reachability_ (can the exit predicate ever hold on this
  base? if never, report that root cause), the **loop invariant** (a join-fixpoint over the
  states that re-enter the head, so the body is checked at _every_ iteration; this is what
  catches `until has X { exalt }` filling the item), and _exit-as-proof_ (on exit the
  predicate holds, so refine the after-state by it). All three are expressed over one
  primitive: `headStates`, the states re-entering the loop head after one body run (the
  fall-off-end state plus every `restart` back-edge).
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

### 4.5 The rules of the game

Two disciplines keep the whole thing sound:

1. **Never enumerate outcomes** ([../CLAUDE.md](../CLAUDE.md)): the summary is intensional.
   If you are building a list of concrete items in the checker, the design is broken.
2. **Over-approximate, always**: every abstract operation must describe a _superset_ of
   reality. Hence the **soundness principle**: tightening the domain only ever _removes_
   false positives, never _adds_ false negatives, so a change that keeps every green test
   green is evidence it stayed sound. This is why the test suite is the safety net for
   domain and driver refactors.

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

---

## 6. Layer 5: clients

Thin, by design. The CLI runs the checker and prints diagnostics. The VSCode extension is a
language client: a TextMate grammar for coloring plus an LSP client that spawns the stdio
server. Neither holds any analysis logic; all of it is in `core`, reachable only through the
one-way dependency arrow of §1.
