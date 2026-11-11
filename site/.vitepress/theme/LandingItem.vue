<script setup lang="ts">
import { data } from "./landing.data";
</script>

<template>
    <div class="output item">
        <div class="caption">the finished item</div>
        <!-- The card's markup is the checker's own state, built with the site. -->
        <div class="card" v-html="data.cost.card"></div>
    </div>
</template>
