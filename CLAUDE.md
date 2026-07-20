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
- **Prose reads like a human wrote it.** Write comments, docs, and commit messages in the
  `avoid-ai-writing` skill's **technical** voice profile: plain copulatives ("X is Y"),
  one idea per sentence, jargon defined on first use, and the common AI tells cut. Use
  em-dashes sparingly (a comma, colon, parenthesis, or a new sentence usually reads
  better), skip hollow intensifiers ("genuinely", "significantly"), don't inflate
  significance. `tools/ai-writing/check.mjs` runs the detector and the `commit-msg` hook
  screens each message. Enable the hook once per clone with `git config core.hooksPath hooks`.
- **Vitest**, with extensive tests. **PoE1 only** for now.
- Surface syntax: C-style braces; a file opens with `craft in <game>`.

## The gate (run before declaring anything done)

```
pnpm -C c:/git/hinekora exec tsc -b   # typecheck + build all packages
pnpm -C c:/git/hinekora test          # vitest run
pnpm -C c:/git/hinekora lint          # eslint .
pnpm -C c:/git/hinekora format        # prettier --write .
```

All four green. **Soundness principle:** tightening the abstract domain only ever removes
false positives (never adds false negatives), so existing green tests staying green is
evidence a tightening is sound.

## Working style

- The user is an experienced compiler/PL engineer but **new to type-system theory**, so
  explain type-theory concepts (abstract domains, relational vs non-relational,
  join/widening, soundness) as they come up. Prefer **clear code over clever code.**
  Walk through non-obvious design choices rather than deciding silently.
- When the user asks a conceptual question, answer the concept first, then implement.
- Never prefix bash commands with `cd`; the working directory is already correct.
