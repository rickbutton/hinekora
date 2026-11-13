---
name: coe-simulator
description: Drive craftofexile.com's crafting simulator from inside its page to get Monte Carlo figures for a craft (how many uses of each currency a sequence takes), for comparison with hinekora's cost layer. Use when validating a cost figure or a chance against an independent simulation. Needs a browser tool that can run JavaScript in a page.
---

# coe-simulator

craftofexile.com's simulator (the old site, `?game=poe1`, the Simulator tab) runs in the
page. A craft is set up and run by calling the page's own functions, and the counts are
read back from its globals. This is the one independent check on a cost figure.

These notes record the page's internals as they were read in November 2026. They are
unpublished and may have changed: when a call fails, read the source again before
trusting anything below.

## What it needs

- **A browser tool that runs JavaScript in a page** and returns the result. Plain HTTP
  sees the menus only. When no such tool is available, say so and stop.
- **The page's source, read locally.** A browser tool may refuse to return function
  source. Fetch `packages/package.js` and `json/data/main/poec_data.json` from the site
  with `curl` into a scratch directory outside the repository and read them there; a
  small brace matcher that pulls out one function by name is worth writing.

## Setting up an item

```js
simulator_settings = {
    bgroup,
    base,
    bitem,
    ilvl,
    rarity,
    influences: null, // or modifier-group ids, e.g. [7] for Redeemer
    quality: 20,
};
poec_nsimShowMainInt(null, false, null);
```

Then set `simulator_settings.rarity` and `simulator_data.is_rare` again, since the call
resets them. For an item that starts Rare, also set `simulator_data.cmaxaffgrp` (3 and 3)
and `simulator_data.iaffixes`, whose entries are built from `poecd.modifiers` and
`poecd.tiers`: `id`, `mgrp`, `tindex`, `atype`, `modgroups`, `nvalues`, `rolls`, `bench`,
`frac`, `maven`.

## Describing the craft

A craft is a list of steps, passed to `poec_nsimRelayConfigData(cfg)`, which fills
`nsim_econfig`:

```js
{
    method: [mode, action, sub],
    autopass,
    filters: [{ type: "and" | "or" | "not", treshold, conds: [{ id, treshold, max }] }],
    actions: { win, win_route, fail, fail_route },
}
```

- **Routes** on failure are loop, restart, or step _n_. There is no "next".
- **`treshold`** (the site's spelling) on a condition is the tier number. The relay turns
  it into an index counted from the end of the modifier's whole ladder.
- **An `or` group with no `treshold` needs every condition.** Give it one.
- **`max: 0` is ignored**, being falsy. "No suffix" is a `not` group on
  `count_suffix >= 1`.
- **Methods:**

| Step            | `method`                                                         |
| --------------- | ---------------------------------------------------------------- |
| Essence         | `["essence", "ess<id>", "esst<ladder index>"]`                   |
| Fossils         | `["fossil", "\|id\|id\|"]`                                       |
| Bench craft     | `["bench", "\|<modid>t<tier>\|"]`                                |
| Harvest reforge | `["harvest", "hreroll", "<type id>"]` (1 life, 6 fire, 14 speed) |
| Imprint         | `["beast_crafting", "imprint"]`, then `"restimprint"`            |

## Running it

Replace `poec_simLoopAction` with a stub, call `poec_simStartSimulationGO()`, then call
`poec_simExecuteAction()` in a loop until `nsim_numsuccess` reaches the sample size.
`nsim_crafts[i].steps` holds the uses of each step for item _i_.

A background tab throttles `setTimeout` to one call a second, and to one a minute after
five minutes. Slice the loop through a `MessageChannel` instead; the page then runs about
6,000 actions a second.

## Reading a difference

`docs/cost.md` §8 lists where craftofexile is known to differ from hinekora; a difference
is a finding only when it is not one of those. Its simulator and its own calculator can
also disagree with each other, so say which of the two a figure came from.

A figure that differs for another reason is checked against the wiki cache first
(`poewiki-render`), since the wiki, not the simulator, is the source of the game's rules.
