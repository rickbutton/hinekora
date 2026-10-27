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
- `docs/operations.md`: the operations model (primitive effects, the library of every
  crafting method with its composition and status).
- `docs/QUESTIONS.md`: open questions for the user and the assumptions made meanwhile.

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
- **Vitest**, with extensive tests. **PoE1 only**, with no provision for PoE2.
- Surface syntax: C-style braces; a file opens with `craft in poe1`.

## The gate (run before declaring anything done, and before every commit)

```
pnpm -C c:/git/hinekora gate          # typecheck, test, lint, prettier --check, docs:check
pnpm -C c:/git/hinekora format        # prettier --write ., when the check fails
```

`pnpm gate` is `tsc -b` + `vitest run` + `eslint .` + `prettier --check .` +
`scripts/check-docs.mjs`. The docs check fails when a doc names a path or symbol the code
does not have, omits a keyword, currency, harvest tag or abstract-state field the code
has, or links a wiki section the local cache lacks (skipped without the cache). A `git
commit` issued through the Bash or PowerShell tool runs the gate first
(`.claude/hooks/pre-commit-gate.mjs`) on the working tree as it stands when the command
starts, and is refused when it fails; so make the fixes in one command and commit in the
next. **Soundness principle:** tightening the abstract domain only
ever removes false positives (never adds false negatives), so existing green tests
staying green is evidence a tightening is sound.

## Working protocol

The user is not always present. Work runs autonomously and the repo carries the state.

- **Game rules come from the wiki cache** (`.cache/poewiki`, the `poewiki-render` skill),
  never from memory. Cite the page and section in the commit message or doc. A rule the
  wiki does not settle becomes a game probe in `docs/QUESTIONS.md`.
- **Asking without blocking.** A decision, probe or clarification that only the user can
  settle goes into `docs/QUESTIONS.md`: the question, the options with a recommendation,
  the assumption the code proceeds under, and the files that encode it. Then continue
  under that assumption. On resuming, read that file first and apply every `answered`
  entry before new work. Never leave work undone because a question is open unless no
  assumption is reversible.
- **Docs change in the same commit as the behaviour.** `REFERENCE.md` names what exists,
  `ARCHITECTURE.md` the shape, the surface doc the syntax, `item-model.md` the model,
  `ROADMAP.md` only what is not built. Nothing in the docs may describe code that does
  not exist; nothing user-visible may exist undocumented.
- **Commits.** One logical change per commit; a refactor and a behaviour change are
  separate commits; each commit passes the gate on its own; the message stands alone (the
  convention above). Commit as you go; do not push.
- **Review.** After each batch of commits, run `/review <range>` (the `reviewer` agent, a
  fresh context, `.claude/agents/reviewer.md`). Fix `blocking` and `should-fix` findings
  in follow-up commits before reporting the batch done; a finding you disagree with goes
  to `docs/QUESTIONS.md` with both positions.

## Working style

- The user is an experienced compiler/PL engineer but **new to type-system theory**, so
  explain type-theory concepts (abstract domains, relational vs non-relational,
  join/widening, soundness) as they come up. Prefer **clear code over clever code.**
  Walk through non-obvious design choices rather than deciding silently.
- When the user asks a conceptual question, answer the concept first, then implement.
- Never prefix bash commands with `cd`; the working directory is already correct.
