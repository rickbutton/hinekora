<script setup lang="ts">
import { data } from "./landing.data";

const cost = data.cost;
</script>

<template>
    <div class="output cost">
        <div class="caption">expected spend</div>
        <table>
            <thead>
                <tr>
                    <th></th>
                    <th class="times"></th>
                    <th>expected</th>
                    <th class="chaos">chaos</th>
                </tr>
            </thead>
            <tbody>
                <tr v-for="r in cost.rows" :key="r.line">
                    <td class="step">
                        <code>{{ r.text }}</code>
                    </td>
                    <td class="times">{{ r.times }}</td>
                    <td class="spend">{{ r.spend }}</td>
                    <td class="chaos">{{ r.chaos }}</td>
                </tr>
            </tbody>
            <tfoot>
                <tr>
                    <td colspan="4">{{ cost.total }}</td>
                </tr>
            </tfoot>
        </table>
        <div class="when">chaos at {{ cost.prices }}</div>
        <div class="caption">the finished item</div>
        <!-- The card's markup is the checker's own state, built with the site. -->
        <div class="card" v-html="cost.card"></div>
    </div>
</template>

<style scoped>
.cost {
    border-left: 3px solid var(--hk-gold);
    overflow-x: auto;
}

table {
    width: 100%;
    margin: 0;
    border-collapse: collapse;
    font-size: 13px;
}

th,
td {
    padding: 3px 14px 3px 0;
    border: none;
    background: none;
    vertical-align: baseline;
    text-align: left;
}

th {
    font-size: 11px;
    font-weight: 400;
    color: var(--vp-c-text-3);
}

th:last-child,
td:last-child {
    padding-right: 0;
}

.step,
.times {
    white-space: nowrap;
}

.step code {
    font-family: var(--vp-font-family-mono);
}

.times {
    color: var(--vp-c-text-2);
}

.chaos {
    text-align: right;
    font-variant-numeric: tabular-nums;
}

tfoot td {
    padding-top: 8px;
    border-top: 1px solid #333;
    text-align: right;
    font-weight: 600;
    color: var(--hk-gold);
}

/* A narrow page keeps the step, what it spends and its worth. */
@media (max-width: 560px) {
    .times {
        display: none;
    }
    .step {
        white-space: normal;
    }
}

.when {
    margin: 4px 0 14px;
    text-align: right;
    font-size: 12px;
    color: var(--vp-c-text-3);
}
</style>
