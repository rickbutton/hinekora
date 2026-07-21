# Hinekora — Roadmap

> Forward-looking work only. Completed work is not tracked here; that is what
> `git log` is for, and the design that resulted lives in `REFERENCE.md` and
> `ARCHITECTURE.md`. Nothing below is committed; it is a menu, not a plan.

## Near-term

- **Negative facts in the tooltip.** `not has X` yields an exclusion that is filtered
  from completion candidates but never shown. Surface it as a "without …" line: an
  additive LAYER over the presence decomposition (units → prime implicates →
  cardinality), not a special case. That layering is the whole point of the hover design.
- **Fossils / veiled:** two more sourced currencies. Fossils reforge with weight biasing
  keyed off the category tags harvest already ingests (`Mod.implicitTags`); veiled is
  add-then-unveil.
- **Operation-function follow-ons** (the feature shipped; these round it out):
    - statement-position **completion** of proc names (completion still lists only
      currencies + control keywords).
    - proc-name **hover** signatures.
    - a currency- or block-valued **parameter** (only value params, tier/count/mod, for now).

## Smaller

- Restrict **base** completion to craftable classes (mod completion is already filtered;
  base completion lists everything).
- `with omen "…"` **completion:** deferred until omens are properly modelled; that
  position currently falls through to the statement list (harmless).
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
- **flask edge cases:** legacy base-implicit variants, and split-beast / Awakener's /
  Harvest routes to reduced-cap bases.
