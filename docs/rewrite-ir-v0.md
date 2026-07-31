# Rewrite IR v0 (proposal)

> A design study, not a commitment. It asks what the checker looks like if currency
> operations DECLARE the rewrite they perform instead of computing a new abstract state
> themselves.
>
> Context: [ARCHITECTURE §4.3](ARCHITECTURE.md) (transfer functions today),
> [REFERENCE §4](REFERENCE.md) (the symbols), [ROADMAP](ROADMAP.md).

---

## 1. The problem

Every currency op today has the type `AItem -> TransferResult`. Each one receives the whole
abstract state and is free to write any part of it. Nothing in the types says which
primitive an op is supposed to reach for, so two ops with the same underlying effect can
reach for different ones.

That is a bug class, not a hypothetical. `alteration` called the plain `reroll` rather than
the survivor-aware `reforge`, on the assumption that a Magic item cannot be shielded. It
can: scouring a fractured Rare leaves a Magic item still holding the locked mod. The
alteration discarded the lock, and the checker went on to accept an annul the game refuses.
A false negative, the one direction the design says must never happen.

The same exposure sits on the remove side, where the guard (`hasRemovable`) and the effect
(`removeOne`) are two separate calls that an op author has to remember to pair.

`Survivors` fixed the instance by giving the shielding question one answer. It did not
remove the ability of the next op to skip asking.

## 2. What already exists

The codebase already contains this idea, at small scale, on the concrete side.

`outcome/outcome.ts` defines `Outcome`: `certain`, `addOne`, `removeOne`. It is explicitly a
description of how an item changed rather than a list of the items it could become, and it
answers `guaranteedPresent`, `possiblePresent` and count ranges without enumerating. The
concrete ops in `currency/base.ts` return those descriptions: `transmute` is a rarity gate
followed by `addOne(promoted, pool(...))`. It never builds a result item.

Two things limit it:

- **It covers 4 of the 19 ops.** Only transmute, regal, exalt and annul have a concrete
  model. Alteration, chaos, scour, essence, bench, harvest, fracture, the veiled orbs and
  unveil exist only as abstract transfer functions.
- **The checker does not use it.** `check/` never imports `outcome/`. The only consumers of
  `currency/` and `outcome/` are `render/` and the barrel export, and `render`'s outcome
  functions are exercised only by tests. It is a reference model sitting beside the
  checker, not underneath it.

So the vocabulary exists, is stunted, and is disconnected. The proposal is to grow it and
connect it.

## 3. The shape

An op becomes a pair: guards it must pass, and a sequence of rewrites it performs.

```ts
interface Op {
    readonly guards: readonly Guard[]; // op-specific, irregular, stays hand-written
    readonly effects: readonly Rewrite[]; // drawn from a closed vocabulary
}
```

One interpreter walks `effects` and is the only code that touches an `AItem`. An op cannot
skip the survivor check, because an op cannot perform a reforge; it can only ask for one.

### 3.1 The vocabulary

Seven primitives cover all nineteen ops:

| Primitive                              | Meaning                                                  | Used by                                                                   |
| -------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------- |
| `add(pool, {gen?, rarity?, crafted?})` | one more affix, drawn from `pool`                        | transmute, augment, regal, exalt, bench, harvest augment, veiled exalt    |
| `remove(gens)`                         | one fewer affix, drawn from `gens`                       | annul, harvest augment, veiled exalt                                      |
| `reforge(pool, rarity, count)`         | discard and redraw                                       | alteration, alchemy, chaos, scour, essence, harvest reforge, veiled chaos |
| `force(mod)`                           | a specific mod is present, tier pinned, its side floored | essence, bench                                                            |
| `assert(clause)`                       | a presence clause holds                                  | fracture, harvest, veiled chaos                                           |
| `forget(types)`                        | drop what was known about these types                    | unveil                                                                    |
| `admit(pool)`                          | widen what is possible without moving counts             | unveil                                                                    |

Two ops that look primitive are not. `scour` is `reforge` with an empty pool at Normal, and
the survivor-aware path falls out rather than being written twice. `addSpecific` (bench) is
`add` with a singleton pool followed by `force`.

### 3.2 Guards, intrinsic and extrinsic

This is where the bug class dies.

An **intrinsic** guard belongs to a primitive and is enforced by the interpreter:

- `add` requires an open slot, in the named generation if one is given.
- `remove` requires a mod that is neither protected nor locked.
- `reforge` consults `Survivors` before deciding whether anything survives.

No op can perform one of those effects without the matching check, because the check runs
in the interpreter, not the op. `alteration` could not have had this bug: it would have
declared a reforge, and the reforge is survivor-aware by construction.

An **extrinsic** guard is the game's own irregularity and stays declared per op: essence's
rarity ladder, its item-class coverage, the crafted-mod cap, "at least four mods" for
fracturing, unveil's "at most three options", the metamod block on sourced crafts.

**A hazard worth stating up front.** Not every guard that looks intrinsic is. Bench checks
`sharesFamilyWithPresent` before forcing its mod, and it is tempting to attach that to
`force`. It cannot be: essence also forces a mod, but it does so immediately after a
reforge, where nothing is guaranteed and `possible` is wide with many unidentified slots.
Under those conditions `sharesFamilyWithPresent` reports a possible conflict, and an
intrinsic version of the check would make every essence fail. The family check is
bench-specific because bench adds to an existing item while essence's guarantee comes from
the draw itself. Any guard promoted to intrinsic needs this argument made explicitly.

## 4. Decomposition of every op

Guards abbreviated; `pool` is the base's addable set unless noted.

| Op              | Guards                                            | Effects                                                     |
| --------------- | ------------------------------------------------- | ----------------------------------------------------------- |
| transmute       | rarity Normal                                     | `add(pool, {rarity: magic})`                                |
| augment         | rarity Magic                                      | `add(pool, {rarity: magic})`                                |
| regal           | rarity Magic, can be Rare                         | `add(pool, {rarity: rare})`                                 |
| exalt           | rarity Rare                                       | `add(pool, {gen: forced, rarity: rare})`                    |
| annul           | —                                                 | `remove(allowed)`                                           |
| alteration      | rarity Magic                                      | `reforge(pool, magic, [1,2])`                               |
| alchemy         | rarity Normal, can be Rare                        | `reforge(pool, rare, [4,6])`                                |
| chaos           | rarity Rare                                       | `reforge(pool, rare, [4,6])`                                |
| scour           | rarity not Normal                                 | `reforge(∅, normal, [0,0])`                                 |
| fracture        | rarity Rare, no fracture yet, ≥4 mods             | `assert(fractureDisjunction)`                               |
| essence         | not metamod-blocked, rarity ladder, class covered | `reforge(cappedPool, rare, [4,6])`, `force(granted)`        |
| bench           | crafted cap, no family conflict                   | `add({mod}, {gen, crafted: true})`, `force(mod)`            |
| harvest reforge | rarity Rare, tagged pool non-empty                | `reforge(pool, rare, [4,6])`, `assert(⋁tagged)`             |
| harvest augment | rarity Rare, tagged pool non-empty                | `remove(allowed)`, `add(taggedPool)`, `assert(⋁tagged)`     |
| veiled chaos    | rarity Rare                                       | `reforge(pool, rare, [4,6])`, `assert(VP ∨ VS)`             |
| veiled exalt    | rarity Rare                                       | `remove(allowed)`, `add({VP, VS})`                          |
| unveil          | placeholder present, target available, ≤3 options | `forget({VP, VS})`, `assert(⋁targets)`, `admit(veiledPool)` |

The open-slot and removable guards are absent from the table because the interpreter
supplies them.

**Sequencing costs nothing here.** An earlier concern was that composing primitives would
lose precision against hand-written compound ops, on the theory that `addTagged` knows the
net count after a remove-then-add is unchanged. Reading it, the current code already
composes: `removeOne` drops the total to `[lo-1, hi-1]` and `addTagged` raises it to
`[lo, hi]`, which is the same range a hand-written version would produce. Harvest augment
and veiled exalt are already remove-then-add in the source. The decomposition is latent in
the implementation; the work is making it explicit, not inventing it.

The one parameter that has to survive the move is essence's fill pool, which is capped by
`spec.maxRandomModLevel` and so differs from a plain reforge's. That is why `reforge` takes
a pool rather than computing one.

## 5. What it buys

- **The bug class is gone.** Skipping a survivor check stops being possible rather than
  becoming unlikely.
- **Soundness becomes statable per primitive.** This is the textbook abstract
  interpretation setup: one syntax of operations, a concrete semantics and an abstract one,
  with soundness as `α(concrete) ⊑ abstract` for each primitive. Today that argument would
  have to be made nineteen times, once per op, and there is no shared syntax to make it
  over. With seven primitives it is made seven times and composition carries the rest.
- **The driver collapses.** `checkOp`, `checkEssence`, `checkBench`, `checkHarvest`,
  `checkVeiled` and `checkUnveil` are six variations on resolve, apply, diagnose on
  failure, fall through on success, about a hundred lines in `check.ts`. Resolving a
  statement to an `Op` makes them one.
- **It is the "small set of atoms" property.** The nine common orbs already sit on three
  primitives; the other ten ops do not sit on anything shared. This extends the factoring
  that already works to the ops that escaped it.

## 6. What it costs

- **`arms()` becomes partial.** `outcome/arms()` materializes every arm, bounded by the
  candidate count. A reforge has no such bound; enumerating it is the `~200^n` blowup the
  core invariant forbids. If the concrete layer adopts the same vocabulary, `arms()` has to
  refuse reforge outcomes rather than expand them. That is a real narrowing of the concrete
  model's contract and needs deciding before, not during.
- **The irregular surface does not shrink.** Sixteen precondition failure kinds, the
  essence ladder, the crafted cap, the unveil option count: all of that is the game's, and
  it stays. This proposal relocates state manipulation, which is where the bug class lives.
  It does not make the game regular.
- **Two coexisting paths during the port.** Any staged version has ported and unported ops
  side by side for a while, which is more total code before it is less.
- **Guard classification is the risky judgement.** See the bench and essence hazard in
  §3.2. Getting one wrong turns a passing craft into a failing one.

## 7. Staging

Each stage should leave the gate green on its own. Existing tests staying green is the
evidence the port preserved behavior, per the soundness principle in
[CLAUDE.md](../CLAUDE.md).

1. **Vocabulary and interpreter.** Add `Rewrite`, the interpreter, and the intrinsic
   guards. Port the ops that already reduce cleanly: the four base currencies plus the
   reforge family. Everything else keeps its current path.
2. **Compound ops.** Port essence, bench, harvest, the veiled orbs and unveil. This is
   where guard classification gets decided, one op at a time.
3. **Driver.** Resolve statements to `Op` values and collapse the six apply-and-diagnose
   blocks into one.
4. **Concrete layer, optional and separable.** Point `currency/` at the same vocabulary and
   settle the `arms()` question. Worth doing only if the concrete model is going to earn
   its keep as the reference semantics for a soundness argument; otherwise stage 3 is a
   reasonable stopping point.

## 8. Open questions

- Does `admit` deserve to be a primitive, or is it a mode of `add` with a zero count delta?
- Should `assert` carry a BDD clause directly, or a small clause description the
  interpreter compiles? The former is simpler and leaks the presence representation into
  the vocabulary.
- Do omens stay a parameter on `add`/`remove`, or become a rewrite that scopes the
  following ones? They are currently threaded as `forcedGen` from the driver.
- Is the concrete layer worth keeping at all if stage 4 is skipped? It has no production
  consumer today.
