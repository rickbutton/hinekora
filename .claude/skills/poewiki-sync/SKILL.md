---
name: poewiki-sync
description: Keep the local poewiki.net cache (.cache/poewiki) current without re-downloading it, using the wiki's recentchanges feed to re-export only changed pages and refresh the affected Cargo tables. Use when the wiki may have changed (new patch or league), before trusting cached data in research, or to bootstrap the cache on a new machine.
---

# poewiki-sync

The cache is a snapshot plus an overlay. `tools/poewiki/export.mjs` took the
snapshot once (every content namespace as XML, every Cargo table as JSONL);
`tools/poewiki/sync.mjs` keeps it current by asking the wiki for everything
edited since the last sync and re-exporting only those pages into
`.cache/poewiki/xml/updates/`. The title index points each page at its newest
copy, and any Markdown rendered from a changed page is deleted so the next
render fetches fresh. `state.json` records the last sync time.

Cargo tables have no change feed, but re-exporting one is only a few requests
(Special:CargoExport, 1,000 rows per request), so sync refreshes whole tables:
by default the tables fed by the namespaces that saw changes (Modifier pages
feed `mods`, `mod_stats`, `mod_spawn_weights`, `mod_generation_weights`; main
namespace item pages feed the item, essence, bench and fossil tables).

## Commands

```
node tools/poewiki/sync.mjs --dry-run        # what changed since the last sync; one request
node tools/poewiki/sync.mjs                  # re-export changed pages, refresh tables by namespace
node tools/poewiki/sync.mjs --cargo=none     # pages only
node tools/poewiki/sync.mjs --cargo=all      # pages, then every table (~200 requests)
node tools/poewiki/sync.mjs --cargo=mods,mod_spawn_weights
node tools/poewiki/sync.mjs --since=2026-10-24T19:10:00Z   # widen the window
```

Run `--dry-run` first and look at the counts. After a game patch the Modifier
namespace can show thousands of bot edits; that is normal, and still far
cheaper than a new snapshot (50 pages per export request).

## Bootstrap on a new machine

```
pnpm install
POEWIKI_DELAY_MS=5000 node tools/poewiki/export.mjs --xml --cargo
```

About 500 requests; a couple of hours at that pace. It is resumable, records
its start time as the first sync point, and builds the title index at the end.
Set `POEWIKI_CONTACT` so the user agent carries a contact.

## Rules

- **Be conservative.** The wiki rate-limits; the tooling waits out a 429 but
  the goal is never to trigger one. Keep `POEWIKI_DELAY_MS` at 3000 or above
  (5000 for a snapshot), run one job at a time, and do not sync more often
  than the research needs — once per patch is plenty.
- Never commit `.cache/`; it is gitignored and hundreds of megabytes.
- `export.mjs --force` re-pulls Cargo tables it already has; use it only when a
  table is known to be stale and sync's `--cargo=` is not enough.
