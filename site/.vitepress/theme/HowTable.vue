<script setup lang="ts">
// A toy ring that rolls two modifiers: Life (a prefix) and fire resistance (a
// suffix). The set shown is "a Rare ring with one modifier, tier 2 Life or
// fire resistance".
const LIFE = ["no Life", "Life tier 2", "Life tier 1"];
const FIRE = ["no fire resistance", "fire resistance"];
const PANELS = [
    { rarity: "Magic", yes: new Set<string>() },
    { rarity: "Rare", yes: new Set(["1,0", "0,1"]) },
];
</script>

<template>
    <figure class="how-figure table">
        <div class="panels">
            <div v-for="p in PANELS" :key="p.rarity">
                <h4>{{ p.rarity }}</h4>
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
                                :class="{ yes: p.yes.has(`${i},${j}`) }"
                            >
                                {{ p.yes.has(`${i},${j}`) ? "yes" : "no" }}
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </div>
        <figcaption>
            A ring in a toy game where only Life and fire resistance can roll. The axes are rarity,
            Life and fire resistance, and each of the twelve cells is one item. This table holds "a
            Rare ring with one modifier: tier 2 Life or fire resistance".
        </figcaption>
    </figure>
</template>

<style scoped>
.panels {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
    gap: 16px 24px;
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
