# What Hinekora needs before the 3.30 league

> The deliverable of the research spike (`README.md`): the features the language and the
> checker need in order to write the crafts of the builds people actually play, in
> priority order, each with the evidence behind it and the crafts it would unlock. The
> evidence is in the sibling files: `builds.md` (47 builds' items), `crafting-methodology.md`
> (how guides craft), `accuracy.md` (the checker against craftofexile),
> `checker-findings.md` (what writing the crafts showed), and `data/ninja-popularity.md`
> (the ladder). Dates are 2026-11-08; the league starts 2026-11-13.

## 1. What the evidence says

**What is crafted.** On the 3.29 softcore ladder (124,358 characters) the slots that are
rare, not unique, are gloves (86%), boots (72%), rings (68%), helmets (47%), body armour
(45%), shields (33%), amulets (30%), belts (21%) and wands (16%), with rare jewels on 90% of
characters and magic flasks on 98%. Across 47 guide builds, 76% of rare equipment carries a
bench craft, 78% of rare armour pieces are eldritch, 21% of rares sit on a fractured mod,
15% are influenced (belts, shields, the special helmets), no item is synthesised, and
multimod appears on eight builds, nearly always the weapon. The typical endgame rare is five
to seven lines, one or two of them crafted, on an eldritch or fractured base (`builds.md` §3).

**How it is crafted.** Every guide follows one skeleton: buy a base that already carries the
hardest line (fractured, influenced, the right implicit); one deterministic opener loop that
guarantees a mod (essences above all, then fossils, alt-regal, a Harvest tag); a middle of
"make room, lock one side, act on the other" (annul or eldritch annul to open a slot, a
bench metamod or a Wild Bristle Matron to lock, then Harvest reforge or augment, Veiled
Exalted/Chaos Orb with a bench-blocked unveil, a blocked Exalt, eldritch exalt/annul); and a
finish (multimod, Divine, Harvest swap, implicits, anoint, catalyst). Cost reasoning is
per-mod: pay for each wanted line separately and never put a won line back in the pot
(`crafting-methodology.md` §1). Recombinators, Hinekora's Lock and the Allflame bench are
in every advanced 3.29 route; the Fenumal split, "reforge keep prefixes" and the old Veiled
Orb are gone.

**Where the language stands.** The opener loops, essence and fossil crafts, eldritch
implicits and Conflict loops, fracturing with the "which one" branch, influence exalts,
Awakener's Orb and Dominance, the Harvest tags, veiled orbs and unveiling, imprints and the
beast helpers all have a spelling and check (`crafting-lang-surface-v0.md`). The research
crafts that check today are in `examples/`; the ones that cannot yet are in
`examples/future/` with the feature they wait on. Writing them exposed the gaps below, which
fall into three bands: checker precision and correctness that block recipes the surface
already has words for; language constructs the recipes use that have no spelling; and
catalog gaps.

## 2. Features in priority order

Priority weighs how many of the collected recipes a feature blocks, whether the block is
total or a workaround exists, and the cost of building it. Band A is small and blocks
recipes the language nominally supports; it comes first. Band B is new language. Band C is
data and polish.

### Band A: the checker must keep up with the recipes it already has words for

**A1. Keep the suffix bound in the count domain.** `checker-findings.md` B2. The abstract
item stores the total and prefix counts as ranges and derives the suffix range, so any fact
about the suffix side alone (`suffixCount <= 2`, `suffixCount == 3`) is lost unless the
prefix count is pinned. That is exactly the shape of every "make room" step: "annul until
one open suffix and two open prefixes" (R3, the essence league-start weapon), "if the
suffixes are full, Eldritch Annul one" (R7, the eldritch gloves), "annul to two suffixes,
bench Cannot Roll Attack" (the quiver). Today the step is accepted but the bench or orb that
follows is refused because the open slot cannot be proven. _Unlocks:_ `essence-minion-wand`,
`eldritch-gloves`, the make-room half of nearly every recipe. _Shape:_ hold three ranges
(prefix, suffix, total) and close them under `total = prefix + suffix` in `normalize`; every
predicate refinement and every op's count arithmetic already goes through that function. A
sound tightening (it only removes states), so the existing green tests are evidence.
_Size:_ a day, `check/counts.ts` and its tests.

**A2. Test the loop exit against the invariant, not one iteration.** B1. `checkUntil` reports
"this loop can never exit" when the exit predicate is unsatisfiable after a single pass of
the body, so any loop that needs several steps to reach its goal (two annuls from a full
item to two open slots, three annuls to clear fillers) is rejected outright. _Unlocks:_
`self-fracture` as written by guides, every multi-step annul loop. _Shape:_ probe
reachability with the head states of the fixpoint (which `loopInvariant` already computes)
rather than `checkBodyQuiet`; keep the one-pass check only as the fast path. _Size:_ hours.
Also check that the real pass runs the body from the invariant refined by the negated exit
predicate (the ring loop's inner annul saw a 0-affix state that no continuing path has).

**A3. Close the two soundness gaps craftofexile found.** `accuracy.md` 1–3. An influence
exalt is accepted on an item whose level admits no influence modifier and the checker
claims a modifier was added (fix: a non-empty-pool `require` before the `fill`, and the same
guard for `beast add <influence>`); four Royale-only rows sit in the natural pool, giving
boots, gloves, wands and weapons one tier too many so a `t<n>` can name a row the game
never rolls (fix: drop ids containing `Royale` at ingestion); the wand suffix families
`% increased Fire/Cold/Lightning Damage` and `Stun Duration` carry weights in the export
that neither craftofexile nor the wiki list has (settle against the wiki's spawn weights
and stamp the patch in the manifest). _Unlocks:_ nothing new, but false negatives on a
soundness checker come before every feature. _Size:_ hours each.

**A4. Name bench-only, hybrid and single-tier modifiers.** B3, B7. `has "suffixes cannot be
changed"` and `has "can have up to 3 crafted modifiers"` are "Unknown mod", although the
surface doc promises that `beast metamod` is narrowed by such a branch; a hybrid cannot be
named because every query word must match a word of the wording ("fire and chaos
resistance", the veiled "% life / % mana"); an implicit whose tiers differ in a number
("Strike Skills target 1 / 2 additional") is two names; a modifier with one tier still
demands `t1` in the item block; and the words guides use ("spell suppression", "chaos res",
"ele res", "+1 gems") do not resolve. _Unlocks:_ `matron-metamod` (and verifying that the
Matron trick collapses, B5), every bench-blocked unveil written by name, the readability
of every example. _Shape:_ let predicate resolution see the bench and veiled domains when
the base can take them; treat "and"/"with"/"to" as joiners rather than query words, or match
on the stat ids; fold numeric variants into one family name; infer the tier when there is
one; a small alias table in the data package (community name → wording) with its own test.
_Size:_ a day.

**A5. Veiled and unveiled modifiers against the bench.** B4. After a Veiled Exalted Orb, a
bench craft that replaces the one crafted modifier also erases the veiled modifier in the
model, while an Exalted Orb in the same place does not; and `bench remove` after an unveil
leaves the loop head believing a veiled or unveiled modifier may remain. The wiki's Veiled
modifier page decides whether an unveiled modifier counts as crafted for the limit and for
"remove crafted"; the model must match it either way. _Unlocks:_ `veiled-unveil`, the
suffix-lock + veiled-orb loop that most finished rares go through (R6). _Size:_ hours plus
the wiki reading.

**A6. Precision in the small places guides step on.** `accuracy.md` 10, B6: the kept side
after `eldritch chaos` renders as 0–3 suffixes though the modifiers are proven kept; an
annul under "Cannot roll Caster" reads 0–1 prefixes where only the metamod is removable; a
Harvest augment after an imprint-and-regal loop is refused though the same item written
directly is accepted. Each is a `tightenCounts`-class fix or a lost fact across a join.
_Size:_ hours each, after A1 since two of them are count facts.

### Band B: constructs the recipes use that have no spelling

**B1. End the craft on a dead path: `stop`.** L1. Guides say "if the life was removed the
item is bricked, start over with a new base". Inside a loop `restart` re-enters the loop,
so the bricked state is carried round and the next step is refused for it; at top level
`restart` already means "end the craft". A `stop` statement (or `restart` allowed to name
the craft) that ends the path and contributes nothing to the join is the whole feature.
_Unlocks:_ `veiled-unveil` and R6 as written; honest failure branches everywhere. _Size:_
hours, parser plus `Flow` plumbing already shaped for `restart`.

**B2. Modifier values: a threshold predicate and the Divine Orb.** G6, L2. "Life ≥ 110",
"a 20%+ DoT multi roll", "Divine the life to 5%" are the stop conditions of most endgame
targets, and only those that coincide with a tier boundary can be written as `t<n>`. The
checker already tracks a roll span per pinned tier for hover, so the abstract value is an
interval per present modifier: a reforge sets it to the tier's span, `divine` resets every
non-crafted modifier's interval to its tier's full span, `has "maximum life" >= 110` refines
the interval (and is impossible when the span lies below), `until has … >= 110 { divine }`
loops as the game does. Values of a modifier whose tier is a disjunction are the union of
the spans. _Unlocks:_ the finishing step of R2, R16 and the per-slot "T1 life ≥ 110" targets;
`value-threshold` in `examples/future/`. _Size:_ two to three days: a value sub-domain
beside the tier overlay, the comparison syntax, `divine` as a library entry, hover.

**B3. Choice over an operation's outcomes: Hinekora's Lock and the Allflame bench.** G2, G3,
Q34. Every advanced 3.29 craft previews the risky step: Lock then Regal or Awakener's Orb
"apply only if it adds a suffix", the Allflame bench's one to four previews of an Exalt,
Annul, Fracturing Orb or influence exalt, keep one. The semantics is one mechanism, a
filtered transfer: run the operation, keep only the outcomes that satisfy a predicate, and
join that with the unchanged item for the case where none did (k previews only sharpen the
cost, not the state). The checker has every piece: `refine` on the after-state, `join` with
the before-state, and a report when the predicate can never be produced. A spelling such as
`lock regal keep has "…"` / `allflame 4 exalt keep prefixCount == 2`, lowering to the same
library form. _Unlocks:_ R11a/b, R12, the "Lock then Exalt" finish of every mirror-tier
item, `lock-regal` in `examples/future/`. _Size:_ two days with the Lock's own rules (not the
bench, Harvest, beasts or the Recombinator; the beast-applied Lock on a Magic item).

**B4. A second item: the Recombinator, named Awakener donors, Kishara's Ducat.** G4, G5,
G15. Since 3.25 every endgame weapon and amulet route merges two half-finished items; the
Awakener's Orb already exists but reduces its donor to an influence, so "the donor's only
Hunter mod is Spell Crit" cannot be stated. _Shape:_ a second item block bound to a name
(`with donor { … }` or a `def item`) and a `recombine donor` operation; the abstract result
is one item whose candidate modifiers are the union of both inputs' guaranteed and possible
sets, per side, with the count distribution and the exclusive-modifier rule the wiki gives
and the base as a two-way disjunction; both inputs are consumed. No enumeration is needed:
the result is still one `AItem` whose presence function is built from two. Kishara's Ducat
is B3 applied to the split. _Unlocks:_ R10 (every variant), R8's named donor, `recombinator`
in `examples/future/`. _Size:_ a week; the largest item and the one with the most game rules
to read (`Recombinator` § Mechanics is long and changed in 3.26).

**B5. The cluster jewel enchant as part of the base.** G10, R18. Cluster jewels are on 46
of 47 builds and their modifier pool is decided by the enchant (passive count and "Added
Small Passive Skills grant …"), which the item block cannot state, so notables do not
resolve. _Shape:_ an `enchant:` field for cluster bases that selects the notable pool;
nothing else changes. _Size:_ a day plus data (the enchant to notable-pool mapping is in the
export).

**B6. Cost as annotation first, model later.** G1. Every recipe quotes expected attempts
and prices; none uses them as control flow. A `# expect` comment convention costs nothing
now; the probability layer (spawn weights, essence and fossil biases, expected iterations
of an `until`) is `ROADMAP.md`'s deferred item and should stay behind B1–B5 for this
league. craftofexile's simulator is the yardstick when it comes.

### Band C: catalog and polish

**C1. Fossils on a Normal item** (`accuracy.md` 4: craftofexile allows it and it is standard
play; confirm the wiki wording, then relax the `require`). **C2. The 3.29 bench rerolls**
(Q7, G11): no collected recipe uses them yet; keep deferred unless the league's guides pick
them up. **C3. Probes** for `accuracy.md` 5–7 (Harvest add/remove on Magic, Fracturing Orb
with eldritch implicits, Awakener's Orb on a receiver without an influenced modifier) go to
`QUESTIONS.md`. **C4. Message wording** (`accuracy.md` 9): three correct verdicts with the
wrong sentence. **C5. Aisling's bench** as a name for the `veiled exalt` shape (G13).
**C6. Experimented bases** (Helical, Simplex, Cogwork; six builds) whose implicit changes
the affix capacity, and the tincture whose display name maps to two ids (B8). **C7.
Quality, catalysts, anoints, enchants, implicits other than eldritch, sockets** stay out:
guides treat them as fixed costs and nothing in the modifier logic depends on them (G7–G9).

## 3. The examples suite

| File                                                                       | Recipe                                         | Status                                                    |
| -------------------------------------------------------------------------- | ---------------------------------------------- | --------------------------------------------------------- |
| `alt-regal-jewel`                                                          | R1 alt–aug–regal on a jewel                    | checks                                                    |
| `flask-alt-aug`                                                            | R20 magic flask                                | checks                                                    |
| `self-fracture`                                                            | R9 fracture, branch on the lock, clear fillers | checks (fixed annuls; the loop form waits on A2)          |
| `influence-merge`                                                          | R8 Redeemer receiver + Awakener's Orb          | checks (the kept influence mods are not promised, Q28)    |
| `bench-finish-resists`, `essence-life-boots`, `example`, `phys-dot-weapon` | the earlier examples                           | check                                                     |
| `future/essence-minion-wand`                                               | R3 essence, make room, multimod                | B12 (a group member's name is ambiguous across the sides) |
| `eldritch-gloves`                                                          | R7 essences, eldritch make-room, implicits     | checks (the Conflict loop to Exquisite waits on Q36)      |
| `future/veiled-unveil`                                                     | R6 suffix lock, veiled orb, unveil loop        | B1 (`stop`), Q45 (how a bad unveil is cleared)            |
| `metamod-harvest-loop`                                                     | R5 lock one side, Harvest reforge the other    | checks (the mana bench guarded by `if not has`)           |
| `matron-metamod`                                                           | R17 the Wild Bristle Matron trick              | checks                                                    |
| `future/imprint-regal-amulet`                                              | R2 imprint checkpoint, regal under a lock      | A6                                                        |
| `future/lock-regal`                                                        | R11 Hinekora's Lock                            | B3                                                        |
| `future/recombinator`                                                      | R10 two-item merge                             | B4                                                        |
| `future/value-threshold`                                                   | R16 "life ≥ 110", divine                       | B2                                                        |
| `future/cluster-harvest`                                                   | R18 reforge a cluster by tag                   | B5                                                        |

## 4. Status

Done on 2026-11-08, the day of the report: A1 (three count ranges), A2 (loop exit against
the invariant), A3's first two items (influence exalt pool, Royale rows; the wand weights
are a probe), A4's first item (bench-only modifiers in predicates, which also proved the
Matron trick), A5 (the veiled modifier survives a replacing bench craft; Q45 asks how a
bad unveil is cleared), and one soundness bug the probes had not reached: a declared
`"random"` affix contributed no possible modifier type (`checker-findings.md` B11). Still
open in Band A: the hybrid and alias naming of A4, the precision losses of A6, and B12,
the side-ambiguous name a group guard needs. B9 and B10 are fixed (a group clash names
the modifiers that may clash; a loop body runs only where its exit predicate is false),
which brought the Harvest metamod loop in. The examples suite stands at eleven checking
guides and seven waiting; the naming fixes of A4 (plurals, joiner words, the natural
modifier first) brought the eldritch gloves in.

## 5. A week's order

With the league on 2026-11-13 and the fixes above mostly small: A3 (soundness) and A1, A2
(the two precision fixes) first, since they move six of the future examples into the
checking set at once; then A4 and A5 (naming, veiled), B1 (`stop`), and the probes of C3
into `QUESTIONS.md`. B2 (values) is the first real language addition and fits before the
league if A-band goes quickly; B3 (Lock) next, since every advanced route uses it; B4
(Recombinator) is the first large item of the league itself. B5 and B6 follow.
