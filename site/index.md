---
layout: page
pageClass: landing-page
title: hinekora
titleTemplate: Path of Exile crafting guides, checked
---

<div class="landing">

<section class="hero">
<p class="eyebrow">Path of Exile crafting guides, checked</p>
<h1 class="wordmark">hinekora</h1>
<p class="tagline">Write the craft down. Know it works before you spend the currency.</p>
<p class="lede">
Hinekora is a small language for writing down a crafting guide, step by step. It follows every
outcome every step could have and tells you where the guide breaks: an exalt with no open slot, a
bench craft that clashes with a modifier already there, a loop that can never finish.
</p>
<div class="actions">
<a class="action primary" :href="$withBase('/playground/')">Try it in the playground</a>
<a class="action" :href="$withBase('/docs/')">Read the docs</a>
</div>
</section>

<section class="example">
<div class="example-code">
<p class="caption">A guide: lock the suffixes, reforge the prefixes until the life is tier 1</p>
<div class="vp-doc">

```hinekora
item {
    base:     "Vermillion Ring"
    ilvl:     84
    rarity:   rare
    prefixes: [ "random" ]
    suffixes: [
        "fire resistance" t1,
        "cold resistance" t1,
        "chaos resistance" t2
    ]
}

until has "maximum life" t1 and prefixCount <= 2 {
    until prefixCount <= 2 {
        annul
    }
    bench "suffixes cannot be changed"
    harvest reforge "life"
}

if not has "maximum mana" {
    bench "maximum mana"
}
```

</div>

<ol class="notes">
<li><b>The item you start with.</b> Only the starting item is declared; after it, hinekora works out what the item can be at every step.</li>
<li><b>Repeat until it is true.</b> After the loop, the life is known to be tier 1 with a prefix free.</li>
<li><b>Make room first.</b> The bench craft needs an open prefix on every pass, not just the first, so the guide annuls until there is one. Leave this out and the bench step is flagged. The annul comes while the suffixes are unlocked, so it can take a resistance: the finished ring on the right promises the life, not the resistances.</li>
<li><b>Finish only if needed.</b> A branch on the item as it is now: bench the mana only when the reforge did not roll it.</li>
</ol>
</div>

<aside class="example-result">
<p class="caption">What hinekora knows when the guide ends</p>
<ItemCard
    base="Vermillion Ring"
    item-class="Rings"
    rarity="rare"
    :ilvl="84"
    :mods="[
        { side: 'Prefix', name: 'Virile', tier: 'Tier 1', text: '+(100-114) to maximum Life' },
        { side: 'Prefix', tier: 'Tier 1-12', text: '+(15-73) to maximum Mana' },
    ]"
    rest="0-4 additional prefix or suffix modifiers"
/>
<div class="spend">
<div class="spend-figure">≈ 18 Divine Orbs</div>
<div class="spend-note">expected spend: 1.3 Orbs of Annulment, 17.6 Divine Orbs on the metamod, 662 Wild Crystallised Lifeforce and 1.9 Chaos Orbs, at a recent economy snapshot</div>
</div>
</aside>
</section>

<section class="points">
<div class="point">
<h3>Every step checked</h3>
<p>What each step needs (the right rarity, an open slot, no modifier of the same group) is checked on every path the craft can take, before you spend anything.</p>
</div>
<div class="point">
<h3>Expected cost</h3>
<p>Each step gets its odds and expected spend at market prices, and each loop the number of rounds to expect.</p>
</div>
<div class="point">
<h3>Editor support</h3>
<p>A language server for VS Code: problems as you type, the item at any step on hover, completion for every base, modifier and essence, and a formatter.</p>
</div>
<div class="point">
<h3>Runs in your browser</h3>
<p>The playground runs the whole checker on the page, with every example guide. Nothing to install.</p>
</div>
</section>

</div>
