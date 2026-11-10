# hinekora: Codebase Reference

> The layout is the repo: read the code. Package roles are in each `package.json`, a
> module's purpose in its header comment, and the reason behind a single line of code in
> a comment at that line. This file holds only what the code cannot show: the fields of
> the checker's abstract state in one table, the gotchas that bite across files, and the
> standing design note on relational precision. The shape of the implementation and the
> theory behind the checker are `ARCHITECTURE.md`; the item model is `item-model.md`; the
> operations model is `operations.md`; the cost layer is `cost.md`; conventions and the gate are `../CLAUDE.md`.
> Game rules are linked to their poewiki.net section, never restated.

---

## 1. Why TypeScript, and the name

TypeScript (settled): the design needed fast iteration, the tool wants a browser
playground, and the data is JSON-heavy. Performance never separates the languages here: a
pool computation is ~200 mods × ~25 cheap checks per step, as long as the
intensional-union invariant (`../CLAUDE.md`) holds, and that invariant is an algorithm
choice, not a language choice.

The name: the deity Hinekora foresees the future, and the currency _Hinekora's Lock_ lets
an item foresee the result of the next currency used on it. The language generalizes that
to the whole craft.

---

## 2. Packaging

- **`vscode-languageserver-types` is pinned exact (`3.17.5`)** in `packages/lsp` and
  `editors/playground`: it must match the version `vscode-languageserver` pulls in
  transitively, else two copies of the LSP types clash. For the same reason
  `SemanticTokensBuilder` is imported from `vscode-languageserver` and only the
  `SemanticTokens` _type_ from `-types`.
- **`@hinekora/lsp` exports `"./node"` with a `default` condition** so the CommonJS VSCode
  extension can `require.resolve("@hinekora/lsp/node")` to spawn the server.

---

## 3. Editors and the playground

- **Previewing hover or completion without VSCode:** a throwaway `.mjs` placed **inside
  `packages/lsp/`** (so Node resolves the workspace `@hinekora/*` symlinks), importing
  from `./dist/…` and `@hinekora/data`, run, then deleted. From outside the workspace Node
  cannot resolve the packages.
- **The playground serves the last build.** It resolves the workspace packages through
  their `exports`, which point at `dist/`: run `pnpm build` first and keep `tsc -b -w`
  running beside `vite` while changing core or the service, or the page shows stale
  behaviour.

---

## 4. The abstract state `AItem`

`AItem` (`packages/core/src/check/astate.ts`) is a reduced product (`ARCHITECTURE.md`
§4.2): each field is a small domain with its own `join` and `equal` (`Domain<T>`,
`check/domain.ts`), and the cross-domain facts are reductions in `normalize`.

| Field           | What it holds                                                                                                                                                                           | Owner              |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| `base`          | the base; no operation changes it                                                                                                                                                       | `model/base.ts`    |
| `ilvl`          | the item level; no operation changes it                                                                                                                                                 | `check/astate.ts`  |
| `rarities`      | the rarities the item may have; a rarity `require` holds only on one value, the counts live under the loosest caps over the set and an open slot is judged by the tightest (`capsOver`) | `check/astate.ts`  |
| `counts`        | total, prefix and suffix as ranges, closed under `prefix + suffix = total` against the caps (`CountDomain`)                                                                             | `check/counts.ts`  |
| `bdd`           | the BDD manager, shared by every state of one check                                                                                                                                     | `check/bdd.ts`     |
| `presence`      | one boolean function over type presence, tier atoms and `frac@type` fracture atoms; join is OR, so a disjunction survives a merge                                                       | `check/astate.ts`  |
| `possible`      | the types that may be present, the pool whitelist (`SetDomain`)                                                                                                                         | `check/astate.ts`  |
| `tiers`         | per present type, the rows (tiers) it may be; joined per type (`TierDomain`)                                                                                                            | `check/astate.ts`  |
| `values`        | per present type, the span its value is known to lie in, narrower than its rows' (`ValueDomain`)                                                                                        | `check/values.ts`  |
| `crafted`       | how many bench-crafted modifiers are present, a range held below the crafted cap                                                                                                        | `check/ops.ts`     |
| `craftedTypes`  | the types a bench craft may have put on the item: all a removal of crafted modifiers reaches                                                                                            | `check/ops.ts`     |
| `influences`    | the influence sets the item may have (`InfluenceKey`)                                                                                                                                   | `model/marks.ts`   |
| `corrupted`     | `{false}`, `{true}` or both                                                                                                                                                             | `check/astate.ts`  |
| `eldritch`      | the pairs of eldritch implicit tiers (`eldritchKey`), pairs so the dominance rule survives a join                                                                                       | `model/marks.ts`   |
| `eldritchTypes` | which implicit each side may be, or `"any"` (`ImplicitTypes`); independent of the tiers, which the Orb of Conflict moves without changing the implicit                                  | `check/astate.ts`  |
| `fractures`     | how many modifiers are fractured, a range; which ones is the fracture atoms' business                                                                                                   | `check/ops.ts`     |
| `strands`       | the memory strands the item may hold, a range; a fill that uses strands reads the floor, so its pool stays an over-approximation                                                        | `model/strands.ts` |
| `imprint`       | the item an imprint would restore, present only when one is held on every path                                                                                                          | `check/astate.ts`  |

---

## 5. Gotchas

- **ESM (NodeNext)** in core/parser/data/lsp: relative imports need explicit `.js`
  extensions (`../ast/span.js`), even in `.ts` source. `SourceSpan` lives in
  `ast/span.js`, not `ast/ast.js`.
- **The vscode extension is CommonJS**: don't make it extend the ESM base tsconfig.
- Base **display names are not unique**, so base ids are metadata paths; resolution treats
  a name collision as `ambiguous` unless the bases agree on class, domain, tags and caps
  (`sameToTheModel`).
- **Loop widening over-approximates PRESENCE only** (the held imprint's included).
  Counts, `possible` and tiers converge on their own, so they are left exact;
  interval-widening the counts as well corrupts the after-state total. Widen presence,
  leave the rest (the one exception is [ARCHITECTURE §4.4](ARCHITECTURE.md), Termination).
- **Rarities are a set.** Paths that meet at different rarities keep both; an operation
  that needs one rarity is refused until an `if` on `isRare`, `isMagic` or `isNormal`
  narrows the set, and the counts' caps are the loosest over it.

---

## 6. Design note: relational precision (why a BDD, and why not Z3)

The design framed well-formedness, dead-branch checks and refinement as verification
conditions in an SMT-decidable fragment (linear arithmetic over counts + set membership),
with the guidance "start hand-rolled; reach for Z3 only if something needs it". `AItem` IS
that hand-rolled decision procedure.

A purely non-relational version (independent guaranteed/possible/excluded sets per type)
loses disjunctive facts: after `until has A or has B { … }`, joining the exit states
intersects the guarantees away, so "at least one of A/B is present" is forgotten and a
later `if not A and not B` isn't flagged dead. Options weighed:

- Special-casing "≥1 present" groups: throwaway once general.
- Powerset/DNF of states: enumeration; violates the intensional-union rule.
- **BDD over type presence** (what `presence` is). One boolean function represents all
  presence knowledge; refine = AND, join = OR, dead = FALSE. Deterministic, pure TS,
  compact (bounded by the handful of types a craft refines), keeps the fixpoint machinery.
- Z3/SMT via wasm: strictly more general (would also couple counts to presence
  disjunctions) but a heavy async dependency that breaks core's purity, gives worse
  diagnostics (unsat cores vs rendered state), and doesn't remove the need for the
  loop-invariant fixpoint. **Reserved** for the case that needs counts coupled to presence
  disjunctions.
