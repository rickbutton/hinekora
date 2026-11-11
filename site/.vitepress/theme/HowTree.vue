<script setup lang="ts">
// Three steps of a fan of outcomes: each dot's children sit under it.
const FAN = 5;
const level1 = Array.from({ length: FAN }, (_, i) => 30 + i * 60);
const level2 = level1.flatMap((x) => Array.from({ length: FAN }, (_, j) => x - 22 + j * 11));
</script>

<template>
    <figure class="how-figure tree">
        <div class="pair">
            <div>
                <svg
                    viewBox="0 0 300 150"
                    role="img"
                    aria-label="Outcomes multiplying at each step"
                >
                    <g class="edges">
                        <line v-for="x in level1" :key="x" x1="150" y1="14" :x2="x" y2="70" />
                        <line
                            v-for="(x, i) in level2"
                            :key="i"
                            :x1="level1[Math.floor(i / FAN)]"
                            y1="70"
                            :x2="x"
                            y2="130"
                        />
                    </g>
                    <circle cx="150" cy="14" r="5" />
                    <circle v-for="x in level1" :key="x" :cx="x" cy="70" r="4" />
                    <circle v-for="(x, i) in level2" :key="i" :cx="x" cy="130" r="2.5" />
                </svg>
                <p>Every outcome: the count multiplies at each step.</p>
            </div>
            <div>
                <svg viewBox="0 0 300 150" role="img" aria-label="One summary after each step">
                    <g class="edges">
                        <line x1="150" y1="26" x2="150" y2="58" />
                        <line x1="150" y1="82" x2="150" y2="114" />
                    </g>
                    <rect x="100" y="4" width="100" height="22" rx="3" />
                    <rect x="100" y="60" width="100" height="22" rx="3" />
                    <rect x="100" y="116" width="100" height="22" rx="3" />
                </svg>
                <p>One summary: the same size after every step.</p>
            </div>
        </div>
    </figure>
</template>

<style scoped>
.pair {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 24px;
}

svg {
    display: block;
    width: 100%;
    max-width: 320px;
    margin: 0 auto;
}

.edges line {
    stroke: var(--vp-c-text-3);
    stroke-width: 1;
}

circle {
    fill: #8888ff;
}

rect {
    fill: var(--hk-gold-soft);
    stroke: var(--hk-gold);
}

p {
    margin: 8px 0 0;
    text-align: center;
    font-size: 13px;
    color: var(--vp-c-text-2);
}
</style>
