<script setup lang="ts">
import { data } from "./how.data";
</script>

<template>
    <figure class="how-figure trace">
        <div class="steps">
            <div v-for="(t, i) in data.trace" :key="i" class="step">
                <code class="label">{{ t.step ?? "item { … }" }}</code>
                <!-- The card's markup is the checker's own state, built with the site. -->
                <div class="card" v-html="t.card"></div>
            </div>
        </div>
        <figcaption>
            The checker's item after each step of the craft on the home page. The dashed line counts
            modifiers whose identity it does not know.
        </figcaption>
    </figure>
</template>

<style scoped>
.steps {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
    gap: 14px;
}

.label {
    display: block;
    margin-bottom: 6px;
    padding: 0;
    background: none;
    font-size: 12px;
    color: var(--vp-c-text-2);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}
</style>
