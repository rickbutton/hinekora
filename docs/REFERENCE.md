# hinekora: Codebase Reference

> The layout is the repo: read the code. Package roles are in each `package.json`, a
> module's purpose in its header comment, and the reason behind a single line of code in
> a comment at that line. This file holds only what the code cannot show: the checker's
> slots in one place, the gotchas that bite across files, and the standing
> design note on the decision diagram. The shape of the implementation and the
> theory behind the checker are `ARCHITECTURE.md`; the item model is `item-model.md`; the
> operations model is `operations.md`; the cost layer is `cost.md`; conventions and the gate are `../CLAUDE.md`.
> Game rules are linked to their poewiki.net section, never restated.

---

## 1. Why TypeScript, and the name

TypeScript (settled): the design needed fast iteration, the tool wants a browser
playground, and the data is JSON-heavy. Performance never separates the languages here: a
step is operations on decision diagrams (§6), never a list of outcomes (the core invariant,
`../CLAUDE.md`), and that is an algorithm choice, not a language choice.

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

## 4. The exact state

A state (`ItemSet`) is a set of items, one decision diagram over the slots of its universe
(`check/universe.ts`, `ARCHITECTURE.md` §4.2), in this order:

| Slot                      | Its values                                                         |
| ------------------------- | ------------------------------------------------------------------ |
| `rarity`                  | Normal, Magic, Rare                                                |
| `corrupted`               | no, yes                                                            |
| `influences`              | each influence set the base can have                               |
| `exarchTier`, `eaterTier` | none, then Lesser to Perfect                                       |
| `exarchType`, `eaterType` | which implicit of those the catalogue names, or one it does not    |
| `strands`                 | the memory strands, 0 to 100                                       |
| one per modifier type     | absent, or a row, its value cell, fractured or not, crafted or not |

When the craft imprints, every slot has a copy beside it for the held imprint, and a last
slot says whether one is held. A modifier type's values are only those the craft can
reach: the rows of the base, the declared item and the sources its steps use (`REACH` by
method), and value cells cut only where its conditions compare. The universe also holds
the well-formed items (`wf`); a later check that reads the same base, level, rows,
comparisons and imprint reuses it (`universeFor`), so a keystroke re-checks over it.

The renderer, the editors and the errors read a state through the views of
`check/views.ts`, each cached by the diagram: a diagram is canonical, so a fact several of
them ask of the same items is worked out once.

---

## 5. Gotchas

- **ESM (NodeNext)** in core/parser/data/lsp: relative imports need explicit `.js`
  extensions (`../ast/span.js`), even in `.ts` source. `SourceSpan` lives in
  `ast/span.js`, not `ast/ast.js`.
- **The vscode extension is CommonJS**: don't make it extend the ESM base tsconfig.
- Base **display names are not unique**, so base ids are metadata paths; resolution treats
  a name collision as `ambiguous` unless the bases agree on class, domain, tags and caps
  (`sameToTheModel`).

---

## 6. Design note: why one decision diagram, and not Z3

The checker's facts are all relational: a modifier and its side's count, a branch's
condition and what the arm does, a loop's exit and the item it leaves. Independent
ranges and sets per fact lose the links between them and refuse correct crafts, so the
state is the set of items itself. A reduced, hash-consed decision diagram holds it
canonically (one object per set, equality by identity, a cached view per set), gives the
set algebra, the images and a witness item for an error, and stays pure TypeScript. An
SMT solver such as Z3 was weighed and set aside: a heavy asynchronous dependency that
breaks core's purity, diagnostics from unsat cores rather than from the items, and a
loop's fixpoint still to drive by hand.
