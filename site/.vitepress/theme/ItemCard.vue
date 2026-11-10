<script setup lang="ts">
export interface CardMod {
    side: string;
    tier: string;
    text: string;
    name?: string;
    crafted?: boolean;
}

defineProps<{
    base: string;
    itemClass: string;
    rarity: "normal" | "magic" | "rare";
    ilvl: number;
    mods: CardMod[];
    rest?: string;
}>();
</script>

<template>
    <div class="item-card" :class="`rarity-${rarity}`">
        <header>
            <div class="base">{{ base }}</div>
            <div class="class">{{ itemClass }} · Item Level {{ ilvl }}</div>
        </header>
        <section>
            <div v-for="m in mods" :key="m.text" class="mod" :class="{ crafted: m.crafted }">
                <div class="meta">
                    <span class="side">{{ m.side }}</span>
                    <span v-if="m.name" class="name">“{{ m.name }}”</span>
                    <span class="tier">{{ m.tier }}</span>
                </div>
                <div class="text">{{ m.text }}</div>
            </div>
            <div v-if="rest" class="rest">{{ rest }}</div>
        </section>
    </div>
</template>

<style scoped>
/* The game's tooltip, as the playground draws it. */
.item-card {
    --rarity: #c8c8c8;
    --explicit: #8888ff;
    --crafted: #b4b4ff;
    --dim: #7f7f7f;
    --frame: #3a3528;
    background: #0c0b0b;
    border: 1px solid var(--frame);
    border-radius: 2px;
    color: var(--explicit);
    font-family: "Fontin SmallCaps", var(--vp-font-family-base);
    font-size: 14px;
    line-height: 1.4;
    text-align: center;
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.45);
}

.item-card.rarity-magic {
    --rarity: #8888ff;
}

.item-card.rarity-rare {
    --rarity: #ffff77;
}

header {
    padding: 10px 14px 8px;
    background: linear-gradient(#2a2617, #0c0b0b);
    border-bottom: 1px solid var(--frame);
}

.base {
    color: var(--rarity);
    font-family: var(--hk-font-display);
    font-size: 18px;
    font-weight: 700;
    letter-spacing: 0.4px;
}

.class {
    color: var(--dim);
    font-size: 12px;
    margin-top: 2px;
}

section {
    padding: 8px 14px 10px;
}

.mod {
    text-align: left;
    padding: 3px 0;
}

.mod.crafted {
    color: var(--crafted);
}

.meta {
    display: flex;
    gap: 6px;
    align-items: baseline;
    color: var(--dim);
    font-size: 11px;
}

.meta .side {
    border: 1px solid var(--frame);
    border-radius: 2px;
    padding: 0 4px;
}

.meta .tier {
    color: #ffff77;
}

.rest {
    color: var(--dim);
    font-style: italic;
    font-size: 13px;
    border: 1px dashed var(--frame);
    padding: 3px 6px;
    margin-top: 6px;
}
</style>
