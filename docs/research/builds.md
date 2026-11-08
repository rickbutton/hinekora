# Popular 3.29 builds and the rare items they wear

> Evidence for the research spike (see `README.md`). Everything here is read off Path of
> Building item text; nothing is a game rule. Raw per-build dumps live in `data/`
> (`data/_index.json` lists them); the poe.ninja ladder snapshots used for popularity are
> `data/ninja-*.json`.

## Method

- **Build selection.** The poe.ninja softcore trade ladder for 3.29 Curse of the Allflame
  (snapshot 2026-11-08, 124,358 characters; `data/ninja-build-index.json`,
  `data/ninja-top-characters-allflame.json`) gave the class/skill shares. Guides were then
  found through poebuilds.cc (a guide aggregator with view counts), Maxroll's 3.29 guide
  list and the creators' own links. 47 builds were kept: every family the spike asked for is
  present, weighted toward what the ladder actually plays (Winter Orb, Righteous Fire,
  Spectres, Ethereal Knives, Cyclone, Flicker Strike, strength stacking, Death Aura, totems,
  SRS). Where a guide ships several item sets the **endgame** set was taken (named in the
  table); leveling sets were ignored.
- **Item extraction.** Each guide's Path of Building code (pobb.in `/raw`, Maxroll's planner
  API, poe.ninja `/pob/raw/`) was decoded (base64 + zlib) and the `<Item>` text of the chosen
  `<ItemSet>` plus the active tree's socketed jewels was parsed into `data/<slug>.json`:
  base, rarity, item level when PoB has it, influence / fractured / corrupted flags,
  implicits (eldritch implicits, enchants and anoints included), explicit lines with PoB's
  `{crafted}` / `{fractured}` / `{custom}` markers, and crafted/fractured counts. Uniques are
  recorded by name only. See Caveats for why the running PoB app's `get_items` was not used.
- **Vocabulary.** "Bench-crafted" means a line PoB marks `{crafted}` (a crafting-bench or
  unveiled craft); "custom" is a line the guide author typed in; "eldritch" means an item
  carrying Searing Exarch and Eater of Worlds implicits; "influenced" means Shaper, Elder or
  a conqueror. Counts of the form "N/M" are rare items over filled slots.

## 1. Builds covered

Popularity: `ninja` = share of the 3.29 softcore trade ladder for that class/skill pair
(or the skill over all classes), `views` = poebuilds.cc view count of the guide video,
`Maxroll` = a Maxroll guide (no view count). Rare/Unique counts the ten equipment slots
(two weapons, body, helmet, gloves, boots, belt, amulet, two rings); the rest are empty,
magic or normal.

| #   | Build (data file)                                                                             | Ascendancy   | Main skill                       | Source                                                           | Popularity                                                | Item set used                                       | Rare / Unique |
| --- | --------------------------------------------------------------------------------------------- | ------------ | -------------------------------- | ---------------------------------------------------------------- | --------------------------------------------------------- | --------------------------------------------------- | ------------- |
| 1   | Winter Orb Elementalist, Fubgun (`winter-orb-elementalist-fubgun`)                            | Elementalist | Winter Orb                       | pobb.in/4R1ZDnZMe5kz                                             | ninja 2.8%; 269k views                                    | Endgame Optional                                    | 7 / 3         |
| 2   | Winter Orb Elementalist, Maxroll (`winter-orb-elementalist-maxroll`)                          | Elementalist | Winter Orb                       | maxroll.gg winter-orb-elementalist-league-starter                | ninja 2.8%; Maxroll                                       | Endgame                                             | 8 / 2         |
| 3   | Winter Orb power-charge Occultist, Fubgun (`winter-orb-occultist-fubgun`)                     | Occultist    | Winter Orb                       | pobb.in/MwTyQN55T8tE                                             | ninja 4.6% (2nd pair on ladder); 126k                     | Pcharge Stack                                       | 2 / 8         |
| 4   | Righteous Fire Chieftain, Pohx (`rf-chieftain-pohx`)                                          | Chieftain    | Righteous Fire                   | pobb.in/7vZ0sp0OUsV-                                             | ninja 4.6% (1st pair); 134k                               | Lvl 90+ Annihilation Approach                       | 7 / 3         |
| 5   | Forged Frostbearer Spectres, Maxroll (`spectre-necromancer-maxroll`)                          | Necromancer  | Raise Spectre                    | maxroll.gg forged-frostbearer-spectre-necromancer-league-starter | ninja 2.3%; Maxroll                                       | Late Dark Monarch                                   | 7 / 3         |
| 6   | Zombie Necromancer, Rusei (`zombie-necromancer-rusei`)                                        | Necromancer  | Raise Zombie                     | pobb.in/vhxVREeYrcoc                                             | Necromancer 7.7% of ladder; 27k                           | Character                                           | 3 / 7         |
| 7   | EK Ignite herald stacker, mbXtreme (`ek-ignite-elementalist-mbx`)                             | Elementalist | Ethereal Knives (ignite)         | pobb.in/rVXqO8aQ_KRN                                             | ninja 2.0%; 73k                                           | only set                                            | 3 / 7         |
| 8   | Cyclone Shockwave Slayer, Sanavixx (`cyclone-slayer-sanavixx`)                                | Slayer       | Cyclone of Tumult                | pobb.in/4txxyICBSfk8                                             | ninja 1.9%; 64k                                           | Lvl 100 (HIGH Budget)                               | 7 / 2         |
| 9   | Echoforge Cyclone Slayer, Mathil (`cyclone-slayer-mathil`)                                    | Slayer       | Cyclone of Tumult                | pobb.in/i_ckTA5xIg-A                                             | ninja 1.9%; 95k                                           | only set                                            | 2 / 7         |
| 10  | Flicker Strike Berserker, Maxroll (`flicker-strike-berserker-maxroll`)                        | Berserker    | Vaal Flicker Strike              | maxroll.gg flicker-strike-berserker-league-starter               | Flicker 2.5% all classes; Maxroll                         | Ghostwrithe Endgame                                 | 4 / 4         |
| 11  | Flicker Strike Slayer, MAGEFIST (`flicker-strike-slayer-magefist`)                            | Slayer       | Flicker Strike                   | poe.ninja/poe1/pob/9499e                                         | Flicker 2.5%; 139k                                        | only set                                            | 5 / 5         |
| 12  | Flicker CI Aegis Trickster, Tarekis (`flicker-trickster-tarekis`)                             | Trickster    | Flicker Strike                   | pobb.in/u/tarekis#5639/tarekis-flicker-trickster                 | Flicker 2.5%; 21k                                         | High-End                                            | 4 / 6         |
| 13  | Death's Oath Occultist, Wafflez (`deaths-oath-occultist-wafflez`)                             | Occultist    | Death Aura                       | pobb.in/u74G-R9sgOxL                                             | Death Aura 1.6%; 75k                                      | only set                                            | 9 / 1         |
| 14  | Essence Drain Occultist, Goratha/Zizaran (`essence-drain-occultist-goratha`)                  | Occultist    | Essence Drain / Bane             | pobb.in/PfrGHW7YkQqU                                             | ninja SSF 1.8%, HC 1.6%; 132k                             | Big Staff                                           | 6 / 3         |
| 15  | Soulrend Occultist, Alpha (`soulrend-occultist-alpha`)                                        | Occultist    | Soulrend                         | pobb.in/Vesy4e5HV3gt                                             | 86k                                                       | Endgame                                             | 3 / 7         |
| 16  | Boneshatter Juggernaut, Maxroll (`boneshatter-juggernaut-maxroll`)                            | Juggernaut   | Boneshatter of Complex Trauma    | maxroll.gg boneshatter-juggernaut-league-starter                 | ninja HC 2.5%, SSF 1.6%; Maxroll                          | Endgame                                             | 7 / 2         |
| 17  | Strength stacker Juggernaut SSF, EXILED CAT (`str-stack-jugg-exiledcat`)                      | Juggernaut   | Sunder / melee                   | pobb.in/Id77R_U3qZx3                                             | Juggernaut 5.7% of ladder; 139k                           | only set                                            | 5 / 5         |
| 18  | Strength stacker Juggernaut, Carnarius (`str-stack-jugg-carnarius`)                           | Juggernaut   | melee (Brutus')                  | poe.ninja/poe1/pob/97b4b                                         | 87k                                                       | only set                                            | 4 / 6         |
| 19  | Hybrid strength stacker Juggernaut, Conner Converse (`str-stack-jugg-conner`)                 | Juggernaut   | Kinetic Blast (wand)             | pobb.in/Kvl1jpKGgk2G                                             | 74k                                                       | only set                                            | 6 / 4         |
| 20  | Storm Burst of Repulsion Totems, Tatiantel2/Maxroll (`storm-burst-totem-hiero-tatiantel`)     | Hierophant   | Storm Burst totems               | pobb.in/3fEqJKD_SfdN                                             | ninja SSF 2.9%; 71k                                       | Min-Max                                             | 7 / 3         |
| 21  | Holy Flame Totem, aer0/Maxroll (`holy-flame-totem-hiero-aer0`)                                | Hierophant   | Holy Flame Totem                 | pobb.in/SA6Lvy43S9yx                                             | 44k; Maxroll                                              | Endgame                                             | 7 / 3         |
| 22  | Kinetic Fusillade Ballista, Palsteron (`kf-ballista-hiero-palsteron`)                         | Hierophant   | Kinetic Fusillade ballista       | pobb.in/ktAkVJm59exq                                             | 67k; Maxroll                                              | AegisRespec                                         | 7 / 3         |
| 23  | Spark Archmage, Big Ducks (`spark-archmage-hiero-bigducks`)                                   | Hierophant   | Spark / Ball Lightning           | pobb.in/oLWVUO1gqaMo                                             | 80k                                                       | Ball Lightning of Orbiting (league-start tier gear) | 10 / 0        |
| 24  | Arc Archmage, Phoenix (`arc-archmage-hiero-phoenix`)                                          | Hierophant   | Arc                              | maxroll.gg/poe/pob/13qoos0t                                      | 34k                                                       | only set                                            | 3 / 7         |
| 25  | SRS Guardian SSF, Thyworm (`srs-guardian-thyworm`)                                            | Guardian     | Summon Raging Spirit             | pobb.in/W221pDmdOLBE                                             | ninja SSF 2.0%; 113k                                      | only set                                            | 8 / 2         |
| 26  | Minion RF autobomber, Aziire (`minion-rf-guardian-aziire`)                                    | Guardian     | Sentinel of Radiance             | pobb.in/WjIVdWRuM3bE                                             | 43k                                                       | only set                                            | 3 / 6         |
| 27  | Facebreaker Luminary, EXILED CAT (`facebreaker-luminary-exiledcat`)                           | Luminary     | Sunder (unarmed)                 | pobb.in/_s6FUr3jCaTD                                             | Luminary 20.8% of ladder (mostly mercenary support); 139k | only set                                            | 9 / 0         |
| 28  | Facebreaker Luminary, Alohaa (`facebreaker-luminary-alohaa`)                                  | Luminary     | Earthshatter (unarmed)           | pobb.in/EREgIua0dUwQ                                             | 31k                                                       | only set                                            | 5 / 4         |
| 29  | Earthquake Gladiator, Zizaran (`earthquake-gladiator-ziz`)                                    | Gladiator    | Earthquake                       | pobb.in/CQjwpiUqHfs1                                             | Gladiator 2.6% of ladder; 88k                             | Endgame                                             | 8 / 2         |
| 30  | Bleed bow Gladiator, JayTX (`bleed-bow-gladiator-jaytx`)                                      | Gladiator    | Snipe (bleed)                    | pobb.in/KYkOWyIEXLEd                                             | 18k                                                       | Late Endgame                                        | 7 / 3         |
| 31  | EK Mines Assassin, Kankar (`ek-mines-assassin-kankar`)                                        | Assassin     | Ethereal Knives mines            | pobb.in/prOgshPmYPnt                                             | 118k + 75k                                                | Endgame Mapping                                     | 6 / 4         |
| 32  | Viper Strike of the Mamba Assassin, xRoGeSx (`viper-strike-assassin-xrogesx`)                 | Assassin     | Viper Strike (poison)            | pobb.in/Fxp28aGwtwYJ                                             | 113k                                                      | 500D                                                | 4 / 6         |
| 33  | Spellslinger Cold DoT Elementalist, jungroan (`cold-dot-slinger-elementalist-jungroan`)       | Elementalist | Creeping Frost / Vortex          | pobb.in/AadCGMhml9fa                                             | 165k                                                      | Level 95 (placeholder-quality items)                | 9 / 1         |
| 34  | Arctic Salvo Elementalist, PhazePlays (`arctic-salvo-elementalist-phaze`)                     | Elementalist | Creeping Frost + Winter Orb      | pobb.in/gej8Ani3GFoa                                             | 163k                                                      | Lategame                                            | 9 / 1         |
| 35  | Ice Crash Ignite Chieftain, Crouching_Tuna (`ice-crash-ignite-chieftain-tuna`)                | Chieftain    | Ice Crash (ignite)               | maxroll.gg/poe/pob/6xhey40t                                      | 118k; Maxroll                                             | Endgame                                             | 6 / 4         |
| 36  | Energy Blade Inquisitor, xRoGeSx (`energy-blade-inquisitor-xrogesx`)                          | Inquisitor   | Energy Blade (spellblade)        | pobb.in/_PCT2BvO6j3c                                             | 138k                                                      | 500D                                                | 5 / 4         |
| 37  | Storm Brand Inquisitor, Maxroll (`storm-brand-inquisitor-maxroll`)                            | Inquisitor   | Storm Brand of Indecision        | maxroll.gg storm-brand-inquisitor-league-starter                 | Inquisitor 1.5% of ladder; Maxroll                        | Endgame (Blood Magic)                               | 7 / 3         |
| 38  | Static Strike Slayer, Alohaa (`static-strike-slayer-alohaa`)                                  | Slayer       | Static Strike                    | pobb.in/767t-xufLl6G                                             | 84k                                                       | Endgame Red Maps                                    | 8 / 2         |
| 39  | Lightning Strike abyss life stacker, AllBor (`ls-abyss-deadeye-allbor`)                       | Deadeye      | Lightning Strike of Arcing       | pobb.in/L14c2yc7nNOl                                             | 98k                                                       | only set                                            | 3 / 6         |
| 40  | Lightning Arrow Deadeye, AlanStriker (`lightning-arrow-deadeye-alanstriker`)                  | Deadeye      | Lightning Arrow                  | pobb.in/2l4kt2QN15e1                                             | Deadeye 4.0% of ladder; 14k                               | only set                                            | 6 / 4         |
| 41  | Tornado Shot Deadeye, Kingy x (`tornado-shot-deadeye-kingy`)                                  | Deadeye      | Tornado Shot                     | pobb.in/qRlsxywy6DG6                                             | 6k                                                        | Endgame no HH                                       | 5 / 5         |
| 42  | Elemental Hit of the Spectrum Deadeye, rhino9192 (`ele-hit-spectrum-deadeye-rhino`)           | Deadeye      | Elemental Hit of the Spectrum    | pobb.in/p-cgxv88amRD                                             | 7k                                                        | only set                                            | 5 / 4         |
| 43  | Explosive Arrow Ballista Champion, Zizaran (`ea-ballista-champion-ziz`)                       | Champion     | Explosive Arrow ballista         | pobb.in/SS4brAQOXXM9                                             | Champion 1.4% of ladder; 44k                              | Endgame                                             | 9 / 1         |
| 44  | Poisonous Concoction Pathfinder, Aleshxile (`pconc-pathfinder-aleshxile`)                     | Pathfinder   | Poisonous Concoction of Bouncing | pobb.in/wWijY4N5GplY                                             | Pathfinder 2.5% of ladder; 10k (low budget)               | only set                                            | 2 / 4         |
| 45  | Poison Fireball Trickster, jungroan (`fireball-poison-trickster-jungroan`)                    | Trickster    | Fireball (poison)                | pobb.in/tbTrb3_rBhhn                                             | 50k                                                       | only set                                            | 2 / 8         |
| 46  | Blade Blast of Unloading Saboteur, poopbutts2200 (`blade-blast-unloading-saboteur-poopbutts`) | Saboteur     | Blade Blast of Unloading         | pobb.in/OZi-X4WRXM8G                                             | 29k                                                       | only set                                            | 5 / 5         |
| 47  | Lightning Trap of Sparking Saboteur, PaintMaster (`lightning-trap-saboteur-paintmaster`)      | Saboteur     | Lightning Trap of Sparking       | pobb.in/u/paintmaster#2396/RbTkWnm74nsr                          | 11k (1 Divine challenge)                                  | only set                                            | 6 / 3         |

Across the 47 builds the ten equipment slots hold **270 rare items, 183 uniques** and 17
magic/normal/relic items (plus 251 rare, 139 unique and 14 magic jewels, and 225 flasks, none
rare). On average a build wears 5.7 rare and 3.9 unique equipment pieces; the uniques
cluster in belt, amulet, weapon and body armour.

## 2. Slot by slot

Each entry: how often the slot is rare, the bases seen, the modifier shape, and the
crafting signals (bench crafts, fractured, influence, eldritch, veiled, essence, corrupted,
mirror-tier). Numbers come from `data/` via the extraction described above.

### Weapon (main hand)

- **29/45 rare** (14 unique: Void Battery, Echoforge, Spinesnatch, Nebulis, Mystic Refractor,
  Bino's, Ephemeral Edge, Replica Maata's, Razor of the Seventh Sun...). 26 of the 29 rares
  carry at least one bench craft; 7 are fractured; influence is rare (one Shaper/Elder wand).
- **Casters (13).** Wands, sceptres and staves. The invariant core is the **double gem-level
  prefix**: `+1 to Level of all Spell Skill Gems` with `+1 to Level of all <Cold | Physical |
Chaos | Lightning | Fire> Spell Skill Gems` (10 weapons; the ED staff has `+2 all spell /
+4 all chaos spell` from the Battery Staff base), then spell damage, spell crit, cast
  speed. Finishing is heavy bench work: `Can have up to 3 Crafted Modifiers` on four weapons
  (Profane Wand: cast speed + cold damage + chance to freeze; Opal Sceptre: fire DoT multi +
  fire damage + ignite chance; Omen Wands: spell damage + mine throwing speed + non-chaos as
  extra chaos; Kinetic Wand: attack speed + penetration). Fractured mods anchor three of
  them (`+1 to Level of all Spell Skill Gems` on both Omen Wands, `+26% to Damage over Time
Multiplier`, `+33% to Chaos DoT Multiplier`).
- **Minion wands (3 Convoking Wands).** `+1 to Level of all Minion Skill Gems`, `Minions deal
#% increased Damage` (one fractured), minion crit multi, then the veiled trigger craft
  `Trigger a Socketed Spell when you Use a Skill` (2) or `+2 to Level of Socketed Support
Gems`.
- **Attack weapons (12).** Physical: `#% increased Physical Damage` + `Adds # to # Physical
Damage` + attack speed + crit chance (+ accuracy), finished with a crafted `+#% to Physical
Damage over Time Multiplier` (slams, bleed) or a crafted second `%increased Physical
Damage`; the Boneshatter axe is multimodded (phys DoT multi, hybrid attributes, attack
  speed) and the EQ/Static Strike Reaver Axes are single-craft. Elemental bows: three
  **Spine Bows** with the triple flat elemental prefix set (fire + cold + lightning) +
  attack speed + crit, one with a fractured cold roll; the bleed Citadel Bow has **two**
  fractured mods (`%phys`, accuracy). `Hits can't be Evaded` (veiled) finishes the Jewelled
  Foil and the Imperial Claw; the EA Thicket Bow is the `+1 socketed / +2 socketed bow gems`
    - minion speed crafts pattern. Seven weapons carry the Harvest "alternate quality"
      implicit (`Quality does not increase Physical Damage` plus attack speed / accuracy / AoE /
      elemental damage per quality), i.e. the weapon went through Harvest after rolling.
- **Mirror-tier.** The ilvl-100 Ezomyte Staff (two `%phys` rolls, flat phys, attack speed,
  double damage, two crafts, plus a crafted `8% increased Explicit Physical Modifier
magnitudes` implicit) and the Shaper/Elder Kinetic Wand with three `Socketed Gems are
Supported by Level 20 ...` lines and `Socketed Skills deal 40% more Attack Damage`.

### Offhand (shield, quiver, second wand)

- **19/39 rare** (19 unique: Svalinn x2, Aegis Aurora x2, Rathpith Globe x2, Perepiteia x2,
  Prism Guardian, Dawnbreaker...). Influence is common here (8: Shaper 4, Hunter 3, Crusader
  2, Warlord 1); 14 bench-crafted; 4 fractured.
- **Shields (12).** Life (100-145) + block + 1-2 resists, then one build-defining influenced
  line: Shaper `+1 to maximum number of Summoned Totems` (both totem Hierophants), Shaper
  `Recover 5% of Life when you Block` (EQ Gladiator, RF), Hunter `Socketed Gems have 30%
increased Reservation Efficiency` (RF; the author's note says "Awakener Orb a Shaper life
  shield with a Hunter donor"), Warlord/Crusader `+3% to maximum Fire Resistance` (Ice
  Crash). Caster shields: `+1 to Level of all Cold Spell Skill Gems` + spell crit + block +
  the crafted `chance to deal Double Damage while Focused` (two Winter Orb builds; one has a
  fractured `+2% to all maximum Resistances`). Defensive fillers: `You take 60% reduced
Extra Damage from Critical Strikes`, `#% additional Physical Damage Reduction`, spell
  block, suppression.
- **Quivers (5).** `+# to maximum Life` + `#% increased Damage with Bow Skills` + flat
  elemental damage to attacks + `+#% to Critical Strike Multiplier with Bows` + attack
  speed (crafted on two); the bleed and EA quivers are **Hunter** quivers with `+#% to
Damage over Time Multiplier with Attack Skills` and the physical/fire variant. One has a
  fractured crit multi, one `Bow Attacks fire an additional Arrow`.

### Body armour

- **26/47 rare** (21 unique: Ghostwrithe x4, Cloak of Flame x2, The Covenant x2, Necrotic
  Death's Oath, Restless Ward...). **20 of the 26 rares are eldritch**; 18 bench-crafted;
  5 fractured; one conqueror-influenced (Warlord/Hunter Conquest Lamellar: `You can apply an
additional Curse`, `Ignore Stuns while using Socketed Attack Skills`, `Socketed Attacks
have -20 to Total Mana Cost`, `8% additional Physical Damage Reduction`).
- **Bases.** Necrotic Armour 5 and Twilight Regalia 5 (ES and evasion/ES casters), Sacred
  Chainmail 3, Royal Plate 3, Conquest Lamellar 2, Full Dragonscale 2.
- **Shape.** Defence roll(s) (`+# to Armour/Evasion/ES`, `#% increased <defence>`) +
  `+# to maximum Life` (life builds) or flat/percent ES (CI builds) + two or three
  resistances with chaos resistance in the mix + `#% chance to Suppress Spell Damage` on
  evasion bases + `#% additional Physical Damage Reduction` on armour bases. `#% increased
Stun and Block Recovery` sits on 14 of 26: a filler suffix nobody removed. The eldritch
  implicits are `+1-2% to all maximum Resistances`, `#% increased effect of Non-Curse Auras`,
  `+#% to Critical Strike Multiplier for Spell Damage` or a charge-generation line (Exarch)
  and `#% of Physical Damage from Hits taken as <element>` or `<Aura> has #% increased Aura
Effect` (Eater). Bench crafts: hybrid attributes, hybrid resistances, `%increased defence`,
  suppression, `%maximum life / %maximum mana`, and the multimod EQ plate (avoid ailments,
  avoid stun, block). Fractured anchors: `+48% to Cold Resistance`, `+22% chance to Suppress
Spell Damage` (twice), `Regenerate 143 Life per second`, `+1 to Maximum number of Spectres`.
- **Mirror-tier.** Fubgun's Occultist Twilight Regalia (`+95 ES`, `140% increased ES`, 48/44/44
  resistances) and Tarekis' Necrotic Armour (`+375 Evasion`, `152% increased Evasion and ES`,
  `+80 ES`, 48/48/48) are all-top-tier with no crafted line.

### Helmet

- **28/47 rare** (18 unique: Crown of the Inward Eye x3, The Fledgling x2, Forbidden Shako,
  Heatshiver, Dark Monarch, Lightpoacher...). 20 eldritch; 21 bench-crafted; 6 fractured;
  5 influenced (Archdemon Crown x4 Shaper/Elder, one Warlord/Hunter Lich's Circlet).
- **Bases.** Giantslayer Helmet 5, Archdemon Crown 4, Lich's Circlet 4; Nightmare Bascinet,
  Haunted Bascinet, Royal Burgonet, Jester Mask, Deicide Mask 2 each.
- **Shape.** `+# to maximum Life` (120-160) + one or two resistances + `+#% to Chaos
Resistance` + `#% increased Armour/ES` (+ `+# to Accuracy Rating` 500-600 on melee
  helmets, `+# to Intelligence/Strength` on stackers), finished with a hybrid-resistance
  bench craft or the veiled `+1 to Level of Socketed AoE Gems / #% increased Area of Effect`
  pair (4 helmets) or `+1 to Level of Socketed Melee Gems / +0.2 metres to Melee Strike
Range`. Eldritch implicits: curse effect (`Flammability`, `Vulnerability`, `Despair`), cast
  speed, mana cost efficiency (Exarch); `#% of Physical Damage from Hits taken as <element>`,
  reservation efficiency, `Minions have 20% increased maximum Life` (Eater).
- **Influenced "socketed" helmets.** Archdemon Crown (`+2 to Level of Socketed Skill Gems`
  base implicit) with Shaper `Socketed Gems are Supported by Level 20 Increased Area of
Effect / Hypothermia`, `Socketed Gems deal 30% more Elemental Damage` or Elder `Supported
by Level 25 Burning Damage` plus `+2 to Level of Socketed AoE Gems`: the Winter Orb, RF and
  EK-ignite main-skill helmets.
- **Other signals.** `+2 to Level of all Minion Skill Gems` (SRS Guardian, Great Crown),
  `Grants Level 30 Aspect of the Spider Skill` (Death's Oath), `Has 1 Abyssal Socket` as a
  **fractured** Delve suffix (Viper Strike), fractured `+140 to maximum Life`, `+54 to
Strength`, `+506 to Accuracy Rating`, `Skills have +2.98% to Critical Strike Chance for
each Warcry Exerting them`. The str-stacker Lich's Circlet (Warlord/Hunter: `12% increased
Strength`, `1% increased Critical Strike Chance per 10 Strength`, `Gain Accuracy Rating
equal to your Strength`, T1 life and ES) is mirror-tier.

### Gloves

- **39/47 rare**, the most-rare slot (8 unique: Facebreaker, Asenath's x2, Vaal Caress,
  Hand of the Lords, Wyrmsign, Entropic Devastation). **30 eldritch**; 28 bench-crafted;
  **12 fractured** (the most fractured slot); 3 influenced; 2 corrupted.
- **Bases.** Paladin Gloves 6, Leviathan Gauntlets 6, Warlock Gloves 5; Wyvernscale, Soldier,
  Phantom Mitts, Ancient, Serpentscale 2 each.
- **Shape.** `+# to maximum Life` (100-130) + two resistances (chaos often one of them) +
  `#% increased Attack Speed` (attackers) or flat/percent ES (CI) or an attribute, with one
  or two crafts: hybrid resistances, the veiled `#% increased Melee Damage / +0.1 metres to
Melee Strike Range` pair, the veiled `#% increased Area of Effect / #% increased Area
Damage` pair, `#% increased Projectile Speed / Projectile Damage`, `#% of Physical Damage
Converted to <element>`, `#% increased Damage while Leeching`. Eldritch implicits:
  `Non-Vaal Strike Skills target 1-2 additional nearby Enemies` (6 melee builds), `Inflict
<element> Exposure on Hit`, `#% chance to Unnerve`, `Ignites you inflict spread`, impale
  chance, suppression, `Minions deal #% increased Damage`.
- **Fractured anchors.** `+48% to Cold Resistance` (3), suppression (2), `Ignites you inflict
deal Damage 10% faster`, `Regenerate 92 Life per second`, `+58 to Strength`, `Has 1 Abyssal
Socket`, `49% increased Damage with Hits against Chilled Enemies`.
- **Other signals.** Shaper/Elder Gripped Gloves with three `Socketed Gems are Supported by
Level 20 ...` lines (abyss Lightning Strike); a double-corrupted Warlord/Hunter Crusader
  Gloves (`+1 Maximum Frenzy Charges` twice, `Culling Strike`, `Can be modified while
Corrupted`) on the hybrid str-stacker; corrupted Warlock Gloves with `+1 to Maximum Frenzy
Charges` implicit; `Grants Level 20/30 Aspect of the Cat Skill` (2); Maxroll's spectre
  gloves annotated `Essence of Woe` by the author (the ES roll is the essence line).

### Boots

- **32/47 rare** (14 unique: Ralakesh's Impatience x4, Stampede, Darkray Vectors, Legacy of
  Fury, Sin Trek, Windscream, Annihilation's Approach...). **27 eldritch**; 22 bench-crafted;
  7 fractured; 2 influenced (Hunter/Redeemer Two-Toned Boots: `You have Tailwind if you have
dealt a Critical Strike Recently` + `10% chance to gain Elusive on Critical Strike`; Elder
  Warlock Boots `+2 to Level of all Raise Spectre Gems`).
- **Bases.** Leviathan Greaves 6, Paladin Boots 4, Velour Boots 3, Warlock Boots 3;
  Infiltrator, Dragonscale, Phantom 2 each.
- **Shape.** `#% increased Movement Speed` (25-35; on 36 builds' boots counting magic ones)
    - `+# to maximum Life` (110-130) + two resistances + `+#% to Chaos Resistance`, then one of:
      `#% chance to gain Onslaught for 4 seconds on Kill` (8 builds: bench/veiled 8-12%, author
      "custom" 13-16%, or an unflagged 14-15% roll), a hybrid-resistance craft, `100% chance to
Avoid being Chilled / Frozen` crafts, `%increased defence`, or a fractured `Has 1 Abyssal
Socket` (3 boots, Delve). The Exarch implicit is `4-6% increased Action Speed` on 16 of
      them; Eater gives `Regenerate 0.2% of Life per second per Endurance Charge`, `Gain 4-5% of
Physical Damage as Extra <element>`, `Drops Sapped Ground`, cooldown recovery.
- **Mirror-tier.** The Energy Blade Dragonscale Boots: nine explicit lines including
  `+2% to maximum Fire Resistance`, fractured `+123 to maximum Life`, 46/42/46 resistances,
  onslaught, two crafts.

### Belt

- **20/47 rare**; the slot uniques dominate (26: Mageblood x4, Headhunter x4, Ryslatha's
  Coil x4, Darkness Enthroned x3, Olesya's Delight x2, Dyadian Dawn x2...). 15 bench-crafted;
  **no fractured belt**; 10 influenced (Hunter 6, Crusader 2, Elder 2, Warlord 1); no eldritch
  (belts cannot take eldritch implicits).
- **Bases.** Stygian Vise 13 of 20 (16 builds have a Stygian in some set), Heavy Belt 3,
  Crystal Belt 2 (CI), Leather Belt 2.
- **Shape.** `+# to maximum Life` (120-172) + the Hunter/Elder `#% increased maximum Life`
  (8-12%, 6 belts) + one or two resistances + chaos resistance + `#% increased Elemental
Damage with Attack Skills` (attackers) or `+# to maximum Mana/ES`, finished with a hybrid
  resistance or hybrid attribute craft. Flask lines are the influenced/high-end touch:
  Hunter `Gain a Flask Charge when you deal a Critical Strike` (2), `Flasks applied to you
have #% increased Effect` (3, two crafted) with the matching `33% reduced Flask Charges
gained` craft on the str-stacker Heavy Belt (Warlord/Hunter: `+42/+68 to Strength`, `14%
increased Attributes`). CI belts: Crystal Belt with `+# to ES` / `#% increased maximum ES`
  (Crusader).

### Amulet

- **24/47 rare** (23 unique: Ashes of the Stars x2, Replica Dragonfang's Flight x3, Hyrri's
  Truth x2, Voice of the Storm x2, Badge of the Brotherhood, Aul's Uprising, Defiance of
  Destiny, Gloomfang, Marylene's Fallacy, Fury Valve, Yoke of Suffering...). 20 of 24 are
  anointed (`Allocates <notable>` implicit); 18 bench-crafted; 4 fractured; 3 influenced; 3
  carry eldritch flags (talismans).
- **Bases.** Turquoise Amulet 7, Citrine 3, Jade 2, Cobra Talisman 2, Simplex Amulet 2
  (experimented base), Onyx, Agate, Marble, Pearlescent, Focused Amulet, Great Maw / Carrion
  Queen / Hybrid Arachnid talismans.
- **Shape.** Two families. (a) The **double gem-level amulet**: `+1 to Level of all Skill
Gems` + `+1 to Level of all <Cold | Fire | Lightning | Physical> Skill Gems` (7 amulets; the
  Focused Amulet has `+2 / +2` under `100% increased Explicit Modifier magnitudes`), with
  crit multi or life, finished with crafted `#% increased Effect of Non-Damaging Ailments`,
  `+1 to Minimum Frenzy Charges` (veiled), life or hybrid resistances (two are multimodded:
  Marble `life + cold/chaos res`, Turquoise `life + hybrid attributes`). (b) The **life +
  crit multi / DoT multi + resist** amulet: `+#% to Global Critical Strike Multiplier`
  (8; fractured on 3), `+#% to Damage over Time Multiplier` (5: RF, bleed, ignite, Death
  Aura), `+#% to all Elemental Resistances`, `+# to all Attributes`, then a crafted
  `Non-Channelling / Channelling Skills have -# to Total Mana Cost` (veiled), hybrid
  resistances or flat added damage.
- **Signals.** Talismans with a chosen implicit (`+1 to Maximum Frenzy Charges`, `+1 to
maximum number of Spectres`, `Minions have +30% to Damage over Time Multiplier`, `15%
increased Attributes`; PoB marks them crafted) on five builds; the Simplex Amulet
  (`-2 Prefix / -1 Suffix allowed`, `100% increased Explicit Modifier magnitudes`) carrying
  only `19% increased Attributes`, `26% increased Strength`, `2% increased Damage per 15
Strength` on both strength stackers; the Maxroll spectre Carrion Queen Talisman with a
  fractured `+1 to Level of all Skill Gems` and an `Essence of Woe` ES roll.

### Rings

- **53/94 rare** in 36 builds (40 unique: The Taming x5, Kalandra's Touch x4, Anathema x4,
  Pearl of Tsoatha x3, Nimis x2, Polaric Devastation x2, Shavronne's Revelation x2,
  Kaom's Sign x2, Headhunter-adjacent Praxis/Le Heup...). **42 of 53 bench-crafted**; 12
  fractured; 7 influenced (Crusader 3, Warlord 2, Elder, Hunter); 3 corrupted.
- **Bases.** Amethyst Ring 18 (chaos res implicit), Vermillion 7 (`%maximum Life`),
  Two-Stone 6, Unset 4, Helical Ring 4, Ruby/Sapphire/Bone/Gloam 2 each, Cogwork, Manifold,
  Steel, Topaz, Gold, Coral, Moonstone.
- **Shape.** `+# to maximum Life` (80-157) + one or two resistances (+ chaos) + one damage
  stat (`#% increased Cast Speed` 11, `Adds # to # Lightning Damage to Attacks` 7, `#%
increased Elemental Damage with Attack Skills` 6, accuracy, `+# to Dexterity` 14 as a
  requirement fix), then **one veiled/bench suffix**: `Non-Channelling Skills have -# to Total
Mana Cost` (8 builds), `(15-17)% increased Damage` (6), `+1 to Minimum Frenzy / Endurance
Charges` (6), hybrid resistances or hybrid attributes, `+# to maximum Mana` + `Mana Cost
Efficiency`. Influenced lines: Warlord `Curse Enemies with Vulnerability on Hit` (2),
  Crusader cast speed / spell damage / `%increased maximum ES` (Winter Orb builds).
- **Experimented bases** (Heist curio bases; `Implicit Modifiers Cannot Be Changed`): Helical
  Ring x4 (`-2 Prefix / +1 Suffix allowed`, `50% increased Suffix Modifier magnitudes`:
  `+141-144 to Strength`, `+52-57% to Global Critical Strike Multiplier`, often fractured),
  Cogwork Ring (`25% increased Suffix magnitudes`: mana regen, chaos res, cast speed, crit
  multi), Manifold Ring (`50% increased Prefix magnitudes`: fractured `71% increased
Elemental Damage with Attack Skills`, flat lightning, `+157 to maximum Life`).
- **Fractured anchors** (9 rings): crit multi (3), elemental damage with attacks (2), chaos
  resistance, all resistances, dexterity, `Minions deal 42% increased Damage`, and one
  negative (`60% reduced Rarity of Items found` fractured on a Helical Ring to pin the
  suffix count). **Corrupted**: Vaal implicit `+1 to Maximum Frenzy / Endurance Charges` on
  three plain rings. Unset Rings with `+2 / +3 to Level of Socketed Gems` host aura or curse
  gems on the chaos DoT builds. Minion rings: Bone Ring (`Minions have +#% to all Elemental
Resistances` implicit) and Gloam Ring (left/right minion damage taken) with `Minions deal
#% increased Damage` (fractured twice) and `Minions have #% increased Attack and Cast
Speed`.

### Jewels

- 409 filled jewel slots: **251 rare**, 139 unique, 14 magic, 5 relic; 46 of 47 builds use
  rare jewels. 44 corrupted, 33 fractured, 14 bench-crafted.
- **Cluster jewels** (Large 56, Medium 42, Small 10): the enchant implicit (`Adds # Passive
Skills`, `# Added Passive Skills are Jewel Sockets`, `Added Small Passive Skills grant: X`,
  which PoB marks `{crafted}`) plus two or three `# Added Passive Skill is <notable>` lines and
  `Added Small Passive Skills also grant: ...` fillers; the top notables across builds are
  Martial Prowess, Fuel the Fight, Feed the Fury, Wicked Pall, Prismatic Heart, Enduring
  Composure, Unholy Grace, Repeater.
- **Regular jewels** (Crimson 36, Cobalt 33, Viridian 19): `#% increased maximum Life` (64)
  or ES, `+#% to Global Critical Strike Multiplier` and its per-type variants, DoT multi,
  attack speed, minion attack/cast speed; three or four lines. `Corrupted Blood cannot be
inflicted on you` is the common corruption implicit.
- **Abyss jewels** (Ghastly 18, Murderous 14, Searching 12, Hypnotic 11): `+# to maximum
Life` (39), flat added damage to attacks, minion lines; the abyss life stacker fills 27
  jewel slots this way.
- **Allflame.** `Intangibility: #%` (the Allflame-crafting property) appears on 42 items in
  9 builds, mostly jewels and rings: evidence that jewels and rings are what people put
  through the 3.29 league craft.

### Flasks

225 slots: 173 magic, 48 unique, 2 normal, 2 relic. No rare flasks exist; magic flasks are a
prefix + suffix pair (and an enchant), outside this spike's scope.

## 3. Item archetypes to be able to express, ranked

Counts are builds (of 47) whose chosen item set contains at least one such item; item
counts in parentheses.

1. **Eldritch life/ES + resists armour piece** (helmet, gloves, boots or body): defence roll +
   life or ES + two or three resistances with chaos + one or two bench crafts (hybrid
   resistance, hybrid attribute, `%defence`, a veiled hybrid pair), under one Exarch and one
   Eater implicit. **39 builds** (97 items; 78% of all rare armour pieces).
2. **Movement-speed boots**: `#% increased Movement Speed` + life + two resists + chaos res
   (+ onslaught on kill, abyssal socket or avoid-chill craft), nearly always eldritch.
   **32 builds** (32 rare boots; onslaught in 8).
3. **Life + resist + damage-stat ring with a veiled suffix** on Amethyst / Vermillion /
   Two-Stone (`-# to Total Mana Cost`, `increased Damage`, `+1 Minimum Charges`, hybrid
   resists). **36 builds** (53 rings; 42 bench-crafted, 9 fractured).
4. **Life + resist belt (Stygian Vise)** with Hunter/Elder `%maximum Life`, elemental damage
   with attacks or mana/ES, and a hybrid craft. **20 builds** (13 Stygian, 3 Heavy, 2 Crystal).
5. **Anointed amulet**, either the double `+1 to Level of all Skill Gems / +1 to all <element>
Skill Gems` prefix pair (8 builds) or life + crit multi / DoT multi + all-res, each with a
   veiled craft (`-mana cost`, `+1 minimum charges`, ailment effect) or multimod.
   **24 builds**.
6. **Caster weapon with the double `+1 gem level` prefix** + spell damage / spell crit / cast
   speed, finished by multimod (4) or anchored by a fractured mod (3); the minion variant is
   `+1 all Minion Skill Gems` + `Minions deal #% increased Damage` + a trigger craft.
   **13 builds**.
7. **Attack weapon**: physical (`%phys` + flat phys + attack speed + crit, crafted phys DoT
   multi or `%phys`) or elemental bow (triple flat elemental + attack speed + crit), often on
   a **fractured base** (4 of 12) and usually with a Harvest alternate-quality implicit.
   **12 builds**.
8. **Influenced "one special line" offhand**: Shaper `+1 totem` / `Recover 5% Life on Block`
   shield, Hunter `Reservation Efficiency` shield, Hunter DoT-multi quiver, caster shield with
   `+1 cold spell gems` + block + `Double Damage while Focused` craft. **12 builds** (8
   influenced, 4 plain).
9. **Fractured-base armour**: a fractured suppression, resistance, life, strength or Delve
   `Has 1 Abyssal Socket` mod on helmet / gloves / boots / body, then rolled and
   eldritch-finished. **14 builds** (30 fractured armour pieces).
10. **Shaper/Elder socketed-support helmet or gloves** (Archdemon Crown `+2 socketed skill
gems` + `Supported by Level 20/25 ...` + `30% more Elemental Damage`; Gripped Gloves with
    three supports). **5 builds**.
11. **Experimented bases** (Helical, Simplex, Cogwork, Manifold, Focused) where the implicit
    removes affix slots and raises magnitudes; attribute stackers and the mines Assassin.
    **6 builds**.
12. **Allflame-crafted jewels and rings** (`Intangibility`). **9 builds**.
13. **Corrupted rares**: Vaal implicit `+1 Maximum Charges` rings, double-corrupted influenced
    gloves. **4 builds**.
14. **Cluster jewels** (enchant + two or three notables) and **rare / abyss jewels**: nearly
    universal (**46 builds**, 251 items) but a separate, smaller modifier pool; essence,
    influence and eldritch do not apply.

Signals across the whole sample: 204 of 270 equipment rares (76%) carry a bench craft; 57
(21%) a fractured mod; 97 of 125 rare armour pieces (78%) are eldritch; 40 (15%) are
Shaper/Elder/conqueror-influenced, concentrated in belts, shields and the special helmets;
multimod (`Can have up to 3 Crafted Modifiers`) appears on 8 builds, almost always on the
weapon; no synthesised item appears at all; essence provenance is only visible where the
author wrote it (`Essence of Woe`, 1 build) or by the mod (`+2 to Level of all Minion Skill
Gems`, talisman/essence-only lines); truly mirror-tier (every line top tier) items are a
handful on the high-budget sets (Fubgun's Occultist body, Tarekis' body, the str-stackers'
helmet and rings, Sanavixx's staff). The typical endgame rare is five to seven lines, one or
two of them crafted, on an eldritch or fractured base.

## 4. Caveats

- **Not read through the running PoB app.** `load_build` on the PoB Redux MCP was declined by
  the permission system for both a Maxroll URL and a pobb.in URL, so the items were taken by
  decoding the same share codes the app would have loaded. The `<Item>` text in the code is
  PoB's own item text (what `get_items` returns is parsed from it), so nothing here is
  invented; but PoB-only conveniences were not applied: crafted lines show PoB's range form
  `(a-b)`, lines marked `{custom}` are author-typed, and items pasted from the game without
  an item level show `ilvl: null`. Eldritch implicits are identified by the item's Exarch /
  Eater flags when PoB did not tag the line.
- **Builds not loadable.** Mobalytics pages are JavaScript-only and returned 403 to fetches,
  which lost Ky's Blade Blast Slinger Assassin (157k + 111k views), Raychich's Spectre
  Necromancer (99k), ronarray's Holy Absolution Guardian (95k) and Winter Orb Occultist
  (147k), Path of Evening's Toxic Rain Pathfinder and Master T's Tendrils Elementalist.
  Maxroll guides built on the "Build Progression Tool" (Lightning Arrow Deadeye, Eviscerate
  Gladiator, Explosive Arrow Champion, Rolling Magma Saboteur, Exsanguinate Trickster,
  Penance Brand Elementalist, Poisonous Concoction Pathfinder, Elemental Hit Deadeye, Ice
  Trap Trickster, Kinetic Blast Deadeye, Cyclone Slayer) store items in Maxroll's planner
  format (internal mod ids, no display text) and were skipped; the bow, Champion, Pathfinder,
  Trickster and Saboteur rows therefore come from smaller creators' pobb.in codes, and
  Lightning Arrow / Tornado Shot are under-weighted relative to their ladder share.
- **Ladder archetypes without a row.** Luminary **Animate Guardian** mercenary support is
  20.8% of the 3.29 ladder by class (2.4% as a skill pair) and has no PoB here (its items are
  largely aura gear and merc equipment); Penance Brand Ignite (2.3%), Fire Trap Chieftain
  (1.6%), Void Shockwave Slayer (1.6%), Kinetic Blast of Clustering Necromancer (1.9%) and
  Earthshatter Berserker (HC/SSF top 5) are missing. Two Winter Orb Elementalists and three
  strength stackers are included on purpose (ladder weight); they inflate the eldritch-armour
  and experimented-base counts slightly.
- **Which item set.** Guides with several sets were read at their endgame set (named in the
  table); "Giga"/"Aspirational"/"Mirror" sets were avoided except where the author ships
  only such a set (500-Divine sets of xRoGeSx). The RF Chieftain, Ice Crash Chieftain and
  Kinetic Fusillade codes carry a leveling character (level 30/64/13) with endgame item
  sets, so their `character.level` is not the gear's level. Spark Archmage and the Cold DoT
  Spellslinger carry league-start-quality items (low item levels, two- or three-line
  placeholders) and should be read as "what a starter wears".
- **Representativeness.** These are creators' endgame characters, better geared than the
  median ladder character; the modifier _shapes_ are representative, the _tiers_ are high.
  The sample is 3.29 only; `data/ninja-popularity.json` also holds the 3.28 Mirage final
  snapshot for class/skill shares but no 3.26-3.28 item dumps were taken. Jewel and flask
  modifiers were counted but not characterised in depth.
