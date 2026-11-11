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

A hinekora craft is a sequence of crafting steps applied to an item. Each step is one of the
game's crafting methods: an orb, a bench craft, an essence, a Harvest craft. Loops and
branches test what the item has.

Most steps are random, so a craft describes a tree of possible items.

</div>
<div class="example">
<div class="vp-doc">

<<< @/examples/landing.craft{hinekora}

</div>
</div>
</section>

<section class="row">
<div class="prose">

The checker walks that tree symbolically. It keeps one summary of every item the steps so
far could have produced. Before each step it asks whether the step's precondition holds for
every one of them.

This craft checks. The summary it ends with is the finished item.

</div>
<div class="example">
<LandingItem />
</div>
</section>

<section class="row">
<div class="prose">

A craft that checks has a cost. The game's modifier weights give the chance that a loop
exits on each round. From that comes the expected number of each currency, priced here from
a market snapshot.

</div>
<div class="example">
<LandingCost />
</div>
</section>

<section class="row">
<div class="prose">

This one goes on with two Exalted Orbs and a bench craft.

</div>
<div class="example">
<div class="vp-doc">

<<< @/examples/landing-refused.craft{hinekora}

</div>
</div>
</section>

<section class="row">
<div class="prose">

The bench craft is a prefix and a ring holds three. The Regal Orb and each Exalted Orb can
add one. On some paths no slot is left, so the checker rejects the craft. The error shows the item
at that step.

</div>
<div class="example">
<LandingFinding />
</div>
</section>

<p class="links">
<a :href="$withBase('/docs/')">Docs</a> ·
<a :href="$withBase('/playground/')">Playground</a> ·
<a href="https://github.com/rickbutton/hinekora">Source</a>
</p>

</div>
