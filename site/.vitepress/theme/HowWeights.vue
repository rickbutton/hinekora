<script setup lang="ts">
import { data } from "./how.data";

const w = data.weights;
const n = (x: number): string => x.toLocaleString("en-US");
const pct = (x: number): string => `${(100 * x).toFixed(1)}%`;
</script>

<template>
    <figure class="how-figure weights">
        <div class="bar" role="img" aria-label="The prefix weights on the ring">
            <span class="best" :style="{ flexGrow: w.best }"></span>
            <span class="life" :style="{ flexGrow: w.life - w.best }"></span>
            <span class="rest" :style="{ flexGrow: w.prefixes - w.life }"></span>
        </div>
        <ul class="key">
            <li><i class="best"></i>tier 1 maximum Life: {{ n(w.best) }}</li>
            <li><i class="life"></i>its other tiers: {{ n(w.life - w.best) }}</li>
            <li><i class="rest"></i>every other prefix: {{ n(w.prefixes - w.life) }}</li>
        </ul>
        <p class="sum">
            The cost layer assumes the orb rolls one modifier or two at even odds. A prefix then
            lands {{ pct(w.lands) }} of the time. Tier 1 Life is {{ n(w.best) }} of the
            {{ n(w.prefixes) }} prefix weight. {{ pct(w.lands) }} ×
            {{ pct(w.best / w.prefixes) }} is the {{ w.odds }} the cost table shows.
        </p>
        <figcaption>The prefixes one Orb of Alteration can roll on the ring, by weight.</figcaption>
    </figure>
</template>

<style scoped>
.bar {
    display: flex;
    height: 22px;
    border-radius: 4px;
    overflow: hidden;
}

.bar span {
    flex-basis: 0;
}

.best {
    background: var(--hk-gold);
}

.life {
    background: #8888ff;
}

.rest {
    background: var(--vp-c-divider);
}

.key {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 20px;
    margin: 10px 0 0;
    padding: 0;
    list-style: none;
    font-size: 13px;
}

.key li {
    margin: 0;
}

.key i {
    display: inline-block;
    width: 10px;
    height: 10px;
    margin-right: 6px;
    border-radius: 2px;
}

.sum {
    margin: 10px 0 0;
    font-size: 14px;
    line-height: 1.6;
}
</style>
