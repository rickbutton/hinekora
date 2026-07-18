# Hinekora — project guide for Claude

Hinekora is a **statically-checked DSL for Path of Exile crafting guides**. A checker
proves each currency operation's precondition holds on every path (via abstract
interpretation) before real currency is spent.

**Docs** (in `docs/`) — each detail lives in exactly one place; link rather than duplicate:

- `docs/HANDOFF.md` — what exists and where: architecture, key files, pending work,
  gotchas. **Read it first.**
- `docs/crafting-lang-surface-v0.md` — the surface language design (syntax, predicates,
  errors).
- `docs/crafting-lang-typing-rules-v0.md` — the formal item/currency model.

## The load-bearing invariant

**Never enumerate outcome unions.** A currency op has hundreds of concrete results;
chaining `n` of them is `~200^n`. Keep a symbolic summary (the checker's `AItem`) and fold
each op's effect into it. If you find yourself building a list of concrete items or
outcomes in the checker, stop — that violates the design and won't scale.

## Conventions (firm — do not relitigate)

- TypeScript with **all strict flags** (`strict`, `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`, `noImplicitOverride`, `noFallthroughCasesInSwitch`).
- **pnpm** workspace monorepo under `@hinekora`; tsc project references (`tsc -b`).
- **Hand-written** lexer + recursive-descent parser — no parser generators.
- **ESLint + Prettier: 4-space indent, double quotes.**
- **Comments are lean.** A comment earns its place only by stating a non-obvious _why_ —
  a constraint the code can't show. Design prose belongs in the docs above, not in
  comments; don't narrate what code does, recount design history, or cite milestones.
- **User-facing text speaks the game's language.** Errors, hover, and completion talk
  about items, mods, tiers, and slots — never type-system vocabulary (proofs, predicates
  "holding", abstract state).
- **Vitest**, with extensive tests. **PoE1 only** for now.
- Surface syntax: C-style braces; a file opens with `craft in <game>`.

## The gate — run before declaring anything done

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

- The user is an experienced compiler/PL engineer but **new to type-system theory** —
  explain type-theory concepts (abstract domains, relational vs non-relational,
  join/widening, soundness) as they come up. Prefer **clear code over clever code.**
  Walk through non-obvious design choices rather than deciding silently.
- When the user asks a conceptual question, answer the concept first, then implement.
- Never prefix bash commands with `cd`; the working directory is already correct.
