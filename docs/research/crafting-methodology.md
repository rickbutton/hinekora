# How players craft rare items in Path of Exile 1 (3.24 – 3.29)

> Research notes for the 3.30 spike (see `README.md` in this directory). This is raw
> evidence about _what guides tell players to do_, gathered 2026-11-08 from published
> crafting guides, the official patch notes and the local poewiki cache. It is not a
> design; conclusions that change the language move to `ROADMAP.md` or `QUESTIONS.md`.
> PoE2 is out of scope and was excluded from every source.

**How to read the labels.** Each claim carries one of:

- **[wiki]** — verified against the local poewiki cache (`.cache/poewiki/md/...`), the
  page URL given.
- **[guide]** — taken from a published crafting guide at the URL given. Guides are dated;
  the patch the guide was written for is noted, because numbers (odds, prices) and some
  names changed between 3.24 and 3.29.
- **[patch]** — quoted from the 3.29.0 patch notes
  (<https://www.pathofexile.com/forum/view-thread/3985332>).
- **[unverified]** — asserted by a weak source (currency-seller blog, forum anecdote) or
  from memory, not confirmed. Treat as a lead, not a fact.

**Where the surface stands today** (from `../crafting-lang-surface-v0.md` and
`../operations.md` §3): every ordinary currency, essences, fossils, the five metamods and
bench crafts, Harvest reforge / augment / change-element / influence / randomise, veiled
orbs and unveiling, influenced exalts, Awakener's Orb, Orb of Dominance, the eldritch
currency and implicit tiers, Vaal / Locus corruption, the Tainted currency, the Bestiary
recipes (add-prefix/suffix, add-influence, metamod, aspect, imprint, talisman fracture),
`until` / `if` / `restart` and predicate / operation definitions. Deferred by design:
cost and probability, multi-item crafts (Recombinator, Reflecting Mist, Kishara's Ducat),
choice over outcomes (Hinekora's Lock, Allflame crafting), the 3.29 bench rerolls, Harvest
"more/less likely". Out: Orb of Chance, Rog, Divine / quality / catalysts / enchants /
sockets / implicits, unique-only currency, flask recipes.

---

## 1. The general model of a craft

### 1.1 The four phases

Every guide collected here, whether a 3-chaos league-start essence spam or a 200-divine
mirror project, follows the same skeleton. The phases differ in how much currency is at
risk per click.

**Phase 0 — pick a base that already solves part of the problem.** The base is chosen for
its _fixed_ properties, which no later step can change cheaply: item class and defence
type (decides the mod pool), item level (84+ for most T1s, 85/86 for a few), and one of
three "anchors" that come pre-attached:

- a **fractured modifier** bought from trade (the dominant pattern since 3.23 made
  Fracturing Orbs common): "ilvl 85+ fractured T2+ Spell Suppression gloves"
  [guide, Maxroll 3.24, <https://maxroll.gg/poe/crafting/crafting-gloves-for-boneshatter-builds>],
  "fractured +1 to Level of all Spell Skill Gems wand"
  [guide, Maxroll 3.24, <https://maxroll.gg/poe/crafting/corrupting-fever-wand>],
  "fractured +2% to all maximum Resistances Spirit Shield"
  [guide, Maxroll 3.24, <https://maxroll.gg/poe/crafting/explosive-trap-saboteur-shield>];
- an **influence** (bought influenced, or added with a Hunter's / Elder's Exalted Orb)
  when an influenced modifier is the goal
  [guide, Maxroll 3.24, <https://maxroll.gg/poe/crafting/hunter-stygian-belt>];
- a **synthesised implicit** or a special base (Stygian Vise, Convoking Wand, Cogwork
  Ring) when the implicit is the point
  [guide, Maxroll 3.24, <https://maxroll.gg/poe/crafting/omni-venom-gyre-belt>].

Quality, sockets and catalysts are applied _before_ crafting, while the item is still
white, because they are cheaper then (Perfect Fossils to 24–30% quality, Fertile
Catalysts on a white Stygian Vise) [guide, several Maxroll pages above].

**Phase 1 — a "deterministic opener" that guarantees one or two wanted modifiers while
rerolling everything else.** This is the only phase where the whole item is rerolled, and
it is run as a loop until a stop condition on the random fill is met:

- **Essence spam** (the most common opener in every source): "Deafening Essence of Greed
  until a T1 elemental resistance appears" [guide, Maxroll gloves above]; "Shrieking
  Essence of Misery until T2+ Damage over Time Multiplier, expect ~72 essences"
  [guide, Maxroll 3.24, <https://maxroll.gg/poe/crafting/crafting-a-detonate-dead-oscillating-sceptre>].
  The essence guarantees its own modifier; the loop fishes a second one from the fill, and
  the fractured base supplies a third. Essences cannot be used once a metamod is on the
  item, so essences always come first [guide, Maxroll metacrafting,
  <https://maxroll.gg/poe/crafting/metacrafting>].
- **Fossil reforge** when the wanted mods share a tag the fossils can weight: Pristine on
  belts for Life (1/46 for the two target Life prefixes) [guide, Maxroll Hunter belt
  above]; Dense on ES helmets; the four-fossil Corroded + Jagged + Shuddering + Metallic
  "block everything but gem levels" on a Convoking Wand (~1/12)
  [guide, Maxroll 3.24, <https://maxroll.gg/poe/crafting/fossils-resonators>].
- **Alteration (+ Augmentation) on a Magic item, then Regal** when the wanted mod is
  rare and the item is cheap to roll: +1 to Level of all Skill Gems on an amulet
  [guide, Maxroll 3.24, <https://maxroll.gg/poe/crafting/corrupting-fever-amulet>],
  T1 +all Elemental Resistances on a Warlord Astral Plate (1/161)
  [guide, Maxroll 3.23, <https://maxroll.gg/poe/crafting/double-influence-crafting>],
  2,100 alt/aug on average for two cluster-jewel mods
  [guide, Maxroll 3.24, <https://maxroll.gg/poe/crafting/shockwave-strength-stack-slayer-cluster-jewel>].
- **Harvest reforge with a tag** when the wanted mod is the _only_ mod of that tag on the
  base ("reforge Chaos on a Lion Pelt with Suffixes Cannot Be Changed is a guaranteed
  Chaos Resistance") or when the tag is narrow (reforge Caster on a medium cluster for
  Repeater) [guide, Maxroll 3.24, <https://maxroll.gg/poe/crafting/harvest-crafting-guide>].
- **Chaos spam** only on cheap influenced bases for a one-mod target ("Chaos Orbs until
  Onslaught on Kill + any Redeemer mod, under ~200 tries")
  [guide, Maxroll 3.24, <https://maxroll.gg/poe/crafting/cooldown-reduction-onslaught-elusive-influenced-boots>].
- **Recombination** since 3.25: two one-mod Magic bases merged into a two-mod base
  (~33%), two two-mod bases into a three-mod base (~31–33%)
  [guide, Maxroll 3.25, <https://maxroll.gg/poe/resources/recombination-guide>;
  guide, Pohx Allflame league, <https://pohx.net/crafts/advanced-endgame-shield/>].

**Phase 2 — "make room, then add under protection".** Once the opener's two or three mods
are on the item, every further step touches _one side at a time_ with the other side
locked, so the downside of a bad roll is bounded to "redo this side":

1. **Make room**: an open prefix and an open suffix are needed. Orb of Annulment is the
   cheap gamble ("if it removes Life or the +3 Minion Gems, go back to the essence
   step") [guide, forum 2022, <https://www.pathofexile.com/forum/view-thread/3241580>];
   Eldritch Orb of Annulment under the right dominance removes from one chosen side
   [guide, Maxroll gloves above]; a beast (Farric Lynx Alpha: add a suffix, remove a
   prefix) rearranges rather than removes [guide, Maxroll belt above]. Since 3.29 the
   Allflame bench can preview an annul and pick the copy that removed the right mod
   [guide, Pohx, <https://pohx.net/crafts/advanced-endgame-shield/>].
2. **Lock** the finished side: bench "Prefixes Cannot Be Changed" / "Suffixes Cannot Be
   Changed" (2 Divine each in 3.24 guides), or a Wild Bristle Matron beast that adds a
   _random_ metamod, forced to the wanted one by filling the other side first
   [guide, Pohx boots, <https://pohx.net/crafts/advanced-endgame-boots/>].
3. **Act on the open side**, choosing the tool by how much the pool must be narrowed:
    - Harvest **reforge with tag** under the lock, when the tag isolates the mod
      [guide, Maxroll Harvest above];
    - Harvest **augment with tag** under both a lock and a "Cannot Roll Attack Modifiers"
      block, when the pool must shrink to one mod ("+1 to Level of all Physical Skill Gems
      is the only Physical mod left") [guide, Maxroll metacrafting above];
    - **Veiled Exalted Orb** (called "Veiled Orb" in 3.23–3.25 guides) or **Veiled Chaos
      Orb** (reintroduced 3.26) under the lock, then **unveil** at Jun, having first
      **bench-crafted a blocker** that shares a group with the most likely unwanted unveil
      ("bench +Armour and +ES so the Life unveil is near-certain")
      [guide, Maxroll belt above]. If Jun offers nothing wanted: re-lock, scour the open
      side, repeat [guide, Maxroll bow,
      <https://maxroll.gg/poe/crafting/crafting-a-bow-for-explosive-arrow-ballista-elementalist>];
    - **Exalted Orb** only once the open side's pool has been narrowed by blocks ("with
      Cannot Roll Attack Modifiers the only prefixes that can roll are Bow Damage and Life,
      so each Exalt guarantees one of them") [guide, Maxroll metacrafting above];
    - **Eldritch Exalted / Annulment** cycling on armour pieces, with bench blocks
      [guide, Maxroll 3.24, <https://maxroll.gg/poe/crafting/eldritch-crafting>];
    - **Influenced Exalted Orb** or **Awakener's Orb** to bring an influence modifier in,
      **Orb of Dominance** to elevate it [guide, Maxroll double-influence above].
4. **Checkpoint** when the item is Magic: a Bestiary imprint (Craicic Chimeral) lets a
   failed Regal be undone [guide, Maxroll cluster jewel above]. Since 3.22 **Hinekora's
   Lock** (or its beastcraft equivalent, Craicic Croaker + The Black Mórrígan) previews
   the next currency's result so a bad Regal is simply not applied
   [wiki, <https://www.poewiki.net/wiki/Hinekora's_Lock>;
   guide, Pohx, <https://pohx.net/crafts/advanced-fractured-2-amulet/>]. Since 3.29
   **Allflame crafting** shows up to four independent outcomes of one currency and keeps
   one [wiki, <https://www.poewiki.net/wiki/Allflame_crafting>].

**Phase 3 — finishing.** Bench-craft the last slot(s) ("Can have up to 3 Crafted
Modifiers" when two or three bench mods are wanted), Divine Orb the values, Harvest-swap
a resistance to the wanted element, Harvest enchant a weapon's quality effect, add
eldritch implicits with Embers / Ichors and raise them with Orbs of Conflict, anoint
(amulets), catalyst (jewellery), and optionally corrupt (Vaal Orb, Locus of Corruption)
and then continue with Tainted currency [guide, all Maxroll pages above; guide, Maxroll
corruption, <https://maxroll.gg/poe/resources/corruption>].

### 1.2 Deterministic steps vs rolls

| Step                                          | Kind                              | What is certain                                    | What is random                                          |
| --------------------------------------------- | --------------------------------- | -------------------------------------------------- | ------------------------------------------------------- |
| Buy fractured / influenced / synthesised base | deterministic                     | the anchor mod, ilvl, base                         | nothing                                                 |
| Essence (Screaming+ on a Rare)                | roll with one guarantee           | the essence mod, Rare                              | every other mod                                         |
| Fossil reforge                                | roll with weights                 | forced mod (Hollow, Glyphic), blocked tags         | the rest                                                |
| Alteration / Augment / Regal                  | roll                              | rarity transitions, slot counts                    | the mods                                                |
| Harvest reforge `<tag>`                       | roll with one guarantee           | one mod of the tag                                 | the rest; _which_ mod of the tag                        |
| Harvest augment `<tag>` under locks + blocks  | can be made deterministic         | the added mod, when the pool is one                | which mod is removed (none if the other side is locked) |
| Bench craft / metamod / remove crafted        | deterministic                     | the exact mod                                      | nothing                                                 |
| Veiled Exalted / Chaos Orb                    | roll                              | a veiled mod appears                               | its side (50/50 when both open), what is removed        |
| Unveil                                        | choice over 3 random options      | one of ≤3                                          | which 3 are offered (blockable)                         |
| Exalted Orb                                   | roll from the open side's pool    | +1 mod                                             | which mod                                               |
| Annul / Eldritch Annul                        | roll over removable mods          | −1 mod (side known for eldritch)                   | which mod                                               |
| Harvest change element                        | deterministic                     | the new element at the same tier                   | nothing                                                 |
| Influenced Exalt                              | roll                              | the influence, one influence mod                   | which                                                   |
| Awakener's Orb                                | roll                              | both influences, one mod from each                 | the rest of the reforge                                 |
| Orb of Dominance                              | roll                              | one influenced mod elevated, one removed           | which                                                   |
| Ember / Ichor                                 | roll                              | the implicit's tier                                | which implicit                                          |
| Orb of Conflict                               | roll (biased)                     | one up, one down                                   | which                                                   |
| Vaal / Locus                                  | roll with destruction             | corrupted                                          | one of 4 outcomes                                       |
| Recombinator (unpredictable)                  | roll                              | an item                                            | which mods survive, which base                          |
| Recombinator (predictable)                    | roll with destruction             | the chosen mods _if_ it succeeds                   | success                                                 |
| Hinekora's Lock                               | preview                           | the next currency's result is seen before applying | nothing (the preview is the result)                     |
| Allflame craft                                | choice over 1–4 independent rolls | one of the previews is kept                        | the previews; how many (Intangibility)                  |
| Divine / catalyst / enchant / quality         | value-only                        | the mod set                                        | values                                                  |

### 1.3 How protection turns unbounded gambles into bounded ones

Guides reason about _what can be lost_, and the whole design of a route is making the
loss on a miss small and recoverable:

- **Metamods bound the blast radius to one side.** "Suffixes Cannot Be Changed + Orb of
  Scouring" is the standard reset of the prefix side; a miss costs "2 Divine + a scour",
  never the suffixes [guide, Maxroll metacrafting above].
- **A fractured mod cannot be lost at all**, so it is placed on the mod with the lowest
  hit chance (T1 DoT multi, +1 gems, +2% max res), which converts the hardest part of the
  craft into a purchase [guide, Maxroll bow, shield, wand above].
- **Blocking shrinks a pool until a roll is a certainty.** Bench a cheap mod from the
  group you do not want (Life to block Life on an ES chest; Armour + ES to block most
  veiled prefixes; Strength/Dex to block the attribute unveil) and the "random" step has
  one or two outcomes left [guide, Maxroll eldritch, belt above].
- **Metamods themselves are not protected**: Cannot Roll Attack Modifiers has no Attack
  tag, so an Annul can delete it, "recraft it for 1 Divine" [guide, Maxroll metacrafting
  above]; a Veiled Exalted Orb under Suffixes Cannot Be Changed has a 50% chance to
  remove the metamod instead of the one prefix [guide, Maxroll veiled,
  <https://maxroll.gg/poe/crafting/veiled-crafting>].
- **Order of operations is a protection.** Essences before metamods (essences refuse
  metamods); bench a filler _then_ Exalt so the slam cannot land a low-tier Life
  [guide, Maxroll 3.22, <https://maxroll.gg/poe/crafting/poison-spark-boots>]; bench-remove
  a 15-Life filler rather than spend an Eldritch Annul [guide, Maxroll eldritch above].
- **Checkpoints and previews remove the loss entirely** for the step they cover: imprint
  (Magic items only), Hinekora's Lock (one currency), Allflame previews (one currency,
  1–4 copies, decaying with Intangibility).

### 1.4 Cost intuition, in words

Nobody chaos-spams a six-mod item because the odds multiply: each wanted mod is a
1-in-10 to 1-in-100 draw against the pool, and the Chaos Orb redraws all six at once.
Guides quantify the single-mod step instead: "1/25 per Essence of Horror for Burning
Damage", "1/22 per Exalt for Concentrated Effect", "1/51 Deafening Wrath for +2 Bow Gems
with the fractured suffix", "1/190 Greed essences for T3+ Fire/Spell Damage with the
fractured suffix", "~2,100 Alts/Augs for two cluster mods", "1/161 Alts for T1 all-res"
[guide, Maxroll pages above]. The strategy is therefore to **pay for each wanted mod
separately** and **never put an already-won mod back into the pot**: an essence buys mod
A with mod B as a lottery ticket; the fractured base buys mod C outright; the metamod
makes mod D's roll touch only the empty side; the bench buys mod E at list price; Divine
fixes the numbers last. A guide's "expected cost" is the sum of each step's expected
tries times the step's price, plus the metamod recrafts on each loop (Maxroll's RF helmet:
"about 22 Divine, mostly from suffix-locks" [guide, Maxroll metacrafting above]). The
same reasoning picks the tool: "Exalt/Annul cycling with blocks is cheaper than Eldritch
Chaos unless Eldritch Exalts are scarce" [guide, Maxroll eldritch above]; "use Harvest
reforge Physical instead of Chaos spam if Vivid lifeforce is under 4,500 per Divine and
Chaos over 150 per Divine" [guide, Maxroll CDR boots above].

### 1.5 What changed between 3.24 and 3.29 that guides rely on

- **3.22** Hinekora's Lock introduced (Ancestor); beastcraft equivalent exists [wiki,
  Hinekora's Lock].
- **3.23** Fracturing Orb became a regular drop (Affliction); "Veiled Orb" = remove a
  random mod, add a veiled mod (the item the Hinekora surface calls `veiled exalt`,
  Veiled Exalted Orb, release 3.14 in the cargo data) [wiki, cargo `items`].
- **3.25** Recombinators returned as a Kingsmarch device (Settlers); went core in 3.26,
  reworked in 3.26 with a Predictable mode [wiki, <https://www.poewiki.net/wiki/Recombinator>;
  forum, <https://www.pathofexile.com/forum/view-thread/3837881>].
- **3.26** Veiled Chaos Orb reintroduced as "reforges a rare item with new random
  modifiers including a random Veiled modifier" (release version 3.26.0 in the cargo
  data) [wiki, cargo `items`]. Pohx's Allflame-league crafts use both: "Veiled Chaos
  Orb" to add a veiled prefix under a suffix lock and "Veiled Exalted Orb" for the
  remove-and-add variant [guide, Pohx boots, amulet above].
- **3.29** (Curse of the Allflame) [patch]:
    - "Added 2 new crafting bench options, unlocked by default. Reroll 3 random Modifiers
      on a Rare Item for a cost of 3 Chaos Orbs, and Reroll a random Modifier on a Rare
      Item for a cost of 8 Chaos Orbs." (also [wiki, Crafting Bench version history]);
    - Allflame crafting at Vesper's bench aboard The Sovereign: "Feed it an item, and it
      will split into a multitude of ghostly outcomes, one of which you can keep for
      yourself"; Ducats (Kishara's etc.) usable only there;
    - "Fractured Fossils now Fracture a random Modifier, and cannot be used on Fractured
      and Influenced items";
    - the Bestiary "Split an item into two / three" recipes were replaced by talisman
      fracture recipes, so the Fenumal Plagued Arachnid split that older ring guides use
      is gone;
    - the Harvest "Synthesise" craft was removed; non-unique synthesised items no longer
      drop;
    - "Mana and Reduced Mana Cost can no longer be Unveiled or Crafted on Rings. Instead
      ... Mana and increased Mana Cost Efficiency";
    - "Caster weapons no longer roll increased Fire, Cold and Lightning Damage Suffix
      Modifiers, nor can these Modifiers be crafted at the crafting bench anymore";
    - Chromatic / socket-colour crafting rewritten (sockets default white; new "at least N
      non-white sockets" bench options); the Vaal "white socket" outcome removed;
    - Rog lost the "apply a random Incubator" craft; Rog's Expedition crafting otherwise
      stands [wiki, <https://www.poewiki.net/wiki/Rog>].

---

## 2. Recipe catalogue

Each recipe gives the item, the steps as the guide gives them (renamed only where a
guide's 3.24 name differs from the 3.29 item name), the source, and a one-line note on
how it maps onto Hinekora today. Probabilities are the guide's own and are patch-dated.

### R1. Alt–Regal–Aug–Exalt on a Magic base (jewels, flasks, amulet openers)

**Item.** Viridian Jewel; targets % maximum Life, Fire DoT Multiplier, Attack Speed with
Bows [guide, Maxroll 3.24,
<https://maxroll.gg/poe/crafting/alterations-augments-regals>].

1. Transmute if white. Orb of Alteration until % maximum Life appears with the suffix
   slot empty.
2. Orb of Augmentation for a suffix; if it is bad, back to 1 (the guide advises against
   annulling here).
3. Repeat 1–2 until two wanted mods. Regal Orb for a third; if it misses, keep the
   two-mod jewel or scour and restart.
4. Optional Exalted Orb for a fourth.

**Cost intuition.** Alterations are far cheaper than Chaos, so items with 2–4 wanted mods
and a small pool are rolled this way.

**Hinekora.** Expressible: `until has "max life" and suffixCount == 0 { alteration }`,
`augment`, `if ... { regal }`, `exalt`. The guide's stop condition "a _useful_ suffix" is
a disjunction the author writes out with a predicate def.

### R2. Alt-spam a rare mod, Regal under a prefix lock, imprint as checkpoint, then protected finishing (the "+1 gems amulet")

**Item.** ilvl 84+ Turquoise/Lapis Amulet; targets +1 to Level of all Skill Gems, +1 to
all Physical Skill Gems, T1 Physical DoT Multiplier, Str/Dex bench, veiled Life/Mana
regen prefix [guide, Maxroll 3.24,
<https://maxroll.gg/poe/crafting/corrupting-fever-amulet>].

1. Alteration until +1 to Level of all Skill Gems (or buy a rare with it, Annul to three
   mods, Fenumal Plagued Arachnid split to Magic — this beast recipe was removed in 3.29
   [patch]).
2. Annul any leftover suffix; Craicic Chimeral imprint as checkpoint.
3. Bench "Prefixes Cannot Be Changed"; imprint again.
4. Regal. Prefix → imprint, back to 3. Suffix → continue.
5. Veiled Exalted Orb (3.24 "Veiled Orb") for a veiled prefix; veiled suffix → Annul it,
   re-bench the lock, repeat; if +1 is annulled, restore imprint, back to 3.
6. Bench maximum Mana (block), unveil +(55-60) Life & Mana regen.
7. Bench "Can have up to 3 Crafted Modifiers"; if no room for the suffixes, lock prefixes
   and Orb of Scouring.
8. Harvest Augment Physical (15,000 Vivid + 1 Sacred) with the prefix lock and attack
   block on: guaranteed +1 to all Physical Skill Gems.
9. Hunter's Exalted Orb; T1 Physical DoT → step 11.
10. Else Harvest Reforge Physical under the prefix lock (50% T1); T2 → re-lock, repeat.
11. Bench Str/Dex, Exalt, final bench.

**Hinekora.** Mostly expressible: `alteration`/`annul`/`beast imprint`/`bench
"prefixes cannot be changed"`/`regal`/`restore`/`veiled exalt`/`unveil "maximum life"`
with bench blocking/`harvest augment "physical"`/`exalt hunter`/`harvest reforge
"physical"`. Gaps: imprinting a _Rare_ with a metamod is not a Bestiary recipe (the
checker allows imprints of Magic items and Rare talismans, as the wiki does; the guide
imprints while still Magic, so this is fine); "50% T1" is a cost statement; a `restart`
after `restore` is how the retry reads.

### R3. Essence spam + bench (the league-start default)

**Item.** Oscillating Sceptre ilvl 82+; targets T2+ DoT Multi or Fire DoT Multi, then
three bench mods [guide, Maxroll 3.24,
<https://maxroll.gg/poe/crafting/crafting-a-detonate-dead-oscillating-sceptre>].

1. Shrieking Essence of Misery until the DoT multi (~72 essences).
2. Annul until one open suffix and two open prefixes; if Cast Speed or DoT multi is
   removed, back to 1.
3. Bench "Can have up to 3 Crafted Modifiers", increased Fire Damage, chance to Ignite,
   Fire as extra Chaos.

**Variants.** Fractured Spell Suppression boots + Deafening Envy until T2+ Life (~10
essences), then eldritch make-room and veiled steps [guide, Maxroll 3.24,
<https://maxroll.gg/poe/crafting/crafting-boots-for-ignite-builds>]; Screaming Essence of
Dread on a ≤ilvl 60 Porcupine bow until T3+ Attack Speed (1/13), Annul to open slots,
bench Cannot Roll Attack, Exalt for +1 Socketed Gems, bench Fire DoT multi
[guide, Maxroll 3.24, bow above]; Pohx's Allflame-league starter kit: fractured base +
"20+ Screaming Essence of Sorrow/Envy/Greed until the desired outcome", then bench Life /
resists / movement speed [guide, Pohx, <https://pohx.net/crafts/boots/>,
<https://pohx.net/crafts/gloves/>, <https://pohx.net/crafts/rings/>,
<https://pohx.net/crafts/amulet/>].

**Hinekora.** Fully expressible: `until has "dot multi" t2 or has "fire dot multi" t2 {
essence "misery" t2 }`, then `until prefixCount <= 1 and suffixCount <= 2 { annul  if not
has "dot multi" { restart } }`, then `bench "can have up to 3 crafted modifiers"`,
`bench ...` ×3. The "~72 essences" is cost.

### R4. Fossil crafting (which fossils for which base)

Collected from Maxroll 3.24 [<https://maxroll.gg/poe/crafting/fossils-resonators>],
Maxroll belt [above], Pohx [<https://pohx.net/crafts/belt/>, <https://pohx.net/crafts/shield/>,
<https://pohx.net/crafts/starter-body-armor/>], Maxroll wand [above]:

| Goal                                     | Base                                | Fossils (resonator)                               | Why                                                                              |
| ---------------------------------------- | ----------------------------------- | ------------------------------------------------- | -------------------------------------------------------------------------------- |
| Life prefixes (flat, %, regen, recovery) | Stygian Vise, shield, belt          | Pristine (Primitive)                              | ×10 Life weight, blocks Defence (armour, ES)                                     |
| Flat + % Energy Shield                   | Hubris Circlet                      | Dense (Primitive)                                 | Defence weight up                                                                |
| 1,000+ Armour league-start chest         | Astral Plate / Saint's Hauberk 6L   | Dense                                             | Defence up, Life blocked (the build uses a mastery)                              |
| +1 Minion & +1 Spell gems                | Convoking Wand ilvl 84              | Corroded + Jagged + Shuddering + Metallic (Prime) | blocks bleed/poison, physical, speed, lightning; ~1/12 for the top minion damage |
| +1 Physical Spell gems & Phys DoT multi  | ilvl 4 Driftwood Wand               | Jagged (Primitive)                                | low ilvl shrinks the pool; 1/17                                                  |
| Quality 24–30% before crafting           | any                                 | Perfect                                           | quality, not mods                                                                |
| Fracture one of the rolled mods          | Rare, not fractured, not influenced | Fractured Fossil                                  | since 3.29 fractures a random mod [patch]                                        |

**Hinekora.** `fossil "pristine"`, `fossil "corroded" "jagged" "shuddering" "metallic"` are
accepted and the forced/blocked tags are modelled; _weights are not_ (`operations.md`
§3.4: "a Serrated Fossil reads as a plain reforge"), so the 1/12 and 1/17 figures are
cost statements the checker cannot see, and the Dense "blocks Life" reading is a tag
exclusion the checker does model. Perfect Fossil is quality: out.

### R5. Harvest reforge with a tag under "Prefixes/Suffixes Cannot Be Changed"

**Item.** Lion Pelt with finished prefixes; target Chaos Resistance [guide, Maxroll 3.24,
<https://maxroll.gg/poe/crafting/harvest-crafting-guide>].

1. Bench "Suffixes Cannot Be Changed" (or Prefixes, depending on side).
2. Harvest "Reforge with a Chaos modifier" (100 Vivid in 3.24). Chaos Resistance is the
   only Chaos-tagged mod on the base, so it is guaranteed.

**Loop variant.** Minion ring: "Suffixes Cannot Be Changed, Harvest reforge Life until an
acceptable Life roll with an open prefix; three prefixes with a bad Life roll means
restart the loop" [guide, poe-vault 2023,
<https://www.poe-vault.com/guides/minion-damage-ring-crafting-guide>]. Pohx: "Wild Bristle
Matron for Suffixes Cannot Be Changed, Harvest reforge Life, repeat until Life is good;
if prefixes fill (~10%) use the Allflame bench to annul a prefix"
[guide, Pohx, <https://pohx.net/crafts/advanced-endgame-shield/>].

**Not available any more.** "Reforge a rare item, keeping all suffix modifiers" (used in
the poe-vault ring guide) is absent from Maxroll's 3.24 craft list and from the current
Horticrafting station; guides use the bench metamod instead [guide, Maxroll Harvest
above]. [unverified: exact removal version; not confirmed in the cache.]

**Hinekora.** Expressible: `bench "suffixes cannot be changed"  harvest reforge "chaos"`,
and the checker already knows the metamod keeps the suffixes. The Life loop is
`until has "maximum life" t2 and prefixCount <= 2 { bench "suffixes cannot be changed"
harvest reforge "life" }`. The "reforge Caster on a cluster until Repeater" case needs
cluster-jewel notables (see R19).

### R6. Veiled Exalted / Veiled Chaos Orb + unveil with blocking (Betrayal)

**Item.** Body armour with +129 Life (T1) and three suffixes; target a veiled prefix
unveiled to % Life / % Mana / ailment avoidance [guide, Maxroll 3.24,
<https://maxroll.gg/poe/crafting/veiled-crafting>].

1. Bench "Suffixes Cannot Be Changed".
2. Veiled Exalted Orb (3.24 "Veiled Orb"): removes a random unprotected mod (50% the
   metamod, 50% the Life) and adds a veiled mod; with three suffixes present it must be a
   prefix. If Life was removed, restore it before retrying.
3. Bench the highest-weight unwanted unveil's group as a blocker (here "Chance to Block
   Attack Damage").
4. Unveil, pick the wanted one of three.

**Suffix variant.** Hunter Stygian Vise: Pristine Fossils for Life prefixes (1/46); open a
suffix (Annul; if a Life prefix goes, back to step 1); bench "Prefixes Cannot Be Changed";
Veiled Exalted Orb; bench Str/Dex blocker; unveil the Chaos + elemental double resistance;
bench the last resistance [guide, Maxroll 3.24,
<https://maxroll.gg/poe/crafting/hunter-stygian-belt>].

**3.26+ variant with Veiled Chaos Orb.** Suffixes finished and locked by a Wild Bristle
Matron (fill suffixes, leave one prefix open so the random metamod must be "Suffixes
Cannot Be Changed"), Veiled Chaos Orb to add a veiled prefix; if prefixes fill, Eldritch
Annul a prefix (Exarch dominant); if the veiled mod is removed, back to the Matron; craft
"evasion while focused" as blocker, unveil; repeat until Movement Speed + chill avoid
[guide, Pohx, <https://pohx.net/crafts/advanced-endgame-boots/>]. Minion wand: "Prefixes
Cannot Be Changed, Veiled Chaos Orb, hope for Trigger on unveil; all suffixes full →
Annul and pray" [guide, poe-vault (GhazzyTV) 2024,
<https://poe-vault.com/guides/crafting-2-generic-minion-wand>].

**Aisling's bench** (Research safehouse, T4): "add a veiled modifier and remove a random
modifier" is used as the no-prefix-fill alternative to the orb [guide, Maxroll 3.23,
<https://maxroll.gg/poe/crafting/fireball-deadeye-wand>].

**Hinekora.** Expressible: `bench "suffixes cannot be changed"  veiled exalt  if not has
"maximum life" { restart }  bench "chance to block attack damage"  unveil "increased
maximum life"`. `unveil "<mod>"` is accepted only when blocking has reduced the pool to
≤3 options, which is exactly the guide's technique; otherwise bare `unveil` followed by
`if has ...`. `beast metamod` gives the disjunction over metamods that the Matron
produces, narrowed by `if has "suffixes cannot be changed"`. Aisling's bench has no
name of its own in the surface; `veiled exalt` has the same effect shape.

### R7. Eldritch crafting on armour pieces (ember/ichor + eldritch chaos/exalt/annul + Conflict)

**Item.** Fractured T2+ Spell Suppression Dragonscale Gauntlets ilvl 85+; targets T1
elemental res, +Life, veiled "Attack and Cast Speed while Focused", Exarch "Strike Skills
target additional enemies" and Eater "Spell Suppression" implicits
[guide, Maxroll 3.24, <https://maxroll.gg/poe/crafting/crafting-gloves-for-boneshatter-builds>].

1. Deafening Essence of Greed until any T1 elemental resistance (Harvest-swap later).
2. No open suffix → Lesser Eldritch Ichor (Eater dominant) + Eldritch Orb of Annulment;
   if the resistance goes, back to 1.
3. Bench "Suffixes Cannot Be Changed", Veiled Chaos Orb. No open prefix → Greater Ember
   (Exarch dominant) + Eldritch Annul; Life removed → back to 1.
4. Veiled prefix instead of suffix → Annul it, re-lock, retry. Unveil "Attack and Cast
   Speed while Focused"; not offered → Eater dominance (Grand Ichor if needed) + Eldritch
   Annul the veiled mod, retry.
5. Implicits: Greater/Grand Embers until Strike Skills; Exceptional Ichor to open a tier
   gap; Orb of Conflict upgrades the lower (Exarch) implicit; refresh Eater with an
   Exceptional Ichor after each success; stop at Exquisite. Then Greater/Grand Ichors
   until Spell Suppression.
6. Open prefix → bench % Armour as blocker, Exalt for Life or Phys. Bench the last mod.

**ES chest variant.** Vaal Regalia: bench +Life as blocker, Exarch-dominant Eldritch
Exalt for T2+ % ES; wrong mod → bench-remove the cheap filler first, then Eldritch Annul;
Eater-dominant Eldritch Chaos to reroll suffixes [guide, Maxroll 3.24,
<https://maxroll.gg/poe/crafting/eldritch-crafting>]. Minion helmet: Grand Ichors until
Reservation Efficiency; imprint-and-Conflict loop to raise it; Exceptional Embers until
Minion Life; Deafening Greed until +3 Minion Gems; Eldritch Chaos until two or three good
suffixes [guide, forum 2022, <https://www.pathofexile.com/forum/view-thread/3241580>].

**Hinekora.** Expressible: `ichor lesser`, `eldritch annul`, `ember greater`, `eldritch
exalt`, `eldritch chaos`, `conflict`, `dominant exarch`, `exarch "strike skills" exquisite`
predicates, `bench remove`. The guide's implicit loop ("Conflict; if Eater went up and
Exarch down, Ichor again") is `until exarch "strike" exquisite { conflict  if dominant
eater { ichor exceptional } }`; the checker's Conflict leaves the dominance as a
disjunction until a `dominant` branch, which is exactly the guide's branch. "Imprint a
Magic helmet, Conflict, restore on failure" is `beast imprint … restore`.

### R8. Influence crafting: influenced exalt, Awakener's Orb, Harvest reforge, Orb of Dominance

**Item.** Hunter/Redeemer Vaal Regalia with Spell Crit (Hunter) and Aura Effect
(Redeemer) [guide, Maxroll 3.23, <https://maxroll.gg/poe/crafting/double-influence-crafting>].

1. Receiver: ilvl 86 Redeemer Vaal Regalia, Alteration until T1 Aura Effect as its only
   influence mod (or add influence with a Redeemer's Exalted Orb).
2. Donor: any Hunter body armour whose _only_ influence mod is Spell Crit.
3. Awakener's Orb on the donor, then the receiver: both influence mods guaranteed, the
   rest reforged.

**Elevation routes.** (a) Buy a one-influence item with the target plus a second influence
mod, Orb of Dominance (50% it elevates the right one). (b) Warlord Astral Plate ilvl 86:
Alteration until T1 all-res (1/161); bench "Suffixes Cannot Be Changed" and imprint;
Regal; Harvest Reforge Attack adds the only Attack-tagged influence mod; Annul a third
influence mod if any; Dominance; wrong elevation → restore imprint. (c) Hunter Assassin's
Garb: Harvest Reforge Attack until T1 Attack Crit + another Hunter mod, Annul to two
influence mods, Dominance [guide, same page]. Boots: Shaper CDR elevated (Dominance,
~2 tries) + Redeemer Onslaught elevated (Chaos spam <200 tries or Harvest Reforge
Physical 1/84 at 50 Vivid, then Dominance), Awakener's Orb to merge; then Wild Bristle
Matron lock + Harvest reforge Lightning / Critical for resist and Elusive; Veiled Exalted
Orb for the Movement Speed prefix; bench Life [guide, Maxroll 3.24,
<https://maxroll.gg/poe/crafting/cooldown-reduction-onslaught-elusive-influenced-boots>].
Elder RF helmet: Elder's Exalted Orb, Harvest reforge Fire until level 20 Burning Damage

- another Elder mod, Dominance; Shaper Trap/Mine helmet likewise; Awakener's Orb to
  transfer both elevated mods; then Matron lock, Veiled Chaos Orb, unveil +2 AoE gems
  [guide, Pohx, <https://pohx.net/crafts/advanced-elevated-ft-helmet/>].

**Harvest "reforge keep prefixes"** on influenced items: not offered (see R5).

**Hinekora.** Expressible: `exalt redeemer`, `awakener hunter`, `dominance`, `harvest
reforge "attack"`, `harvest reforge "influence"`, `harvest randomise`, `beast imprint /
restore`. The donor is reduced to its influence (`ROADMAP.md`), so "the donor's only
influence mod is Spell Crit" is not stated; the checker knows "one Hunter mod" without
which. The Dominance result "one elevated, tiers forgotten" matches the guide's
"50% the wrong one" branch, written `if has "spell crit elevated" {…} else { restore
restart }`. Elevated wording resolution depends on the data having a separate wording.

### R9. Fracturing Orb and fractured bases

**Rules used by guides.** Rare, ≥4 explicit mods, not already fractured, not influenced,
not synthesised; one random explicit mod is locked; the fractured value cannot be
Divined [surface doc §3 citing <https://www.poewiki.net/wiki/Fracturing_Orb#Mechanics>;
patch for Fractured Fossil]. Guides treat the fractured base as a purchase (R3, R6, R7) rather than
self-fracturing, because a self-fracture is 1-in-(mod count) to lock the right mod:
"buy one or self-fracture; if self-fracturing, the Allflame bench improves your odds"
(up to two previews for a Fracturing Orb) [guide, Pohx,
<https://pohx.net/crafts/advanced-fractured-2-amulet/>; guide 3.29,
<https://allthings.how/path-of-exile-3-29-how-allflame-crafting-and-ducats-work/>].
Self-fracture recipe as guides give it [unverified, aggregated from forum posts]:
Alteration/Regal/Exalt a four-mod item whose _other_ three mods are cheap filler of groups
you can live with, Fracturing Orb, then Annul the three fillers if the lock landed on the
target, else sell.

**Hinekora.** `fracture` is built with the "one of the current mods, unknown which"
semantics and `if fractured "<mod>"` narrows it, which is exactly the guide's branch.
The Allflame two-preview fracture is a choice over outcomes (deferred).

### R10. Recombinators (Kingsmarch, 3.25+, reworked 3.26)

**Rules** [wiki, <https://www.poewiki.net/wiki/Recombinator>]: two Magic/Rare items of one
class, both destroyed; Gold + Thaumaturgic Dust; **Predictable** mode: choose the affixes
to keep, shown a success chance, failure destroys both; **Unpredictable** mode: always an
item; prefixes and suffixes pooled separately; final counts drawn from the pool size
(1 → 41% none / 59% one; 2 → 67% one / 33% two; 3 → 40/50/10; 4 → 10/60/30; 5 → 43/57 for
2/3; 6 → 30/70); one base chosen 50/50 and its base type, influence, implicits, sockets,
quality and enchant kept; ilvl = ⌊(a+b)/2⌋+2 capped at max(a,b); fractured mods survive
only on a fractured base; influence / attribute-specific / base-specific mods ("NNN")
drop off an ineligible base; only **one exclusive** mod survives (essence-only, crafted,
veiled, aspect, incursion, breach, delve, elevated), and picking one deletes all other
exclusives from both pools _after_ the counts were fixed, which is why guides pad inputs
with bench crafts. Status quo: the wiki page itself says it needs updating for 3.26
predictable mode; forum threads in 3.27 report old "guaranteed transfer" tricks failing
[forum, <https://www.pathofexile.com/forum/view-thread/3876040>]; hence treat per-step
odds as [unverified].

**R10a. Three T1 prefixes on a Royal Axe** [guide, Maxroll 3.25,
<https://maxroll.gg/poe/resources/recombination-guide>]: roll ~1,000 Alts of single-prefix
Magic axes matching a regex; pair single-prefix bases into two-prefix bases (33%); pair
two-prefix bases into three-prefix (31%); ~36 bases on average.

**R10b. Two-mod merge for a +1 Fire / DoT multi sceptre** [guide, Pohx,
<https://pohx.net/crafts/recomb-sceptre/>]: alt-roll Void Sceptres for +1 Fire Gems and
for DoT multi (annul + Craicic Croaker imprint to isolate when a base has one good and
one bad mod); bench an exclusive "dummy" craft on each (double damage; elemental
penetration) so the exclusive rule protects the natural mods; Unpredictable recombine;
then multimod Fire DoT multi, Fire Damage/Ignite; Harvest enchant.

**R10c. +2 gems amulet** [guide, Pohx, <https://pohx.net/crafts/advanced-recomb-2-amulet/>]:
inputs (+1 all gems + crafted Fire/Chaos res) and (crafted −mana cost + DoT multi);
Unpredictable recombine; multimod with "Prefixes Cannot Be Changed" and a fire attack
mod; Harvest Augment Fire (adds +1 Fire Gems, may remove DoT multi → remove crafts and
recombine (+2 gems) with (DoT multi) again); bench Life; Allflame Hunter's Exalted Orb;
Fenumus + Black Mórrígan for Aspect of the Spider; anoint, catalyst.

**R10d. Three suffixes on a Shaper tower shield** [guide, Pohx,
<https://pohx.net/crafts/advanced-endgame-shield/>]: alt/aug Magic shields to one wanted
suffix each; craft Mana to lower the dust cost; 1s+1s → 2s (33%, reuse failures);
2s+2s → 3s (33%); Matron lock; Harvest reforge Life loop; Allflame-annul a prefix on a
~10% fill; Divine Life-on-block to 5%.

**R10e. Predictable isolation** [wiki, same page]: an item with T1 Merciless (weight 25)
and a T8 fire damage (weight 1200) recombined with a low-weight filler and "Merciless +
filler" selected gives ~50% to isolate Merciless alone; forum reports of 6.58% for a
10k gold / 27k dust predictable craft show how steeply the chance falls with rarer
selections [forum, <https://www.pathofexile.com/forum/view-thread/3925127>].

**R10f. Base transfer** [guide, Maxroll 3.25 above; guide 3.29 (currency seller,
unverified figures), <https://www.aoeah.com/news/4757--poe-329-recombinator-guide-modes-odds-unpredictable--predictable-recomb-tips>]:
move a Grasping Mail "Cythula" mod or a Rog Life+PDR pair onto a crafted Suppression
body; since 3.29, Kishara's Ducat at the Allflame bench isolates one mod onto four
single-mod copies first.

**Hinekora.** Out of scope (multi-item). Nothing of R10 is expressible except the
single-item preparation before and finishing after the merge.

### R11. Hinekora's Lock

**Rules** [wiki, <https://www.poewiki.net/wiki/Hinekora's_Lock>]: puts the item in a
foreseeing state; hovering with a currency shows that currency's exact result; every
copy of one currency shows the same result (Awakener's Orb excepted, donor-dependent);
applying any currency performs the previewed result and clears the state; does not work
with the bench, Horticrafting, beastcrafting or the Recombinator; the same state is
applied to a Magic item by beastcraft (Craicic Croaker + The Black Mórrígan).

**R11a. Regal under a Lock** [guide, Pohx,
<https://pohx.net/crafts/advanced-fractured-2-amulet/>]: fractured T1 DoT multi amulet,
alt/aug to +1 all gems; beastcraft the Lock (~3.6 + 6 Divine of beasts); preview Regal
and Foulborn Regal; if either shows a suffix, apply it; else spend the preview with a
Blessed Orb and re-lock. Then "Prefixes Cannot Be Changed", scour the suffix, multimod,
Harvest Augment Fire, Veiled Exalted Orb loop, Aspect, finish.

**R11b. Awakener's Orb under a Lock** [guide, Pohx,
<https://pohx.net/crafts/advanced-minmax-recomb-rf-helmet/>]: Lock the Elder Giantslayer
helmet; preview the Awakener's Orb with the chosen Shaper donor; accept if ≤2 prefixes and
≤2 suffixes, else overwrite the Lock with an Armourer's Scrap and re-lock.

**R11c. Finishing a mirror-tier item** [unverified; forum consensus,
<https://www.pathofexile.com/forum/view-thread/3827535>]: Lock, hover the Exalted Orb; if
the slam is wrong, consume the preview with a harmless currency (re-anoint on jewellery,
Armourer's Scrap, Blessed Orb) and Lock again; "60+ Locks for a specific line".

**Hinekora.** Deferred (Q34). The semantics guides use is "apply the operation only in
the paths where its outcome satisfies P, else do nothing" — a filtered transfer, which
the checker could express as the join of the narrowed after-state and the unchanged
state. Today the nearest spelling, `regal  if prefixCount == 2 { restart }`, spends the
Regal in the model, which over-approximates and cannot represent "the item is unchanged".

### R12. Allflame crafting (3.29) and Ducats

**Rules** [wiki, <https://www.poewiki.net/wiki/Allflame_crafting>;
<https://www.poewiki.net/wiki/Kishara's_Ducat>]: at Vesper's console below decks on The
Sovereign; simulates most mod-changing currency 1–4 times independently (cap 2 until
upgrades are turned in, 3 after one, 4 after three); costs Dead Man's Sulphur scaling
with item level and currency value (Chart 1–2k, Voyage 10–20k; "Very High" crafts

> 100k); each attempt adds Intangibility %, which is the chance later attempts return a
> single outcome; cannot use Vaal Orb, Mirror / Reflecting Mist, socket or quality currency,
> Tainted currency, Embers/Ichors; cannot touch corrupted, mirrored or socketed items; the
> output is a new item (no imprint). Ducats are Allflame-only: **Kishara's** (4 copies,
> each one random mod of a Rare, not on fractured items, 8–12% Intangibility), The
> Genteel's (change an attribute mod's attribute), Brinehook's (random Pantheon Aspect),
> Cyaxan's (reforge with an "Infamous" mod), Merrick's (add a mod to a Rare Abyss Jewel and
> corrupt), Rotmother's (Trap/Mine mod on a belt), Tzamoto's (50% remove all Intangibility /
> 50% destroy), Katakohi's, Telesia's, The Changeling's [guide 3.29,
> <https://allthings.how/path-of-exile-3-29-how-allflame-crafting-and-ducats-work/>; the
> Ducat list beyond Kishara's is [unverified] against the cache].

**How guides use it** [guide, Pohx pages above; guide 3.29 allthings.how]: (1) "Allflame
Exalt" on a four-mod item before the last bench craft: four slams, keep the best; (2)
"Allflame annul" to open a side without losing the wanted mod; (3) Fracturing Orb with
two previews; (4) Hunter's Exalted Orb with several previews to pick the influence mod;
(5) Regal/Exalt on jewels (cheap Sulphur, four outcomes); (6) Kishara's Ducat to isolate
one mod as a recombinator input; (7) a +2 gems amulet route "Allflame Regal + Harvest"
[guide 3.29, currency seller, unverified,
<https://www.mmogah.com/news/poe/poe-329-allflame-crafting-guide-how-to-craft-a-2-gem-level-amulet>].

**Hinekora.** Deferred (choice over outcomes). Note the shape: the same operation's
transfer function, sampled k times, with the author choosing by a predicate; the
abstract result is the narrowed after-state _if_ some copy satisfies P, else the
un-narrowed after-state (Intangibility makes k = 1 a possibility on every attempt, so
the "else" branch is never impossible).

### R13. Tainted currency on corrupted items

**Rules** [wiki, surface doc §3; guide, Maxroll corruption,
<https://maxroll.gg/poe/resources/corruption>]: Vaal Orb has four outcomes (implicit,
nothing, reroll to a random Rare, and until 3.29 white sockets); Locus of Corruption adds
destroy / two implicits / influenced Rare; afterwards only Tainted currency applies:
Tainted Chaos (reforge or strip), Tainted Exalted (add or remove a mod), Tainted Divine
Teardrop (tiers up or down), Tainted Fusing / Jeweller (links / sockets up or down),
Tainted Blessing, Tainted Catalyst, Tainted Mythic (unique or destroyed).

**Practice.** No step-by-step guide was found that _plans_ a rare around Tainted
currency; it appears as salvage ("the Vaal bricked my helmet into a 6-mod Rare: Tainted
Exalt / Teardrop to see if it's wearable") and for socket/link repair after a corruption
[guide, Maxroll corruption above]. Thane Jorgin's Betrayal talisman craft used Tainted
currency until 3.29 and now offers regular currency [patch].

**Hinekora.** Built: `vaal`, `locus`, `tainted chaos`, `tainted exalt`, `tainted divine`,
and `corrupted` / `influenced` branches to pick the outcome. Sockets and links are out.

### R14. Rog (Expedition)

Rog sells rares and offers a chain of crafts (reroll prefixes/suffixes, add a mod, remove
the lowest-level mod, reroll values, corrupt) for artifacts, with a cap on repeats; he is
still in the game in 3.29 (the Incubator offer was removed) and is also the Kingsmarch
disenchanter who produces the Recombinator's dust [wiki, <https://www.poewiki.net/wiki/Rog>;
patch]. Guides use Rog bases as recombinator donors for Life + Physical Damage Reduction
("Rog bases carry many NNN mods") [guide, Maxroll 3.25 recombination above].

**Hinekora.** Out of scope by decision; noted here only because Rog items feed R10.

### R15. The 3.29 bench rerolls

"Reroll 3 random Modifiers on a Rare Item (3 Chaos)" and "Reroll a random Modifier
(8 Chaos)" [patch; wiki Crafting Bench]. Guide usage so far is thin: a decision rule
("three or more weak mods → the 3-for-3; one weak mod → the 8-for-1; do not spend 8 Chaos
on an item with nothing worth keeping") with no interaction rules for metamods or
fractured mods stated [guide 3.29, currency seller, unverified,
<https://www.mulefactory.com/wiki_path_of_exile_poe_3_29_crafting_bench_changes_explained/>].
None of the Pohx Allflame-league crafts uses them. Whether the rerolled mods keep their
side and whether a metamod protects its side is the open probe Q7.

**Hinekora.** Deferred (Q7).

### R16. Mirror-tier finishing

Divine Orb for values ("do not over-divine; Divine Life-on-block from 3–4% to 5%"), the
Exalt-slam decision only after blocking ("bench Armour then Exalt; bench Life then Exalt
so the slam cannot be low Life"), Hinekora's Lock for the last slam (R11c), Harvest
weapon enchant (5,000 Primal: "1% Attack Speed per 8% Quality"), eldritch implicits to
Perfect/Exceptional through the Conflict loop, catalysts to 20%, anoint, and Allflame
Exalt for four previews [guide, Pohx shield/boots/amulet above; Maxroll bow / wand /
eldritch implicits, <https://maxroll.gg/poe/crafting/eldritch-implicits>].

**Hinekora.** The blocked Exalt is expressible and the checker proves the block
(`bench "maximum life"  exalt`, Life cannot be the slam). Divine, enchant, quality,
catalysts, anoints are out; the Lock and Allflame are deferred.

### R17. Beastcraft helpers that appear in nearly every advanced route

- **Wild Bristle Matron** ("Add a crafted Meta-modifier", ~100c in Allflame league):
  used instead of 2 Divine for a lock, forced by filling the other side [guide, Pohx
  everywhere; Maxroll CDR boots].
- **Farric Lynx Alpha** (add suffix, remove prefix, ~2c) and **Farric Wolf Alpha** (add
  prefix, remove suffix, ~4c): rearrange a side instead of annulling [guide, Pohx
  <https://pohx.net/crafts/elder-rf-helmet/>, <https://pohx.net/crafts/endgame-recomb-amulet/>].
- **Craicic Chimeral** (imprint a Magic item) and **Craicic Croaker + The Black
  Mórrígan** (Hinekora's Lock on a Magic item, ~3.6 + 6 Divine) [guide, Pohx above].
- **Fenumus** (Aspect of the Spider, ~106c), used with the Lock to see the slot it lands
  in [guide, Pohx above].
- **Fenumal Plagued Arachnid** split: removed in 3.29 [patch].

**Hinekora.** `beast metamod`, `beast add suffix`, `beast add prefix`, `beast imprint`,
`beast aspect "spider"` are built. The Lock beast pair is R11.

### R18. Cluster jewels

**Routes.** (a) Harvest reforge by tag on a Large cluster of the right enchant: "Reforge
Caster on a Projectile medium until Repeater, keep reforging until Streamlined too"
[guide, Maxroll Harvest above]; "ilvl 68–74 8-passive Lightning Large: reforge Life /
Lightning / Cold until Sadist + Doryani's Lesson + Stormrider; with 2 of 3, Exalt for the
third" [guide, poe-vault 2022, <https://www.poe-vault.com/guides/lightning-cluster-jewels>].
(b) Alt/Aug for the two "Added Small Passive Skills grant" mods on a Magic Large
(~2,100 tries), Craicic Chimeral imprint, Regal; Regal a suffix → Exalt; bad prefix →
Farric Lynx Alpha / Annul and restore on loss [guide, Maxroll 3.24,
<https://maxroll.gg/poe/crafting/shockwave-strength-stack-slayer-cluster-jewel>].
(c) Alt until one notable, Aug, Regal regardless (SSF) [guide, poe-vault 2025,
<https://poe-vault.com/guides/cluster-jewel-guide>].

**Hinekora.** Partially. The currencies are built, but a cluster jewel's mod pool is
decided by its _enchantment_ (passive count and "Added Small Passive Skills grant X"),
which the item block cannot state, and notables are mods the catalog's base-level pool
narrowing cannot see without that enchant. This is a data/model gap (the enchant as part
of the base identity), not a control-flow gap.

### R19. Rare jewels and Abyss jewels

Guides treat base jewels as alt/aug/regal items (R1) or Harvest reforges ("reforge Life /
Fire / Chaos on a Crimson Jewel until two wanted mods; crafting your own is not worth
it, buy") [guide, Pohx, <https://pohx.net/crafts/jewels/>; Maxroll alt/regal above]. For
Abyss jewels no dedicated 3.24+ guide was found; build guides say "alt-spam flat Life +
one damage/onslaught mod, Regal, Exalt if cheap" [unverified]. 3.29 adds Merrick's Ducat
(add a mod to a Rare Abyss Jewel and corrupt it) [guide 3.29 allthings.how, unverified].

**Hinekora.** Expressible for base jewels as R1. Abyss jewel bases depend on the catalog.

### R20. Flasks

Flasks are Normal/Magic only (one prefix, one suffix): Glassblower's to 20% while white,
Transmute, Alteration until the prefix (Seething/Bubbling on Life; charge-on-hit or
"effect" on utility) with an empty suffix, then Augmentation or the Blood Altar
beastcraft for the suffix (Staunching, of the Walrus, of the Owl…); Instilling Orb and
Enkindling Orb add enchants; Harvest adds decaying flask enchants
[guide, poe-vault 2025, <https://www.poe-vault.com/guides/ultimate-flask-crafting-guide>;
guide, Maxroll alt/regal above].

**Hinekora.** The item block accepts a flask at `normal`/`magic` and rejects `rare` per
the wiki, so `transmute  until has "charges when hit" and suffixCount == 0 { alteration }
augment` type-checks if the flask mod pool is in the data; quality, instilling,
enkindling, Harvest flask enchants and the beast suffix recipes are out (`operations.md`
§3.6 "flask recipes out").

---

## 3. Per-slot norms

What guides aim for on each slot and the route they recommend. "Route" names the
opener → middle → finish as the collected guides give them; tiers are the guide's.

| Slot                                                | Typical target mods                                                                                                                                                                                                        | Typical route                                                                                                                                                                                                                                                 | Sources                                                                               |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| **Physical attack weapon** (axe, mace, claw, sword) | T1 % Physical (Merciless) + flat Phys (Flaring) + hybrid Phys/Accuracy (Emperor's); suffixes Attack Speed, Crit Multi or "Hits can't be Evaded" (bench), Double Damage (unveil)                                            | fractured prefix base or recombinate single-prefix Alt bases (33%/31%) into triple prefix; "Prefixes Cannot Be Changed" + Veiled Exalted/Chaos Orb for a veiled suffix; multimod                                                                              | Maxroll recombination (R10a); pohx/forum axe notes [unverified]; Maxroll metacrafting |
| **Elemental attack weapon** (bow, claw)             | three flat elemental prefixes or +2 Bow Gems / +1 Socketed Gems; suffixes Attack Speed, Fire DoT multi, Crit                                                                                                               | Deafening Wrath/Anger/Hatred essence spam on a fractured suffix base; Cannot Roll Attack + Exalt for +1 Socketed; prefix lock + Veiled Exalted Orb + blocked unveil for Attack Speed; Harvest quality enchant                                                 | Maxroll bow; Maxroll essence guide                                                    |
| **Caster weapon** (wand, sceptre, rune dagger)      | +1 all Spell Gems (fractured or recombined), +1 Fire/Phys/Minion gems, Spell Damage or DoT multi T1/T2; suffixes Cast Speed, Spell Crit, Trigger (bench), Attack Speed enchant                                             | fractured +1 base + Deafening Woe/Dread/Misery; four-fossil Convoking Wand; recombinate (+1 fire) + (DoT multi); Suffixes Cannot Be Changed + Harvest reforge Speed; multimod                                                                                 | Maxroll wand ×2, sceptre; poe-vault minion wand; Pohx recomb sceptre                  |
| **Body armour**                                     | T1 Life (or % ES / flat ES), Spell Suppression (dex bases), + resistances or Chaos res; % Armour/Evasion; veiled % Life or ailment avoid; "+1 Socketed Gems" (Hunter), explode / Suppression (influence)                   | fractured Suppression or Life base + Essence (Greed/Envy/Loathing); Dense fossils for 1k Armour starter; eldritch Exalt/Annul with Life/Mana blocks on ES chests; Suffixes Cannot Be Changed + Veiled Exalted Orb; Awakener's Orb for double influence        | Maxroll eldritch, veiled, double influence; Pohx starter body                         |
| **Helmet**                                          | T1 Life, resistances / Chaos res, Suppression; Elder "Socketed Gems supported by L20 Burning Damage / Conc Effect" (essence of Horror + Exalt); +3 Minion Gems; Reservation Efficiency implicit                            | Essence of Horror on Elder base, bench Mana block, Exalt (1/22), suffix lock + scour on miss; Grand Ichor + Conflict loop for implicits; Deafening Greed for +3 minion gems; Eldritch Chaos for suffixes                                                      | Maxroll metacrafting; forum skeleton mage helm; Pohx elder RF helmet                  |
| **Gloves**                                          | T1 Life, T1 resistances, Dex/Chaos res; veiled "Attack & Cast Speed while Focused" / culling; Exarch "Strike Skills +targets", Eater Suppression implicits                                                                 | fractured Suppression base + Deafening Greed; Lesser Ichor + Eldritch Annul to make room; Suffixes Cannot Be Changed + Veiled Chaos Orb; Conflict loop                                                                                                        | Maxroll gloves; Pohx gloves/mittens                                                   |
| **Boots**                                           | T1 Life, 30%+ Movement Speed (veiled 25–30% + Onslaught/chill avoid), T1 resistances or Chaos res, Suppression; Exarch "+1 max fire res" / "Action Speed", Eater "regen" implicits; Elevated CDR + Onslaught on influenced | fractured Suppression/Life base + Deafening Envy/Torment; Ember/Ichor + Eldritch Annul to open; Suffixes Cannot Be Changed + Veiled Chaos/Exalted Orb; bench Mana block; unveil Movement Speed; bench Life; Embers/Ichors                                     | Maxroll boots ×3; Pohx boots                                                          |
| **Belt**                                            | T1 flat Life + % Life (Pristine), Chaos res + ele res (unveil double-res), Str/Dex; Life Regen / Strength T1 (Sorrow); Stygian abyss socket; Fertile/Intrinsic catalysts first                                             | Pristine fossils on Hunter Stygian (1/46); Prefixes Cannot Be Changed + Veiled Exalted Orb + Str/Dex blocker + unveil; Deafening Sorrow on synthesised belt + Farric Lynx + Exalt; Matron lock + Veiled Orb + Armour/ES blocker for Life unveil               | Maxroll Hunter belt, Omni belt; Pohx belt                                             |
| **Rings**                                           | T1 Life, two T1 resistances or Chaos res, Dex/Str/Int, −mana cost (bench, changed 3.29), Minion/Fire damage; ES rings: flat ES + % ES (Crusader)                                                                           | fractured Life/res/Dex base + Screaming Anger/Spite essence; Suffixes Cannot Be Changed + Harvest reforge Life/Defence loop; bench Life / dual res; catalysts                                                                                                 | Pohx rings; poe-vault minion ring; haplo 3.26 ring [unverified]                       |
| **Amulet**                                          | +1 all Skill Gems (+1 Fire/Phys/Minion gems via Harvest Augment), T1 DoT multi (fractured), Life, Chaos res, Str/Dex; anoint, catalyst                                                                                     | Alt +1 gems → prefix lock → Regal (Lock or imprint) → multimod → Harvest Augment tag → Veiled Exalted Orb → unveil; or recombine (+1 fire) with (DoT multi); Screaming Anger essence starter                                                                  | Maxroll amulet; Pohx amulets ×3                                                       |
| **Shield**                                          | T1 Life, Life on Block 5% (Shaper), Suppression (spiked), Block %, +1 Fire Gems (Harvest Augment Fire), fractured +2% max res, Reservation Efficiency; "Double Damage while Focused" unveil                                | fractured base + Deafening Greed (1/190); Cannot Roll Caster + Annul to open; Prefixes Cannot Be Changed + Harvest Augment Fire; Veiled Exalted Orb + Str/Dex blocker; or Pristine fossils / Harvest reforge Life for Life-on-block; recombine three suffixes | Maxroll shield; Pohx shields ×2                                                       |
| **Quiver**                                          | Fire DoT multi with Attacks (essence of Doubt), Life, Bow Damage, Hunter Movement Speed; Attack Speed bench                                                                                                                | Hunter base ilvl 86 + Screaming Doubt (1/36); Annul to two suffixes; Cannot Roll Attack + 3× Exalt; bench Attack Speed                                                                                                                                        | Maxroll quiver                                                                        |
| **Rare jewels**                                     | % Life, DoT multi / Attack Speed / Crit multi, resistances                                                                                                                                                                 | Alt/Aug/Regal/Exalt (R1); Harvest reforge Life/Fire/Chaos                                                                                                                                                                                                     | Maxroll alt/regal; Pohx jewels                                                        |
| **Abyss jewels**                                    | flat Life, Onslaught/phasing on kill, flat damage, resistances                                                                                                                                                             | Alt/Regal; 3.29 Merrick's Ducat [unverified]                                                                                                                                                                                                                  | build guides [unverified]                                                             |
| **Cluster jewels**                                  | 2–3 notables of the enchant's pool; "Added Small Passive Skills grant" mods                                                                                                                                                | Harvest reforge by tag; Alt/Aug + imprint + Regal + Exalt/Lynx repair                                                                                                                                                                                         | Maxroll cluster; poe-vault clusters                                                   |
| **Flasks**                                          | Seething/Bubbling Life; utility: charge-on-hit / effect prefix, immunity suffixes; Instilling/Enkindling                                                                                                                   | Transmute, Alt, Aug / Blood Altar, Glassblower first                                                                                                                                                                                                          | poe-vault flasks; Maxroll alt/regal                                                   |

---

## 4. Gaps: what the recipes need that the surface lacks

Legend: **yes** = the surface writes it and the checker proves it; **partial** = the
operation exists but a guide's step or stop condition cannot be stated exactly; **no** =
not expressible. "Kind" says whether closing it is a language construct, data the
catalog lacks, or a deliberate scope decision.

| #   | Recipe step (where it appears)                                                                                                            | Today   | Missing construct, in plain words                                                                                                                                                                                                                                                      | Kind                              |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| G1  | "Repeat until X, expect ~N tries / ~22 Divine" (every guide)                                                                              | partial | A cost/probability notion: spawn weights, essence/fossil/Harvest biases, expected attempts per loop, price per currency. The loop checks; the expectation is silent.                                                                                                                   | deferred by design (`ROADMAP.md`) |
| G2  | Hinekora's Lock: "preview the Regal; apply only if it adds a suffix, else consume the preview and re-lock" (R11)                          | no      | A conditional application: run an operation only on the outcomes that satisfy a predicate, leaving the item unchanged otherwise (join of the narrowed after-state and the before-state), and flag a condition the operation can never produce.                                         | deferred (Q34)                    |
| G3  | Allflame bench: "four previews of an Exalt / annul / Fracturing Orb / Hunter Exalt, keep one" (R12)                                       | no      | Choice over k independent outcomes of one operation, with k possibly 1 (Intangibility), selected by a predicate. Same family as G2.                                                                                                                                                    | deferred by design                |
| G4  | Recombinator: "merge (+1 fire) with (DoT multi)", "1s+1s → 2s", predictable isolation (R10)                                               | no      | A two-item operation with a second item block (or a named second item), the pooled-mods transfer, the exclusive-mod rule, the base 50/50, ilvl formula; both inputs destroyed.                                                                                                         | deferred by design                |
| G5  | Kishara's Ducat: "split into four one-mod copies, keep one" (R12)                                                                         | no      | Multi-item plus choice (G3 + G4).                                                                                                                                                                                                                                                      | deferred by design                |
| G6  | "Divine the Life roll to 5%", "Life ≥ 90", "a 20%+ DoT multi roll", "Str ≥ 45", "T2+ Life ≥ 110" (R2, R16, Pohx targets)                  | partial | Mod _value_ predicates (`has "maximum life" >= 90`) and the Divine Orb; the checker tracks tiers and roll spans, so a value threshold that coincides with a tier boundary is writable as `t<n>`, anything finer is not.                                                                | language + out (Divine)           |
| G7  | Glassblower's / Perfect Fossil quality, catalysts, anoints (Phase 0 and 3)                                                                | no      | Quality / catalyst / anoint on the item. Guides treat them as fixed costs, not branches; nothing in the mod checking depends on them except catalyst _type_.                                                                                                                           | out of scope                      |
| G8  | Sockets, links, colours; Vaal white-socket outcome (removed 3.29); Tainted Fusing/Jeweller                                                | no      | Socket state. Nothing a guide's mod logic depends on.                                                                                                                                                                                                                                  | out of scope                      |
| G9  | Harvest weapon enchant, Instilling / Enkindling, flask Harvest enchants, labyrinth enchants, Tempering / Tailoring Orbs                   | no      | Enchantment slot. Appears only as a finishing step.                                                                                                                                                                                                                                    | out of scope                      |
| G10 | Cluster jewel notables ("reforge Caster until Repeater", "35% effect + Str small passives") (R18)                                         | partial | The cluster enchant (passive count, "Added Small Passive Skills grant X") as part of the base identity so the notable pool resolves; the operations are present.                                                                                                                       | data / item block field           |
| G11 | 3.29 bench "Reroll 3 random modifiers" / "Reroll a random modifier" (R15)                                                                 | no      | A library entry; semantics pending the probe (count preserved? side preserved? metamods respected?).                                                                                                                                                                                   | deferred (Q7)                     |
| G12 | Harvest "reforge, more/less likely"                                                                                                       | no      | The two rows of the ledger marked deferred; guides use them rarely (Maxroll lists them, none of the collected recipes uses them).                                                                                                                                                      | deferred (rarely needed)          |
| G13 | Aisling's "add a veiled modifier, remove a random modifier" bench (R6)                                                                    | partial | A name for the Betrayal bench; `veiled exalt` has the same effect shape. Cosmetic unless the bench's rules differ (it is not a currency, so Hinekora's Lock does not preview it).                                                                                                      | naming / data                     |
| G14 | "Buy a rare with +1 gems, Annul to three mods, Fenumal split to Magic" (R2, old ring guides)                                              | no      | The split recipe was removed in 3.29; nothing to build. Guides written before 3.29 need the step rewritten.                                                                                                                                                                            | retired from the game             |
| G15 | Awakener's Orb "donor's only influence mod is Spell Crit" (R8)                                                                            | partial | The donor is reduced to its influence, so the guaranteed carried mod is "one Hunter mod", not the named one; a donor item block (or a `donor { … }` clause) would make the named mod provable.                                                                                         | deferred (multi-item)             |
| G16 | Rog crafts as a base source; Rog bases as recombinator donors (R14)                                                                       | no      | Out by decision; only matters as the origin of an item block's starting mods, which the item block already states.                                                                                                                                                                     | out of scope                      |
| G17 | Orb of Chance / "reroll the rarity" openers, Ancient Orb                                                                                  | no      | Out by decision (Q15).                                                                                                                                                                                                                                                                 | out of scope                      |
| G18 | "Any of fire/cold/lightning res" then "Harvest-swap to fire later" (R7, Pohx)                                                             | yes     | `def anyEleRes(t) = …` plus `harvest change "cold res" "fire res"`; the surface covers it.                                                                                                                                                                                             | —                                 |
| G19 | "If Jun offers nothing wanted, re-lock, scour, repeat" (R6)                                                                               | yes     | `unveil` bare then `if not has … { bench …  scour  restart }`; the three-option pool and bench blocking are modelled.                                                                                                                                                                  | —                                 |
| G20 | Fractured-base purchases, `fractured "random"` after a self-fracture, `if fractured "<mod>"` (R9)                                         | yes     | Built.                                                                                                                                                                                                                                                                                 | —                                 |
| G21 | Orb of Conflict loops with Exceptional Ichor refresh, `dominant` branches (R7)                                                            | yes     | Built.                                                                                                                                                                                                                                                                                 | —                                 |
| G22 | Wild Bristle Matron forced to one metamod by filling the other side (R17)                                                                 | yes     | `beast metamod` yields the disjunction; filling the other side first makes the checker's "some metamod must fit on every path" collapse to the one that fits, and `if has "suffixes cannot be changed"` narrows. Worth an example to confirm the collapse is proven, not just allowed. | — (test)                          |
| G23 | "Craft Mana to lower the recombination dust cost", "bench an exclusive dummy craft so the exclusive rule protects the natural mods" (R10) | no      | Depends on G4.                                                                                                                                                                                                                                                                         | deferred                          |
| G24 | English "doesn't have" negation, named reusable techniques ("the suffix-lock-scour reset")                                                | partial | `not has` and `def` exist; sugar deferred.                                                                                                                                                                                                                                             | deferred by design                |
| G25 | Rare flasks                                                                                                                               | —       | Flasks cannot be Rare; the item block already rejects it. Magic flask rolling is expressible if the flask mod pool is in the catalog (unchecked here).                                                                                                                                 | data (check catalog)              |
| G26 | Abyss jewel bases, talisman bases, Cogwork/Geodesic experimented rings in the catalog                                                     | partial | Catalog coverage to confirm; the experimented rings carry an implicit that widens the pool beyond the base's own rows.                                                                                                                                                                 | data (check catalog)              |

**Language gaps proper** (new constructs): G2/G3 (conditional application and choice
over outcomes, one mechanism), G4/G5/G15 (a second item), G6 (value predicates),
G1 (cost). **Data gaps**: G10 (cluster enchant on the item block), G13 (Aisling name),
G25/G26 (catalog coverage). **Deliberately out**: G7, G8, G9, G16, G17. **Retired**:
G14. **Pending a probe**: G11.

**Priority as the recipes weight it.** By frequency in the collected guides: G1 appears
in every recipe (always as commentary, never as control flow, so it does not block
checking a guide, only annotating it); G6 appears in most endgame targets ("20%+ DoT
multi", "110+ Life") and is the most common reason a guide's stop condition cannot be
written exactly; G2/G3 appear in every Pohx advanced craft and in 3.29 guides
generally; G4 appears in every weapon and amulet endgame route since 3.25 and in all
Pohx "recomb" crafts; G10 blocks every cluster recipe; G11 appears in none of the
collected recipes yet.

---

## 5. Sources consulted

Wiki cache (rendered 2026-11-08): Recombinator, Hinekora's Lock, Allflame crafting,
Kishara's Ducat, Vesper, Veiled Orb (disambiguation), Rog, Crafting Bench; cargo `items`
rows for Veiled Chaos Orb (3.26.0) and Veiled Exalted Orb (3.14.0).

Official: 3.29.0 patch notes <https://www.pathofexile.com/forum/view-thread/3985332>;
3.29.1 preview <https://www.pathofexile.com/forum/view-thread/3991633>.

Maxroll (PoE1 crafting, 3.22–3.25 pages): metacrafting, alterations-augments-regals,
harvest-crafting-guide, fossils-resonators, eldritch-crafting, eldritch-implicits,
veiled-crafting, double-influence-crafting, recombination-guide, corruption,
crafting-gloves-for-boneshatter-builds, crafting-boots-for-ignite-builds,
crafting-a-bow-for-explosive-arrow-ballista-elementalist,
crafting-a-quiver-for-explosive-arrow-ballista,
crafting-a-detonate-dead-oscillating-sceptre, corrupting-fever-wand,
corrupting-fever-amulet, fireball-deadeye-wand, hunter-stygian-belt,
omni-venom-gyre-belt, explosive-trap-saboteur-shield, poison-spark-boots,
cooldown-reduction-onslaught-elusive-influenced-boots,
shockwave-strength-stack-slayer-cluster-jewel, essence-league-guide (all under
<https://maxroll.gg/poe/crafting/> or <https://maxroll.gg/poe/resources/>).

Pohx (Righteous Fire, costs from the Allflame league, 3.29): <https://pohx.net/crafts/>
and the pages recomb-sceptre, starter-body-armor, elder-rf-helmet, gloves, boots,
shield, rings, amulet, belt, jewels, endgame-recomb-amulet, advanced-fractured-2-amulet,
advanced-recomb-2-amulet, advanced-endgame-boots, advanced-endgame-shield,
advanced-elevated-ft-helmet, advanced-double-veiled-mittens,
advanced-minmax-recomb-rf-helmet.

poe-vault: minion-damage-ring-crafting-guide (2023), crafting-2-generic-minion-wand
(GhazzyTV, 2024), lightning-cluster-jewels (2022), cluster-jewel-guide (2025),
ultimate-flask-crafting-guide (2025), crafting-basics (2025), early-endgame (2025).

Forum: skeleton mage helm <https://www.pathofexile.com/forum/view-thread/3241580>;
recombinator threads 3586167, 3837881, 3876040, 3925127; Hinekora's Lock thread 3827535.

Weak sources, used only with [unverified]: aoeah.com (3.29 recombinator and Allflame
articles), allthings.how (Allflame/Ducats), mulefactory.com (bench rerolls),
mmogah.com (+2 amulet), haplo-gaming-chef blog (3.26/3.27 crafts), timesaver.gg.

Not reachable from this environment (403/404): mobalytics.gg guides (Lolcohol necrotic
armour, mastert explode chest, ES/EV body, KB helm), pobarchives.com crafts, reddit.com
(the 3.25 recombinator guide is summarised via the wiki page that cites it), rpgstash.com,
craftofexile.com guide pages (its 3.29 data update is live but the guides section is
empty).
