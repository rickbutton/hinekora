# Editor support

One language service backs two editors: a VS Code extension and the browser
[playground](/playground/). Both run the same checker as the [command line](./cli).

## Features

| Feature        | What it does                                                                         |
| -------------- | ------------------------------------------------------------------------------------ |
| Diagnostics    | runs the checker on every change and underlines each [error](./errors)               |
| Hover          | shows help for the word under the cursor and the item at that point                  |
| Completion     | offers operations, keywords, condition words and quoted names                        |
| Signature help | shows the arguments of the operation or call under the cursor                        |
| Inlay hints    | shows each parameter's inferred kind, and the parameter each argument fills          |
| Navigation     | go to definition, find references and highlight uses, for definitions and parameters |
| Rename         | renames a definition or a parameter at every use                                     |
| Outline        | lists the item and each definition                                                   |
| Folding        | folds blocks, runs of comment lines and multi-line definitions                       |
| Formatting     | applies the layout of [`hinekora fmt`](./cli#fmt)                                    |
| Highlighting   | colours keywords, item fields, operations, definitions and parameters                |

### Hover

Hover on a step shows three things: what the operation does and needs, the item after the
step, and the expected cost of a repeated step. The item has the layout of the game's item text:

```txt
Item Class: Boots
Rarity: Rare
Titan Greaves
--------
Item Level: 84
--------
{ Prefix Modifier "Essences" — Resource, Life }
+(91-105) to maximum Life
{ 3-5 additional prefix or suffix modifiers }
```

Hover on `until` shows the item after the loop and the chance that a pass ends it. Hover on
a modifier name shows the modifier it resolves to and a table of its tiers on the base, with
the item level each needs. Hover on the base name shows the starting item and the craft's
expected spend.

### Completion

Inside quotes, completion offers the names that fit the position: bases, modifiers,
essences, fossils, bench crafts or Harvest tags. For a modifier it leaves out the ones the
base cannot roll and the ones the checker knows are absent at that point. Typing `"` opens
the list.

## VS Code

The extension is not published to the marketplace. It runs from a checkout of the
repository:

```sh
pnpm install
pnpm build
pnpm -C editors/vscode build
```

Open the repository in VS Code and start the launch configuration `Run hinekora Extension`.
A second window opens with the extension loaded. It treats every `.craft` file as hinekora.

The extension starts the language server as a Node process. The server loads the game data
and the price snapshot from the repository.

## Playground

The [playground](/playground/) is the same service in the browser, with no server. The
editor has every feature in the table. Its hover gives costs without prices; the side pane has the priced line.

- The `example` list loads the crafts from the repository's `examples/` folder.
- The side pane shows the craft step by step. Each step has the item after it and its
  cost line. A loop is a bracketed group that ends in its condition, and a branch has one arm
  per answer.
- Pointing at a step in the pane highlights its statement in the editor. Clicking it moves
  the cursor there.
- Each item card has a `copy` button that copies the item as the game's item text.
- Errors appear under the pane with their line and column. Clicking one moves the cursor
  to it.
- The `format` button formats the craft.
