<script setup lang="ts">
// A Rare ring after a Chaos Orb loop that ends on any of three resistances.
const RARITIES = [
    { name: "Normal", on: false },
    { name: "Magic", on: false },
    { name: "Rare", on: true },
];
const COUNTS = [
    { name: "prefixes", lo: 1, hi: 3, cap: 3 },
    { name: "suffixes", lo: 1, hi: 3, cap: 3 },
    { name: "both", lo: 4, hi: 6, cap: 6 },
];
</script>

<template>
    <figure class="how-figure model">
        <div class="parts">
            <section>
                <h4>Rarity</h4>
                <p class="what">a set: the rarities the item may have</p>
                <div class="chips">
                    <span v-for="r in RARITIES" :key="r.name" :class="{ on: r.on }">{{
                        r.name
                    }}</span>
                </div>
            </section>
            <section>
                <h4>Counts</h4>
                <p class="what">a range each: the fewest and the most</p>
                <div v-for="c in COUNTS" :key="c.name" class="count">
                    <span class="name">{{ c.name }}</span>
                    <span class="cells">
                        <i
                            v-for="n in c.cap + 1"
                            :key="n"
                            :class="{ on: n - 1 >= c.lo && n - 1 <= c.hi }"
                            >{{ n - 1 }}</i
                        >
                    </span>
                </div>
            </section>
            <section>
                <h4>Presence</h4>
                <p class="what">a rule: which modifiers can be on the item together</p>
                <p class="value">
                    fire, cold or lightning resistance: at least one<br />every other modifier:
                    maybe
                </p>
            </section>
            <section>
                <h4>Tiers</h4>
                <p class="what">a set per modifier: the tiers it may be</p>
                <p class="value">fire resistance, if there: tier 1 to 8<br />…</p>
            </section>
        </div>
        <figcaption>
            The four parts of the checker's item, for a Rare ring after a Chaos Orb loop that ends
            on any of three resistances. Each part stands for many items at once.
        </figcaption>
    </figure>
</template>

<style scoped>
.parts {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(230px, 1fr));
    gap: 12px;
}

section {
    padding: 12px 14px;
    border: 1px solid var(--vp-c-divider);
    border-radius: 6px;
    background: var(--vp-c-bg-soft);
}

h4 {
    margin: 0;
    font-size: 14px;
}

.what {
    margin: 2px 0 10px;
    font-size: 12px;
    line-height: 1.4;
    color: var(--vp-c-text-2);
}

.value {
    margin: 0;
    font-size: 13px;
    line-height: 1.6;
}

.chips {
    display: flex;
    gap: 6px;
}

.chips span,
.cells i {
    border: 1px solid var(--vp-c-divider);
    border-radius: 3px;
    font-size: 12px;
    color: var(--vp-c-text-3);
}

.chips span {
    padding: 1px 8px;
}

.chips .on,
.cells .on {
    border-color: var(--hk-gold);
    background: var(--hk-gold-soft);
    color: var(--vp-c-text-1);
}

.count {
    display: flex;
    align-items: center;
    gap: 10px;
    margin: 3px 0;
    font-size: 12px;
}

.name {
    width: 54px;
    color: var(--vp-c-text-2);
}

.cells {
    display: flex;
    gap: 3px;
}

.cells i {
    width: 22px;
    height: 20px;
    font-style: normal;
    line-height: 18px;
    text-align: center;
}
</style>
