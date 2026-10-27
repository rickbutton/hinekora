# Hinekora — project guide for Claude

Hinekora is a **statically-checked DSL for Path of Exile crafting guides**. A checker
proves each currency operation's precondition holds on every path (via abstract
interpretation) before real currency is spent.

**Docs** (in `docs/`), each detail in exactly one place; link rather than duplicate:

- `docs/REFERENCE.md`: what exists and where. Package layout, per-module breakdown,
  key-files index, gotchas, design notes. **Read it first.**
- `docs/ARCHITECTURE.md`: the shape of the implementation. The layers, how they compose,
  and the theory behind the checker (abstract interpretation). The mental model.
- `docs/ROADMAP.md`: forward-looking work (pending, deferred, future). Not history.
- `docs/item-model.md`: the item and modifier model the code is audited against, each rule
  linked to its wiki section.
- `docs/crafting-lang-surface-v0.md`: the surface language design (syntax, predicates,
  errors).
- `docs/crafting-lang-typing-rules-v0.md`: the formal item/currency model.

## The core invariant

**Never enumerate outcome unions.** A currency op has hundreds of concrete results;
chaining `n` of them is `~200^n`. Keep a symbolic summary (the checker's `AItem`) and fold
each op's effect into it. If you find yourself building a list of concrete items or
outcomes in the checker, stop; that violates the design and won't scale.

## Conventions (firm; do not relitigate)

- TypeScript with **all strict flags** (`strict`, `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`, `noImplicitOverride`, `noFallthroughCasesInSwitch`).
- **pnpm** workspace monorepo under `@hinekora`; tsc project references (`tsc -b`).
- **Hand-written** lexer + recursive-descent parser; no parser generators.
- **ESLint + Prettier: 4-space indent, double quotes.**
- **Comments are lean.** A comment earns its place only by stating a non-obvious _why_,
  a constraint the code can't show. Design prose belongs in the docs above, not in
  comments; don't narrate what code does, recount design history, or cite milestones.
- **User-facing text speaks the game's language.** Errors, hover, and completion talk
  about items, mods, tiers, and slots, never type-system vocabulary (proofs, predicates
  "holding", abstract state).
- **Comments and commit messages stand alone.** They must be understandable from the repo
  alone, with no memory of the conversation, task, or plan that produced them. No session
  or task references ("audit findings", "1/3", "as discussed", "per the plan", "as
  requested"), no progress or milestone notes, and no point-in-time process artifacts (a
  specific test count, "gate green", "all four green"). Describe the change and its why the
  way a human would when revisiting the code a year later.
- **Vitest**, with extensive tests. **PoE1 only** for now.
- Surface syntax: C-style braces; a file opens with `craft in <game>`.

## The gate (run before declaring anything done, and before every commit)

```
pnpm -C c:/git/hinekora gate          # typecheck, test, lint, prettier --check, docs:check
pnpm -C c:/git/hinekora format        # prettier --write ., when the check fails
```

`pnpm gate` is `tsc -b` + `vitest run` + `eslint .` + `prettier --check .` +
`scripts/check-docs.mjs`. The docs check fails when a doc names a path or symbol the code
does not have, omits a keyword, currency, harvest tag or abstract-state field the code
has, or links a wiki section the local cache lacks (skipped without the cache). A `git
commit` issued through the Bash tool runs the gate first (`.claude/hooks/pre-commit-gate.mjs`)
and is refused when it fails. **Soundness principle:** tightening the abstract domain only
ever removes false positives (never adds false negatives), so existing green tests
staying green is evidence a tightening is sound.

## Working style

- The user is an experienced compiler/PL engineer but **new to type-system theory**, so
  explain type-theory concepts (abstract domains, relational vs non-relational,
  join/widening, soundness) as they come up. Prefer **clear code over clever code.**
  Walk through non-obvious design choices rather than deciding silently.
- When the user asks a conceptual question, answer the concept first, then implement.
- Never prefix bash commands with `cd`; the working directory is already correct.
