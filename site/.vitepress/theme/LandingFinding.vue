<script setup lang="ts">
import { data } from "./landing.data";

const finding = data.finding;
</script>

<template>
    <div class="output finding">
        <div class="where">
            <span class="severity">error</span>
            <span class="line">line {{ finding.line }}</span>
            <code>{{ finding.step }}</code>
        </div>
        <p class="message">{{ finding.message }}</p>
        <div class="caption">the item at this step</div>
        <!-- The card's markup is the checker's own state, built with the site. -->
        <div class="card" v-html="finding.card"></div>
    </div>
</template>

<style scoped>
.finding {
    border-left: 3px solid #f48771;
}

.where {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 10px;
    font-size: 13px;
}

.severity {
    color: #f48771;
    font-weight: 600;
}

.line {
    color: var(--vp-c-text-2);
}

.where code {
    font-family: var(--vp-font-family-mono);
    color: var(--vp-c-text-1);
}

.message {
    margin: 6px 0 14px;
    white-space: pre-wrap;
}
</style>
