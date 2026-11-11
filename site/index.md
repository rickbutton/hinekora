---
layout: page
pageClass: landing-page
title: hinekora
titleTemplate: A statically checked language for Path of Exile item crafting
---

<div class="landing">

<h1 class="wordmark">hinekora</h1>

<p class="subtitle">A statically checked language for Path of Exile item crafting.</p>

<section class="row">
<div class="prose">

A hinekora craft is a sequence of crafting steps applied to one item: currency orbs, bench
crafts, essences, fossils, Harvest and the rest, with loops and branches over what the item
has. Most steps have a random outcome, so a craft describes a tree of possible items, not one.

The checker walks that tree symbolically. It keeps a summary of every item the steps so far
could have produced, and at each step asks whether the step's precondition holds for all of
them. This craft checks, and the summary it ends with is the finished item.

A craft that checks can be costed. From the game's modifier weights, hinekora works out the
chance each loop exits on a round and how many of each currency the craft is expected to
use, then prices that from a market snapshot.

</div>
<div class="example">
<div class="vp-doc">

<<< @/examples/landing.craft{hinekora}

</div>
<LandingCost />
</div>
</section>

<section class="row">
<div class="prose">

If a step's precondition might not hold, the craft is rejected, with the state of the item
at that step.

Here the bench craft is a prefix, and a ring holds three. The item leaves the loop with one prefix,
and the Regal Orb and the two Exalted Orbs can each add another, so on some paths there is
no slot left for it.

</div>
<div class="example">
<div class="vp-doc">

<<< @/examples/landing-refused.craft{hinekora}

</div>
<LandingFinding />
</div>
</section>

<p class="links">
<a :href="$withBase('/docs/')">Docs</a> ·
<a :href="$withBase('/playground/')">Playground</a> ·
<a href="https://github.com/rickbutton/hinekora">Source</a>
</p>

</div>
