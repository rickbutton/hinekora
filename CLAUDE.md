# hinekora — project guide for Claude

Hinekora is a **statically-checked DSL for Path of Exile crafts**. A checker
proves each currency operation's precondition holds on every item the craft can reach
before real currency is spent.

**Docs** (in `docs/`), each detail in exactly one place; link rather than duplicate. The
code is the reference for what exists; read it. Open a doc when the task touches its
subject:

- `docs/ARCHITECTURE.md`: the shape of the implementation. The layers, how they compose,
  and the theory behind the checker (exact sets of items).
- `docs/REFERENCE.md`: the checker's slots, the gotchas no single comment can hold
  (packaging, editors, build), and the standing design notes (TypeScript, the decision
  diagram).
- `docs/ROADMAP.md`: work not built (deferred, future). Not history.
- `docs/item-model.md`: the item and modifier model the code is audited against, each rule
  linked to its wiki section.
- `docs/language.md`: the craft author's language reference (syntax, the item block,
  names, control, predicates, errors); each operation's own help is its hover text.
- `docs/operations.md`: the operations model (primitive effects, the library of every
  crafting method and its status).
- `docs/cost.md`: the cost layer (how a roll's chance and a craft's expected spend are
  computed, the game readings they rest on, the economy snapshot).
- `docs/QUESTIONS.md`: open questions for the user and the assumptions made meanwhile.

## The core invariant

**Never enumerate outcome unions.** A currency op has hundreds of concrete results;
chaining `n` of them is `~200^n`. Keep the set symbolic (the checker's `ItemSet`, one
decision diagram) and map each op over it. Never build a list of concrete items or
outcomes in the checker outside `check/reference/`; it won't scale.

## Conventions (firm; do not relitigate)

- TypeScript with **all strict flags** (`strict`, `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`, `noImplicitOverride`, `noFallthroughCasesInSwitch`).
- **pnpm** workspace monorepo under `@hinekora`; tsc project references (`tsc -b`).
- **Hand-written** lexer + recursive-descent parser; no parser generators.
- **ESLint + Prettier: 4-space indent, double quotes.**
- **Comments are lean.** A comment earns its place only by stating a non-obvious _why_,
  a constraint the code can't show; never narrate what code does, recount history, or
  restate a signature.
- **User-facing text speaks the game's language.** Errors, hover, and completion talk
  about items, mods, tiers, and slots, never type-system vocabulary (proofs, predicates
  "holding", abstract state).
- **Comments and commit messages stand alone**, understandable from the repo with no
  memory of the session that produced them: no task references ("audit findings", "1/3",
  "as discussed", "per the plan"), progress notes, or point-in-time artifacts (a test
  count, "gate green"). Write the change and its why.
- **Vitest**, with extensive tests. **PoE1 only**, with no provision for PoE2.
- Surface syntax: C-style braces; a file opens with its item block, no header.

## The gate (run before declaring anything done, and before every commit)

```
pnpm -C c:/git/hinekora gate          # every check below
pnpm -C c:/git/hinekora format        # prettier --write ., when the check fails
```

`pnpm gate` is `tsc -b`, `vitest run`, `eslint .`, `prettier --check .`,
`scripts/check-docs.mjs`, the site build and vale on synced styles. The docs check fails when a doc names a path or symbol the code
does not have, omits a keyword, harvest tag, `Op` kind or scalar slot the code
has, links a wiki section the local cache lacks (skipped without the cache), or outgrows
its budget. A `git commit` issued through the Bash or PowerShell tool runs the gate
first (`.claude/hooks/pre-commit-gate.mjs`) on the working tree of the checkout the
command runs in, as it stands when the command starts, and is refused when it fails; so
make the fixes in one command and commit in the next. **Exactness principle:** every
state is exactly the items the model allows; the exactness tests hold each handler to
the reference interpreter, failing on an image too large or too small.

## Working protocol

The user is not always present. Work runs autonomously and the repo carries the state.

- **Game rules come from the wiki cache** (`.cache/poewiki`, the `poewiki-render` skill),
  never from memory. Cite the page and section in the commit message or doc. A rule the
  wiki does not settle becomes a game probe in `docs/QUESTIONS.md`.
- **Asking without blocking.** A decision, probe or clarification that only the user can
  settle goes into `docs/QUESTIONS.md`: the question, the options with a recommendation,
  the assumption the code proceeds under, and the files that encode it. Then continue
  under that assumption. On resuming, read that file first and apply every `answered`
  entry, then delete it, before new work. Never leave work undone because a question is
  open unless no assumption is reversible.
- **Docs hold only what the code cannot show**: rationale, invariants, model rules,
  decisions and their reasons. Never a file or function inventory, a restatement of what
  a reader gets by opening the code, a copy of a wiki rule (link it), history, or a
  dated observation. A reason with one site in the code is a comment there, not a doc
  paragraph. A doc changes in the same commit as the behaviour it describes, and nothing
  in it may describe code that does not exist. Every language word has its help text in
  the code (hover) or in `language.md`.
- **Docs have budgets.** The docs check holds each doc to a word budget
  (`scripts/check-docs.mjs`) and fails on a file under `docs/` that has none. A doc at
  its budget makes room by cutting what has gone derivable or stale, not by raising the
  budget; raising one is a decision to justify in the commit message. Research notes,
  probe outputs and data snapshots do not go under `docs/`: keep them out of the tree
  (scratch, a branch or a tag) and land only the conclusions.
- **Commits.** One logical change per commit; a refactor and a behaviour change are
  separate commits; each commit passes the gate on its own; the message stands alone (the
  convention above). Commit as you go; do not push.
- **Review.** After each batch of commits, run `/review <range>` (the `reviewer` agent, a
  fresh context, `.claude/agents/reviewer.md`). Fix `blocking` and `should-fix` findings
  in follow-up commits before reporting the batch done; a finding you disagree with goes
  to `docs/QUESTIONS.md` with both positions.

## Working style

- The user is an experienced compiler/PL engineer but **new to type-system theory**, so
  explain type-theory concepts (decision diagrams, exact images, fixpoints, soundness vs
  exactness) as they come up. Prefer **clear code over clever code.**
  Walk through non-obvious design choices rather than deciding silently.
- When the user asks a conceptual question, answer the concept first, then implement.
- Never prefix bash commands with `cd`; the working directory is already correct.
