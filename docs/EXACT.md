# The exact checker: working design

A working document for the migration of the checker to an exact domain. It describes code
that is being built; when the migration ends its content moves to
[ARCHITECTURE.md](ARCHITECTURE.md) and this file is deleted. The code lives under
packages/core/src/exact/; the tool's `check` is this checker, and the present one stays for
its own tests until package 12.

## 1. What exact means

The checker's state at a point of a craft stands for a set of concrete items. The present
domain (ARCHITECTURE §4) keeps that set as independent fields, so it comes to cover items
no path makes, and a correct craft can be refused. The exact domain keeps the set as one
decision diagram, and the invariant of every operation is equality, not inclusion:

> the state after an operation is exactly the set of items the operation can leave, taken
> over exactly the items of the state before it.

A `require` fails if and only if some item of the state breaks it. A branch is dead if and
only if no item of the state satisfies its condition. Where the checker cannot keep this
(a diagram past its node budget, a loop past its round limit) the craft is refused with
that reason. It never trades the equality for speed.

Exactness is relative to the model of the game: the concrete semantics of §2. The core
invariant of CLAUDE.md stands. The diagram is a symbolic summary; no code under the exact
domain lists concrete items, except the reference interpreter of §7, which is test code.

## 2. The concrete model

A concrete item, on a fixed base and item level:

```ts
interface CItem {
    rarity: Rarity;
    /** At most one modifier per type; the caps and the one-per-family rule hold. */
    mods: { row: ModId; value: number | undefined; fractured: boolean; crafted: boolean }[];
    influences: InfluenceKey;
    corrupted: boolean;
    exarch: { tier: number; type: TypeId | undefined }; // tier 0: absent
    eater: { tier: number; type: TypeId | undefined };
    strands: number;
    imprint: CItem | undefined;
}
```

`value` is the first number of the row's text, as `check/values.ts` reads it, and
undefined for a row with no number, where every value comparison is false. `crafted` is a
mark of its own: a bench row always has it, and a natural row may (a Harvest change of a
bench craft). The crafted limit is the bench's precondition, not a property of items: an
annul can take the multimod and leave two crafted modifiers. A primitive
(`Op` of `check/ops.ts`) is a function from one concrete item to the set of items it can
leave, or a failure. The prose of [operations.md](operations.md) §2, the comments of
`check/ops.ts` and the wiki sections they cite define these functions; the reference
interpreter states them as code. Where the present code is vaguer than a concrete rule
needs (which total a reforge with a kept side may reach, what a removal may take), the
wiki decides, and a rule the wiki does not settle goes to
[QUESTIONS.md](QUESTIONS.md) with the assumption made.

## 3. The symbolic state

**Slots.** The state is a set of assignments to a fixed, ordered list of slots, each with a
finite domain, built once per check from the registry, the base, the item level and the
craft (the universe):

- one slot per modifier type that can be on the base by any source the craft can use. Its
  values are `absent` and one value per combination of row, value cell, fractured and
  crafted that can occur. Value cells exist only for a type whose value a condition of the
  craft compares: the thresholds cut each row's span into cells. A type no condition
  compares has one cell.
- one slot each for the rarity, the corruption, the influence set, each eldritch
  implicit's tier, each eldritch implicit's type, and the memory strands.
- when the craft imprints, a second copy of every slot for the held imprint, and a slot
  for whether one is held.

A type's rows always share their families (the data loader's tests pin it), so a slot
holds one row and one slot per type is enough. They do not always share a side: a value
counts on the side of its own row.

**Counts are not stored.** A prefix count is the number of slots holding a prefix row. A
count condition, a cap or a "has an done slot" check is a diagram built by running a small
automaton over the slots.

**Well-formedness.** One diagram, built with the universe, holds the items the game
allows: one modifier per family, the side caps of the rarity and the base, the rules of
the marks. Every state is a subset
of it, and a transformation that could leave it is intersected with it, which is how "the
pool excludes a modifier whose family is taken or whose side is full" is stated.

**The engine** (packages/core/src/exact/dd.ts) is a reduced, hash-consed multi-valued
decision diagram over the slots. It knows nothing of the game. It gives set algebra
(`and`, `or`, `diff`), restriction of a slot to values, forgetting slots, equality by
identity, emptiness, a witness assignment, the values a slot takes, the least and greatest
of a weighted sum over the assignments, a diagram from an automaton over the slots, and
the two liftings of §4. It counts its nodes and throws past a budget.

## 4. Operations

Every primitive is an exact image. The building blocks:

- **narrow**: intersect with a diagram (a condition, a case).
- **set a slot**: forget it, then fix it.
- **one of**: exactly one slot of a set changes, by a relation on that slot's values, and
  the rest stay (`mapOne`). An added modifier is "one absent slot of the pool takes one of
  the pool's values"; a random removal is "one present, reachable slot goes absent".
- **each of**: every slot of a set changes by a relation, independently (`mapEach`). A
  strip, a reroll of values, a tier shift.
- **by case**: where what an operation does depends on the item (the pool under the
  item's influence or a cannot-roll metamod, the protections in force, the dominant
  implicit), the state is split by the slots that decide it, each part transformed with
  its own rule, and the parts united. A method under a metamod that is on some items only
  is this, in place of `metamodCases`' joined runs.

A fill of several modifiers is the single addition repeated, so the order of the draw is
the game's and not an approximation of it. A method stays all or nothing: its `require`s
are judged on the state it starts from and on the states its earlier operations leave, and
a failure refuses the method. A check is judged on the items the method has reached, which
is the item it was used on because only operations with one outcome come before a check;
the frame refuses a sequence that breaks this. After a failure the checker continues from
the items on which the method does work; when there are none, from the failing items
repaired as the craft meant them where the check knows how (a wrong rarity set right), else
from the unchanged state. That state is recovery, outside the equality of §1.

Three runs of operations are one image, since each needs what the step before discards: a
reforge with the modifiers it guarantees, an addition with the removal that must spare it,
and a Harvest change, whose new modifier keeps the old one's tier and crafted mark. An operation that cannot act on an item refuses the method there, as a failed check does;
in an `either`, where no branch acts.

The `Op`, `PoolSpec`, `Selector` and `Check` types and the sequences of `check/library.ts`
and `check/methods.ts` do not change: the exact domain is a second interpreter of the same
operations.

## 5. Conditions and the driver

A resolved condition (`RPred`) is a diagram: presence and tier are a slot restricted to
values, a value comparison is the cells on the right side of the threshold, a count is an
automaton, `and`, `or` and `not` are the set operations. Narrowing by it is an
intersection, in both polarities, with nothing to tighten afterwards.

The driver threads one state. An `if` narrows it both ways and unites the arms. A loop's
head unites the entry with what the body returns from the head's items that fail the
condition, until it stops changing; the exit is the head narrowed by the condition. No
widening. Recovery (§4) feeds the reporting pass only, never a loop's rounds. A
loop past the round limit, or a diagram past the node budget, is an error there, and the
check stops.

## 6. What the rest of the tool reads

The renderer and the editors read the state through views computed from the diagram and
cached by its identity (exact/views.ts): the count ranges, the rarities, the types sure,
possible and excluded, the rows and value span a type may have, the crafted and fractured
counts, the marks, the "at least k of these" groups. Where the items alone would say too
much, the craft's own names bound a view (exact/names.ts).

An error can name an item that breaks the step, taken from a witness of the failing set.

## 7. How correctness is held

- **The reference interpreter** (packages/core/src/exact/reference/) holds explicit sets of
  concrete items over tiny catalogues, a dozen rows with spans of two or three values. It
  states each primitive and each condition the obvious way, one item at a time. It is the
  executable form of §2 and is reviewed against operations.md and the wiki before the
  symbolic form of a primitive is written.
- **The exactness property.** For random tiny catalogues, random reachable states and
  every primitive: the symbolic image, listed, equals the reference image. The same for
  conditions, and, once the driver is switched, for whole random crafts: same verdicts,
  same final set.
- **Old against new.** On the examples and on the tests' crafts, an error of the exact
  checker that the present one does not report is a finding to explain: a soundness fault
  of the present checker, or a fault of the new code.
- **The audit's crafts.** Each craft the present checker refuses or accepts wrongly
  becomes a test with its right verdict.

## 8. Rules for the work

- One package at a time is built by an agent with a fresh context, from this document and
  a brief; a reviewer agent reads it before the next depends on it.
- The present checker is not changed until package 10, but for data it ignores (a Harvest change's rows by source, a failure's kind). New code imports the model, the
  registry and the `Op` types; of `check/astate.ts` it imports the `RPred` type alone, which
  moves when that file goes.
- A game rule comes from the wiki cache and is cited where it is encoded. An agent that
  meets a rule the wiki does not settle reports it with its assumption; it does not guess
  silently.
- The repository's conventions hold (CLAUDE.md): strict TypeScript, lean comments, the
  gate. Property tests are seeded and deterministic.

## 9. Packages

| #   | Package                                                                       | State |
| --- | ----------------------------------------------------------------------------- | ----- |
| 1   | Reference interpreter: concrete items, tiny catalogues, set harness           | done  |
| 2   | Decision-diagram engine                                                       | done  |
| 3   | Universe: slots, values, order, well-formedness, from the registry and craft  | done  |
| 4   | The state: conditions, narrowing, views                                       | done  |
| 5   | Marks and rarity: `rarity`, `corrupt`, `influence`, `eldritch`, their checks  | done  |
| 6   | Adding: `fill` over every pool and count, its checks                          | done  |
| 7   | Removing: `strip`, `remove`, protections, `unprotect`, `keep`, metamod cases  | done  |
| 8   | `lock`, bench crafts and crafted removal, veiled and unveil                   | done  |
| 9   | `reroll`, `relax`, Harvest change, `strands`, `imprint`, `restore`            | done  |
| 10  | The driver on one state; whole-craft exactness tests; the switch              | done  |
| 11  | Messages with a witness; renderer, cost layer, editors on the views           | done  |
| 12  | Delete the present domain; docs; the soundness faults re-probed; limits tuned | open  |
