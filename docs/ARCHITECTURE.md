# hinekora: Implementation Architecture

> This doc explains the **shape** of the implementation: the layers, how they compose,
> and the theory behind the checker. It is the mental model, not the map.
>
> - **What exists and where** (files, key symbols, gotchas) →
>   [REFERENCE.md](REFERENCE.md). Read it alongside this.
> - **Forward-looking work** → [ROADMAP.md](ROADMAP.md).
> - **The surface language** (syntax, predicates, error style) →
>   [crafting-lang-surface-v0.md](crafting-lang-surface-v0.md).
> - **The operations model** (primitive effects and the library of crafting methods) →
>   [operations.md](operations.md).
> - **The item model** (what hinekora models of items and modifiers, each rule linked to its
>   wiki section) → [item-model.md](item-model.md).
> - **Conventions, the build gate, working style** → [../CLAUDE.md](../CLAUDE.md).
> - **The game's rules** → the Path of Exile wiki, linked by section wherever a doc rests on
>   one; the docs say how hinekora models a rule, never restate it. Cached locally via
>   `tools/poewiki` (the `poewiki-render` skill).
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

A hand-written lexer turns text into trivia-free tokens carrying byte-offset spans; a
recursive-descent parser turns tokens into a `Craft` AST. Two decisions shape everything
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
  as three integer ranges kept consistent under `prefix + suffix = total` by its
  `normalize` (two independent side-ranges would lose the correlation; a derived suffix
  would lose any bound on the suffix side alone). Owns the affix caps.
- **Presence**: which mod _types_ are on the item. This is the one **relational** domain:
  a BDD (a compact canonical boolean function) over "type X is present" variables. Its
  payoff is that a _disjunction_ ("at least one of these three resistances") survives a
  branch merge, because merging presence is boolean OR. Guaranteed / excluded / "≥k of n"
  are all _views_ of this single function.
- **Tiers** (`TierDomain`): which specific tier a present type could be. A per-type overlay;
  non-relational.
- **Possible** (`SetDomain`): the pool whitelist: types that _could_ still roll.
- **Values** (`ValueDomain`): for a present type, the span its value is known to lie in
  when a predicate has narrowed it below its rows' spans; dropped by whatever rolls the
  modifier again, the Divine Orb included.
- **Crafted**: how many bench-crafted mods are present (a range).
- **Rarities** (`SetDomain`): which rarities the item may have; the caps of the counts
  follow the loosest of them.
- **Imprint**: the item an imprint would restore, a nested abstract item; present only when
  every path holds one.
- **Marks** (`SetDomain`): the influence sets the item may have, whether it may be
  corrupted, and the pairs of eldritch implicit tiers it may have (a pair, because which
  implicit is dominant is a relation between the two tiers that two independent sets
  would lose). Each is a set of the concrete values the paths reaching this point allow,
  so a join is a union and a branch on `influenced` or `corrupted` picks the paths back
  out. Influence reaches the pool as tags, the same way a present modifier's added tags
  do.

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

### 4.3 Operations: methods as sequences of state transformers

Each primitive operation is a function `AItem → AItem`, and a crafting method is an
ordered sequence of them ([operations.md](operations.md)): `require` a check, `strip`
to what is kept, `fill` from a pool, `remove` one, set the `rarity`, `lock` one. A
Chaos Orb is `require(rare); strip; fill(natural, reforge 4–6)`; a bench craft is three
checks and a one-row fill; the Fracturing Orb's `lock` only asserts a fracture fact in
the presence BDD. A method is all or nothing: a failed check anywhere leaves the item as
it was in the game, and the checker, having reported it, continues from the state the
method would have left (`operations.md` §2); the metamods in force are read once, when the
method is applied.

The discipline is the core invariant: an operation _folds_ its effect into the summary;
it never materialises a list of concrete outcomes. A fill over-approximates "the new mod
could be any of the pool" by relaxing exactly those types' facts. A strip forgets the
stripped types' facts and a fill from the natural pool makes the pool `possible`. That
is what keeps chaining cheap.

The operations are _transformers_, not part of any domain, which is why they live in
their own file (`check/ops.ts`, with the library of methods in `check/library.ts`) and
do not shrink when the domains are refactored. This split is standard for abstract
interpretation: the domains supply the lattice; the transformers supply the abstract
semantics of the operations. The method table (`check/methods.ts`) sits on top: it maps
a statement's words and arguments to a library sequence, so the surface is a library
over one dispatch rather than a case per method.

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

The checker proves; the cost layer estimates. It answers the question every guide
quotes but the checker cannot: how many tries a loop takes and what the craft is expected
to spend. It lives in `packages/core/src/cost/`, reads the same method table and op
sequences the checker runs, and consumes the checker's output, the trace with the item
before every statement, without touching a transfer function. Nothing it computes can
make the checker accept or refuse a step, which is what keeps the checker a pure soundness
tool. The investigation behind it, with the sources, is
[docs/research/cost-model.md](research/cost-model.md).

### 7.1 Probabilities over a set of items

The item at a step is a set of items, so a probability needs a stated reading of it. The
cost layer takes a **point estimate on the path the guide describes**: the pool a draw
sees is the pool of the facts the item holds on every path (the base at its level, the
influence, the modifiers present on every path with their groups and tags), which is the
item the player is holding when the guide's step is right. A modifier the state holds
only as possible neither shrinks the pool nor adds its tags. This is exact for a reforge,
which strips the uncertain modifiers away, and for an item whose named modifiers fill it;
it is approximate for an add onto an item with unnamed modifiers (`QUESTIONS.md` Q57).
Beside the estimate the report carries a **spread**: the same walk with every range the
checker left open (a side's count, the item's memory strands) read at its floor and at
its ceiling (`Reading`), the two items at the ends of what the checker allows; where the
ends disagree, the step's figure is given with them, so an Exalted Orb onto an item with
unnamed modifiers says what it is worth on the emptiest and on the fullest item it may be.
The game's rules the estimate rests on and the ones no source settles are Q58–Q68.

### 7.2 The race: an exact draw without listing outcomes

The game draws modifiers one at a time by weight without replacement, a group closing
once a modifier of it is drawn and a side closing when full. That draw has an exact
representation as a **race**: give every group an exponential clock whose rate is its
weight, read the groups off in the order their clocks fire, skip a group whose side is
full. Then every question is a question about independent firing times. "These groups are
all among the first k drawn" is "fewer than k minus their number of the other groups fired
before the last of them", a Poisson-binomial count at a time, integrated against that
time's density; the prefix/suffix split of m draws is a race between the two sides' order
statistics. The dynamic program (`cost/race.ts`) carries a count, never a list of draws:
this is the core invariant kept on the probability side. It is exact for one group, for
any set of groups jointly (by inclusion–exclusion), and for the split with depletion,
which craftofexile's calculator approximates; the one approximation is that, given the
split, which groups landed on a side is read from that side's race alone, where the
true draw couples the two through depletion, a second-order effect the race tests bound.

### 7.3 From a method to a roll, from a roll to a chance

`cost/roll.ts` reads a method's op sequence into its **roll**: the random `fill` with the
pool it draws from (built with the checker's own `pool` on the sure facts, so cut to the
top tiers the item's memory strands allow, re-weighted by a resonator's fossils or the
grove's "more / less likely", narrowed to a tag or the top tiers), the count of draws
(a rare reforge's [Chaos Orb § Mechanics](https://www.poewiki.net/wiki/Chaos_Orb#Mechanics)
ratio, one for an add), the modifiers present for certain
(kept through the reforge, or placed first: an essence's grant, a Harvest tag's row drawn
by weight among the tag's rows), or else a uniform removal, a fracture, an unveil's three
weighted options, an ember's weighted implicit, a Divine Orb's reroll, or the
Recombinator's pick (`cost/recombine.ts`: each side pools both items' modifiers, keeps as
many as the page's count table says, and picks them by weight without replacement, one
side first at even odds, an exclusive modifier once picked barring the rest; a dynamic
program over which of the few named modifiers were taken).

`cost/chance.ts` evaluates the checker's resolved predicate against the roll. A `has`
atom on a side is "its group among the first p of that side's race", the row within the
group by weight share, the value within the row by the share of its range (uniform);
count atoms read the split; `and`, `or` and `not` are combined exactly by enumerating
which of the few modifiers the condition names were drawn and which rows they are, a
space of a few dozen cases, never the item's outcomes. A leaf the roll does not model
(a rarity, an influence) is read off the checker's item after the step, which settles it
or leaves the chance unknown.

### 7.4 Cost as a mass walk over the guide

`cost/report.ts` walks the syntax tree once beside the trace, carrying a probability
**mass** split into a few **branches**, one per arm of the `if`s passed since the last
roll, each remembering that roll and the conditions it passed, so a later condition is
judged jointly with them (the chance of `has life` after `if not has fire { restart }` is
the chance of life and fire together over the same reforge, not a product). Expected cost
is linear: a statement's expected runs is the mass that reaches it times the rounds of
every loop around it, times its unit price (`cost/prices.ts`, in the step's own currency:
the orb, the named essence, the fossils and their resonator, the lifeforce, a bench
craft's listed price).

- An **`until`** is a sequence of independent attempts: the body is walked once from the
  head to find the chance one attempt ends in the exit (judged on each falling branch's
  roll and conditions) or in a `stop`; the expected rounds is the reciprocal, every step
  in the body runs that many times per pass, and the share of rounds ending in a stop ends
  the craft. The head of the next attempt is where the last one left off short of the
  exit, so a condition at the top of the body reads the previous round's roll.
- A loop whose body **changes the item one modifier at a time** (random removals, single
  draws such as an Exalted Orb, bench crafts, and branches over them that restart, stop or
  craft) is not memoryless: each round starts where the last left the item. It is solved
  as a Markov chain (`cost/chain.ts`) over a small state, the (prefix, suffix) counts and,
  for each modifier the loop's conditions name, whether it is on the item and at which
  row, from the states the loop may enter with (weighted by the path in), carrying the
  distribution through the body round after round until the mass has left: the exit, a
  restart or a stop, or an item full with nothing removing, which the report names. The
  named modifiers are the only ones tracked; the rest of the item is a count whose draws
  close an average group. The chance of the exit per round, how often each step and
  branch inside runs, and the stop share all fall out exactly.
- An **`if`** splits each branch by its condition's chance; a `restart` ends the attempt;
  a `stop` ends the craft; a top-level `restart` makes the whole guide one attempt of an
  outer loop.

Where the model cannot say (a loop whose exit rests on a value no roll in its body
changes, a Recombinator's gold and dust, an item the snapshot does not price), the report
says so in the step's note rather than invent a figure; the walk assumes one round or an
even branch there, and names the assumption.

### 7.5 The economy

Prices come from a **snapshot committed with the data**, `packages/data/data/poe1/economy.json`, taken from
poe.ninja's exchange overview, and its stash overview for the beasts, for one league on
one day by `fetch-economy.mjs` (five requests), never from live calls in the checker, the
CLI or the editor (Q62). A report
converts its total to Chaos and Divine Orbs under the snapshot and names its date, so a
guide's "about 22 Divine" is reproducible and dated.
