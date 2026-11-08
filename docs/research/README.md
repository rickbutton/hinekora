# Research spike: crafting for the 3.30 league

> Working notes for making Hinekora usable on real crafts before the 3.30 league
> (2026-11-13). Everything here is evidence and analysis, not the design: a conclusion
> that changes the language or the checker moves to `ROADMAP.md`, `QUESTIONS.md` or a
> commit. The docs check does not scan this directory, so these files may cite code and
> features that do not exist yet.

## The questions

1. Which builds do people actually play (3.29 Curse of the Allflame, and earlier leagues
   for stability), and which of their items are crafted rather than unique?
2. How are those items crafted in practice: the recipes build guides and crafting guides
   give, and the general shape of a craft (deterministic steps around a gamble, not one
   orb spammed to a one-in-millions roll)?
3. Which language features those recipes need that Hinekora lacks, in priority order,
   with the crafts each would unlock.
4. Where the checker's reading of the game disagrees with craftofexile.com, the
   reference calculator, emulator and simulator.

## The files

| File                      | Holds                                                                                        |
| ------------------------- | -------------------------------------------------------------------------------------------- |
| `builds.md`               | The popular builds, their rare item slots and the modifiers those slots carry                |
| `data/`                   | Raw extractions (PoB item dumps, poe.ninja snapshots) the analysis is drawn from             |
| `crafting-methodology.md` | How people craft: the recurring recipes per slot and archetype, each with its source         |
| `feature-report.md`       | The deliverable: features Hinekora needs, in priority order, with the crafts each unlocks    |
| `accuracy.md`             | The checker against craftofexile.com: what was compared, where they agree and disagree       |
| `../../examples/`         | Crafts that check today; `../../examples/future/` holds crafts that wait on a listed feature |

## Sources

- poe.ninja builds (ladder usage per league). Its build API is internal and undocumented:
  `/poe1/api/builds/<snapshot>/search?overview=<league>&type=exp[&skills=<name>]` returns a
  protobuf of facet counts and the top hundred characters, with names in `NDIC` string
  dictionaries; `scratch/tools/ninja.py` and `ninja-chars.py` decode them (see
  `data/ninja-popularity.md` and `data/ninja-top-characters-allflame.json`). A handful of
  requests per session, never a crawl.
- Path of Building (PoB Redux) with its MCP: loads Maxroll / Mobalytics / poe.ninja /
  pobb.in links and gives every item.
- Maxroll, Mobalytics and creator build guides; crafting guides and videos.
- craftofexile.com calculator, emulator and simulator, through the browser.
- The wiki cache (`.cache/poewiki`) for every game rule, as always.

## Status

Started 2026-11-08. Tools verified: PoB Redux MCP (works), Chrome extension (not yet
connected), poe.ninja and craftofexile need the browser.
