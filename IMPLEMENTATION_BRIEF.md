# Implementation Brief — Hinekora (PoE Crafting Language)

**Hinekora** is a statically-checked DSL for describing Path of Exile crafting
guides. The name comes from the PoE deity Hinekora, who foresees the future
through prophecies — and, more pointedly, from the in-game currency
*Hinekora's Lock*, which lets an item "foresee the result of the next Currency
item used on it." Hinekora-the-language generalizes that: it foresees the
entire craft's possibility-space ahead of time, so an invalid craft can't be
written and every step's item-state is knowable before you spend anything.
(Thematically, the type checker is the "Hinekora" half — deterministic
foresight of what's possible; the deferred probability/cost model is the
"Chaos" half — the space of all probabilities.)

Read this brief first. It is the connective tissue between the two design docs
and the actual build. It records the decisions already made so a fresh session
doesn't relitigate them.

Companion docs (read both — they are the spec):
- `crafting-lang-typing-rules-v0.md` — formal semantics (item model, currency
  library, effects layer, omens, the type-system machinery).
- `crafting-lang-surface-v0.md` — user-facing surface language (syntax,
  predicate grammar, how it lowers to the primitives).

The author is an experienced compiler/PL implementer but NEW to type-system
theory specifically. Explain type-theory reasoning when it comes up; do not
assume familiarity with dependent types, refinement types, indexed monads, or
substructural types beyond what the design docs already establish.

---

## 1. What we're building

A DSL that describes Path of Exile (1 and 2) item *crafting guides* as
programs. A craft is a sequence of currency operations applied to an item; the
type system encodes the item's possibility-space at each step so that every
valid interaction is representable and every invalid one fails to type-check.
The output is a checkable, inspectable crafting guide.

Core idea: the item's *type* is its state (rarity, affix counts, present mods,
ilvl, game). Currency operations are indexed-monad steps that transform one
state-type into another (possibly a tagged union of outcomes). The user writes
an imperative script with no type annotations; the checker infers and threads
the state, and surfaces it as plain item-state renderings.

The five type-system concepts and their referents (all detailed in the typing
rules doc): Curry-Howard (illegal craft = unwriteable program), refinement
types (slot/ilvl/collision invariants via `wf`), dependent types (the candidate
`pool` computed from the item; branching outcome sums), indexed monads (state
threaded through the currency sequence; the B=C seam rejects bad sequences),
substructural/affine (slot-occupying metamods; omens are a lighter boolean
context, NOT linear — see below).

---

## 2. Language & architecture decisions (locked)

- **Language: TypeScript.** Rationale: the design is unvalidated and needs fast
  iteration; the tool is inherently visual (wants a browser playground showing
  item state); data ingestion is JSON-heavy; the dat-schema tooling is already
  TS. Performance does not favor Rust here (see §4).
- **Strict mode, disciplined tagged unions.** Use discriminated unions +
  exhaustive switch for AST nodes, item states, outcome unions, effect kinds.
  Model states precisely; TS won't check our indices for us, so the discipline
  is manual.
- **Pure core, clean seam to UI.** The checker + item-state model + data model
  is a pure, UI-agnostic module communicating in plain data (no DOM). This
  keeps a future Rust/WASM port of the core a bounded job, and keeps the eventual
  probability kernel isolable. Do not let DOM/UI concerns leak into the core.
- **THE foundational performance rule: outcome unions are represented
  INTENSIONALLY, never enumerated.** An Exalt's result is "prior item + one mod
  drawn from pool(it)" as a symbolic description — NOT a materialized list of
  ~100–200 concrete item states. Narrowing filters descriptions (membership
  tests), it does not walk enumerated arms. Getting this wrong causes a
  multiplicative blowup on the 3rd chained random op in any language. Get it
  right from line one. (See §4.)

---

## 3. Repo structure (proposed starting point)

```
/src
  /core                 # PURE. no DOM, no I/O beyond taking loaded data as input.
    /ast                # surface AST node types (discriminated unions)
    /parser             # lexer + parser for the surface grammar (small; see surface doc §)
    /model              # Item state (the index), Mod, Base, Effect, Omen context Ω
    /pool               # pool(it): candidate computation (intensional)
    /check              # the type checker: thread index, wf refinements,
                        #   outcome unions (symbolic), narrowing, loops, omens
    /resolve            # fuzzy mod/currency name resolution + alias table
    /render             # state renderer: item index -> plain text (powers errors,
                        #   inspection, unreachable-loop diagnostics)
  /data                 # ingestion of dat-schema JSON (PoE1) + community data (PoE2)
    /poe1
    /poe2
    /adapter            # normalize PoE1 (Stat*Min/Max) vs PoE2 (@interval) etc.
  /cli                  # thin: parse a .craft file, check it, print state/errors
  /playground           # LATER: browser UI. depends on /core, never vice versa.
/test
  /crafts               # real crafts translated by hand, used as checker tests
```

The dependency arrow is one-way: `playground` and `cli` depend on `core`;
`core` depends on nothing UI. `data` feeds `core` plain normalized structures.

---

## 4. Performance analysis (why TS is fine)

Magnitudes: worst-case ~100 prefixes / 100 suffixes per base (real pools are
smaller); item has <=6 affixes; a craft is ~5–50 ops.

- **`pool(it)`**: ~200 mods x ~20–30 cheap checks = low thousands of ops =
  microseconds. Recomputing every step, uncached, is fine.
- **Checking a craft**: 50 ops x (a pool call + O(1) bookkeeping) =
  microseconds-to-low-ms. Not a bottleneck at any realistic size.
- **Outcome unions**: the ONLY blowup risk. Naive extensional enumeration is
  200 -> 200^2 -> 200^3 ... Represent unions INTENSIONALLY (symbolic
  descriptions; narrowing = membership filter) and there is no blowup. This is
  an algorithm choice, identical cost in TS or Rust.
- **Deferred cost/probability layer** (NOT built yet): expected-attempts,
  distribution convolution, or Monte Carlo of a craft. Small-N, not hot-path
  (runs on "how much will this cost", not per keystroke). Fast enough in JS;
  if ever hot, it's a self-contained numeric kernel to port to WASM. Measure
  first; likely never needed.

Conclusion: performance does not distinguish the languages for what we're
building now. The intensional-union rule is the thing that actually matters.

---

## 5. Suggested first milestones

Build inward-out, smallest useful checkable slice first.

1. **Model + pool, no parser yet.** Implement the Item index, Mod/Base, and
   `pool(it)` intensionally. Hardcode a tiny mod set. Unit-test that pool
   respects domain/ilvl/collision. (Proves the core data model.)
2. **Currency core as functions over the model.** transmute/regal/exalt/annul
   as state-transformers producing symbolic outcome unions. Test the seam
   logic (can't exalt a magic item) directly against the model, still no
   parser. (Proves the indexed-state threading.)
3. **State renderer.** Item index -> plain text. This is the keystone for
   errors and inspection; build it early and lean on it in tests.
4. **Parser for the surface grammar.** Item block, operation lines,
   until/if/with-omen, the camelCase predicate grammar. Now crafts are text.
5. **The checker proper.** Wire parser -> check over the model, threading the
   index, discharging wf refinements, handling narrowing + loops (loop-exit as
   proof) + omens. Errors render state (§ surface doc §6).
6. **Data ingestion.** Load real dat-schema JSON (PoE1) and community data
   (PoE2) through the adapter. Now real bases/mods/tags/weights.
7. **CLI.** Check a .craft file end to end.
8. **(Later) Playground UI; (later) cost/probability layer.**

Milestones 1–3 need no parser and no real data — they validate the core model
fast. Resist building the UI or the probability layer until the checker is
solid on real crafts.

---

## 6. Things deliberately deferred (do NOT build yet)

- Cost / expected-attempts / probability model (its own layer; needs the
  Known/Approx/Unknown weight provenance already in the model).
- Multi-item crafts (recombination; PoE1 mod-transfer orbs). Most crafts are
  single-item; this is an optional future extension needing multiple threaded
  item contexts.
- English negation sugar (`doesn't have`) -> desugars to `not has`.
- "Omen next op only" sugar -> desugars to `with omen`.
- Power-user annotation tier (explicit indexed signatures for reusable
  composite library techniques). Surface language for individual crafts needs
  no annotations.
- The delirium over-cap chaos-orb quirk: NOT modeled (it's a bug; its
  precondition state is unreachable under wf-preservation). See typing rules
  §9.4 / §10.4.

---

## 7. Open design points still unsettled (flag, don't silently decide)

- Exact VC form for the dead-arm inhabitation check (typing rules §4.7); confirm
  it stays in the SMT-decidable fragment (linear arith over counts + set
  membership — should be fine; may not even need a full SMT solver, a small
  hand-rolled decision procedure may suffice).
- Whether to use an SMT solver (Z3 via wasm) at all vs. a hand-rolled checker
  for the (simple) refinement conditions. Start hand-rolled; the constraints
  are small and linear. Reach for Z3 only if something genuinely needs it.
- Contradictory-omen handling: reject at enable-time vs. empty-sum type error
  at use-time (typing rules §10.3/§10.5).
- Casing/format of the .craft file header (`craft in poe2:`) and item block —
  finalize as the parser is written.
