<script setup lang="ts">
// The toy ring of HowTable, Rare panel only, before and after an Exalted Orb.
// Life's group and fire resistance's group each hold one modifier, so the orb
// adds whichever of the two the ring lacks.
const LIFE = ["no Life", "Life tier 2", "Life tier 1"];
const FIRE = ["no fire resistance", "fire resistance"];
const TABLES = [
    { name: "before", yes: new Set(["1,0", "0,1"]) },
    { name: "after the Exalted Orb", yes: new Set(["1,1", "2,1"]) },
];
const MOVES = [
    { from: "Life tier 2, no fire resistance", to: "adds fire resistance" },
    { from: "fire resistance, no Life", to: "adds Life, tier 2 or tier 1" },
];
</script>

<template>
    <figure class="how-figure step">
        <div class="flow">
            <div v-for="(t, k) in TABLES" :key="t.name" :class="k === 0 ? 'before' : 'after'">
                <h4>{{ t.name }}</h4>
                <table>
                    <thead>
                        <tr>
                            <th></th>
                            <th v-for="f in FIRE" :key="f">{{ f }}</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-for="(l, i) in LIFE" :key="l">
                            <th>{{ l }}</th>
                            <td
                                v-for="(f, j) in FIRE"
                                :key="f"
                                :class="{ yes: t.yes.has(`${i},${j}`) }"
                            >
                                {{ t.yes.has(`${i},${j}`) ? "yes" : "no" }}
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>
            <ul class="moves">
                <li v-for="m in MOVES" :key="m.from">
                    <span class="from">from {{ m.from }}:</span>
                    <span class="to">{{ m.to }}</span>
                </li>
            </ul>
        </div>
        <figcaption>
            The Rare half of the toy ring's table, before and after an Exalted Orb. Each item that
            can exist goes to every item the orb can make of it. Life cannot be added twice, so
            every ring after the orb has fire resistance.
        </figcaption>
    </figure>
</template>

<style scoped>
.flow {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
    gap: 16px 24px;
}

.moves {
    grid-column: 1 / -1;
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin: 0;
    padding: 0;
    list-style: none;
    font-size: 13px;
}

.moves li {
    margin: 0;
}

.from {
    color: var(--vp-c-text-2);
}

.to {
    margin-left: 6px;
}

h4 {
    margin: 0 0 6px;
    font-size: 14px;
}

table {
    display: table;
    width: 100%;
    margin: 0;
    font-size: 13px;
    border-collapse: collapse;
    table-layout: fixed;
}

th,
td {
    padding: 4px 8px;
    border: 1px solid var(--vp-c-divider);
    text-align: center;
    line-height: 1.3;
}

th {
    font-weight: 600;
    color: var(--vp-c-text-2);
    background: none;
}

tbody th {
    text-align: left;
}

tr,
tbody tr:nth-child(2n) {
    background: none;
}

td {
    color: var(--vp-c-text-3);
}

td.yes {
    color: var(--vp-c-text-1);
    background: var(--hk-gold-soft);
    outline: 1px solid var(--hk-gold);
    outline-offset: -1px;
}
</style>
