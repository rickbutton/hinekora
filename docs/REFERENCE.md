# hinekora: Codebase Reference

> The layout is the repo: read the code. Package roles are in each `package.json`, a
> module's purpose in its header comment, and the reason behind a single line of code in
> a comment at that line. This file holds only what the code cannot show: the gotchas
> that bite across files. The shape of the implementation and the
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

## 4. Gotchas

- **ESM (NodeNext)** in core/parser/data/lsp: relative imports need explicit `.js`
  extensions (`../ast/span.js`), even in `.ts` source. `SourceSpan` lives in
  `ast/span.js`, not `ast/ast.js`.
- **The vscode extension is CommonJS**: don't make it extend the ESM base tsconfig.
- Base **display names are not unique**, so base ids are metadata paths; resolution treats
  a name collision as `ambiguous` unless the bases agree on class, domain, tags and caps
  (`sameToTheModel`).
