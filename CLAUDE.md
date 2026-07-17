# Hinekora — project guide for Claude

Hinekora is a **statically-checked DSL for Path of Exile crafting guides**. A checker
proves each currency operation's precondition holds on every path (via abstract
interpretation) before real currency is spent.

**Read `HANDOFF.md` first** — it is the detailed map of the architecture and the current
state. The three design docs (`IMPLEMENTATION_BRIEF.md`, `crafting-lang-surface-v0.md`,
`crafting-lang-typing-rules-v0.md`) are the ground truth for _intent_.

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
- **ESLint + Prettier: 4-space indent, double quotes.** Match the surrounding code's high
  comment density; comments explain _why_ and cite the design docs' § numbers.
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
  join/widening, soundness) as they come up. Prefer **clear, well-commented code over
  clever code.** Walk through non-obvious design choices rather than deciding silently.
- Never prefix bash commands with `cd`; the working directory is already correct.
