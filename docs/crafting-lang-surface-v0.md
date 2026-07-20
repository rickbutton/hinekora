# PoE Crafting Language — Surface Syntax v0

The user-facing language: what a person writes to describe a craft, and how it
lowers to the formal typing rules (`crafting-lang-typing-rules-v0.md`). Design
goal: a craft reads like a written guide, with **no type annotations** and
**no type-theory jargon**. Types are inferred from the operation sequence and
only ever surface as a plain rendering of the item's current state.

---

## 0. Design principles

- **The item is implicit and threaded automatically.** A craft is an
  imperative script; each statement is an operation acting on an ambient
  "current item". The user never names or writes a type. Sequencing (statement
  order) is the indexed-monad bind; each op's after-state is the next op's
  before-state, checked invisibly.
- **State is inferred, never declared** (except the input item, §1, which is
  physical ground truth). After every line the checker knows the exact item
  index; the user never writes it.
- **Errors show the item's current state, they don't lecture.** Users know the
  game's rules. A rejected op means their model of the current item drifted
  from reality, so the error's payload is a jargon-free rendering of what the
  item actually is at that point, plus what the op needed. No teaching, no
  fix-suggestion engine. (See §6.)
- **Minimal primitives, sugar is additive.** Surface constructs desugar to the
  three primitives in the typing rules (loop, narrow, omen-context). Niceties
  (English negation spellings, "omen next op only", etc.) are deferred and will
  desugar to what v0 already supports — nothing built now is wasted.

---

## 0.1 Concrete syntax finalized (v0 parser)

The header/item-block casing and block style were left open "to finalize as the
parser is written". Finalized decisions, reflected in every example below:

- **`craft in <game>` is a top-level declaration.** It must come first, before
  anything else; the item block and the statement body then follow directly at
  file scope (the whole craft is NOT wrapped in braces). Requiring the
  declaration up front is what fixes the game for the rest of the file.
- **Blocks are C-style `{ … }`, not indentation.** Control constructs are
  `until <pred> { … }`, `if <pred> { … } else { … }`, `with omen "…" { … }`.
  Whitespace (including newlines) is **insignificant** — indentation is purely
  cosmetic. This drops the off-side-rule machinery entirely and reads like a
  conventional brace language.
- **Text values are quoted.** `base: "Cobalt Jewel"`, mod strings quoted as
  before. This makes every field value self-delimiting (a base name may contain
  spaces, hyphens, or apostrophes) and keeps the lexer simple.
- **`rarity` / game names are case-insensitive** (`rare` == `Rare`;
  `poe2` == `PoE2`); keywords and the camelCase predicate symbols are lowercase.
- **Statements are self-delimiting** — no separators or semicolons. Each op is a
  single word; control constructs are brace-delimited.

---

## 1. The item block (the only declarations)

The input item is user-provided ground truth (ilvl, base, existing mods,
augments) — not inferable, so it is declared. Everything else in a craft is
inferred from here forward.

```
item {
    base:     "Cobalt Jewel"
    ilvl:     82
    rarity:   rare
    prefixes: [ "+1 Suffix Modifier" ]
    suffixes: [ "increased Attack Speed", "+% Fire Resistance" ]
    augments: [ "can roll Marksman" ]      # optional; permanent implicits (no affix slot)
    quality:  20                           # optional; defaults sensible
}
```

- Fields are **givens**: the checker takes them as the initial index rather
  than inferring them.
- Omitted optional fields default (no augments, quality 0, etc.).
- This block is also the boundary where human mod text is resolved to internal
  entities (§2), so ambiguity/unknown-mod errors surface here, before the type
  system runs.

---

## 2. Names: currencies and mods

Human vocabulary in, internal entities out. Resolution priority:

1. **Exact real ID** always works (`IncreasedLife5`) — escape hatch for
   precision or when fuzzy is ambiguous.
2. **Registered aliases** — curated shorthands:
   - currencies: `exalt` → Exalted Orb, `chaos` → Chaos Orb,
     `annul` → Orb of Annulment, `regal` → Regal Orb, `transmute` →
     Orb of Transmutation, ... (shared alias table).
   - mods: short community forms may be aliased (`"phys%"`, `"T1 life"`).
3. **Fuzzy match** on display/name text — MUST report ambiguity or unknown
   rather than silently guessing.

Resolution failures are **resolve-time errors** (during elaboration of text →
entities), distinct from type errors. Ambiguity shows the candidates:

```
    prefixes: [ "fire res" ]
              └─ ambiguous — matches:
                   "+#% to Fire Resistance"
                   "+#% to Fire and Chaos Resistance"
                 use a more specific name or the id.
```

---

## 3. Operations (the body)

Each statement is a currency/operation from the standard library (§4 of the
typing rules), acting on the implicit item. The game is fixed by the craft
header; cross-game ops are unavailable (enforced by the `game` tag in the
index — the user just can't name a PoE1 op in a PoE2 craft).

```
craft in poe2

item { base: "…" ilvl: 82 rarity: normal }

transmute
regal
exalt
```

A complete, type-checked program. No types written. Each op's precondition is
checked against the inferred current state; a failure renders the state (§6).

Two operations take a name (and an optional `t<n>` tier, T1 = best):

- `essence "<name>" [t1]` — apply an essence: a full name
  (`"Deafening Essence of Greed"`) or a type + tier (`essence "greed" t1`).
- `bench "<mod>" [t1]` — add a specific crafting-bench mod, named by the mod it
  adds (`bench "maximum life"`).

A statement can also be a **call to an operation function** — `<name>(<arg>, …)`
— which inlines that function's body here (§4.5).

---

## 4. Control constructs

Three surface constructs, mapping to the three primitives. All share the
predicate grammar (§5).

### 4.1 `until <pred> { … }` — loop with proof-on-exit  (→ loop primitive)

Run the body repeatedly until the predicate holds. On exit the predicate is
**proven** of the item (loop-exit-as-proof), so subsequent statements may rely
on it with no further check.

```
until has "T1 Life" {
    chaos
}
# here the item provably HAS "T1 Life"
```

```
until not has "+1 Suffix Modifier" {
    annul
}
# here the item provably does NOT have "+1 Suffix Modifier"
```

If the exit predicate is provably unreachable (e.g. the mod can't roll on this
base), that is a **write-time error** rendered as state: "this can't exit —
`<mod>` isn't in the possible mods for this item."

### 4.2 `if <pred> { … } else { … }` — branch on an outcome  (→ narrow primitive)

Narrow the just-produced outcome union on the predicate. The `if` body sees the
branch where the predicate holds (state known exactly there); `else` sees the
rest. Required by the "silent wide" rule only when something downstream depends
on the distinction — otherwise the `else` is omittable.

```
annul
if not has "T1 Life" {
    # branch where annul removed it — recover
    restart
}
# (implicit else: it survived; continues here with "T1 Life" known present)
```

### 4.3 `with omen "<o>" { … }` — omen-directed scope  (→ omen context Ω)

Enable an omen for the duration of the block; operations inside read it and are
directed accordingly (their outcome union is shrunk; impossible-under-omen
becomes a state-error). Omens are a boolean context (enabled/disabled), not a
consumed resource — cost/attempts accounting is a separate future layer.

```
with omen "Sinistral Annulment" {
    annul            # forced to remove a prefix; if no removable prefix, state-error
}
```

Desugars to `enableOmen; body; disableOmen`. (A future "omen the next op only"
sugar will desugar to the same.)

### 4.4 `restart` — re-enter the enclosing craft/loop from its start

Used in failure branches (e.g. after losing a forced mod). Lowers to
re-entering the enclosing structured loop, whose exit-type re-establishes the
guarantee. Composite/multi-item crafts are a future extension (§7).

### 4.5 Operation functions — reusable, parameterized op sequences

`def name(params) { <statements> }` declares a local, parameterized sequence of
operations, callable as a step. Same `def` keyword as a predicate def (§5.1); a
`{ … }` body makes it an operation function, an `= <pred>` body a predicate. A
call `name(args)` **inlines** the body — the item state threads through it, a
`restart` inside re-enters the caller's enclosing loop, and a precondition
failure inside is reported at the failing step. Parameter sorts are inferred from
use (a tier, a count, or a mod name), exactly as for a predicate def, and a
parameter may fill a `has`/`bench`/`essence` mod-name or tier slot.

```
def guarantee(m) {
    until has m {
        scour
        alch
    }
}

guarantee("maximum life")
```

Operation functions are pure inlining: recursion is rejected, and a name can be
either a predicate def or an operation function, not both. Calling a predicate as
a step (or an operation function inside a condition) is an error.

---

## 5. Predicate grammar (v0)

Predicates are **state queries** on the current item (backed by the inferred
index, so each is a refinement query the checker can decide). No event/history
predicates — everything asks about the item's *current* state.

Design: everything named is a single spaceless **camelCase symbol**;
comparisons use ordinary operators. Predicate names are niladic or unary
symbols; numeric checks are a projection symbol compared with an operator.
This reads like expressions in any language and is trivial to lex/parse.

```
pred := isRare | isMagic | isNormal      # niladic predicate symbols (bool)
      | has "<mod>" (t<n>)?                # presence of a mod (optionally at a tier)
      | <proj> <cmp> <int>                 # relational expression (bool)
      | not <pred>                         # general negation (composes with all)
      | <pred> and <pred>                  # conjunction (binds tighter than or)
      | <pred> or <pred>                   # disjunction
      | ( <pred> )                         # grouping
      | <name>(<arg>, …)                   # call a local def (§5.1)

proj := prefixCount | suffixCount          # projection symbols (yield a number)
cmp  := == | != | < | <= | > | >=
```

Precedence, loosest first: `or` < `and` < `not` < atom; binary operators are
left-associative.

**Mod names + tiers.** `"<mod>"` is a human stat description (`"maximum life"`,
`"fire resistance"`), fuzzy-matched to a ModType (§2). Because every
tier of a mod shares the same wording and differs only in the numbers, the match
lands on the *type* (the family). `has "maximum life"` means "any tier of
maximum life is present". An optional `t<n>` qualifier (T1 = the best tier
that can roll on this base at this ilvl) narrows to a specific tier:
`has "maximum life" t1`. Tiers are derived per-base from the actual roll
pool, so `t1` on a ring differs from `t1` on body armour, and asking for
a tier that can't roll here is an error. The checker tracks tiers through
operations, so a mod narrowed to T1 is provably not T2.

- Named things (`isRare`, `has`, `prefixCount`, `suffixCount`) are single
  camelCase tokens — no spaces, lexable as one identifier each.
- `==`, `<`, `not` etc. are **operators**, not identifiers, so they are not
  expected to be spaceless symbols — they are the normal expression operators
  every programmer already reads.
- `not` is the single, general negation. It composes with any predicate and is
  what branch-selection uses under the hood (so `if not has "X"` selects the
  outcome arms where X is absent). Guide-English spellings like `doesn't have`
  are DEFERRED sugar that will desugar to `not has`.
- Both `until` and `if` consume the same `pred` grammar — one predicate
  language, two control constructs.

Examples:

```
isRare
has "maximum life" t1
not has "+1 Suffix Modifier"
prefixCount == 3
suffixCount < 2
not (prefixCount == 3)
has "fire res" t1 or has "cold res" t1
```

### 5.1 Predicate defs

`def name(params) = <pred>` declares a local, parameterized, pure predicate,
usable wherever a predicate is (`until anyEleRes(1)`). The same `def` keyword
with a `{ … }` body instead declares an **operation function** (§4.5). Defs may
appear anywhere at file scope. Parameter sorts are inferred from use — a tier
slot, a count slot, or a mod-name slot; the three are distinct (`t1` is not the
number `1`), and a parameter used in conflicting ways is an error. Parameters may
be forwarded to nested calls; recursion is rejected.

```
def anyEleRes(t) = has "fire res" t or has "cold res" t or has "lightning res" t
```

---

## 6. Errors: render the state, don't teach

A rejected operation renders the item's **current inferred state** in plain
terms, plus what the op required. No rule explanation, no fix suggestion.

```
  exalt
  └─ at this point the item is:  Magic · 1 prefix · 1 suffix · ilvl 82
     Exalted Orb needs a Rare item.
```

The state line is a rendering of the inferred index at that program point. The
same **state renderer** powers errors, hover/inspection ("what is my item after
line N"), and unreachable-loop diagnostics. It is inherently jargon-free
because the index components are already domain concepts (rarity, counts,
present mods, ilvl). Building this one renderer well makes most of the error
experience fall out.

Error categories:
- **Resolve-time** (§2): unknown/ambiguous mod or currency name. Shows
  candidates.
- **Type/precondition** (this section): op doesn't fit the current item. Shows
  state + what was needed.
- **Unreachable loop** (§4.1): `until` exit predicate provably unsatisfiable.
  Shows why in state terms.

---

## 7. Deferred / future (surface)

See `ROADMAP.md` — the single list of deferred and future work, including the
surface-level sugar (English negation spellings, "omen next op only", multi-item
crafts, the power-user annotation tier) and the cost/expected-attempts model.

---

## 8. Full example (the delirium jewel craft, surface form)

```
craft in poe2

item {
    base:     "Cobalt Jewel"
    ilvl:     82
    rarity:   rare
    prefixes: [ "random prefix", "+1 Suffix Modifier" ]
    suffixes: [ "random suffix", "random suffix" ]
}

exalt                                   # only open slot is a suffix → forced suffix (inferred)

with omen "Sinistral Annulment" {
    until not has "+1 Suffix Modifier" {
        annul                           # forced to remove a prefix each time
    }
}
# item is now 1 prefix / 3 suffix; the +1 carrier is gone.
# NOTE: the language will REJECT any later attempt to remove the +1 carrier
#       from a 3-suffix state (wf-preservation) — but here it is already gone,
#       having been removed while the cap still allowed it. Clean.
```

Not one type annotation; reads like a checklist. All indexed-state threading,
outcome-union narrowing (via `until`), omen direction, and wf-preservation
happen underneath.
