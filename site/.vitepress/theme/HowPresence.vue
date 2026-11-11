<script setup lang="ts">
const NAMES = ["fire", "cold", "lightning"];
// Every yes-or-no combination of the three, "all three" first and "none" last.
const ROWS = Array.from({ length: 8 }, (_, i) =>
    NAMES.map((_n, bit) => ((7 - i) >> (2 - bit)) & 1),
);
const QUESTIONS = NAMES.map((name, i) => ({ name, x: 60 + i * 130 }));
</script>

<template>
    <figure class="how-figure presence">
        <div class="pair">
            <table>
                <thead>
                    <tr>
                        <th v-for="n in NAMES" :key="n">{{ n }}</th>
                        <th>can the item be this?</th>
                    </tr>
                </thead>
                <tbody>
                    <tr v-for="(row, i) in ROWS" :key="i" :class="{ out: !row.some(Boolean) }">
                        <td v-for="(on, j) in row" :key="j">{{ on ? "yes" : "no" }}</td>
                        <td>{{ row.some(Boolean) ? "yes" : "no: ruled out" }}</td>
                    </tr>
                </tbody>
            </table>
            <svg viewBox="0 0 440 170" role="img" aria-label="The rule as three questions in a row">
                <defs>
                    <marker
                        id="how-presence-arrow"
                        viewBox="0 0 10 10"
                        refX="9"
                        refY="5"
                        markerWidth="7"
                        markerHeight="7"
                        orient="auto"
                    >
                        <path d="M0 0 L10 5 L0 10 z" />
                    </marker>
                </defs>
                <g class="edges">
                    <template v-for="(q, i) in QUESTIONS" :key="q.name">
                        <path :d="`M${q.x} 52 L${q.x} 112`" marker-end="url(#how-presence-arrow)" />
                        <path
                            :d="`M${q.x + 48} 34 L${i === 2 ? 392 : q.x + 82} 34`"
                            marker-end="url(#how-presence-arrow)"
                        />
                    </template>
                </g>
                <g class="nodes">
                    <rect
                        v-for="q in QUESTIONS"
                        :key="q.name"
                        :x="q.x - 48"
                        y="16"
                        width="96"
                        height="36"
                        rx="18"
                    />
                    <rect x="12" y="114" width="356" height="36" rx="6" class="yes" />
                    <rect x="394" y="16" width="40" height="36" rx="6" class="no" />
                </g>
                <g class="names">
                    <text v-for="q in QUESTIONS" :key="q.name" :x="q.x" y="38">{{ q.name }}?</text>
                    <text x="190" y="136">possible</text>
                    <text x="414" y="38">no</text>
                </g>
                <g class="labels">
                    <template v-for="q in QUESTIONS" :key="q.name">
                        <text :x="q.x + 14" y="86">yes</text>
                        <text :x="q.x + 64" y="28">no</text>
                    </template>
                </g>
            </svg>
        </div>
        <figcaption>
            "At least one of the three resistances" as a table and as the checker stores it. The
            table has a row for every combination. The stored form asks one question per modifier
            and stops at the first answer that settles it.
        </figcaption>
    </figure>
</template>

<style scoped>
.pair {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
    gap: 20px;
    align-items: center;
}

table {
    display: table;
    width: 100%;
    margin: 0;
    font-size: 13px;
    border-collapse: collapse;
}

th,
td {
    padding: 3px 8px;
    border: 1px solid var(--vp-c-divider);
    text-align: left;
}

th {
    font-weight: 600;
    color: var(--vp-c-text-2);
    background: none;
}

tr {
    background: none;
}

.out td {
    color: #f48771;
    background: rgba(244, 135, 113, 0.1);
}

svg {
    display: block;
    width: 100%;
    max-width: 480px;
    margin: 0 auto;
}

.edges path {
    fill: none;
    stroke: var(--vp-c-text-3);
    stroke-width: 1.2;
}

marker path {
    fill: var(--vp-c-text-3);
}

.nodes rect {
    fill: var(--vp-c-bg-soft);
    stroke: #8888ff;
}

.nodes .yes {
    fill: var(--hk-gold-soft);
    stroke: var(--hk-gold);
}

.nodes .no {
    fill: rgba(244, 135, 113, 0.14);
    stroke: #f48771;
}

text {
    font-size: 12px;
    fill: var(--vp-c-text-1);
}

.names text {
    text-anchor: middle;
}

.labels text {
    fill: var(--vp-c-text-2);
    text-anchor: middle;
}
</style>
