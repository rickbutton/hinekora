# Hinekora — Roadmap

> Forward-looking work only. Completed work is not tracked here; that is what
> `git log` is for, and the design that resulted lives in `REFERENCE.md` and
> `ARCHITECTURE.md`. Nothing below is committed; it is a menu, not a plan.

## Near-term

- **Item-model reconciliation.** The audit of the code against `item-model.md` left four
  decisions and ten confirmed bugs; both, with the order of work, are in the plan doc
  https://claude.ai/artifact/GHLeAg5eEPu1ZeCz92HSLU. Nothing starts before the decisions
  are ruled on.
- **Negative facts in the tooltip.** `not has X` yields an exclusion that is filtered
  from completion candidates but never shown. Surface it as a "without …" line: an
  additive LAYER over the presence decomposition (units → prime implicates →
  cardinality), not a special case. That layering is the whole point of the hover design.
- **Fossils:** one more sourced currency. Per
  [Fossil § Mechanics](https://www.poewiki.net/wiki/Fossil#Mechanics) a resonator reforges a
  Rare with per-tag weight multipliers and blockers, keyed off the category tags harvest
  already ingests (`Mod.implicitTags`); the fossil-only modifiers (domain 16) are mostly
  disabled since 3.10 and can be skipped at first.
- **Operation-function follow-ons** (the feature shipped; these round it out):
    - statement-position **completion** of proc names (completion still lists only
      currencies + control keywords).
    - proc-name **hover** signatures.
    - a currency- or block-valued **parameter** (only value params, tier/count/mod, for now).

## Smaller

- Restrict **base** completion to craftable classes (mod completion is already filtered;
  base completion lists everything).
- `with omen "…"` **completion:** deferred until omens are properly modelled (a PoE2
  mechanic, [poe2wiki: Omen](https://www.poe2wiki.net/wiki/Omen); poewiki's
  [Omen](https://www.poewiki.net/wiki/Omen) page is the unrelated PoE1 item); that position
  currently falls through to the statement list (harmless).
- **Completion perf:** `getCompletions` runs a full check per request; fine for small
  crafts, memoize if latency shows.
- **Monaco playground** (`editors/playground`) reusing the transport-free LSP service.
- **PoE2 module:** the omen machinery is modelled; PoE2 data ingest is not the target yet.
- **Tier-atom tightenings:** assert `tierAtom ⇒ family` and tier mutual-exclusion in the
  presence BDD. Both are true facts we currently omit; omitting them only ever under-claims
  (sound), so they are precision, not correctness.

## Deferred by design (don't build until called for)

- the **cost/probability layer** (expected attempts; needs the Known/Approx/Unknown weight
  provenance already in the model).
- **multi-item crafts** (recombination).
- English negation sugar (`doesn't have` → `not has`).
- "omen next op only" sugar.
- a **power-user annotation tier** for reusable techniques.
- **reduced-cap base edge cases:** the split-beast, Awakener's Orb and Harvest routes
  that put modifiers on a magic Simplex Amulet, which no ordinary currency can
  ([Simplex Amulet § Special Crafting Considerations](https://www.poewiki.net/wiki/Simplex_Amulet#Special_Crafting_Considerations)),
  and legacy base-implicit variants.
