<script setup lang="ts">
// A five-modifier Rare ring after `exalt` and `if not has "maximum life" t1 { annul }`,
// seen by the two facts the second `if` reads.
const COUNTS = ["five modifiers", "six modifiers"];
const ROWS = [
    {
        life: "tier 1 Life",
        cells: [
            { yes: false, text: "no" },
            { yes: true, text: "yes: it skipped the annul" },
        ],
    },
    {
        life: "no tier 1 Life",
        cells: [
            { yes: true, text: "yes: the annul took one" },
            { yes: false, trap: true, text: "no: no path makes it" },
        ],
    },
];
</script>

<template>
    <figure class="how-figure parts">
        <table>
            <thead>
                <tr>
                    <th></th>
                    <th v-for="c in COUNTS" :key="c">{{ c }}</th>
                </tr>
            </thead>
            <tbody>
                <tr v-for="r in ROWS" :key="r.life">
                    <th>{{ r.life }}</th>
                    <td
                        v-for="(c, i) in r.cells"
                        :key="i"
                        :class="{ yes: c.yes, trap: c.trap === true }"
                    >
                        {{ c.text }}
                    </td>
                </tr>
            </tbody>
        </table>
        <p class="note">
            The red cell holds the full rings the second Exalted Orb could not apply to.
        </p>
        <figcaption>
            The ring after the first <code>if</code>, by its modifier count and its Life. The count
            is not an axis of its own: it is read off the modifier axes, so it stays tied to the
            Life.
        </figcaption>
    </figure>
</template>

<style scoped>
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
    padding: 6px 8px;
    border: 1px solid var(--vp-c-divider);
    line-height: 1.35;
}

th {
    font-weight: 600;
    text-align: left;
    color: var(--vp-c-text-2);
    background: none;
}

thead th:first-child {
    width: 30%;
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

td.trap {
    color: var(--vp-c-danger-1);
    background: rgba(244, 135, 113, 0.1);
    outline: 1px dashed #f48771;
    outline-offset: -1px;
}

.note {
    margin: 10px 0 0;
    font-size: 13px;
    line-height: 1.5;
}
</style>
