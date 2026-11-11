---
layout: page
pageClass: landing-page
title: hinekora
titleTemplate: A statically checked language for Path of Exile item crafting
---

<div class="landing">

<h1 class="wordmark">hinekora</h1>

<p class="subtitle">A statically checked language for Path of Exile item crafting.</p>

A hinekora craft is a sequence of crafting steps applied to one item: currency orbs, bench
crafts, essences, fossils, Harvest and the rest, with loops and branches over what the item
has. Most steps have a random outcome, so a craft describes a tree of possible items, not one.

The checker walks that tree symbolically. It keeps a summary of every item the steps so far
could have produced, and at each step asks whether the step's precondition holds for all of
them. If it might not, the craft is rejected, with the state of the item at that point.

<div class="vp-doc">

```hinekora
item {
    base:     "Vermillion Ring"
    ilvl:     84
    rarity:   rare
    prefixes: [ "random" ]
    suffixes: [ "fire resistance" t1, "cold resistance" t1, "chaos resistance" t2 ]
}

until has "maximum life" t1 {
    bench "suffixes cannot be changed"
    harvest reforge "life"
}
```

</div>

<pre class="terminal">10:5: error: at this point the item is: Vermillion Ring · Rare · 3–6 affixes · 0–3 prefixes · 3 suffixes · ilvl 84
  Requires an open prefix slot — none is guaranteed open here.</pre>

The bench craft is a prefix. It fits on the first pass, but the reforge can fill all three
prefixes, and then the second pass has nowhere to put it.

<h2>How it works</h2>

The checker is an abstract interpreter. Each crafting method is a short sequence of primitive
operations (strip, fill from a pool, remove one, change rarity) over an abstract item: ranges
for the affix counts, a formula for which modifiers are present, and the tiers each may be at.
A step with hundreds of outcomes is folded into that summary in one pass; outcomes are never
enumerated.

A second layer estimates cost: the chance each condition holds and the expected number of each
currency, from the game's modifier weights.

<p class="links">
<a :href="$withBase('/docs/')">Docs</a> ·
<a :href="$withBase('/playground/')">Playground</a> ·
<a href="https://github.com/rickbutton/hinekora">Source</a>
</p>

</div>
